import { constants } from 'node:fs';
import { mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AnnotationSchema, ProjectSchema, ProposalSchema, SpecificationSchema, type Operation, type Project } from '../shared/contracts.js';
import { applyOperation, createProject, validateProject, type OperationContext } from '../core/index.js';
import { validatePreview } from './preview.js';
import { ServiceError } from './errors.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PROJECT_BYTES=48_000_000;
const MAX_HISTORY=20;
const StateSchema=z.object({name:z.string().min(1).max(300),annotations:z.array(AnnotationSchema).max(2000),specifications:z.array(SpecificationSchema).max(2000),proposals:z.array(ProposalSchema).max(100)}).strict();
type HistoryState=z.infer<typeof StateSchema>;
const EnvelopeSchema=z.object({project:ProjectSchema,past:z.array(StateSchema).max(MAX_HISTORY),future:z.array(StateSchema).max(MAX_HISTORY)}).strict();
type Envelope=z.infer<typeof EnvelopeSchema>;
const state=(p:Project):HistoryState=>({name:p.name,annotations:p.annotations,specifications:p.specifications,proposals:p.proposals});

/** Atomic local JSON store. History retains annotation state, not copies of preview images. */
export class ProjectStore {
  private queues=new Map<string,Promise<void>>();
  private prepareEvidence:((project:Project,operation:Operation)=>Promise<Partial<OperationContext>>)|undefined;
  setEvidenceResolver(resolve:(project:Project,operation:Operation)=>Promise<Partial<OperationContext>>):void{this.prepareEvidence=resolve;}
  constructor(readonly dataDir:string) {}
  async initialize():Promise<void> {
    await mkdir(this.dataDir,{recursive:true,mode:0o700});
    await mkdir(join(this.dataDir,'projects'),{recursive:true,mode:0o700});
  }
  private path(id:string):string {
    if(!UUID.test(id))throw new ServiceError('NOT_FOUND','Project not found.',404);
    return join(this.dataDir,'projects',id+'.json');
  }
  private async read(id:string):Promise<Envelope> {
    const path=this.path(id);
    let file;
    try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')throw new ServiceError('NOT_FOUND','Project not found.',404);
      throw new ServiceError('STORAGE_ERROR','Project cannot be read.',500);
    }
    try {
      const info=await file.stat();
      if(!info.isFile()||info.size>MAX_PROJECT_BYTES)throw new ServiceError('STORAGE_LIMIT','Stored project exceeds size limits.',413);
      const envelope=EnvelopeSchema.parse(JSON.parse(await file.readFile('utf8')));
      if(envelope.project.id!==id)throw new ServiceError('INVALID_PROJECT','Stored project identity does not match its file.',500);
      envelope.project=validateProject(envelope.project);
      for(const snapshot of [...envelope.project.snapshots,...envelope.project.scopes??[]])validatePreview(snapshot);
      return envelope;
    } finally {await file.close();}
  }
  private async write(envelope:Envelope):Promise<void> {
    const path=this.path(envelope.project.id);
    const encoded=JSON.stringify(envelope);
    if(Buffer.byteLength(encoded)>MAX_PROJECT_BYTES)throw new ServiceError('STORAGE_LIMIT','Project and history exceed the 48 MB storage budget.',413);
    const temporary=path+'.'+randomUUID()+'.tmp';
    const file=await open(temporary,'wx',0o600);
    try {await file.writeFile(encoded);await file.sync();} finally {await file.close();}
    try {await rename(temporary,path);} catch(error){await unlink(temporary).catch(()=>{});throw error;}
  }
  private async exclusive<T>(id:string,work:()=>Promise<T>):Promise<T> {
    this.path(id);
    const previous=this.queues.get(id)??Promise.resolve();
    let release!:()=>void;
    const next=new Promise<void>(resolve=>{release=resolve;});
    this.queues.set(id,next);
    await previous;
    // Filesystem lock prevents separate local processes from losing updates too.
    const lockPath=this.path(id)+'.lock';
    let lock;
    try {
      try {lock=await open(lockPath,'wx',0o600);}catch(error){
        if((error as NodeJS.ErrnoException).code==='EEXIST')throw new ServiceError('STORAGE_BUSY','Project is locked by another write. Retry; after a crash inspect the local lock file.',409);
        throw error;
      }
      return await work();
    } finally {
      if(lock){await lock.close();await unlink(lockPath).catch(()=>{});}
      release();if(this.queues.get(id)===next)this.queues.delete(id);
    }
  }
  async create(name:string):Promise<Project> {
    return this.importProject(createProject(randomUUID(),name));
  }
  async importProject(value:Project):Promise<Project> {
    if(value.scopes?.length)throw new ServiceError('SOURCE_RESOLUTION_REQUIRED','Import backed source scopes through the verified source-transfer workflow.',409);
    const project=validateProject({...value,id:randomUUID()});
    for(const snapshot of project.snapshots)validatePreview(snapshot);
    await this.exclusive(project.id,()=>this.write({project,past:[],future:[]}));
    return structuredClone(project);
  }
  async get(id:string):Promise<Project> {return (await this.read(id)).project;}
  async list() {
    const files=(await readdir(join(this.dataDir,'projects'))).filter(name=>UUID.test(name.replace(/\.json$/,''))&&name.endsWith('.json'));
    if(files.length>1000)throw new ServiceError('STORAGE_LIMIT','Project listing exceeds 1,000 projects.',413);
    const summaries=[];
    for(const name of files){
      const p=await this.get(name.slice(0,-5));
      summaries.push({id:p.id,name:p.name,revision:p.revision,updatedAt:p.updatedAt,snapshotCount:p.snapshots.length+(p.scopes?.length??0),annotationCount:p.annotations.length,specificationCount:p.specifications.length});
    }
    return summaries.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
  }
  async mutate(id:string,expectedRevision:number,operation:Operation,actor:'human'|'ai'='human',evidenceWrite=false,signal?:AbortSignal):Promise<Project> {
    if(!evidenceWrite&&(operation.type==='add_evidence_scope'||operation.type==='attach_scope_collection'))throw new ServiceError('FORBIDDEN','Use a verified source attachment route.',403);
    const active=()=>{if(signal?.aborted)throw new ServiceError('CANCELLED','Workspace mutation cancelled before its atomic commit.',499);};
    return this.exclusive(id,async()=>{
      active();
      const envelope=await this.read(id);
      this.checkRevision(envelope.project,expectedRevision);
      const evidence=this.prepareEvidence?await this.prepareEvidence(envelope.project,operation):{};
      active();
      const project=applyOperation(envelope.project,operation,{...evidence,actor,evidenceWrite});
      for(const snapshot of [...project.snapshots,...project.scopes??[]])validatePreview(snapshot);
      // Captures remain cached sources even when annotation edits are undone.
      if(operation.type!=='add_snapshot')envelope.past=[...envelope.past,state(envelope.project)].slice(-MAX_HISTORY);
      envelope.future=[];envelope.project=project;
      // Once the atomic write begins it may commit despite a later disconnect;
      // callers must reload rather than claim that such a commit was cancelled.
      active();
      await this.write(envelope);return structuredClone(project);
    });
  }
  async history(id:string,expectedRevision:number,direction:'undo'|'redo'):Promise<Project> {
    return this.exclusive(id,async()=>{
      const envelope=await this.read(id);this.checkRevision(envelope.project,expectedRevision);
      const source=direction==='undo'?envelope.past:envelope.future;
      const target=direction==='undo'?envelope.future:envelope.past;
      const prior=source.pop();if(!prior)throw new ServiceError('NO_HISTORY',`Nothing to ${direction}.`,409);
      target.push(state(envelope.project));if(target.length>MAX_HISTORY)target.shift();
      // Revisions stay monotonic; stale HTTP/MCP writers cannot use a historical version.
      const restored=validateProject({...envelope.project,...prior,revision:envelope.project.revision+1,updatedAt:new Date().toISOString()});
      // History restores semantic approvals, so it must resolve their current
      // immutable backing under the same lock as an ordinary edit. Preparing a
      // neutral name operation validates evidence without reapplying any edit.
      const evidence=this.prepareEvidence?await this.prepareEvidence(restored,{type:'rename_project',name:restored.name}):{};
      if(restored.scopes?.some(scope=>scope.kind==='collection')&&!evidence.sources)
        throw new ServiceError('SOURCE_RESOLUTION_REQUIRED','Resolve bound source collections before restoring workspace history.',409);
      envelope.project=validateProject(restored,evidence.sources);
      await this.write(envelope);return structuredClone(envelope.project);
    });
  }
  private checkRevision(project:Project,expected:number):void {
    if(!Number.isInteger(expected)||expected<0)throw new ServiceError('INVALID_REVISION','Expected revision must be a nonnegative integer.');
    if(project.revision!==expected)throw new ServiceError('REVISION_CONFLICT','Project changed; reload before applying this edit.',409);
  }
}
