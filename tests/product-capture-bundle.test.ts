import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProject, DomainError, validateProject } from '../src/core/index.js';
import type { Project, Snapshot, SourceNode } from '../src/shared/contracts.js';
import { CAPTURE_BUNDLE_MAX_BYTES, CAPTURE_BUNDLE_MAX_NODE_BYTES, type CaptureBundle } from '../src/shared/capture-bundle.js';
import { exportCaptureBundle, importCaptureBundle } from '../src/server/capture-bundle.js';

const time='2026-10-23T00:00:00.000Z';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=';
function snapshot(id='ui'):Snapshot {
  const bounds={x:-150.25,y:-80.5,width:100,height:100};
  const root:SourceNode={id:'root',parentId:'page',type:'FRAME',name:'원본 / frame',bbox:bounds,visible:true,sourceFileKey:'synthetic-copy',sourcePageId:'page'};
  return {schemaVersion:'1.0.0',id,name:'Captured '+id,source:{fileKey:'synthetic-copy',pageId:'page',rootId:'root',revision:null,capturedAt:time},bounds,
    nodes:[root,{...root,id:'text',parentId:'root',type:'TEXT',bbox:{x:-130.125,y:-70.25,width:70,height:20},visible:false,
      text:'  한글 e\u0301 👩‍💻\r\nline two\t<&>  '}],
    preview:{mimeType:'image/png',base64:png,width:1,height:1},completeness:{complete:false,reason:'Synthetic observed prefix only.'},
    warnings:['Clipping is present.', 'Snapshot is an observation, not an immutable revision.']};
}
function project(snapshots=[snapshot(),snapshot('notes')]):Project {
  return validateProject({...createProject('source-project','Original workspace',time),snapshots});
}
// Independent digest oracle: JSON scalars remain unchanged; only object key order is sorted.
function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
  return JSON.stringify(value)!;
}
function sign(bundle:CaptureBundle):CaptureBundle {
  for(const entry of bundle.snapshots)entry.sha256=createHash('sha256').update(canonical(entry.snapshot),'utf8').digest('hex');
  return bundle;
}
function rejects(work:()=>unknown,code='INVALID_CAPTURE_BUNDLE'):void {
  assert.throws(work,error=>error instanceof DomainError&&error.code===code);
}
function manyNodes(count:number,id='scope'):Snapshot {
  const value=snapshot(id),root=value.nodes[0]!;
  value.nodes=[root,...Array.from({length:count-1},(_,index)=>({...root,id:'child-'+index,parentId:root.id,type:'RECTANGLE'}))];
  value.preview=null;
  return value;
}

test('two-scope round trip preserves source observations and creates independent empty semantic projects',()=>{
  const source=project();
  source.annotations=[{id:'approved',snapshotId:'ui',name:'Reviewed component',role:'component',bbox:{...source.snapshots[0]!.bounds},parentId:null,
    sourceRefs:[{snapshotId:'ui',nodeId:'root',matchType:'exact'}],origin:'human',reviewStatus:'approved',revision:1}];
  source.specifications=[{id:'approved-spec',text:source.snapshots[0]!.nodes[1]!.text!,sourceRefs:[{snapshotId:'ui',nodeId:'text',matchType:'exact'}],
    relations:[{targetAnnotationId:'approved',relationType:'describes',reviewStatus:'approved'}],origin:'human',reviewStatus:'approved',revision:1}];
  source.proposals=[{id:'pending',createdAt:time,baseRevision:0,status:'pending',draft:{annotations:[],specifications:[]},warnings:[]}];
  validateProject(source);
  const before=structuredClone(source),bundle=exportCaptureBundle(source,['notes','ui'],time);
  assert.deepEqual(Object.keys(bundle).sort(),['exportedAt','kind','snapshots','version']);
  assert.deepEqual(bundle.snapshots.map(entry=>entry.snapshot),[source.snapshots[1],source.snapshots[0]]);
  assert.deepEqual(source,before);
  const imported=importCaptureBundle(JSON.parse(JSON.stringify(bundle)),'Local review');
  const second=importCaptureBundle(bundle,'Another review');
  assert.notEqual(imported.id,source.id);assert.notEqual(imported.id,second.id);
  assert.equal(imported.name,'Local review');assert.equal(imported.revision,0);
  assert.deepEqual(imported.snapshots,bundle.snapshots.map(entry=>entry.snapshot));
  assert.deepEqual([imported.annotations,imported.specifications,imported.proposals],[[],[],[]]);
  imported.snapshots[0]!.nodes[0]!.name='Changed locally';
  assert.deepEqual(source,before);assert.equal(bundle.snapshots[0]!.snapshot.nodes[0]!.name,'원본 / frame');
});

test('snapshot checksums ignore object insertion order but preserve text and array order',()=>{
  const bundle=exportCaptureBundle(project(),['ui'],time);
  assert.equal(bundle.snapshots[0]!.sha256,createHash('sha256').update(canonical(bundle.snapshots[0]!.snapshot)).digest('hex'));
  const reordered=JSON.parse(canonical(bundle)) as CaptureBundle;
  assert.deepEqual(importCaptureBundle(reordered,'Reordered').snapshots,[snapshot()]);
  const textChanged=structuredClone(bundle);textChanged.snapshots[0]!.snapshot.nodes[1]!.text+='!';
  rejects(()=>importCaptureBundle(textChanged,'Changed'),'CAPTURE_BUNDLE_INTEGRITY');
  const nodesReordered=structuredClone(bundle);nodesReordered.snapshots[0]!.snapshot.nodes.reverse();
  rejects(()=>importCaptureBundle(nodesReordered,'Changed'),'CAPTURE_BUNDLE_INTEGRITY');
  // Re-signing valid new observations works: a checksum is not source authentication.
  assert.equal(importCaptureBundle(sign(textChanged),'Re-signed').snapshots[0]!.nodes[1]!.text,textChanged.snapshots[0]!.snapshot.nodes[1]!.text);
});

test('capture transfer preserves observed opacity and local sibling order without backfilling legacy snapshots',()=>{
  const source=project();
  source.snapshots[0]!.nodes[0]!.rendering={};
  source.snapshots[0]!.nodes[1]!.rendering={opacity:0,siblingIndex:7};
  const bundle=exportCaptureBundle(source,['ui','notes'],time);
  const imported=importCaptureBundle(JSON.parse(JSON.stringify(bundle)),'Rendering review');
  assert.deepEqual(imported.snapshots,source.snapshots);
  assert.equal(imported.snapshots[1]!.nodes[0]!.rendering,undefined);
  const changed=structuredClone(bundle);changed.snapshots[0]!.snapshot.nodes[1]!.rendering!.opacity=1;
  rejects(()=>importCaptureBundle(changed,'Tampered rendering'),'CAPTURE_BUNDLE_INTEGRITY');
});

test('unknown fields, versions, semantic decisions and credentials are rejected instead of stripped',()=>{
  const bundle=exportCaptureBundle(project(),['ui'],time);
  for(const value of [
    {...bundle,kind:'other'}, {...bundle,version:'2.0.0'}, {...bundle,annotations:[]}, {...bundle,specifications:[]}, {...bundle,proposals:[]}, {...bundle,token:'secret'},
    {...bundle,snapshots:[{...bundle.snapshots[0],approved:true}]},
    {...bundle,snapshots:[{...bundle.snapshots[0],snapshot:{...bundle.snapshots[0]!.snapshot,reviewStatus:'approved'}}]},
  ])rejects(()=>importCaptureBundle(value,'Invalid'));
  rejects(()=>importCaptureBundle(bundle,''));
});

test('export requires explicit distinct existing scopes and never mutates the source project',()=>{
  const source=project(),before=structuredClone(source);
  for(const ids of [[],['ui','ui'],['ui','notes','extra']])rejects(()=>exportCaptureBundle(source,ids,time));
  rejects(()=>exportCaptureBundle(source,['missing'],time),'NOT_FOUND');
  rejects(()=>exportCaptureBundle(source,['ui'],'not a date'));
  assert.deepEqual(source,before);
});

test('valid checksums cannot bypass duplicate identity, provenance, ancestry or completeness checks',()=>{
  const bundle=exportCaptureBundle(project(),['ui'],time);
  const changes:Array<(s:Snapshot)=>void>=[
    s=>{s.nodes.push(structuredClone(s.nodes[1]!));},
    s=>{s.source.rootId='missing';},
    s=>{s.nodes[1]!.sourceFileKey='different-file';},
    s=>{s.nodes[1]!.sourcePageId='different-page';},
    s=>{s.nodes[1]!.parentId='missing';},
    s=>{s.nodes[1]!.parentId='text';},
    s=>{s.nodes[0]!.parentId='text';},
    s=>{s.completeness={complete:true,reason:'Still partial'};},
  ];
  for(const change of changes){const changed=structuredClone(bundle);change(changed.snapshots[0]!.snapshot);rejects(()=>importCaptureBundle(sign(changed),'Invalid'));}
  rejects(()=>importCaptureBundle({...bundle,snapshots:[bundle.snapshots[0],bundle.snapshots[0]]},'Duplicate'));
});

test('root bounds must equal the scope on import and export while nullable previews stay unavailable',()=>{
  const bundle=exportCaptureBundle(project(),['ui'],time);
  for(const bbox of [null,{...bundle.snapshots[0]!.snapshot.bounds,x:0}]) {
    const changed=structuredClone(bundle);changed.snapshots[0]!.snapshot.nodes[0]!.bbox=bbox;
    rejects(()=>importCaptureBundle(sign(changed),'Misaligned'));
    rejects(()=>exportCaptureBundle(project([changed.snapshots[0]!.snapshot]),['ui'],time));
  }
  const withoutPreview=snapshot();withoutPreview.preview=null;
  assert.equal(importCaptureBundle(exportCaptureBundle(project([withoutPreview]),['ui'],time),'No preview').snapshots[0]!.preview,null);
});

test('PNG bytes must be canonical PNG data with dimensions matching the recorded preview',()=>{
  const bundle=exportCaptureBundle(project(),['ui'],time);
  const previews=[
    {...snapshot().preview!,base64:png+'\n'},
    {...snapshot().preview!,base64:Buffer.from('<svg>not a png</svg>').toString('base64')},
    {...snapshot().preview!,width:2},
  ];
  for(const preview of previews){const changed=structuredClone(bundle);changed.snapshots[0]!.snapshot.preview=preview;rejects(()=>importCaptureBundle(sign(changed),'Invalid image'));}
});

test('node count is bounded across scopes, with exactly 10000 nodes accepted',()=>{
  const source=project([manyNodes(5000,'one'),manyNodes(5000,'two')]);
  const bundle=exportCaptureBundle(source,['one','two'],time);
  assert.equal(importCaptureBundle(bundle,'At limit').snapshots.reduce((sum,s)=>sum+s.nodes.length,0),10000);
  source.snapshots[1]=manyNodes(5001,'two');
  rejects(()=>exportCaptureBundle(source,['one','two'],time),'CAPTURE_BUNDLE_LIMIT');
  const oversized=structuredClone(bundle);oversized.snapshots[1]!.snapshot=manyNodes(5001,'two');
  rejects(()=>importCaptureBundle(sign(oversized),'Too many'),'CAPTURE_BUNDLE_LIMIT');
});

test('node JSON budget counts UTF-8 bytes rather than characters across the selected scopes',()=>{
  const source=project([manyNodes(51,'one'),manyNodes(51,'two')]);
  for(const s of source.snapshots)for(const node of s.nodes.slice(1)){node.type='TEXT';node.text='한'.repeat(14000);}
  const bytes=source.snapshots.reduce((sum,s)=>sum+Buffer.byteLength(JSON.stringify(s.nodes)),0);
  assert.ok(bytes>CAPTURE_BUNDLE_MAX_NODE_BYTES);
  assert.ok(source.snapshots.reduce((sum,s)=>sum+JSON.stringify(s.nodes).length,0)<CAPTURE_BUNDLE_MAX_NODE_BYTES);
  rejects(()=>exportCaptureBundle(source,['one','two'],time),'CAPTURE_BUNDLE_LIMIT');
  const bundle=exportCaptureBundle(project(),['ui','notes'],time);
  bundle.snapshots.forEach((entry,index)=>{entry.snapshot=source.snapshots[index]!;});
  rejects(()=>importCaptureBundle(sign(bundle),'Too much text'),'CAPTURE_BUNDLE_LIMIT');
});

test('combined encoded previews cannot exceed the whole-bundle byte budget',()=>{
  const largePng=Buffer.alloc(6_000_000);Buffer.from(png,'base64').copy(largePng);
  const source=project();for(const s of source.snapshots)s.preview!.base64=largePng.toString('base64');
  assert.ok(Buffer.byteLength(JSON.stringify(source.snapshots))>CAPTURE_BUNDLE_MAX_BYTES);
  rejects(()=>exportCaptureBundle(source,['ui','notes'],time),'CAPTURE_BUNDLE_LIMIT');
  const bundle=exportCaptureBundle(project(),['ui','notes'],time);
  bundle.snapshots.forEach((entry,index)=>{entry.snapshot=source.snapshots[index]!;});
  rejects(()=>importCaptureBundle(sign(bundle),'Too much image data'),'CAPTURE_BUNDLE_LIMIT');
});
