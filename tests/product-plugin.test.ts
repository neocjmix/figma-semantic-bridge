import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSelection, executePluginCommand, type CaptureHost, type FigmaReadableNode } from '../src/figma/capture.js';
import { SnapshotSchema } from '../src/shared/contracts.js';
import { documentRectToImage, imageRectToDocument, imageToDocument } from '../src/core/coordinates.js';
import { SpatialNodeIndex } from '../src/core/matching.js';

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
function hiddenInstanceFixture() {
  const state=fixture();state.root.type='INSTANCE';
  const hidden=new Proxy(state.child,{get(target,key,receiver){
    if(state.host.skipInvisibleInstanceChildren)throw new Error('Invisible instance child is inaccessible.');
    return Reflect.get(target,key,receiver);
  },set(){throw new Error('Source node writes are forbidden.');}});
  state.root.children=[hidden];
  state.host.getNodeByIdAsync=async(id)=>id===state.page.id?state.page:id===state.root.id?state.root:
    id===state.child.id&&!state.host.skipInvisibleInstanceChildren?hidden:null;
  const selected:string[][]=[],scrolled:string[][]=[];
  state.host.selectNodes=(nodes)=>{selected.push(nodes.map(n=>n.id));state.host.currentPage.selection=nodes;};
  state.host.scrollAndZoomIntoView=(nodes)=>scrolled.push(nodes.map(n=>n.id));
  return {...state,selected,scrolled};
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
test('scaled capture maps nested negative document coordinates without reapplying parent transforms',async()=>{
  const {host,root,child}=fixture();
  root.absoluteBoundingBox={x:-900.5,y:-400.25,width:3200,height:1600};
  root.absoluteTransform=[[1,0,-900.5],[0,1,-400.25]];
  const nested:FigmaReadableNode={id:'1:3',name:'Nested frame',type:'FRAME',parent:root,
    absoluteBoundingBox:{x:-700.5,y:-200.25,width:800,height:400},
    absoluteTransform:[[1,0,-700.5],[0,1,-200.25]],children:[child],visible:true};
  child.parent=nested;child.visible=true;
  child.absoluteBoundingBox={x:-650.5,y:-175.25,width:300,height:48};
  root.children=[nested];
  let exportScale:number|undefined;
  root.exportAsync=async(settings)=>{exportScale=settings.constraint.value;return png(1600,800);};
  const report=await captureSelection(host,{...limits,maxImageDimension:1600},{now:()=>0});
  assert.equal(exportScale,0.5);assert.ok(report.preview);
  assert.deepEqual(report.nodes.map(n=>[n.id,n.parentId]),[['1:1','0:1'],['1:3','1:1'],['1:2','1:3']]);
  const captured=report.nodes.find(n=>n.id===child.id)!;
  assert.deepEqual(captured.bbox,child.absoluteBoundingBox);
  assert.equal(captured.sourceFileKey,'fixture-key');assert.equal(captured.sourcePageId,'0:1');
  const image={bounds:report.bounds,width:report.preview.width,height:report.preview.height};
  const region=documentRectToImage(captured.bbox!,image);
  assert.deepEqual(region,{x:125,y:112.5,width:150,height:24});
  assert.deepEqual(imageRectToDocument(region,image),child.absoluteBoundingBox);
});
test('fractional source bounds use actual rounded export dimensions for preview registration',async()=>{
  const {host,root,child}=fixture();
  root.absoluteBoundingBox={x:-500.25,y:-100.5,width:2001,height:1000};
  child.absoluteBoundingBox={x:-250.125,y:24.5,width:500.25,height:250};
  root.exportAsync=async()=>png(1024,512);
  const report=await captureSelection(host,{...limits,maxImageDimension:1024},{now:()=>0});
  assert.ok(report.preview);
  const image={bounds:report.bounds,width:report.preview.width,height:report.preview.height};
  assert.deepEqual(documentRectToImage(child.absoluteBoundingBox,image),{x:128,y:64,width:256,height:128});
  assert.deepEqual(imageToDocument({x:1024,y:512},image),{x:1500.75,y:899.5});
  assert.deepEqual(imageRectToDocument({x:128,y:64,width:256,height:128},image),child.absoluteBoundingBox);
});
test('reflected and skewed roots retain source geometry but never export an uncertain preview',async()=>{
  const transforms:NonNullable<FigmaReadableNode['absoluteTransform']>[]=[
    [[-1,0,-50],[0,1,100]],[[1,0,-50],[0,-1,100]],
    [[1,0.25,-50],[0,1,100]],[[1,0,-50],[0.25,1,100]],
  ];
  for(const transform of transforms) {
    const {host,root,child}=fixture();root.absoluteTransform=transform;
    let exports=0;root.exportAsync=async()=>{exports++;return png(400,200);};
    const report=await captureSelection(host,limits,{now:()=>0});
    assert.equal(exports,0);assert.equal(report.preview,null);
    assert.deepEqual(report.bounds,root.absoluteBoundingBox);
    assert.deepEqual(report.nodes[1]?.bbox,child.absoluteBoundingBox);
    assert.equal(report.completeness.complete,true);
    assert.ok(report.warnings.some(w=>/Preview withheld:.*reflected or skewed root/.test(w)));
    assert.equal(host.skipInvisibleInstanceChildren,true);
  }
});
test('mask and clipping descendants preserve overflowing bounds and hidden ancestry for matching',async()=>{
  const {host,root,child}=fixture();root.clipsContent=true;
  const mask:FigmaReadableNode={id:'1:3',name:'Mask',type:'ELLIPSE',parent:root,isMask:true,visible:true,
    absoluteBoundingBox:{x:-40,y:110,width:80,height:80}};
  const rotated:FigmaReadableNode={id:'1:4',name:'Rotated overflow',type:'RECTANGLE',parent:root,visible:true,
    absoluteBoundingBox:{x:-80,y:80,width:500,height:250},absoluteRenderBounds:{x:-50,y:100,width:400,height:200},
    absoluteTransform:[[0.8,-0.6,-80],[0.6,0.8,80]]};
  const hidden:FigmaReadableNode={id:'1:5',name:'Hidden parent',type:'FRAME',parent:root,visible:false,
    absoluteBoundingBox:{x:-40,y:110,width:120,height:50},children:[child]};
  child.parent=hidden;child.visible=true;root.children=[mask,rotated,hidden];
  const report=await captureSelection(host,limits,{now:()=>0});
  assert.ok(report.preview);assert.equal(report.completeness.complete,true);
  assert.deepEqual(report.nodes.find(n=>n.id===rotated.id)?.bbox,rotated.absoluteBoundingBox);
  assert.equal(report.nodes.find(n=>n.id===child.id)?.text,'Exact\npolicy 한글');
  assert.equal(report.nodes.find(n=>n.id===child.id)?.visible,true);
  assert.ok(report.warnings.some(w=>/Masks are present/.test(w)));
  assert.ok(report.warnings.some(w=>/Clipping is present/.test(w)));
  assert.ok(report.warnings.some(w=>/Rotated, reflected or skewed nodes/.test(w)));
  const matches=new SpatialNodeIndex(report.nodes).query(child.absoluteBoundingBox!);
  assert.ok(matches.some(n=>n.id===mask.id));assert.ok(matches.some(n=>n.id===rotated.id));
  assert.ok(!matches.some(n=>n.id===hidden.id||n.id===child.id));
});
test('explicit highlight checks page ancestry before navigation and only changes selection/viewport',async()=>{
  const {host,root,page}=fixture();const selected:string[][]=[];host.selectNodes=(nodes)=>selected.push(nodes.map(n=>n.id));
  const response=await executePluginCommand(host,{type:'highlight_nodes',fileKey:'fixture-key',pageId:page.id,nodeIds:[root.id]});
  assert.deepEqual(response,{highlightedNodeIds:[root.id]});assert.deepEqual(selected,[[root.id]]);
  await assert.rejects(executePluginCommand(host,{type:'highlight_nodes',fileKey:'fixture-key',pageId:'wrong',nodeIds:[root.id]}),/page/i);
});
test('explicit highlight resolves captured hidden instance children with Dev Mode skipping enabled',async()=>{
  const {host,page,child,selected,scrolled}=hiddenInstanceFixture();
  const response=await executePluginCommand(host,{type:'highlight_nodes',fileKey:'fixture-key',pageId:page.id,nodeIds:[child.id]});
  assert.deepEqual(response,{highlightedNodeIds:[child.id]});
  assert.deepEqual(selected,[[child.id]]);assert.deepEqual(scrolled,[[child.id]]);
  assert.equal(host.skipInvisibleInstanceChildren,true);assert.equal(child.visible,false);
});
test('highlighted hidden instance child remains readable by the following selection request',async()=>{
  const {host,page,child}=hiddenInstanceFixture();
  await executePluginCommand(host,{type:'highlight_nodes',fileKey:'fixture-key',pageId:page.id,nodeIds:[child.id]});
  assert.equal(host.skipInvisibleInstanceChildren,true);
  const selection=await executePluginCommand(host,{type:'get_selection'});
  assert.deepEqual(selection,{fileKey:'fixture-key',pageId:page.id,nodes:[{
    id:child.id,name:child.name,type:child.type,bbox:child.absoluteBoundingBox,
  }]});
  assert.equal(host.skipInvisibleInstanceChildren,true);assert.equal(child.visible,false);
});
test('highlighted hidden instance container can be captured without mutating the source',async()=>{
  const {host,page,child}=hiddenInstanceFixture();child.type='FRAME';
  child.exportAsync=async()=>png(100,20);
  await executePluginCommand(host,{type:'highlight_nodes',fileKey:'fixture-key',pageId:page.id,nodeIds:[child.id]});
  assert.equal(host.skipInvisibleInstanceChildren,true);
  const report=SnapshotSchema.parse(await executePluginCommand(host,{type:'capture_selection',limits},{now:()=>0}));
  assert.equal(report.source.rootId,child.id);assert.deepEqual(report.bounds,child.absoluteBoundingBox);
  assert.equal(report.nodes.length,1);assert.equal(report.nodes[0]?.visible,false);
  assert.equal(report.preview?.width,100);assert.equal(report.preview?.height,20);
  assert.equal(host.skipInvisibleInstanceChildren,true);assert.equal(child.visible,false);
});
test('invalid highlighted hidden selections restore the skip setting after validation errors',async()=>{
  const {host,page,child}=hiddenInstanceFixture();
  await executePluginCommand(host,{type:'highlight_nodes',fileKey:'fixture-key',pageId:page.id,nodeIds:[child.id]});
  await assert.rejects(executePluginCommand(host,{type:'capture_selection',limits}),{code:'INVALID_SELECTION'});
  assert.equal(host.skipInvisibleInstanceChildren,true);
  child.type='FRAME';child.absoluteBoundingBox={x:0,y:0,width:0,height:20};
  await assert.rejects(executePluginCommand(host,{type:'capture_selection',limits}),{code:'INVALID_BOUNDS'});
  assert.equal(host.skipInvisibleInstanceChildren,true);assert.equal(child.visible,false);
});
test('hidden instance highlight still rejects wrong page ancestry and restores the skip setting',async()=>{
  const {host,page,child,selected,scrolled}=hiddenInstanceFixture();
  child.parent={id:'other-page',name:'Other page',type:'PAGE',parent:null};
  await assert.rejects(executePluginCommand(host,{type:'highlight_nodes',fileKey:'fixture-key',pageId:page.id,nodeIds:[child.id]}),
    /does not belong to the requested page/i);
  assert.equal(host.skipInvisibleInstanceChildren,true);assert.equal(child.visible,false);
  assert.deepEqual(selected,[]);assert.deepEqual(scrolled,[]);
});
test('cancelling hidden instance highlight after lookup restores the skip setting before returning',async()=>{
  const {host,page,child,selected,scrolled}=hiddenInstanceFixture();
  const lookup=host.getNodeByIdAsync;let cancelled=false;
  host.getNodeByIdAsync=async(id)=>{const found=await lookup(id);if(id===child.id)cancelled=true;return found;};
  await assert.rejects(executePluginCommand(host,{type:'highlight_nodes',fileKey:'fixture-key',pageId:page.id,nodeIds:[child.id]},
    {cancelled:()=>cancelled}),/cancelled/i);
  assert.equal(host.skipInvisibleInstanceChildren,true);assert.equal(child.visible,false);
  assert.deepEqual(selected,[]);assert.deepEqual(scrolled,[]);
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
