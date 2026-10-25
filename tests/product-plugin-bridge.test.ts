import { challengeFor, welcomeBridgeClient } from './bridge-auth-helper.js';
import { BRIDGE_PROTOCOL, bridgeProof, BridgeChannel, type BridgeChallenge } from '../src/shared/bridge-auth.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BridgeClient, type PluginRequest, type SocketLike } from '../src/figma/bridge-client.js';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';

class Socket implements SocketLike {
  readyState=0;onopen:SocketLike['onopen']=null;onmessage:SocketLike['onmessage']=null;onclose:SocketLike['onclose']=null;onerror:SocketLike['onerror']=null;
  sent:string[]=[];
  send(data:string){this.sent.push(data);}
  close(code=1000){this.readyState=3;this.onclose?.({code});}
  open(){this.readyState=1;this.onopen?.({});}
  receive(message:unknown){this.onmessage?.({data:JSON.stringify(message)});}
}
function harness() {
  const sockets:Socket[]=[],requests:{request:PluginRequest;generation:number}[]=[],cancelled:string[]=[],states:string[]=[],urls:string[]=[];
  let next=0,time=0;const scheduled=new Map<number,{fn:()=>void;delay:number}>();
  const client=new BridgeClient({clientId:'test-client',socketFactory:url=>{urls.push(url);const socket=new Socket();sockets.push(socket);return socket;},
    onRequest:(request,generation)=>requests.push({request,generation}),onCancel:id=>cancelled.push(id),onState:state=>states.push(state),now:()=>time,
    schedule:(fn,delay)=>{scheduled.set(++next,{fn,delay});return next;},cancelSchedule:handle=>scheduled.delete(handle as number)});
  const advance=(delay:number)=>{time+=delay;const found=[...scheduled].find(([,v])=>v.delay===delay);assert.ok(found);scheduled.delete(found[0]);found[1].fn();};
  return {client,sockets,requests,cancelled,states,scheduled,advance,urls};
}
test('plugin endpoint is permitted by the Desktop development manifest',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../plugins/semantic-bridge/manifest.json',import.meta.url),'utf8'));
  const h=harness();h.client.start('pairing-token-for-tests-32-chars-long');
  assert.deepEqual(h.urls,['ws://localhost:4177/bridge']);
  assert.ok(manifest.networkAccess.devAllowedDomains.includes(new URL(h.urls[0]!).origin));
  assert.deepEqual(manifest.networkAccess.allowedDomains,['none']);h.client.stop();
});
test('pairing token limits match the server at 32 and 1024 characters',()=>{
  const h=harness();
  assert.throws(()=>h.client.start('t'.repeat(31)),/32–1024/);
  assert.throws(()=>h.client.start('t'.repeat(1025)),/32–1024/);
  for(const length of [32,1024]) {
    h.client.start('t'.repeat(length));const socket=h.sockets.at(-1)!;socket.open();
    assert.equal('token' in JSON.parse(socket.sent[0]!),false);welcomeBridgeClient(socket,'t'.repeat(length));h.client.stop();
  }
});
test('iframe bridge authenticates before relaying and discards stale responses after reconnect',()=>{
  const h=harness();h.client.start('pairing-token-for-tests-32-chars-long');const first=h.sockets[0]!;first.open();
  assert.equal('token' in JSON.parse(first.sent[0]!),false);
  welcomeBridgeClient(first,'pairing-token-for-tests-32-chars-long');first.receive({type:'request',requestId:'read-1',command:{type:'get_selection'}});
  const request=h.requests[0]!;assert.ok(request);
  first.close(1006);assert.deepEqual(h.cancelled,['read-1']);h.advance(500);
  const second=h.sockets[1]!;second.open();welcomeBridgeClient(second,'pairing-token-for-tests-32-chars-long');
  assert.equal(h.client.complete({type:'response',requestId:'read-1',ok:true,result:{}},request.generation),false);
  second.receive({type:'request',requestId:'read-2',command:{type:'get_selection'}});
  assert.equal(h.client.complete({type:'response',requestId:'read-2',ok:true,result:{}},h.requests[1]!.generation),true);
  assert.equal(JSON.parse(second.sent.at(-1)!).requestId,'read-2');h.client.stop();
});
test('server cancellation prevents result emission; explicit stop clears timers and credentials',()=>{
  const h=harness();h.client.start('pairing-token-for-tests-32-chars-long');const socket=h.sockets[0]!;socket.open();welcomeBridgeClient(socket,'pairing-token-for-tests-32-chars-long');
  socket.receive({type:'request',requestId:'capture-1',command:{type:'capture_selection',limits:{}}});
  socket.receive({type:'cancel',requestId:'capture-1'});assert.deepEqual(h.cancelled,['capture-1']);
  assert.equal(h.client.complete({type:'response',requestId:'capture-1',ok:true,result:{}},h.requests[0]!.generation),false);
  h.client.stop();assert.equal(h.scheduled.size,0);assert.equal(h.states.at(-1),'disconnected');
});
test('unauthenticated requests are never forwarded and rejected pairing does not retry',()=>{
  const h=harness();h.client.start('pairing-token-for-tests-32-chars-long');const socket=h.sockets[0]!;socket.open();
  socket.receive({type:'request',requestId:'bad',command:{type:'get_selection'}});
  assert.equal(h.requests.length,0);assert.equal(h.scheduled.size,0);assert.equal(h.states.at(-1),'disconnected');
});
test('a replaced plugin stops retrying so two open files cannot repeatedly take control',()=>{
  const h=harness();h.client.start('pairing-token-for-tests-32-chars-long');const socket=h.sockets[0]!;socket.open();welcomeBridgeClient(socket,'pairing-token-for-tests-32-chars-long');
  socket.receive({type:'request',requestId:'old-read',command:{type:'get_selection'}});
  socket.close(4001);
  assert.deepEqual(h.cancelled,['old-read']);assert.equal(h.scheduled.size,0);assert.equal(h.states.at(-1),'disconnected');
  assert.equal(h.client.complete({type:'response',requestId:'old-read',ok:true,result:{}},h.requests[0]!.generation),false);
});

test('bridge client performs an authenticated request/response over actual loopback WebSocket',async(t)=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  const port=(server.address() as AddressInfo).port;
  let client:BridgeClient;
  t.after(async()=>{client?.stop();for(const socket of server.clients)socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  const received=new Promise<unknown>((resolve,reject)=>{
    server.on('connection',socket=>{
      let challenge:BridgeChallenge;let channel:BridgeChannel|undefined;
      socket.on('error',reject);
      socket.on('message',raw=>{
        const value=(channel?channel.open(raw.toString()):JSON.parse(raw.toString())) as {type:string;proof?:string};
        if(value.type==='hello'){
          assert.equal('token' in value,false);
          challenge=challengeFor(value as unknown as {clientId:string;clientNonce:string},'loopback-test-pairing-token-32-chars-long',`ws://127.0.0.1:${port}/bridge`);
          socket.send(JSON.stringify(challenge));
        }else if(value.type==='authenticate'){
          assert.equal(value.proof,bridgeProof('loopback-test-pairing-token-32-chars-long','client-authentication',challenge));
          socket.send(JSON.stringify({type:'welcome',protocol:BRIDGE_PROTOCOL,sessionId:challenge.sessionId,proof:bridgeProof('loopback-test-pairing-token-32-chars-long','server-welcome',challenge)}));
          channel=new BridgeChannel('loopback-test-pairing-token-32-chars-long',challenge,'server');
          socket.send(channel.seal(JSON.stringify({type:'request',requestId:'loopback-read',command:{type:'get_selection'}})));
        }else if(value.type==='response')resolve(value);
      });
    });
  });
  client=new BridgeClient({clientId:'loopback-client',endpoint:`ws://127.0.0.1:${port}/bridge`,socketFactory:url=>new WebSocket(url) as unknown as SocketLike,
    onCancel:()=>{},onState:()=>{},onRequest:(request,generation)=>{client.complete({type:'response',requestId:request.requestId,ok:true,result:{fileKey:null,pageId:'0:1',nodes:[]}},generation);}});
  client.start('loopback-test-pairing-token-32-chars-long');
  assert.deepEqual(await received,{type:'response',requestId:'loopback-read',ok:true,result:{fileKey:null,pageId:'0:1',nodes:[]}});
});
