import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeScope, DEFAULT_LIMITS, utf8Bytes, contains, overlaps, nearEqual } from '../src/fixture-analysis/index.js';
import type { NodeAdapter, NodeRecord, Rect, AnalyzeOptions } from '../src/fixture-analysis/index.js';

type Node = NodeRecord & { children: Node[] };
const box = (x=0,y=0,width=100,height=100):Rect => ({x,y,width,height});
const make = (id:string, bbox:Rect|null, children:Node[]=[], type='FRAME'):Node => {
  const n:Node={id,parentId:null,type,bbox,visible:true,layoutMode:null,children};
  for(const c of children)c.parentId=id;
  return n;
};
const adapter:NodeAdapter<Node> = {read:({children:_,...n})=>n,children:n=>n.children};
const options:AnalyzeOptions={source:{fileKey:null,pageId:'p',rootId:'root'},limits:DEFAULT_LIMITS,tolerancePx:0.5};

test('geometry excludes touching edges, handles tolerance, negative positions and degenerate boxes',()=>{
  assert.equal(overlaps(box(),box(100)),false);
  assert.equal(contains(box(-10,-10,20,20),box(-5,-5,2,2)),true);
  assert.equal(nearEqual(box(),box(.4,0,100,100),.5),true);
  assert.equal(nearEqual(box(),box(.4,0,100,100),.1),false);
  assert.equal(overlaps(box(),box(0,0,0,10)),false);
});

test('equal boxes do not create spatial hierarchy; sibling containment is distinguished from ancestry',async()=>{
  const root=make('root',box(),[make('same',box()),make('small',box(10,10,20,20),[make('text',box(12,12,5,5),[],'TEXT')]),make('outside',box(200,200,10,10))]);
  const r=await analyzeScope(root,adapter,options);
  assert.equal(r.extraction.complete,true);
  assert.equal(r.structure.nodeCount,5);
  assert.equal(r.structure.maxDepth,2);
  assert.equal(r.structure.meanDepth,1);
  assert.equal(r.structure.textNodeCount,1);
  assert.equal(r.spatial.exactEqualBoxPairCount,1);
  assert.equal(r.spatial.containmentWithoutAncestryCount,2);
  assert.equal(r.spatial.directParentNotContainingCount,1);
  assert.equal(r.spatial.complete,true);
  assert.equal(r.memory.pluginHeapBytes.status,'not measured');
});

test('node and byte limits preserve lower bounds and never report full totals',async()=>{
  const root=make('root',box(),[make('a',box()),make('b',box())]);
  const limited=await analyzeScope(root,adapter,{...options,limits:{...DEFAULT_LIMITS,maxNodes:2}});
  assert.equal(limited.extraction.complete,false);
  assert.equal(limited.extraction.stopReason,'maxNodes');
  assert.equal(limited.structure.nodeCount,2);
  assert.equal(limited.scopeNodeCount.status,'not measured');
  const bytes=await analyzeScope(root,adapter,{...options,limits:{...DEFAULT_LIMITS,maxRecordBytes:1}});
  assert.equal(bytes.structure.nodeCount,0);
  assert.equal(bytes.extraction.stopReason,'maxRecordBytes');
});

test('pair limit marks spatial values partial and rates unmeasured',async()=>{
  const root=make('root',box(),[make('a',box()),make('b',box()),make('c',box())]);
  const r=await analyzeScope(root,adapter,{...options,limits:{...DEFAULT_LIMITS,maxPairChecks:1}});
  assert.equal(r.spatial.complete,false);
  assert.equal(r.spatial.pairChecks,1);
  assert.equal(r.spatial.nearEqualBoxNodeRatio.status,'not measured');
});

test('all visible and hidden nodes are counted; autolayout denominator is eligible containers',async()=>{
  const a=make('a',box(),[],'INSTANCE');a.layoutMode='HORIZONTAL';a.visible=false;
  const root=make('root',null,[a,make('b',box(),[],'GROUP')],'PAGE');
  const r=await analyzeScope(root,adapter,options);
  assert.equal(r.structure.nodeCount,3);
  assert.equal(r.structure.hiddenNodeCount,1);
  assert.equal(r.structure.autoLayoutEligibleCount,1);
  assert.equal(r.structure.autoLayoutRatio,1);
});

test('validates limits, boxes, duplicate ids and cyclic input without hanging',async()=>{
  await assert.rejects(analyzeScope(make('root',box()),adapter,{...options,tolerancePx:-1}),/tolerance/);
  await assert.rejects(analyzeScope(make('root',box()),adapter,{...options,limits:{...DEFAULT_LIMITS,maxNodes:NaN}}),/maxNodes/);
  await assert.rejects(analyzeScope(make('root',box(0,0,-1,1)),adapter,options),/bbox/);
  const root=make('root',box()); root.children.push(root);
  await assert.rejects(analyzeScope(root,adapter,options),/duplicate|cycle/);
});

test('uses iterative traversal for deep trees and exact UTF-8 byte accounting',async()=>{
  let root=make('leaf',box());
  for(let i=0;i<12000;i++)root=make(`n${i}`,null,[root],'GROUP');
  const r=await analyzeScope(root,adapter,{...options,source:{...options.source,rootId:root.id},limits:{...DEFAULT_LIMITS,maxNodes:15000,maxRecordBytes:4000000,maxDurationMs:20000}});
  assert.equal(r.structure.nodeCount,12001);
  assert.equal(r.structure.maxDepth,12000);
  assert.equal(utf8Bytes('한🙂\ud800'),Buffer.byteLength('한🙂\ud800'));
});

test('time budget is explicit and cancellation happens at traversal boundaries',async()=>{
  let clock=0;
  const r=await analyzeScope(make('root',box(),[make('a',box())]),adapter,{...options,now:()=>clock++,limits:{...DEFAULT_LIMITS,maxDurationMs:1}});
  assert.equal(r.extraction.complete,false);
  assert.equal(r.extraction.stopReason,'maxDurationMs');
});

test('sweep agrees with brute force spatial oracle for deterministic scattered rectangles',async()=>{
  let seed=7;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const children=Array.from({length:90},(_,i)=>make(`n${i}`,box(Math.floor(rand()*70)-20,Math.floor(rand()*70)-20,1+Math.floor(rand()*20),1+Math.floor(rand()*20))));
  const root=make('root',box(-100,-100,300,300),children);
  const r=await analyzeScope(root,adapter,options);
  const nodes=[root,...children];let overlapsExpected=0,nearExpected=0,containExpected=0,mismatchExpected=0;
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++) {
    const a=nodes[i]!,b=nodes[j]!;
    if(overlaps(a.bbox!,b.bbox!))overlapsExpected++;
    if(nearEqual(a.bbox!,b.bbox!,.5))nearExpected++;
    const ab=contains(a.bbox!,b.bbox!,.5),ba=contains(b.bbox!,a.bbox!,.5);
    if(ab!==ba){containExpected++;if(i!==0)mismatchExpected++;}
  }
  assert.equal(r.spatial.complete,true);
  assert.equal(r.spatial.overlapPairCount,overlapsExpected);
  assert.equal(r.spatial.nearEqualBoxPairCount,nearExpected);
  assert.equal(r.spatial.containmentPairCount,containExpected);
  assert.equal(r.spatial.containmentWithoutAncestryCount,mismatchExpected);
  assert.ok(r.spatial.pairChecks<r.spatial.possiblePairCount);
});

test('report byte count is exact and adapter extras never leak',async()=>{
  const root=make('root',box());
  const extraAdapter:NodeAdapter<Node>={...adapter,read:n=>({...adapter.read(n),name:'PRIVATE',text:'PRIVATE'})};
  const r=await analyzeScope(root,extraAdapter,options);
  assert.equal(r.bytes.reportJsonUtf8,Buffer.byteLength(JSON.stringify(r)));
  assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});

test('extraction limit exactly at final node is complete and degenerate geometry is excluded',async()=>{
  const root=make('root',null,[make('zero',box(0,0,0,0))],'PAGE');
  const r=await analyzeScope(root,adapter,{...options,limits:{...DEFAULT_LIMITS,maxNodes:2}});
  assert.equal(r.extraction.complete,true);
  assert.equal(r.structure.invalidOrMissingBoundsCount,2);
  assert.equal(r.spatial.boundedNodeCount,0);
  assert.equal(r.spatial.exactEqualBoxNodeRatio.status,'not measured');
});
