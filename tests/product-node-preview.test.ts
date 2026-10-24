import test from 'node:test';
import assert from 'node:assert/strict';
import { executePluginCommand, type CaptureHost, type CaptureOptions, type FigmaReadableNode } from '../src/figma/capture.js';
import { NODE_PREVIEW_MAX_BYTES, NODE_PREVIEW_MAX_DURATION_MS, NodePreviewResultSchema } from '../src/shared/contracts.js';

function png(width=1024,height=512,length=24):Uint8Array {
  const bytes=new Uint8Array(length);bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const view=new DataView(bytes.buffer);view.setUint32(16,width);view.setUint32(20,height);return bytes;
}
const command={type:'preview_node',fileKey:'synthetic-file',pageId:'page',nodeId:'node'} as const;
function fixture() {
  const calls:{lookups:string[];exports:Parameters<NonNullable<FigmaReadableNode['exportAsync']>>[0][]}={lookups:[],exports:[]};
  const page:FigmaReadableNode={id:'page',name:'Page',type:'PAGE',parent:null};
  const parent:FigmaReadableNode={id:'parent',name:'Parent',type:'FRAME',parent:page};
  const node:FigmaReadableNode={id:'node',name:'Exact node',type:'TEXT',parent,visible:true,opacity:0.5,
    characters:'Exact\nsource 한글',absoluteBoundingBox:{x:-800.5,y:-300.25,width:2048,height:1024},
    absoluteTransform:[[1,0,-800.5],[0,1,-300.25]],exportAsync:async settings=>{calls.exports.push(settings);return png();}};
  const host:CaptureHost={fileKey:'synthetic-file',currentPage:{...page,selection:[]},skipInvisibleInstanceChildren:true,
    getNodeByIdAsync:async id=>{calls.lookups.push(id);return id===node.id?node:null;},
    setCurrentPageAsync:async()=>{throw new Error('Page writes forbidden.');},
    selectNodes:()=>{throw new Error('Selection writes forbidden.');},scrollAndZoomIntoView:()=>{throw new Error('Viewport writes forbidden.');}};
  const run=(options:CaptureOptions={})=>executePluginCommand(host,command,{now:()=>0,capturedAt:()=> '2026-10-24T00:00:00.000Z',...options});
  return {host,page,parent,node,calls,run};
}
const code=(expected:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code===expected;

test('node export reads one target and parent IDs, preserves exact scalars, and never reads children or selection',async()=>{
  const {host,page,parent,node,calls,run}=fixture();
  const ancestry=(value:FigmaReadableNode)=>new Proxy(value,{get(target,key,receiver){
    assert.ok(key==='id'||key==='parent',`Unexpected ancestor read: ${String(key)}`);return Reflect.get(target,key,receiver);
  },set(){throw new Error('Source writes forbidden.');}});
  parent.parent=ancestry(page);node.parent=ancestry(parent);
  Object.defineProperty(node,'children',{get(){throw new Error('Subtree reads forbidden.');}});
  Object.defineProperty(host.currentPage,'selection',{get(){throw new Error('Selection reads forbidden.');}});
  Object.freeze(node.absoluteBoundingBox);Object.freeze(node);
  const result=NodePreviewResultSchema.parse(await run());
  assert.deepEqual(calls.lookups,['node']);assert.deepEqual(calls.exports,[{format:'PNG',contentsOnly:true,useAbsoluteBounds:true,constraint:{type:'SCALE',value:0.5}}]);
  assert.equal(result.fileKey,command.fileKey);assert.equal(result.pageId,command.pageId);assert.equal(result.observedAt,'2026-10-24T00:00:00.000Z');
  assert.deepEqual(result.node,{id:'node',parentId:'parent',type:'TEXT',name:'Exact node',text:'Exact\nsource 한글',
    bbox:{x:-800.5,y:-300.25,width:2048,height:1024},visible:true,rendering:{opacity:0.5},sourceFileKey:command.fileKey,sourcePageId:command.pageId});
  assert.equal(result.preview.width,1024);assert.equal(result.preview.height,512);assert.equal(result.preview.base64,Buffer.from(png()).toString('base64'));
  assert.match(result.warnings.join(' '),/ancestor.*mask.*blend/i);assert.match(result.warnings.join(' '),/memory.*runtime|runtime.*memory/i);
  assert.equal(host.skipInvisibleInstanceChildren,true);
});

test('unsupported opacity stays unknown, while hidden and zero-opacity nodes can return an uninterpreted PNG',async()=>{
  for(const opacity of [undefined,NaN,Infinity,-1,2,0]) {
    const {host,node,run}=fixture();if(opacity===undefined)delete node.opacity;else node.opacity=opacity;node.visible=false;
    const strict=new Proxy(node,{get(target,key,receiver){
      if(key==='then')return undefined;
      if(!(key in target))throw new Error('Unsupported property read.');return Reflect.get(target,key,receiver);
    },set(){throw new Error('Source writes forbidden.');}});
    host.getNodeByIdAsync=async()=>strict;
    const result=NodePreviewResultSchema.parse(await run());
    assert.deepEqual(result.node.rendering,opacity===0?{opacity:0}:{});assert.equal(result.node.visible,false);
    assert.ok(result.warnings.some(warning=>/blank/i.test(warning)));assert.equal(host.skipInvisibleInstanceChildren,true);
  }
});

test('wrong file or current page rejects before lookup without navigating',async()=>{
  for(const failure of ['file','page','identity'] as const) {
    const {host,calls,run}=fixture();if(failure==='file')host.fileKey='other';else if(failure==='page')host.currentPage.id='other';else host.fileKey=undefined;
    await assert.rejects(run(),code(failure==='file'?'WRONG_FILE':failure==='page'?'WRONG_PAGE':'FILE_IDENTITY_UNAVAILABLE'));
    assert.deepEqual(calls.lookups,[]);assert.deepEqual(calls.exports,[]);assert.equal(host.skipInvisibleInstanceChildren,true);
  }
});

test('unavailable or excluded targets and invalid scalar metadata never export',async()=>{
  for(const failure of ['missing','mismatched-id','PAGE','DOCUMENT','SLICE','bounds','text','export'] as const) {
    const {host,node,calls,run}=fixture();
    if(failure==='missing')host.getNodeByIdAsync=async()=>null;
    else if(failure==='mismatched-id')host.getNodeByIdAsync=async()=>({...node,id:'other'});
    else if(failure==='bounds')node.absoluteBoundingBox={x:0,y:0,width:0,height:10};
    else if(failure==='text')node.characters='x'.repeat(50001);
    else if(failure==='export')delete node.exportAsync;
    else node.type=failure;
    await assert.rejects(run(),code(failure==='bounds'?'INVALID_BOUNDS':failure==='text'?'INVALID_SOURCE_METADATA':failure==='export'?'PREVIEW_UNAVAILABLE':'NODE_UNAVAILABLE'));
    assert.deepEqual(calls.exports,[]);assert.equal(host.skipInvisibleInstanceChildren,true);
  }
});

test('ancestry traversal accepts at most 256 parent IDs and rejects wrong-page nodes and cycles',async()=>{
  for(const depth of [256,257]) {
    const {node,page,calls,run,host}=fixture();let ancestor=page,reads=0;
    for(let index=1;index<depth;index++)ancestor={id:`ancestor-${index}`,name:'',type:'FRAME',parent:ancestor};
    const wrap=(value:FigmaReadableNode):FigmaReadableNode=>new Proxy(value,{get(target,key){
      if(key==='parent'){reads++;return target.parent?wrap(target.parent):null;}if(key==='id')return target.id;
      throw new Error('Only ancestor IDs and parent links may be read.');
    }});
    node.parent=wrap(ancestor);
    if(depth===256){await run();assert.equal(calls.exports.length,1);assert.ok(reads<=512);}
    else {await assert.rejects(run(),code('WRONG_PAGE'));assert.equal(calls.exports.length,0);assert.ok(reads<=256);}
    assert.equal(host.skipInvisibleInstanceChildren,true);
  }
  for(const cycle of [false,true]) {
    const {node,parent,page,run}=fixture();if(cycle)parent.parent=node;else page.id='other-page';
    await assert.rejects(run(),code('WRONG_PAGE'));
  }
});

test('changes to each observed source scalar during export reject the live image',async()=>{
  const changes:Array<(node:FigmaReadableNode)=>void>=[
    node=>{node.id='other';},node=>{node.name+=' changed';},node=>{node.type='RECTANGLE';},node=>{node.parent={...node.parent!,id:'moved'};},
    node=>{node.absoluteBoundingBox!.x++;},node=>{node.characters+=' changed';},node=>{node.visible=false;},node=>{node.opacity=0.25;},
  ];
  for(const change of changes) {
    const {node,host,run}=fixture();let exports=0;node.exportAsync=async()=>{exports++;change(node);return png();};
    await assert.rejects(run(),code('NODE_CHANGED'));assert.equal(exports,1);assert.equal(host.skipInvisibleInstanceChildren,true);
  }
});

test('reparented ancestors and changed transforms during export cannot pass unchanged local scalar checks',async()=>{
  for(const change of ['ancestor','transform'] as const) {
    const {node,parent,page,host,run}=fixture();node.exportAsync=async()=>{
      if(change==='ancestor')parent.parent={id:'inserted',name:'',type:'FRAME',parent:page};
      else node.absoluteTransform=[[1,0,-800],[0,1,-300]];
      return png();
    };
    await assert.rejects(run(),code('NODE_CHANGED'));assert.equal(host.skipInvisibleInstanceChildren,true);
  }
});

test('file and current-page changes during either asynchronous step discard the result',async()=>{
  for(const stage of ['lookup','export'] as const)for(const field of ['file','page'] as const) {
    const {host,node,run}=fixture();const change=()=>{if(field==='file')host.fileKey='other';else host.currentPage.id='other';};
    if(stage==='lookup')host.getNodeByIdAsync=async()=>{change();return node;};else node.exportAsync=async()=>{change();return png();};
    await assert.rejects(run(),code(field==='file'?'WRONG_FILE':'WRONG_PAGE'));assert.equal(host.skipInvisibleInstanceChildren,true);
  }
});

test('cancelled or late native operations are discarded and preserve the original hidden-instance flag',async()=>{
  for(const stage of ['before','lookup','export'] as const)for(const initialFlag of [true,false])for(const reason of ['cancel','time'] as const) {
    const {host,node,calls,run}=fixture();host.skipInvisibleInstanceChildren=initialFlag;let cancelled=false,time=0;
    const stop=()=>{if(reason==='cancel')cancelled=true;else time=NODE_PREVIEW_MAX_DURATION_MS;};
    if(stage==='before')cancelled=true;
    else if(stage==='lookup')host.getNodeByIdAsync=async()=>{stop();return node;};
    else node.exportAsync=async()=>{stop();return png();};
    await assert.rejects(run({now:()=>time,cancelled:()=>cancelled}),code(stage==='before'||reason==='cancel'?'CANCELLED':'PREVIEW_TIMEOUT'));
    if(stage!=='export')assert.equal(calls.exports.length,0);assert.equal(host.skipInvisibleInstanceChildren,initialFlag);
  }
});

test('rotated, reflected, skewed and non-finite transforms are rejected before export',async()=>{
  for(const transform of [[[0,-1,0],[1,0,0]],[[-1,0,0],[0,1,0]],[[1,0.1,0],[0,1,0]],[[NaN,0,0],[0,1,0]]] as const) {
    const {node,host,calls,run}=fixture();node.absoluteTransform=transform;
    await assert.rejects(run(),code('UNSUPPORTED_TRANSFORM'));assert.equal(calls.exports.length,0);assert.equal(host.skipInvisibleInstanceChildren,true);
  }
});

test('PNG byte, pixel and mapping limits fail closed after one export without diagnostic source data',async()=>{
  for(const [bytes,expected] of [[png(1024,512,NODE_PREVIEW_MAX_BYTES+1),'IMAGE_TOO_LARGE'],[png(1025,512),'INVALID_IMAGE_SIZE'],
    [png(1000,512),'COORDINATE_MISMATCH'],[png(0,0),'INVALID_IMAGE_SIZE'],[new Uint8Array(24),'INVALID_PNG']] as const) {
    const {node,host,run}=fixture();let exports=0;node.exportAsync=async()=>{exports++;return bytes;};
    await assert.rejects(run(),error=>{
      assert.ok(code(expected)(error));const message=(error as Error).message;
      for(const secret of ['synthetic-file','Exact node','source 한글','iVBOR'])assert.ok(!message.includes(secret));return true;
    });
    assert.equal(exports,1);assert.equal(host.skipInvisibleInstanceChildren,true);
  }
});

test('hidden-instance access is scoped and native failures do not disclose source text',async()=>{
  const {host,node,run}=fixture();const hidden=new Proxy(node,{get(target,key,receiver){
    assert.equal(host.skipInvisibleInstanceChildren,false);return Reflect.get(target,key,receiver);
  },set(){throw new Error('Source writes forbidden.');}});
  host.getNodeByIdAsync=async()=>host.skipInvisibleInstanceChildren?null:hidden;
  await run();assert.equal(host.skipInvisibleInstanceChildren,true);
  node.exportAsync=async()=>{throw new Error('Sensitive source text must not escape.');};
  await assert.rejects(run(),error=>{assert.ok(code('PREVIEW_UNAVAILABLE')(error));assert.ok(!(error as Error).message.includes('Sensitive'));return true;});
  assert.equal(host.skipInvisibleInstanceChildren,true);
});
