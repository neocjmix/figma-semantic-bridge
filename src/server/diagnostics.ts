import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { DomainError } from '../core/project.js';
import { PRODUCT_VERSION } from '../shared/version.js';
import { diagnosticFrames, type DiagnosticClientEvent } from '../shared/diagnostics.js';

const segments=new Set('api health plugin status selection highlight import-settings projects demo mutate history captures snapshots annotations specifications proposals approved-context export markdown sources scopes nodes text records match preview confirm acquisition acquisitions source-tasks preflight start continue cancel pause resume remove metadata structure collections evidence branch parts query transfer transfers import download upload create attach copy regions inspection inspections children settings diagnostics events'.split(' '));
export function diagnosticRoute(value:string|undefined):string{
  try{return new URL(value??'/', 'http://localhost').pathname.split('/').map(part=>segments.has(part)?part:part?'_':'').join('/').slice(0,240);}catch{return '/invalid';}
}
type Details=Record<string,string|number|boolean|null|undefined|readonly unknown[]>;
type Context={requestId:string;route:string;method:string;operation?:string};
const fields=new Set('requestId pluginRequestId runId state route method operation command phase status durationMs code reason frames issues nodeCount bytes sequence pending count timeoutMs argumentCount errorType resourceType action'.split(' '));
const pathFields=new Set('project schemaVersion id name revision updatedAt snapshots scopes annotations specifications proposals source sourceRefs sourceReview candidates bbox x y width height coverage iou role parentId origin reviewStatus status confirmedAt text relations targetAnnotationId relationType operation expectedRevision expectedAnnotationRevision type axis ratio limits maxNodes maxBytes maxDurationMs collection branch preview bounds nodes visible rendering opacity sourceFileKey sourcePageId parentId pageId rootId fileKey warnings snapshotId nodeId matchType completeness reason'.split(' '));
export function diagnosticIssues(issues:readonly unknown[]):unknown[]{return issues.slice(0,30).map(value=>{
  const item=value as {path?:unknown[];code?:unknown;minimum?:unknown;maximum?:unknown};
  const path=(item.path??[]).slice(0,16).map(key=>typeof key==='number'?key:typeof key==='string'&&pathFields.has(key)?key:'field');
  return {path,code:typeof item.code==='string'&&/^[a-z_]{1,40}$/.test(item.code)?item.code:'invalid',
    ...(typeof item.minimum==='number'?{minimum:item.minimum}:{}),...(typeof item.maximum==='number'?{maximum:item.maximum}:{})};
});}

/** One private, bounded writer. All failures are contained so diagnostics cannot block editing. */
export class DiagnosticLog {
  readonly directory:string;
  private readonly sessionId=randomUUID();
  private readonly context=new AsyncLocalStorage<Context>();
  private queue:Promise<void>=Promise.resolve();
  private pending=0;
  private dropped=0;
  private windowAt=0;
  private clientCount=0;
  private clientErrors=0;
  constructor(dataDir:string,private readonly options:{maxBytes?:number;files?:number;retentionMs?:number}={}){this.directory=join(dataDir,'logs');}
  async initialize(){try{await mkdir(this.directory,{recursive:true,mode:0o700});const info=await lstat(this.directory);if(!info.isDirectory()||info.isSymbolicLink())return;await chmod(this.directory,0o700);const cutoff=Date.now()-(this.options.retentionMs??7*86_400_000);for(const name of await readdir(this.directory)){if(!/^server(?:\.\d+)?\.ndjson$/.test(name))continue;const path=join(this.directory,name),entry=await lstat(path);if(entry.isFile()&&!entry.isSymbolicLink()&&entry.mtimeMs<cutoff)await rm(path);}}catch{/* Best effort. */}}
  get requestId(){return this.context.getStore()?.requestId;}
  operation(operation:string){const current=this.context.getStore();if(current&&/^[a-z_]{1,80}$/.test(operation))current.operation=operation;}
  emit(event:string,level:'debug'|'info'|'warn'|'error'='info',details:Details={}){
    if(this.pending>=(level==='error'?320:256)){this.dropped++;return;}
    const safe:Details={};for(const [key,value] of Object.entries(details))if(fields.has(key)&&value!==undefined)safe[key]=value;
    const record={time:new Date().toISOString(),version:PRODUCT_VERSION,sessionId:this.sessionId,source:event.startsWith('web.')||event.startsWith('ui.')?'web':'server',event,level,...this.context.getStore(),...safe,...(this.dropped?{dropped:this.dropped}:{})};this.dropped=0;
    const encoded=JSON.stringify(record)+'\n';if(Buffer.byteLength(encoded)>16_384)return;
    this.pending++;this.queue=this.queue.then(()=>this.append(encoded)).catch(()=>{}).finally(()=>{this.pending--;});
  }
  error(event:string,error:unknown,details:Details={}){
    const e=error as {code?:unknown;diagnosticIssues?:unknown[]};
    const code=typeof e?.code==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(e.code)?e.code:error instanceof z.ZodError?'INVALID_INPUT':'INTERNAL_ERROR';
    this.emit(event,'error',{...details,code,...(error instanceof DomainError?{reason:error.message.slice(0,500)}:{}),
      frames:diagnosticFrames(error),...(error instanceof z.ZodError?{issues:diagnosticIssues(error.issues)}:Array.isArray(e?.diagnosticIssues)?{issues:diagnosticIssues(e.diagnosticIssues)}:{})});
  }
  client(event:DiagnosticClientEvent):boolean{
    const now=Date.now();if(now-this.windowAt>=60_000){this.windowAt=now;this.clientCount=0;this.clientErrors=0;}if(event.level==='error'?++this.clientErrors>120:++this.clientCount>240)return false;
    const {event:name,level,...details}=event;this.emit(name,level,details);return true;
  }
  request(request:IncomingMessage,response:ServerResponse,work:()=>Promise<void>):Promise<void>{
    const requestId=randomUUID(),started=performance.now(),route=diagnosticRoute(request.url);
    response.setHeader('X-FSB-Request-Id',requestId);
    const method=request.method==='POST'?'POST':request.method==='GET'?'GET':'OTHER';
    const context:Context={requestId,route,method};
    return this.context.run(context,async()=>{
      if(route!=='/api/diagnostics/events')this.emit('http.start','debug');
      let completed=false;const finish=()=>{if(completed)return;completed=true;const status=response.writableFinished?response.statusCode:499;if(route!=='/api/diagnostics/events'||status>=400)this.emit('http.complete',status>=400?'warn':'info',{...context,status,...(!response.writableFinished?{state:'cancelled'}:{}),durationMs:Math.round((performance.now()-started)*1000)/1000});};
      response.once('finish',finish);response.once('close',finish);await work();
    });
  }
  async flush(){await this.queue;}
  private async append(encoded:string){
    const info=await lstat(this.directory);if(!info.isDirectory()||info.isSymbolicLink())return;
    const path=join(this.directory,'server.ndjson'),max=this.options.maxBytes??5_000_000,files=this.options.files??5;
    const previous=await lstat(path).catch(()=>null);if(previous?.isSymbolicLink()||previous&&!previous.isFile())return;
    if(previous&&previous.size+Buffer.byteLength(encoded)>max){await rm(join(this.directory,`server.${files-1}.ndjson`),{force:true});for(let index=files-2;index>=1;index--)await rename(join(this.directory,`server.${index}.ndjson`),join(this.directory,`server.${index+1}.ndjson`)).catch(()=>{});await rename(path,join(this.directory,'server.1.ndjson'));}
    const file=await open(path,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
    try{const stat=await file.stat();if(!stat.isFile())return;await file.chmod(0o600);await file.write(encoded);}finally{await file.close();}
  }
}
