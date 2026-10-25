import { welcomeBridgeClient } from './bridge-auth-helper.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { executePluginCommand, type CaptureHost, type FigmaReadableNode } from '../src/figma/capture.js';
import { BridgeClient, type SocketLike } from '../src/figma/bridge-client.js';
import { NodePreviewResultSchema, SnapshotSchema } from '../src/shared/contracts.js';

function png(width:number,height:number,length=24):Uint8Array {
  const bytes=new Uint8Array(length);
  bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const view=new DataView(bytes.buffer);view.setUint32(16,width);view.setUint32(20,height);
  return bytes;
}
const limits={maxNodes:500,maxBytes:4_000_000,maxDurationMs:5000,maxImageDimension:2048};
const metadataCommand={type:'capture_metadata',fileKey:'synthetic-file',pageId:'page',nodeId:'root',limits} as const;
const previewCommand={type:'preview_capture',fileKey:'synthetic-file',pageId:'page',nodeId:'root'} as const;
const isCode=(expected:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code===expected;

function fixture() {
  const page:FigmaReadableNode={id:'page',name:'Page',type:'PAGE',parent:null};
  const root:FigmaReadableNode={id:'root',name:'Pinned root',type:'FRAME',parent:page,
    absoluteBoundingBox:{x:-100,y:50,width:2048,height:1024},absoluteTransform:[[1,0,-100],[0,1,50]],
    children:[],visible:true,exportAsync:async()=>png(2048,1024)};
  const other:FigmaReadableNode={id:'other',name:'Other selected frame',type:'FRAME',parent:page,
    absoluteBoundingBox:{x:0,y:0,width:100,height:100},children:[]};
  const selection:FigmaReadableNode[]=[root];
  const reads:string[]=[],exports:{settings:unknown}[]=[];
  const originalExport=root.exportAsync!;
  root.exportAsync=async settings=>{exports.push({settings});return originalExport(settings);};
  const host:CaptureHost={fileKey:'synthetic-file',currentPage:{...page,selection},skipInvisibleInstanceChildren:true,
    getNodeByIdAsync:async id=>{reads.push(id);return id==='root'?root:id==='other'?other:null;},
    setCurrentPageAsync:async()=>{throw new Error('Page navigation forbidden.');},
    selectNodes:()=>{throw new Error('Selection writes forbidden.');},
    scrollAndZoomIntoView:()=>{throw new Error('Viewport writes forbidden.');}};
  return {host,root,other,selection,reads,exports};
}

test('metadata capture pins an ID despite selection changes, keeps exact source, and does not export',async()=>{
  const state=fixture();
  state.root.children=[{id:'text',name:'Note',type:'TEXT',parent:state.root,children:[],characters:'Exact\ntext 한글',
    absoluteBoundingBox:{x:0,y:70,width:100,height:30}}];
  const events:Array<{phase:string;nodes:number;bytes:number}>=[];
  const result=SnapshotSchema.parse(await executePluginCommand(state.host,metadataCommand,{
    now:()=>0,id:()=> 'metadata-1',onProgress:progress=>{
      events.push(progress);state.selection.splice(0,1,state.other);
    },
  }));
  assert.deepEqual(result.nodes.map(node=>node.id),['root','text']);
  assert.equal(result.nodes[1]?.text,'Exact\ntext 한글');
  assert.equal(result.preview,null);
  assert.deepEqual(state.selection,[state.other]);
  assert.deepEqual(state.reads,['root','root']);
  assert.equal(state.exports.length,0);
  assert.deepEqual(events.map(event=>[event.phase,event.nodes]),[['structure',2]]);
  assert.ok(events[0]!.bytes>0);
  assert.equal(state.host.skipInvisibleInstanceChildren,true);
});

test('metadata traversal emits bounded progress every 100 nodes and at the final prefix',async()=>{
  const state=fixture();
  state.root.children=Array.from({length:201},(_,index):FigmaReadableNode=>({id:`child-${index}`,name:`Node ${index}`,type:'RECTANGLE',parent:state.root,
    absoluteBoundingBox:{x:index,y:100,width:10,height:10}}));
  const events:Array<{phase:string;nodes:number;bytes:number}>=[];
  const result=SnapshotSchema.parse(await executePluginCommand(state.host,metadataCommand,{now:()=>0,onProgress:event=>events.push(event)}));
  assert.equal(result.nodes.length,202);
  assert.deepEqual(events.map(event=>event.nodes),[100,200,202]);
  assert.ok(events.every(event=>event.phase==='structure'&&event.bytes>0&&event.bytes<=limits.maxBytes));
  assert.ok(events[0]!.bytes<events[1]!.bytes&&events[1]!.bytes<events[2]!.bytes);
  assert.equal(state.exports.length,0);
});

test('metadata result is rejected if pinned source identity or root metadata changes',async()=>{
  for(const change of ['file','page','name','bounds','type'] as const) {
    const state=fixture();
    const before=state.host.skipInvisibleInstanceChildren;
    const original=state.host.getNodeByIdAsync;
    let lookups=0;
    state.host.getNodeByIdAsync=async id=>{
      const node=await original(id);
      if(++lookups===2) {
        if(change==='file')state.host.fileKey='other-file';
        else if(change==='page')state.host.currentPage.id='other-page';
        else if(change==='name')state.root.name='Changed';
        else if(change==='bounds')state.root.absoluteBoundingBox!.width=100;
        else state.root.type='GROUP';
      }
      return node;
    };
    await assert.rejects(executePluginCommand(state.host,metadataCommand,{now:()=>0}),
      isCode(change==='file'?'WRONG_FILE':change==='page'?'WRONG_PAGE':'SOURCE_METADATA_CHANGED'));
    assert.equal(state.host.skipInvisibleInstanceChildren,before);
    assert.equal(state.exports.length,0);
  }
});

test('pinned metadata refuses a node outside the requested page or moved during traversal',async()=>{
  for(const stage of ['before','after'] as const) {
    const state=fixture();
    const foreign:FigmaReadableNode={id:'foreign-page',name:'Other page',type:'PAGE',parent:null};
    if(stage==='before')state.root.parent=foreign;
    else {
      const original=state.host.getNodeByIdAsync;let calls=0;
      state.host.getNodeByIdAsync=async id=>{
        const node=await original(id);
        if(++calls===2)state.root.parent=foreign;
        return node;
      };
    }
    await assert.rejects(executePluginCommand(state.host,metadataCommand,{now:()=>0}),isCode('WRONG_PAGE'));
    assert.equal(state.exports.length,0);
    assert.equal(state.host.skipInvisibleInstanceChildren,true);
  }
});

test('independent root preview exports 2048 pixels without traversing child metadata or selection',async()=>{
  const state=fixture();
  Object.defineProperty(state.root,'children',{get(){throw new Error('Descendant metadata traversal forbidden.');}});
  Object.defineProperty(state.host.currentPage,'selection',{get(){throw new Error('Selection read forbidden.');}});
  const events:Array<{phase:string;nodes:number;bytes:number}>=[];
  const result=NodePreviewResultSchema.parse(await executePluginCommand(state.host,previewCommand,{now:()=>0,onProgress:event=>events.push(event)}));
  assert.equal(result.preview.width,2048);
  assert.equal(result.preview.height,1024);
  assert.equal(result.node.id,'root');
  assert.deepEqual(state.exports.map(call=>call.settings),[{format:'PNG',contentsOnly:true,useAbsoluteBounds:true,constraint:{type:'SCALE',value:1}}]);
  assert.deepEqual(events.map(event=>event.phase),['preview']);
  assert.equal(state.host.skipInvisibleInstanceChildren,true);
});

test('independent native preview discards cancelled, late, oversized, and changed output',async()=>{
  for(const failure of ['cancel','time','bytes','root'] as const) {
    const state=fixture();let cancelled=false,time=0;
    state.root.exportAsync=async()=>{
      if(failure==='cancel')cancelled=true;
      if(failure==='time')time=55_000;
      if(failure==='bytes')return png(2048,1024,8_000_001);
      if(failure==='root')state.root.name='Changed';
      return png(2048,1024);
    };
    await assert.rejects(executePluginCommand(state.host,previewCommand,{now:()=>time,cancelled:()=>cancelled}),
      isCode(failure==='cancel'?'CANCELLED':failure==='time'?'PREVIEW_TIMEOUT':failure==='bytes'?'IMAGE_TOO_LARGE':'NODE_CHANGED'));
    assert.equal(state.host.skipInvisibleInstanceChildren,true);
  }
});

class Socket implements SocketLike {
  readyState=0;onopen:SocketLike['onopen']=null;onmessage:SocketLike['onmessage']=null;
  onclose:SocketLike['onclose']=null;onerror:SocketLike['onerror']=null;sent:string[]=[];
  send(value:string){this.sent.push(value);}
  close(code=1000){this.readyState=3;this.onclose?.({code});}
  open(){this.readyState=1;this.onopen?.({});}
  receive(value:unknown){this.onmessage?.({data:JSON.stringify(value)});}
}
test('progress follows only its authenticated pending request and generation',()=>{
  const sockets:Socket[]=[],requests:Array<{generation:number}>=[];
  const client=new BridgeClient({clientId:'synthetic-client',socketFactory:()=>{const socket=new Socket();sockets.push(socket);return socket;},
    onRequest:(_request,generation)=>requests.push({generation}),onCancel:()=>{},onState:()=>{},
    schedule:()=>0,cancelSchedule:()=>{}});
  client.start('pairing-token-for-tests-32-chars-long');
  const first=sockets[0]!;first.open();
  const progress={type:'progress',requestId:'capture-1',phase:'structure',nodes:100,bytes:2048} as const;
  assert.equal(client.progress(progress,1),false);
  welcomeBridgeClient(first,'pairing-token-for-tests-32-chars-long');
  first.receive({type:'request',requestId:'capture-1',command:metadataCommand});
  const generation=requests[0]!.generation;
  assert.equal(client.progress(progress,generation),true);
  assert.deepEqual(JSON.parse(first.sent.at(-1)!),progress);
  assert.equal(client.progress({...progress,requestId:'other'},generation),false);
  first.receive({type:'cancel',requestId:'capture-1'});
  assert.equal(client.progress(progress,generation),false);
  first.receive({type:'request',requestId:'capture-2',command:metadataCommand});
  first.close(1006);
  assert.equal(client.progress({...progress,requestId:'capture-2'},generation),false);
  client.stop();
});
