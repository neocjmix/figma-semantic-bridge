import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSelection, type CaptureHost, type FigmaReadableNode } from '../src/figma/capture.js';
import type { Rect, Snapshot } from '../src/shared/contracts.js';

function png(width:number,height:number):Uint8Array {
  const bytes=new Uint8Array(24);
  bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const view=new DataView(bytes.buffer);view.setUint32(16,width);view.setUint32(20,height);
  return bytes;
}
function fixture(bounds:Rect,width:number,height:number) {
  const calls:Array<Parameters<NonNullable<FigmaReadableNode['exportAsync']>>[0]>=[];
  const page:FigmaReadableNode={id:'synthetic-page-id',name:'Sensitive page label',type:'PAGE',parent:null};
  const root:FigmaReadableNode={id:'synthetic-root-id',name:'Sensitive root label',type:'FRAME',parent:page,absoluteBoundingBox:bounds,
    exportAsync:async settings=>{calls.push(settings);return png(width,height);}};
  const text:FigmaReadableNode={id:'synthetic-text-id',name:'Sensitive text label',type:'TEXT',parent:root,
    absoluteBoundingBox:{x:bounds.x+10,y:bounds.y+20,width:100,height:24},characters:'Exact source content 한글',visible:true};
  root.children=[text];
  Object.freeze(text);Object.freeze(root.children);Object.freeze(root);
  const host:CaptureHost={fileKey:'synthetic-file-key',currentPage:{...page,selection:[root]},skipInvisibleInstanceChildren:true,
    getNodeByIdAsync:async()=>null,setCurrentPageAsync:async()=>{},selectNodes:()=>{},scrollAndZoomIntoView:()=>{}};
  return {host,calls,text};
}
const limits={maxNodes:20,maxBytes:20000,maxDurationMs:5000,maxImageDimension:1024};
function assertDiagnostics(report:Snapshot,warning:string,bounds:Rect,width:number,height:number,scale:number):void {
  assert.equal(report.preview,null);
  assert.equal(report.completeness.complete,true);
  assert.deepEqual(report.bounds,bounds);
  assert.match(warning,new RegExp(`actual=${width}x${height}(?:;|\\.)`));
  assert.ok(warning.includes('requestedMaxDimension=1024;'));
  assert.ok(warning.includes(`scale=${scale};`));
  assert.ok(warning.includes(`sourceBounds=${bounds.width}x${bounds.height};`));
  assert.ok(warning.includes(`expectedScaled=${bounds.width*scale}x${bounds.height*scale}.`));
  assert.ok(warning.length<=512,'Diagnostics must remain a bounded numeric summary.');
  for(const privateValue of ['synthetic-page-id','synthetic-root-id','synthetic-text-id','synthetic-file-key','Sensitive','Exact source content','iVBOR',String(bounds.x),String(bounds.y)]) {
    assert.ok(!warning.includes(privateValue),'Diagnostics must not expose identity, text, PNG payload or source position.');
  }
}

test('over-budget PNG reports measured and requested geometry without relaxing a one-pixel overflow',async()=>{
  const bounds={x:-901.25,y:-401.5,width:2048,height:1024};
  const {host,calls,text}=fixture(bounds,1025,512);
  const report=await captureSelection(host,limits,{now:()=>0});
  const warning=report.warnings.find(value=>value.includes('requested pixel budget'))!;
  assert.ok(warning);
  assertDiagnostics(report,warning,bounds,1025,512,0.5);
  assert.deepEqual(calls,[{format:'PNG',contentsOnly:true,useAbsoluteBounds:true,constraint:{type:'SCALE',value:0.5}}]);
  assert.equal(report.nodes[1]!.text,text.characters);assert.deepEqual(report.nodes[1]!.bbox,text.absoluteBoundingBox);
  assert.equal(host.skipInvisibleInstanceChildren,true);
});

test('mapping mismatch reports fractional expected dimensions and keeps the preview unavailable',async()=>{
  const bounds={x:-901.25,y:-401.5,width:2001,height:1000};
  const {host,calls,text}=fixture(bounds,1020,512),scale=1024/2001;
  const report=await captureSelection(host,limits,{now:()=>0});
  const warning=report.warnings.find(value=>value.includes('aspect/dimensions differ'))!;
  assert.ok(warning);
  assertDiagnostics(report,warning,bounds,1020,512,scale);
  assert.deepEqual(calls,[{format:'PNG',contentsOnly:true,useAbsoluteBounds:true,constraint:{type:'SCALE',value:scale}}]);
  assert.equal(report.nodes[1]!.text,text.characters);assert.deepEqual(report.nodes[1]!.bbox,text.absoluteBoundingBox);
  assert.equal(host.skipInvisibleInstanceChildren,true);
});
