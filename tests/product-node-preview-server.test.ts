import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { ServerResponse } from 'node:http';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createDemoProject } from '../src/demo/project.js';
import { startServer } from '../src/server/index.js';
import type { NodePreviewResult } from '../src/shared/contracts.js';

const token='synthetic-node-preview-token-'.repeat(2);
async function setup(t:test.TestContext){
  const dataDir=await mkdtemp(join(tmpdir(),'fsb-node-preview-'));
  const server=await startServer({port:0,dataDir,token,aiConfig:null,requestTimeoutMs:1000});
  t.after(async()=>{await server.close();await rm(dataDir,{recursive:true,force:true});});
  const demo=createDemoProject(),s=demo.snapshots[0]!,node=s.nodes.find(n=>n.id==='heading')!;
  node.rendering={opacity:1,siblingIndex:2};
  demo.annotations=[{id:'review',snapshotId:s.id,name:'Saved approved region',role:'element',bbox:node.bbox!,parentId:null,sourceRefs:[{snapshotId:s.id,nodeId:node.id,matchType:'exact'}],origin:'human',reviewStatus:'approved',revision:1}];
  const project=await server.store.importProject(demo);
  const connect=async()=>{const ws=new WebSocket(server.url.replace('http:','ws:')+'/bridge',{origin:'null'});t.after(()=>ws.terminate());await once(ws,'open');const welcomed=once(ws,'message');ws.send(JSON.stringify({type:'hello',token,clientId:'preview-test'}));return{ws,sessionId:JSON.parse((await welcomed)[0].toString()).sessionId as string};};
  const plugin=await connect();
  const input={expectedRevision:project.revision,annotationId:'review',expectedSessionId:plugin.sessionId,nodeId:node.id};
  const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(node.bbox!.width,16);png.writeUInt32BE(node.bbox!.height,20);
  const result:NodePreviewResult={fileKey:s.source.fileKey!,pageId:s.source.pageId,node:{...node,rendering:{opacity:1}},observedAt:'2026-10-24T02:00:00.000Z',preview:{mimeType:'image/png',base64:png.toString('base64'),width:node.bbox!.width,height:node.bbox!.height},warnings:['Current export is not a historical pixel contribution proof.']};
  const api=(body:unknown,signal?:AbortSignal)=>fetch(server.url+`/api/projects/${project.id}/source-preview`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),...(signal?{signal}:{})});
  const disk=()=>readFile(join(dataDir,'projects',`${project.id}.json`),'utf8');
  const reply=(request:{requestId:string},value:unknown=result)=>plugin.ws.send(JSON.stringify({type:'response',requestId:request.requestId,ok:true,result:value}));
  return{...server,...plugin,project,s,node,result,input,api,disk,reply,connect};
}
async function code(r:Response,status:number,expected:string){assert.equal(r.status,status);assert.equal((await r.json() as {error:{code:string}}).error.code,expected);}

test('source-preview exports one captured node without changing snapshots, approvals, revisions or history',async t=>{
  const h=await setup(t),before=await h.disk();
  h.ws.on('message',raw=>{const r=JSON.parse(raw.toString());assert.deepEqual(r.command,{type:'preview_node',fileKey:h.s.source.fileKey,pageId:h.s.source.pageId,nodeId:h.node.id});h.reply(r);});
  const response=await h.api(h.input);assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{projectId:h.project.id,revision:h.project.revision,annotationId:'review',snapshotId:h.s.id,sessionId:h.sessionId,result:h.result});
  assert.equal(await h.disk(),before);assert.deepEqual(await h.store.get(h.project.id),h.project);
});

test('source-preview rejects stale input, uncaptured nodes and arbitrary export options before dispatch',async t=>{
  const h=await setup(t),dispatch=t.mock.method(h.broker,'request'),before=await h.disk();
  await code(await h.api({...h.input,expectedRevision:99}),409,'REVISION_CONFLICT');
  await code(await h.api({...h.input,expectedSessionId:'old'}),409,'PLUGIN_SESSION_CHANGED');
  await code(await h.api({...h.input,annotationId:'missing'}),404,'NOT_FOUND');
  await code(await h.api({...h.input,nodeId:'outside'}),409,'SOURCE_OUTSIDE_CAPTURE');
  await code(await h.api({...h.input,fileKey:'other'}),400,'INVALID_INPUT');
  assert.equal(dispatch.mock.callCount(),0);assert.equal(await h.disk(),before);
});

test('source-preview rejects changed source identity, text, geometry, visibility and observed opacity',async t=>{
  const h=await setup(t),before=await h.disk();let current=h.result;
  h.ws.on('message',raw=>h.reply(JSON.parse(raw.toString()),current));
  const mutations:Array<(v:NodePreviewResult)=>void>=[v=>{v.fileKey='other';},v=>{v.pageId='other';},v=>{v.node.id='other';},v=>{v.node.parentId='other';},v=>{v.node.name+=' new';},v=>{v.node.type='RECTANGLE';},v=>{v.node.bbox!.x++;},v=>{v.node.text+=' changed';},v=>{v.node.visible=false;},v=>{v.node.rendering={opacity:0};},v=>{v.node.sourceFileKey='other';},v=>{v.node.sourcePageId='other';}];
  for(const mutate of mutations){current=structuredClone(h.result);mutate(current);await code(await h.api(h.input),409,'SOURCE_METADATA_CHANGED');assert.equal(await h.disk(),before);}
});

test('source-preview rejects oversized, malformed and differently sized PNG responses',async t=>{
  const h=await setup(t);let current=h.result;
  h.ws.on('message',raw=>h.reply(JSON.parse(raw.toString()),current));
  for(const mutate of [
    (v:NodePreviewResult)=>{v.preview.base64='not-png';},
    (v:NodePreviewResult)=>{v.preview.width=1025;},
    (v:NodePreviewResult)=>{const bytes=Buffer.alloc(2_000_001);Buffer.from(v.preview.base64,'base64').copy(bytes);v.preview.base64=bytes.toString('base64');},
    (v:NodePreviewResult)=>{const bytes=Buffer.from(v.preview.base64,'base64');bytes.writeUInt32BE(1,16);v.preview.width=1;v.preview.base64=bytes.toString('base64');},
  ]){current=structuredClone(h.result);mutate(current);await code(await h.api(h.input),502,'INVALID_PLUGIN_RESPONSE');}
});

test('source-preview discards response after a project revision changes',async t=>{
  const h=await setup(t),requested=once(h.ws,'message'),pending=h.api(h.input);
  const r=JSON.parse((await requested)[0].toString());
  await h.store.mutate(h.project.id,h.project.revision,{type:'rename_project',name:'Concurrent edit'});
  const before=await h.disk();h.reply(r);await code(await pending,409,'REVISION_CONFLICT');assert.equal(await h.disk(),before);
});

test('source-preview discards a result when session changes during final project read',async t=>{
  const h=await setup(t);let entered!:()=>void,release!:()=>void,reads=0;
  const reading=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});t.after(()=>release());
  const get=h.store.get.bind(h.store);t.mock.method(h.store,'get',async (id:string)=>{const p=await get(id);if(++reads===2){entered();await gate;}return p;});
  h.ws.on('message',raw=>h.reply(JSON.parse(raw.toString())));
  const pending=h.api(h.input);await reading;await h.connect();release();await code(await pending,409,'PLUGIN_SESSION_CHANGED');
});

test('source-preview propagates client cancellation and ignores a late export',async t=>{
  const h=await setup(t),before=await h.disk(),requested=once(h.ws,'message'),abort=new AbortController();
  const rejected=assert.rejects(h.api(h.input,abort.signal),/abort/i),r=JSON.parse((await requested)[0].toString());
  const cancelled=once(h.ws,'message');abort.abort();await rejected;
  assert.deepEqual(JSON.parse((await cancelled)[0].toString()),{type:'cancel',requestId:r.requestId});
  const pong=once(h.ws,'message');h.reply(r);h.ws.send(JSON.stringify({type:'ping'}));
  assert.deepEqual(JSON.parse((await pong)[0].toString()),{type:'pong'});
  assert.equal(h.broker.status.pendingRequests,0);assert.equal(await h.disk(),before);
  const nextRequest=once(h.ws,'message'),next=h.api(h.input),request=JSON.parse((await nextRequest)[0].toString());
  assert.notEqual(request.requestId,r.requestId);h.reply(request);
  assert.equal((await next).status,200);assert.equal(await h.disk(),before);
});

test('source-preview cancelled during the initial project read never dispatches an export',async t=>{
  const h=await setup(t),dispatch=t.mock.method(h.broker,'request');let entered!:()=>void,release!:()=>void,closed!:()=>void;
  const reading=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;}),closing=new Promise<void>(resolve=>{closed=resolve;});
  t.after(()=>release());t.mock.method(h.store,'get',async()=>{entered();await gate;return h.project;},{times:1});
  const emit=ServerResponse.prototype.emit;
  t.mock.method(ServerResponse.prototype,'emit',function(this:ServerResponse,event:string|symbol,...args:unknown[]){const value=emit.call(this,event,...args);if(event==='close'&&this.req.url?.endsWith('/source-preview'))closed();return value;});
  const abort=new AbortController(),rejected=assert.rejects(h.api(h.input,abort.signal),/abort/i);
  await reading;abort.abort();await rejected;await closing;release();
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(dispatch.mock.callCount(),0);
});

test('source-preview requires captured file identity before dispatch',async t=>{
  const h=await setup(t),p=structuredClone(h.project);
  p.snapshots[0]!.source.fileKey=null;for(const n of p.snapshots[0]!.nodes)n.sourceFileKey=null;
  t.mock.method(h.store,'get',async()=>p);const dispatch=t.mock.method(h.broker,'request');
  await code(await h.api(h.input),409,'FILE_IDENTITY_UNAVAILABLE');assert.equal(dispatch.mock.callCount(),0);
});
