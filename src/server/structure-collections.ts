import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { SelectionSchema, type PluginCommand } from '../shared/contracts.js';
import { StructureChunkSchema, type CollectionView } from '../shared/structure-collection.js';
import { CollectionStore } from './structure-collection-store.js';
import { PluginBroker } from './broker.js';
import { ProjectStore } from './store.js';
import { ServiceError } from './errors.js';
import { SelectiveAcquisition } from './selective-acquisition.js';
import { defaultImportSettings, type ImportSettings } from '../shared/import-settings.js';
import type { AcquisitionView } from '../shared/acquisition.js';
import { SelectiveNodesResultSchema } from '../shared/selective-source-results.js';
import { StructureReplayResultSchema, restoreReplayedStructureChunk, structureChunkContentHash } from '../shared/structure-replay.js';

type Run={controller:AbortController;started:number;elapsed:number;pause:boolean;done:Promise<void>};
/** Durable raw source collection. Never converts a large prefix into a Snapshot. */
export class StructureCollections {
  readonly store:CollectionStore;
  private readonly runs=new Map<string,Run>();
  private readonly removals=new Set<string>();
  private cursorOwner:{projectId:string;id:string;sessionId:string}|null=null;
  private preparing=false;
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
    if(this.preparing||this.runs.size)throw new ServiceError('COLLECTION_BUSY','Another structure collection is running or preparing.',409);
    if((await this.projects.get(image.projectId)).revision!==image.baseRevision)throw new ServiceError('REVISION_CONFLICT','Workspace changed during preparation.',409);
    this.session(image.sessionId);
    if(signal?.aborted)throw new ServiceError('CANCELLED','Source preparation cancelled.',499);
    return this.store.create({id:randomUUID(),projectId:image.projectId,sessionId:image.sessionId,
      source:structuredClone(image.source),overviewAcquisitionId:image.id});
  }
  async prepare(projectId:string,expectedRevision:number,sessionId:string,signal?:AbortSignal){
    this.session(sessionId);
    if(this.preparing||this.runs.size)throw new ServiceError('COLLECTION_BUSY','Another structure collection is running or preparing.',409);
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
    if(this.preparing||this.runs.size)throw new ServiceError('COLLECTION_BUSY','Another structure collection is running or preparing.',409);
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
    if(this.preparing)throw new ServiceError('COLLECTION_BUSY','Wait for source preparation to finish.',409);
    return this.startPrepared(projectId,id,resume);
  }
  private async startPrepared(projectId:string,id:string,resume=false){
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
  continuePlan(projectId:string,id:string){
    const task=this.get(projectId,id);
    if(task.status==='running'||task.status==='complete')throw new ServiceError('COLLECTION_STATE','This import does not need to continue.',409);
    const resume=task.status==='paused'&&task.sessionId===this.broker.status.sessionId&&this.broker.status.connected&&this.cursorOwner?.id===id;
    return {kind:resume?'resume' as const:'revalidate' as const,requiresConfirmation:!resume,savedNodes:task.nodeCount,
      reason:resume?'Continue from the next saved position.':'The reading position is no longer available. Continuing checks the selected source again, including saved nodes. Saved images and earlier work remain available.'};
  }
  private async preparation<T>(work:()=>Promise<T>):Promise<T>{
    if(this.preparing||this.runs.size)throw new ServiceError('COLLECTION_BUSY','Wait for the active source task to settle.',409);
    this.preparing=true;
    try{return await work();}finally{this.preparing=false;}
  }
  /** A local cost plan; no Figma traversal and no cursor release. */
  async partPlan(projectId:string,id:string,nodeId:string){
    const parent=this.get(projectId,id);
    if(this.runs.size||this.preparing||this.removals.has(id))throw new ServiceError('COLLECTION_BUSY','Pause the active source task before reading a part.',409);
    if(nodeId===parent.source.nodeId)throw new ServiceError('INVALID_BRANCH','Continue the whole source task to read its root.',409);
    const page=await this.store.evidence(projectId,id,{nodeIds:[nodeId],offset:0,limit:1});
    const node=page.nodes[0];
    if(!node||node.id!==nodeId||!['FRAME','GROUP','COMPONENT','COMPONENT_SET','INSTANCE','SECTION'].includes(node.type)||
      !node.bbox||node.bbox.width<=0||node.bbox.height<=0)
      throw new ServiceError('INVALID_BRANCH','Choose a saved container with positive bounds.',409);
    if(node.subtreeComplete)throw new ServiceError('BRANCH_ALREADY_COMPLETE','This saved part already has complete source coverage.',409);
    const owner=this.cursorOwner?.sessionId===this.broker.status.sessionId&&this.broker.status.connected?this.cursorOwner:null;
    const paused=owner?this.store.get(owner.projectId,owner.id):null;
    return {kind:'part' as const,nodeId,requiresConfirmation:paused!==null,releasesPausedTaskId:paused?.id??null,
      savedNodes:paused?.nodeCount??parent.nodeCount,
      reason:paused
        ?'Reading this part releases the paused reading position. Saved data remains available, but continuing that broader import later will recheck its source.'
        :'Read this saved part and its descendants only. The enclosing import remains incomplete and its saved image is retained.'};
  }
  async part(projectId:string,id:string,input:{nodeId:string;expectedRevision:number;expectedSessionId:string;confirmRevalidation:boolean},signal?:AbortSignal){
    this.session(input.expectedSessionId);
    const plan=await this.partPlan(projectId,id,input.nodeId);
    if(plan.requiresConfirmation&&!input.confirmRevalidation)
      throw new ServiceError('RECOVERY_CONFIRMATION_REQUIRED','Confirm that reading this part may require rechecking the paused broader import later.',409);
    return this.preparation(()=>this.store.usingEvidence(projectId,id,async()=>{
      if(this.removals.has(id))throw new ServiceError('COLLECTION_BUSY','The source task is being removed.',409);
      const parent=this.store.get(projectId,id);
      if((await this.projects.get(projectId)).revision!==input.expectedRevision)
        throw new ServiceError('REVISION_CONFLICT','Reload before reading this source part.',409);
      const scopeId=parent.source.scopeId??parent.source.nodeId;
      // Verify the original enclosing scope, not the person's current selection.
      const fresh=SelectiveNodesResultSchema.parse(await this.broker.request({type:'read_source_nodes',fileKey:parent.source.fileKey,
        pageId:parent.source.pageId,scopeId,nodeIds:[input.nodeId],fields:'metadata'},
        {...(signal?{signal}:{}),timeoutMs:this.options.requestTimeoutMs??20000}));
      this.session(input.expectedSessionId);
      if(signal?.aborted)throw new ServiceError('CANCELLED','Source-part preparation cancelled.',499);
      if((await this.projects.get(projectId)).revision!==input.expectedRevision)
        throw new ServiceError('REVISION_CONFLICT','Workspace changed during source-part preparation.',409);
      const node=fresh.records[0]?.node;
      if(fresh.fileKey!==parent.source.fileKey||fresh.pageId!==parent.source.pageId||fresh.scopeId!==scopeId||
        fresh.fields!=='metadata'||fresh.records.length!==1||node?.id!==input.nodeId||!node.parentId||
        !['FRAME','GROUP','COMPONENT','COMPONENT_SET','INSTANCE','SECTION'].includes(node.type)||!node.bbox||node.bbox.width<=0||node.bbox.height<=0)
        throw new ServiceError('SOURCE_METADATA_CHANGED','This source part is no longer available inside its original source scope.',409);
      // Re-evaluate ownership after the fresh read. A consent-free request must
      // never discard a reading position that appeared after its initial plan.
      const owner=this.cursorOwner?.sessionId===input.expectedSessionId?this.cursorOwner:null;
      if(owner&&!input.confirmRevalidation)throw new ServiceError('RECOVERY_CONFIRMATION_REQUIRED','Confirm releasing the paused reading position before reading this part.',409);
      if(owner){
        const paused=this.store.get(owner.projectId,owner.id);
        if(!await this.release(paused))throw new ServiceError('CURSOR_RELEASE_FAILED','The paused reading position could not be released. Keep it and try again.',409);
        if(paused.status==='paused')await this.store.update(owner.projectId,owner.id,{status:'interrupted',pauseReason:null,
          error:{code:'CURSOR_RELEASED_FOR_PART',message:'The saved reading position was released to read a chosen part. Saved evidence remains available; continuing the broader import rechecks its source.'}});
      }
      const partOf={collectionId:id,contextCollectionId:parent.partOf?.contextCollectionId??id,
        contextRootId:parent.partOf?.contextRootId??parent.source.nodeId,contextBounds:parent.partOf?.contextBounds??parent.source.bounds};
      const next=await this.store.create({id:randomUUID(),projectId,sessionId:input.expectedSessionId,
        source:{fileKey:parent.source.fileKey,pageId:parent.source.pageId,nodeId:node.id,name:node.name,type:node.type,bounds:node.bbox,
          scopeId,parentId:node.parentId},partOf,...(parent.overviewAcquisitionId?{overviewAcquisitionId:parent.overviewAcquisitionId}:{})});
      return this.startPrepared(projectId,next.id);
    }));
  }
  async continue(projectId:string,id:string,input:{expectedRevision:number;expectedSessionId:string;confirmRevalidation:boolean},signal?:AbortSignal){
    this.session(input.expectedSessionId);
    const project=await this.projects.get(projectId);
    if(project.revision!==input.expectedRevision)throw new ServiceError('REVISION_CONFLICT','Reload before continuing this import.',409);
    const plan=this.continuePlan(projectId,id),previous=this.store.get(projectId,id);
    if(plan.kind==='resume')return this.start(projectId,id,true);
    if(!input.confirmRevalidation)throw new ServiceError('RECOVERY_CONFIRMATION_REQUIRED','Confirm the source recheck before continuing. Existing saved records and edits will be preserved.',409);
    if(this.runs.size||this.preparing||this.removals.has(id))throw new ServiceError('COLLECTION_BUSY','Wait for the active source task to settle.',409);
    return this.preparation(()=>this.store.usingEvidence(projectId,id,async()=>{
      const scopeId=previous.source.scopeId??previous.source.nodeId;
      // A lost cursor cannot be resurrected. Validate the pinned identity, then
      // start a separate generation. Reading the current selection would silently
      // change the original task when the person has selected another layer.
      if(this.cursorOwner?.sessionId===input.expectedSessionId){
        if(this.cursorOwner.id!==id)throw new ServiceError('COLLECTION_BUSY','A different paused task still owns its reading position. Continue that task first.',409);
        if(!await this.release(this.store.get(this.cursorOwner.projectId,this.cursorOwner.id)))
          throw new ServiceError('CURSOR_RELEASE_FAILED','The previous read is still stopping. Continue after it settles.',409);
      }
      const fresh=SelectiveNodesResultSchema.parse(await this.broker.request({type:'read_source_nodes',fileKey:previous.source.fileKey,
        pageId:previous.source.pageId,scopeId,nodeIds:[previous.source.nodeId],fields:'metadata'},
        {...(signal?{signal}:{}),timeoutMs:this.options.requestTimeoutMs??20000}));
      this.session(input.expectedSessionId);
      if(signal?.aborted)throw new ServiceError('CANCELLED','Source recovery cancelled.',499);
      if((await this.projects.get(projectId)).revision!==input.expectedRevision)throw new ServiceError('REVISION_CONFLICT','Workspace changed during recovery preparation.',409);
      const root=fresh.records[0]?.node;
      if(fresh.fileKey!==previous.source.fileKey||fresh.pageId!==previous.source.pageId||fresh.scopeId!==scopeId||
        fresh.fields!=='metadata'||fresh.records.length!==1||root?.id!==previous.source.nodeId||(previous.source.scopeId&&!root.parentId)||
        !root.bbox||root.bbox.width<=0||root.bbox.height<=0)
        throw new ServiceError('SOURCE_METADATA_CHANGED','The requested source is no longer available at its recorded identity.',409);
      const sameBounds=isDeepStrictEqual(root.bbox,previous.source.bounds);
      const next=await this.store.create({id:randomUUID(),projectId,sessionId:input.expectedSessionId,
        source:{fileKey:previous.source.fileKey,pageId:previous.source.pageId,nodeId:root.id,name:root.name,type:root.type,bounds:root.bbox,
          ...(previous.source.scopeId?{scopeId:previous.source.scopeId,parentId:root.parentId!}:{}),
          ...(previous.source.inspectionId?{inspectionId:previous.source.inspectionId}:{})},
        ...((sameBounds||previous.partOf)&&previous.overviewAcquisitionId?{overviewAcquisitionId:previous.overviewAcquisitionId}:{}),
        ...(previous.partOf?{partOf:previous.partOf}:{}),
        recovery:{previousCollectionId:id,originalCollectionId:previous.recovery?.originalCollectionId??id,revalidatedNodes:0,reusedPackets:0}});
      return this.startPrepared(projectId,next.id);
    }));
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
  /** A busy rejection did not acquire source. Retry it once inside this packet's
   * original deadline; a timeout has already spent that budget and is not retried. */
  private async readPacket(command:Extract<PluginCommand,{type:'read_structure_chunk'}>,task:CollectionView,run:Run,
    timeoutMs:number,runDurationMs:number):Promise<unknown>{
    const deadline=Date.now()+timeoutMs;
    try{return await this.broker.request(command,{signal:run.controller.signal,timeoutMs});}
    catch(error){
      const remaining=()=>Math.min(deadline-Date.now(),run.started+runDurationMs-Date.now());
      if(!(error instanceof ServiceError)||error.code!=='PLUGIN_BUSY'||run.pause||run.controller.signal.aborted||
        !this.broker.status.connected||this.broker.status.sessionId!==task.sessionId||remaining()<=250)throw error;
      try{await delay(250,undefined,{signal:run.controller.signal});}
      catch{throw new ServiceError('COLLECTION_INTERRUPTED','Source reading stopped before a retry.',409);}
      this.session(task.sessionId);
      if(run.pause||remaining()<=0)throw error;
      return this.broker.request(command,{signal:run.controller.signal,timeoutMs:Math.max(1,Math.floor(remaining()))});
    }
  }
  private async execute(task:CollectionView,run:Run){
    let terminal=false;
    const settings=this.options.settings?.()??defaultImportSettings();
    try{
      if(task.overviewAcquisitionId&&!task.recovery&&!task.partOf&&this.options.overview)await this.options.overview(task,run.controller.signal);
      while(true){
        if(run.controller.signal.aborted)throw new ServiceError('COLLECTION_INTERRUPTED','The server stopped this live traversal. Prepare a new collection.',409);
        this.session(task.sessionId);
        const current=this.store.get(task.projectId,task.id);
        const reason=run.pause?'user':Date.now()-run.started>=(this.options.runDurationMs??settings.runDurationMs)?'time':
          current.nodeCount>=settings.maxNodes?'nodes':current.chunkCount>0&&settings.maxBytes-current.byteCount<1_000_000?'bytes':null;
        if(reason){
          await this.store.update(task.projectId,task.id,{status:'paused',pauseReason:reason,elapsedMs:run.elapsed+Date.now()-run.started});return;
        }
        const previous=task.recovery?await this.store.savedChunk(task.projectId,task.recovery.previousCollectionId,current.chunkCount):null;
        const result=await this.readPacket({type:'read_structure_chunk',collectionId:task.id,
          sequence:current.chunkCount,fileKey:task.source.fileKey,pageId:task.source.pageId,nodeId:task.source.nodeId,
          maxNodes:settings.maxNodes,cursorIdleMs:settings.cursorIdleMs,
          ...(previous?{replay:{nodeCount:previous.nodes.length,contentHash:structureChunkContentHash(previous)}}:{}),
          ...(task.source.scopeId?{scopeId:task.source.scopeId}:{})},
          task,run,this.options.requestTimeoutMs??settings.requestTimeoutMs,this.options.runDurationMs??settings.runDurationMs);
        const receipt=StructureReplayResultSchema.safeParse(result);
        if(receipt.success&&!previous)throw new ServiceError('INVALID_PLUGIN_RESPONSE','Unexpected source reuse receipt.',502);
        const packet=StructureChunkSchema.parse(receipt.success?restoreReplayedStructureChunk(previous!,receipt.data):result);
        this.session(task.sessionId);
        if(run.controller.signal.aborted)throw new ServiceError('COLLECTION_INTERRUPTED','Collection was interrupted before storing the chunk.',409);
        const next=await this.store.append(task.projectId,task.id,packet);
        await this.store.update(task.projectId,task.id,{elapsedMs:run.elapsed+Date.now()-run.started,
          ...(current.recovery?{recovery:{...current.recovery,revalidatedNodes:current.recovery.revalidatedNodes+(previous?packet.nodes.length:0),
            reusedPackets:current.recovery.reusedPackets+(receipt.success?1:0)}}:{})});
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
    if((await this.projects.get(projectId)).scopes?.some(scope=>scope.collection?.id===id||scope.branch?.collectionId===id))
      throw new ServiceError('COLLECTION_IN_USE','This collection is attached to an editor scope and cannot be removed.',409);
    const ensureNoDependents=()=>{
      if(this.store.list(projectId).some(value=>value.partOf?.collectionId===id||value.partOf?.contextCollectionId===id||
        value.recovery?.previousCollectionId===id&&['prepared','paused','running'].includes(value.status)))
        throw new ServiceError('COLLECTION_IN_USE','A source part or unfinished recovery still uses these saved records.',409);
    };
    ensureNoDependents();
    if(this.runs.has(id)||this.removals.has(id))throw new ServiceError('COLLECTION_BUSY','Wait for this collection to stop before removing it.',409);
    this.removals.add(id);
    try{
      if(!await this.release(task))throw new ServiceError('CURSOR_RELEASE_FAILED','Figma did not acknowledge releasing this collection. Keep it and retry removal, or reconnect the plugin.',409);
      await this.store.remove(projectId,id,async()=>{
        ensureNoDependents();
        if((await this.projects.get(projectId)).scopes?.some(scope=>scope.collection?.id===id||scope.branch?.collectionId===id))
          throw new ServiceError('COLLECTION_IN_USE','This collection was attached to an editor scope before removal completed.',409);
      });
    }finally{this.removals.delete(id);}
  }
  async close(){
    this.closed=true;for(const run of this.runs.values())run.controller.abort();
    await Promise.allSettled([...this.runs.values()].map(run=>run.done));
  }
}
