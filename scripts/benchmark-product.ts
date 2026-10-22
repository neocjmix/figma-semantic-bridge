import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { captureSelection, type CaptureHost, type FigmaReadableNode } from '../src/figma/capture.js';
import { matchRegion, SpatialNodeIndex } from '../src/core/matching.js';
import { type CaptureLimits, type Rect } from '../src/shared/contracts.js';

/** A six-way generated tree. Reading a child handle materializes only that child. */
function generatedScope(nodeCount:number) {
  const page:FigmaReadableNode & {selection:readonly FigmaReadableNode[]}={id:'generated-page',name:'Generated benchmark page',type:'PAGE',parent:null,selection:[]};
  const handles=new Map<number,FigmaReadableNode>(),boundsReads=new Set<number>();
  let childHandleReads=0;
  function nodeAt(index:number,parent:FigmaReadableNode):FigmaReadableNode {
    const cached=handles.get(index);if(cached)return cached;
    const childStart=index*6+1, childCount=Math.max(0,Math.min(6,nodeCount-childStart));
    const type=index===0?'FRAME':childCount?['FRAME','GROUP','INSTANCE'][index%3]!:index%3===0?'TEXT':'RECTANGLE';
    const node:FigmaReadableNode={id:`generated-${index}`,name:`Generated ${type} ${index}`,type,parent,visible:true};
    Object.defineProperty(node,'absoluteBoundingBox',{enumerable:true,get:()=>{
      boundsReads.add(index);
      return index===0?{x:-100,y:200,width:5000,height:5000}:{x:-90+(index%100)*30,y:210+Math.floor(index/100)*30,width:20,height:20};
    }});
    if(type==='TEXT')node.characters=`Generated policy ${index}: confirm the action before continuing.`;
    if(childCount)node.children=new Proxy([] as FigmaReadableNode[],{get(target,key,receiver){
      if(key==='length')return childCount;
      if(typeof key==='string'&&/^\d+$/.test(key)){
        const offset=Number(key);if(offset>=childCount)return undefined;
        childHandleReads++;return nodeAt(childStart+offset,node);
      }
      return Reflect.get(target,key,receiver);
    }});
    handles.set(index,node);return node;
  }
  const root=nodeAt(0,page);page.selection=[root];
  const host:CaptureHost={fileKey:'generated-product-benchmark',currentPage:page,skipInvisibleInstanceChildren:true,
    getNodeByIdAsync:async()=>{throw new Error('Capture must not resolve nodes outside the selected scope.');},
    setCurrentPageAsync:async()=>{throw new Error('Benchmark capture must remain read-only.');},
    selectNodes:()=>{throw new Error('Benchmark capture must remain read-only.');},
    scrollAndZoomIntoView:()=>{throw new Error('Benchmark capture must remain read-only.');},
  };
  return {host,counters:()=>({materializedNodeHandles:handles.size,visitedUniqueNodes:boundsReads.size,childHandleReads})};
}

const milliseconds=(value:number)=>Math.round(value*1000)/1000;
const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value),'utf8');
async function benchmark(nodeCount:number,maxNodes:number) {
  const generated=generatedScope(nodeCount);
  const limits:CaptureLimits={maxNodes,maxBytes:4_000_000,maxDurationMs:15000,maxImageDimension:2048};
  let yields=0;
  const before=process.memoryUsage(),started=performance.now();
  const snapshot=await captureSelection(generated.host,limits,{now:()=>performance.now(),capturedAt:()=>new Date().toISOString(),id:()=>`generated-${nodeCount}-budget-${maxNodes}`,
    yieldControl:async()=>{yields++;await yieldImmediate();}});
  const captureMs=performance.now()-started,afterCapture=process.memoryUsage();
  assert.equal(snapshot.nodes.length,Math.min(nodeCount,maxNodes));
  assert.equal(snapshot.completeness.complete,nodeCount<=maxNodes);
  assert.equal(generated.counters().materializedNodeHandles,snapshot.nodes.length);
  assert.equal(snapshot.preview,null);
  assert.equal(generated.host.skipInvisibleInstanceChildren,true);
  const indexStart=performance.now(),index=new SpatialNodeIndex(snapshot.nodes),indexBuildMs=performance.now()-indexStart;
  const regions:Rect[]=Array.from({length:20},(_,i)=>snapshot.nodes[1+Math.floor(i*(snapshot.nodes.length-2)/19)]!.bbox!);
  const queryStart=performance.now();let queryCandidates=0;
  for(const region of regions)queryCandidates+=index.query(region,0.5).length;
  const queryMs=performance.now()-queryStart;
  const matchTimes:number[]=[];let sourceReferences=0,ambiguousQueries=0;
  for(const region of regions){const start=performance.now(),result=matchRegion(snapshot,region);matchTimes.push(performance.now()-start);sourceReferences+=result.sourceRefs.length;if(result.ambiguous)ambiguousQueries++;}
  const afterMatching=process.memoryUsage();
  const sorted=[...matchTimes].sort((a,b)=>a-b);
  return {
    label:`generated-${nodeCount}-nodes-budget-${maxNodes}`,knownGeneratedScopeNodeCount:nodeCount,limits,
    extraction:{elapsedMs:milliseconds(captureMs),capturedNodes:snapshot.nodes.length,...generated.counters(),cooperativeYields:yields,
      completeness:snapshot.completeness,nodeArrayJsonUtf8Bytes:bytes(snapshot.nodes),snapshotJsonUtf8Bytes:bytes(snapshot),
      pluginResponseJsonUtf8Bytes:bytes({type:'response',requestId:'benchmark-request',ok:true,result:snapshot}),
      actualTransportBytes:{status:'not measured',reason:'Adapter runs in-process; JSON byte counts measure serialization, not network transfer.'},
      preview:{status:'not measured',reason:'Generated lazy nodes do not implement native Figma exportAsync; no image or public design is used.'}},
    matching:{indexedNodes:snapshot.nodes.length,indexBuildMs:milliseconds(indexBuildMs),queryCount:regions.length,
      reusedIndexQueriesMs:milliseconds(queryMs),reusedIndexTotalCandidates:queryCandidates,
      matchRegionTotalMs:milliseconds(matchTimes.reduce((sum,time)=>sum+time,0)),matchRegionMedianMs:milliseconds(sorted[Math.floor(sorted.length/2)]!),
      matchRegionMinMs:milliseconds(sorted[0]!),matchRegionMaxMs:milliseconds(sorted.at(-1)!),sourceReferences,ambiguousQueries,
      method:'20 deterministic exact-BBox queries from the captured prefix. matchRegion builds its own index for each call; reusedIndex timing measures SpatialNodeIndex.query separately.'},
    nodeProcessMemory:{method:'process.memoryUsage before capture, after capture, after matching; whole-process samples, not allocation or peak measurements. GC is not forced.',
      beforeCaptureHeapUsedBytes:before.heapUsed,afterCaptureHeapUsedBytes:afterCapture.heapUsed,afterMatchingHeapUsedBytes:afterMatching.heapUsed,
      captureHeapDeltaBytes:afterCapture.heapUsed-before.heapUsed,totalHeapDeltaBytes:afterMatching.heapUsed-before.heapUsed,
      beforeCaptureRssBytes:before.rss,afterCaptureRssBytes:afterCapture.rss,afterMatchingRssBytes:afterMatching.rss,
      peakHeapBytes:{status:'not measured'},figmaNativeMemoryBytes:{status:'not measured'}},
  };
}

const results=[];
for(const nodes of [100,1000,10000])results.push(await benchmark(nodes,2000));
// A separate maximum-contract case measures matching at 10,000 captured nodes.
results.push(await benchmark(10000,10000));
const output={schemaVersion:'1.0.0',kind:'generated-product-adapter-and-matching-benchmark',measuredAt:new Date().toISOString(),
  command:'npm run benchmark:product',generator:'scripts/benchmark-product.ts',runtime:{node:process.version,platform:process.platform,arch:process.arch},
  limitations:[
    'Generated scalar tree only. Neither the linked Figma synthetic file nor any public Figma candidate was measured.',
    'No Figma Desktop, native node loading/export, WebSocket/HTTP transfer or browser image rendering was exercised.',
    'The source is a lazy six-way tree with generated UI-like text and mixed node types. It is not a representative real product corpus.',
    'Three scope sizes use a 2,000-node extraction cap; the fourth case explicitly captures the maximum supported 10,000-node scope.',
    'One run per case; no warmup, forced GC, performance pass threshold, or inference about Desktop latency. Process samples may include startup, earlier cases and garbage collection.',
    'Timing includes runtime schema validation. BBox exact-query results measure geometry, not semantic accuracy.',
  ],results};
await mkdir('docs/evaluation',{recursive:true});
await writeFile('docs/evaluation/product-generated-benchmark.json',JSON.stringify(output,null,2)+'\n');
process.stdout.write(results.map(result=>`${result.label}: capture ${result.extraction.capturedNodes} nodes in ${result.extraction.elapsedMs} ms; visited ${result.extraction.visitedUniqueNodes}; metadata ${result.extraction.nodeArrayJsonUtf8Bytes} bytes; matching median ${result.matching.matchRegionMedianMs} ms`).join('\n')+'\n');
