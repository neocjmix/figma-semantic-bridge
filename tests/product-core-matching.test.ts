import assert from 'node:assert/strict';
import test from 'node:test';
import { matchRegion, SpatialNodeIndex } from '../src/core/matching.js';
import { clientToDocument, documentToImage, imageToDocument, documentRectToImage, imageRectToDocument } from '../src/core/coordinates.js';
import type { Snapshot, SourceNode, Rect } from '../src/shared/contracts.js';

const box = (x=0,y=0,width=100,height=100):Rect => ({x,y,width,height});
const node = (id:string,bbox:Rect,parentId:string|null='root',type='FRAME',visible=true):SourceNode => ({id,parentId,bbox,type,visible,name:id,sourceFileKey:'file',sourcePageId:'page'});
const snapshot = (nodes:SourceNode[]):Snapshot => ({schemaVersion:'1.0.0',id:'snap',name:'Synthetic',source:{fileKey:'file',pageId:'page',rootId:'root',revision:null,capturedAt:'2026-10-22T00:00:00.000Z'},bounds:box(0,0,1000,1000),nodes,preview:null,completeness:{complete:true,reason:null},warnings:[]});

test('exact node matching is deterministic and equal-box ambiguity retains ancestry preference',()=>{
  const s=snapshot([node('root',box(0,0,1000,1000),null),node('z-frame',box()),node('a-bg',box(),'z-frame','RECTANGLE')]);
  const r=matchRegion(s,box());
  assert.equal(r.sourceRefs[0]?.nodeId,'z-frame');
  assert.equal(r.sourceRefs[0]?.matchType,'exact');
  assert.equal(r.ambiguous,true);
  assert.deepEqual(matchRegion({...s,nodes:[...s.nodes].reverse()},box()),r);
});

test('aggregate chooses the minimal original-tree frontier, not a broad unrelated ancestor',()=>{
  const s=snapshot([node('root',box(0,0,1000,1000),null),node('left',box(0,0,100,100)),node('left-text',box(10,10,30,20),'left','TEXT'),node('right',box(100,0,100,100))]);
  const r=matchRegion(s,box(0,0,200,100));
  assert.deepEqual(r.sourceRefs.map(v=>v.nodeId),['left','right']);
  assert.ok(r.sourceRefs.every(v=>v.matchType==='aggregate'));
  assert.equal(r.ambiguous,false);
});

test('near-edge fits honor tolerance without treating distant root as a match',()=>{
  const s=snapshot([node('root',box(0,0,1000,1000),null),node('item',box(10,10,100,100))]);
  assert.equal(matchRegion(s,box(9.7,10,100,100),{tolerance:0.5}).sourceRefs[0]?.nodeId,'item');
  assert.equal(matchRegion(s,box(500,500,10,10)).sourceRefs.length,0);
  assert.throws(()=>matchRegion(s,box(),{tolerance:NaN}));
  assert.throws(()=>matchRegion(s,box(),{maxCandidates:0}));
});

test('partial overlaps are explicit and hidden ancestors suppress descendants',()=>{
  const s=snapshot([node('root',box(0,0,1000,1000),null),node('a',box(0,0,120,100)),node('b',box(80,0,120,100)),node('hidden',box(0,0,200,100),'root','GROUP',false),node('hidden-child',box(0,0,200,100),'hidden')]);
  const r=matchRegion(s,box(20,0,160,100));
  assert.ok(!r.sourceRefs.some(v=>v.nodeId.startsWith('hidden')));
  assert.deepEqual(r.sourceRefs.map(v=>v.nodeId),['a','b']);
  assert.equal(r.ambiguous,true);
  assert.ok(r.warnings.some(v=>v.includes('partial')));
});

test('candidate overflow never asserts a complete aggregate and source cycles fail safely',()=>{
  const s=snapshot([node('root',box(0,0,1000,1000),null),...Array.from({length:10},(_,i)=>node(`n${i}`,box(i*10,0,9,10)))]);
  const r=matchRegion(s,box(0,0,100,10),{maxCandidates:3});
  assert.equal(r.sourceRefs.length,0);
  assert.equal(r.ambiguous,true);
  assert.ok(r.warnings.some(v=>v.includes('candidate limit')));
  assert.throws(()=>new SpatialNodeIndex([node('a',box(),'b'),node('b',box(),'a')]));
});

test('spatial query skips disjoint intervals and touching edges',()=>{
  const index=new SpatialNodeIndex([node('a',box(0,0,10,10),null),node('b',box(100,0,10,10),null)]);
  assert.deepEqual(index.query(box(5,5,2,2)).map(v=>v.id),['a']);
  assert.deepEqual(index.query(box(10,0,10,10)).map(v=>v.id),[]);
});

test('document/image/client transforms preserve offsets and independent display scaling',()=>{
  const geometry={bounds:box(-100,50,800,400),width:1600,height:800};
  assert.deepEqual(documentToImage({x:300,y:250},geometry),{x:800,y:400});
  assert.deepEqual(imageToDocument({x:800,y:400},geometry),{x:300,y:250});
  assert.deepEqual(clientToDocument({x:220,y:160},{left:20,top:60,width:400,height:200},geometry.bounds),{x:300,y:250});
  const rectangle=box(0,100,200,50);
  assert.deepEqual(imageRectToDocument(documentRectToImage(rectangle,geometry),geometry),rectangle);
  assert.throws(()=>clientToDocument({x:1,y:2},{left:0,top:0,width:0,height:5},geometry.bounds));
  assert.throws(()=>documentToImage({x:Infinity,y:0},geometry));
});

test('exact bounds outrank a near-equal ancestor and partial parent is not hidden by its contained text',()=>{
  const first=snapshot([node('root',box(0,0,1000,1000),null),node('near',box(0,0,100.2,100)),node('exact',box(),'near')]);
  assert.equal(matchRegion(first,box()).sourceRefs[0]?.nodeId,'exact');
  const second=snapshot([node('root',box(0,0,1000,1000),null),node('partial',box(0,0,120,100)),node('text',box(30,10,20,20),'partial','TEXT')]);
  const result=matchRegion(second,box(20,0,150,100));
  assert.deepEqual(result.sourceRefs.map(r=>r.nodeId),['partial']);
  assert.equal(result.sourceRefs[0]?.matchType,'partial');
  assert.equal(result.ambiguous,true);
});
