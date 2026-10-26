import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AcquisitionStartSchema, AcquisitionViewSchema, type AcquisitionView } from '../shared/acquisition.js';
import { CaptureLimitsSchema, NodePreviewResultSchema, SelectionSchema, SnapshotSchema, type NodePreviewResult, type Snapshot } from '../shared/contracts.js';
import { validateProject } from '../core/project.js';
import { PluginBroker } from './broker.js';
import { ProjectStore } from './store.js';
import { ServiceError } from './errors.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TASKS=12,MAX_FILE_BYTES=16_000_000,MAX_CACHE_BYTES=96_000_000;
const StoredSchema=z.object({view:AcquisitionViewSchema,preview:NodePreviewResultSchema.nullable(),snapshot:SnapshotSchema.nullable(),
  structureStartedAt:z.string().datetime().nullable(),structureFinishedAt:z.string().datetime().nullable()}).strict();
type Stored=z.infer<typeof StoredSchema>;
type Runtime={controller:AbortController;started:number;done:Promise<void>};
const failure=(error:unknown)=>({code:error instanceof ServiceError?error.code:'ACQUISITION_FAILED',
  message:(error instanceof ServiceError?error.message:'The acquisition could not finish. Validated earlier observations remain available.').slice(0,1000)});
const needsPreview=(plan:AcquisitionView['plan'])=>plan!==null&&plan!=='structure';
const needsStructure=(plan:AcquisitionView['plan'])=>plan!==null&&plan!=='overview';

/** Independent observations; never writes an incomplete acquisition into a project. */
export class AcquisitionManager {
  private readonly tasks=new Map<string,Stored>();
  private readonly sizes=new Map<string,number>();
  private readonly runs=new Map<string,Runtime>();
  private readonly creating=new Set<string>();
  private readonly committing=new Set<string>();
  private readonly removing=new Set<string>();
  private persistence:Promise<void>=Promise.resolve();
  private activeId:string|null=null;
  private closed=false;
  private readonly directory:string;
  constructor(dataDir:string,private readonly store:ProjectStore,private readonly broker:PluginBroker,
    private readonly options:{requestTimeoutMs?:number}={}) {this.directory=join(dataDir,'acquisitions');}

  async initialize():Promise<void> {
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const entries=await readdir(this.directory);
    for(const name of entries) {
      const parts=name.split('.');
      if(parts.length===3&&parts[2]==='tmp'&&UUID.test(parts[0]!)&&UUID.test(parts[1]!))await rm(join(this.directory,name),{force:true});
    }
    const names=entries.filter(n=>n.endsWith('.json')&&UUID.test(n.slice(0,-5)));
    if(names.length>MAX_TASKS)throw new ServiceError('ACQUISITION_STORAGE_LIMIT','Acquisition cache exceeds its task limit.',413);
    for(const name of names) {
      const file=await open(join(this.directory,name),constants.O_RDONLY|constants.O_NOFOLLOW);
      let task:Stored;
      try {
        const info=await file.stat();
        if(!info.isFile()||info.size>MAX_FILE_BYTES)throw new ServiceError('ACQUISITION_STORAGE_LIMIT','Acquisition cache exceeds its file limit.',413);
        this.sizes.set(name.slice(0,-5),info.size);
        if([...this.sizes.values()].reduce((a,b)=>a+b,0)>MAX_CACHE_BYTES)throw new ServiceError('ACQUISITION_STORAGE_LIMIT','Acquisition cache exceeds its total budget.',413);
        task=StoredSchema.parse(JSON.parse(await file.readFile('utf8')));
        if(task.view.id!==name.slice(0,-5))throw new ServiceError('INVALID_ACQUISITION','Acquisition identity does not match its file.');
      } finally {await file.close();}
      this.tasks.set(task.view.id,task);
      if(task.view.status==='running'||task.view.status==='cancel_requested') {
        const settled=task.view.plan!==null&&(!needsPreview(task.view.plan)||task.view.preview.status==='ready')&&
          (!needsStructure(task.view.plan)||task.view.structure.status==='ready');
        if(settled&&task.view.status!=='cancel_requested') {
          try{this.finalize(task);}catch(error){task.view.status='failed';task.view.error=failure(error);}
        } else {
          task.view.status='interrupted';
          task.view.error={code:'ACQUISITION_INTERRUPTED',message:'The server restarted during acquisition. Earlier validated observations remain available; live work must be started again.'};
          for(const step of [task.view.preview,task.view.structure])if(step.status==='running'){step.status='failed';step.error=task.view.error;}
        }
        task.view.stage='done';
        await this.persist(task);
      }
    }
  }
  private task(projectId:string,id:string):Stored {
    const task=UUID.test(id)?this.tasks.get(id):undefined;
    if(!task||task.view.projectId!==projectId||this.creating.has(id))throw new ServiceError('NOT_FOUND','Acquisition not found.',404);
    if(this.removing.has(id))throw new ServiceError('ACQUISITION_BUSY','This acquisition is being removed.',409);
    return task;
  }
  private view(task:Stored):AcquisitionView {
    const copy=structuredClone(task.view),run=this.runs.get(copy.id);
    if(run) {
      copy.progress.elapsedMs=Math.max(copy.progress.elapsedMs,Date.now()-run.started);
      if(['ready','partial','failed','cancelled'].includes(copy.status)) {
        copy.status=copy.status==='cancelled'?'cancel_requested':'running';copy.stage='saving';
      }
    }
    return copy;
  }
  list(projectId:string):AcquisitionView[] {return [...this.tasks.values()].filter(t=>t.view.projectId===projectId&&!this.creating.has(t.view.id)).map(t=>this.view(t)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  get(projectId:string,id:string):AcquisitionView {return this.view(this.task(projectId,id));}
  preview(projectId:string,id:string):NodePreviewResult {
    const task=this.task(projectId,id);
    if(!task.preview)throw new ServiceError('PREVIEW_NOT_READY','This task has no completed overview image.',409);
    return structuredClone(task.preview);
  }
  private checkSession(sessionId:string):void {
    if(this.closed)throw new ServiceError('SERVER_CLOSED','The acquisition service is stopping.',503);
    const status=this.broker.status;
    if(!status.connected)throw new ServiceError('PLUGIN_DISCONNECTED','Connect the Figma plugin before reading source.',503);
    if(status.sessionId!==sessionId)throw new ServiceError('PLUGIN_SESSION_CHANGED','The Figma session changed. Prepare a new task for the current source.',409);
  }
  private async persist(task:Stored):Promise<void> {
    task.view.updatedAt=new Date().toISOString();
    const encoded=JSON.stringify(StoredSchema.parse(task)),bytes=Buffer.byteLength(encoded),id=task.view.id;
    if(bytes>MAX_FILE_BYTES)throw new ServiceError('ACQUISITION_STORAGE_LIMIT','This acquisition exceeds its 16 MB storage budget.',413);
    const write=this.persistence.catch(()=>{}).then(async()=>{
      if([...this.sizes.entries()].reduce((sum,[key,size])=>sum+(key===id?0:size),bytes)>MAX_CACHE_BYTES)
        throw new ServiceError('ACQUISITION_STORAGE_LIMIT','Acquisition cache exceeds 96 MB. Remove finished tasks before continuing.',413);
      const temporary=join(this.directory,`${id}.${randomUUID()}.tmp`);
      try {
        const file=await open(temporary,'wx',0o600);
        try{await file.writeFile(encoded);await file.sync();}finally{await file.close();}
        await rename(temporary,join(this.directory,id+'.json'));this.sizes.set(id,bytes);
      } finally {await rm(temporary,{force:true});}
    });
    this.persistence=write;await write;
  }
  async prepare(projectId:string,expectedRevision:number,sessionId:string,signal?:AbortSignal):Promise<AcquisitionView> {
    this.checkSession(sessionId);
    if(this.activeId)throw new ServiceError('ACQUISITION_BUSY','Another acquisition is still running.',409);
    if(this.tasks.size>=MAX_TASKS)throw new ServiceError('ACQUISITION_STORAGE_LIMIT','Remove a finished acquisition before preparing another (maximum 12).',413);
    const project=await this.store.get(projectId);
    if(project.revision!==expectedRevision)throw new ServiceError('REVISION_CONFLICT','Project changed; refresh before preparing acquisition.',409);
    const selection=SelectionSchema.parse(await this.broker.request({type:'get_selection'},{...(signal?{signal}:{}),timeoutMs:this.options.requestTimeoutMs??20000}));
    this.checkSession(sessionId);
    if(signal?.aborted)throw new ServiceError('CANCELLED','Preparation was cancelled.',499);
    if((await this.store.get(projectId)).revision!==expectedRevision)throw new ServiceError('REVISION_CONFLICT','Project changed during preparation.',409);
    this.checkSession(sessionId);
    if(signal?.aborted)throw new ServiceError('CANCELLED','Preparation was cancelled.',499);
    if(!selection.fileKey)throw new ServiceError('FILE_IDENTITY_UNAVAILABLE','Figma did not expose a source file identity.',409);
    const node=selection.nodes[0];
    if(selection.nodes.length!==1||!node||!['FRAME','GROUP','COMPONENT','COMPONENT_SET','INSTANCE','SECTION'].includes(node.type)||!node.bbox||node.bbox.width<=0||node.bbox.height<=0)
      throw new ServiceError('INVALID_SELECTION','Select one container with positive bounds.');
    // Recheck after async preparation so concurrent requests cannot exceed cache capacity.
    if(this.tasks.size>=MAX_TASKS)throw new ServiceError('ACQUISITION_STORAGE_LIMIT','Acquisition task limit reached.',413);
    const now=new Date().toISOString(),id=randomUUID();
    const task:Stored={view:{id,projectId,baseRevision:expectedRevision,sessionId,
      source:{fileKey:selection.fileKey,pageId:selection.pageId,nodeId:node.id,name:node.name,type:node.type,bounds:node.bbox},
      status:'prepared',stage:'prepared',plan:null,limits:CaptureLimitsSchema.parse({}),progress:{nodes:0,bytes:0,elapsedMs:0},
      preview:{status:'idle',observedAt:null,error:null},structure:{status:'idle',complete:false,reason:null,error:null},warnings:[],error:null,
      createdAt:now,updatedAt:now,resultSnapshotId:null},preview:null,snapshot:null,structureStartedAt:null,structureFinishedAt:null};
    this.tasks.set(id,task);this.creating.add(id);
    try{await this.persist(task);}catch(error){this.tasks.delete(id);throw error;}
    finally{this.creating.delete(id);}
    return this.view(task);
  }
  async start(projectId:string,id:string,input:unknown):Promise<AcquisitionView> {
    const task=this.task(projectId,id),parsed=AcquisitionStartSchema.parse(input);
    if(task.view.status!=='prepared')throw new ServiceError('ACQUISITION_STATE','This task has already started. Retry a failed step or prepare a new task.',409);
    if(needsPreview(parsed.plan)&&task.view.source.type==='SECTION')throw new ServiceError('UNSUPPORTED_PREVIEW','Sections support structure only. Choose structure or explicitly select an inner Frame.',400);
    task.view.plan=parsed.plan;task.view.limits=parsed.limits;
    if(parsed.overview)task.view.overview=parsed.overview;
    return this.launch(task);
  }
  async retry(projectId:string,id:string,step:'preview'|'structure'):Promise<AcquisitionView> {
    const task=this.task(projectId,id);
    if(!['failed','partial','interrupted'].includes(task.view.status))throw new ServiceError('ACQUISITION_STATE','Only an unfinished task can retry a step.',409);
    if(!(step==='preview'?needsPreview(task.view.plan):needsStructure(task.view.plan))||!['failed','partial'].includes(task.view[step].status))
      throw new ServiceError('ACQUISITION_STATE','This step does not need retrying.',409);
    return this.launch(task,step);
  }
  async loadStructure(projectId:string,id:string,limits:unknown):Promise<AcquisitionView> {
    const task=this.task(projectId,id),parsed=CaptureLimitsSchema.parse(limits);
    if(task.view.plan!=='overview'||task.view.status!=='ready'||!task.preview)
      throw new ServiceError('ACQUISITION_STATE','Load structure from a completed overview-only observation.',409);
    this.checkSession(task.view.sessionId);
    if(this.activeId)throw new ServiceError('ACQUISITION_BUSY','Another acquisition is still running.',409);
    task.view.plan='overview_then_structure';task.view.limits=parsed;
    return this.launch(task,'structure');
  }
  private async launch(task:Stored,retry?:'preview'|'structure'):Promise<AcquisitionView> {
    this.checkSession(task.view.sessionId);
    if(this.activeId)throw new ServiceError('ACQUISITION_BUSY','Another source acquisition is still running.',409);
    this.activeId=task.view.id;task.view.status='running';task.view.error=null;task.view.progress.elapsedMs=0;
    const controller=new AbortController(),run:Runtime={controller,started:Date.now(),done:Promise.resolve()};
    this.runs.set(task.view.id,run);
    const persisted=this.persist(task);
    run.done=persisted.then(()=>this.execute(task,run,retry)).catch(async error=>{
      task.view.status='failed';task.view.stage='done';task.view.error=failure(error);
      await this.persist(task).catch(()=>{});
    })
      .finally(()=>{this.runs.delete(task.view.id);if(this.activeId===task.view.id)this.activeId=null;});
    await persisted;
    return this.view(task);
  }
  private validateSource(task:Stored,node:{id:string;name:string;type:string;bbox:unknown;sourceFileKey:string|null;sourcePageId:string},fileKey:string|null,pageId:string):void {
    const source=task.view.source;
    if(fileKey!==source.fileKey||pageId!==source.pageId||node.sourceFileKey!==source.fileKey||node.sourcePageId!==source.pageId||node.id!==source.nodeId||node.name!==source.name||node.type!==source.type||!isDeepStrictEqual(node.bbox,source.bounds))
      throw new ServiceError('SOURCE_METADATA_CHANGED','The source identity or bounds differ from preparation. Keep this observation and prepare a new task.',409);
  }
  private finalize(task:Stored):void {
    const view=task.view;
    if(view.preview.status==='ready') {
      if(!task.preview)throw new ServiceError('INVALID_ACQUISITION','Completed image observation is unavailable.');
      this.validateSource(task,task.preview.node,task.preview.fileKey,task.preview.pageId);
    }
    if(view.structure.status==='ready'&&(!task.snapshot?.completeness.complete||!task.structureStartedAt||!task.structureFinishedAt))
      throw new ServiceError('SOURCE_INCOMPLETE','Completed structure observation is unavailable.');
    const required=[...(needsPreview(view.plan)?[view.preview]:[]),...(needsStructure(view.plan)?[view.structure]:[])];
    view.status=required.some(s=>s.status==='failed')?'failed':required.some(s=>s.status!=='ready')?'partial':'ready';
    view.warnings=[...new Set([...(task.snapshot?.warnings??[]),...(task.preview?.warnings??[])])].slice(0,99);
    if(task.preview&&task.snapshot) {
      view.warnings.push('Image and structure are separate live observations. Unchanged root metadata does not establish an immutable Figma revision.');
      const root=task.snapshot.nodes.find(n=>n.id===view.source.nodeId),imageRoot=task.preview.node;
      if(!root||root.parentId!==imageRoot.parentId||root.visible!==imageRoot.visible||root.text!==imageRoot.text||root.rendering?.opacity!==imageRoot.rendering?.opacity)
        throw new ServiceError('SOURCE_METADATA_CHANGED','Root metadata differs between image and structure observations. Prepare a new task instead of combining changed sources.',409);
    }
  }
  private async execute(task:Stored,run:Runtime,retry?:'preview'|'structure'):Promise<void> {
    const view=task.view,source=view.source;
    const check=()=>{if(run.controller.signal.aborted)throw new ServiceError('CANCELLED','Acquisition cancelled.',499);this.checkSession(view.sessionId);};
    const steps:('preview'|'structure')[]=retry?[retry]:view.plan==='overview'?['preview']:view.plan==='structure'?['structure']:
      view.plan==='structure_then_overview'?['structure','preview']:['preview','structure'];
    try {
      for(const step of steps) {
        check();view.stage=step;view[step].status='running';view[step].error=null;await this.persist(task);
        try {
          const commandSource={fileKey:source.fileKey,pageId:source.pageId,nodeId:source.nodeId};
          if(step==='preview') {
            const result=NodePreviewResultSchema.parse(await this.broker.request({type:'preview_capture',...commandSource,...(view.overview?{options:view.overview}:{})},
              {signal:run.controller.signal,timeoutMs:this.options.requestTimeoutMs??(view.overview?.maxDurationMs??55000)+5000}));
            check();this.validateSource(task,result.node,result.fileKey,result.pageId);
            task.preview=result;view.preview={status:'ready',observedAt:result.observedAt,error:null};
          } else {
            task.structureStartedAt=new Date().toISOString();task.snapshot=null;view.progress.nodes=0;view.progress.bytes=0;
            const result=SnapshotSchema.parse(await this.broker.request({type:'capture_metadata',...commandSource,limits:view.limits},
              {signal:run.controller.signal,timeoutMs:this.options.requestTimeoutMs??20000,onProgress:progress=>{
                if(run.controller.signal.aborted)return;
                view.progress.nodes=Math.max(view.progress.nodes,progress.nodes);view.progress.bytes=Math.max(view.progress.bytes,progress.bytes);
              }}));
            check();
            const root=result.nodes.find(n=>n.id===source.nodeId);
            if(!root||result.source.rootId!==source.nodeId||!isDeepStrictEqual(result.bounds,source.bounds)||result.preview!==null)
              throw new ServiceError('INVALID_ACQUISITION','Structure result does not match the requested root.',502);
            this.validateSource(task,root,result.source.fileKey,result.source.pageId);
            const bytes=Buffer.byteLength(JSON.stringify(result.nodes));
            if(result.nodes.length>view.limits.maxNodes||bytes>view.limits.maxBytes)throw new ServiceError('INVALID_ACQUISITION','Structure exceeded the agreed node/byte budget.',502);
            const project=await this.store.get(view.projectId);check();
            validateProject({...project,snapshots:[...project.snapshots,result]});
            task.snapshot=result;task.structureFinishedAt=new Date().toISOString();
            view.progress.nodes=result.nodes.length;view.progress.bytes=bytes;
            view.structure={status:result.completeness.complete?'ready':'partial',complete:result.completeness.complete,reason:result.completeness.reason,error:null};
            view.warnings=[...new Set(result.warnings)].slice(0,98);
          }
        } catch(error) {
          if(run.controller.signal.aborted)throw error;
          view[step].status='failed';view[step].error=failure(error);view.error=failure(error);
          if(step==='structure')view.structure.complete=false;
        }
        check();if(step!==steps.at(-1))await this.persist(task);
      }
      check();
      this.finalize(task);
    } catch(error) {
      view.status=run.controller.signal.aborted?'cancelled':'failed';view.error=failure(error);
      for(const step of [view.preview,view.structure])if(step.status==='running'){step.status='failed';step.error=view.error;}
    } finally {
      view.stage='done';view.progress.elapsedMs=Date.now()-run.started;
      await this.persist(task);
    }
  }
  async cancel(projectId:string,id:string):Promise<AcquisitionView> {
    const task=this.task(projectId,id),run=this.runs.get(id);
    if(run&&task.view.status==='running'){task.view.status='cancel_requested';run.controller.abort();}
    else if(task.view.status==='prepared'){task.view.status='cancelled';task.view.stage='done';}
    else return this.view(task);
    await this.persist(task);return this.view(task);
  }
  async commit(projectId:string,id:string,expectedRevision:number) {
    const task=this.task(projectId,id);
    if(this.runs.has(id)||this.committing.has(id))throw new ServiceError('ACQUISITION_BUSY','Wait for the acquisition and its journal to finish saving.',409);
    this.committing.add(id);
    try {
      const project=await this.store.get(projectId);
      const existing=project.snapshots.find(s=>s.acquisition?.taskId===id);
      if(existing){task.view.status='committed';task.view.resultSnapshotId=existing.id;await this.persist(task);return project;}
      if(task.view.status!=='ready'||!needsStructure(task.view.plan)||!task.snapshot||!task.snapshot.completeness.complete)
        throw new ServiceError('SOURCE_INCOMPLETE','The requested structure and required image must be complete before saving this capture.',409);
      if(!task.structureStartedAt||!task.structureFinishedAt)throw new ServiceError('INVALID_ACQUISITION','Structure observation times are unavailable.');
      const snapshot:Snapshot={...task.snapshot,preview:task.preview?.preview??null,warnings:task.view.warnings,
        acquisition:{taskId:id,structureStartedAt:task.structureStartedAt,structureFinishedAt:task.structureFinishedAt,
          previewObservedAt:task.preview?.observedAt??null,consistency:'separate-observations'}};
      const updated=await this.store.mutate(projectId,expectedRevision,{type:'add_snapshot',snapshot},'human');
      task.view.status='committed';task.view.resultSnapshotId=snapshot.id;await this.persist(task);return updated;
    } finally {this.committing.delete(id);}
  }
  async remove(projectId:string,id:string):Promise<void> {
    const task=this.task(projectId,id);
    if(this.runs.has(id)||this.committing.has(id))throw new ServiceError('ACQUISITION_BUSY','Wait for the task to stop before removing it.',409);
    this.removing.add(id);
    try {
      await this.persistence.catch(()=>{});await rm(join(this.directory,id+'.json'),{force:true});
      this.tasks.delete(task.view.id);this.sizes.delete(id);
    } finally {this.removing.delete(id);}
  }
  async close():Promise<void> {
    this.closed=true;for(const run of this.runs.values())run.controller.abort();
    await Promise.allSettled([...this.runs.values()].map(run=>run.done));await this.persistence.catch(()=>{});
  }
}
