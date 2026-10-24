import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRenderingEvidence } from '../src/core/rendering-evidence.js';
import { matchRegion } from '../src/core/matching.js';
import { applyOperation, createProject, validateProject } from '../src/core/project.js';
import { SourceNodeSchema, type Annotation, type Snapshot, type SourceNode } from '../src/shared/contracts.js';

const now='2026-10-24T00:00:00.000Z';
const box={x:10,y:10,width:80,height:80};
const node=(id:string,parentId:string|null='root',opacity:number|null=1):SourceNode=>({id,parentId,type:'FRAME',name:id,bbox:box,visible:true,sourceFileKey:'synthetic',sourcePageId:'page',rendering:opacity===null?{}:{opacity}});
const scope=(nodes:SourceNode[]):Snapshot=>({schemaVersion:'1.0.0',id:'scope',name:'Synthetic rendering',source:{fileKey:'synthetic',pageId:'page',rootId:'root',revision:null,capturedAt:now},bounds:{x:0,y:0,width:100,height:100},nodes,preview:null,completeness:{complete:true,reason:null},warnings:[]});
const root=()=>({...node('root','page'),bbox:{x:0,y:0,width:100,height:100}});
const human={actor:'human' as const,now,id:()=> 'new-id'};
const annotation=(id='visible'):Annotation=>({id:'a',snapshotId:'scope',name:'Region',role:'component',bbox:box,parentId:null,sourceRefs:[{snapshotId:'scope',nodeId:id,matchType:'exact'}],origin:'human',reviewStatus:'proposed',revision:0});
const setup=(s:Snapshot,ref='visible')=>applyOperation(applyOperation(createProject('p','Test',now),{type:'add_snapshot',snapshot:s},human),{type:'upsert_annotation',annotation:annotation(ref)},human);

test('rendering evidence follows observed ancestry with hidden precedence and no opacity underflow',()=>{
  const nodes=[root(),node('zero','root',0),node('child','zero'),{...node('hidden','zero'),visible:false},node('hidden-child','hidden'),node('unknown','root',null),node('unknown-child','unknown'),node('tiny','root',1e-200),node('tinier','tiny',1e-200),node('external','unobserved'),node('transparent-external','unobserved',0)];
  const before=JSON.stringify(nodes), evidence=buildRenderingEvidence(nodes,'page');
  for(const id of ['zero','child','transparent-external'])assert.equal(evidence.get(id)?.status,'transparent');
  for(const id of ['hidden','hidden-child'])assert.equal(evidence.get(id)?.status,'hidden');
  for(const id of ['unknown','unknown-child','external'])assert.equal(evidence.get(id)?.status,'unknown');
  for(const id of ['root','tiny','tinier'])assert.equal(evidence.get(id)?.status,'potential');
  assert.equal(evidence.get('child')?.sourceNodeId,'zero');
  assert.equal(evidence.get('hidden-child')?.sourceNodeId,'hidden');
  assert.equal(JSON.stringify(nodes),before);
});

test('bounded evidence index rejects duplicate IDs and cycles and handles 10000-deep ancestry iteratively',()=>{
  assert.throws(()=>buildRenderingEvidence([node('a','b'),node('b','a')]));
  assert.throws(()=>buildRenderingEvidence([root(),root()]));
  const chain=Array.from({length:10000},(_,i)=>node(String(i),i?String(i-1):'page'));
  assert.equal(buildRenderingEvidence(chain).get('9999')?.status,'potential');
  assert.throws(()=>buildRenderingEvidence([...chain,node('extra')]));
});

test('optional rendering contract rejects invalid observations and preserves legacy shape',()=>{
  const legacy=node('legacy');delete legacy.rendering;
  assert.deepEqual(SourceNodeSchema.parse(legacy),legacy);
  for(const rendering of [{opacity:-1},{opacity:1.1},{opacity:NaN},{opacity:Infinity},{siblingIndex:-1},{siblingIndex:0.5},{invented:true}])assert.equal(SourceNodeSchema.safeParse({...legacy,rendering}).success,false);
  assert.deepEqual(SourceNodeSchema.parse({...legacy,rendering:{opacity:0,siblingIndex:3}}).rendering,{opacity:0,siblingIndex:3});
});

test('automatic geometry excludes zero-opacity subtrees without deleting raw data or changing certainty',()=>{
  const s=scope([root(),node('old','root',0),node('old-child','old'),node('visible')]);
  const before=JSON.stringify(s),result=matchRegion(s,box);
  assert.deepEqual(result.sourceRefs.map(ref=>ref.nodeId),['visible']);
  assert.equal(result.ambiguous,false);
  assert.ok(!result.candidates.some(c=>c.nodeId.startsWith('old')));
  assert.equal(JSON.stringify(s),before);
});

test('manual transparent refs remain selectable but require separate revision-bound confirmation',()=>{
  let p=setup(scope([root(),node('old','root',0),node('visible')]),'old');
  assert.equal(p.annotations[0]!.sourceReview?.ambiguous,false);
  assert.equal(p.annotations[0]!.sourceReview?.renderingReviewRequired,true);
  assert.throws(()=>applyOperation(p,{type:'review_annotation',id:'a',status:'approved'},human),/confirm/i);
  p=applyOperation(p,{type:'confirm_annotation_sources',id:'a',expectedAnnotationRevision:p.annotations[0]!.revision},human);
  p=applyOperation(p,{type:'review_annotation',id:'a',status:'approved'},human);
  assert.equal(p.annotations[0]!.sourceRefs[0]!.nodeId,'old');
  const before=JSON.stringify(p);assert.equal(JSON.stringify(validateProject(p)),before);
  p=applyOperation(p,{type:'upsert_annotation',annotation:{...p.annotations[0]!,sourceRefs:annotation().sourceRefs}},human);
  assert.equal(p.annotations[0]!.sourceReview?.renderingReviewRequired,false);
  assert.equal(p.annotations[0]!.sourceReview?.status,'unconfirmed');
});

test('new unknown evidence requires confirmation, while legacy unknown approval remains compatible',()=>{
  const s=scope([root(),node('visible','root',null)]);
  const modern=setup(s);
  assert.equal(modern.annotations[0]!.sourceReview?.renderingReviewRequired,true);
  assert.throws(()=>applyOperation(modern,{type:'review_annotation',id:'a',status:'approved'},human),/confirm/i);
  for(const n of s.nodes)delete n.rendering;
  const legacy=setup(s);
  assert.equal(legacy.annotations[0]!.sourceReview?.renderingReviewRequired,undefined);
  assert.equal(applyOperation(legacy,{type:'review_annotation',id:'a',status:'approved'},human).annotations[0]!.reviewStatus,'approved');
});

test('legacy pending hidden references cannot bypass new confirmation through saved diagnostics or name-only edits',()=>{
  const s=scope([root(),{...node('visible'),visible:false}]);for(const n of s.nodes)delete n.rendering;
  const pending=setup(s);delete pending.annotations[0]!.sourceReview!.renderingReviewRequired;
  for(const p of [pending,applyOperation(pending,{type:'upsert_annotation',annotation:{...pending.annotations[0]!,name:'Renamed'}},human)]) {
    assert.throws(()=>applyOperation(p,{type:'review_annotation',id:'a',status:'approved'},human),/confirm/i);
  }
  const approved=structuredClone(pending);approved.annotations[0]!.reviewStatus='approved';
  assert.deepEqual(validateProject(approved),approved);
});
