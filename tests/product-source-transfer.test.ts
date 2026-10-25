import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server/index.js';
import { transferLines } from '../src/server/source-transfer.js';
import type { SourceNode } from '../src/shared/contracts.js';
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
