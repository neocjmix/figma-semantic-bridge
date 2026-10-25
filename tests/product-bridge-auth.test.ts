import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeClient, type SocketLike } from '../src/figma/bridge-client.js';
import { createHmac } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { PluginBroker } from '../src/server/broker.js';
import { BRIDGE_ENDPOINT, BRIDGE_PROTOCOL, bridgeNonce, bridgeProof, bridgeTranscript, expectedBridgeEndpoint } from '../src/shared/bridge-auth.js';
import { challengeFor, welcomeBridgeClient } from './bridge-auth-helper.js';

const token='synthetic-authentication-secret-32-characters';
class Socket implements SocketLike {
  readyState=1;onopen:SocketLike['onopen']=null;onmessage:SocketLike['onmessage']=null;
  onclose:SocketLike['onclose']=null;onerror:SocketLike['onerror']=null;sent:string[]=[];
  send(value:string){this.sent.push(value);}
  close(code=1000){this.readyState=3;this.onclose?.({code});}
  receive(value:unknown){this.onmessage?.({data:JSON.stringify(value)});}
}
test('untrusted listener receives no pairing token and cannot authorize source reads with a welcome',()=>{
  const socket=new Socket();let requests=0;
  const client=new BridgeClient({clientId:'synthetic-client',socketFactory:()=>socket,onRequest:()=>{requests++;},onCancel:()=>{},onState:()=>{}});
  try {
    client.start(token);socket.onopen?.({});
    assert.equal(socket.sent.some(frame=>frame.includes(token)),false);
    socket.receive({type:'welcome',sessionId:'forged'});
    socket.receive({type:'request',requestId:'source-read',command:{type:'get_selection'}});
    assert.equal(requests,0);
  } finally {client.stop();}
});

function clientHarness(t:test.TestContext) {
  const sockets:Socket[]=[],requests:string[]=[],states:string[]=[];
  const scheduled=new Map<number,()=>void>();let timer=0;
  const client=new BridgeClient({clientId:'synthetic-client',socketFactory:()=>{const socket=new Socket();sockets.push(socket);return socket;},
    onRequest:request=>requests.push(request.requestId),onCancel:()=>{},onState:state=>states.push(state),
    schedule:fn=>{scheduled.set(++timer,fn);return timer;},cancelSchedule:id=>{scheduled.delete(id as number);}});
  t.after(()=>client.stop());
  client.start(token);sockets[0]!.onopen?.({});
  return {client,sockets,requests,states,scheduled};
}
test('bundled HMAC matches Node crypto and binds every transcript field and purpose',()=>{
  const challenge=challengeFor({clientId:'synthetic-client',clientNonce:'11'.repeat(32)},token);
  const transcript=bridgeTranscript('server-challenge',challenge);
  assert.equal(transcript,JSON.stringify(['figma-semantic-bridge',BRIDGE_PROTOCOL,'server-challenge',expectedBridgeEndpoint(BRIDGE_ENDPOINT),
    challenge.clientId,challenge.clientNonce,challenge.serverNonce,challenge.sessionId]));
  assert.equal(challenge.proof,createHmac('sha256',token).update(transcript).digest('hex'));
  for(const field of ['endpoint','clientId','clientNonce','serverNonce','sessionId'] as const)
    assert.notEqual(bridgeProof(token,'server-challenge',{...challenge,[field]:challenge[field]+'x'}),challenge.proof);
  assert.notEqual(bridgeProof(token,'client-authentication',challenge),challenge.proof);
  assert.notEqual(bridgeProof(token,'server-welcome',challenge),challenge.proof);
});
for(const attack of ['wrong-key','alias','other-port','client-id','client-nonce','server-nonce','session','reflection'] as const) {
  test(`client rejects ${attack} server proof before sending credentials or accepting commands`,t=>{
    const h=clientHarness(t),socket=h.sockets[0]!;
    const challenge=challengeFor(JSON.parse(socket.sent[0]!),attack==='wrong-key'?'incorrect-synthetic-token-32-characters':token);
    if(attack==='alias')challenge.endpoint='ws://localhost:4177/bridge';
    if(attack==='other-port')challenge.endpoint='ws://127.0.0.1:4178/bridge';
    if(attack==='client-id')challenge.clientId='other-client';
    if(attack==='client-nonce')challenge.clientNonce=bridgeNonce();
    if(attack==='server-nonce')challenge.serverNonce=bridgeNonce();
    if(attack==='session')challenge.sessionId=bridgeNonce();
    if(attack==='reflection')challenge.proof=bridgeProof(token,'client-authentication',challenge);
    // Even a correctly signed alias/other endpoint must not authorize this connection.
    if(attack==='alias'||attack==='other-port')challenge.proof=bridgeProof(token,'server-challenge',challenge);
    socket.receive(challenge);socket.receive({type:'request',requestId:'bad',command:{type:'get_selection'}});
    assert.equal(socket.sent.length,1);assert.deepEqual(h.requests,[]);assert.equal(h.states.at(-1),'disconnected');
    assert.ok(socket.sent.every(frame=>!frame.includes(token)));
  });
}
test('client requires the server completion proof and rejects challenge replay on a new connection',t=>{
  const h=clientHarness(t),first=h.sockets[0]!;
  const challenge=challengeFor(JSON.parse(first.sent[0]!),token);
  first.receive(challenge);
  assert.equal(JSON.parse(first.sent.at(-1)!).type,'authenticate');
  first.receive({type:'welcome',protocol:BRIDGE_PROTOCOL,sessionId:challenge.sessionId,proof:challenge.proof});
  assert.equal(h.states.at(-1),'disconnected');
  h.client.start(token);const second=h.sockets[1]!;second.onopen?.({});
  assert.notEqual(JSON.parse(second.sent[0]!).clientNonce,challenge.clientNonce);
  second.receive(challenge);assert.equal(second.sent.length,1);assert.deepEqual(h.requests,[]);
});
test('stop or restart during handshake discards old proofs and leaves no active timers',t=>{
  const h=clientHarness(t),first=h.sockets[0]!;
  const challenge=challengeFor(JSON.parse(first.sent[0]!),token);
  first.receive(challenge);const staleReceiver=first.onmessage!;
  h.client.stop();assert.equal(h.scheduled.size,0);
  const welcome={type:'welcome',protocol:BRIDGE_PROTOCOL,sessionId:challenge.sessionId,proof:bridgeProof(token,'server-welcome',challenge)};
  staleReceiver({data:JSON.stringify(welcome)});assert.equal(h.states.at(-1),'disconnected');
  h.client.start(token);const second=h.sockets[1]!;second.onopen?.({});
  staleReceiver({data:JSON.stringify(welcome)});assert.equal(h.states.at(-1),'connecting');
  welcomeBridgeClient(second,token);assert.equal(h.states.at(-1),'connected');
  assert.ok([...first.sent,...second.sent].every(frame=>!frame.includes(token)));
});
test('client rejects commands at each incomplete handshake stage and oversized proof frames',t=>{
  for(const stage of ['hello','challenge','oversize']) {
    const h=clientHarness(t),socket=h.sockets[0]!;
    if(stage==='challenge')socket.receive(challengeFor(JSON.parse(socket.sent[0]!),token));
    socket.receive(stage==='oversize'?{type:'challenge',padding:'x'.repeat(4096)}:{type:'request',requestId:'bad',command:{type:'get_selection'}});
    assert.deepEqual(h.requests,[]);assert.equal(h.states.at(-1),'disconnected');
  }
});
test('client handshake timeout closes an unanswered connection',t=>{
  const h=clientHarness(t),socket=h.sockets[0]!;
  const timeout=[...h.scheduled.values()][0]!;timeout();
  assert.equal(socket.readyState,3);assert.deepEqual(h.requests,[]);
});

class BrokerSocket extends EventEmitter {
  readyState=1;sent:string[]=[];
  send(value:string){this.sent.push(value);}
  close(){this.readyState=3;this.emit('close');}
  terminate(){this.close();}
  receive(value:unknown){this.emit('message',Buffer.from(JSON.stringify(value)),false);}
}
function attach(broker:PluginBroker,port=4177) {
  const socket=new BrokerSocket();broker.attach(socket as unknown as WebSocket,{address:'127.0.0.1',port});return socket;
}
function hello(socket:BrokerSocket) {
  socket.receive({type:'hello',protocol:BRIDGE_PROTOCOL,clientId:'synthetic-client',clientNonce:bridgeNonce()});
  return JSON.parse(socket.sent[0]!) as ReturnType<typeof challengeFor>;
}
test('broker consumes socket-bound challenges once and rejects replay, reflection, and raw-token hello',t=>{
  const broker=new PluginBroker(token);t.after(()=>broker.close());
  const first=attach(broker),challenge=hello(first);
  const auth={type:'authenticate',protocol:BRIDGE_PROTOCOL,sessionId:challenge.sessionId,proof:bridgeProof(token,'client-authentication',challenge)};
  const second=attach(broker);const another=hello(second);
  assert.notEqual(another.serverNonce,challenge.serverNonce);assert.notEqual(another.sessionId,challenge.sessionId);
  second.receive(auth);assert.equal(second.readyState,3);assert.equal(broker.status.connected,false);
  first.receive(auth);assert.equal(broker.status.connected,true);
  const reflected=attach(broker),reflection=hello(reflected);
  reflected.receive({type:'authenticate',protocol:BRIDGE_PROTOCOL,sessionId:reflection.sessionId,proof:reflection.proof});
  assert.equal(reflected.readyState,3);assert.equal(broker.status.sessionId,challenge.sessionId);
  const legacy=attach(broker);legacy.receive({type:'hello',token,clientId:'legacy'});
  assert.equal(legacy.sent.length,0);assert.equal(legacy.readyState,3);assert.equal(broker.status.sessionId,challenge.sessionId);
  first.receive(auth);assert.equal(first.readyState,3);assert.equal(broker.status.connected,false);
});
test('broker signs only its actual endpoint and denies endpoint aliases and handshake fields',t=>{
  const broker=new PluginBroker(token);t.after(()=>broker.close());
  const socket=attach(broker,4291),challenge=hello(socket);
  assert.equal(challenge.endpoint,'ws://127.0.0.1:4291/bridge');
  assert.equal(challenge.proof,bridgeProof(token,'server-challenge',challenge));
  const supplied=attach(broker);
  supplied.receive({type:'hello',protocol:BRIDGE_PROTOCOL,clientId:'synthetic-client',clientNonce:bridgeNonce(),endpoint:BRIDGE_ENDPOINT});
  assert.equal(supplied.sent.length,0);assert.equal(supplied.readyState,3);
  const alias=new BrokerSocket();broker.attach(alias as unknown as WebSocket,{address:'::1',port:4177});
  assert.equal(alias.readyState,3);assert.equal(alias.sent.length,0);
});
test('broker rejects late proof after timeout and bounds unauthenticated messages',async t=>{
  const broker=new PluginBroker(token,{authTimeoutMs:10});t.after(()=>broker.close());
  const socket=attach(broker),challenge=hello(socket);
  await new Promise(resolve=>setTimeout(resolve,30));
  socket.receive({type:'authenticate',protocol:BRIDGE_PROTOCOL,sessionId:challenge.sessionId,proof:bridgeProof(token,'client-authentication',challenge)});
  assert.equal(socket.readyState,3);assert.equal(broker.status.connected,false);
  const oversized=attach(broker);oversized.receive({type:'hello',padding:'x'.repeat(4096)});
  assert.equal(oversized.readyState,3);assert.equal(oversized.sent.length,0);
});

test('a real loopback listener cannot relay server proofs from a different bound port', {timeout:5000}, async t=>{
  const broker=new PluginBroker(token),genuine=new WebSocketServer({host:'127.0.0.1',port:0}),rogue=new WebSocketServer({host:'127.0.0.1',port:0});
  const upstreams:WebSocket[]=[];let client:BridgeClient|undefined,reads=0;
  t.after(async()=>{
    client?.stop();broker.close();for(const socket of upstreams)socket.terminate();
    for(const server of [genuine,rogue])for(const socket of server.clients)socket.terminate();
    await Promise.all([genuine,rogue].map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));
  });
  await Promise.all([once(genuine,'listening'),once(rogue,'listening')]);
  genuine.on('connection',(socket,request)=>broker.attach(socket,{address:request.socket.localAddress,port:request.socket.localPort}));
  const genuinePort=(genuine.address() as AddressInfo).port,roguePort=(rogue.address() as AddressInfo).port;
  const captured:string[]=[];
  const rejected=new Promise<void>(resolve=>rogue.on('connection',socket=>{
    socket.on('close',()=>resolve());
    socket.on('message',async raw=>{
      captured.push(raw.toString());
      const upstream=new WebSocket(`ws://127.0.0.1:${genuinePort}/bridge`);upstreams.push(upstream);
      await once(upstream,'open');upstream.on('message',proof=>socket.send(proof.toString()));
      upstream.send(raw.toString());
    });
  }));
  client=new BridgeClient({clientId:'relay-victim',endpoint:`ws://127.0.0.1:${roguePort}/bridge`,
    socketFactory:url=>new WebSocket(url) as unknown as SocketLike,onRequest:()=>{reads++;},onCancel:()=>{},onState:()=>{}});
  client.start(token);await rejected;
  assert.equal(captured.length,1);assert.equal(JSON.parse(captured[0]!).type,'hello');
  assert.ok(captured.every(frame=>!frame.includes(token)));assert.equal(reads,0);assert.equal(broker.status.connected,false);
});
