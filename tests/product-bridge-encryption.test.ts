import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createDecipheriv, hkdfSync } from 'node:crypto';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { BridgeChannel, BRIDGE_PROTOCOL, BRIDGE_MAX_WIRE_BYTES, BRIDGE_MAX_PLAINTEXT_BYTES, bridgeTranscript,
  bridgeProof, bridgeNonce } from '../src/shared/bridge-auth.js';
import { BridgeClient, type SocketLike } from '../src/figma/bridge-client.js';
import { PluginBroker } from '../src/server/broker.js';
import { challengeFor } from './bridge-auth-helper.js';

const token='synthetic-encrypted-bridge-token-32-characters';
function pair() {
  const transcript=challengeFor({clientId:'synthetic-client',clientNonce:bridgeNonce()},token);
  return {transcript,server:new BridgeChannel(token,transcript,'server'),plugin:new BridgeChannel(token,transcript,'plugin')};
}
function tamper(wire:string):string {
  const frame=JSON.parse(wire);const bytes=Buffer.from(frame.ciphertext,'base64');bytes[0]!^=1;
  return JSON.stringify({...frame,ciphertext:bytes.toString('base64')});
}
test('encrypted records match independent Node HKDF and ChaCha20-Poly1305 with session AAD',()=>{
  const {transcript,plugin}=pair(),plaintext=JSON.stringify({type:'response',text:'Private source 한글'}),wire=plugin.seal(plaintext),frame=JSON.parse(wire);
  assert.ok(!wire.includes('Private source'));assert.ok(!wire.includes(token));
  const salt=createHash('sha256').update(bridgeTranscript('channel-keys',transcript)).digest();
  const key=hkdfSync('sha256',Buffer.from(token),salt,Buffer.from(`${BRIDGE_PROTOCOL}:plugin-to-server:chacha20-poly1305`),32);
  const decipher=createDecipheriv('chacha20-poly1305',Buffer.from(key),Buffer.alloc(12),{authTagLength:16});
  decipher.setAAD(Buffer.from(JSON.stringify([BRIDGE_PROTOCOL,'record','plugin-to-server',transcript.sessionId,0])),{plaintextLength:Buffer.byteLength(plaintext)});
  const ciphertext=Buffer.from(frame.ciphertext,'base64');decipher.setAuthTag(ciphertext.subarray(-16));
  assert.equal(Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]).toString(),plaintext);
});
for(const direction of ['server','plugin'] as const) {
  test(`${direction} records reject modification, replay, reflection, wrong keys and cross-session copies`,()=>{
    const senderRole=direction,receiverRole=direction==='server'?'plugin':'server';
    for(const attack of ['ciphertext','sequence','session','protocol','base64','reflection','wrong-key','cross-session','plaintext','replay','skip'] as const) {
      const initial=pair(),sender=initial[senderRole];
      let receiver=initial[receiverRole],wire=sender.seal(JSON.stringify({type:'ping',data:'private-source'}));
      if(attack==='ciphertext')wire=tamper(wire);
      if(attack==='sequence')wire=JSON.stringify({...JSON.parse(wire),sequence:5});
      if(attack==='session')wire=JSON.stringify({...JSON.parse(wire),sessionId:bridgeNonce()});
      if(attack==='protocol')wire=JSON.stringify({...JSON.parse(wire),protocol:'fsb-bridge-v2'});
      if(attack==='base64')wire=JSON.stringify({...JSON.parse(wire),ciphertext:JSON.parse(wire).ciphertext+'\n'});
      if(attack==='reflection')receiver=initial[senderRole];
      if(attack==='wrong-key')receiver=new BridgeChannel('wrong-synthetic-key',initial.transcript,receiverRole);
      if(attack==='cross-session')receiver=pair()[receiverRole];
      if(attack==='plaintext')wire=JSON.stringify({type:'ping'});
      if(attack==='replay')assert.deepEqual(receiver.open(wire),{type:'ping',data:'private-source'});
      if(attack==='skip')wire=sender.seal(JSON.stringify({type:'ping',data:'second'}));
      assert.throws(()=>receiver.open(wire),attack);
      assert.throws(()=>receiver.open(sender.seal(JSON.stringify({type:'ping'}))),`${attack} poisons the channel`);
    }
  });
}
test('strict directional sequences use different nonces and fail closed at counter exhaustion',()=>{
  const {plugin,server}=pair();
  const first=plugin.seal('{}'),second=plugin.seal('{}');
  assert.notEqual(JSON.parse(first).ciphertext,JSON.parse(second).ciphertext);
  assert.deepEqual(server.open(first),{});assert.deepEqual(server.open(second),{});
  assert.equal(JSON.parse(second).sequence,1);
  (plugin as unknown as {sent:number}).sent=0x100000000;
  assert.throws(()=>plugin.seal('{}'),/exhausted/);
});
test('encrypted transport retains 16 MB source budget and non-ASCII command compatibility',()=>{
  const {plugin,server}=pair(),plaintext='"'+'x'.repeat(BRIDGE_MAX_PLAINTEXT_BYTES-2)+'"';
  const wire=plugin.seal(plaintext);assert.ok(Buffer.byteLength(wire)<=BRIDGE_MAX_WIRE_BYTES);
  assert.equal((server.open(wire) as string).length,BRIDGE_MAX_PLAINTEXT_BYTES-2);
  const second=pair();assert.throws(()=>second.plugin.seal('"'+'x'.repeat(BRIDGE_MAX_PLAINTEXT_BYTES)+'"'),/limit/);
  const unicode=JSON.stringify({type:'request',text:'한'.repeat(20000)});
  const third=pair();assert.ok(Buffer.byteLength(unicode)>32768);assert.deepEqual(third.plugin.open(third.server.seal(unicode)),JSON.parse(unicode));
});
test('plugin rejects plaintext post-welcome commands instead of forwarding them to Figma',()=>{
  let reads=0;const sent:string[]=[];
  const socket:SocketLike={readyState:1,onopen:null,onmessage:null,onclose:null,onerror:null,send:wire=>sent.push(wire),
    close(code=1000){this.readyState=3;this.onclose?.({code});}};
  const client=new BridgeClient({clientId:'synthetic-client',socketFactory:()=>socket,onRequest:()=>{reads++;},onCancel:()=>{},onState:()=>{}});
  try {
    client.start(token);socket.onopen?.({});const challenge=challengeFor(JSON.parse(sent[0]!),token);
    socket.onmessage?.({data:JSON.stringify(challenge)});
    socket.onmessage?.({data:JSON.stringify({type:'welcome',protocol:BRIDGE_PROTOCOL,sessionId:challenge.sessionId,proof:bridgeProof(token,'server-welcome',challenge)})});
    socket.onmessage?.({data:JSON.stringify({type:'request',requestId:'forged',command:{type:'get_selection'}})});
    assert.equal(reads,0);assert.equal(socket.readyState,3);
  } finally {client.stop();}
});

for(const altered of ['server-to-plugin','plugin-to-server'] as const) {
  test(`actual IPv6 relay cannot read source or forge ${altered} encrypted records`,{timeout:10000},async t=>{
    const genuine=new WebSocketServer({host:'127.0.0.1',port:0}),broker=new PluginBroker(token),upstreams:WebSocket[]=[];
    let rogue:WebSocketServer|undefined,client:BridgeClient|undefined,reads=0,corrupt=false;
    const observed:string[]=[];
    t.after(async()=>{
      client?.stop();broker.close();for(const socket of upstreams)socket.terminate();
      for(const server of [genuine,rogue])if(server)for(const socket of server.clients)socket.terminate();
      await Promise.all([genuine,rogue].filter((server):server is WebSocketServer=>!!server).map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));
    });
    await once(genuine,'listening');const port=(genuine.address() as AddressInfo).port;
    genuine.on('connection',(socket,request)=>broker.attach(socket,{address:request.socket.localAddress,port:request.socket.localPort}));
    rogue=new WebSocketServer({host:'::1',port});await once(rogue,'listening');
    rogue.on('connection',socket=>{
      const upstream=new WebSocket(`ws://127.0.0.1:${port}/bridge`);upstreams.push(upstream);
      const queue:string[]=[];
      const forward=(wire:string,direction:typeof altered,target:WebSocket)=>{
        observed.push(wire);const shouldCorrupt=corrupt&&direction===altered&&JSON.parse(wire).type==='sealed';
        if(shouldCorrupt)corrupt=false;
        if(target.readyState===WebSocket.OPEN)target.send(shouldCorrupt?tamper(wire):wire);
      };
      upstream.on('open',()=>{for(const wire of queue)forward(wire,'plugin-to-server',upstream);queue.length=0;});
      socket.on('message',raw=>{if(upstream.readyState===WebSocket.OPEN)forward(raw.toString(),'plugin-to-server',upstream);else queue.push(raw.toString());});
      upstream.on('message',raw=>forward(raw.toString(),'server-to-plugin',socket));
      upstream.on('close',()=>socket.close(1008));socket.on('close',()=>upstream.close());
      upstream.on('error',()=>socket.close(1008));socket.on('error',()=>upstream.close());
    });
    let connected:()=>void=()=>{};const ready=new Promise<void>(resolve=>{connected=resolve;});
    client=new BridgeClient({clientId:'relay-victim',endpoint:`ws://localhost:${port}/bridge`,
      socketFactory:()=>new WebSocket(`ws://[::1]:${port}/bridge`) as unknown as SocketLike,
      onState:state=>{if(state==='connected')connected();},onCancel:()=>{},onRequest:(request,generation)=>{
        reads++;client!.complete({type:'response',requestId:request.requestId,ok:true,result:request.command.type==='highlight_nodes'?
          {highlightedNodeIds:['private-node-secret']}:{fileKey:'private-file-secret',pageId:'private-page',nodes:[{id:'node',name:'PRIVATE_SOURCE_TEXT',type:'TEXT',bbox:null}]}},generation);
      }});
    client.start(token);await ready;
    assert.deepEqual(await broker.request({type:'highlight_nodes',fileKey:'private-file-secret',pageId:'private-page',nodeIds:['private-node-secret']}),{highlightedNodeIds:['private-node-secret']});
    const selection=await broker.request({type:'get_selection'}) as {nodes:Array<{name:string}>};assert.equal(selection.nodes[0]!.name,'PRIVATE_SOURCE_TEXT');
    assert.ok(observed.some(wire=>JSON.parse(wire).type==='sealed'));
    for(const secret of [token,'private-node-secret','private-file-secret','PRIVATE_SOURCE_TEXT'])assert.ok(observed.every(wire=>!wire.includes(secret)),secret);
    const before=reads;corrupt=true;
    await assert.rejects(broker.request({type:'get_selection'},{timeoutMs:2000}),/disconnect/);
    assert.equal(reads,altered==='server-to-plugin'?before:before+1);
    assert.equal(broker.status.connected,false);
  });
}
