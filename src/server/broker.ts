import { randomUUID, timingSafeEqual } from 'node:crypto';
import WebSocket from 'ws';
import { z } from 'zod';
import { NodePreviewResultSchema, PluginCommandSchema, PluginResponseSchema, SelectionSchema, SnapshotSchema, type PluginCommand } from '../shared/contracts.js';
import { validateNodePreview, validatePreview } from './preview.js';
import { ServiceError } from './errors.js';

const HelloSchema=z.object({type:z.literal('hello'),token:z.string().min(32).max(1024),clientId:z.string().min(1).max(160)}).strict();
const HighlightSchema=z.object({highlightedNodeIds:z.array(z.string().min(1).max(160)).max(100)}).strict();
type Pending={command:PluginCommand;resolve:(value:unknown)=>void;reject:(error:Error)=>void;cleanup:()=>void};

export function tokensEqual(actual:string,expected:string):boolean {
  const a=Buffer.from(actual),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}

/** One explicit Figma session. Requests never silently fall through to stale cached source. */
export class PluginBroker {
  private current: {socket:WebSocket;clientId:string;sessionId:string;lastSeen:number}|undefined;
  private pending=new Map<string,Pending>();
  private sockets=new Set<WebSocket>();
  private heartbeat:NodeJS.Timeout;
  constructor(private readonly token:string, private readonly options:{authTimeoutMs?:number;staleAfterMs?:number;maxPending?:number}={}) {
    this.heartbeat=setInterval(()=>{
      if(this.current&&Date.now()-this.current.lastSeen>(this.options.staleAfterMs??45000)) this.current.socket.close(1001,'Heartbeat expired');
    },Math.min(5000,this.options.staleAfterMs??45000));
    this.heartbeat.unref();
  }
  get status() {
    return {connected:!!this.current&&this.current.socket.readyState===WebSocket.OPEN,clientId:this.current?.clientId??null,sessionId:this.current?.sessionId??null,pendingRequests:this.pending.size};
  }
  attach(socket:WebSocket):void {
    this.sockets.add(socket);
    let authenticated=false;
    const timer=setTimeout(()=>socket.close(1008,'Authentication required'),this.options.authTimeoutMs??3000);
    timer.unref();
    socket.on('error',()=>{});
    socket.on('close',()=>{
      clearTimeout(timer);this.sockets.delete(socket);
      if(this.current?.socket===socket){this.current=undefined;this.failPending(new ServiceError('PLUGIN_DISCONNECTED','Figma plugin disconnected.',503));}
    });
    socket.on('message',(data,isBinary)=>{
      if(isBinary){socket.close(1008,'Text JSON required');return;}
      let value:unknown;
      try {value=JSON.parse(data.toString());} catch {socket.close(1008,'Invalid JSON');return;}
      if(!authenticated){
        const parsed=HelloSchema.safeParse(value);
        if(!parsed.success||!tokensEqual(parsed.data.token,this.token)){socket.close(1008,'Invalid authentication');return;}
        clearTimeout(timer);
        if(this.current){const old=this.current.socket;this.current=undefined;this.failPending(new ServiceError('PLUGIN_REPLACED','Figma plugin session replaced.',503));old.close(4001,'Session replaced');}
        authenticated=true;
        this.current={socket,clientId:parsed.data.clientId,sessionId:randomUUID(),lastSeen:Date.now()};
        socket.send(JSON.stringify({type:'welcome',sessionId:this.current.sessionId}));return;
      }
      if(this.current?.socket!==socket){socket.close(1008,'Inactive session');return;}
      this.current.lastSeen=Date.now();
      if(value&&typeof value==='object'&&'type' in value&&value.type==='ping'){socket.send(JSON.stringify({type:'pong'}));return;}
      const parsed=PluginResponseSchema.safeParse(value);
      if(!parsed.success){this.failPending(new ServiceError('INVALID_PLUGIN_RESPONSE','Invalid plugin response.',502));socket.close(1008,'Invalid response');return;}
      const response=parsed.data,pending=this.pending.get(response.requestId);
      if(!pending)return; // Cancelled or timed-out responses cannot complete another request.
      this.pending.delete(response.requestId);pending.cleanup();
      if(!response.ok){pending.reject(new ServiceError('PLUGIN_ERROR',response.error?.message??'Plugin command failed.',502));return;}
      try {
        let result:unknown;
        if(pending.command.type==='get_selection')result=SelectionSchema.parse(response.result);
        else if(pending.command.type==='capture_selection'){result=SnapshotSchema.parse(response.result);validatePreview(result as z.infer<typeof SnapshotSchema>);}
        else if(pending.command.type==='preview_node'){const preview=NodePreviewResultSchema.parse(response.result);validateNodePreview(preview);result=preview;}
        else result=HighlightSchema.parse(response.result);
        pending.resolve(result);
      } catch {pending.reject(new ServiceError('INVALID_PLUGIN_RESPONSE','Invalid result from Figma plugin.',502));}
    });
  }
  request(command:PluginCommand,options:{timeoutMs?:number;signal?:AbortSignal}={}):Promise<unknown> {
    const parsed=PluginCommandSchema.parse(command);
    const session=this.current;
    if(!session||session.socket.readyState!==WebSocket.OPEN)return Promise.reject(new ServiceError('PLUGIN_DISCONNECTED','Figma plugin is disconnected.',503));
    if(options.signal?.aborted)return Promise.reject(new ServiceError('CANCELLED','Plugin request cancelled.',499));
    if(this.pending.size>=(this.options.maxPending??16))return Promise.reject(new ServiceError('PLUGIN_BUSY','Too many pending plugin requests.',429));
    const timeoutMs=options.timeoutMs??20000;
    if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>60000)return Promise.reject(new ServiceError('INVALID_TIMEOUT','Timeout must be between 1 and 60000 ms.'));
    const requestId=randomUUID();
    return new Promise((resolve,reject)=>{
      const cancel=(error:Error)=>{
        const pending=this.pending.get(requestId);if(!pending)return;
        this.pending.delete(requestId);pending.cleanup();
        if(session.socket.readyState===WebSocket.OPEN)session.socket.send(JSON.stringify({type:'cancel',requestId}));
        reject(error);
      };
      const onAbort=()=>cancel(new ServiceError('CANCELLED','Plugin request cancelled.',499));
      const timer=setTimeout(()=>cancel(new ServiceError('PLUGIN_TIMEOUT','Figma plugin request timed out.',504)),timeoutMs);
      const cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);};
      options.signal?.addEventListener('abort',onAbort,{once:true});
      this.pending.set(requestId,{command:parsed,resolve,reject,cleanup});
      session.socket.send(JSON.stringify({type:'request',requestId,command:parsed}),error=>{if(error)cancel(new ServiceError('PLUGIN_DISCONNECTED','Figma plugin disconnected while sending.',503));});
    });
  }
  private failPending(error:Error):void {
    for(const pending of this.pending.values()){pending.cleanup();pending.reject(error);}this.pending.clear();
  }
  close():void {
    clearInterval(this.heartbeat);this.current=undefined;this.failPending(new ServiceError('SERVER_CLOSED','Local server closed.',503));
    for(const socket of this.sockets)socket.terminate();this.sockets.clear();
  }
}
