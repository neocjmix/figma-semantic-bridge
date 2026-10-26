import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server/index.js';
import { transferLines } from '../src/server/source-transfer.js';
import { EvidenceScopeSchema, SnapshotSchema, type SourceNode } from '../src/shared/contracts.js';
import type { StructureChunk } from '../src/shared/structure-collection.js';

const time='2026-10-26T00:00:00.000Z',bounds={x:0,y:0,width:17320,height:14791};
const source={fileKey:'synthetic-file',pageId:'page',nodeId:'root',name:'Synthetic transfer',type:'FRAME',bounds};
const exact='정확한 원문 👩‍💻 e\u0301\r\n  <script>not code</script>';
function node(index:number,total:number):SourceNode{return {id:index?'n'+index:'root',parentId:index?'root':'page',name:index?'Synthetic '+index:source.name,
  type:index===total-1?'TEXT':index?'RECTANGLE':'FRAME',bbox:index?{x:index%1000,y:Math.floor(index/1000),width:1,height:1}:bounds,
  visible:true,sourceFileKey:source.fileKey,sourcePageId:source.pageId,...(index===total-1?{text:exact}:{})};}
async function fixture(t:test.TestContext,total=1001){
  const dataDir=await mkdtemp(join(tmpdir(),'fsb-transfer-')),server=await startServer({port:0,dataDir,token:'synthetic-token-'.repeat(4),aiConfig:null});
  t.after(async()=>{await server.close();await rm(dataDir,{recursive:true,force:true});});
  const project=await server.store.create('Synthetic export'),id=randomUUID();
  await server.collections.store.create({id,projectId:project.id,sessionId:'synthetic-session',source});
  for(let offset=0,sequence=0;offset<total;offset+=500,sequence++){
    const size=Math.min(500,total-offset),complete=offset+size===total;
    const chunk:StructureChunk={collectionId:id,sequence,fileKey:source.fileKey,pageId:source.pageId,root:node(0,total),bounds,startedAt:time,observedAt:time,
      nodes:Array.from({length:size},(_,i)=>node(offset+i,total)),childCounts:Array.from({length:size},(_,i)=>offset+i===0?total-1:0),
      complete,nextSequence:complete?null:sequence+1,warnings:[],consistency:'live-session-observation'};
    await server.collections.store.append(project.id,id,chunk);
  }
  const saved=await server.evidence.create(project.id,0,{collectionId:id}),scope=saved.scopes![0]!;
  const target=await server.store.create('Synthetic import');
  return {server,saved,scope,target};
}
async function* bytes(lines:AsyncIterable<string>){for await(const line of lines)yield Buffer.from(line);}
async function* strings(lines:string[]){for(const line of lines)yield Buffer.from(line);}
test('105,837-node source transfer roundtrips all chunks and exact final text without inline snapshots or approvals',{timeout:120000},async t=>{
  const h=await fixture(t,105837);
  const imported=await h.server.transfers.import(h.target.id,0,bytes(h.server.transfers.export(h.saved.id,h.scope.id,h.saved.revision)));
  const scope=imported.scopes![0]!;assert.equal(scope.collection!.nodeCount,105837);
  assert.notEqual(scope.id,h.scope.id);assert.notEqual(scope.collection!.id,h.scope.collection!.id);
  assert.equal(imported.snapshots.length,0);assert.equal(imported.annotations.length,0);assert.equal(imported.specifications.length,0);
  assert.equal(JSON.stringify(imported).includes('n105836'),false);
  const text=await h.server.evidence.text(imported,scope.id,{nodeId:'n105836',offset:0,limit:4000});assert.equal(text.text,exact);
  const page=await h.server.evidence.query(imported,scope.id,{offset:105800,limit:200});assert.equal(page.nodes.at(-1)!.id,'n105836');assert.equal(page.nextOffset,null);
});
test('truncation, checksum tampering, trailing data and stale revision never attach a scope or retain incomplete import',async t=>{
  const h=await fixture(t),lines=[];for await(const line of h.server.transfers.export(h.saved.id,h.scope.id,h.saved.revision))lines.push(line);
  for(const changed of [lines.slice(0,-1),[...lines.slice(0,1),lines[1]!.replace('Synthetic 1','Tampered 1'),...lines.slice(2)], [...lines,'{}\n']]){
    await assert.rejects(h.server.transfers.import(h.target.id,0,strings(changed)));
    assert.equal((await h.server.store.get(h.target.id)).scopes?.length??0,0);
    assert.equal(h.server.collections.list(h.target.id).length,0);
  }
  await assert.rejects(h.server.transfers.import(h.target.id,99,strings(lines)),{code:'REVISION_CONFLICT'});
  assert.equal(h.server.collections.list(h.target.id).length,0);
});
test('cancellation during streaming removes partial local data and leaves existing workspace untouched',async t=>{
  const h=await fixture(t),abort=new AbortController();let index=0;
  async function* aborted(){for await(const line of h.server.transfers.export(h.saved.id,h.scope.id,h.saved.revision)){
    if(index++===2)abort.abort();yield Buffer.from(line);
  }}
  await assert.rejects(h.server.transfers.import(h.target.id,0,aborted(),abort.signal),{code:'CANCELLED'});
  assert.equal((await h.server.store.get(h.target.id)).revision,0);assert.equal(h.server.collections.list(h.target.id).length,0);
});
test('HTTP source-only transfer has explicit streaming content type and imports into a fresh unreviewed scope',async t=>{
  const h=await fixture(t),headers={Authorization:'Bearer '+h.server.token};
  const response=await fetch(`${h.server.url}/api/projects/${h.saved.id}/source-transfer/${h.scope.id}?expectedRevision=${h.saved.revision}`,{headers});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/x-ndjson');
  const body=await response.text();
  const imported=await fetch(`${h.server.url}/api/projects/${h.target.id}/source-transfer?expectedRevision=0`,{method:'POST',headers:{...headers,'Content-Type':'application/x-ndjson'},body});
  assert.equal(imported.status,201);const value=await imported.json();assert.equal(value.scopes.length,1);assert.equal(value.annotations.length,0);
});
test('stream parser preserves UTF-8 split boundaries and rejects incomplete or invalid bytes',async()=>{
  const encoded=Buffer.from('"한글 👩‍💻"\n');async function* oneByte(){for(const value of encoded)yield new Uint8Array([value]);}
  const result=[];for await(const line of transferLines(oneByte()))result.push(line);assert.deepEqual(result,['"한글 👩‍💻"']);
  await assert.rejects(async()=>{for await(const _ of transferLines(strings(['{}'])))void _;},{code:'SOURCE_TRANSFER_INVALID'});
  async function* bad(){yield new Uint8Array([255,10]);}await assert.rejects(async()=>{for await(const _ of transferLines(bad()))void _;});
});

test('lost persistence acknowledgement cannot delete a source that was already attached',async t=>{
  const h=await fixture(t),mutate=h.server.store.mutate.bind(h.server.store);
  h.server.store.mutate=async(...args)=>{
    const result=await mutate(...args);
    if(args[2].type==='add_evidence_scope')throw new Error('Synthetic acknowledgement failure after commit');
    return result;
  };
  await assert.rejects(h.server.transfers.import(h.target.id,0,bytes(h.server.transfers.export(h.saved.id,h.scope.id,h.saved.revision))));
  const saved=await h.server.store.get(h.target.id),scope=saved.scopes![0]!;
  assert.equal(saved.revision,1);assert.equal(h.server.collections.get(saved.id,scope.collection!.id).status,'complete');
  assert.equal((await h.server.evidence.text(saved,scope.id,{nodeId:'n1000',offset:0,limit:4000})).text,exact);
});

const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(1,16);png.writeUInt32BE(1,20);
const preview={mimeType:'image/png' as const,base64:png.toString('base64'),width:1,height:1};
async function branchFixture(t:test.TestContext){
  const h=await fixture(t,2),project=await h.server.store.create('Partial tree'),id=randomUUID();
  const root={...node(0,2),visible:false,rendering:{opacity:1}},leaf={...node(1,2),rendering:{opacity:1}};
  await h.server.collections.store.create({id,projectId:project.id,sessionId:'synthetic',source});
  await h.server.collections.store.append(project.id,id,{collectionId:id,sequence:0,fileKey:source.fileKey,pageId:source.pageId,
    root,bounds,startedAt:time,observedAt:time,nodes:[root,leaf],childCounts:[2,0],complete:false,nextSequence:1,warnings:[],consistency:'live-session-observation'});
  const context=EvidenceScopeSchema.parse({id:randomUUID(),kind:'visual',name:'Context',source:{fileKey:source.fileKey,pageId:source.pageId,rootId:'root',revision:null,capturedAt:time},
    bounds,preview,visualObservation:{taskId:'historical-overview',observedAt:time},collection:null,warnings:[]});
  const visual=await h.server.store.mutate(project.id,0,{type:'add_evidence_scope',scope:context},'human',true);
  const saved=await h.server.evidence.createBranch(project.id,visual.revision,{collectionId:id,nodeId:leaf.id,contextScopeId:context.id});
  return {...h,saved,scope:saved.scopes!.at(-1)!,originalCollectionId:id,leaf};
}
test('V2 branch roundtrip preserves bounded coverage, full image context, hidden parent and first origin',async t=>{
  const h=await branchFixture(t),lines=[];for await(const line of h.server.transfers.export(h.saved.id,h.scope.id,h.saved.revision))lines.push(line);
  const header=JSON.parse(lines[0]!);assert.equal(header.version,2);assert.equal(header.scope.kind,'branch');assert.equal(header.collection.nodeCount,1);
  assert.equal(header.source.scopeId,'root');assert.equal(header.source.parentId,'root');
  assert.deepEqual(header.source.ancestorRendering,{status:'hidden',sourceNodeId:'root'});
  const imported=await h.server.transfers.import(h.target.id,0,strings(lines)),scope=imported.scopes![0]!;
  assert.equal(scope.kind,'branch');assert.equal(scope.collection,null);assert.equal(scope.branch!.nodeCount,1);
  assert.equal(scope.branch!.enclosingRootId,'root');assert.deepEqual(scope.branch!.ancestorRendering,{status:'hidden',sourceNodeId:'root'});
  assert.deepEqual(scope.coverageBounds,h.leaf.bbox);assert.deepEqual(scope.visualBounds,bounds);assert.deepEqual(scope.bounds,bounds);assert.deepEqual(scope.preview,preview);
  assert.equal(scope.source.capturedAt,time);assert.deepEqual(scope.transferOrigin,{kind:'branch',scopeId:h.scope.id,branch:h.scope.branch});
  assert.deepEqual(await h.server.evidence.records(imported,scope.id,[h.leaf.id]),[h.leaf]);
  await assert.rejects(h.server.evidence.records(imported,scope.id,['root']),{code:'NOT_FOUND'});
  assert.equal(h.server.collections.get(h.saved.id,h.originalCollectionId).status,'running');
  assert.equal(imported.annotations.length,0);assert.equal(imported.specifications.length,0);
  const target2=await h.server.store.create('Second transfer');
  const repeated=await h.server.transfers.import(target2.id,0,bytes(h.server.transfers.export(imported.id,scope.id,imported.revision)));
  assert.deepEqual(repeated.scopes![0]!.transferOrigin,scope.transferOrigin);
  assert.deepEqual(repeated.scopes![0]!.branch!.ancestorRendering,scope.branch!.ancestorRendering);
  assert.deepEqual(repeated.scopes![0]!.coverageBounds,h.leaf.bbox);
});
test('V2 branch rejects changed context and preserves committed backing after lost acknowledgement',async t=>{
  const h=await branchFixture(t),lines=[];for await(const line of h.server.transfers.export(h.saved.id,h.scope.id,h.saved.revision))lines.push(line);
  const header=JSON.parse(lines[0]!);header.source.ancestorRendering={status:'potential',sourceNodeId:null};
  await assert.rejects(h.server.transfers.import(h.target.id,0,strings([JSON.stringify(header)+'\n',...lines.slice(1)])),{code:'SOURCE_TRANSFER_INVALID'});
  assert.equal(h.server.collections.list(h.target.id).length,0);
  const mutate=h.server.store.mutate.bind(h.server.store);h.server.store.mutate=async(...args)=>{const result=await mutate(...args);if(args[2].type==='add_evidence_scope')throw new Error('Lost acknowledgement');return result;};
  await assert.rejects(h.server.transfers.import(h.target.id,0,strings(lines)));
  const saved=await h.server.store.get(h.target.id),scope=saved.scopes![0]!;
  assert.equal(h.server.collections.get(saved.id,scope.branch!.collectionId).status,'complete');
  assert.deepEqual(await h.server.evidence.records(saved,scope.id,[h.leaf.id]),[h.leaf]);
});
test('V2 complete legacy capture preserves text, provenance and separate observation times without approvals',async t=>{
  const h=await fixture(t,2),project=await h.server.store.create('Legacy capture');
  const acquisition={taskId:'historical-capture',structureStartedAt:time,structureFinishedAt:'2026-10-26T00:01:00.000Z',previewObservedAt:'2026-10-26T00:02:00.000Z',consistency:'separate-observations' as const};
  const snapshot=SnapshotSchema.parse({schemaVersion:'1.0.0',id:'legacy-source',name:'Legacy synthetic source',
    source:{fileKey:source.fileKey,pageId:source.pageId,rootId:'root',revision:'historical-revision',capturedAt:time},bounds,
    nodes:[node(1,2),node(0,2)],preview,completeness:{complete:true,reason:null},warnings:[],acquisition});
  const saved=await h.server.store.mutate(project.id,0,{type:'add_snapshot',snapshot},'human',true);
  const lines=[];for await(const line of h.server.transfers.export(saved.id,snapshot.id,saved.revision))lines.push(line);
  assert.equal(JSON.parse(lines[0]!).collection.id.length,36);assert.equal(JSON.parse(lines[1]!).collectionId.length,36);
  const imported=await h.server.transfers.import(h.target.id,0,strings(lines));
  const scope=imported.scopes![0]!;assert.equal(scope.kind,'collection');assert.deepEqual(scope.source,snapshot.source);
  assert.equal(scope.visualObservation!.observedAt,acquisition.previewObservedAt);assert.deepEqual(scope.preview,preview);
  assert.deepEqual(scope.transferOrigin,{kind:'snapshot',scopeId:snapshot.id,acquisition});
  assert.deepEqual(await h.server.evidence.records(imported,scope.id,['root','n1']),[node(0,2),node(1,2)]);
  assert.equal(scope.collection!.observedAt,acquisition.structureFinishedAt);assert.equal(imported.annotations.length,0);
  const packet=await h.server.collections.store.savedChunk(imported.id,scope.collection!.id,0);assert.equal(packet!.startedAt,time);
  for(const partial of [false,true]){
    const other=SnapshotSchema.parse({...snapshot,id:randomUUID(),source:{...snapshot.source,fileKey:partial?source.fileKey:null},
      nodes:snapshot.nodes.map(node=>({...node,sourceFileKey:partial?source.fileKey:null})),completeness:{complete:!partial,reason:partial?'Stopped':null}});
    const changed=await h.server.store.mutate(saved.id,(await h.server.store.get(saved.id)).revision,{type:'add_snapshot',snapshot:other},'human',true);
    await assert.rejects(async()=>{for await(const _ of h.server.transfers.export(changed.id,other.id,changed.revision))void _;},{code:'SOURCE_INCOMPLETE'});
  }
});
test('V1 complete collection imports remain compatible after V2 becomes the default export',async t=>{
  const h=await fixture(t,2),lines=[];for await(const line of h.server.transfers.export(h.saved.id,h.scope.id,h.saved.revision))lines.push(line);
  const {collection:_collection,...header}=JSON.parse(lines[0]!);header.version=1;lines[0]=JSON.stringify(header)+'\n';
  const footer=JSON.parse(lines.at(-1)!);footer.sha256=createHash('sha256').update(lines.slice(0,-1).join('')).digest('hex');lines[lines.length-1]=JSON.stringify(footer)+'\n';
  const imported=await h.server.transfers.import(h.target.id,0,strings(lines));
  assert.equal((await h.server.evidence.text(imported,imported.scopes![0]!.id,{nodeId:'n1',offset:0,limit:4000})).text,exact);
});
test('V2 historical branch preserves an unknown null parent without inventing ancestry',async t=>{
  const h=await fixture(t,2),project=await h.server.store.create('Unknown original parent'),id=randomUUID();
  const root={...node(0,2),parentId:null};
  await h.server.collections.store.create({id,projectId:project.id,sessionId:'synthetic',source});
  await h.server.collections.store.append(project.id,id,{collectionId:id,sequence:0,fileKey:source.fileKey,pageId:source.pageId,
    root,bounds,startedAt:time,observedAt:time,nodes:[root,node(1,2)],childCounts:[1,0],complete:true,nextSequence:null,warnings:[],consistency:'live-session-observation'});
  const saved=await h.server.evidence.createBranch(project.id,0,{collectionId:id,nodeId:'root'}),scope=saved.scopes![0]!;
  const imported=await h.server.transfers.import(h.target.id,0,bytes(h.server.transfers.export(saved.id,scope.id,saved.revision))),backed=imported.scopes![0]!;
  assert.equal(backed.kind,'branch');assert.deepEqual(backed.branch!.ancestorRendering,{status:'unknown',sourceNodeId:null});
  assert.equal(h.server.collections.get(imported.id,backed.branch!.collectionId).source.parentId,null);
  assert.equal((await h.server.evidence.records(imported,backed.id,['root']))[0]!.parentId,null);
});
