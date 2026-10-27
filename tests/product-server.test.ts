import { authenticatePluginSocket } from './bridge-auth-helper.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer, request as httpRequest, ServerResponse } from 'node:http';
import WebSocket from 'ws';
import { startServer, type ServerOptions } from '../src/server/index.js';
import { createDemoProject } from '../src/demo/project.js';
import type { Annotation, Project, Snapshot } from '../src/shared/contracts.js';
import { validatePreview } from '../src/server/preview.js';

const token = 'test-pairing-token-'.repeat(4);
async function harness(t: test.TestContext,options:Partial<ServerOptions>={}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'fsb-server-test-'));
  const server = await startServer({port:0,token,dataDir,aiConfig:null,...options});
  t.after(async()=>{ await server.close(); await rm(dataDir,{recursive:true,force:true}); });
  const api = (path:string, method='GET', body?:unknown, headers:Record<string,string>={}) => fetch(server.url+path,{
    method,headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  return {...server,api,dataDir};
}
async function connect(url:string, suppliedToken=token) {
  const ws = new WebSocket(url.replace('http:','ws:')+'/bridge',{origin:'null'});
  await once(ws,'open');
  await authenticatePluginSocket(ws,suppliedToken,'test-plugin');
  return ws;
}

test('HTTP requires token, rejects foreign origin and rebinding host, validates JSON input',async t=>{
  const {url,api}=await harness(t);
  assert.equal((await fetch(url+'/api/health')).status,401);
  assert.equal((await api('/api/health')).status,200);
  assert.equal((await api('/api/health','GET',undefined,{Origin:'https://evil.example'})).status,403);
  const rebound=await new Promise<number|undefined>((resolveStatus,reject)=>{const request=httpRequest(url+'/api/health',{headers:{Host:'evil.example',Authorization:`Bearer ${token}`}},response=>{response.resume();resolveStatus(response.statusCode);});request.on('error',reject);request.end();});
  assert.equal(rebound,403);
  assert.equal((await api('/api/projects','POST',{name:'One',unknown:true})).status,400);
  assert.equal((await api('/api/projects/../../etc/passwd')).status,404);
  assert.equal((await api('/api/projects','POST',{name:'One'},{'Content-Type':'text/plain'})).status,415);
});

test('atomic projects survive reopening; optimistic revisions and bounded history are enforced',async t=>{
  const {api,store,dataDir}=await harness(t);
  const created=await (await api('/api/projects','POST',{name:'Original'})).json() as {id:string;revision:number};
  assert.equal(created.revision,0);
  const mutate={expectedRevision:0,operation:{type:'rename_project',name:'Renamed'}};
  const outcomes=await Promise.all([api(`/api/projects/${created.id}/mutate`,'POST',mutate),api(`/api/projects/${created.id}/mutate`,'POST',mutate)]);
  assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
  const undo=await (await api(`/api/projects/${created.id}/undo`,'POST',{expectedRevision:1})).json() as {name:string;revision:number};
  assert.equal(undo.name,'Original');assert.equal(undo.revision,2);
  const redo=await (await api(`/api/projects/${created.id}/redo`,'POST',{expectedRevision:2})).json() as {name:string;revision:number};
  assert.equal(redo.name,'Renamed');assert.equal(redo.revision,3);
  assert.equal((await store.get(created.id)).revision,3);
  const file=join(dataDir,'projects',created.id+'.json');
  assert.equal((await stat(file)).mode&0o777,0o600);
  const saved=JSON.parse(await readFile(file,'utf8')) as {project:{revision:number}};
  assert.equal(saved.project.revision,3);
  const second=await startServer({port:0,token,dataDir});
  try {assert.equal((await second.store.get(created.id)).name,'Renamed');} finally {await second.close();}
});

test('real WebSocket broker pairs, responds, times out, cancels, disconnects and reconnects',async t=>{
  const {url,broker,api}=await harness(t);
  await assert.rejects(broker.request({type:'get_selection'}),/disconnected/i);
  let ws=await connect(url);t.after(()=>ws.terminate());
  assert.equal(broker.status.connected,true);
  ws.on('message',raw=>{const msg=JSON.parse(raw.toString());if(msg.type==='request'&&msg.command.type==='get_selection') ws.send(JSON.stringify({type:'response',requestId:msg.requestId,ok:true,result:{fileKey:null,pageId:'0:1',nodes:[]}}));});
  const selected=await (await api('/api/plugin/selection','POST',{})).json() as {pageId:string};
  assert.equal(selected.pageId,'0:1');
  await assert.rejects(broker.request({type:'highlight_nodes',fileKey:'fixture-key',pageId:'0:1',nodeIds:['1:2']},{timeoutMs:20}),/timed out/i);
  const abort=new AbortController();
  const pending=broker.request({type:'highlight_nodes',fileKey:'fixture-key',pageId:'0:1',nodeIds:['1:2']},{signal:abort.signal});
  abort.abort();await assert.rejects(pending,/cancel/i);
  const disconnected=broker.request({type:'highlight_nodes',fileKey:'fixture-key',pageId:'0:1',nodeIds:['1:2']});
  ws.close();await assert.rejects(disconnected,/disconnect/i);
  ws=await connect(url);assert.equal(broker.status.connected,true);
  const replaced=broker.request({type:'highlight_nodes',fileKey:'fixture-key',pageId:'0:1',nodeIds:['1:2']});
  const rejected=assert.rejects(replaced,/replaced/i);
  const replacedClose=once(ws,'close');
  const newer=await connect(url);t.after(()=>newer.terminate());
  await rejected;
  assert.equal((await replacedClose)[0],4001);
  assert.equal(broker.status.pendingRequests,0);
});

test('broker accepts the configurable structure and image waits without exceeding their supported ceiling',async t=>{
  const {url,broker}=await harness(t),ws=await connect(url);t.after(()=>ws.terminate());
  ws.on('message',raw=>{const msg=JSON.parse(raw.toString());if(msg.type==='request')ws.send(JSON.stringify({type:'response',requestId:msg.requestId,ok:true,
    result:{fileKey:null,pageId:'synthetic-page',nodes:[]}}));});
  for(const timeoutMs of [120000,305000])assert.deepEqual(await broker.request({type:'get_selection'},{timeoutMs}),{fileKey:null,pageId:'synthetic-page',nodes:[]});
  await assert.rejects(broker.request({type:'get_selection'},{timeoutMs:305001}),{code:'INVALID_TIMEOUT'});
  assert.equal(broker.status.pendingRequests,0);
});

for(const scenario of [
  {name:'selection',body:{},command:'get_selection',
    lateResult:{fileKey:'fixture-key',pageId:'old-page',nodes:[]},result:{fileKey:'fixture-key',pageId:'current-page',nodes:[]}},
  {name:'highlight',body:{fileKey:'fixture-key',pageId:'fixture-page',nodeIds:['requested-node']},command:'highlight_nodes',
    lateResult:{highlightedNodeIds:['late-node']},result:{highlightedNodeIds:['requested-node']}},
]) {
  test(`closing a ${scenario.name} HTTP request cancels plugin work and ignores late responses`,{timeout:5000},async t=>{
    const {url,api,broker}=await harness(t);
    const ws=await connect(url);t.after(()=>ws.terminate());
    const abort=new AbortController();t.after(()=>abort.abort());
    const requested=once(ws,'message');
    const pending=fetch(`${url}/api/plugin/${scenario.name}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(scenario.body),signal:abort.signal});
    const rejection=assert.rejects(pending,/abort/i);
    const first=JSON.parse((await requested)[0].toString()) as {type:string;requestId:string;command:{type:string}};
    assert.equal(first.type,'request');assert.equal(first.command.type,scenario.command);
    assert.equal(broker.status.pendingRequests,1);
    const cancelled=once(ws,'message',{signal:AbortSignal.timeout(1000)});
    abort.abort();await rejection;
    assert.deepEqual(JSON.parse((await cancelled)[0].toString()),{type:'cancel',requestId:first.requestId});
    assert.equal(broker.status.pendingRequests,0);assert.equal(broker.status.connected,true);

    const nextRequested=once(ws,'message');
    const next=api(`/api/plugin/${scenario.name}`,'POST',scenario.body);
    const second=JSON.parse((await nextRequested)[0].toString()) as {requestId:string};
    assert.notEqual(second.requestId,first.requestId);
    // A pong is an ordered barrier: the broker has consumed the stale frame
    // before we assert that it did not resolve the newer request.
    const pong=once(ws,'message');
    ws.send(JSON.stringify({type:'response',requestId:first.requestId,ok:true,result:scenario.lateResult}));
    ws.send(JSON.stringify({type:'ping'}));
    assert.deepEqual(JSON.parse((await pong)[0].toString()),{type:'pong'});
    assert.equal(broker.status.pendingRequests,1);
    ws.send(JSON.stringify({type:'response',requestId:second.requestId,ok:true,result:scenario.result}));
    const response=await next;assert.equal(response.status,200);
    assert.deepEqual(await response.json(),scenario.result);
    assert.equal(broker.status.pendingRequests,0);
  });
}

test('WebSocket rejects missing origin and invalid authentication; malformed responses fail pending work',async t=>{
  const {url,broker}=await harness(t);
  const badOrigin=new WebSocket(url.replace('http:','ws:')+'/bridge');
  const error=await once(badOrigin,'error');assert.match(String(error[0]),/403/);
  const wrong=new WebSocket(url.replace('http:','ws:')+'/bridge',{origin:'null'});
  await once(wrong,'open');const closed=once(wrong,'close');
  wrong.send(JSON.stringify({type:'hello',token:'wrong',clientId:'x'}));await closed;
  assert.equal(broker.status.connected,false);
  const ws=await connect(url);t.after(()=>ws.terminate());
  ws.on('message',raw=>{const msg=JSON.parse(raw.toString());if(msg.type==='request') ws.send(JSON.stringify({type:'response',requestId:msg.requestId,ok:true,result:{bad:true}}));});
  await assert.rejects(broker.request({type:'get_selection'}),/invalid/i);
});

test('capture selection persists only validated snapshots and bounded source lookup excludes previews',async t=>{
  const {url,api}=await harness(t);
  const project=await (await api('/api/projects','POST',{name:'Capture test'})).json() as Project;
  const snapshot=createDemoProject().snapshots[0]!;
  const ws=await connect(url);t.after(()=>ws.terminate());
  let responseSnapshot:Snapshot=snapshot;
  ws.on('message',raw=>{const msg=JSON.parse(raw.toString());if(msg.type==='request')ws.send(JSON.stringify({type:'response',requestId:msg.requestId,ok:true,result:responseSnapshot}));});
  const captured=await (await api(`/api/projects/${project.id}/capture`,'POST',{expectedRevision:0,limits:{}})).json() as Project;
  assert.equal(captured.snapshots.length,1);assert.equal(captured.revision,1);
  const nodesResponse=await api(`/api/projects/${project.id}/nodes`,'POST',{snapshotId:snapshot.id,nodeIds:[snapshot.source.rootId]});
  const nodes=await nodesResponse.json() as {nodes:unknown[];source:unknown;preview?:unknown};
  assert.equal(nodes.nodes.length,1);assert.equal(nodes.preview,undefined);
  assert.equal((await api(`/api/projects/${project.id}/nodes`,'POST',{snapshotId:snapshot.id,nodeIds:Array(101).fill('x')})).status,400);
  responseSnapshot={...snapshot,id:'invalid-capture',preview:{mimeType:'image/png',base64:Buffer.from('<svg onload="alert(1)"/>').toString('base64'),width:1,height:1}};
  const invalid=await api(`/api/projects/${project.id}/capture`,'POST',{expectedRevision:1,limits:{}});
  assert.equal(invalid.status,502);
  assert.equal((await (await api(`/api/projects/${project.id}`)).json() as Project).revision,1);
});

test('capture cancelled during a project read never dispatches or persists source work',{timeout:5000},async t=>{
  const {url,store,broker}=await harness(t);
  const project=await store.create('Cancelled before dispatch');
  const path=`/api/projects/${project.id}/capture`;
  const ws=await connect(url);t.after(()=>ws.terminate());
  ws.on('message',raw=>{const message=JSON.parse(raw.toString());if(message.type==='request')ws.send(JSON.stringify({type:'response',requestId:message.requestId,ok:true,result:createDemoProject().snapshots[0]}));});
  const dispatch=t.mock.method(broker,'request');
  const read=store.get.bind(store);
  let entered!:()=>void,release!:()=>void,closed!:()=>void;
  const reading=new Promise<void>(resolve=>{entered=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const disconnected=new Promise<void>(resolve=>{closed=resolve;});
  t.after(()=>release());
  t.mock.method(store,'get',async(id:string)=>{assert.equal(id,project.id);entered();await gate;return project;},{times:1});
  const emit=ServerResponse.prototype.emit;
  t.mock.method(ServerResponse.prototype,'emit',function(this:ServerResponse,event:string|symbol,...args:unknown[]){
    const result=emit.call(this,event,...args);
    if(event==='close'&&this.req.url===path)closed();
    return result;
  });
  const abort=new AbortController();t.after(()=>abort.abort());
  const pending=fetch(url+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:project.revision,limits:{}}),signal:abort.signal});
  const rejection=assert.rejects(pending,/abort/i);
  await reading;
  abort.abort();await rejection;await disconnected;
  release();
  // The gated read resolves in microtasks before the next event-loop turn.
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(dispatch.mock.callCount(),0);
  assert.equal(broker.status.pendingRequests,0);
  assert.deepEqual(await read(project.id),project);
});

test('proposal endpoint cannot overwrite approved human data and source text remains verbatim',async t=>{
  const {api}=await harness(t);
  let project=await (await api('/api/demo','POST',{})).json() as Project;
  const snapshot=project.snapshots[0]!;
  const annotation={id:'human-region',snapshotId:snapshot.id,name:'Reviewed screen',role:'component',bbox:snapshot.bounds,parentId:null,sourceRefs:[{snapshotId:snapshot.id,nodeId:snapshot.source.rootId,matchType:'exact'}],origin:'human',reviewStatus:'proposed',revision:0};
  project=await (await api(`/api/projects/${project.id}/mutate`,'POST',{expectedRevision:project.revision,operation:{type:'upsert_annotation',annotation}})).json() as Project;
  project=await (await api(`/api/projects/${project.id}/mutate`,'POST',{expectedRevision:project.revision,operation:{type:'review_annotation',id:annotation.id,status:'approved'}})).json() as Project;
  const rejected=await api(`/api/projects/${project.id}/proposals`,'POST',{expectedRevision:project.revision,draft:{annotations:[{...annotation,name:'Overwrite',origin:'ai'}],specifications:[]}});
  assert.equal(rejected.status,400);
  const preserved=await (await api(`/api/projects/${project.id}`)).json() as Project;
  assert.equal(preserved.annotations.find(a=>a.id===annotation.id)?.name,'Reviewed screen');
  assert.equal(preserved.annotations.find(a=>a.id===annotation.id)?.reviewStatus,'approved');
  const exported=await (await api(`/api/projects/${project.id}/export`)).json();
  assert.equal(JSON.stringify(exported).includes('image/png'),false);
  const forged=await api(`/api/projects/${project.id}/proposals`,'POST',{expectedRevision:project.revision,draft:{annotations:[],specifications:[]},actor:'human'});
  assert.equal(forged.status,400);
  const text=snapshot.nodes.find(n=>n.type==='TEXT'&&n.text)!;
  const specification={id:'spec',text:text.text,sourceRefs:[{snapshotId:snapshot.id,nodeId:text.id,matchType:'exact'}],relations:[],origin:'human',reviewStatus:'proposed',revision:0};
  const exact=await api(`/api/projects/${project.id}/mutate`,'POST',{expectedRevision:project.revision,operation:{type:'upsert_specification',specification}});
  assert.equal(exact.status,200);project=await exact.json() as Project;
  const altered=await api(`/api/projects/${project.id}/mutate`,'POST',{expectedRevision:project.revision,operation:{type:'upsert_specification',specification:{...specification,text:'Different from original'}}});
  assert.equal(altered.status,400);
  assert.equal((await (await api(`/api/projects/${project.id}`)).json() as Project).specifications[0]?.text,text.text);
});

test('static app is constrained to its build directory and never exposes source or symlink targets',async t=>{
  const root=await mkdtemp(join(tmpdir(),'fsb-static-test-'));
  const webDir=join(root,'web');await mkdir(webDir);await writeFile(join(webDir,'index.html'),'<!doctype html><title>Local app</title>');
  await writeFile(join(root,'outside.js'),'private-source');await symlink(join(root,'outside.js'),join(webDir,'leak.js'));
  const server=await startServer({port:0,token,dataDir:join(root,'data'),webDir});
  t.after(async()=>{await server.close();await rm(root,{recursive:true,force:true});});
  const index=await fetch(server.url+'/');assert.equal(index.status,200);assert.match(index.headers.get('content-security-policy')??'',/frame-ancestors 'none'/);
  assert.equal((await fetch(server.url+'/favicon.ico')).status,204);
  const missing=await fetch(server.url+'/assets/missing.js');assert.equal(missing.status,404);
  assert.equal((await missing.json() as {error:{code:string}}).error.code,'NOT_FOUND');
  assert.equal((await fetch(server.url+'/leak.js')).status,404);
  assert.equal((await fetch(server.url+'/src/server/index.ts')).status,404);
  assert.equal((await fetch(server.url+'/api/projects',{method:'POST'})).status,401);
});

test('multi-megabyte PNG validation remains bounded without regular-expression stack overflow',()=>{
  const snapshot=createDemoProject().snapshots[0]!;
  const png=Buffer.alloc(8_000_000);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  png.writeUInt32BE(13,8);png.write('IHDR',12,'ascii');png.writeUInt32BE(1,16);png.writeUInt32BE(1,20);
  const large={...snapshot,preview:{mimeType:'image/png' as const,base64:png.toString('base64'),width:1,height:1}};
  assert.doesNotThrow(()=>validatePreview(large));
  assert.throws(()=>validatePreview({...large,preview:{...large.preview,base64:large.preview.base64.slice(0,-1)+'!'}}),/canonical/);
});

test('approved pages retain corpus totals beyond export text budgets and exclude unreviewed records',async t=>{
  const {api,store}=await harness(t);
  const demo=createDemoProject(),snapshot=demo.snapshots[0]!,sourceText=snapshot.nodes.find(n=>n.text)!;
  sourceText.text='x'.repeat(50000);
  const annotation:Annotation={id:'approved/component',snapshotId:snapshot.id,name:'Reviewed',role:'component',bbox:snapshot.bounds,parentId:null,sourceRefs:[{snapshotId:snapshot.id,nodeId:snapshot.source.rootId,matchType:'exact'}],origin:'human',reviewStatus:'approved',revision:1};
  demo.annotations=[annotation,{...annotation,id:'draft-component',reviewStatus:'proposed'}];
  demo.specifications=Array.from({length:21},(_,index)=>({id:`spec-${String(index).padStart(2,'0')}`,text:sourceText.text!,sourceRefs:[{snapshotId:snapshot.id,nodeId:sourceText.id,matchType:'exact'}],relations:[{targetAnnotationId:annotation.id,relationType:'behavior',reviewStatus:'approved'}],origin:'human',reviewStatus:'approved',revision:1}));
  const project=await store.importProject(demo);
  const components=await (await api(`/api/projects/${project.id}/components?limit=1`)).json() as {components:Annotation[];total:number;nextOffset:number|null};
  assert.equal(components.total,1);assert.equal(components.components[0]?.id,annotation.id);assert.equal(components.nextOffset,null);
  const pageResponse=await api(`/api/projects/${project.id}/specifications?limit=50&annotationId=${annotation.id}`);
  const pageText=await pageResponse.text();assert.ok(Buffer.byteLength(pageText)<128000);
  const page=JSON.parse(pageText) as {specifications:unknown[];total:number;nextOffset:number};
  assert.equal(page.total,21);assert.equal(page.specifications.length,2);assert.equal(page.nextOffset,2);
  const tail=await (await api(`/api/projects/${project.id}/specifications?offset=20&limit=1`)).json() as {specifications:Array<{id:string}>;total:number;nextOffset:number|null};
  assert.equal(tail.total,21);assert.equal(tail.specifications[0]?.id,'spec-20');assert.equal(tail.nextOffset,null);
  const detail=await (await api(`/api/projects/${project.id}/components/${encodeURIComponent(annotation.id)}`)).json() as {component:Annotation;specificationTotal:number;nextSpecificationOffset:number};
  assert.equal(detail.component.id,annotation.id);assert.equal(detail.specificationTotal,21);assert.equal(detail.nextSpecificationOffset,2);
  assert.equal((await api(`/api/projects/${project.id}/components/draft-component`)).status,404);
  assert.equal((await api(`/api/projects/${project.id}/components?limit=51`)).status,400);
});

test('capture and proposal summaries never transfer the accumulated project previews',async t=>{
  const {api,url,store}=await harness(t);
  const project=await store.create('Summary capture'),snapshot=createDemoProject().snapshots[0]!;
  const ws=await connect(url);t.after(()=>ws.terminate());
  ws.on('message',raw=>{const msg=JSON.parse(raw.toString());if(msg.type==='request')ws.send(JSON.stringify({type:'response',requestId:msg.requestId,ok:true,result:snapshot}));});
  const captured=await (await api(`/api/projects/${project.id}/capture?summary=1`,'POST',{expectedRevision:0,limits:{}})).json() as {projectId:string;revision:number;snapshot:{id:string}};
  assert.equal(captured.snapshot.id,snapshot.id);assert.equal(captured.revision,1);assert.equal(JSON.stringify(captured).includes('base64'),false);
  const annotation:Annotation={id:'ai-summary-region',snapshotId:snapshot.id,name:'Proposed',role:'component',bbox:snapshot.bounds,parentId:null,sourceRefs:[],origin:'ai',reviewStatus:'proposed',revision:0};
  const proposal=await (await api(`/api/projects/${project.id}/proposals?summary=1`,'POST',{expectedRevision:1,draft:{annotations:[annotation],specifications:[]},warnings:Array(100).fill('w'.repeat(2000))})).json() as {projectId:string;revision:number;proposal:{status:string;warningCount:number;warnings:string[]}};
  assert.equal(proposal.projectId,project.id);assert.equal(proposal.revision,2);assert.equal(proposal.proposal.status,'pending');assert.equal(proposal.proposal.warningCount,100);assert.equal(proposal.proposal.warnings.length,10);
  assert.ok(Buffer.byteLength(JSON.stringify(proposal))<128000);assert.equal(JSON.stringify(proposal).includes('base64'),false);
  assert.equal((await store.get(project.id)).proposals.length,1);
});

test('optional local AI stages proposals, rejects stale results and preserves the manual workflow',async t=>{
  let release:(()=>void)|undefined,received:(()=>void)|undefined;let hold=false;let requests=0;
  let proposed:Annotation;
  const provider=createServer(async(request,response)=>{
    for await(const _chunk of request) { /* Drain synthetic request; never retain design payloads. */ }
    requests++;received?.();
    if(hold)await new Promise<void>(resolve=>{release=resolve;});
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify({choices:[{message:{content:JSON.stringify({annotations:[proposed],specifications:[]})},finish_reason:'stop'}]}));
  });
  await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{release?.();provider.closeAllConnections();await new Promise<void>((resolve,reject)=>provider.close(error=>error?reject(error):resolve()));});
  const address=provider.address();assert.ok(address&&typeof address!=='string');
  const {api,store}=await harness(t,{aiConfig:{endpoint:`http://127.0.0.1:${address.port}/chat/completions`,model:'local-test',timeoutMs:2000}});
  const project=await store.importProject(createDemoProject()),snapshot=project.snapshots[0]!;
  proposed={id:'model-draft',snapshotId:snapshot.id,name:'Model suggestion',role:'component',bbox:snapshot.bounds,parentId:null,sourceRefs:[],origin:'ai',reviewStatus:'proposed',revision:0};
  const status=await (await api('/api/ai/status')).json() as {enabled:boolean;external:boolean};assert.equal(status.enabled,true);assert.equal(status.external,false);
  const generated=await api(`/api/projects/${project.id}/generate-draft`,'POST',{expectedRevision:0,snapshotIds:[snapshot.id]});assert.equal(generated.status,200);
  const draft=await generated.json() as Project;assert.equal(draft.revision,1);assert.equal(draft.annotations.length,0);assert.equal(draft.proposals[0]?.status,'pending');
  assert.equal((await api(`/api/projects/${project.id}/generate-draft`,'POST',{expectedRevision:0,snapshotIds:[snapshot.id]})).status,409);assert.equal(requests,1);
  hold=true;proposed={...proposed,id:'stale-draft'};
  const seen=new Promise<void>(resolve=>{received=resolve;});
  const pending=api(`/api/projects/${project.id}/generate-draft`,'POST',{expectedRevision:1,snapshotIds:[snapshot.id]});await seen;
  const renamed=await api(`/api/projects/${project.id}/mutate`,'POST',{expectedRevision:1,operation:{type:'rename_project',name:'Changed during model request'}});assert.equal(renamed.status,200);
  release!();assert.equal((await pending).status,409);
  assert.equal((await store.get(project.id)).proposals.length,1);assert.equal((await store.get(project.id)).name,'Changed during model request');
});

test('external AI requires per-request consent and bad optional configuration cannot block manual edits',async t=>{
  const {api,store}=await harness(t,{aiConfig:{endpoint:'https://example.invalid/chat/completions',model:'test',timeoutMs:100}});
  const project=await store.importProject(createDemoProject());
  const denied=await api(`/api/projects/${project.id}/generate-draft`,'POST',{expectedRevision:0,snapshotIds:[project.snapshots[0]!.id]});
  assert.equal(denied.status,403);assert.equal((await denied.json() as {error:{code:string}}).error.code,'AI_CONSENT_REQUIRED');
  assert.equal((await store.get(project.id)).revision,0);
  const broken=await harness(t,{aiConfig:{endpoint:'http://untrusted.example/inference',model:'test',timeoutMs:100}});
  const status=await (await broken.api('/api/ai/status')).json() as {enabled:boolean;configurationError:string};assert.equal(status.enabled,false);assert.match(status.configurationError,/HTTPS/);
  assert.equal((await broken.api('/api/projects','POST',{name:'Manual still works'})).status,201);
});

test('closing an AI HTTP request cancels its local provider and leaves the project unchanged',{timeout:5000},async t=>{
  let requested!:()=>void,cancelled!:()=>void;
  const received=new Promise<void>(resolve=>{requested=resolve;}),closed=new Promise<void>(resolve=>{cancelled=resolve;});
  const provider=createServer(async(request,response)=>{
    response.once('close',()=>cancelled());
    for await(const _chunk of request) { /* Drain generated test metadata. */ }
    requested();
    // Deliberately no completion. Client disconnection must cancel this request.
  });
  await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{provider.closeAllConnections();await new Promise<void>((resolve,reject)=>provider.close(error=>error?reject(error):resolve()));});
  const address=provider.address();assert.ok(address&&typeof address!=='string');
  const {url,store}=await harness(t,{aiConfig:{endpoint:`http://127.0.0.1:${address.port}/chat/completions`,model:'local-cancel-test',timeoutMs:4000}});
  const project=await store.importProject(createDemoProject()),abort=new AbortController();
  const pending=fetch(`${url}/api/projects/${project.id}/generate-draft`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:0,snapshotIds:[project.snapshots[0]!.id]}),signal:abort.signal});
  const rejection=assert.rejects(pending,/abort/i);
  await received;abort.abort();await rejection;await closed;
  const preserved=await store.get(project.id);assert.equal(preserved.revision,0);assert.equal(preserved.proposals.length,0);
});
