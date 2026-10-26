import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server/index.js';
import { CollectionSourceSchema, StructureChunkSchema, type StructureChunk } from '../src/shared/structure-collection.js';
import { SourceTransferV2HeaderSchema, type SourceTransferV2Header } from '../src/shared/source-transfer.js';
import { EvidenceScopeSchema, type EvidenceScope, type SourceNode } from '../src/shared/contracts.js';
import { syntheticPng } from './source-import-fixture.js';

const digest=(input:string)=>createHash('sha256').update(input).digest('hex');
const bounds={x:-20,y:30,width:100,height:80},time='2026-10-27T00:00:00.000Z';
const source={fileKey:'synthetic-transfer-review',pageId:'page',nodeId:'root',name:'Synthetic source',type:'FRAME',bounds};
const root:SourceNode={id:'root',parentId:'page',type:'FRAME',name:source.name,bbox:bounds,
  sourceFileKey:source.fileKey,sourcePageId:'page',visible:true,rendering:{opacity:1}};
async function fixture(t:test.TestContext){
  const dataDir=await mkdtemp(join(tmpdir(),'fsb-transfer-integrity-'));
  const server=await startServer({port:0,dataDir,aiConfig:null});
  t.after(async()=>{await server.close();await rm(dataDir,{recursive:true,force:true});});
  const project=await server.store.create('Synthetic source'),target=await server.store.create('Synthetic receiver'),id=randomUUID();
  await server.collections.store.create({id,projectId:project.id,sessionId:'synthetic',source});
  const text={...root,id:'text',parentId:'root',type:'TEXT',name:'Original text',text:' Exact 한글 👩‍💻\r\n'};
  await server.collections.store.append(project.id,id,{collectionId:id,sequence:0,fileKey:source.fileKey,pageId:'page',root,bounds,
    startedAt:time,observedAt:time,nodes:[root],childCounts:[1],complete:false,nextSequence:1,warnings:[],consistency:'live-session-observation'});
  await server.collections.store.append(project.id,id,{collectionId:id,sequence:1,fileKey:source.fileKey,pageId:'page',root,bounds,
    startedAt:time,observedAt:time,nodes:[text],childCounts:[0],complete:true,nextSequence:null,warnings:[],consistency:'live-session-observation'});
  const saved=await server.evidence.create(project.id,0,{collectionId:id}),scope=saved.scopes![0]!;
  const lines:string[]=[];for await(const line of server.transfers.export(saved.id,scope.id,saved.revision))lines.push(line);
  return {server,dataDir,saved,target,scope,id,lines};
}
async function* stream(lines:readonly string[]){for(const line of lines)yield Buffer.from(line);}
/** Re-sign all digests so rejection must follow structural validation, not merely
 * notice a stale checksum. This is synthetic input, never an authenticity claim. */
function rewritten(lines:readonly string[],mutate:(header:SourceTransferV2Header,packets:StructureChunk[])=>void):string[]{
  const header=SourceTransferV2HeaderSchema.parse(JSON.parse(lines[0]!));
  const packets=lines.slice(1,-1).map(line=>StructureChunkSchema.parse(JSON.parse(line)));
  mutate(header,packets);header.source=CollectionSourceSchema.parse(header.source);
  const encoded=packets.map(packet=>JSON.stringify(StructureChunkSchema.parse(packet)));
  const descriptors=packets.map((packet,sequence)=>({sequence,sha256:digest(encoded[sequence]!),bytes:Buffer.byteLength(encoded[sequence]!),nodeCount:packet.nodes.length}));
  header.collection={id:packets[0]!.collectionId,nodeCount:packets.reduce((sum,packet)=>sum+packet.nodes.length,0),
    byteCount:descriptors.reduce((sum,packet)=>sum+packet.bytes,0),observedAt:packets.at(-1)!.observedAt,
    contentHash:digest(JSON.stringify({source:header.source,chunks:descriptors}))};
  if(header.scope.kind==='collection')header.scope.collection=header.collection;
  const result=[JSON.stringify(header)+'\n',...encoded.map(value=>value+'\n')];
  result.push(JSON.stringify({kind:'end',chunkCount:packets.length,nodeCount:header.collection.nodeCount,sha256:digest(result.join(''))})+'\n');
  return result;
}

test('re-signed transfer cannot forge child closure, duplicate nodes, preorder or declared parent',async t=>{
  const h=await fixture(t);
  const cases:[string,(header:SourceTransferV2Header,packets:StructureChunk[])=>void][]=[
    ['missing declared child',(_header,packets)=>{packets[0]!.childCounts=[2];}],
    ['duplicate node',(_header,packets)=>{packets[1]!.nodes=[{...packets[1]!.nodes[0]!,id:'root'}];}],
    ['wrong parent',(_header,packets)=>{packets[1]!.nodes[0]!.parentId='outside';}],
    ['mismatched original branch parent',(header)=>{header.source.scopeId='outer';header.source.parentId='different-parent';}],
    ['unfinished tree',(_header,packets)=>{packets[1]!.complete=false;packets[1]!.nextSequence=2;}],
  ];
  for(const [name,mutate] of cases)await t.test(name,async()=>{
    await assert.rejects(h.server.transfers.import(h.target.id,0,stream(rewritten(h.lines,mutate))));
    assert.deepEqual(await h.server.store.get(h.target.id),h.target);
    assert.equal(h.server.collections.list(h.target.id).length,0);
    assert.deepEqual((await readdir(join(h.dataDir,'structure-collections'))).sort(),[h.id]);
  });
});

test('valid transfer footer cannot attach before EOF or accept data after it',async t=>{
  const h=await fixture(t);let release!:()=>void,footerRead!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),seen=new Promise<void>(resolve=>{footerRead=resolve;});
  async function* blocked(){for(const line of h.lines)yield Buffer.from(line);footerRead();await gate;yield Buffer.from('{}\n');}
  const imported=h.server.transfers.import(h.target.id,0,blocked());
  await seen;
  assert.deepEqual(await h.server.store.get(h.target.id),h.target);
  const pending=h.server.collections.list(h.target.id);assert.equal(pending.length,1);assert.equal(pending[0]!.nodeCount,1);
  assert.notEqual(pending[0]!.status,'complete');release();await assert.rejects(imported,{code:'SOURCE_TRANSFER_INVALID'});
  assert.deepEqual(await h.server.store.get(h.target.id),h.target);assert.equal(h.server.collections.list(h.target.id).length,0);
});

test('cache quota rejection does not evict old evidence or alter a receiver workspace',async t=>{
  const h=await fixture(t),ids:string[]=[];
  for(let index=0;index<11;index++){
    const id=randomUUID();ids.push(id);
    await h.server.collections.store.create({id,projectId:h.target.id,sessionId:'synthetic',source});
  }
  await assert.rejects(h.server.transfers.import(h.target.id,0,stream(h.lines)),{code:'COLLECTION_LIMIT'});
  assert.deepEqual(await h.server.store.get(h.target.id),h.target);
  assert.deepEqual(h.server.collections.list(h.target.id).map(value=>value.id),ids);
  assert.equal(h.server.collections.get(h.saved.id,h.id).status,'complete');
});

test('export retains its backing across header delivery and releases the lease on iterator cancellation',async t=>{
  const h=await fixture(t),exported=h.server.transfers.export(h.saved.id,h.scope.id,h.saved.revision);
  const first=await exported.next();assert.equal(first.done,false);
  await assert.rejects(h.server.collections.store.remove(h.saved.id,h.id),{code:'COLLECTION_BUSY'});
  await exported.return(undefined);
  await assert.rejects(h.server.collections.store.remove(h.saved.id,h.id,async()=>{throw new Error('Backing stays referenced');}),/Backing stays referenced/);
  assert.equal(h.server.collections.get(h.saved.id,h.id).status,'complete');
});

test('re-signed branch headers cannot lose image mapping or contradict their bounded source scope',async t=>{
  const h=await fixture(t);
  const context=EvidenceScopeSchema.parse({id:randomUUID(),kind:'visual',name:'Synthetic context',
    source:{fileKey:source.fileKey,pageId:source.pageId,rootId:source.nodeId,revision:null,capturedAt:time},bounds,
    preview:{mimeType:'image/png',width:100,height:80,base64:syntheticPng(100,80).toString('base64')},
    visualObservation:{taskId:'synthetic-context',observedAt:time},collection:null,warnings:[]});
  const visual=await h.server.store.mutate(h.saved.id,h.saved.revision,{type:'add_evidence_scope',scope:context},'human',true);
  const project=await h.server.evidence.createBranch(visual.id,visual.revision,{collectionId:h.id,nodeId:'text',contextScopeId:context.id});
  const branch=project.scopes!.at(-1)!,lines:string[]=[];
  for await(const line of h.server.transfers.export(project.id,branch.id,project.revision))lines.push(line);
  const cases:[string,(scope:EvidenceScope)=>void][]=[
    ['missing image coordinates',scope=>{delete scope.visualBounds;}],
    ['image outside canvas',scope=>{scope.visualBounds={...scope.visualBounds!,x:1000};}],
    ['coverage outside canvas',scope=>{scope.coverageBounds={...scope.coverageBounds!,y:1000};}],
    ['contradictory branch identity',scope=>{scope.branch!.nodeId='unrelated';}],
    ['contradictory range count',scope=>{scope.branch!.endOffset++;}],
    ['coordinates without image',scope=>{scope.preview=null;scope.visualObservation=null;}],
  ];
  for(const [name,mutate] of cases)await t.test(name,async()=>{
    const changed=rewritten(lines,header=>{
      assert.equal(header.scope.kind,'branch');mutate(header.scope as EvidenceScope);
    });
    await assert.rejects(h.server.transfers.import(h.target.id,0,stream(changed)));
    assert.deepEqual(await h.server.store.get(h.target.id),h.target);
    assert.equal(h.server.collections.list(h.target.id).length,0);
  });
});

test('branch image union tolerates arithmetic rounding across negative document coordinates',async t=>{
  const h=await fixture(t),id=randomUUID(),imageBounds={x:-1_000_000,y:0,width:100,height:80};
  const wideSource={...source,bounds:imageBounds},wideRoot={...root,bbox:imageBounds};
  const child={...root,id:'outside-parent-box',parentId:'root',type:'TEXT',text:'Exact source',bbox:{x:0,y:0,width:0.1,height:1}};
  await h.server.collections.store.create({id,projectId:h.saved.id,sessionId:'synthetic',source:wideSource});
  await h.server.collections.store.append(h.saved.id,id,{collectionId:id,sequence:0,fileKey:source.fileKey,pageId:source.pageId,
    root:wideRoot,bounds:imageBounds,startedAt:time,observedAt:time,nodes:[wideRoot,child],childCounts:[1,0],
    complete:true,nextSequence:null,warnings:[],consistency:'live-session-observation'});
  const context=EvidenceScopeSchema.parse({id:randomUUID(),kind:'visual',name:'Synthetic negative-coordinate context',
    source:{fileKey:source.fileKey,pageId:source.pageId,rootId:source.nodeId,revision:null,capturedAt:time},bounds:imageBounds,
    preview:{mimeType:'image/png',width:100,height:80,base64:syntheticPng(100,80).toString('base64')},
    visualObservation:{taskId:'synthetic-negative-context',observedAt:time},collection:null,warnings:[]});
  const visual=await h.server.store.mutate(h.saved.id,h.saved.revision,{type:'add_evidence_scope',scope:context},'human',true);
  const project=await h.server.evidence.createBranch(visual.id,visual.revision,{collectionId:id,nodeId:child.id,contextScopeId:context.id});
  const branch=project.scopes!.at(-1)!;
  assert.ok(branch.bounds.x+branch.bounds.width<child.bbox.x+child.bbox.width);
  const lines:string[]=[];for await(const line of h.server.transfers.export(project.id,branch.id,project.revision))lines.push(line);
  const imported=await h.server.transfers.import(h.target.id,0,stream(lines)),saved=imported.scopes![0]!;
  assert.deepEqual(saved.bounds,branch.bounds);assert.deepEqual(saved.visualBounds,imageBounds);assert.deepEqual(saved.coverageBounds,child.bbox);
});
