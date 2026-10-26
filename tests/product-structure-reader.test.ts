import test from 'node:test';
import assert from 'node:assert/strict';
import { StructureReader } from '../src/figma/structure-reader.js';
import type { CaptureHost, FigmaReadableNode } from '../src/figma/capture.js';
import type { PluginCommand } from '../src/shared/contracts.js';
import { STRUCTURE_CHUNK_BYTES, STRUCTURE_COLLECTION_BYTES } from '../src/shared/structure-collection.js';

const fileKey='synthetic-file',pageId='synthetic-page',rootId='synthetic-root',collectionId='synthetic-collection';
const bounds={x:0,y:0,width:100,height:80};
type ReadCommand=Extract<PluginCommand,{type:'read_structure_chunk'}>;
const command=(sequence:number):ReadCommand=>({type:'read_structure_chunk',fileKey,pageId,nodeId:rootId,collectionId,sequence});

test('raising a node budget continues at the first unread node without rereading saved parts',async()=>{
  const f=fixture();
  for(let index=0;index<8;index++)f.children.push({id:`budget-${index}`,name:'Leaf',type:'RECTANGLE',parent:f.root,absoluteBoundingBox:bounds});
  const reader=new StructureReader(f.host,{now:()=>0});
  const first=await reader.readChunk({...command(0),maxNodes:3});
  assert.deepEqual(first.nodes.map(node=>node.id),[rootId,'budget-0','budget-1']);assert.equal(first.complete,false);
  const next=await reader.readChunk({...command(1),maxNodes:20});
  assert.equal(next.nodes[0]!.id,'budget-2');assert.equal(next.complete,true);
  assert.equal(first.nodes.length+next.nodes.length,9);assert.equal(f.rootChildReads,1);
});

function fixture() {
  const page:FigmaReadableNode & {selection:FigmaReadableNode[]}={id:pageId,type:'PAGE',name:'Synthetic page',parent:null,selection:[]};
  Object.defineProperty(page,'children',{get(){throw new Error('Reader must not preload the page.');}});
  const root:FigmaReadableNode={id:rootId,type:'FRAME',name:'Synthetic scope',parent:page,absoluteBoundingBox:bounds};
  let rootChildReads=0;
  const children:FigmaReadableNode[]=[];
  Object.defineProperty(root,'children',{get(){rootChildReads++;return children;}});
  const host:CaptureHost={fileKey,currentPage:page,skipInvisibleInstanceChildren:true,
    getNodeByIdAsync:async id=>{assert.equal(id,rootId);return root;},
    setCurrentPageAsync:async()=>{throw new Error('Unexpected navigation.');},
    selectNodes:()=>{throw new Error('Unexpected selection change.');},
    scrollAndZoomIntoView:()=>{throw new Error('Unexpected viewport change.');}};
  return {page,root,children,host,get rootChildReads(){return rootChildReads;}};
}
function addChildren(parent:FigmaReadableNode,count:number,prefix:string):FigmaReadableNode[] {
  const children=Array.from({length:count},(_,index):FigmaReadableNode=>({
    id:`${prefix}-${index}`,name:`${prefix} ${index}`,type:index%19===0?'TEXT':'RECTANGLE',parent,
    absoluteBoundingBox:{x:index,y:index,width:10,height:10},visible:index%7!==0,
    ...(index%19===0?{characters:`Exact synthetic text ${index} 𝌆`}:{}),
  }));
  Object.defineProperty(parent,'children',{get(){return children;}});
  return children;
}

test('resumable DFS inventories 105,837 exact records without page preloading or a 10k prefix', {timeout:60000},async()=>{
  const f=fixture();
  // 1 root + 106 groups + 105,730 leaves = 105,837 unique records.
  for(let group=0;group<106;group++){
    const node:FigmaReadableNode={id:`group-${group}`,name:`Group ${group}`,type:'GROUP',parent:f.root,absoluteBoundingBox:bounds};
    f.children.push(node);
    addChildren(node,group===105?730:1000,`leaf-${group}`);
  }
  const reader=new StructureReader(f.host,{now:()=>0,observedAt:()=> '2026-10-25T00:00:00.000Z'});
  const seen=new Set<string>();let sequence=0,packets=0,bytes=0,last=null as Awaited<ReturnType<typeof reader.readChunk>>|null;
  while(true){
    const packet=await reader.readChunk(command(sequence),{yieldControl:async()=>{}});
    assert.equal(packet.sequence,sequence);assert.equal(packet.nodes.length,packet.childCounts.length);
    assert.ok(packet.nodes.length>=1&&packet.nodes.length<=500);
    const wireBytes=Buffer.byteLength(JSON.stringify(packet));assert.ok(wireBytes<=STRUCTURE_CHUNK_BYTES);
    bytes+=wireBytes;packets++;
    for(const node of packet.nodes){assert.ok(!seen.has(node.id),`duplicate ${node.id}`);seen.add(node.id);}
    assert.equal(packet.root.id,rootId);assert.deepEqual(packet.bounds,bounds);
    if(packet.complete){assert.equal(packet.nextSequence,null);last=packet;break;}
    assert.equal(packet.nextSequence,sequence+1);sequence=packet.nextSequence!;
  }
  assert.equal(seen.size,105837);assert.ok(packets>200);assert.ok(bytes<=STRUCTURE_COLLECTION_BYTES);
  assert.equal(f.rootChildReads,1);assert.equal(f.host.skipInvisibleInstanceChildren,true);
  assert.deepEqual(f.page.selection,[]);
  assert.deepEqual(await reader.readChunk(command(sequence)),last);
  assert.deepEqual(reader.release(collectionId),{released:true});
  assert.deepEqual(reader.release(collectionId),{released:true});
});

test('last packet replay is identical and out-of-order sequences cannot advance the cursor',async()=>{
  const f=fixture();
  for(let index=0;index<510;index++)f.children.push({id:`leaf-${index}`,name:`Leaf ${index}`,type:'RECTANGLE',parent:f.root,absoluteBoundingBox:bounds});
  const reader=new StructureReader(f.host,{now:()=>0});
  const first=await reader.readChunk(command(0));
  assert.equal(first.nodes.length,500);assert.equal(first.complete,false);
  assert.deepEqual(await reader.readChunk(command(0)),first);
  await assert.rejects(reader.readChunk(command(2)),{code:'CURSOR_SEQUENCE'});
  const second=await reader.readChunk(command(1));
  assert.equal(second.nodes.length,11);assert.equal(second.complete,true);
  assert.deepEqual(await reader.readChunk(command(1)),second);
  await assert.rejects(reader.readChunk(command(2)),{code:'CURSOR_SEQUENCE'});
  assert.equal(f.rootChildReads,1);
});

test('page event epoch and root metadata changes reject continuation explicitly',async()=>{
  const f=fixture();for(let index=0;index<510;index++)f.children.push({id:`leaf-${index}`,name:'Leaf',type:'RECTANGLE',parent:f.root,absoluteBoundingBox:bounds});
  let epoch=0;const reader=new StructureReader(f.host,{now:()=>0,getChangeEpoch:()=>epoch});
  await reader.readChunk(command(0));epoch++;
  await assert.rejects(reader.readChunk(command(1)),{code:'SOURCE_CHANGED'});
  await assert.rejects(reader.readChunk(command(1)),{code:'SOURCE_CHANGED'});
  await reader.readChunk(command(0));f.root.name='Changed root';
  await assert.rejects(reader.readChunk(command(1)),{code:'SOURCE_CHANGED'});
  assert.equal(f.host.skipInvisibleInstanceChildren,true);
});

test('source change during a yielded packet is not published as a complete or resumable prefix',async()=>{
  const f=fixture();for(let index=0;index<105;index++)f.children.push({id:`leaf-${index}`,name:'Leaf',type:'RECTANGLE',parent:f.root,absoluteBoundingBox:bounds});
  let epoch=0;const reader=new StructureReader(f.host,{now:()=>0,getChangeEpoch:()=>epoch});
  await assert.rejects(reader.readChunk(command(0),{yieldControl:async()=>{epoch++;}}),{code:'SOURCE_CHANGED'});
  assert.equal(f.host.skipInvisibleInstanceChildren,true);
  await assert.rejects(reader.readChunk(command(1)),{code:'SOURCE_CHANGED'});
});

test('page nodechange invalidation releases cached child arrays and reports source change',async()=>{
  const f=fixture();for(let index=0;index<510;index++)f.children.push({id:`leaf-${index}`,name:'Leaf',type:'RECTANGLE',parent:f.root,absoluteBoundingBox:bounds});
  const reader=new StructureReader(f.host,{now:()=>0});
  await reader.readChunk(command(0));assert.equal(reader.hasCursor(),true);
  reader.invalidateSource();assert.equal(reader.hasCursor(),false);
  await assert.rejects(reader.readChunk(command(1)),{code:'SOURCE_CHANGED'});
  reader.release(collectionId);
  await assert.rejects(reader.readChunk(command(1)),{code:'CURSOR_UNAVAILABLE'});
});

test('packet byte and soft time budgets preserve exact text and a resumable frontier',async()=>{
  const f=fixture();
  for(let index=0;index<45;index++)f.children.push({id:`text-${index}`,name:'Text',type:'TEXT',parent:f.root,
    absoluteBoundingBox:bounds,characters:`${index}:`+'𝌆'.repeat(12000)});
  let ticks=0;const reader=new StructureReader(f.host,{now:()=>ticks++*1001});
  const first=await reader.readChunk(command(0));
  assert.equal(first.nodes.length,1);assert.equal(first.complete,false);
  // A second reader with a fixed clock reaches the JSON wire budget first.
  const bytesReader=new StructureReader(f.host,{now:()=>0});
  const bytePacket=await bytesReader.readChunk({...command(0),collectionId:'byte-budget'});
  assert.ok(bytePacket.nodes.length<45);
  assert.ok(Buffer.byteLength(JSON.stringify(bytePacket))<=STRUCTURE_CHUNK_BYTES);
  assert.equal(bytePacket.nodes[1]!.text,`0:`+'𝌆'.repeat(12000));
  assert.equal(f.host.skipInvisibleInstanceChildren,true);
});

test('cancel during cooperative yield discards the draft and permits sequence-zero retry',async()=>{
  const f=fixture();for(let index=0;index<105;index++)f.children.push({id:`leaf-${index}`,name:'Leaf',type:'RECTANGLE',parent:f.root,absoluteBoundingBox:bounds});
  const reader=new StructureReader(f.host,{now:()=>0});let cancelled=false;
  await assert.rejects(reader.readChunk(command(0),{cancelled:()=>cancelled,yieldControl:async()=>{cancelled=true;}}),{code:'CANCELLED'});
  assert.equal(f.host.skipInvisibleInstanceChildren,true);
  cancelled=false;
  const packet=await reader.readChunk(command(0));
  assert.equal(packet.sequence,0);assert.equal(packet.nodes.length,106);assert.equal(packet.complete,true);
  assert.equal(f.host.skipInvisibleInstanceChildren,true);
});

test('a configured node limit preserves its final partial packet and never reports complete', {timeout:60000},async()=>{
  const f=fixture();
  for(let index=0;index<200000;index++)f.children.push({id:`leaf-${index}`,name:'Leaf',type:'RECTANGLE',parent:f.root,absoluteBoundingBox:bounds});
  const reader=new StructureReader(f.host,{now:()=>0});let sequence=0,published=0;
  await assert.rejects((async()=>{
    while(true){const packet=await reader.readChunk({...command(sequence),maxNodes:200000});published+=packet.nodes.length;
      assert.equal(packet.complete,false);sequence=packet.nextSequence!;}
  })(),{code:'COLLECTION_NODE_LIMIT'});
  assert.equal(published,200000);
  assert.equal(f.host.skipInvisibleInstanceChildren,true);
});

test('exactly 200,000 records may complete at the configured boundary', {timeout:60000},async()=>{
  const f=fixture();
  for(let index=0;index<199999;index++)f.children.push({id:`leaf-${index}`,name:'Leaf',type:'RECTANGLE',parent:f.root,absoluteBoundingBox:bounds});
  const reader=new StructureReader(f.host,{now:()=>0});let sequence=0,count=0;
  while(true){
    const packet=await reader.readChunk(command(sequence));count+=packet.nodes.length;
    if(packet.complete){assert.equal(packet.nextSequence,null);break;}
    sequence=packet.nextSequence!;
  }
  assert.equal(count,200000);
  assert.equal(f.host.skipInvisibleInstanceChildren,true);
});

test('128 MB cumulative wire ceiling rejects overflow without falsely completing exact text', {timeout:60000},async()=>{
  const f=fixture(),text='X'.repeat(50000);
  for(let index=0;index<2900;index++)f.children.push({id:`text-${index}`,name:'Text',type:'TEXT',parent:f.root,absoluteBoundingBox:bounds,characters:text});
  const reader=new StructureReader(f.host,{now:()=>0});let sequence=0,published=0;
  await assert.rejects((async()=>{
    while(true){const packet=await reader.readChunk(command(sequence));published+=packet.nodes.length;
      assert.equal(packet.complete,false);sequence=packet.nextSequence!;}
  })(),{code:'COLLECTION_BYTE_LIMIT'});
  assert.ok(published<2901);
  assert.equal(f.host.skipInvisibleInstanceChildren,true);
});
