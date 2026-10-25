import assert from 'node:assert/strict';
import { once } from 'node:events';
import type WebSocket from 'ws';
import { BRIDGE_ENDPOINT, BRIDGE_PROTOCOL, BridgeChallengeSchema, BridgeWelcomeSchema, bridgeNonce,
  bridgeProof, expectedBridgeEndpoint, BridgeChannel, type BridgeTranscript } from '../src/shared/bridge-auth.js';

export async function authenticatePluginSocket(socket:WebSocket,token:string,clientId='synthetic-plugin'):Promise<{sessionId:string}> {
  const clientNonce=bridgeNonce(),endpoint=expectedBridgeEndpoint(socket.url);
  const challenged=once(socket,'message',{signal:AbortSignal.timeout(3000)});
  socket.send(JSON.stringify({type:'hello',protocol:BRIDGE_PROTOCOL,clientId,clientNonce}));
  const challenge=BridgeChallengeSchema.parse(JSON.parse((await challenged)[0].toString()));
  assert.equal(challenge.endpoint,endpoint);assert.equal(challenge.clientNonce,clientNonce);assert.equal(challenge.clientId,clientId);
  assert.equal(challenge.proof,bridgeProof(token,'server-challenge',challenge));
  const welcomed=once(socket,'message',{signal:AbortSignal.timeout(3000)});
  socket.send(JSON.stringify({type:'authenticate',protocol:BRIDGE_PROTOCOL,sessionId:challenge.sessionId,
    proof:bridgeProof(token,'client-authentication',challenge)}));
  const welcome=BridgeWelcomeSchema.parse(JSON.parse((await welcomed)[0].toString()));
  assert.equal(welcome.sessionId,challenge.sessionId);assert.equal(welcome.proof,bridgeProof(token,'server-welcome',challenge));
  // Existing emulator callbacks operate on decoded messages; actual socket frames are always AEAD.
  const channel=new BridgeChannel(token,challenge,'plugin'),send=socket.send.bind(socket),emit=socket.emit.bind(socket);
  socket.send=((data:unknown,...args:unknown[])=>Reflect.apply(send,socket,[channel.seal(String(data)),...args])) as WebSocket['send'];
  socket.emit=((event:string|symbol,...args:unknown[])=>{
    if(event==='message')args[0]=Buffer.from(JSON.stringify(channel.open(String(args[0]))));
    return Reflect.apply(emit,socket,[event,...args]) as boolean;
  }) as WebSocket['emit'];
  socket.once('close',()=>channel.destroy());
  return welcome;
}

export function challengeFor(hello:{clientId:string;clientNonce:string},token:string,endpoint=BRIDGE_ENDPOINT) {
  const transcript:BridgeTranscript={protocol:BRIDGE_PROTOCOL,endpoint:expectedBridgeEndpoint(endpoint),clientId:hello.clientId,clientNonce:hello.clientNonce,
    serverNonce:bridgeNonce(),sessionId:bridgeNonce()};
  return {type:'challenge' as const,...transcript,proof:bridgeProof(token,'server-challenge',transcript)};
}
export function welcomeBridgeClient(socket:{sent:string[];send:(value:string)=>void;receive:(value:unknown)=>void},token:string,endpoint=BRIDGE_ENDPOINT) {
  const challenge=challengeFor(JSON.parse(socket.sent[0]!),token,endpoint);
  socket.receive(challenge);
  const auth=JSON.parse(socket.sent.at(-1)!);
  assert.equal(auth.type,'authenticate');assert.equal(auth.proof,bridgeProof(token,'client-authentication',challenge));
  socket.receive({type:'welcome',protocol:BRIDGE_PROTOCOL,sessionId:challenge.sessionId,proof:bridgeProof(token,'server-welcome',challenge)});
  const channel=new BridgeChannel(token,challenge,'server'),send=socket.send.bind(socket),receive=socket.receive.bind(socket);
  socket.send=wire=>send(JSON.stringify(channel.open(wire)));
  socket.receive=value=>receive(JSON.parse(channel.seal(JSON.stringify(value))));
  return challenge;
}
export function authenticateFakePlugin(socket:{sent:string[];send:(value:string)=>void;receive:(value:unknown)=>void},token:string) {
  socket.receive({type:'hello',protocol:BRIDGE_PROTOCOL,clientId:'synthetic-plugin',clientNonce:bridgeNonce()});
  const challenge=BridgeChallengeSchema.parse(JSON.parse(socket.sent.at(-1)!));
  assert.equal(challenge.proof,bridgeProof(token,'server-challenge',challenge));
  socket.receive({type:'authenticate',protocol:BRIDGE_PROTOCOL,sessionId:challenge.sessionId,proof:bridgeProof(token,'client-authentication',challenge)});
  const channel=new BridgeChannel(token,challenge,'plugin'),send=socket.send.bind(socket),receive=socket.receive.bind(socket);
  socket.send=wire=>send(JSON.stringify(channel.open(wire)));
  socket.receive=value=>receive(JSON.parse(channel.seal(JSON.stringify(value))));
}
