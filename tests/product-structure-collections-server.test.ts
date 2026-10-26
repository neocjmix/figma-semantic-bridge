import { authenticatePluginSocket } from './bridge-auth-helper.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';
import { BridgeApi } from '../src/mcp/api-client.js';
import { startServer } from '../src/server/index.js';
import { CollectionViewSchema, type StructureChunk } from '../src/shared/structure-collection.js';
import type { PluginCommand,SourceNode } from '../src/shared/contracts.js';

const root:SourceNode={id:'root',parentId:'page',name:'Synthetic root',type:'FRAME',bbox:{x:-10,y:20,width:100,height:100},
  visible:true,sourceFileKey:'synthetic',sourcePageId:'page',rendering:{opacity:1}};
const original=' exact 한글 👩‍💻 e\u0301\r\n'.repeat(800);
function chunk(id:string,sequence:number):StructureChunk {
  return {collectionId:id,sequence,fileKey:'synthetic',pageId:'page',root,bounds:root.bbox!,
    startedAt:'2026-10-25T00:00:00.000Z',observedAt:'2026-10-25T00:00:01.000Z',
    nodes:sequence===0?[root]:[{...root,id:'text',parentId:'root',type:'TEXT',name:'Exact requirement',text:original}],
    childCounts:sequence===0?[1]:[0],complete:sequence===1,nextSequence:sequence===0?1:null,
    warnings:['Synthetic integration observation.'],consistency:'live-session-observation'};
}
type Request={type:'request';requestId:string;command:PluginCommand};
async function until<T>(read:()=>Promise<T>,accept:(v:T)=>boolean){
  const end=Date.now()+4000;
  while(Date.now()<end){const value=await read();if(accept(value))return value;await new Promise(r=>setTimeout(r,5));}
  assert.fail('Synthetic collection did not settle.');
}
async function fixture(t:test.TestContext,requestTimeoutMs=1000){
  const dataDir=await mkdtemp(join(tmpdir(),'fsb-collection-server-'));
  let server=await startServer({port:0,dataDir,aiConfig:null,requestTimeoutMs});
  const packetTimeouts:number[]=[];
  const request=server.broker.request.bind(server.broker);
  server.broker.request=(command,options={})=>{
    if(command.type==='read_structure_chunk')packetTimeouts.push(options.timeoutMs!);
    return request(command,options);
  };
  const token=server.token;
  const api=(path:string,body?:unknown)=>fetch(server.url+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,
    ...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const project=await server.store.create('Synthetic collection test'),base=`/api/projects/${project.id}/collections`;
  const ws=new WebSocket(server.url.replace('http:','ws:')+'/bridge',{origin:'null'});
  t.after(async()=>{ws.terminate();await server.close();await rm(dataDir,{recursive:true,force:true});});
  await once(ws,'open');const {sessionId}=await authenticatePluginSocket(ws,token,'synthetic-collection-plugin');
  const seen:Request[]=[],cancels:string[]=[];
  const reply=(request:Request,result:unknown)=>ws.send(JSON.stringify({type:'response',requestId:request.requestId,ok:true,result}));
  const replyError=(request:Request,code:string,message:string)=>ws.send(JSON.stringify({type:'response',requestId:request.requestId,ok:false,error:{code,message}}));
  let handler=(request:Request)=>{
    if(request.command.type==='read_structure_chunk')reply(request,chunk(request.command.collectionId,request.command.sequence));
  };
  let releaseHandler=(request:Request)=>reply(request,{released:true});
  ws.on('message',bytes=>{
    const request=JSON.parse(String(bytes)) as Request|{type:'cancel';requestId:string};
    if(request.type==='cancel'){cancels.push(request.requestId);return;}
    if(request.type!=='request')return;seen.push(request);
    if(request.command.type==='get_selection')reply(request,{fileKey:'synthetic',pageId:'page',nodes:[{id:root.id,name:root.name,type:root.type,bbox:root.bbox}]});
    else if(request.command.type==='release_structure_cursor')releaseHandler(request);
    else handler(request);
  });
  const prepare=async()=>{const response=await api(base,{expectedRevision:0,expectedSessionId:sessionId});assert.equal(response.status,201);return CollectionViewSchema.parse(await response.json());};
  const get=async(id:string)=>CollectionViewSchema.parse(await(await api(base+'/'+id)).json());
  return {api,base,project,seen,cancels,packetTimeouts,prepare,get,reply,replyError,handler(fn:typeof handler){handler=fn;},onRelease(fn:typeof releaseHandler){releaseHandler=fn;},
    async unchanged(){assert.deepEqual(await server.store.get(project.id),project);},
    get url(){return server.url;},token,
    async restart(){await server.close();server=await startServer({port:0,dataDir,token,aiConfig:null});},
  };
}

test('chunk acquisition stays separate from projects and exposes complete raw nodes/text through HTTP and MCP',async t=>{
  const h=await fixture(t),prepared=await h.prepare();
  assert.equal(prepared.status,'prepared');assert.equal(h.seen.length,1);
  assert.equal((await h.api(`${h.base}/${prepared.id}/nodes`,{})).status,409);
  assert.equal((await h.api(`${h.base}/${prepared.id}/start`,{})).status,202);
  const complete=await until(()=>h.get(prepared.id),v=>v.status==='complete');
  assert.equal(complete.nodeCount,2);assert.equal(complete.chunkCount,2);assert.equal(complete.reviewStatus,'unreviewed');
  assert.deepEqual(h.seen.filter(r=>r.command.type==='read_structure_chunk').map(r=>r.command.type==='read_structure_chunk'&&r.command.sequence),[0,1]);
  const nodesResponse=await h.api(`${h.base}/${prepared.id}/nodes`,{parentId:'root'});assert.equal(nodesResponse.status,200);
  const nodes=await nodesResponse.json();assert.equal(nodes.nodes[0].id,'text');assert.equal(nodes.nodes[0].textLength,original.length);assert.equal('text' in nodes.nodes[0],false);
  const mcp=createMcpServer(new BridgeApi(h.url,h.token,{allowInsecureHttp:true})),client=new Client({name:'collection-test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();await mcp.connect(b);await client.connect(a);
  t.after(async()=>{await client.close();await mcp.close();});
  const tools=await client.listTools();assert.ok(tools.tools.some(tool=>tool.name==='read_source_evidence'&&tool.annotations?.readOnlyHint));
  assert.ok(!tools.tools.some(tool=>tool.name==='read_collection_text'));
  let offset:number|null=0,text='';
  while(offset!==null){
    const response=await client.callTool({name:'read_collection_text',arguments:{projectId:h.project.id,collectionId:prepared.id,nodeId:'text',offset,limit:37}});
    assert.ok(!response.isError);const part=JSON.parse((response.content as {text:string}[])[0]!.text);
    assert.equal(part.offset,offset);text+=part.text;offset=part.nextOffset;
  }
  assert.equal(text,original);await h.unchanged();
  const approved=await client.callTool({name:'get_approved_context',arguments:{projectId:h.project.id}});
  assert.equal(JSON.parse((approved.content as {text:string}[])[0]!.text).sourceNodes.length,0);
  await h.restart();assert.equal((await h.get(prepared.id)).status,'complete');
  const after=await(await h.api(`${h.base}/${prepared.id}/nodes`,{nodeIds:['text']})).json();assert.equal(after.nodes[0].id,'text');
});

test('pause waits for a durable chunk and resumes at the next sequence without repeating earlier source reads',async t=>{
  const h=await fixture(t),prepared=await h.prepare();let pending:Request|undefined;
  h.handler(request=>{pending=request;});
  await h.api(`${h.base}/${prepared.id}/start`,{});
  await until(async()=>pending,v=>!!v);
  const stopping=CollectionViewSchema.parse(await(await h.api(`${h.base}/${prepared.id}/stop`,{})).json());
  assert.equal(stopping.status,'running');assert.equal(stopping.pauseRequested,true);
  h.reply(pending!,chunk(prepared.id,0));
  const paused=await until(()=>h.get(prepared.id),v=>v.status==='paused');assert.equal(paused.chunkCount,1);
  assert.equal((await h.api(`${h.base}/${prepared.id}/nodes`,{})).status,409);
  h.handler(request=>{if(request.command.type==='read_structure_chunk')h.reply(request,chunk(prepared.id,request.command.sequence));});
  assert.equal((await h.api(`${h.base}/${prepared.id}/resume`,{})).status,202);
  await until(()=>h.get(prepared.id),v=>v.status==='complete');
  assert.deepEqual(h.seen.filter(r=>r.command.type==='read_structure_chunk').map(r=>r.command.type==='read_structure_chunk'&&r.command.sequence),[0,1]);
  await h.unchanged();
});

test('wrong chunk sequence cannot produce a complete collection or leak raw data into approved context',async t=>{
  const h=await fixture(t),prepared=await h.prepare();
  h.handler(request=>h.reply(request,chunk(prepared.id,1)));
  await h.api(`${h.base}/${prepared.id}/start`,{});
  const stopped=await until(()=>h.get(prepared.id),v=>v.status==='interrupted');
  assert.equal(stopped.nodeCount,0);assert.ok(stopped.error);
  assert.equal((await h.api(`${h.base}/${prepared.id}/nodes`,{})).status,409);
  await h.unchanged();
});

test('restart refuses continuation of a paused live cursor but retains the incomplete acquisition record',async t=>{
  const h=await fixture(t),prepared=await h.prepare();let pending:Request|undefined;
  h.handler(request=>{pending=request;});await h.api(`${h.base}/${prepared.id}/start`,{});
  await until(async()=>pending,v=>!!v);await h.api(`${h.base}/${prepared.id}/stop`,{});h.reply(pending!,chunk(prepared.id,0));
  await until(()=>h.get(prepared.id),v=>v.status==='paused');
  await h.restart();
  const response=await h.api(`${h.base}/${prepared.id}/resume`,{});assert.equal(response.status,503);
  assert.equal((await h.get(prepared.id)).nodeCount,1);assert.notEqual((await h.get(prepared.id)).status,'complete');await h.unchanged();
});

test('one fast busy rejection retries the identical packet within its original deadline',async t=>{
  const h=await fixture(t),prepared=await h.prepare();let busy=true;
  h.handler(request=>{
    if(request.command.type!=='read_structure_chunk')return;
    if(busy){busy=false;h.replyError(request,'PLUGIN_BUSY','Synthetic native read is still running.');return;}
    h.reply(request,chunk(prepared.id,request.command.sequence));
  });
  assert.equal((await h.api(`${h.base}/${prepared.id}/start`,{})).status,202);
  const complete=await until(()=>h.get(prepared.id),view=>view.status==='complete');
  assert.equal(complete.nodeCount,2);
  const reads=h.seen.filter(request=>request.command.type==='read_structure_chunk');
  assert.deepEqual(reads.map(request=>request.command.type==='read_structure_chunk'&&request.command.sequence),[0,0,1]);
  assert.equal(h.packetTimeouts[0],1000);assert.ok(h.packetTimeouts[1]!>0&&h.packetTimeouts[1]!<=750);
  assert.deepEqual(reads[0]!.command,reads[1]!.command);await h.unchanged();
});

test('repeated busy rejection pauses after one retry and manual resume completes the same source',async t=>{
  const h=await fixture(t),prepared=await h.prepare();let busy=2;
  h.handler(request=>{
    if(request.command.type!=='read_structure_chunk')return;
    if(busy-->0){h.replyError(request,'PLUGIN_BUSY','Synthetic native read is still running.');return;}
    h.reply(request,chunk(prepared.id,request.command.sequence));
  });
  assert.equal((await h.api(`${h.base}/${prepared.id}/start`,{})).status,202);
  const paused=await until(()=>h.get(prepared.id),view=>view.status==='paused');
  assert.equal(paused.error?.code,'PLUGIN_BUSY');assert.equal(paused.chunkCount,0);assert.equal(paused.nodeCount,0);
  assert.equal((await h.api(`${h.base}/${prepared.id}/resume`,{})).status,202);
  const complete=await until(()=>h.get(prepared.id),view=>view.status==='complete');
  assert.equal(complete.nodeCount,2);
  assert.deepEqual(h.seen.filter(request=>request.command.type==='read_structure_chunk').map(request=>
    request.command.type==='read_structure_chunk'&&request.command.sequence),[0,0,0,1]);
  await h.unchanged();
});

test('pause and shutdown prevent a pending automatic busy retry',async t=>{
  for(const action of ['pause','shutdown'] as const)await t.test(action,async t=>{
    const h=await fixture(t),prepared=await h.prepare();
    h.handler(request=>h.replyError(request,'PLUGIN_BUSY','Synthetic operation is busy.'));
    await h.api(`${h.base}/${prepared.id}/start`,{});
    await until(async()=>h.seen.filter(request=>request.command.type==='read_structure_chunk').length,count=>count===1);
    if(action==='pause'){
      await h.api(`${h.base}/${prepared.id}/stop`,{});
      await until(()=>h.get(prepared.id),view=>view.status==='paused');
    }else await h.restart();
    assert.equal(h.seen.filter(request=>request.command.type==='read_structure_chunk').length,1);
    assert.equal((await h.get(prepared.id)).nodeCount,0);await h.unchanged();
  });
});

test('failed cursor-release acknowledgement preserves paused ownership until a successful remove',async t=>{
  const h=await fixture(t),pausedTask=await h.prepare();let pending:Request|undefined;
  h.handler(request=>{pending=request;});
  assert.equal((await h.api(`${h.base}/${pausedTask.id}/start`,{})).status,202);
  await until(async()=>pending,request=>!!request);
  assert.equal((await h.api(`${h.base}/${pausedTask.id}/stop`,{})).status,200);
  h.reply(pending!,chunk(pausedTask.id,0));
  await until(()=>h.get(pausedTask.id),view=>view.status==='paused');
  const nextTask=await h.prepare();
  let firstRelease=true;
  h.onRelease(request=>{
    if(firstRelease){firstRelease=false;h.replyError(request,'PLUGIN_BUSY','Synthetic release was not applied.');}
    else h.reply(request,{released:true});
  });
  const failedRemoval=await h.api(`${h.base}/${pausedTask.id}/remove`,{});
  assert.equal(failedRemoval.status,409);
  assert.equal((await h.get(pausedTask.id)).status,'paused');
  assert.equal((await h.api(`${h.base}/${nextTask.id}/start`,{})).status,409);
  assert.equal((await h.get(nextTask.id)).status,'prepared');
  assert.equal((await h.api(`${h.base}/${pausedTask.id}/remove`,{})).status,200);
  h.handler(request=>{if(request.command.type==='read_structure_chunk')h.reply(request,chunk(nextTask.id,request.command.sequence));});
  assert.equal((await h.api(`${h.base}/${nextTask.id}/start`,{})).status,202);
  assert.equal((await until(()=>h.get(nextTask.id),view=>view.status==='complete')).nodeCount,2);
  await h.unchanged();
});

test('timed-out first packet can be replayed at the same sequence after manual resume',async t=>{
  const h=await fixture(t,500),prepared=await h.prepare();let lostReply:Request|undefined;
  const published=chunk(prepared.id,0);
  h.handler(request=>{
    if(request.command.type!=='read_structure_chunk')return;
    if(request.command.sequence===0&&!lostReply){lostReply=request;return;}
    h.reply(request,request.command.sequence===0?published:chunk(prepared.id,1));
  });
  assert.equal((await h.api(`${h.base}/${prepared.id}/start`,{})).status,202);
  const paused=await until(()=>h.get(prepared.id),view=>view.status==='paused');
  assert.equal(paused.error?.code,'PLUGIN_TIMEOUT');assert.equal(paused.chunkCount,0);
  assert.equal(h.seen.filter(request=>request.command.type==='read_structure_chunk').length,1);
  await until(async()=>h.cancels.includes(lostReply!.requestId),value=>value);
  assert.equal((await h.api(`${h.base}/${prepared.id}/resume`,{})).status,202);
  const complete=await until(()=>h.get(prepared.id),view=>view.status==='complete');
  assert.equal(complete.nodeCount,2);
  assert.deepEqual(h.seen.filter(request=>request.command.type==='read_structure_chunk').map(request=>
    request.command.type==='read_structure_chunk'&&request.command.sequence),[0,0,1]);
  await h.unchanged();
});
