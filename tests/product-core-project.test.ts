import test from 'node:test';
import assert from 'node:assert/strict';
import type { Annotation, Project, Snapshot, Specification } from '../src/shared/contracts.js';
import { applyOperation, approvedContext, approvedRecords, createProject, validateProject, sourceTextForReferences, DomainError } from '../src/core/project.js';

const now = '2026-10-22T23:00:00.000Z';
const snapshot:Snapshot = {
  schemaVersion:'1.0.0', id:'scope', name:'Generated screen', source:{fileKey:'synthetic',pageId:'page',rootId:'root',revision:null,capturedAt:now},
  bounds:{x:100,y:200,width:400,height:300}, preview:null, completeness:{complete:true,reason:null}, warnings:[],
  nodes:[
    {id:'root',parentId:'page',type:'FRAME',name:'screen',bbox:{x:100,y:200,width:400,height:300},visible:true,sourceFileKey:'synthetic',sourcePageId:'page'},
    {id:'left',parentId:'root',type:'FRAME',name:'panel',bbox:{x:110,y:210,width:100,height:100},visible:true,sourceFileKey:'synthetic',sourcePageId:'page'},
    {id:'t1',parentId:'root',type:'TEXT',name:'rule',text:'  Preserve original\ntext.  ',bbox:{x:250,y:220,width:100,height:20},visible:true,sourceFileKey:'synthetic',sourcePageId:'page'},
    {id:'t2',parentId:'root',type:'TEXT',name:'rule2',text:'Second rule.',bbox:{x:250,y:250,width:100,height:20},visible:true,sourceFileKey:'synthetic',sourcePageId:'page'},
  ],
};
const annotation = (id='a', parentId:string|null=null):Annotation => ({id,snapshotId:'scope',name:id,role:'component',bbox:{x:110,y:210,width:100,height:100},parentId,sourceRefs:[{snapshotId:'scope',nodeId:'left',matchType:'exact'}],origin:'human',reviewStatus:'proposed',revision:0});
const specification = (id='s'):Specification => ({id,text:snapshot.nodes[2]!.text!,sourceRefs:[{snapshotId:'scope',nodeId:'t1',matchType:'contained'}],relations:[{targetAnnotationId:'a',relationType:'behavior',reviewStatus:'proposed'}],origin:'human',reviewStatus:'proposed',revision:0});
let ids=0;
const human={actor:'human' as const,now,id:()=>`new-${++ids}`};
const ai={...human,actor:'ai' as const};
const setup=()=>applyOperation(createProject('project','Example',now),{type:'add_snapshot',snapshot},human);
const apply=(project:Project,operation:Parameters<typeof applyOperation>[1])=>applyOperation(project,operation,human);
const hasCode=(code:string)=>(e:unknown)=>e instanceof DomainError&&e.code===code;

test('project contract rejects cycles, source identity errors, missing source refs and immutable snapshot replacement',()=>{
  let p=setup();
  p=apply(p,{type:'upsert_annotation',annotation:annotation()});
  p=apply(p,{type:'upsert_annotation',annotation:annotation('b','a')});
  assert.throws(()=>apply(p,{type:'upsert_annotation',annotation:{...annotation(),parentId:'b'}}),hasCode('INVALID_PROJECT'));
  assert.throws(()=>apply(p,{type:'upsert_annotation',annotation:{...annotation('c'),sourceRefs:[{snapshotId:'scope',nodeId:'missing',matchType:'exact'}]}}),hasCode('INVALID_PROJECT'));
  assert.throws(()=>apply(p,{type:'add_snapshot',snapshot}),hasCode('ALREADY_EXISTS'));
  const broken=structuredClone(p);broken.snapshots[0]!.nodes[1]!.sourcePageId='other';
  assert.throws(()=>validateProject(broken),hasCode('INVALID_PROJECT'));
  const cyclic=structuredClone(p);cyclic.snapshots[0]!.nodes[1]!.parentId='t1';cyclic.snapshots[0]!.nodes[2]!.parentId='left';
  assert.throws(()=>validateProject(cyclic),hasCode('INVALID_PROJECT'));
});

test('human mutations are immutable, revisioned and require explicit review; edits invalidate linked approvals',()=>{
  let p=setup();const before=structuredClone(p);
  p=apply(p,{type:'upsert_annotation',annotation:{...annotation(),reviewStatus:'approved'}});
  assert.deepEqual(before,setup());
  assert.equal(p.annotations[0]!.reviewStatus,'proposed');
  p=apply(p,{type:'review_annotation',id:'a',status:'approved'});
  p=apply(p,{type:'upsert_specification',specification:specification()});
  p=apply(p,{type:'review_specification',id:'s',status:'approved'});
  const old=p;
  p=apply(p,{type:'upsert_annotation',annotation:{...p.annotations[0]!,name:'Edited'}});
  assert.equal(old.annotations[0]!.reviewStatus,'approved');
  assert.equal(p.annotations[0]!.reviewStatus,'proposed');
  assert.equal(p.specifications[0]!.reviewStatus,'proposed');
  assert.equal(p.specifications[0]!.relations[0]!.reviewStatus,'proposed');
  assert.equal(p.revision,old.revision+1);
});

test('spec text remains verbatim across ordered refs and supports many-to-many relationships',()=>{
  let p=setup();p=apply(p,{type:'upsert_annotation',annotation:annotation()});p=apply(p,{type:'upsert_annotation',annotation:annotation('b')});
  const refs=[{snapshotId:'scope',nodeId:'t2',matchType:'contained' as const},{snapshotId:'scope',nodeId:'t1',matchType:'contained' as const}];
  const text=sourceTextForReferences(p,refs);
  assert.equal(text,'Second rule.\n\n  Preserve original\ntext.  ');
  const s={...specification(),text,sourceRefs:refs,relations:[...specification().relations,{targetAnnotationId:'b',relationType:'constraint' as const,reviewStatus:'proposed' as const}]};
  p=apply(p,{type:'upsert_specification',specification:s});
  assert.equal(p.specifications[0]!.relations.length,2);
  assert.throws(()=>apply(p,{type:'upsert_specification',specification:{...s,text:text.trim()}}),hasCode('INVALID_PROJECT'));
  assert.throws(()=>apply(p,{type:'review_specification',id:'s',status:'approved'}),hasCode('APPROVAL_REQUIRED'));
});

test('AI can only submit valid proposals and cannot replace approved records, even after human acceptance',()=>{
  let p=setup();p=apply(p,{type:'upsert_annotation',annotation:annotation()});p=apply(p,{type:'review_annotation',id:'a',status:'approved'});
  assert.throws(()=>applyOperation(p,{type:'rename_project',name:'AI override'},ai),hasCode('FORBIDDEN'));
  assert.throws(()=>applyOperation(p,{type:'submit_proposal',draft:{annotations:[{...annotation(),name:'override'}],specifications:[]},warnings:[]},ai),hasCode('APPROVED_PROTECTED'));
  p=applyOperation(p,{type:'submit_proposal',draft:{annotations:[{...annotation('b'),reviewStatus:'approved'}],specifications:[]},warnings:[]},ai);
  const id=p.proposals[0]!.id;
  assert.equal(p.annotations.length,1);
  p=apply(p,{type:'resolve_proposal',id,decision:'accept'});
  assert.equal(p.annotations[1]!.reviewStatus,'proposed');assert.equal(p.annotations[1]!.origin,'ai');
  assert.equal(p.annotations[0]!.reviewStatus,'approved');
});

test('stale proposals cannot overwrite intervening human edits and rejection does not mutate annotations',()=>{
  let p=setup();p=applyOperation(p,{type:'submit_proposal',draft:{annotations:[annotation()],specifications:[]},warnings:[]},ai);
  const id=p.proposals[0]!.id;p=apply(p,{type:'rename_project',name:'Human changed state'});
  assert.throws(()=>apply(p,{type:'resolve_proposal',id,decision:'accept'}),hasCode('STALE_PROPOSAL'));
  p=apply(p,{type:'resolve_proposal',id,decision:'reject'});assert.equal(p.proposals[0]!.status,'rejected');assert.equal(p.annotations.length,0);
});

test('split, merge and delete preserve references and hierarchy integrity',()=>{
  let p=setup();p=apply(p,{type:'upsert_annotation',annotation:annotation()});p=apply(p,{type:'upsert_specification',specification:specification()});
  p=apply(p,{type:'split_annotation',id:'a',axis:'vertical',ratio:0.5});
  assert.equal(p.annotations.length,2);assert.equal(p.specifications[0]!.relations.length,2);
  const newIds=p.annotations.map(a=>a.id);
  p=apply(p,{type:'merge_annotations',ids:newIds,name:'Combined'});
  assert.equal(p.annotations.length,1);assert.equal(p.specifications[0]!.relations.length,1);
  const mergedId=p.annotations[0]!.id;p=apply(p,{type:'upsert_annotation',annotation:annotation('child',mergedId)});
  assert.throws(()=>apply(p,{type:'delete_annotation',id:mergedId}),hasCode('HAS_CHILDREN'));
  p=apply(p,{type:'delete_annotation',id:'child'});p=apply(p,{type:'delete_annotation',id:mergedId});
  assert.equal(p.specifications[0]!.relations.length,0);assert.equal(p.specifications[0]!.reviewStatus,'proposed');
});

test('approved context contains coherent reviewed hierarchy, exact specs and only referenced source metadata',()=>{
  let p=setup();p=apply(p,{type:'upsert_annotation',annotation:annotation()});p=apply(p,{type:'upsert_annotation',annotation:annotation('child','a')});
  p=apply(p,{type:'review_annotation',id:'child',status:'approved'});
  let exported=approvedContext(p);assert.equal(exported.annotations.length,0);assert.ok(exported.unresolved.length>0);
  p=apply(p,{type:'review_annotation',id:'a',status:'approved'});p=apply(p,{type:'upsert_specification',specification:specification()});p=apply(p,{type:'review_specification',id:'s',status:'approved'});
  exported=approvedContext(p);assert.equal(exported.annotations.length,2);assert.deepEqual(exported.annotations.find(a=>a.id==='a')!.childIds,['child']);
  assert.equal(exported.specifications[0]!.text,specification().text);
  assert.equal(exported.sourceNodes.length,2);assert.ok(!JSON.stringify(exported).includes('base64'));
});

test('bounded approved export retains parent-before-child closure and reports omitted content',()=>{
  let p=setup();
  for(const id of ['a','b','c'])p=apply(p,{type:'upsert_annotation',annotation:annotation(id,id==='a'?null:'a')});
  for(const id of ['a','b','c'])p=apply(p,{type:'review_annotation',id,status:'approved'});
  const exported=approvedContext(p,{maxAnnotations:2,maxSourceNodes:1,maxSpecifications:1,maxTextChars:20});
  assert.deepEqual(exported.annotations.map(a=>a.id),['a','b']);
  assert.deepEqual(exported.annotations[0]!.childIds,['b']);
  assert.equal(exported.truncated,true);
  assert.throws(()=>approvedContext(p,{maxAnnotations:0}),hasCode('INVALID_OPERATION'));
});

test('approval omissions are distinct from size truncation and omitted spec relations are explained',()=>{
  let p=setup();
  for(const a of [annotation('a'),annotation('pending-parent'),annotation('limit-child','pending-parent')])p=apply(p,{type:'upsert_annotation',annotation:a});
  for(const id of ['a','limit-child'])p=apply(p,{type:'review_annotation',id,status:'approved'});
  p=apply(p,{type:'upsert_specification',specification:{...specification(),relations:[...specification().relations,{targetAnnotationId:'limit-child',relationType:'constraint',reviewStatus:'proposed'}]}});
  p=apply(p,{type:'review_specification',id:'s',status:'approved'});
  const exported=approvedContext(p);
  assert.equal(exported.truncated,false);
  assert.deepEqual(exported.specifications[0]!.relations.map(r=>r.targetAnnotationId),['a']);
  assert.ok(exported.unresolved.some(message=>message.includes('relation')&&message.includes('withheld')));
});

test('approved records preserve complete pagination totals without images or default export text limits',()=>{
  const p=setup();
  p.annotations=[{...annotation(),reviewStatus:'approved'},{...annotation('hidden-parent')},{...annotation('hidden-child','hidden-parent'),reviewStatus:'approved'}];
  const text='x'.repeat(50000);p.snapshots[0]!.nodes[2]!.text=text;
  p.specifications=Array.from({length:21},(_,index)=>({...specification(`spec-${index}`),text,reviewStatus:'approved',relations:[
    {targetAnnotationId:'a',relationType:'behavior',reviewStatus:'approved'},
    {targetAnnotationId:'hidden-child',relationType:'constraint',reviewStatus:'approved'},
  ]}));
  const records=approvedRecords(p);
  assert.equal(records.specifications.length,21);
  assert.equal(approvedContext(p).specifications.length,20);
  assert.deepEqual(records.annotations.map(a=>a.id),['a']);
  assert.deepEqual(records.specifications[0]!.relations.map(r=>r.targetAnnotationId),['a']);
  assert.deepEqual(Object.keys(records).sort(),['annotations','specifications']);
  assert.equal(records.specifications[0]!.text,text);
});

test('matching remains proposed, invalid draft schemas cannot mutate state, and snapshot identity is strict',()=>{
  let p=setup();p=apply(p,{type:'upsert_annotation',annotation:{...annotation(),sourceRefs:[]}});
  p=apply(p,{type:'match_annotation',id:'a',tolerance:0.5});
  assert.equal(p.annotations[0]!.sourceRefs[0]!.nodeId,'left');assert.equal(p.annotations[0]!.reviewStatus,'proposed');
  const before=JSON.stringify(p);
  assert.throws(()=>applyOperation(p,{type:'submit_proposal',draft:{annotations:[{...annotation('bad'),bbox:{x:0,y:0,width:-1,height:10}}],specifications:[]},warnings:[]},ai),hasCode('INVALID_OPERATION'));
  assert.equal(JSON.stringify(p),before);
  const foreign=structuredClone(snapshot);foreign.id='other';foreign.nodes[0]!.parentId='left';
  assert.throws(()=>apply(p,{type:'add_snapshot',snapshot:foreign}),hasCode('INVALID_PROJECT'));
});

test('relation approval cannot be forged through imported project records',()=>{
  let p=setup();p=apply(p,{type:'upsert_annotation',annotation:annotation()});p=apply(p,{type:'upsert_specification',specification:specification()});
  const forged=structuredClone(p);forged.specifications[0]!.reviewStatus='approved';forged.specifications[0]!.relations[0]!.reviewStatus='approved';
  assert.throws(()=>validateProject(forged),hasCode('INVALID_PROJECT'));
  p=apply(p,{type:'review_annotation',id:'a',status:'approved'});p=apply(p,{type:'review_specification',id:'s',status:'approved'});
  p=apply(p,{type:'review_annotation',id:'a',status:'rejected'});
  assert.equal(approvedContext(p).specifications.length,0);
  p=apply(p,{type:'delete_specification',id:'s'});assert.equal(p.specifications.length,0);
});
