import test from 'node:test';
import {request as browserRequest} from '../web/api.js';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,readdir,rm,stat,symlink,writeFile } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { DiagnosticLog,diagnosticIssues,diagnosticRoute } from '../src/server/diagnostics.js';
import { DiagnosticClientEventSchema,diagnosticFrames } from '../src/shared/diagnostics.js';
import { DomainError } from '../src/core/project.js';
import { startServer } from '../src/server/index.js';
import { ServiceError } from '../src/server/errors.js';

test('local diagnostics preserve safe validation detail and stack locations, excluding data and paths',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fsb-log-'));try{
 const log=new DiagnosticLog(dir);await log.initialize();
 const error=new DomainError('INVALID_PROJECT','Annotation lies outside its captured image bounds.');
 error.stack='Error: PRIVATE-DESIGN-CONTENT\n    at validate (/Users/private-person/work/src/core/project.ts:90:2)\n    at other (/Users/private-person/work/secrets.ts:1:1)';
 log.error('http.error',error,{requestId:'4ee2f650-4537-42a2-985d-dee3236a72bd',operation:'split_annotation',body:'PRIVATE-DESIGN-CONTENT'});
 await log.flush();const text=await readFile(join(log.directory,'server.ndjson'),'utf8'),row=JSON.parse(text);
 assert.equal(row.reason,error.message);assert.deepEqual(row.frames,['src/core/project.ts:90:2']);assert.equal(row.operation,'split_annotation');
 assert.doesNotMatch(text,/PRIVATE-DESIGN|private-person|secrets/);assert.equal((await stat(log.directory)).mode&0o777,0o700);assert.equal((await stat(join(log.directory,'server.ndjson'))).mode&0o777,0o600);
 assert.deepEqual(diagnosticIssues([{path:['annotations',0,'PRIVATE-NAME','bbox','width'],code:'too_big',maximum:1,input:'PRIVATE'}]),[{path:['annotations',0,'field','bbox','width'],code:'too_big',maximum:1}]);
 assert.equal(diagnosticRoute('/api/projects/private-company?token=SECRET'),'/api/projects/_');
 const webkitError=new Error('secret');webkitError.stack='fn@https://127.0.0.1:4178/assets/index-A123.js:3:4';
 assert.deepEqual(diagnosticFrames(webkitError),['assets/index-A123.js:3:4']);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('diagnostic frames exclude complete multiline error messages and non-relative segments',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fsb-log-privacy-'));try{
 const log=new DiagnosticLog(dir);await log.initialize();
 const error=new ServiceError('PLUGIN_ERROR','PRIVATE-MESSAGE\n at native (/private/src/PRIVATE_SOURCE_SENTINEL.ts:12:3)');
 error.stack=`${error.name}: ${error.message}\n at genuine (/repo/src/server/broker.ts:20:4)\n at invalid (/repo/src/../../Users/PRIVATE_PATH_SENTINEL/file.js:1:2)`;
 assert.deepEqual(diagnosticFrames(error),['src/server/broker.ts:20:4']);
 assert.deepEqual(diagnosticFrames({name:error.name,message:error.message,stack:error.stack}),[]);
 for(const frame of ['src/../../Users/PRIVATE_PATH_SENTINEL/file.js:1:2','src/./file.ts:1:2','src//file.ts:1:2']){
  assert.equal(DiagnosticClientEventSchema.safeParse({event:'web.error',level:'error',frames:[frame]}).success,false);
 }
 log.error('plugin.error',error);await log.flush();const text=await readFile(join(log.directory,'server.ndjson'),'utf8');
 assert.doesNotMatch(text,/PRIVATE-MESSAGE|PRIVATE_SOURCE_SENTINEL|PRIVATE_PATH_SENTINEL/);
 assert.deepEqual(JSON.parse(text).frames,['src/server/broker.ts:20:4']);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('diagnostics rotate, reject symlink targets and tolerate unavailable storage',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fsb-log-'));try{
 const log=new DiagnosticLog(dir,{maxBytes:1000,files:3});await log.initialize();for(let i=0;i<30;i++)log.emit('runtime.ready','info',{count:i});await log.flush();
 assert.ok((await readdir(log.directory)).length<=3);for(const file of await readdir(log.directory))assert.ok((await stat(join(log.directory,file))).size<=1000);
 await rm(join(log.directory,'server.ndjson'));const target=join(dir,'private');await writeFile(target,'unchanged');await symlink(target,join(log.directory,'server.ndjson'));
 log.emit('runtime.ready');await log.flush();assert.equal(await readFile(target,'utf8'),'unchanged');
 const bad=new DiagnosticLog(join(dir,'missing','parent'));bad.emit('runtime.ready');await assert.doesNotReject(()=>bad.flush());
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('requests closed before a response are logged once as cancelled instead of successful',{timeout:5000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fsb-log-cancel-'));
 const log=new DiagnosticLog(dir);await log.initialize();
 let entered!:()=>void,closed!:()=>void;
 const whenEntered=new Promise<void>(resolve=>{entered=resolve;}),whenClosed=new Promise<void>(resolve=>{closed=resolve;});
 const server=createServer((request,response)=>{response.once('close',closed);void log.request(request,response,async()=>{entered();});});
 try{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const client=httpRequest({host:'127.0.0.1',port:address.port,path:'/api/projects/private-source'});client.on('error',()=>{});client.end();
  await whenEntered;client.destroy();await whenClosed;await log.flush();
  const rows=(await readFile(join(log.directory,'server.ndjson'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const completions=rows.filter(row=>row.event==='http.complete');assert.equal(completions.length,1);
  assert.equal(completions[0].status,499);assert.equal(completions[0].state,'cancelled');assert.equal(completions[0].level,'warn');
  assert.equal(completions[0].route,'/api/projects/_');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});

test('HTTP failures carry generated correlation IDs and strict authenticated browser diagnostics exclude secrets',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fsb-log-api-')),token='private-token-sentinel-'.repeat(3);const server=await startServer({port:0,dataDir:dir,token,aiConfig:null});try{
 const response=await fetch(server.url+'/api/projects',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:null})});
 assert.equal(response.status,400);const requestId=response.headers.get('X-FSB-Request-Id');assert.match(requestId!,/^[a-f0-9-]{36}$/);
 const send=(body:unknown,auth=true)=>fetch(server.url+'/api/diagnostics/events',{method:'POST',headers:{...(auth?{Authorization:`Bearer ${token}`}:{}) ,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await send({event:'web.console',level:'error',argumentCount:1},false)).status,401);
 assert.equal((await send({event:'web.console',level:'error',argumentCount:1,message:'PRIVATE-DESIGN-SENTINEL'})).status,400);
 assert.equal((await send({event:'web.error',level:'error',frames:['src/../../PRIVATE_PATH_SENTINEL/file.js:1:2']})).status,400);
 assert.equal((await send({event:'web.error',level:'error',errorType:'TypeError',frames:['assets/index-abcd.js:23:2'],requestId})).status,202);
 await server.diagnostics.flush();const text=await readFile(join(server.diagnostics.directory,'server.ndjson'),'utf8'),rows=text.trim().split('\n').map(line=>JSON.parse(line));
 const failure=rows.find(row=>row.event==='http.error'&&row.requestId===requestId);assert.equal(failure.code,'INVALID_INPUT');assert.equal(failure.issues[0].path[0],'name');
 assert.ok(rows.some(row=>row.event==='http.complete'&&row.requestId===requestId&&row.status===400&&row.durationMs>=0));
 assert.ok(rows.some(row=>row.event==='web.error'&&row.errorType==='TypeError'));assert.doesNotMatch(text,/PRIVATE-DESIGN-SENTINEL|PRIVATE_PATH_SENTINEL|private-token-sentinel|Bearer/);
 assert.equal(DiagnosticClientEventSchema.safeParse({event:'web.error',level:'error',frames:['/Users/person/secret.js:1:1']}).success,false);
 }finally{await server.close();await rm(dir,{recursive:true,force:true});}
});


test('native bootstrap observes console and runtime failures without the API, with a reserved error quota',async()=>{
 const source=await readFile(new URL('../desktop/DesktopDiagnostics.swift',import.meta.url),'utf8');
 const script=source.split('static let bootstrap = #"""')[1]!.split('"""#')[0]!;
 const events:unknown[]=[],listeners=new Map<string,(event:unknown)=>void>();
 const host:any={webkit:{messageHandlers:{fsbDiagnostics:{postMessage:(value:unknown)=>events.push(value)}}},addEventListener:(name:string,handler:(value:unknown)=>void)=>listeners.set(name,handler)};
 host.top=host;
 const consoleCopy={warn:(..._args:unknown[])=>{},error:(..._args:unknown[])=>{}};
 runInNewContext(script,{window:host,location:{origin:'https://127.0.0.1:4178',pathname:'/',search:''},console:consoleCopy,HTMLScriptElement:class{},HTMLLinkElement:class{},HTMLImageElement:class{},Error,Date});
 for(let i=0;i<200;i++)consoleCopy.warn('PRIVATE-LOG-SENTINEL');
 consoleCopy.error('PRIVATE-LOG-SENTINEL');
 const webkitError=new TypeError('PRIVATE-LOG-SENTINEL');webkitError.stack='run@https://127.0.0.1:4178/assets/index-abc.js:5:6';
 listeners.get('error')!({error:webkitError,target:null});
 const rejectedError=new Error('PRIVATE-LOG-SENTINEL\n at fake (/private/src/PRIVATE_SOURCE_SENTINEL.ts:1:2)');
 rejectedError.stack=`${rejectedError.name}: ${rejectedError.message}\n at run (https://127.0.0.1:4178/assets/index-abc.js:7:8)\n at invalid (/repo/src/../../PRIVATE_PATH_SENTINEL/file.ts:1:2)`;
 listeners.get('unhandledrejection')!({reason:rejectedError});
 const rows=events as Record<string,any>[];
 assert.ok(rows.some(row=>row.event==='web.console'&&row.level==='error'));
 assert.deepEqual(Array.from(rows.find(row=>row.event==='web.error')?.frames??[]),['assets/index-abc.js:5:6']);
 assert.deepEqual(Array.from(rows.find(row=>row.event==='web.unhandledrejection')?.frames??[]),['assets/index-abc.js:7:8']);assert.doesNotMatch(JSON.stringify(rows),/PRIVATE-LOG-SENTINEL|PRIVATE_SOURCE_SENTINEL|PRIVATE_PATH_SENTINEL/);
 const blocked:any={top:null,webkit:host.webkit,addEventListener:host.addEventListener};blocked.top=blocked;
 runInNewContext(script,{window:blocked,location:{origin:'https://outside.example',pathname:'/',search:''}});assert.equal(blocked.__FSB_DIAGNOSTICS__,undefined);
});


test('successful HTTP with invalid JSON is a client error with its correlation ID',async()=>{
 const original=globalThis.fetch,requestId='4ee2f650-4537-42a2-985d-dee3236a72bd';
 globalThis.fetch=async()=>new Response('not-json',{status:200,headers:{'X-FSB-Request-Id':requestId}});
 try{await assert.rejects(browserRequest('private-token','/api/health'),{code:'INVALID_RESPONSE',requestId,status:200});}
 finally{globalThis.fetch=original;}
});
