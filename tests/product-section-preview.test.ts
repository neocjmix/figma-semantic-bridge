import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSelection, executePluginCommand, type CaptureHost, type FigmaReadableNode } from '../src/figma/capture.js';

const limits={maxNodes:20,maxBytes:20000,maxDurationMs:5000,maxImageDimension:1024};
function fixture() {
  const page:FigmaReadableNode={id:'page',name:'Page',type:'PAGE',parent:null};
  let exports=0;
  const section:FigmaReadableNode={id:'section',name:'Section metadata',type:'SECTION',parent:page,visible:true,
    absoluteBoundingBox:{x:-800,y:-500,width:400,height:300},exportAsync:async()=>{
      exports++;const image=new Uint8Array(24);image.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
      const view=new DataView(image.buffer);view.setUint32(16,400);view.setUint32(20,300);return image;
    }};
  const text:FigmaReadableNode={id:'text',name:'Source text',type:'TEXT',parent:section,visible:false,opacity:0,
    characters:'Exact source\n한글',absoluteBoundingBox:{x:-780,y:-470,width:100,height:20}};
  section.children=[text];
  const host:CaptureHost={fileKey:'synthetic-section-file',currentPage:{...page,selection:[section]},skipInvisibleInstanceChildren:true,
    getNodeByIdAsync:async id=>id===section.id?section:null,
    setCurrentPageAsync:async()=>{throw new Error('Page writes forbidden.');},selectNodes:()=>{throw new Error('Selection writes forbidden.');},
    scrollAndZoomIntoView:()=>{throw new Error('Viewport writes forbidden.');}};
  return {section,text,host,exports:()=>exports};
}

test('Section captures keep exact bounded metadata but never export PNG even when dimensions could match',async()=>{
  const state=fixture();Object.freeze(state.text);Object.freeze(state.section.children);Object.freeze(state.section);
  const report=await captureSelection(state.host,limits,{now:()=>0});
  assert.equal(state.exports(),0);assert.equal(report.preview,null);assert.equal(report.completeness.complete,true);
  assert.deepEqual(report.bounds,{x:-800,y:-500,width:400,height:300});
  assert.deepEqual(report.nodes.map(node=>[node.id,node.parentId,node.type,node.bbox,node.text,node.visible,node.rendering]),[
    ['section','page','SECTION',{x:-800,y:-500,width:400,height:300},undefined,true,{}],
    ['text','section','TEXT',{x:-780,y:-470,width:100,height:20},'Exact source\n한글',false,{opacity:0,siblingIndex:0}],
  ]);
  assert.match(report.warnings.join(' '),/Section.*metadata.*PNG.*unsupported/i);
  assert.match(report.warnings.join(' '),/unrotated inner Frame/i);assert.equal(state.host.skipInvisibleInstanceChildren,true);
});

test('explicit Section node preview returns an unsupported error with no export, traversal or source changes',async()=>{
  for(const initialFlag of [true,false]) {
    const state=fixture();state.host.skipInvisibleInstanceChildren=initialFlag;
    Object.defineProperty(state.section,'children',{get(){throw new Error('Child traversal forbidden.');}});
    const selection=state.host.currentPage.selection;
    await assert.rejects(executePluginCommand(state.host,{type:'preview_node',fileKey:'synthetic-section-file',pageId:'page',nodeId:'section'},{now:()=>0}),
      error=>!!error&&typeof error==='object'&&'code' in error&&error.code==='UNSUPPORTED_NODE_PREVIEW');
    assert.equal(state.exports(),0);assert.equal(state.host.currentPage.selection,selection);assert.equal(state.host.skipInvisibleInstanceChildren,initialFlag);
  }
});

test('Section metadata budget stops retain their partial status and never trigger a PNG attempt',async()=>{
  const state=fixture();
  const report=await captureSelection(state.host,{...limits,maxNodes:1},{now:()=>0});
  assert.equal(report.nodes.length,1);assert.equal(report.completeness.complete,false);assert.match(report.completeness.reason??'',/Node budget/);
  assert.equal(report.preview,null);assert.equal(state.exports(),0);assert.match(report.warnings.join(' '),/Section.*unsupported/i);
});
