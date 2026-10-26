import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { TLSSocket } from 'node:tls';
import { ensureDesktopTls } from './desktop-tls.js';
import { constants } from 'node:fs';
import { mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { CaptureLimitsSchema, DraftSchema, IdSchema, MutationSchema, PluginCommandSchema, SelectionSchema, SnapshotSchema, SourcePreviewInputSchema } from '../shared/contracts.js';
import { ExportCaptureBundleInputSchema, ImportCaptureBundleInputSchema } from '../shared/capture-bundle.js';
import { DomainError, sourceScope, inlineScope } from '../core/index.js';
import { AiError, aiStatus, generateDraft, readAiConfig, type AiConfig } from '../ai/index.js';
import { createDemoProject } from '../demo/project.js';
import { PluginBroker, tokensEqual } from './broker.js';
import { ProjectStore } from './store.js';
import { ServiceError } from './errors.js';
import { boundedPage, captureSummary, proposalSummary } from './responses.js';
import { exportCaptureBundle, importCaptureBundle } from './capture-bundle.js';
import { sourcePreview } from './source-preview.js';
import { AcquisitionManager } from './acquisition.js';
import { StructureCollections } from './structure-collections.js';
import { CollectionQuerySchema, CollectionTextQuerySchema } from '../shared/structure-collection.js';
import { EvidenceScopes } from './evidence-scopes.js';
import { SelectiveAcquisition } from './selective-acquisition.js';
import { SourceTransfer } from './source-transfer.js';
import { DATA_SCHEMA_VERSION, PRODUCT_VERSION, SERVICE_NAME } from '../shared/version.js';
import { BRIDGE_MAX_WIRE_BYTES } from '../shared/bridge-auth.js';
import { ImportSettingsStore } from './import-settings.js';
import { ImportSettingsSchema } from '../shared/import-settings.js';

export { PluginBroker } from './broker.js';
export { ProjectStore } from './store.js';
export { ServiceError } from './errors.js';

const MAX_BODY_BYTES=16_000_000;
const RevisionSchema=z.object({expectedRevision:z.number().int().min(0)}).strict();
const ProposalInputSchema=RevisionSchema.extend({draft:DraftSchema,warnings:z.array(z.string().max(2000)).max(100).default([])});
const CaptureInputSchema=RevisionSchema.extend({limits:CaptureLimitsSchema.prefault({})});
const SourceSelectionInputSchema=RevisionSchema.extend({annotationId:IdSchema,expectedSessionId:IdSchema});
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

export interface ServerOptions {port?:number;desktopTlsPort?:number;token?:string;dataDir?:string;webDir?:string;requestTimeoutMs?:number;aiConfig?:AiConfig|null}
export async function startServer(options:ServerOptions={}) {
  const dataDir=resolve(options.dataDir??join(homedir(),'.figma-semantic-bridge'));
  const token=options.token??await tokenFor(dataDir);
  if(token.length<32||token.length>1024)throw new Error('Pairing token must contain 32–1024 characters.');
  const store=new ProjectStore(dataDir);await store.initialize();
  const tlsIdentity=options.desktopTlsPort===undefined?null:await ensureDesktopTls(dataDir);
  const broker=new PluginBroker(token);
  const importSettings=new ImportSettingsStore(dataDir);await importSettings.initialize();
  const acquisitions=new AcquisitionManager(dataDir,store,broker,options.requestTimeoutMs===undefined?{}:{requestTimeoutMs:options.requestTimeoutMs});
  try{await acquisitions.initialize();}catch(error){broker.close();throw error;}
  const collections=new StructureCollections(dataDir,store,broker,{
    ...(options.requestTimeoutMs===undefined?{}:{requestTimeoutMs:options.requestTimeoutMs}),settings:()=>importSettings.get().settings,
    overview:async(task,signal)=>{
      const id=task.overviewAcquisitionId!;
      let image=acquisitions.get(task.projectId,id);
      if(image.status==='prepared'&&task.source.type!=='SECTION')image=await acquisitions.start(task.projectId,id,{plan:'overview',overview:importSettings.get().settings.overview});
      while(image.status==='running'||image.status==='cancel_requested'){
        if(signal.aborted){await acquisitions.cancel(task.projectId,id);throw new ServiceError('CANCELLED','Source import interrupted.',499);}
        await new Promise(resolve=>setTimeout(resolve,50));image=acquisitions.get(task.projectId,id);
      }
      if(image.preview.status!=='ready')await collections.store.update(task.projectId,task.id,{warnings:[...task.warnings,'The overview is unavailable. Received source structure can still be used.']});
    },
  });
  try{await collections.initialize();}catch(error){broker.close();throw error;}
  const evidence=new EvidenceScopes(store,collections.store,acquisitions);
  const transfers=new SourceTransfer(store,collections.store,evidence);
  store.setEvidenceResolver((project,operation)=>evidence.context(project,operation));
  const selective=new SelectiveAcquisition(dataDir,store,broker,options.requestTimeoutMs===undefined?{}:{requestTimeoutMs:options.requestTimeoutMs});
  try{await selective.initialize();}catch(error){broker.close();throw error;}
  let aiConfig:AiConfig|null=null,aiConfigurationError:AiError|null=null;
  try {aiConfig=options.aiConfig===undefined?readAiConfig():options.aiConfig;aiStatus(aiConfig);}
  catch(error){if(!(error instanceof AiError))throw error;aiConfigurationError=error;aiConfig=null;}
  const webDir=resolve(options.webDir??'dist/web');
  let port=options.port??4177;
  let active=0;
  let activeAi=0;
  const encrypted=(request:IncomingMessage)=>(request.socket as TLSSocket).encrypted===true;
  const hostAllowed=(request:IncomingMessage)=>encrypted(request)
    ? request.headers.host===`127.0.0.1:${request.socket.localPort}`
    : request.headers.host===`127.0.0.1:${port}`||request.headers.host===`localhost:${port}`;
  const ownOrigins=()=>new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
  const requestOrigins=(request:IncomingMessage)=>encrypted(request)?new Set([`https://127.0.0.1:${request.socket.localPort}`]):ownOrigins();
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
  const handler=async(request:IncomingMessage,response:ServerResponse)=>{
    securityHeaders(response);
    try {
      if(!hostAllowed(request))throw new ServiceError('HOST_FORBIDDEN','Only the bound loopback host is allowed.',403);
      const origin=request.headers.origin;
      if(origin&&!requestOrigins(request).has(origin))throw new ServiceError('ORIGIN_FORBIDDEN','Origin is not allowed.',403);
      if(active>=16)throw new ServiceError('SERVER_BUSY','Too many active requests.',429);
      active++;
      try {
        const url=new URL(request.url??'/',`http://127.0.0.1:${port}`),path=decodeURIComponent(url.pathname);
        if(path.startsWith('/api/')){
          const header=request.headers.authorization??'';
          if(!header.startsWith('Bearer ')||!tokensEqual(header.slice(7),token))throw new ServiceError('UNAUTHORIZED','A valid local pairing token is required.',401);
          if(request.method==='GET'&&path==='/api/health'){json(response,200,{ok:true,service:SERVICE_NAME,version:PRODUCT_VERSION,schemaVersion:DATA_SCHEMA_VERSION});return;}
          if(request.method==='GET'&&path==='/api/plugin/status'){json(response,200,broker.status);return;}
          if(request.method==='GET'&&path==='/api/ai/status'){json(response,200,{...aiStatus(aiConfig),...(aiConfigurationError?{configurationError:aiConfigurationError.message}:{})});return;}
          if(path==='/api/import-settings'){
            if(request.method==='GET'){json(response,200,importSettings.get());return;}
            if(request.method==='POST'){
              const value=z.object({expectedRevision:z.number().int().min(0),settings:ImportSettingsSchema}).strict().parse(await body(request));
              json(response,200,await importSettings.save(value.expectedRevision,value.settings));return;
            }
          }
          if(request.method==='POST'&&path==='/api/plugin/selection'){
            z.object({}).strict().parse(await body(request));
            const abort=new AbortController();const onClose=()=>{if(!response.writableEnded)abort.abort();};response.on('close',onClose);
            try {json(response,200,await broker.request({type:'get_selection'},{signal:abort.signal}));}
            finally {response.off('close',onClose);}return;
          }
          if(request.method==='POST'&&path==='/api/plugin/highlight'){
            const value=z.object({fileKey:z.string().min(1).max(160),pageId:z.string().min(1).max(160),nodeIds:z.array(z.string().min(1).max(160)).min(1).max(100)}).strict().parse(await body(request));
            const abort=new AbortController();const onClose=()=>{if(!response.writableEnded)abort.abort();};response.on('close',onClose);
            try {json(response,200,await broker.request(PluginCommandSchema.parse({type:'highlight_nodes',...value}),{signal:abort.signal}));}
            finally {response.off('close',onClose);}return;
          }
          if(path==='/api/projects'&&request.method==='GET'){json(response,200,{projects:await store.list()});return;}
          if(path==='/api/projects'&&request.method==='POST'){const input=CreateSchema.parse(await body(request));json(response,201,await store.create(input.name));return;}
          if(path==='/api/demo'&&request.method==='POST'){z.object({}).strict().parse(await body(request));json(response,201,await store.importProject(createDemoProject()));return;}
          if(path==='/api/capture-bundles/import'&&request.method==='POST'){
            const input=ImportCaptureBundleInputSchema.parse(await body(request));
            const project=importCaptureBundle(input.bundle,input.name);
            json(response,201,await store.importProject(project));return;
          }
          const evidenceBranchMatch=path.match(/^\/api\/projects\/([^/]+)\/evidence-scopes\/branch$/);
          if(evidenceBranchMatch&&request.method==='POST'){
            const value=RevisionSchema.extend({collectionId:IdSchema,nodeId:IdSchema,contextScopeId:IdSchema.optional()}).parse(await body(request));
            json(response,201,await evidence.createBranch(evidenceBranchMatch[1]!,value.expectedRevision,{collectionId:value.collectionId,nodeId:value.nodeId,
              ...(value.contextScopeId?{contextScopeId:value.contextScopeId}:{})}));return;
          }
          const evidenceMatch=path.match(/^\/api\/projects\/([^/]+)\/evidence-scopes(?:\/([^/]+)\/(attach|nodes|text|resolve|copy-regions))?$/);
          if(evidenceMatch&&request.method==='POST'){
            const projectId=evidenceMatch[1]!,scopeId=evidenceMatch[2],action=evidenceMatch[3],input=await body(request);
            if(!scopeId){
              const value=RevisionSchema.extend({acquisitionId:IdSchema.optional(),collectionId:IdSchema.optional()}).parse(input);
              json(response,201,await evidence.create(projectId,value.expectedRevision,{
                ...(value.acquisitionId?{acquisitionId:value.acquisitionId}:{}),...(value.collectionId?{collectionId:value.collectionId}:{})}));return;
            }
            if(action==='attach'){
              const value=RevisionSchema.extend({collectionId:IdSchema}).parse(input);
              json(response,200,await evidence.attach(projectId,scopeId,value.expectedRevision,value.collectionId));return;
            }
            if(action==='copy-regions'){
              const value=RevisionSchema.extend({sourceScopeId:IdSchema,annotationIds:z.array(IdSchema).min(1).max(200)}).parse(input);
              json(response,200,await evidence.copyRegions(projectId,scopeId,value.expectedRevision,value.sourceScopeId,value.annotationIds));return;
            }
            const project=await store.get(projectId);
            if(action==='nodes'){json(response,200,await evidence.query(project,scopeId,CollectionQuerySchema.parse(input)));return;}
            if(action==='text'){json(response,200,await evidence.text(project,scopeId,CollectionTextQuerySchema.parse(input)));return;}
            if(action==='resolve'){
              const value=z.object({nodeIds:z.array(IdSchema).min(1).max(100)}).strict().parse(input);
              const result={nodes:await evidence.records(project,scopeId,value.nodeIds),source:sourceScope(project,scopeId)!.source};
              if(Buffer.byteLength(JSON.stringify(result))>2_000_000)throw new ServiceError('RESPONSE_LIMIT','Source result exceeds 2 MB; request fewer nodes.',413);
              json(response,200,result);return;
            }
          }
          const transferMatch=path.match(/^\/api\/projects\/([^/]+)\/source-transfer(?:\/([^/]+))?$/);
          if(transferMatch){
            const projectId=transferMatch[1]!,scopeId=transferMatch[2];
            const revision=z.object({expectedRevision:z.coerce.number().int().min(0)}).strict().parse(Object.fromEntries(url.searchParams));
            if(request.method==='GET'&&scopeId){
              const iterator=transfers.export(projectId,scopeId,revision.expectedRevision);
              const first=await iterator.next();
              response.statusCode=200;response.setHeader('Content-Type','application/x-ndjson');
              response.setHeader('Content-Disposition','attachment; filename="figma-source.ndjson"');
              const write=async(value:string)=>{if(response.destroyed)throw new ServiceError('CANCELLED','Export disconnected.',499);
                if(!response.write(value))await new Promise<void>((resolveDrain,reject)=>{
                  const cleanup=()=>{response.off('drain',onDrain);response.off('close',onClose);};
                  const onDrain=()=>{cleanup();resolveDrain();},onClose=()=>{cleanup();reject(new ServiceError('CANCELLED','Export disconnected.',499));};
                  response.once('drain',onDrain);response.once('close',onClose);
                });};
              try{if(!first.done)await write(first.value);for await(const line of iterator)await write(line);response.end();}
              catch{response.destroy();}finally{await iterator.return(undefined);}return;
            }
            if(request.method==='POST'&&!scopeId){
              if(!/^application\/x-ndjson(?:\s*;|$)/i.test(request.headers['content-type']??''))throw new ServiceError('CONTENT_TYPE','Use application/x-ndjson.',415);
              const abort=new AbortController(),onClose=()=>{if(!response.writableEnded)abort.abort();};response.on('close',onClose);
              try{json(response,201,await transfers.import(projectId,revision.expectedRevision,request,abort.signal));}finally{response.off('close',onClose);}return;
            }
            throw new ServiceError('NOT_FOUND','Source transfer route not found.',404);
          }
          const selectiveMatch=path.match(/^\/api\/projects\/([^/]+)\/selective(?:\/([^/]+)(?:\/(nodes|children|remove|observations|records|text))?)?$/);
          if(selectiveMatch){
            const projectId=selectiveMatch[1]!,inspectionId=selectiveMatch[2],action=selectiveMatch[3];
            await store.get(projectId);
            if(request.method==='GET'){
              if(!inspectionId){json(response,200,{inspections:selective.list(projectId)});return;}
              if(action==='observations'){const page=z.object({offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(20).default(20)}).strict().parse(Object.fromEntries(url.searchParams));
                json(response,200,selective.listObservations(projectId,inspectionId,page.offset,page.limit));return;}
              if(!action){const page=z.object({offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(10).default(10)}).strict().parse(Object.fromEntries(url.searchParams));
                json(response,200,selective.get(projectId,inspectionId,page.offset,page.limit));return;}
            }
            if(request.method==='POST'){
              const input=await body(request),abort=new AbortController(),onClose=()=>{if(!response.writableEnded)abort.abort();};response.on('close',onClose);
              try{
                if(!inspectionId){const value=RevisionSchema.extend({expectedSessionId:IdSchema}).parse(input);
                  json(response,201,await selective.prepare(projectId,value.expectedRevision,value.expectedSessionId,abort.signal));return;}
                if(action==='nodes'){json(response,200,await selective.readNodes(projectId,inspectionId,input,abort.signal));return;}
                if(action==='children'){json(response,200,await selective.readChildren(projectId,inspectionId,input,abort.signal));return;}
                if(action==='records'){const value=z.object({observationId:IdSchema,offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(20).default(20)}).strict().parse(input);
                  json(response,200,selective.readRecords(projectId,inspectionId,value.observationId,value.offset,value.limit));return;}
                if(action==='text'){const value=z.object({observationId:IdSchema,nodeId:IdSchema,offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(4000).default(4000)}).strict().parse(input);
                  json(response,200,selective.readText(projectId,inspectionId,value.observationId,value.nodeId,value.offset,value.limit));return;}
                if(action==='remove'){z.object({}).strict().parse(input);await selective.remove(projectId,inspectionId);json(response,200,{removed:true});return;}
              }finally{response.off('close',onClose);}
            }
            throw new ServiceError('NOT_FOUND','Selective source route not found.',404);
          }
          const branchMatch=path.match(/^\/api\/projects\/([^/]+)\/collections\/branch$/);
          if(branchMatch&&request.method==='POST'){
            const value=RevisionSchema.extend({expectedSessionId:IdSchema,inspectionId:IdSchema,nodeId:IdSchema}).parse(await body(request));
            const abort=new AbortController(),onClose=()=>{if(!response.writableEnded)abort.abort();};response.on('close',onClose);
            try{json(response,201,await collections.prepareFromInspection(branchMatch[1]!,value.expectedRevision,value.expectedSessionId,selective,value.inspectionId,value.nodeId,abort.signal));}
            finally{response.off('close',onClose);}return;
          }
          const collectionMatch=path.match(/^\/api\/projects\/([^/]+)\/collections(?:\/([^/]+)(?:\/(start|stop|resume|remove|nodes|text|evidence|evidence-text|evidence-branch|continue-plan|continue|part-plan|part))?)?$/);
          if(collectionMatch){
            const projectId=collectionMatch[1]!,id=collectionMatch[2],action=collectionMatch[3];
            await store.get(projectId);
            if(request.method==='GET'){
              if(!id){json(response,200,{collections:collections.list(projectId)});return;}
              if(!action){json(response,200,collections.get(projectId,id));return;}
              if(action==='continue-plan'){json(response,200,collections.continuePlan(projectId,id));return;}
            }
            if(request.method==='POST'){
              const input=await body(request);
              if(!id){
                const prepare=z.object({expectedRevision:z.number().int().min(0),expectedSessionId:IdSchema,withOverview:z.boolean().optional()}).strict().parse(input);
                const abort=new AbortController(),onClose=()=>{if(!response.writableEnded)abort.abort();};response.on('close',onClose);
                try{
                  if(prepare.withOverview){
                    const image=await acquisitions.prepare(projectId,prepare.expectedRevision,prepare.expectedSessionId,abort.signal);
                    try{json(response,201,await collections.preparePinned(image,abort.signal));}
                    catch(error){await acquisitions.remove(projectId,image.id).catch(()=>{});throw error;}
                  }else json(response,201,await collections.prepare(projectId,prepare.expectedRevision,prepare.expectedSessionId,abort.signal));
                }
                finally{response.off('close',onClose);}return;
              }
              if(action==='nodes'){json(response,200,await collections.store.query(projectId,id,CollectionQuerySchema.parse(input)));return;}
              if(action==='text'){json(response,200,await collections.store.text(projectId,id,CollectionTextQuerySchema.parse(input)));return;}
              if(action==='evidence'){json(response,200,await collections.store.evidence(projectId,id,CollectionQuerySchema.parse(input)));return;}
              if(action==='evidence-text'){json(response,200,await collections.store.evidenceText(projectId,id,CollectionTextQuerySchema.parse(input)));return;}
              if(action==='evidence-branch'){
                const value=z.object({nodeId:IdSchema}).strict().parse(input);json(response,200,await collections.store.evidenceBranch(projectId,id,value.nodeId));return;
              }
              if(action==='part-plan'){
                const value=z.object({nodeId:IdSchema}).strict().parse(input);json(response,200,await collections.partPlan(projectId,id,value.nodeId));return;
              }
              if(action==='part'){
                const value=RevisionSchema.extend({nodeId:IdSchema,expectedSessionId:IdSchema,confirmRevalidation:z.boolean().default(false)}).parse(input);
                const abort=new AbortController(),onClose=()=>{if(!response.writableEnded)abort.abort();};response.on('close',onClose);
                try{json(response,202,await collections.part(projectId,id,value,abort.signal));}finally{response.off('close',onClose);}return;
              }
              if(action==='continue'){
                const value=RevisionSchema.extend({expectedSessionId:IdSchema,confirmRevalidation:z.boolean().default(false)}).parse(input);
                const abort=new AbortController(),onClose=()=>{if(!response.writableEnded)abort.abort();};response.on('close',onClose);
                try{json(response,202,await collections.continue(projectId,id,value,abort.signal));}finally{response.off('close',onClose);}return;
              }
              z.object({}).strict().parse(input);
              if(action==='continue-plan'){json(response,200,collections.continuePlan(projectId,id));return;}
              if(action==='start'||action==='resume'){json(response,202,await collections.start(projectId,id,action==='resume'));return;}
              if(action==='stop'){json(response,200,await collections.stop(projectId,id));return;}
              if(action==='remove'){await collections.remove(projectId,id);json(response,200,{removed:true});return;}
            }
            throw new ServiceError('NOT_FOUND','Collection route not found.',404);
          }
          const acquisitionMatch=path.match(/^\/api\/projects\/([^/]+)\/acquisitions(?:\/([^/]+)(?:\/(start|retry|cancel|commit|preview|remove|load-structure))?)?$/);
          if(acquisitionMatch){
            const projectId=acquisitionMatch[1]!,taskId=acquisitionMatch[2],action=acquisitionMatch[3];
            if(request.method==='GET') {
              await store.get(projectId);
              if(!taskId){json(response,200,{tasks:acquisitions.list(projectId)});return;}
              if(!action){json(response,200,acquisitions.get(projectId,taskId));return;}
              if(action==='preview'){json(response,200,acquisitions.preview(projectId,taskId));return;}
            }
            if(request.method==='POST') {
              const input=await body(request);
              if(!taskId){
                const prepare=z.object({expectedRevision:z.number().int().min(0),expectedSessionId:IdSchema}).strict().parse(input);
                const abort=new AbortController(),onClose=()=>{if(!response.writableEnded)abort.abort();};response.on('close',onClose);
                try{json(response,201,await acquisitions.prepare(projectId,prepare.expectedRevision,prepare.expectedSessionId,abort.signal));}
                finally{response.off('close',onClose);}return;
              }
              if(action==='start'){json(response,202,await acquisitions.start(projectId,taskId,input));return;}
              if(action==='retry'){const retry=z.object({step:z.enum(['preview','structure'])}).strict().parse(input);json(response,202,await acquisitions.retry(projectId,taskId,retry.step));return;}
              if(action==='load-structure'){const load=z.object({limits:CaptureLimitsSchema.prefault({})}).strict().parse(input);json(response,202,await acquisitions.loadStructure(projectId,taskId,load.limits));return;}
              if(action==='cancel'){z.object({}).strict().parse(input);json(response,200,await acquisitions.cancel(projectId,taskId));return;}
              if(action==='commit'){const commit=RevisionSchema.parse(input);json(response,200,await acquisitions.commit(projectId,taskId,commit.expectedRevision));return;}
              if(action==='remove'){z.object({}).strict().parse(input);await acquisitions.remove(projectId,taskId);json(response,200,{removed:true});return;}
            }
            throw new ServiceError('NOT_FOUND','Acquisition route not found.',404);
          }
          const componentMatch=path.match(/^\/api\/projects\/([^/]+)\/components\/(.+)$/);
          if(componentMatch&&request.method==='GET'){
            const project=await store.get(componentMatch[1]!);
            const annotationId=IdSchema.parse(componentMatch[2]);
            const approved=await evidence.approved(project),component=approved.annotations.find(a=>a.id===annotationId);
            if(!component)throw new ServiceError('NOT_FOUND','Approved component not found.',404);
            const related=approved.specifications.filter(s=>s.relations.some(r=>r.targetAnnotationId===component.id));
            const page=boundedPage(related,0,50);
            const result={component,specifications:page.records,specificationTotal:page.total,nextSpecificationOffset:page.nextOffset,revision:project.revision};
            if(Buffer.byteLength(JSON.stringify(result))>126_000)throw new ServiceError('RESPONSE_LIMIT','Component detail exceeds the tool budget; use component and specification list endpoints.',413);
            json(response,200,result);return;
          }
          const match=path.match(/^\/api\/projects\/([^/]+)(?:\/(mutate|undo|redo|capture|capture-bundle|export|proposals|nodes|components|specifications|generate-draft|source-selection|source-preview))?$/);
          if(match){
            const id=match[1]!,action=match[2];
            if(!action&&request.method==='GET'){json(response,200,await store.get(id));return;}
            if((action==='components'||action==='specifications')&&request.method==='GET'){
              const query=SpecificationPageSchema.parse(Object.fromEntries(url.searchParams));
              if(action==='components'&&query.annotationId!==undefined)throw new ServiceError('INVALID_INPUT','annotationId applies only to specifications.');
              const project=await store.get(id),approved=await evidence.approved(project);
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
              const result=await evidence.export(await store.get(id),limits);
              if(Buffer.byteLength(JSON.stringify(result))>4_000_000)throw new ServiceError('RESPONSE_LIMIT','Approved context exceeds 4 MB; request smaller export limits.',413);
              json(response,200,result);return;
            }
            if(request.method==='POST'){
              const input=await body(request);
              if(action==='source-preview'){
                const previewInput=SourcePreviewInputSchema.parse(input);
                const abort=new AbortController(),onClose=()=>{if(!response.writableEnded)abort.abort();};response.on('close',onClose);
                try {
                  const preview=await sourcePreview(store,broker,id,previewInput,{signal:abort.signal,timeoutMs:options.requestTimeoutMs??20000,
                    isClosed:()=>response.destroyed||request.aborted,
                    resolve:async(scopeId,nodeId)=>(await evidence.records(await store.get(id),scopeId,[nodeId]))[0]});
                  json(response,200,preview);
                } finally {response.off('close',onClose);}return;
              }
              if(action==='capture-bundle'){
                const selected=ExportCaptureBundleInputSchema.parse(input),project=await store.get(id);
                if(project.revision!==selected.expectedRevision)throw new ServiceError('REVISION_CONFLICT','Project changed; reload before exporting captures.',409);
                json(response,200,exportCaptureBundle(project,selected.snapshotIds));return;
              }
              if(action==='source-selection'){
                const selectedInput=SourceSelectionInputSchema.parse(input);
                const abort=new AbortController();const onClose=()=>{if(!response.writableEnded)abort.abort();};response.on('close',onClose);
                const checkActive=()=>{
                  if(response.destroyed||request.aborted)abort.abort();
                  if(abort.signal.aborted)throw new ServiceError('CANCELLED','Source selection request cancelled.',499);
                  const status=broker.status;
                  if(!status.connected)throw new ServiceError('PLUGIN_DISCONNECTED','Figma plugin is disconnected.',503);
                  if(status.sessionId!==selectedInput.expectedSessionId)throw new ServiceError('PLUGIN_SESSION_CHANGED','Figma plugin session changed. Reconnect the review to the current session.',409);
                };
                try {
                  checkActive();
                  const project=await store.get(id);
                  checkActive();
                  if(project.revision!==selectedInput.expectedRevision)throw new ServiceError('REVISION_CONFLICT','Project changed; reload before adding a source selection.',409);
                  const annotation=project.annotations.find(item=>item.id===selectedInput.annotationId);
                  if(!annotation)throw new ServiceError('NOT_FOUND','Annotation not found.',404);
                  const snapshot=sourceScope(project,annotation.snapshotId);
                  if(!snapshot)throw new ServiceError('NOT_FOUND','Source scope not found.',404);
                  if(!snapshot.source.fileKey)throw new ServiceError('FILE_IDENTITY_UNAVAILABLE','Captured source file identity is unavailable. Capture a new scope with host-provided identity.',409);
                  const selection=SelectionSchema.parse(await broker.request({type:'get_selection'},{signal:abort.signal,timeoutMs:options.requestTimeoutMs??20000}));
                  checkActive();
                  if(selection.nodes.length!==1)throw new ServiceError('INVALID_SELECTION','Select exactly one Figma node to add to the review.',400);
                  if(!selection.fileKey)throw new ServiceError('FILE_IDENTITY_UNAVAILABLE','Figma did not expose the selected file identity.',409);
                  if(selection.fileKey!==snapshot.source.fileKey)throw new ServiceError('WRONG_FILE','The selected node belongs to a different source file.',409);
                  if(selection.pageId!==snapshot.source.pageId)throw new ServiceError('WRONG_PAGE','The selected node belongs to a different source page.',409);
                  const selected=selection.nodes[0]!;
                  const captured=inlineScope(snapshot)?snapshot.nodes.find(node=>node.id===selected.id):
                    (await evidence.records(project,snapshot.id,[selected.id]).catch(error=>{if(error instanceof ServiceError&&error.code==='NOT_FOUND')return [];throw error;}))[0];
                  if(!captured)throw new ServiceError('SOURCE_OUTSIDE_CAPTURE','The selected node is outside this captured scope. Capture that scope separately before reviewing it.',409);
                  if(selected.name!==captured.name||selected.type!==captured.type||!isDeepStrictEqual(selected.bbox,captured.bbox))throw new ServiceError('SOURCE_METADATA_CHANGED','Selected node metadata changed since capture. Capture a new scope before adding it.',409);
                  const latest=await store.get(id);
                  checkActive();
                  if(latest.revision!==selectedInput.expectedRevision)throw new ServiceError('REVISION_CONFLICT','Project changed while reading the Figma selection. Reload before adding it.',409);
                  // This validates selection identity/name/type/BBox only, not live text or a
                  // Figma document revision. The caller stages this reference in its draft;
                  // this read endpoint never mutates captures, annotations or approvals.
                  json(response,200,{projectId:id,revision:latest.revision,annotationId:annotation.id,
                    snapshotId:snapshot.id,sessionId:selectedInput.expectedSessionId,selected,
                    sourceRef:{snapshotId:snapshot.id,nodeId:selected.id,matchType:'partial'}});
                } finally {response.off('close',onClose);}return;
              }
              if(action==='nodes'){
                const selected=z.object({snapshotId:z.string().min(1).max(160),nodeIds:z.array(z.string().min(1).max(160)).min(1).max(100)}).strict().parse(input);
                const project=await store.get(id),snapshot=sourceScope(project,selected.snapshotId);
                if(!snapshot)throw new ServiceError('NOT_FOUND','Captured scope not found.',404);
                const nodes=await evidence.records(project,snapshot.id,[...new Set(selected.nodeIds)]);
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
                const abort=new AbortController();const onClose=()=>{if(!response.writableEnded)abort.abort();};response.on('close',onClose);
                try {
                  if(response.destroyed||request.aborted)abort.abort();
                  if(abort.signal.aborted)throw new ServiceError('CANCELLED','Plugin request cancelled.',499);
                  const project=await store.get(id);
                  if(abort.signal.aborted)throw new ServiceError('CANCELLED','Plugin request cancelled.',499);
                  if(project.revision!==capture.expectedRevision)throw new ServiceError('REVISION_CONFLICT','Project changed; reload before capture.',409);
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
      else if(error instanceof DomainError){const status=error.code==='NOT_FOUND'?404:error.code==='CAPTURE_BUNDLE_LIMIT'?413:error.code.includes('STALE')||error.code.includes('CONFLICT')||['SOURCE_INCOMPLETE','SOURCE_RESOLUTION_REQUIRED'].includes(error.code)?409:error.code==='FORBIDDEN'?403:400;json(response,status,{error:{code:error.code,message:error.message}});}
      else json(response,500,{error:{code:'INTERNAL_ERROR',message:'Local operation failed; reload the project to check its latest revision.'}});
    }
  };
  const server=createServer(handler);
  const desktopServer=tlsIdentity?createHttpsServer({key:tlsIdentity.key,cert:tlsIdentity.cert,minVersion:'TLSv1.2'},handler):null;
  server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  if(desktopServer){desktopServer.requestTimeout=30000;desktopServer.headersTimeout=10000;desktopServer.keepAliveTimeout=5000;}
  const sockets=new WebSocketServer({noServer:true,maxPayload:BRIDGE_MAX_WIRE_BYTES,perMessageDeflate:false});
  sockets.on('connection',(socket,request)=>broker.attach(socket,{address:request.socket.localAddress,port:request.socket.localPort}));
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
    if(desktopServer)await new Promise<void>((resolveListen,reject)=>{desktopServer.once('error',reject);desktopServer.listen(options.desktopTlsPort,'127.0.0.1',()=>{desktopServer.off('error',reject);resolveListen();});});
  } catch(error){broker.close();sockets.close();server.closeAllConnections();server.close();desktopServer?.closeAllConnections();desktopServer?.close();throw error;}
  const address=server.address();if(!address||typeof address==='string')throw new Error('Loopback address unavailable.');port=address.port;
  const desktopAddress=desktopServer?.address();
  const desktopUrl=desktopAddress&&typeof desktopAddress!=='string'?`https://127.0.0.1:${desktopAddress.port}`:null;
  let shutdown:Promise<void>|undefined;
  return {url:`http://127.0.0.1:${port}`,desktopUrl,token,store,broker,evidence,collections,selective,acquisitions,transfers,
    close(){
      if(!shutdown){
        const stopped=Promise.all([acquisitions.close(),collections.close(),selective.close(),transfers.close()]);broker.close();sockets.close();server.closeAllConnections();
        desktopServer?.closeAllConnections();
        shutdown=Promise.all([stopped,new Promise<void>((done,error)=>server.close(e=>e?error(e):done())),
          ...(desktopServer?[new Promise<void>((done,error)=>desktopServer.close(e=>e?error(e):done()))]:[])]).then(()=>{});
      }
      return shutdown;
    },
  };
}
