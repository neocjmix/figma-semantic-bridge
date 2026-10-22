import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { constants } from 'node:fs';
import { mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { CaptureLimitsSchema, DraftSchema, IdSchema, MutationSchema, PluginCommandSchema, SnapshotSchema } from '../shared/contracts.js';
import { approvedContext, approvedRecords, DomainError } from '../core/index.js';
import { AiError, aiStatus, generateDraft, readAiConfig, type AiConfig } from '../ai/index.js';
import { createDemoProject } from '../demo/project.js';
import { PluginBroker, tokensEqual } from './broker.js';
import { ProjectStore } from './store.js';
import { ServiceError } from './errors.js';
import { boundedPage, captureSummary, proposalSummary } from './responses.js';

export { PluginBroker } from './broker.js';
export { ProjectStore } from './store.js';
export { ServiceError } from './errors.js';

const MAX_BODY_BYTES=16_000_000;
const RevisionSchema=z.object({expectedRevision:z.number().int().min(0)}).strict();
const ProposalInputSchema=RevisionSchema.extend({draft:DraftSchema,warnings:z.array(z.string().max(2000)).max(100).default([])});
const CaptureInputSchema=RevisionSchema.extend({limits:CaptureLimitsSchema.default({})});
const CreateSchema=z.object({name:z.string().min(1).max(300)}).strict();
const PageSchema=z.object({offset:z.coerce.number().int().min(0).max(100000).default(0),limit:z.coerce.number().int().min(1).max(50).default(20)}).strict();
const SpecificationPageSchema=PageSchema.extend({annotationId:IdSchema.optional()});
const GenerateInputSchema=RevisionSchema.extend({snapshotIds:z.array(IdSchema).min(1).max(2),consentToExternalTransfer:z.boolean().default(false)});
const SummarySchema=z.object({summary:z.literal('1').optional()}).strict();
const ExportLimitsSchema=z.object({
  maxAnnotations:z.coerce.number().int().min(1).max(2000).default(500),
  maxSpecifications:z.coerce.number().int().min(1).max(2000).default(500),
  maxSourceNodes:z.coerce.number().int().min(1).max(5000).default(1000),
  maxTextChars:z.coerce.number().int().min(1).max(1000000).default(200000),
}).strict();

async function tokenFor(dataDir:string):Promise<string> {
  await mkdir(dataDir,{recursive:true,mode:0o700});
  const path=join(dataDir,'pairing-token');
  const token=randomBytes(32).toString('hex');
  try {const file=await open(path,'wx',0o600);try{await file.writeFile(token+'\n');await file.sync();}finally{await file.close();}return token;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {const info=await file.stat();if(!info.isFile()||info.size>1024)throw new Error('Invalid pairing token file.');const existing=(await file.readFile('utf8')).trim();if(existing.length<32)throw new Error('Invalid pairing token file.');return existing;}finally{await file.close();}
}
function securityHeaders(response:ServerResponse):void {
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Referrer-Policy','no-referrer');
  response.setHeader('X-Frame-Options','DENY');
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}
function json(response:ServerResponse,status:number,value:unknown):void {
  if(response.writableEnded)return;
  response.statusCode=status;response.setHeader('Content-Type','application/json; charset=utf-8');response.end(JSON.stringify(value));
}
function body(request:IncomingMessage):Promise<unknown> {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''))return Promise.reject(new ServiceError('CONTENT_TYPE','Use application/json.',415));
  const length=Number(request.headers['content-length']);
  if(Number.isFinite(length)&&length>MAX_BODY_BYTES)return Promise.reject(new ServiceError('BODY_LIMIT','Request body exceeds 16 MB.',413));
  return new Promise((resolveBody,reject)=>{
    let bytes=0;const chunks:Buffer[]=[];let done=false;
    const fail=(error:Error)=>{if(done)return;done=true;chunks.length=0;reject(error);};
    request.on('data',(chunk:Buffer)=>{if(done)return;bytes+=chunk.length;if(bytes>MAX_BODY_BYTES){fail(new ServiceError('BODY_LIMIT','Request body exceeds 16 MB.',413));return;}chunks.push(chunk);});
    request.on('end',()=>{if(done)return;done=true;try{resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new ServiceError('INVALID_JSON','Request body is not valid JSON.'));}});
    request.on('error',()=>fail(new ServiceError('REQUEST_ABORTED','Request body could not be read.')));
    request.on('aborted',()=>fail(new ServiceError('REQUEST_ABORTED','Request was aborted.')));
  });
}
const MIME:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.json':'application/json; charset=utf-8'};

export interface ServerOptions {port?:number;token?:string;dataDir?:string;webDir?:string;requestTimeoutMs?:number;aiConfig?:AiConfig|null}
export async function startServer(options:ServerOptions={}) {
  const dataDir=resolve(options.dataDir??join(homedir(),'.figma-semantic-bridge'));
  const token=options.token??await tokenFor(dataDir);
  if(token.length<32||token.length>1024)throw new Error('Pairing token must contain 32–1024 characters.');
  const store=new ProjectStore(dataDir);await store.initialize();
  const broker=new PluginBroker(token);
  let aiConfig:AiConfig|null=null,aiConfigurationError:AiError|null=null;
  try {aiConfig=options.aiConfig===undefined?readAiConfig():options.aiConfig;aiStatus(aiConfig);}
  catch(error){if(!(error instanceof AiError))throw error;aiConfigurationError=error;aiConfig=null;}
  const webDir=resolve(options.webDir??'dist/web');
  let port=options.port??4177;
  let active=0;
  let activeAi=0;
  const hostAllowed=(request:IncomingMessage)=>request.headers.host===`127.0.0.1:${port}`||request.headers.host===`localhost:${port}`;
  const ownOrigins=()=>new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
  async function serveStatic(path:string,response:ServerResponse):Promise<void> {
    if(path.includes('\0')||path.includes('\\'))throw new ServiceError('NOT_FOUND','Not found.',404);
    let target=resolve(webDir,'.'+path);
    if(!target.startsWith(webDir+sep)&&target!==webDir)throw new ServiceError('NOT_FOUND','Not found.',404);
    try {
      if(path==='/')target=join(webDir,'index.html');
      const [actualRoot,actual]=await Promise.all([realpath(webDir),realpath(target)]);
      if(!actual.startsWith(actualRoot+sep))throw new ServiceError('NOT_FOUND','Not found.',404);
      const info=await stat(actual);if(!info.isFile()||info.size>8_000_000)throw new ServiceError('NOT_FOUND','Not found.',404);
      const mime=MIME[extname(actual)];if(!mime)throw new ServiceError('NOT_FOUND','Not found.',404);
      response.statusCode=200;response.setHeader('Content-Type',mime);response.end(await readFile(actual));
    } catch(error) {
      if(error instanceof ServiceError)throw error;
      throw new ServiceError('WEB_NOT_BUILT','Web app not found. Run npm run build first.',404);
    }
  }
  const server=createServer(async(request,response)=>{
    securityHeaders(response);
    try {
      if(!hostAllowed(request))throw new ServiceError('HOST_FORBIDDEN','Only the bound loopback host is allowed.',403);
      const origin=request.headers.origin;
      if(origin&&!ownOrigins().has(origin))throw new ServiceError('ORIGIN_FORBIDDEN','Origin is not allowed.',403);
      if(active>=16)throw new ServiceError('SERVER_BUSY','Too many active requests.',429);
      active++;
      try {
        const url=new URL(request.url??'/',`http://127.0.0.1:${port}`),path=decodeURIComponent(url.pathname);
        if(path.startsWith('/api/')){
          const header=request.headers.authorization??'';
          if(!header.startsWith('Bearer ')||!tokensEqual(header.slice(7),token))throw new ServiceError('UNAUTHORIZED','A valid local pairing token is required.',401);
          if(request.method==='GET'&&path==='/api/health'){json(response,200,{ok:true,schemaVersion:'1.0.0'});return;}
          if(request.method==='GET'&&path==='/api/plugin/status'){json(response,200,broker.status);return;}
          if(request.method==='GET'&&path==='/api/ai/status'){json(response,200,{...aiStatus(aiConfig),...(aiConfigurationError?{configurationError:aiConfigurationError.message}:{})});return;}
          if(request.method==='POST'&&path==='/api/plugin/selection'){
            z.object({}).strict().parse(await body(request));
            json(response,200,await broker.request({type:'get_selection'}));return;
          }
          if(request.method==='POST'&&path==='/api/plugin/highlight'){
            const value=z.object({fileKey:z.string().min(1).max(160),pageId:z.string().min(1).max(160),nodeIds:z.array(z.string().min(1).max(160)).min(1).max(100)}).strict().parse(await body(request));
            json(response,200,await broker.request(PluginCommandSchema.parse({type:'highlight_nodes',...value})));return;
          }
          if(path==='/api/projects'&&request.method==='GET'){json(response,200,{projects:await store.list()});return;}
          if(path==='/api/projects'&&request.method==='POST'){const input=CreateSchema.parse(await body(request));json(response,201,await store.create(input.name));return;}
          if(path==='/api/demo'&&request.method==='POST'){z.object({}).strict().parse(await body(request));json(response,201,await store.importProject(createDemoProject()));return;}
          const componentMatch=path.match(/^\/api\/projects\/([^/]+)\/components\/(.+)$/);
          if(componentMatch&&request.method==='GET'){
            const project=await store.get(componentMatch[1]!);
            const annotationId=IdSchema.parse(componentMatch[2]);
            const approved=approvedRecords(project),component=approved.annotations.find(a=>a.id===annotationId);
            if(!component)throw new ServiceError('NOT_FOUND','Approved component not found.',404);
            const related=approved.specifications.filter(s=>s.relations.some(r=>r.targetAnnotationId===component.id));
            const page=boundedPage(related,0,50);
            const result={component,specifications:page.records,specificationTotal:page.total,nextSpecificationOffset:page.nextOffset,revision:project.revision};
            if(Buffer.byteLength(JSON.stringify(result))>126_000)throw new ServiceError('RESPONSE_LIMIT','Component detail exceeds the tool budget; use component and specification list endpoints.',413);
            json(response,200,result);return;
          }
          const match=path.match(/^\/api\/projects\/([^/]+)(?:\/(mutate|undo|redo|capture|export|proposals|nodes|components|specifications|generate-draft))?$/);
          if(match){
            const id=match[1]!,action=match[2];
            if(!action&&request.method==='GET'){json(response,200,await store.get(id));return;}
            if((action==='components'||action==='specifications')&&request.method==='GET'){
              const query=SpecificationPageSchema.parse(Object.fromEntries(url.searchParams));
              if(action==='components'&&query.annotationId!==undefined)throw new ServiceError('INVALID_INPUT','annotationId applies only to specifications.');
              const project=await store.get(id),approved=approvedRecords(project);
              if(action==='components'){
                const {records,...metadata}=boundedPage(approved.annotations,query.offset,query.limit);
                json(response,200,{components:records,...metadata,revision:project.revision});
              } else {
                const matching=query.annotationId?approved.specifications.filter(s=>s.relations.some(r=>r.targetAnnotationId===query.annotationId)):approved.specifications;
                const {records,...metadata}=boundedPage(matching,query.offset,query.limit);
                json(response,200,{specifications:records,...metadata,revision:project.revision});
              }
              return;
            }
            if(action==='export'&&request.method==='GET'){
              const limits=ExportLimitsSchema.parse(Object.fromEntries(url.searchParams));
              const result=approvedContext(await store.get(id),limits);
              if(Buffer.byteLength(JSON.stringify(result))>4_000_000)throw new ServiceError('RESPONSE_LIMIT','Approved context exceeds 4 MB; request smaller export limits.',413);
              json(response,200,result);return;
            }
            if(request.method==='POST'){
              const input=await body(request);
              if(action==='nodes'){
                const selected=z.object({snapshotId:z.string().min(1).max(160),nodeIds:z.array(z.string().min(1).max(160)).min(1).max(100)}).strict().parse(input);
                const snapshot=(await store.get(id)).snapshots.find(s=>s.id===selected.snapshotId);
                if(!snapshot)throw new ServiceError('NOT_FOUND','Captured scope not found.',404);
                const ids=new Set(selected.nodeIds),nodes=snapshot.nodes.filter(node=>ids.has(node.id));
                if(nodes.length!==ids.size)throw new ServiceError('NOT_FOUND','Requested source node is not in the captured scope.',404);
                const result={nodes,source:snapshot.source};
                if(Buffer.byteLength(JSON.stringify(result))>2_000_000)throw new ServiceError('RESPONSE_LIMIT','Source result exceeds 2 MB; request fewer nodes.',413);
                json(response,200,result);return;
              }
              if(action==='mutate'){const mutation=MutationSchema.parse(input);json(response,200,await store.mutate(id,mutation.expectedRevision,mutation.operation,'human'));return;}
              if(action==='undo'||action==='redo'){const revision=RevisionSchema.parse(input);json(response,200,await store.history(id,revision.expectedRevision,action));return;}
              if(action==='proposals'){
                const summary=SummarySchema.parse(Object.fromEntries(url.searchParams)).summary==='1';
                const proposal=ProposalInputSchema.parse(input),project=await store.mutate(id,proposal.expectedRevision,{type:'submit_proposal',draft:proposal.draft,warnings:proposal.warnings},'ai');
                json(response,200,summary?proposalSummary(project):project);return;
              }
              if(action==='generate-draft'){
                if(aiConfigurationError)throw aiConfigurationError;
                const summary=SummarySchema.parse(Object.fromEntries(url.searchParams)).summary==='1';
                const generate=GenerateInputSchema.parse(input),project=await store.get(id);
                if(project.revision!==generate.expectedRevision)throw new ServiceError('REVISION_CONFLICT','Project changed; reload before generating a draft.',409);
                if(activeAi>=2)throw new ServiceError('AI_BUSY','Two model requests are already active.',429);
                const abort=new AbortController();const onClose=()=>{if(!response.writableEnded)abort.abort();};response.on('close',onClose);activeAi++;
                try {
                  const generated=await generateDraft({config:aiConfig,project,snapshotIds:generate.snapshotIds,consentToExternalTransfer:generate.consentToExternalTransfer,signal:abort.signal});
                  if(abort.signal.aborted)throw new ServiceError('AI_CANCELLED','Model request was cancelled.',499);
                  const updated=await store.mutate(id,generate.expectedRevision,{type:'submit_proposal',draft:generated.draft,warnings:generated.warnings},'ai');
                  json(response,200,summary?{...proposalSummary(updated),model:generated.model,usage:generated.usage}:updated);
                } finally {activeAi--;response.off('close',onClose);}
                return;
              }
              if(action==='capture'){
                const summary=SummarySchema.parse(Object.fromEntries(url.searchParams)).summary==='1';
                const capture=CaptureInputSchema.parse(input);
                const project=await store.get(id);if(project.revision!==capture.expectedRevision)throw new ServiceError('REVISION_CONFLICT','Project changed; reload before capture.',409);
                const abort=new AbortController();const onClose=()=>{if(!response.writableEnded)abort.abort();};response.on('close',onClose);
                try {
                  const snapshot=SnapshotSchema.parse(await broker.request({type:'capture_selection',limits:capture.limits},{signal:abort.signal,timeoutMs:options.requestTimeoutMs??20000}));
                  const updated=await store.mutate(id,capture.expectedRevision,{type:'add_snapshot',snapshot},'human');
                  json(response,200,summary?captureSummary(updated,snapshot):updated);
                } finally {response.off('close',onClose);}return;
              }
            }
          }
          throw new ServiceError('NOT_FOUND','API route not found.',404);
        }
        if(request.method!=='GET'&&request.method!=='HEAD')throw new ServiceError('NOT_FOUND','Not found.',404);
        await serveStatic(path,response);
      } finally {active--;}
    } catch(error) {
      if(error instanceof ServiceError)json(response,error.status,{error:{code:error.code,message:error.message}});
      else if(error instanceof AiError){const status=error.code==='AI_CONSENT_REQUIRED'?403:error.code==='AI_TIMEOUT'?504:error.code==='AI_CANCELLED'?499:['AI_PROVIDER_ERROR','AI_RESPONSE_TOO_LARGE','AI_INVALID_RESPONSE'].includes(error.code)?502:400;json(response,status,{error:{code:error.code,message:error.message}});}
      else if(error instanceof z.ZodError)json(response,400,{error:{code:'INVALID_INPUT',message:'Request does not match the validated data contract.'}});
      else if(error instanceof DomainError){const status=error.code==='NOT_FOUND'?404:error.code.includes('STALE')||error.code.includes('CONFLICT')?409:error.code==='FORBIDDEN'?403:400;json(response,status,{error:{code:error.code,message:error.message}});}
      else json(response,500,{error:{code:'INTERNAL_ERROR',message:'Local operation failed; reload the project to check its latest revision.'}});
    }
  });
  server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  const sockets=new WebSocketServer({noServer:true,maxPayload:MAX_BODY_BYTES,perMessageDeflate:false});
  sockets.on('connection',socket=>broker.attach(socket));
  server.on('upgrade',(request,socket,head)=>{
    const origin=request.headers.origin;
    const allowedOrigin=origin==='null'||origin==='https://www.figma.com'||origin==='https://figma.com'||(!!origin&&ownOrigins().has(origin));
    if(!hostAllowed(request)||!allowedOrigin||request.url!=='/bridge'){
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;
    }
    if(sockets.clients.size>=8){socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    sockets.handleUpgrade(request,socket,head,ws=>sockets.emit('connection',ws,request));
  });
  try {
    await new Promise<void>((resolveListen,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolveListen();});});
  } catch(error){broker.close();sockets.close();throw error;}
  const address=server.address();if(!address||typeof address==='string')throw new Error('Loopback address unavailable.');port=address.port;
  let shutdown:Promise<void>|undefined;
  return {url:`http://127.0.0.1:${port}`,token,store,broker,
    close(){
      if(!shutdown){broker.close();sockets.close();server.closeAllConnections();shutdown=new Promise<void>((done,error)=>server.close(e=>e?error(e):done()));}
      return shutdown;
    },
  };
}
