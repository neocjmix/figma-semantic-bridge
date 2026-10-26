import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CollectionReferenceSchema, EvidenceScopeSchema, type CollectionReference, type EvidenceScope, type Project, type Snapshot, type SourceNode } from '../shared/contracts.js';
import { CollectionSourceSchema, StructureChunkSchema, STRUCTURE_CHUNK_BYTES, STRUCTURE_CHUNK_NODES, type CollectionSource, type StructureChunk } from '../shared/structure-collection.js';
import { SOURCE_TRANSFER_LINE_BYTES, SOURCE_TRANSFER_MAX_BYTES, SourceTransferFooterSchema, SourceTransferHeaderSchema, SourceTransferV2HeaderSchema, type SourceTransferHeader, type SourceTransferV2Header } from '../shared/source-transfer.js';
import { CollectionStore } from './structure-collection-store.js';
import { ProjectStore } from './store.js';
import { EvidenceScopes } from './evidence-scopes.js';
import { validatePreview } from './preview.js';
import { ServiceError } from './errors.js';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function invalid(message:string):never{throw new ServiceError('SOURCE_TRANSFER_INVALID',message,400);}
const importedWarning='Imported source observation; checksums do not establish authorship, permission or current Figma rendering.';
type PacketFactory=()=>AsyncIterable<StructureChunk>;
function declaredCollection(header:SourceTransferHeader):CollectionReference{return header.version===1?header.scope.collection!:header.collection;}
function validateHeader(header:SourceTransferHeader):void {
  const {scope,source}=header,collection=declaredCollection(header);
  const box=scope.kind==='branch'?scope.coverageBounds:scope.bounds;
  if(scope.source.fileKey!==source.fileKey||scope.source.pageId!==source.pageId||scope.source.rootId!==source.nodeId||
    !isDeepStrictEqual(box,source.bounds))invalid('Transferred source identity or bounds differ.');
  if(scope.kind==='collection'&&!isDeepStrictEqual(scope.collection,collection))invalid('Transferred collection descriptor differs from its scope.');
  if(scope.kind==='snapshot'&&(scope.completeness.reason!==null||collection.nodeCount>10000))
    invalid('Transferred capture contradicts its original complete coverage.');
  if(scope.kind==='branch'){
    const branch=scope.branch!;
    if(branch.nodeId!==source.nodeId||branch.enclosingRootId!==source.scopeId||
      branch.nodeCount!==collection.nodeCount||branch.endOffset-branch.startOffset!==branch.nodeCount||
      branch.observedAt!==collection.observedAt||!isDeepStrictEqual(branch.ancestorRendering,source.ancestorRendering))
      invalid('Transferred branch context differs from its bounded coverage.');
    const contains=(a:typeof scope.bounds,b:typeof scope.bounds)=>a.x<=b.x+0.01&&a.y<=b.y+0.01&&
      a.x+a.width+0.01>=b.x+b.width&&a.y+a.height+0.01>=b.y+b.height;
    if(!contains(scope.bounds,scope.coverageBounds!)||(scope.visualBounds&&!contains(scope.bounds,scope.visualBounds)))
      invalid('Transferred branch bounds exclude its source or image context.');
  }
  validatePreview(scope);
}

/** Old captures already have a bounded inline tree; validate and reorder, never infer missing records. */
function snapshotPackets(snapshot:Snapshot):{source:CollectionSource;packets:PacketFactory}{
  if(!snapshot.completeness.complete||!snapshot.source.fileKey)
    throw new ServiceError('SOURCE_INCOMPLETE','A complete capture with a Figma file identity is required.',409);
  const byId=new Map<string,SourceNode>(),children=new Map<string,SourceNode[]>();
  for(const node of snapshot.nodes){
    if(byId.has(node.id)||node.sourceFileKey!==snapshot.source.fileKey||node.sourcePageId!==snapshot.source.pageId)
      invalid('Captured source records have conflicting identities.');
    byId.set(node.id,node);
    if(node.parentId!==null){const siblings=children.get(node.parentId)??[];siblings.push(node);children.set(node.parentId,siblings);}
  }
  const root=byId.get(snapshot.source.rootId);
  if(!root||!isDeepStrictEqual(root.bbox,snapshot.bounds)||(root.parentId!==null&&byId.has(root.parentId)))
    invalid('Captured source has an invalid root or bounds.');
  const ordered:SourceNode[]=[],stack=[root],seen=new Set<string>();
  while(stack.length){const node=stack.pop()!;if(seen.has(node.id))invalid('Captured source ancestry is cyclic.');seen.add(node.id);ordered.push(node);
    const next=children.get(node.id)??[];for(let i=next.length-1;i>=0;i--)stack.push(next[i]!);
  }
  if(ordered.length!==snapshot.nodes.length)invalid('Captured source has records outside its declared root.');
  const source=CollectionSourceSchema.parse({fileKey:snapshot.source.fileKey,pageId:snapshot.source.pageId,nodeId:root.id,
    name:root.name,type:root.type,bounds:snapshot.bounds});
  const startedAt=snapshot.acquisition?.structureStartedAt??snapshot.source.capturedAt;
  const observedAt=snapshot.acquisition?.structureFinishedAt??snapshot.source.capturedAt;
  return {source,packets:async function*(){
    let offset=0,sequence=0;
    const build=(nodes:SourceNode[]):StructureChunk=>StructureChunkSchema.parse({collectionId:snapshot.id,sequence,
      fileKey:source.fileKey,pageId:source.pageId,root,bounds:source.bounds,startedAt,observedAt,nodes,
      childCounts:nodes.map(node=>(children.get(node.id)??[]).length),complete:offset+nodes.length===ordered.length,
      nextSequence:offset+nodes.length===ordered.length?null:sequence+1,warnings:[],consistency:'live-session-observation'});
    while(offset<ordered.length){
      let nodes=ordered.slice(offset,offset+STRUCTURE_CHUNK_NODES),packet=build(nodes);
      while(Buffer.byteLength(JSON.stringify(packet))>STRUCTURE_CHUNK_BYTES&&nodes.length>1){nodes=nodes.slice(0,Math.ceil(nodes.length/2));packet=build(nodes);}
      if(Buffer.byteLength(JSON.stringify(packet))>STRUCTURE_CHUNK_BYTES)invalid('A captured source record exceeds the packet size limit.');
      yield packet;offset+=nodes.length;sequence++;
    }
  }};
}
async function packetDescriptor(source:CollectionSource,packets:PacketFactory):Promise<CollectionReference>{
  const digest=createHash('sha256').update('{"source":'+JSON.stringify(source)+',"chunks":[');
  let id='',nodeCount=0,byteCount=0,observedAt='',sequence=0,complete=false;
  for await(const input of packets()){
    const packet=StructureChunkSchema.parse(input),encoded=JSON.stringify(packet),bytes=Buffer.byteLength(encoded);
    if(complete||packet.sequence!==sequence||id&&packet.collectionId!==id||bytes>STRUCTURE_CHUNK_BYTES)invalid('Invalid source packet sequence.');
    id=packet.collectionId;nodeCount+=packet.nodes.length;byteCount+=bytes;observedAt=packet.observedAt;complete=packet.complete;
    digest.update((sequence?',':'')+JSON.stringify({sequence,sha256:hash(encoded),bytes,nodeCount:packet.nodes.length}));sequence++;
  }
  if(!complete)invalid('Source packets do not cover a complete tree.');
  return CollectionReferenceSchema.parse({id,nodeCount,byteCount,observedAt,contentHash:digest.update(']}').digest('hex')});
}
/** Import assigns a UUID; reserve that exact width so remapping cannot exceed a full packet. */
function transferPackets(packets:PacketFactory):PacketFactory{
  const collectionId=randomUUID();
  return async function*(){
    let sequence=0;
    for await(const packet of packets()){
      let offset=0;
      while(offset<packet.nodes.length){
        let length=packet.nodes.length-offset;
        const build=()=>StructureChunkSchema.parse({...packet,collectionId,sequence,nodes:packet.nodes.slice(offset,offset+length),
          childCounts:packet.childCounts.slice(offset,offset+length),complete:packet.complete&&offset+length===packet.nodes.length,
          nextSequence:packet.complete&&offset+length===packet.nodes.length?null:sequence+1});
        let chunk=build();
        while(Buffer.byteLength(JSON.stringify(chunk))>STRUCTURE_CHUNK_BYTES&&length>1){length=Math.ceil(length/2);chunk=build();}
        if(Buffer.byteLength(JSON.stringify(chunk))>STRUCTURE_CHUNK_BYTES)invalid('A source record exceeds its bounded transfer packet.');
        yield chunk;offset+=length;sequence++;
      }
    }
  };
}

/** Incremental UTF-8 framing; one packet and the image header are the allocation bounds. */
export async function* transferLines(input:AsyncIterable<Uint8Array>):AsyncGenerator<string>{
  const decoder=new TextDecoder('utf-8',{fatal:true});let pending='',bytes=0;
  for await(const part of input){
    bytes+=part.byteLength;if(bytes>SOURCE_TRANSFER_MAX_BYTES)throw new ServiceError('SOURCE_TRANSFER_LIMIT','Source transfer exceeds 80 MB.',413);
    pending+=decoder.decode(part,{stream:true});
    let end:number;
    while((end=pending.indexOf('\n'))>=0){
      const line=pending.slice(0,end);pending=pending.slice(end+1);
      if(!line||Buffer.byteLength(line)>SOURCE_TRANSFER_LINE_BYTES)invalid('Invalid or oversized source-transfer line.');
      yield line;
    }
    if(Buffer.byteLength(pending)>SOURCE_TRANSFER_LINE_BYTES)invalid('Source-transfer line exceeds its bounded size.');
  }
  pending+=decoder.decode();
  if(pending)invalid('Source transfer ended without a complete line.');
}

/** Source-only interchange. Human semantic decisions are intentionally never imported. */
export class SourceTransfer {
  private importing=new Set<string>();
  private controllers=new Set<AbortController>();
  private pending=new Set<Promise<void>>();
  private closed=false;
  constructor(private projects:ProjectStore,private collections:CollectionStore,private evidence:EvidenceScopes){}
  /** Keep a saved source retained across both descriptor and output passes, including cancellation. */
  private async retain(projectId:string,id:string):Promise<()=>Promise<void>>{
    let release!:()=>void,ready!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{ready=resolve;});
    const held=this.collections.usingEvidence(projectId,id,async()=>{ready();await gate;});
    await Promise.race([started,held]);return async()=>{release();await held;};
  }
  async *export(projectId:string,scopeId:string,expectedRevision:number):AsyncGenerator<string>{
    const project=await this.projects.get(projectId);
    if(project.revision!==expectedRevision)throw new ServiceError('REVISION_CONFLICT','Reload before exporting source evidence.',409);
    const scope=project.scopes?.find(value=>value.id===scopeId),snapshot=project.snapshots.find(value=>value.id===scopeId);
    if(!snapshot&&(!scope||scope.kind==='visual'))throw new ServiceError('SOURCE_INCOMPLETE','Choose a complete source scope or prepared part.',409);
    const backing=scope?.collection?.id??scope?.branch?.collectionId;
    const release=backing?await this.retain(projectId,backing):async()=>{};
    try{
      let source:CollectionSource,packets:PacketFactory,metadata:SourceTransferV2Header['scope'];
      if(snapshot){
        const converted=snapshotPackets(snapshot);source=converted.source;packets=converted.packets;
        const {nodes:_nodes,...rest}=snapshot;metadata={...rest,kind:'snapshot'};
      }else{
        await this.evidence.validateScope(projectId,scope!);metadata=scope!;
        packets=()=>this.evidence.iterate(project,scope!);
        if(scope!.kind==='branch'){
          const branch=await this.collections.evidenceBranch(projectId,scope!.branch!.collectionId,scope!.branch!.nodeId);
          source=CollectionSourceSchema.parse({fileKey:branch.source.fileKey,pageId:branch.source.pageId,nodeId:branch.root.id,
            name:branch.root.name,type:branch.root.type,bounds:scope!.coverageBounds,scopeId:scope!.branch!.enclosingRootId,
            parentId:branch.root.parentId,ancestorRendering:branch.ancestorRendering});
        }else source=this.collections.get(projectId,scope!.collection!.id).source;
      }
      if(scope?.kind!=='collection')packets=transferPackets(packets);
      const collection=scope?.kind==='collection'?scope.collection!:await packetDescriptor(source,packets);
      const header=SourceTransferV2HeaderSchema.parse({kind:'figma-semantic-bridge.source-transfer',version:2,
        exportedAt:new Date().toISOString(),source,collection,scope:metadata});validateHeader(header);
      const digest=createHash('sha256');let chunks=0,nodes=0,total=0;
      const line=(value:unknown)=>{const encoded=JSON.stringify(value)+'\n';total+=Buffer.byteLength(encoded);
        if(Buffer.byteLength(encoded)>SOURCE_TRANSFER_LINE_BYTES||total>SOURCE_TRANSFER_MAX_BYTES)
          throw new ServiceError('SOURCE_TRANSFER_LIMIT','Source transfer exceeds its bounded size.',413);
        digest.update(encoded);return encoded;};
      yield line(header);
      for await(const packet of packets()){const chunk=StructureChunkSchema.parse(packet);chunks++;nodes+=chunk.nodes.length;yield line(chunk);}
      const footer=JSON.stringify({kind:'end',chunkCount:chunks,nodeCount:nodes,sha256:digest.digest('hex')})+'\n';
      if(total+Buffer.byteLength(footer)>SOURCE_TRANSFER_MAX_BYTES)throw new ServiceError('SOURCE_TRANSFER_LIMIT','Source transfer exceeds 80 MB.',413);
      yield footer;
    }finally{await release();}
  }
  async import(projectId:string,expectedRevision:number,input:AsyncIterable<Uint8Array>,signal?:AbortSignal):Promise<Project>{
    if(this.closed)throw new ServiceError('SERVER_CLOSED','Source transfer service is stopping.',503);
    if(this.importing.has(projectId))throw new ServiceError('SOURCE_TRANSFER_BUSY','Another source import is in progress for this workspace.',409);
    this.importing.add(projectId);let createdId:string|undefined,attached=false;
    const controller=new AbortController();this.controllers.add(controller);
    const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    let settled!:()=>void;const done=new Promise<void>(resolve=>{settled=resolve;});this.pending.add(done);
    const active=()=>{if(combined.aborted)throw new ServiceError('CANCELLED','Source import cancelled.',499);};
    try{
      active();const project=await this.projects.get(projectId);
      if(project.revision!==expectedRevision)throw new ServiceError('REVISION_CONFLICT','Reload before importing source evidence.',409);
      const lines=transferLines(input),first=await lines.next();if(first.done)invalid('Source transfer is empty.');
      const header=SourceTransferHeaderSchema.parse(JSON.parse(first.value)),original=declaredCollection(header);
      validateHeader(header);active();
      const id=randomUUID();await this.collections.create({id,projectId,sessionId:'import-'+randomUUID(),source:header.source});createdId=id;
      const streamHash=createHash('sha256').update(first.value+'\n');
      const contentHash=createHash('sha256').update('{"source":'+JSON.stringify(header.source)+',"chunks":[');
      let count=0,nodes=0,bytes=0,final:StructureChunk|undefined,ended=false;
      for await(const line of lines){
        active();if(ended)invalid('Data follows the transfer footer.');
        const value=JSON.parse(line) as unknown;
        if(value&&typeof value==='object'&&'kind' in value){
          const footer=SourceTransferFooterSchema.parse(value);
          if(!final||footer.chunkCount!==count||footer.nodeCount!==nodes||footer.sha256!==streamHash.digest('hex'))invalid('Source transfer is incomplete or its checksum differs.');
          contentHash.update(']}');
          if(contentHash.digest('hex')!==original.contentHash||nodes!==original.nodeCount||bytes!==original.byteCount||final.observedAt!==original.observedAt)
            invalid('Transferred source does not match its declared complete collection.');
          ended=true;continue;
        }
        if(final)invalid('A packet follows a completed source tree.');
        if(Buffer.byteLength(line)>STRUCTURE_CHUNK_BYTES)invalid('Source packet exceeds 1 MB.');
        const chunk=StructureChunkSchema.parse(value),encoded=JSON.stringify(chunk),size=Buffer.byteLength(encoded);
        if(chunk.collectionId!==original.id||chunk.sequence!==count)invalid('Transferred packet identity or order differs.');
        if(header.scope.kind==='branch'&&chunk.startedAt!==header.scope.branch!.startedAt)
          invalid('Transferred branch observation times differ.');
        if(header.scope.kind==='snapshot'&&(chunk.startedAt!==(header.scope.acquisition?.structureStartedAt??header.scope.source.capturedAt)||
          chunk.observedAt!==(header.scope.acquisition?.structureFinishedAt??header.scope.source.capturedAt)))
          invalid('Transferred capture observation times differ.');
        const descriptor={sequence:count,sha256:hash(encoded),bytes:size,nodeCount:chunk.nodes.length};
        contentHash.update((count?',':'')+JSON.stringify(descriptor));streamHash.update(line+'\n');
        count++;nodes+=chunk.nodes.length;bytes+=size;
        if(nodes>original.nodeCount||bytes>original.byteCount)invalid('Transferred source exceeds its declared coverage.');
        const remapped={...chunk,collectionId:id};
        if(chunk.complete)final=remapped;else await this.collections.append(projectId,id,remapped);
      }
      active();if(!ended||!final)invalid('Source transfer has no verified final packet and footer.');
      // The final packet remains in memory until footer, EOF and all original hashes pass.
      await this.collections.append(projectId,id,final);
      const originalScope=header.scope;
      const transferOrigin:EvidenceScope['transferOrigin']=originalScope.kind==='snapshot'?
        {kind:'snapshot',scopeId:originalScope.id,...(originalScope.acquisition?{acquisition:originalScope.acquisition}:{})}:
        originalScope.transferOrigin??(originalScope.kind==='branch'?{kind:'branch',scopeId:originalScope.id,branch:originalScope.branch!}:
          {kind:'collection',scopeId:originalScope.id,collection:originalScope.collection!});
      let candidate:unknown;
      if(originalScope.kind==='snapshot'){
        candidate={id:randomUUID(),name:originalScope.name,kind:'collection',source:originalScope.source,bounds:originalScope.bounds,
          preview:originalScope.preview,visualObservation:originalScope.preview?{
            taskId:originalScope.acquisition?.taskId??originalScope.id,
            observedAt:originalScope.acquisition?.previewObservedAt??originalScope.source.capturedAt}:null,
          collection:this.collections.descriptor(projectId,id),warnings:originalScope.warnings,transferOrigin};
      }else if(originalScope.kind==='branch'){
        const branch=await this.collections.evidenceBranch(projectId,id,header.source.nodeId);
        candidate={...originalScope,id:randomUUID(),collection:null,transferOrigin,
          branch:{collectionId:id,nodeId:branch.root.id,contentHash:branch.contentHash,startOffset:branch.startOffset,endOffset:branch.endOffset,
            nodeCount:branch.nodeCount,startedAt:branch.startedAt,observedAt:branch.observedAt,enclosingRootId:header.source.scopeId!,
            ancestorRendering:branch.ancestorRendering,coverage:'closed-saved-subtree',freshness:'not-revalidated'}};
      }else candidate={...originalScope,id:randomUUID(),collection:this.collections.descriptor(projectId,id),transferOrigin};
      const scope=EvidenceScopeSchema.parse({...candidate as EvidenceScope,
        warnings:[...new Set([...originalScope.warnings.slice(0,98),importedWarning])]});
      const result=await this.collections.using(projectId,id,async()=>{
        active();const saved=await this.projects.mutate(projectId,expectedRevision,{type:'add_evidence_scope',scope},'human',true,combined);attached=true;return saved;
      });
      return result;
    }catch(error){
      if(error instanceof SyntaxError||error instanceof TypeError)invalid('Source transfer contains invalid JSON or UTF-8.');
      throw error;
    }finally{
      if(createdId&&!attached){
        await this.collections.update(projectId,createdId,{status:'failed'}).catch(()=>{});
        const importedId=createdId;
        await this.collections.remove(projectId,importedId,async()=>{
          // A persistence acknowledgement can fail after rename/commit. Never
          // remove a successfully bound source merely because its reply was lost.
          const saved=await this.projects.get(projectId);
          if(saved.scopes?.some(scope=>scope.collection?.id===importedId||scope.branch?.collectionId===importedId))
            throw new ServiceError('COLLECTION_IN_USE','The imported scope was already committed; reload the workspace.',409);
        }).catch(()=>{});
      }
      this.importing.delete(projectId);
      this.controllers.delete(controller);this.pending.delete(done);settled();
    }
  }
  async close():Promise<void>{this.closed=true;for(const controller of this.controllers)controller.abort();await Promise.all(this.pending);}
}
