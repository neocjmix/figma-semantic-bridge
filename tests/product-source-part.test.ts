import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';
import { BridgeApi } from '../src/mcp/api-client.js';
import { startServer } from '../src/server/index.js';
import { StructureReader } from '../src/figma/structure-reader.js';
import { SelectiveReader } from '../src/figma/selective-reader.js';
import { executePluginCommand, PluginCommandError, type CaptureHost, type FigmaReadableNode } from '../src/figma/capture.js';
import { CollectionViewSchema, type CollectionView } from '../src/shared/structure-collection.js';
import { SettingsViewSchema } from '../src/shared/import-settings.js';
import type { PluginCommand } from '../src/shared/contracts.js';
import { authenticatePluginSocket } from './bridge-auth-helper.js';
import { syntheticPng } from './source-import-fixture.js';

async function until<T>(read:()=>Promise<T>,accept:(value:T)=>boolean):Promise<T>{
  const end=Date.now()+8000;
  while(Date.now()<end){const value=await read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,5));}
  assert.fail('Synthetic source-part operation did not settle.');
}
async function fixture(t:test.TestContext){
  const dataDir=await mkdtemp(join(tmpdir(),'fsb-source-part-'));
  let server=await startServer({port:0,dataDir,aiConfig:null,requestTimeoutMs:1000});
  const token=server.token,project=await server.store.create('Synthetic focused source workspace');
  const page:CaptureHost['currentPage']={id:'page',name:'Synthetic page',type:'PAGE',parent:null,selection:[]};
  Object.defineProperty(page,'children',{get(){throw new Error('No page preload');}});
  const byId=new Map<string,FigmaReadableNode>(),children=new Map<string,FigmaReadableNode[]>();
  const counts={rootChildren:0,targetChildren:0,unrelatedChildren:0,targetText:0,unrelatedText:0};
  function container(id:string,parent:FigmaReadableNode){
    const node:FigmaReadableNode={id,name:`Synthetic ${id}`,type:'FRAME',parent,visible:true,opacity:1,
      absoluteBoundingBox:{x:0,y:0,width:100,height:80},absoluteTransform:[[1,0,0],[0,1,0]],
      exportAsync:async settings=>syntheticPng(Math.round(100*settings.constraint.value),Math.round(80*settings.constraint.value))};
    const nested:FigmaReadableNode[]=[];children.set(id,nested);byId.set(id,node);children.get(parent.id)?.push(node);
    Object.defineProperty(node,'children',{get(){if(id==='root')counts.rootChildren++;else if(id==='target')counts.targetChildren++;else counts.unrelatedChildren++;return nested;}});
    return node;
  }
  const root=container('root',page),target=container('target',root),unrelated=container('unrelated',root),outside=container('outside',page);
  for(const [parent,count] of [[target,6],[unrelated,40]] as const)for(let index=0;index<count;index++){
    const node:FigmaReadableNode={id:`${parent.id}-text-${index}`,name:'Synthetic exact text',type:'TEXT',parent,visible:true,opacity:1,
      absoluteBoundingBox:{x:index,y:index,width:3,height:4}};
    Object.defineProperty(node,'characters',{get(){if(parent===target)counts.targetText++;else counts.unrelatedText++;return ` Exact ${parent.id} ${index} 한글 👩‍💻\r\n`;}});
    children.get(parent.id)!.push(node);byId.set(node.id,node);
  }
  const selected={...page,selection:[root]};
  const host:CaptureHost={fileKey:'synthetic-part-file',currentPage:selected,skipInvisibleInstanceChildren:true,
    getNodeByIdAsync:async id=>byId.get(id)??null,setCurrentPageAsync:async()=>{throw new Error('No page navigation');},
    selectNodes:()=>{throw new Error('No source selection write');},scrollAndZoomIntoView:()=>{throw new Error('No viewport write');}};
  let reader:StructureReader,selective:SelectiveReader,socket:WebSocket,sessionId='';
  const commands:PluginCommand[]=[];
  async function connect(){
    reader=new StructureReader(host);selective=new SelectiveReader(host);
    socket=new WebSocket(server.url.replace('http:','ws:')+'/bridge',{origin:'null'});await once(socket,'open');
    sessionId=(await authenticatePluginSocket(socket,token,'synthetic-source-part')).sessionId;
    const current=socket;
    current.on('message',async bytes=>{
      const message=JSON.parse(String(bytes)) as {type:string;requestId:string;command:PluginCommand};
      if(message.type!=='request')return;commands.push(message.command);
      try{
        const command=message.command,result=command.type==='read_structure_chunk'?await reader.readChunkWithReplay(command):
          command.type==='read_source_nodes'?await selective.readNodes(command):
          command.type==='release_structure_cursor'?reader.release(command.collectionId):await executePluginCommand(host,command);
        if(current.readyState===WebSocket.OPEN)current.send(JSON.stringify({type:'response',requestId:message.requestId,ok:true,result}));
      }catch(error){if(current.readyState===WebSocket.OPEN)current.send(JSON.stringify({type:'response',requestId:message.requestId,ok:false,
        error:{code:error instanceof PluginCommandError?error.code:'SYNTHETIC_FAILURE',message:error instanceof Error?error.message:'Synthetic failure'}}));}
    });
  }
  await connect();
  t.after(async()=>{socket.terminate();reader.clear();selective.clear();await server.close();await rm(dataDir,{recursive:true,force:true});});
  const api=(path:string,body?:unknown)=>fetch(server.url+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,
    ...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const base=`/api/projects/${project.id}/collections`;
  const get=async(id:string)=>CollectionViewSchema.parse(await(await api(`${base}/${id}`)).json());
  const limit=async(maxNodes:number)=>{const saved=SettingsViewSchema.parse(await(await api('/api/import-settings')).json());
    assert.equal((await api('/api/import-settings',{expectedRevision:saved.revision,settings:{...saved.settings,maxNodes}})).status,200);};
  const partial=async()=>{await limit(3);const response=await api(base,{expectedRevision:project.revision,expectedSessionId:sessionId,withOverview:true});
    assert.equal(response.status,201);const task=CollectionViewSchema.parse(await response.json());await api(`${base}/${task.id}/start`,{});
    return until(()=>get(task.id),value=>value.status==='paused');};
  const part=(id:string,confirmRevalidation=true,nodeId='target')=>api(`${base}/${id}/part`,{nodeId,expectedRevision:project.revision,expectedSessionId:sessionId,confirmRevalidation});
  const resume=(id:string)=>api(`${base}/${id}/continue`,{expectedRevision:project.revision,expectedSessionId:sessionId,confirmRevalidation:true});
  return {dataDir,project,base,api,get,limit,partial,part,resume,commands,counts,root,target,outside,children,host,token,get url(){return server.url;},
    resetCounts(){for(const key of Object.keys(counts) as (keyof typeof counts)[])counts[key]=0;},
    async restart(){socket.terminate();reader.clear();selective.clear();await server.close();
      server=await startServer({port:0,dataDir,token,aiConfig:null,requestTimeoutMs:1000});await connect();},
    moveOutside(){children.get('root')!.splice(children.get('root')!.indexOf(target),1);target.parent=outside;children.get('outside')!.push(target);},
    async unchangedProject(){assert.deepEqual(await server.store.get(project.id),project);},
  };
}

test('targeted part requires consent before losing the broader cursor and reads no unrelated subtree or new image',async t=>{
  const f=await fixture(t),original=await f.partial();
  const chunkPath=join(f.dataDir,'structure-collections',original.id,'0.json'),originalBytes=await readFile(chunkPath);
  const before=f.commands.length,plan=await(await f.api(`${f.base}/${original.id}/part-plan`,{nodeId:'target'})).json();
  assert.equal(plan.requiresConfirmation,true);assert.equal(plan.releasesPausedTaskId,original.id);assert.equal(f.commands.length,before);
  const refusal=await f.part(original.id,false);assert.equal(refusal.status,409);assert.equal((await refusal.json()).error.code,'RECOVERY_CONFIRMATION_REQUIRED');
  assert.equal(f.commands.length,before);assert.equal((await f.get(original.id)).status,'paused');
  await f.limit(100);f.resetCounts();f.host.currentPage.selection=[f.outside];
  const response=await f.part(original.id);assert.equal(response.status,202);
  const child=CollectionViewSchema.parse(await response.json());const complete=await until(()=>f.get(child.id),value=>value.status==='complete');
  assert.equal(complete.nodeCount,7);assert.equal(complete.source.nodeId,'target');assert.equal(complete.source.scopeId,'root');
  assert.deepEqual(complete.partOf,{collectionId:original.id,contextCollectionId:original.id,contextRootId:'root',contextBounds:original.source.bounds});
  assert.equal(complete.overviewAcquisitionId,original.overviewAcquisitionId);
  assert.equal((await f.get(original.id)).status,'interrupted');assert.equal((await f.get(original.id)).nodeCount,3);
  assert.deepEqual(await readFile(chunkPath),originalBytes);
  assert.deepEqual(f.counts,{rootChildren:0,targetChildren:1,unrelatedChildren:0,targetText:6,unrelatedText:0});
  assert.equal(f.commands.filter(command=>command.type==='get_selection').length,1);
  assert.equal(f.commands.filter(command=>command.type==='preview_capture').length,1);
  assert.equal((await f.api(`${f.base}/${original.id}/remove`,{})).status,409);
  assert.equal((await(await f.api(`${f.base}/${original.id}/continue-plan`)).json()).kind,'revalidate');
  await f.unchangedProject();
});

test('targeted part blocks unknown, already closed and moved-outside nodes without dropping the paused cursor',async t=>{
  const f=await fixture(t),original=await f.partial(),before=f.commands.length;
  assert.equal((await f.api(`${f.base}/${original.id}/part-plan`,{nodeId:'unknown'})).status,404);
  for(const nodeId of ['target-text-0','root'])assert.equal((await f.api(`${f.base}/${original.id}/part-plan`,{nodeId})).status,409);
  assert.equal(f.commands.length,before);f.moveOutside();
  const refusal=await f.part(original.id);assert.equal(refusal.status,502);const rejected=await refusal.json();
  assert.equal(rejected.error.code,'PLUGIN_ERROR');assert.match(rejected.error.message,/outside the pinned source scope/);
  assert.equal(f.commands.filter(command=>command.type==='release_structure_cursor').length,0);
  assert.equal((await f.get(original.id)).status,'paused');await f.unchangedProject();
});

test('focused part survives restart with its original enclosing-scope guard and historical context',async t=>{
  const f=await fixture(t),original=await f.partial();
  const created=CollectionViewSchema.parse(await(await f.part(original.id)).json());
  const child=await until(()=>f.get(created.id),value=>value.status==='paused');assert.equal(child.nodeCount,3);
  await f.restart();await f.limit(100);f.resetCounts();
  const response=await f.resume(child.id);assert.equal(response.status,202);
  const next=CollectionViewSchema.parse(await response.json()),complete=await until(()=>f.get(next.id),value=>value.status==='complete');
  assert.notEqual(complete.id,child.id);assert.equal(complete.source.scopeId,'root');assert.equal(complete.source.parentId,'root');
  assert.deepEqual(complete.partOf,child.partOf);assert.equal(complete.overviewAcquisitionId,original.overviewAcquisitionId);
  assert.equal(complete.nodeCount,7);assert.equal((await f.get(original.id)).nodeCount,3);assert.equal((await f.get(child.id)).status,'interrupted');
  assert.equal(f.counts.rootChildren,0);assert.equal(f.counts.unrelatedChildren,0);assert.equal(f.counts.unrelatedText,0);
  assert.equal(f.commands.filter(command=>command.type==='preview_capture').length,1);await f.unchangedProject();
});

test('focused part cannot escape its enclosing scope through reconnect continuation',async t=>{
  const f=await fixture(t),original=await f.partial();
  const created=CollectionViewSchema.parse(await(await f.part(original.id)).json());await until(()=>f.get(created.id),value=>value.status==='paused');
  await f.restart();f.moveOutside();const before=f.commands.filter(command=>command.type==='read_structure_chunk').length;
  const refusal=await f.resume(created.id);assert.equal(refusal.status,502);const rejected=await refusal.json();
  assert.equal(rejected.error.code,'PLUGIN_ERROR');assert.match(rejected.error.message,/outside the pinned source scope/);
  assert.equal(f.commands.filter(command=>command.type==='read_structure_chunk').length,before);
  assert.equal((await f.get(created.id)).status,'interrupted');await f.unchangedProject();
});

test('the single MCP acquisition tool plans a saved part and requires explicit cursor-loss confirmation',async t=>{
  const f=await fixture(t),original=await f.partial();await f.limit(100);
  const mcp=createMcpServer(new BridgeApi(f.url,f.token,{allowInsecureHttp:true})),client=new Client({name:'synthetic-part-mcp',version:'1'});
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();await mcp.connect(serverTransport);await client.connect(clientTransport);
  t.after(async()=>{await client.close();await mcp.close();});
  const decode=(result:unknown)=>JSON.parse((result as {content:{text:string}[]}).content[0]!.text);
  const before=f.commands.length;
  const plan=decode(await client.callTool({name:'acquire_source_task',arguments:{projectId:f.project.id,taskId:original.id,nodeId:'target',action:'part-plan'}}));
  assert.equal(plan.requiresConfirmation,true);assert.equal(f.commands.length,before);
  const status=await(await f.api('/api/plugin/status')).json();
  const args={projectId:f.project.id,taskId:original.id,nodeId:'target',action:'part',expectedRevision:f.project.revision,expectedSessionId:status.sessionId};
  const refused=await client.callTool({name:'acquire_source_task',arguments:args});assert.equal(refused.isError,true);
  assert.match(JSON.stringify(refused),/RECOVERY_CONFIRMATION_REQUIRED/);assert.equal(f.commands.length,before);
  const result=await client.callTool({name:'acquire_source_task',arguments:{...args,confirmRevalidation:true}});
  assert.equal(result.isError,undefined);const child=CollectionViewSchema.parse(decode(result));
  assert.equal((await until(()=>f.get(child.id),value=>value.status==='complete')).nodeCount,7);
  assert.equal((await client.listTools()).tools.length,13);await f.unchangedProject();
});
