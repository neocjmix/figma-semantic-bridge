import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import WebSocket from 'ws';
import { z } from 'zod';
import { NodePreviewResultSchema, PluginCommandSchema, PluginProgressSchema, PluginResponseSchema, SelectionSchema, SnapshotSchema, type PluginCommand } from '../shared/contracts.js';
import { validateNodePreview, validatePreview } from './preview.js';
import { ServiceError } from './errors.js';
import type { DiagnosticLog } from './diagnostics.js';
import { StructureChunkSchema, STRUCTURE_CHUNK_BYTES } from '../shared/structure-collection.js';
import { StructureReplayResultSchema } from '../shared/structure-replay.js';
import { SelectiveNodesResultSchema, SelectiveChildrenResultSchema } from '../shared/selective-source-results.js';
import { SELECTIVE_CHILDREN_WIRE_BYTES, SELECTIVE_NODES_WIRE_BYTES } from '../shared/selective-source.js';
import { BRIDGE_PROTOCOL, BridgeHelloSchema, BridgeAuthenticateSchema, bridgeEndpoint, bridgeProof, BridgeChannel, BRIDGE_MAX_WIRE_BYTES,
  type BridgeTranscript } from '../shared/bridge-auth.js';

const HighlightSchema=z.object({highlightedNodeIds:z.array(z.string().min(1).max(160)).max(100)}).strict();
type Progress=z.infer<typeof PluginProgressSchema>;
type Pending={trace:{requestId?:string;pluginRequestId:string;command:string};command:PluginCommand;resolve:(value:unknown)=>void;reject:(error:Error)=>void;cleanup:()=>void;onProgress?:((progress:Progress)=>void)|undefined};
type Session={socket:WebSocket;clientId:string;sessionId:string;lastSeen:number;channel:BridgeChannel};

export function tokensEqual(actual:string,expected:string):boolean {
  const a=Buffer.from(actual),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}

/** One explicit Figma session. Requests never silently fall through to stale cached source. */
export class PluginBroker {
  private current:Session|undefined;
  private pending=new Map<string,Pending>();
  private sockets=new Set<WebSocket>();
  private heartbeat:NodeJS.Timeout;
  constructor(private readonly token:string, private readonly options:{authTimeoutMs?:number;staleAfterMs?:number;maxPending?:number;diagnostics?:DiagnosticLog}={}) {
    this.heartbeat=setInterval(()=>{
      if(this.current&&Date.now()-this.current.lastSeen>(this.options.staleAfterMs??45000)) this.current.socket.close(1001,'Heartbeat expired');
    },Math.min(5000,this.options.staleAfterMs??45000));
    this.heartbeat.unref();
  }
  get status() {
    return {connected:!!this.current&&this.current.socket.readyState===WebSocket.OPEN,clientId:this.current?.clientId??null,sessionId:this.current?.sessionId??null,pendingRequests:this.pending.size};
  }
  attach(socket:WebSocket,bound:{address:string|undefined;port:number|undefined}):void {
    let endpoint:string;
    try {endpoint=bridgeEndpoint(bound.address,bound.port);}catch {socket.close(1008,'Invalid bound endpoint');return;}
    this.sockets.add(socket);
    let authenticated=false;
    let channel:BridgeChannel|undefined;
    let challenge:BridgeTranscript|undefined;
    let challenged=false,closed=false;
    const timer=setTimeout(()=>socket.close(1008,'Authentication required'),this.options.authTimeoutMs??3000);
    timer.unref();
    socket.on('error',()=>{});
    socket.on('close',()=>{
      closed=true;challenge=undefined;channel?.destroy();
      clearTimeout(timer);this.sockets.delete(socket);
      if(this.current?.socket===socket){this.options.diagnostics?.emit('plugin.disconnected','warn');this.current=undefined;this.failPending(new ServiceError('PLUGIN_DISCONNECTED','Figma plugin disconnected.',503));}
    });
    socket.on('message',(data,isBinary)=>{
      if(closed||socket.readyState!==WebSocket.OPEN)return;
      const messageBytes=Array.isArray(data)?data.reduce((sum,chunk)=>sum+chunk.byteLength,0):data.byteLength;
      if(messageBytes>(authenticated?BRIDGE_MAX_WIRE_BYTES:4096)){socket.close(1008,'Bridge message too large');return;}
      if(isBinary){socket.close(1008,'Text JSON required');return;}
      let value:unknown;
      try {value=authenticated?channel!.open(data.toString()):JSON.parse(data.toString());} catch {socket.close(1008,'Invalid bridge record');return;}
      if(!authenticated){
        if(!challenged) {
          const hello=BridgeHelloSchema.safeParse(value);
          if(!hello.success){socket.close(1008,'Invalid authentication');return;}
          challenged=true;
          challenge={protocol:BRIDGE_PROTOCOL,endpoint,clientId:hello.data.clientId,clientNonce:hello.data.clientNonce,
            serverNonce:randomBytes(32).toString('hex'),sessionId:randomBytes(32).toString('hex')};
          socket.send(JSON.stringify({type:'challenge',...challenge,proof:bridgeProof(this.token,'server-challenge',challenge)}));return;
        }
        const expected=challenge;challenge=undefined; // A challenge is usable exactly once, on this socket.
        const parsed=BridgeAuthenticateSchema.safeParse(value);
        if(!expected||!parsed.success||parsed.data.sessionId!==expected.sessionId||
          !tokensEqual(parsed.data.proof,bridgeProof(this.token,'client-authentication',expected))){socket.close(1008,'Invalid authentication');return;}
        clearTimeout(timer);
        if(this.current){const old=this.current.socket;this.current=undefined;this.failPending(new ServiceError('PLUGIN_REPLACED','Figma plugin session replaced.',503));old.close(4001,'Session replaced');}
        authenticated=true;this.options.diagnostics?.emit('plugin.connected');
        channel=new BridgeChannel(this.token,expected,'server');
        this.current={socket,clientId:expected.clientId,sessionId:expected.sessionId,lastSeen:Date.now(),channel};
        socket.send(JSON.stringify({type:'welcome',protocol:BRIDGE_PROTOCOL,sessionId:expected.sessionId,
          proof:bridgeProof(this.token,'server-welcome',expected)}));return;
      }
      if(this.current?.socket!==socket){socket.close(1008,'Inactive session');return;}
      this.current.lastSeen=Date.now();
      if(value&&typeof value==='object'&&'type' in value&&value.type==='ping'){this.sendRecord(this.current,{type:'pong'});return;}
      if(value&&typeof value==='object'&&'type' in value&&value.type==='progress') {
        const progress=PluginProgressSchema.safeParse(value);
        if(!progress.success){this.options.diagnostics?.error('plugin.error',progress.error,{phase:'progress_validation'});this.failPending(new ServiceError('INVALID_PLUGIN_RESPONSE','Invalid plugin progress.',502));socket.close(1008,'Invalid progress');return;}
        const pending=this.pending.get(progress.data.requestId);
        if(!pending)return;
        const type=pending.command.type;
        const allowed=type==='capture_selection'||((type==='capture_metadata'||type==='read_structure_chunk')&&progress.data.phase==='structure')||((type==='preview_capture'||type==='preview_node')&&progress.data.phase==='preview');
        if(!allowed){this.failPending(new ServiceError('INVALID_PLUGIN_RESPONSE','Unexpected progress for source operation.',502));socket.close(1008,'Unexpected progress');return;}
        pending.onProgress?.(progress.data);return;
      }
      const parsed=PluginResponseSchema.safeParse(value);
      if(!parsed.success){this.options.diagnostics?.error('plugin.error',parsed.error,{phase:'response_validation'});this.failPending(new ServiceError('INVALID_PLUGIN_RESPONSE','Invalid plugin response.',502));socket.close(1008,'Invalid response');return;}
      const response=parsed.data,pending=this.pending.get(response.requestId);
      if(!pending)return; // Cancelled or timed-out responses cannot complete another request.
      this.pending.delete(response.requestId);pending.cleanup();
      if(!response.ok){
        if(['read_structure_chunk','read_source_nodes','read_source_children'].includes(pending.command.type)&&response.error?.code==='PLUGIN_BUSY')
          pending.reject(new ServiceError('PLUGIN_BUSY','Figma is still completing another operation. Retry once it settles.',409));
        else pending.reject(new ServiceError('PLUGIN_ERROR',response.error?.message??'Plugin command failed.',502));
        return;
      }
      try {
        let result:unknown;
        if(pending.command.type==='get_selection')result=SelectionSchema.parse(response.result);
        else if(pending.command.type==='capture_selection'||pending.command.type==='capture_metadata'){result=SnapshotSchema.parse(response.result);validatePreview(result as z.infer<typeof SnapshotSchema>);}
        else if(pending.command.type==='preview_node'){const preview=NodePreviewResultSchema.parse(response.result);validateNodePreview(preview);result=preview;}
        else if(pending.command.type==='preview_capture'){const preview=NodePreviewResultSchema.parse(response.result),settings=pending.command.options;
          validateNodePreview(preview,{dimension:settings?.maxDimension??2048,bytes:settings?.maxBytes??8_000_000,scale:settings?.scale??1});result=preview;}
        else if(pending.command.type==='read_structure_chunk'){
          const replay=pending.command.replay?StructureReplayResultSchema.safeParse(response.result):null;
          if(replay?.success){
            const c=pending.command,r=replay.data;
            if(r.collectionId!==c.collectionId||r.sequence!==c.sequence||r.fileKey!==c.fileKey||r.pageId!==c.pageId||r.rootId!==c.nodeId||
              r.contentHash!==c.replay!.contentHash||r.nodeCount!==c.replay!.nodeCount)throw new Error('Replay receipt does not match the request.');
            result=r;
          }else result=StructureChunkSchema.parse(response.result);
          if(Buffer.byteLength(JSON.stringify(result))>STRUCTURE_CHUNK_BYTES)throw new Error('Chunk exceeds wire byte budget.');
        }
        else if(pending.command.type==='release_structure_cursor'||pending.command.type==='release_source_children')result=z.object({released:z.literal(true)}).strict().parse(response.result);
        else if(pending.command.type==='read_source_nodes'){
          result=SelectiveNodesResultSchema.parse(response.result);
          if(Buffer.byteLength(JSON.stringify(result))>SELECTIVE_NODES_WIRE_BYTES)throw new Error('Selective result exceeds wire budget.');
        }else if(pending.command.type==='read_source_children'){
          result=SelectiveChildrenResultSchema.parse(response.result);
          if(Buffer.byteLength(JSON.stringify(result))>SELECTIVE_CHILDREN_WIRE_BYTES)throw new Error('Child result exceeds wire budget.');
        }
        else result=HighlightSchema.parse(response.result);
        pending.resolve(result);
      } catch(error) {this.options.diagnostics?.error('plugin.error',error,{...pending.trace,phase:'result_validation'});pending.reject(new ServiceError('INVALID_PLUGIN_RESPONSE','Invalid result from Figma plugin.',502));}
    });
  }
  private sendRecord(session:Session,value:unknown,callback?:(error?:Error)=>void):void {
    try {session.socket.send(session.channel.seal(JSON.stringify(value)),callback);}
    catch {session.socket.close(1008,'Invalid encrypted bridge record');callback?.(new Error('Encrypted bridge channel failed.'));}
  }
  request(command:PluginCommand,options:{timeoutMs?:number;signal?:AbortSignal;onProgress?:(progress:Progress)=>void}={}):Promise<unknown> {
    const parsed=PluginCommandSchema.parse(command);
    const session=this.current;
    if(!session||session.socket.readyState!==WebSocket.OPEN)return Promise.reject(new ServiceError('PLUGIN_DISCONNECTED','Figma plugin is disconnected.',503));
    if(options.signal?.aborted)return Promise.reject(new ServiceError('CANCELLED','Plugin request cancelled.',499));
    if(this.pending.size>=(this.options.maxPending??16))return Promise.reject(new ServiceError('PLUGIN_BUSY','Too many pending plugin requests.',429));
    const timeoutMs=options.timeoutMs??20000;
    if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>305000)return Promise.reject(new ServiceError('INVALID_TIMEOUT','Timeout must be between 1 and 305000 ms.'));
    const requestId=randomUUID(),started=performance.now(),log=this.options.diagnostics;
    const trace={...(log?.requestId?{requestId:log.requestId}:{}),pluginRequestId:requestId,command:parsed.type};
    log?.emit('plugin.start','debug',{...trace,timeoutMs,pending:this.pending.size});
    const result=new Promise<unknown>((resolve,reject)=>{
      const cancel=(error:Error)=>{
        const pending=this.pending.get(requestId);if(!pending)return;
        this.pending.delete(requestId);pending.cleanup();
        if(session.socket.readyState===WebSocket.OPEN)this.sendRecord(session,{type:'cancel',requestId});
        reject(error);
      };
      const onAbort=()=>cancel(new ServiceError('CANCELLED','Plugin request cancelled.',499));
      const timer=setTimeout(()=>cancel(new ServiceError('PLUGIN_TIMEOUT','Figma plugin request timed out.',504)),timeoutMs);
      const cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);};
      options.signal?.addEventListener('abort',onAbort,{once:true});
      this.pending.set(requestId,{trace,command:parsed,resolve,reject,cleanup,onProgress:progress=>{log?.emit('plugin.progress','debug',{...trace,phase:progress.phase,nodeCount:progress.nodes,bytes:progress.bytes});options.onProgress?.(progress);}});
      this.sendRecord(session,{type:'request',requestId,command:parsed},error=>{if(error)cancel(new ServiceError('PLUGIN_DISCONNECTED','Figma plugin disconnected while sending.',503));});
    });
    return result.then(value=>{log?.emit('plugin.complete','info',{...trace,durationMs:performance.now()-started});return value;},error=>{log?.error('plugin.error',error,{...trace,durationMs:performance.now()-started});throw error;});
  }
  private failPending(error:Error):void {
    for(const pending of this.pending.values()){pending.cleanup();pending.reject(error);}this.pending.clear();
  }
  close():void {
    clearInterval(this.heartbeat);this.current=undefined;this.failPending(new ServiceError('SERVER_CLOSED','Local server closed.',503));
    for(const socket of this.sockets)socket.terminate();this.sockets.clear();
  }
}
