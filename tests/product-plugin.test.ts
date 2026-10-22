import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSelection, executePluginCommand, type CaptureHost, type FigmaReadableNode } from '../src/figma/capture.js';
import { SnapshotSchema } from '../src/shared/contracts.js';

function png(width:number,height:number):Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const view = new DataView(bytes.buffer); view.setUint32(16,width); view.setUint32(20,height);
  return bytes;
}
function fixture() {
  const page:FigmaReadableNode = {id:'0:1',name:'Page',type:'PAGE',parent:null,children:[]};
  const root:FigmaReadableNode = {id:'1:1',name:'Panel',type:'FRAME',parent:page,absoluteBoundingBox:{x:-50,y:100,width:400,height:200},visible:true,children:[],exportAsync:async()=>png(400,200)};
  const child:FigmaReadableNode = {id:'1:2',name:'Note',type:'TEXT',parent:root,absoluteBoundingBox:{x:-30,y:120,width:100,height:20},visible:false,characters:'Exact\npolicy 한글',children:[]};
  (root.children as FigmaReadableNode[]).push(child);
  const host:CaptureHost = {fileKey:'fixture-key',currentPage:{...page,selection:[root]},skipInvisibleInstanceChildren:true,
    getNodeByIdAsync:async(id)=>id===page.id?page:id===root.id?root:id===child.id?child:null,
    setCurrentPageAsync:async()=>{},selectNodes:()=>{},scrollAndZoomIntoView:()=>{}};
  return {host,root,child,page};
}
const limits={maxNodes:20,maxBytes:20000,maxDurationMs:5000,maxImageDimension:2048};
test('selected capture retains exact text, source coordinates, bounded PNG and hidden children',async()=>{
  const {host,root}=fixture(); let settings:unknown;
  root.exportAsync=async(value)=>{settings=value;return png(400,200);};
  const report=await captureSelection(host,limits,{now:()=>0,capturedAt:()=> '2026-10-22T00:00:00.000Z',id:()=> 'snapshot-1'});
  assert.equal(report.nodes[1]?.text,'Exact\npolicy 한글');
  assert.equal(report.nodes[1]?.visible,false); assert.equal(report.nodes[0]?.parentId,'0:1');
  assert.deepEqual(report.bounds,{x:-50,y:100,width:400,height:200});
  assert.equal(report.preview?.width,400); assert.equal(host.skipInvisibleInstanceChildren,true);
  assert.equal(report.completeness.complete,true); SnapshotSchema.parse(report);
  assert.deepEqual(settings,{format:'PNG',contentsOnly:true,useAbsoluteBounds:true,constraint:{type:'SCALE',value:1}});
});
test('capture node and byte budgets retain an explicit incomplete prefix',async()=>{
  const {host,child}=fixture();
  const report=await captureSelection(host,{...limits,maxNodes:1},{now:()=>0});
  assert.equal(report.nodes.length,1); assert.equal(report.completeness.complete,false); assert.match(report.completeness.reason??'',/node/i);
  child.characters='x'.repeat(2000);
  const bytes=await captureSelection(host,{...limits,maxBytes:1024},{now:()=>0});
  assert.equal(bytes.nodes.length,1); assert.match(bytes.completeness.reason??'',/byte/i);
});
test('capture requires one supported container and never silently traverses the page',async()=>{
  const {host,child}=fixture();host.currentPage.selection=[];
  await assert.rejects(captureSelection(host,limits),/exactly one/i);
  host.currentPage.selection=[child]; await assert.rejects(captureSelection(host,limits),/container/i);
});
test('capture probes optional capabilities before reading strict host proxy properties',async()=>{
  const {host,root,child}=fixture();delete root.exportAsync;
  const strict=(node:FigmaReadableNode)=>new Proxy(node,{get(target,key,receiver){
    if(!(key in target))throw new Error(`Unsupported host property ${String(key)}`);
    return Reflect.get(target,key,receiver);
  }});
  root.children=[strict(child)];host.currentPage.selection=[strict(root)];
  const report=await captureSelection(host,limits,{now:()=>0});
  assert.equal(report.nodes.length,2);assert.equal(report.preview,null);
  assert.ok(report.warnings.some(w=>/does not expose image export/.test(w)));
});
test('rotated root withholds image and masks/clipping record coordinate limits',async()=>{
  const {host,root,child}=fixture(); root.absoluteTransform=[[0,-1,0],[1,0,0]]; child.isMask=true;
  root.exportAsync=async()=>{throw new Error('should not export rotated root');};
  const report=await captureSelection(host,limits,{now:()=>0});
  assert.equal(report.preview,null);assert.ok(report.warnings.some(w=>/rotat|skew/i.test(w)));assert.ok(report.warnings.some(w=>/mask/i.test(w)));
});
test('native export errors, cancellation and oversized text restore hidden-instance settings',async()=>{
  const {host,root,child}=fixture(); root.exportAsync=async()=>{throw new Error('native export failed');};
  const report=await captureSelection(host,limits,{now:()=>0});assert.equal(report.preview,null);assert.equal(host.skipInvisibleInstanceChildren,true);
  child.characters='x'.repeat(50001);const partial=await captureSelection(host,limits,{now:()=>0});assert.equal(partial.nodes.length,1);assert.equal(partial.completeness.complete,false);
  await assert.rejects(captureSelection(host,limits,{cancelled:()=>true}),/cancelled/i);assert.equal(host.skipInvisibleInstanceChildren,true);
});
test('PNG mismatch refuses uncertain coordinate transform rather than showing shifted preview',async()=>{
  const {host,root}=fixture();root.exportAsync=async()=>png(400,400);
  const report=await captureSelection(host,limits,{now:()=>0});assert.equal(report.preview,null);assert.ok(report.warnings.some(w=>/aspect/i.test(w)));
});
test('explicit highlight checks page ancestry before navigation and only changes selection/viewport',async()=>{
  const {host,root,page}=fixture();const selected:string[][]=[];host.selectNodes=(nodes)=>selected.push(nodes.map(n=>n.id));
  const response=await executePluginCommand(host,{type:'highlight_nodes',fileKey:'fixture-key',pageId:page.id,nodeIds:[root.id]});
  assert.deepEqual(response,{highlightedNodeIds:[root.id]});assert.deepEqual(selected,[[root.id]]);
  await assert.rejects(executePluginCommand(host,{type:'highlight_nodes',fileKey:'fixture-key',pageId:'wrong',nodeIds:[root.id]}),/page/i);
});
test('highlight refuses missing or different file identity before resolving same-ID nodes',async()=>{
  const {host,page,root}=fixture();let reads=0;
  host.getNodeByIdAsync=async()=>{reads++;return page;};
  const command={type:'highlight_nodes' as const,fileKey:'other-file',pageId:page.id,nodeIds:[root.id]};
  await assert.rejects(executePluginCommand(host,command),/requested source file/i);
  host.fileKey=undefined;
  await assert.rejects(executePluginCommand(host,command),/identity/i);
  assert.equal(reads,0);
});
