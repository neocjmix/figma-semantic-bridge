import { PluginRequestSchema, PluginResponseSchema } from '../shared/contracts.js';
import type { z } from 'zod';
import { utf8Bytes } from '../fixture-analysis/index.js';

export type PluginRequest=z.infer<typeof PluginRequestSchema>;
export type PluginResponse=z.infer<typeof PluginResponseSchema>;
export interface SocketLike {
  readyState:number;
  onopen:((event:unknown)=>void)|null;
  onmessage:((event:{data:unknown})=>void)|null;
  onclose:((event:{code:number})=>void)|null;
  onerror:((event:unknown)=>void)|null;
  send(data:string):void;
  close(code?:number,reason?:string):void;
}
export interface BridgeClientOptions {
  socketFactory:(url:string)=>SocketLike;
  clientId:string;
  onRequest:(request:PluginRequest,generation:number)=>void;
  onCancel:(requestId:string,generation:number)=>void;
  onState:(state:'disconnected'|'connecting'|'connected'|'reconnecting',detail:string)=>void;
  now?:()=>number;
  schedule?:(callback:()=>void,delay:number)=>unknown;
  cancelSchedule?:(handle:unknown)=>void;
}

/** Network stays in the UI iframe. The token never reaches canvas code or storage. */
export class BridgeClient {
  private socket:SocketLike|null=null;
  private token='';
  private running=false;
  private authenticated=false;
  private generation=0;
  private retry=0;
  private reconnectTimer:unknown;
  private heartbeatTimer:unknown;
  private handshakeTimer:unknown;
  private lastMessage=0;
  private readonly pending=new Map<string,number>();
  private readonly now:()=>number;
  private readonly schedule:(callback:()=>void,delay:number)=>unknown;
  private readonly cancelSchedule:(handle:unknown)=>void;
  constructor(private readonly options:BridgeClientOptions) {
    this.now=options.now??Date.now;
    this.schedule=options.schedule??((fn,ms)=>setTimeout(fn,ms));
    this.cancelSchedule=options.cancelSchedule??(handle=>clearTimeout(handle as ReturnType<typeof setTimeout>));
  }
  start(token:string) {
    if(token.length<32||token.length>1024)throw new Error('Paste the 32–1024 character pairing token printed by the local server.');
    this.stop();this.token=token;this.running=true;this.retry=0;this.open();
  }
  stop() {
    this.running=false;this.token='';this.authenticated=false;this.generation++;
    for(const timer of [this.reconnectTimer,this.heartbeatTimer,this.handshakeTimer])if(timer!==undefined)this.cancelSchedule(timer);
    this.reconnectTimer=this.heartbeatTimer=this.handshakeTimer=undefined;
    this.cancelPending();const socket=this.socket;this.socket=null;
    if(socket){socket.onclose=null;socket.close(1000,'Plugin disconnected');}
    this.options.onState('disconnected','Disconnected. No source content is being sent.');
  }
  complete(response:PluginResponse,generation:number):boolean {
    const parsed=PluginResponseSchema.safeParse(response);
    if(!parsed.success||!this.authenticated||generation!==this.generation||this.pending.get(response.requestId)!==generation||this.socket?.readyState!==1)return false;
    this.pending.delete(response.requestId);
    let data=JSON.stringify(parsed.data);
    if(utf8Bytes(data)>16_000_000)data=JSON.stringify({type:'response',requestId:response.requestId,ok:false,error:{code:'RESPONSE_TOO_LARGE',message:'The bounded result exceeds the bridge message limit.'}});
    this.socket.send(data);return true;
  }
  private cancelPending() {
    for(const [id,generation] of this.pending)this.options.onCancel(id,generation);
    this.pending.clear();
  }
  private open() {
    if(!this.running)return;
    const generation=++this.generation;
    this.authenticated=false;
    this.options.onState(this.retry?'reconnecting':'connecting',this.retry?'Reconnecting to the local bridge…':'Connecting to the local bridge…');
    let socket:SocketLike;
    try {socket=this.options.socketFactory('ws://localhost:4177/bridge');}
    catch {this.reconnect();return;}
    this.socket=socket;
    const current=()=>this.running&&this.socket===socket&&this.generation===generation;
    socket.onopen=()=>{
      if(!current())return;
      socket.send(JSON.stringify({type:'hello',token:this.token,clientId:this.options.clientId}));
      this.handshakeTimer=this.schedule(()=>{if(current()&&!this.authenticated)socket.close(4000,'Handshake timeout');},4000);
    };
    socket.onmessage=event=>{
      if(!current())return;
      if(typeof event.data!=='string'||event.data.length>32768){socket.close(1008,'Invalid bridge command');return;}
      let message:unknown;
      try {message=JSON.parse(event.data);}catch{socket.close(1008,'Invalid bridge JSON');return;}
      if(!message||typeof message!=='object'||!('type' in message)){socket.close(1008,'Invalid bridge message');return;}
      this.lastMessage=this.now();
      if(!this.authenticated) {
        if(message.type!=='welcome'||!('sessionId' in message)||typeof message.sessionId!=='string'||!message.sessionId){socket.close(1008,'Authentication failed');return;}
        this.authenticated=true;this.retry=0;
        if(this.handshakeTimer!==undefined)this.cancelSchedule(this.handshakeTimer);
        this.options.onState('connected','Connected. Capture a selected container from the local web app.');
        this.heartbeat(generation);return;
      }
      if(message.type==='pong')return;
      if(message.type==='cancel'&&'requestId' in message&&typeof message.requestId==='string') {
        if(this.pending.delete(message.requestId))this.options.onCancel(message.requestId,generation);
        return;
      }
      const request=PluginRequestSchema.safeParse(message);
      if(!request.success){socket.close(1008,'Invalid bridge command');return;}
      if(this.pending.has(request.data.requestId)||this.pending.size>=4){
        socket.send(JSON.stringify({type:'response',requestId:request.data.requestId,ok:false,error:{code:'PLUGIN_BUSY',message:'Too many active requests.'}}));return;
      }
      this.pending.set(request.data.requestId,generation);
      this.options.onRequest(request.data,generation);
    };
    socket.onerror=()=>{if(current())this.options.onState('reconnecting','Local bridge unavailable. Check that the server is running.');};
    socket.onclose=event=>{
      if(!current())return;
      this.authenticated=false;this.socket=null;this.cancelPending();
      for(const timer of [this.heartbeatTimer,this.handshakeTimer])if(timer!==undefined)this.cancelSchedule(timer);
      if(event.code===4001){this.stop();this.options.onState('disconnected','Another plugin connected. Connect explicitly to use this file again.');return;}
      if(event.code===1008){this.stop();this.options.onState('disconnected','Pairing rejected or invalid bridge message. Verify the token and connect again.');return;}
      this.reconnect();
    };
  }
  private reconnect() {
    if(!this.running)return;
    const delay=Math.min(10000,500*2**Math.min(this.retry++,5));
    this.options.onState('reconnecting',`Bridge disconnected. Retrying in ${delay/1000}s…`);
    this.reconnectTimer=this.schedule(()=>this.open(),delay);
  }
  private heartbeat(generation:number) {
    this.heartbeatTimer=this.schedule(()=>{
      if(!this.running||!this.authenticated||generation!==this.generation||this.socket?.readyState!==1)return;
      if(this.now()-this.lastMessage>45000){this.socket.close(4000,'Bridge heartbeat timeout');return;}
      this.socket.send(JSON.stringify({type:'ping'}));this.heartbeat(generation);
    },15000);
  }
}
