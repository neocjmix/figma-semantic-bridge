import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, approvedContext, createProject, DomainError, validateProject } from '../src/core/project.js';
import type { Annotation, Operation, Project, Snapshot } from '../src/shared/contracts.js';

const now='2026-10-23T00:00:00.000Z';
const bbox={x:20,y:20,width:100,height:100};
const snapshot:Snapshot={schemaVersion:'1.0.0',id:'scope',name:'Overlapping source candidates',
  source:{fileKey:'synthetic',pageId:'page',rootId:'root',revision:null,capturedAt:now},
  bounds:{x:0,y:0,width:500,height:500},preview:null,completeness:{complete:true,reason:null},warnings:[],
  nodes:[
    {id:'root',parentId:'page',type:'FRAME',name:'Root',bbox:{x:0,y:0,width:500,height:500},visible:true,sourceFileKey:'synthetic',sourcePageId:'page'},
    ...['branch-a','branch-b'].map(id=>({id,parentId:'root',type:'FRAME',name:id,bbox:{...bbox},visible:true,sourceFileKey:'synthetic',sourcePageId:'page'})),
  ]};
const annotation=(id='a'):Annotation=>({id,snapshotId:'scope',name:'Human region',role:'component',bbox:{...bbox},parentId:null,
  sourceRefs:[{snapshotId:'scope',nodeId:'branch-a',matchType:'exact'}],origin:'human',reviewStatus:'proposed',revision:0});
const human={actor:'human' as const,now,id:()=> 'generated-id'};
const apply=(p:Project,operation:Operation)=>applyOperation(p,operation,human);
const setup=()=>apply(createProject('review-project','Review',now),{type:'add_snapshot',snapshot});
const current=(p:Project)=>p.annotations.find(a=>a.id==='a')!;
const withRegion=()=>apply(setup(),{type:'upsert_annotation',annotation:annotation()});
const confirm=(p:Project)=>apply(p,{type:'confirm_annotation_sources',id:'a',expectedAnnotationRevision:current(p).revision});
const hasCode=(code:string)=>(error:unknown)=>error instanceof DomainError&&error.code===code;

test('ambiguous match diagnostics persist across reload and require explicit human source confirmation',()=>{
  let p=apply(withRegion(),{type:'match_annotation',id:'a',tolerance:0.5});
  const review=current(p).sourceReview!;
  assert.equal(review.ambiguous,true);assert.equal(review.status,'unconfirmed');assert.equal(review.confirmedAt,null);
  assert.deepEqual(review.candidates.filter(c=>c.iou===1).map(c=>c.nodeId),['branch-a','branch-b']);
  assert.ok(review.warnings.some(w=>/multiple source candidates/.test(w)));
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))).annotations[0]!.sourceReview,review);
  const before=JSON.stringify(p);
  assert.throws(()=>apply(p,{type:'review_annotation',id:'a',status:'approved'}),hasCode('SOURCE_CONFIRMATION_REQUIRED'));
  assert.equal(JSON.stringify(p),before);
  p=confirm(p);assert.equal(current(p).sourceReview?.status,'confirmed');
  assert.equal(current(p).sourceReview?.confirmedAt,now);assert.equal(current(p).reviewStatus,'proposed');
  p=apply(p,{type:'review_annotation',id:'a',status:'approved'});
  assert.deepEqual(approvedContext(p).annotations[0]?.sourceReview,current(p).sourceReview);
});

test('confirmation rejects stale revisions, empty source sets and AI operations without mutating state',()=>{
  const p=withRegion(),before=JSON.stringify(p);
  assert.throws(()=>apply(p,{type:'confirm_annotation_sources',id:'a',expectedAnnotationRevision:current(p).revision+1}),hasCode('STALE_SOURCE_REVIEW'));
  assert.throws(()=>applyOperation(p,{type:'confirm_annotation_sources',id:'a',expectedAnnotationRevision:current(p).revision},{...human,actor:'ai'}),hasCode('FORBIDDEN'));
  const empty=apply(p,{type:'upsert_annotation',annotation:{...current(p),sourceRefs:[]}});
  assert.throws(()=>confirm(empty),hasCode('SOURCE_REFERENCES_REQUIRED'));
  assert.equal(JSON.stringify(p),before);
});

test('source edits, coordinate changes, snapshot changes and rematching invalidate confirmation',()=>{
  const confirmed=confirm(withRegion());
  const mutations:Operation[]=[
    {type:'upsert_annotation',annotation:{...current(confirmed),sourceRefs:[{snapshotId:'scope',nodeId:'branch-b',matchType:'partial'}]}},
    {type:'upsert_annotation',annotation:{...current(confirmed),bbox:{...bbox,x:21}}},
    {type:'match_annotation',id:'a',tolerance:0.5},
  ];
  for(const operation of mutations) {
    const changed=apply(confirmed,operation);
    assert.equal(current(changed).sourceReview?.status,'unconfirmed');assert.equal(current(changed).sourceReview?.confirmedAt,null);
    assert.equal(current(changed).reviewStatus,'proposed');
  }
  let p=apply(confirmed,{type:'add_snapshot',snapshot:{...snapshot,id:'scope-2'}});
  p=apply(p,{type:'upsert_annotation',annotation:{...current(p),snapshotId:'scope-2',sourceRefs:[{snapshotId:'scope-2',nodeId:'branch-a',matchType:'exact'}]}});
  assert.equal(current(p).sourceReview?.status,'unconfirmed');assert.equal(current(p).sourceReview?.confirmedAt,null);
});

test('name, role and parent changes preserve source confirmation while reopening semantic approval',()=>{
  let p=confirm(withRegion());p=apply(p,{type:'review_annotation',id:'a',status:'approved'});
  p=apply(p,{type:'upsert_annotation',annotation:{...annotation('parent'),bbox:snapshot.bounds,sourceRefs:[{snapshotId:'scope',nodeId:'root',matchType:'exact'}]}});
  const evidence=current(p).sourceReview;
  p=apply(p,{type:'upsert_annotation',annotation:{...current(p),name:'Renamed',role:'section',parentId:'parent'}});
  assert.equal(current(p).reviewStatus,'proposed');assert.deepEqual(current(p).sourceReview,evidence);
});

test('incoming human or AI review fields cannot forge confirmed source evidence',()=>{
  const forged={candidates:[{nodeId:'uncaptured',coverage:1,iou:1,reason:'Forged'}],ambiguous:false,warnings:[],status:'confirmed' as const,confirmedAt:now};
  let p=apply(setup(),{type:'upsert_annotation',annotation:{...annotation(),sourceReview:forged}});
  assert.equal(current(p).sourceReview?.ambiguous,true);assert.equal(current(p).sourceReview?.status,'unconfirmed');
  assert.ok(!current(p).sourceReview?.candidates.some(c=>c.nodeId==='uncaptured'));
  p=applyOperation(setup(),{type:'submit_proposal',draft:{annotations:[{...annotation(),sourceReview:forged}],specifications:[]},warnings:[]},{...human,actor:'ai'});
  assert.equal(p.proposals[0]?.draft.annotations[0]?.sourceReview,undefined);
  p=apply(p,{type:'resolve_proposal',id:p.proposals[0]!.id,decision:'accept'});
  assert.equal(current(p).sourceReview?.status,'unconfirmed');
  assert.throws(()=>apply(p,{type:'review_annotation',id:'a',status:'approved'}),hasCode('SOURCE_CONFIRMATION_REQUIRED'));
});

test('legacy approved records remain unchanged and legacy proposed ambiguity cannot bypass review',()=>{
  const legacy=setup();legacy.annotations=[{...annotation(),reviewStatus:'approved'}];
  const before=JSON.stringify(legacy);
  assert.deepEqual(validateProject(legacy).annotations,legacy.annotations);
  assert.equal(approvedContext(legacy).annotations[0]?.sourceReview,undefined);
  assert.equal(JSON.stringify(legacy),before);
  const pending=structuredClone(legacy);pending.annotations[0]!.reviewStatus='proposed';
  assert.throws(()=>apply(pending,{type:'review_annotation',id:'a',status:'approved'}),hasCode('SOURCE_CONFIRMATION_REQUIRED'));
  const resolved=confirm(pending);assert.equal(current(resolved).sourceReview?.status,'confirmed');
  assert.equal(apply(resolved,{type:'review_annotation',id:'a',status:'approved'}).annotations[0]?.reviewStatus,'approved');
});

test('nonambiguous source references can be approved without a separate confirmation',()=>{
  let p=apply(setup(),{type:'upsert_annotation',annotation:{...annotation(),bbox:snapshot.bounds,sourceRefs:[{snapshotId:'scope',nodeId:'root',matchType:'exact'}]}});
  assert.equal(current(p).sourceReview?.ambiguous,false);
  p=apply(p,{type:'review_annotation',id:'a',status:'approved'});
  assert.equal(current(p).reviewStatus,'approved');
});

test('split and merge retain new match diagnostics and require a fresh source decision',()=>{
  let p=confirm(withRegion());
  p=apply(p,{type:'split_annotation',id:'a',axis:'vertical',ratio:0.5});
  assert.equal(p.annotations.length,2);
  for(const item of p.annotations) {
    assert.ok(item.sourceReview?.candidates.length);assert.equal(item.sourceReview?.status,'unconfirmed');
    assert.equal(item.sourceReview?.confirmedAt,null);
  }
  p=apply(p,{type:'merge_annotations',ids:p.annotations.map(a=>a.id),name:'Merged region'});
  assert.equal(p.annotations[0]?.sourceReview?.ambiguous,true);
  assert.equal(p.annotations[0]?.sourceReview?.status,'unconfirmed');
});

test('persisted review candidates stay bounded and cannot refer outside the captured snapshot',()=>{
  const large=structuredClone(snapshot);
  large.nodes.push(...Array.from({length:250},(_,index)=>({...snapshot.nodes[1]!,id:`equal-${index}`})));
  let p=apply(createProject('bounded','Bounded review',now),{type:'add_snapshot',snapshot:large});
  p=apply(p,{type:'upsert_annotation',annotation:annotation()});
  assert.equal(current(p).sourceReview?.candidates.length,200);assert.equal(current(p).sourceReview?.ambiguous,true);
  assert.equal(current(p).sourceReview?.warnings.filter(w=>/Only the first 200 candidate diagnostics.*search all captured nodes/.test(w)).length,1);
  assert.equal(current(p).sourceRefs[0]?.nodeId,'branch-a');
  const broken=structuredClone(p);current(broken).sourceReview!.candidates[0]!.nodeId='uncaptured';
  assert.throws(()=>validateProject(broken),hasCode('INVALID_PROJECT'));
});
