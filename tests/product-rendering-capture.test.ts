import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSelection, type CaptureHost, type FigmaReadableNode } from '../src/figma/capture.js';

type ObservedNode=FigmaReadableNode&{opacity?:number};
const limits={maxNodes:20,maxBytes:20000,maxDurationMs:5000,maxImageDimension:1024};
function fixture() {
  const page:ObservedNode={id:'page',name:'Page',type:'PAGE',parent:null};
  const root:ObservedNode={id:'root',name:'Selected',type:'FRAME',parent:page,opacity:0.75,visible:true,
    absoluteBoundingBox:{x:-200,y:-100,width:512,height:256}};
  const children:ObservedNode[]=[
    {id:'z-first',name:'Transparent',type:'FRAME',parent:root,opacity:0,visible:true,absoluteBoundingBox:{x:-180,y:-80,width:200,height:100}},
    {id:'a-second',name:'Partial',type:'TEXT',parent:root,opacity:0.5,visible:true,characters:'Exact text 한글',absoluteBoundingBox:{x:-170,y:-70,width:80,height:24}},
    {id:'m-third',name:'Tiny positive',type:'RECTANGLE',parent:root,opacity:1e-300,visible:false,absoluteBoundingBox:{x:-170,y:-40,width:80,height:24}},
  ];
  const nested:ObservedNode={id:'nested',name:'Nested',type:'TEXT',parent:children[0]!,opacity:1,visible:true,
    characters:'Nested source text',absoluteBoundingBox:{x:-170,y:-70,width:80,height:24}};
  children[0]!.children=[nested];root.children=children;
  const host:CaptureHost={fileKey:'synthetic-file',currentPage:{...page,selection:[root]},skipInvisibleInstanceChildren:true,
    getNodeByIdAsync:async()=>null,setCurrentPageAsync:async()=>{},selectNodes:()=>{},scrollAndZoomIntoView:()=>{}};
  return {page,root,children,nested,host};
}

test('capture retains zero and positive opacity plus original local sibling positions without editing source',async()=>{
  const {root,children,nested,host}=fixture();
  Object.freeze(nested);Object.freeze(children[0]!.children);children.forEach(Object.freeze);Object.freeze(children);Object.freeze(root);
  const captured=await captureSelection(host,limits,{now:()=>0});
  assert.deepEqual(captured.nodes.map(node=>[node.id,node.rendering]),[
    ['root',{opacity:0.75}],['z-first',{opacity:0,siblingIndex:0}],['nested',{opacity:1,siblingIndex:0}],
    ['a-second',{opacity:0.5,siblingIndex:1}],['m-third',{opacity:1e-300,siblingIndex:2}],
  ]);
  assert.deepEqual(captured.nodes.find(node=>node.id==='a-second')!.bbox,children[1]!.absoluteBoundingBox);
  assert.equal(captured.nodes.find(node=>node.id==='a-second')!.text,children[1]!.characters);
  assert.equal(captured.nodes.find(node=>node.id==='m-third')!.visible,false);
  assert.equal(captured.completeness.complete,true);assert.equal(host.skipInvisibleInstanceChildren,true);
});

test('unsupported and invalid opacity remain unknown rather than being invented or truncating capture',async()=>{
  for(const opacity of [undefined,NaN,Infinity,-0.1,1.1]) {
    const {root,children,host}=fixture();
    delete root.opacity;
    if(opacity===undefined)delete children[1]!.opacity;else children[1]!.opacity=opacity;
    const strict=(node:ObservedNode)=>new Proxy(node,{get(target,key,receiver){
      if(!(key in target))throw new Error('Unsupported property must not be read.');
      return Reflect.get(target,key,receiver);
    },set(){throw new Error('Source writes are forbidden.');}});
    root.children=[strict(children[1]!)];host.currentPage.selection=[strict(root)];
    const captured=await captureSelection(host,limits,{now:()=>0});
    assert.deepEqual(captured.nodes[0]!.rendering,{});
    assert.deepEqual(captured.nodes[1]!.rendering,{siblingIndex:0});
    assert.equal(captured.nodes[1]!.text,'Exact text 한글');assert.equal(captured.completeness.complete,true);
  }
});

test('selected root omits sibling order and does not read an external parent children array or opacity',async()=>{
  const {page,root,host}=fixture();let outsideReads=0;
  const outside:ObservedNode={id:'outside',name:'External parent',type:'FRAME',parent:page};
  for(const property of ['children','opacity'])Object.defineProperty(outside,property,{get(){outsideReads++;throw new Error('Outside capture scope.');}});
  root.parent=outside;
  const captured=await captureSelection(host,limits,{now:()=>0});
  assert.deepEqual(captured.nodes[0]!.rendering,{opacity:0.75});
  assert.equal(captured.nodes[0]!.parentId,'outside');assert.equal(outsideReads,0);
});

test('new rendering records count toward metadata bytes while node and time budgets remain bounded',async()=>{
  const {children,host}=fixture();children[1]!.characters='한'.repeat(500);
  const full=await captureSelection(host,limits,{now:()=>0});
  const rendering=[{opacity:0.75},{opacity:0,siblingIndex:0},{opacity:1,siblingIndex:0},{opacity:0.5,siblingIndex:1},{opacity:1e-300,siblingIndex:2}];
  const expected=full.nodes.map((node,index)=>({...node,rendering:rendering[index]}));
  const maxBytes=Buffer.byteLength(JSON.stringify(expected),'utf8')-1;
  assert.ok(maxBytes>=1024);
  const byteLimited=await captureSelection(host,{...limits,maxBytes},{now:()=>0});
  assert.ok(byteLimited.nodes.length<full.nodes.length);assert.match(byteLimited.completeness.reason??'',/Metadata byte budget/);
  assert.ok(Buffer.byteLength(JSON.stringify(byteLimited.nodes),'utf8')<=maxBytes);
  assert.ok(byteLimited.nodes.every(node=>node.rendering!==undefined));
  const nodeLimited=await captureSelection(host,{...limits,maxNodes:2},{now:()=>0});
  assert.equal(nodeLimited.nodes.length,2);assert.match(nodeLimited.completeness.reason??'',/Node budget/);
  assert.deepEqual(nodeLimited.nodes[1]!.rendering,{opacity:0,siblingIndex:0});
  let ticks=0;
  const timeLimited=await captureSelection(host,{...limits,maxDurationMs:100},{now:()=>ticks++<3?0:101});
  assert.equal(timeLimited.nodes.length,2);assert.match(timeLimited.completeness.reason??'',/Time budget/);
  assert.ok(timeLimited.nodes.every(node=>node.rendering!==undefined));assert.equal(host.skipInvisibleInstanceChildren,true);
});

test('PNG rejections suggest explicitly selecting an unrotated inner Frame without retry or offset guesses',async()=>{
  for(const [width,height,reason] of [[257,128,'pixel budget'],[256,200,'aspect/dimensions']] as const) {
    const {root,host}=fixture();let exports=0;
    root.exportAsync=async settings=>{
      exports++;assert.equal(settings.constraint.value,0.5);assert.equal(settings.useAbsoluteBounds,true);
      const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
      const view=new DataView(bytes.buffer);view.setUint32(16,width);view.setUint32(20,height);return bytes;
    };
    const captured=await captureSelection(host,{...limits,maxImageDimension:256},{now:()=>0});
    assert.equal(exports,1);assert.equal(captured.preview,null);assert.deepEqual(captured.bounds,root.absoluteBoundingBox);
    const warning=captured.warnings.find(value=>value.includes(reason))!;
    assert.match(warning,/Select an unrotated inner Frame explicitly and capture it\./);
    assert.ok(warning.includes(`actual=${width}x${height}; requestedMaxDimension=256; scale=0.5;`));
  }
});
