import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { EvidenceScopeSchema, type Project } from '../shared/contracts.js';
import { StructureChunkSchema, STRUCTURE_CHUNK_BYTES, type StructureChunk } from '../shared/structure-collection.js';
import { SOURCE_TRANSFER_LINE_BYTES, SOURCE_TRANSFER_MAX_BYTES, SourceTransferFooterSchema, SourceTransferHeaderSchema } from '../shared/source-transfer.js';
import { CollectionStore } from './structure-collection-store.js';
import { ProjectStore } from './store.js';
import { EvidenceScopes } from './evidence-scopes.js';
import { validatePreview } from './preview.js';
import { ServiceError } from './errors.js';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function invalid(message:string):never{throw new ServiceError('SOURCE_TRANSFER_INVALID',message,400);}

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
  async *export(projectId:string,scopeId:string,expectedRevision:number):AsyncGenerator<string>{
    const project=await this.projects.get(projectId);
    if(project.revision!==expectedRevision)throw new ServiceError('REVISION_CONFLICT','Reload before exporting source evidence.',409);
    const scope=project.scopes?.find(value=>value.id===scopeId);
    if(!scope?.collection)throw new ServiceError('SOURCE_INCOMPLETE','Choose a complete collection-backed scope.',409);
    this.evidence.validateScope(projectId,scope);
    const view=this.collections.get(projectId,scope.collection.id);
    const header=SourceTransferHeaderSchema.parse({kind:'figma-semantic-bridge.source-transfer',version:1,
      exportedAt:new Date().toISOString(),source:view.source,scope});
    const digest=createHash('sha256');let chunks=0,nodes=0,total=0;
    const line=(value:unknown)=>{const encoded=JSON.stringify(value)+'\n';total+=Buffer.byteLength(encoded);
      if(total>SOURCE_TRANSFER_MAX_BYTES)throw new ServiceError('SOURCE_TRANSFER_LIMIT','Source transfer exceeds 80 MB.',413);
      digest.update(encoded);return encoded;};
    yield line(header);
    for await(const chunk of this.collections.iterate(projectId,scope.collection.id)){chunks++;nodes+=chunk.nodes.length;yield line(chunk);}
    yield JSON.stringify({kind:'end',chunkCount:chunks,nodeCount:nodes,sha256:digest.digest('hex')})+'\n';
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
      const header=SourceTransferHeaderSchema.parse(JSON.parse(first.value)),original=header.scope.collection!;
      if(header.scope.source.fileKey!==header.source.fileKey||header.scope.source.pageId!==header.source.pageId||
        header.scope.source.rootId!==header.source.nodeId||!isDeepStrictEqual(header.scope.bounds,header.source.bounds))invalid('Transferred source identity or bounds differ.');
      validatePreview(header.scope);active();
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
      const scope=EvidenceScopeSchema.parse({...header.scope,id:randomUUID(),collection:this.collections.descriptor(projectId,id),
        warnings:[...header.scope.warnings.slice(0,98),'Imported source observation; checksums do not establish authorship, permission or current Figma rendering.']});
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
          if(saved.scopes?.some(scope=>scope.collection?.id===importedId))
            throw new ServiceError('COLLECTION_IN_USE','The imported scope was already committed; reload the workspace.',409);
        }).catch(()=>{});
      }
      this.importing.delete(projectId);
      this.controllers.delete(controller);this.pending.delete(done);settled();
    }
  }
  async close():Promise<void>{this.closed=true;for(const controller of this.controllers)controller.abort();await Promise.all(this.pending);}
}
