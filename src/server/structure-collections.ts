import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { SelectionSchema } from '../shared/contracts.js';
import { StructureChunkSchema, type CollectionView } from '../shared/structure-collection.js';
import { CollectionStore } from './structure-collection-store.js';
import { PluginBroker } from './broker.js';
import { ProjectStore } from './store.js';
import { ServiceError } from './errors.js';
import { SelectiveAcquisition } from './selective-acquisition.js';
import { defaultImportSettings, type ImportSettings } from '../shared/import-settings.js';
import type { AcquisitionView } from '../shared/acquisition.js';

type Run={controller:AbortController;started:number;elapsed:number;pause:boolean;done:Promise<void>};
/** Durable raw source collection. Never converts a large prefix into a Snapshot. */
export class StructureCollections {
  readonly store:CollectionStore;
  private readonly runs=new Map<string,Run>();
  private readonly removals=new Set<string>();
  private cursorOwner:{projectId:string;id:string;sessionId:string}|null=null;
  private closed=false;
  constructor(dataDir:string,private readonly projects:ProjectStore,private readonly broker:PluginBroker,
    private readonly options:{requestTimeoutMs?:number;runDurationMs?:number;settings?:()=>ImportSettings;
      overview?:(task:CollectionView,signal:AbortSignal)=>Promise<void>}={}){this.store=new CollectionStore(dataDir);}
  initialize(){return this.store.initialize();}
  private session(id:string){
    if(this.closed)throw new ServiceError('SERVER_CLOSED','Collection service is stopping.',503);
    if(!this.broker.status.connected)throw new ServiceError('PLUGIN_DISCONNECTED','Connect Figma to acquire source.',503);
    if(this.broker.status.sessionId!==id)throw new ServiceError('PLUGIN_SESSION_CHANGED','The source session changed. Prepare a new collection.',409);
  }
  private view(value:CollectionView):CollectionView {
    const run=this.runs.get(value.id);
    if(run){value={...value,elapsedMs:run.elapsed+Date.now()-run.started,pauseRequested:run.pause};
      // Expose completion only after the final journal and cursor cleanup settle.
      if(value.status!=='running')value.status='running';}
    return value;
  }
  list(projectId:string){return this.store.list(projectId).map(value=>this.view(value));}
  get(projectId:string,id:string){return this.view(this.store.get(projectId,id));}
  async preparePinned(image:AcquisitionView,signal?:AbortSignal){
    this.session(image.sessionId);
    if(signal?.aborted)throw new ServiceError('CANCELLED','Source preparation cancelled.',499);
    if(this.runs.size)throw new ServiceError('COLLECTION_BUSY','Another structure collection is running.',409);
    if((await this.projects.get(image.projectId)).revision!==image.baseRevision)throw new ServiceError('REVISION_CONFLICT','Workspace changed during preparation.',409);
    this.session(image.sessionId);
    if(signal?.aborted)throw new ServiceError('CANCELLED','Source preparation cancelled.',499);
    return this.store.create({id:randomUUID(),projectId:image.projectId,sessionId:image.sessionId,
      source:structuredClone(image.source),overviewAcquisitionId:image.id});
  }
  async prepare(projectId:string,expectedRevision:number,sessionId:string,signal?:AbortSignal){
    this.session(sessionId);
    if(this.runs.size)throw new ServiceError('COLLECTION_BUSY','Another structure collection is running.',409);
    if((await this.projects.get(projectId)).revision!==expectedRevision)throw new ServiceError('REVISION_CONFLICT','Workspace changed. Refresh before preparing.',409);
    const selection=SelectionSchema.parse(await this.broker.request({type:'get_selection'},{...(signal?{signal}:{}),timeoutMs:this.options.requestTimeoutMs??20000}));
    const current=await this.projects.get(projectId);this.session(sessionId);
    if(signal?.aborted)throw new ServiceError('CANCELLED','Collection preparation was cancelled.',499);
    if(current.revision!==expectedRevision)throw new ServiceError('REVISION_CONFLICT','Workspace changed during preparation.',409);
    const node=selection.nodes[0];
    if(!selection.fileKey)throw new ServiceError('FILE_IDENTITY_UNAVAILABLE','The Figma source file identity is unavailable.',409);
    if(selection.nodes.length!==1||!node||!['FRAME','GROUP','COMPONENT','COMPONENT_SET','INSTANCE','SECTION'].includes(node.type)||!node.bbox||node.bbox.width<=0||node.bbox.height<=0)
      throw new ServiceError('INVALID_SELECTION','Select one container with positive bounds.');
    return this.store.create({id:randomUUID(),projectId,sessionId,source:{fileKey:selection.fileKey,pageId:selection.pageId,
      nodeId:node.id,name:node.name,type:node.type,bounds:node.bbox}});
  }
  /** Pin one explicit descendant of an inspection, without changing editor selection. */
  async prepareFromInspection(projectId:string,expectedRevision:number,sessionId:string,
    selective:SelectiveAcquisition,inspectionId:string,nodeId:string,signal?:AbortSignal){
    this.session(sessionId);
    if(this.runs.size)throw new ServiceError('COLLECTION_BUSY','Another structure collection is running.',409);
    const inspection=selective.get(projectId,inspectionId,0,1).view;
    if(inspection.sessionId!==sessionId)throw new ServiceError('PLUGIN_SESSION_CHANGED','The inspection belongs to another Figma session.',409);
    if(nodeId===inspection.source.nodeId)throw new ServiceError('INVALID_BRANCH','Choose a descendant container; the inspection root is already a selectable collection root.',409);
    if((await this.projects.get(projectId)).revision!==expectedRevision)
      throw new ServiceError('REVISION_CONFLICT','Workspace changed. Refresh before preparing.',409);
    const outcome=await selective.readNodes(projectId,inspectionId,{nodeIds:[nodeId],fields:'metadata'},signal,{fresh:true});
    this.session(sessionId);
    if(signal?.aborted)throw new ServiceError('CANCELLED','Branch preparation was cancelled.',499);
    if((await this.projects.get(projectId)).revision!==expectedRevision)
      throw new ServiceError('REVISION_CONFLICT','Workspace changed during preparation.',409);
    if(outcome.reused||outcome.view.id!==inspectionId||outcome.view.sessionId!==sessionId||
      !isDeepStrictEqual(outcome.view.source,inspection.source)||outcome.observation.kind!=='nodes')
      throw new ServiceError('SOURCE_METADATA_CHANGED','The live inspection no longer matches its prepared scope.',409);
    const result=outcome.observation.result,record=result.records[0];
    if(result.requestedIds.length!==1||result.requestedIds[0]!==nodeId||result.fields!=='metadata'||
      !record||record.node.id!==nodeId||record.fieldCoverage.text!=='not-requested'||
      result.fileKey!==inspection.source.fileKey||result.pageId!==inspection.source.pageId||
      result.scopeId!==inspection.source.nodeId||result.scope.name!==inspection.source.name||
      result.scope.type!==inspection.source.type||!isDeepStrictEqual(result.scope.bbox,inspection.source.bounds))
      throw new ServiceError('SOURCE_METADATA_CHANGED','The branch or inspection scope differs from the fresh source observation.',409);
    const node=record.node;
    if(!['FRAME','GROUP','COMPONENT','COMPONENT_SET','INSTANCE','SECTION'].includes(node.type)||
      !node.parentId||!node.bbox||node.bbox.width<=0||node.bbox.height<=0)
      throw new ServiceError('INVALID_BRANCH','Choose a descendant container with positive bounds.',409);
    return this.store.create({id:randomUUID(),projectId,sessionId,source:{fileKey:inspection.source.fileKey,
      pageId:inspection.source.pageId,nodeId:node.id,name:node.name,type:node.type,bounds:node.bbox,
      scopeId:inspection.source.nodeId,inspectionId,parentId:node.parentId}});
  }
  async start(projectId:string,id:string,resume=false){
    const task=this.store.get(projectId,id);this.session(task.sessionId);
    if(this.runs.size||this.removals.has(id))throw new ServiceError('COLLECTION_BUSY','Wait for the active source task to settle.',409);
    if(this.cursorOwner&&this.cursorOwner.id!==id&&this.cursorOwner.sessionId===task.sessionId)
      throw new ServiceError('COLLECTION_BUSY','Resume or remove the paused collection before starting another source collection.',409);
    if(task.status!==(resume?'paused':'prepared'))throw new ServiceError('COLLECTION_STATE','Start a prepared collection or resume a paused collection in the same session.',409);
    const run:Run={controller:new AbortController(),started:Date.now(),elapsed:task.elapsedMs,pause:false,done:Promise.resolve()};
    this.cursorOwner={projectId,id,sessionId:task.sessionId};
    this.runs.set(id,run);
    const first=this.store.update(projectId,id,{status:'running',error:null,pauseReason:null});
    run.done=first.then(()=>this.execute(task,run)).catch(async error=>{
      await this.store.update(projectId,id,{status:'failed',error:this.error(error)}).catch(()=>{});
      await this.release(task);
    }).finally(()=>this.runs.delete(id));
    await first;return this.get(projectId,id);
  }
  private error(error:unknown){return {code:error instanceof ServiceError?error.code:'COLLECTION_FAILED',
    message:error instanceof ServiceError?error.message.slice(0,1000):'The collection could not finish. Durable earlier chunks remain incomplete.'};}
  private async release(task:CollectionView){
    if(this.broker.status.connected&&this.broker.status.sessionId===task.sessionId){
      try{await this.broker.request({type:'release_structure_cursor',collectionId:task.id},{timeoutMs:this.options.requestTimeoutMs??5000});}
      catch{return false;}
    }
    if(this.cursorOwner?.id===task.id)this.cursorOwner=null;
    return true;
  }
  private async execute(task:CollectionView,run:Run){
    let terminal=false;
    const settings=this.options.settings?.()??defaultImportSettings();
    try{
      if(task.overviewAcquisitionId&&this.options.overview)await this.options.overview(task,run.controller.signal);
      while(true){
        if(run.controller.signal.aborted)throw new ServiceError('COLLECTION_INTERRUPTED','The server stopped this live traversal. Prepare a new collection.',409);
        this.session(task.sessionId);
        const current=this.store.get(task.projectId,task.id);
        const reason=run.pause?'user':Date.now()-run.started>=(this.options.runDurationMs??settings.runDurationMs)?'time':
          current.nodeCount>=settings.maxNodes?'nodes':current.chunkCount>0&&settings.maxBytes-current.byteCount<1_000_000?'bytes':null;
        if(reason){
          await this.store.update(task.projectId,task.id,{status:'paused',pauseReason:reason,elapsedMs:run.elapsed+Date.now()-run.started});return;
        }
        const packet=StructureChunkSchema.parse(await this.broker.request({type:'read_structure_chunk',collectionId:task.id,
          sequence:current.chunkCount,fileKey:task.source.fileKey,pageId:task.source.pageId,nodeId:task.source.nodeId,
          maxNodes:settings.maxNodes,cursorIdleMs:settings.cursorIdleMs,
          ...(task.source.scopeId?{scopeId:task.source.scopeId}:{})},
          {signal:run.controller.signal,timeoutMs:this.options.requestTimeoutMs??settings.requestTimeoutMs}));
        this.session(task.sessionId);
        if(run.controller.signal.aborted)throw new ServiceError('COLLECTION_INTERRUPTED','Collection was interrupted before storing the chunk.',409);
        const next=await this.store.append(task.projectId,task.id,packet);
        await this.store.update(task.projectId,task.id,{elapsedMs:run.elapsed+Date.now()-run.started});
        if(next.status==='complete'){terminal=true;return;}
      }
    }catch(error){
      const retryable=error instanceof ServiceError&&['PLUGIN_TIMEOUT','PLUGIN_BUSY'].includes(error.code)&&!run.controller.signal.aborted&&
        this.broker.status.connected&&this.broker.status.sessionId===task.sessionId;
      terminal=!retryable;
      await this.store.update(task.projectId,task.id,{status:retryable?'paused':'interrupted',pauseReason:retryable?'busy':null,elapsedMs:run.elapsed+Date.now()-run.started,error:this.error(error)});
    }finally{if(terminal)await this.release(task);}
  }
  async stop(projectId:string,id:string){
    const task=this.store.get(projectId,id),run=this.runs.get(id);
    if(run)run.pause=true;
    else if(task.status==='prepared')await this.store.update(projectId,id,{status:'cancelled'});
    return this.get(projectId,id);
  }
  async remove(projectId:string,id:string){
    const task=this.store.get(projectId,id);
    if((await this.projects.get(projectId)).scopes?.some(scope=>scope.collection?.id===id))
      throw new ServiceError('COLLECTION_IN_USE','This collection is attached to an editor scope and cannot be removed.',409);
    if(this.runs.has(id)||this.removals.has(id))throw new ServiceError('COLLECTION_BUSY','Wait for this collection to stop before removing it.',409);
    this.removals.add(id);
    try{
      if(!await this.release(task))throw new ServiceError('CURSOR_RELEASE_FAILED','Figma did not acknowledge releasing this collection. Keep it and retry removal, or reconnect the plugin.',409);
      await this.store.remove(projectId,id,async()=>{
        if((await this.projects.get(projectId)).scopes?.some(scope=>scope.collection?.id===id))
          throw new ServiceError('COLLECTION_IN_USE','This collection was attached to an editor scope before removal completed.',409);
      });
    }finally{this.removals.delete(id);}
  }
  async close(){
    this.closed=true;for(const run of this.runs.values())run.controller.abort();
    await Promise.allSettled([...this.runs.values()].map(run=>run.done));
  }
}
