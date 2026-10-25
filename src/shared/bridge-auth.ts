import { hmac } from '@noble/hashes/hmac.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';

export const BRIDGE_PROTOCOL='fsb-bridge-v3';
export const BRIDGE_ENDPOINT='ws://localhost:4177/bridge';
export const BRIDGE_MAX_PLAINTEXT_BYTES=16_000_000;
// Preserve the existing 32,768 JavaScript-character command limit, including non-ASCII IDs.
export const BRIDGE_MAX_COMMAND_CHARS=32_768;
export const BRIDGE_MAX_COMMAND_BYTES=BRIDGE_MAX_COMMAND_CHARS*3;
export const BRIDGE_MAX_WIRE_BYTES=Math.ceil((BRIDGE_MAX_PLAINTEXT_BYTES+16)/3)*4+512;
export const BRIDGE_MAX_COMMAND_WIRE_BYTES=Math.ceil((BRIDGE_MAX_COMMAND_BYTES+16)/3)*4+512;
const HexSchema=z.string().regex(/^[a-f0-9]{64}$/);
const ClientIdSchema=z.string().min(1).max(160);
export const BridgeHelloSchema=z.object({type:z.literal('hello'),protocol:z.literal(BRIDGE_PROTOCOL),
  clientId:ClientIdSchema,clientNonce:HexSchema}).strict();
export const BridgeChallengeSchema=z.object({type:z.literal('challenge'),protocol:z.literal(BRIDGE_PROTOCOL),
  endpoint:z.string().max(100),clientId:ClientIdSchema,clientNonce:HexSchema,serverNonce:HexSchema,
  sessionId:HexSchema,proof:HexSchema}).strict();
export const BridgeAuthenticateSchema=z.object({type:z.literal('authenticate'),protocol:z.literal(BRIDGE_PROTOCOL),
  sessionId:HexSchema,proof:HexSchema}).strict();
export const BridgeWelcomeSchema=z.object({type:z.literal('welcome'),protocol:z.literal(BRIDGE_PROTOCOL),
  sessionId:HexSchema,proof:HexSchema}).strict();
export type BridgeChallenge=z.infer<typeof BridgeChallengeSchema>;
export type BridgeTranscript=Omit<BridgeChallenge,'type'|'proof'>;
export type BridgeProofPurpose='server-challenge'|'client-authentication'|'server-welcome'|'channel-keys';

/** Caller-owned endpoint only. Neither a Host header nor a handshake supplies it. */
export function bridgeEndpoint(address:string|undefined,port:number|undefined):string {
  if(address!=='127.0.0.1'||port===undefined||!Number.isInteger(port)||port<1||port>65535)throw new Error('Bridge requires a bound IPv4 loopback endpoint.');
  return `ws://127.0.0.1:${port}/bridge`;
}
export function validBridgeEndpoint(value:string):boolean {
  try {expectedBridgeEndpoint(value);return true;} catch {return false;}
}
/** Manifest-compatible localhost resolves to the separately authenticated IPv4 service identity. */
export function expectedBridgeEndpoint(value:string):string {
  const match=value.match(/^ws:\/\/(?:localhost|127\.0\.0\.1):([1-9]\d{0,4})\/bridge$/);
  if(!match)throw new Error('Invalid bridge endpoint.');
  return bridgeEndpoint('127.0.0.1',Number(match[1]));
}
export function bridgeNonce():string {return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));}
export function bridgeTranscript(purpose:BridgeProofPurpose,value:BridgeTranscript):string {
  return JSON.stringify(['figma-semantic-bridge',BRIDGE_PROTOCOL,purpose,value.endpoint,value.clientId,
    value.clientNonce,value.serverNonce,value.sessionId]);
}
/** Bundled HMAC/SHA-256; no crypto.subtle/secure-context requirement in Figma's iframe. */
export function bridgeProof(token:string,purpose:BridgeProofPurpose,value:BridgeTranscript):string {
  return bytesToHex(hmac(sha256,utf8ToBytes(token),utf8ToBytes(bridgeTranscript(purpose,value))));
}
export function bridgeProofEqual(actual:string,expected:string):boolean {
  if(!/^[a-f0-9]{64}$/.test(actual)||!/^[a-f0-9]{64}$/.test(expected))return false;
  let difference=0;for(let i=0;i<64;i++)difference|=actual.charCodeAt(i)^expected.charCodeAt(i);
  return difference===0;
}

const CipherFrameSchema=z.object({type:z.literal('sealed'),protocol:z.literal(BRIDGE_PROTOCOL),sessionId:HexSchema,
  sequence:z.number().int().min(0).max(0xffffffff),ciphertext:z.string().max(BRIDGE_MAX_WIRE_BYTES)}).strict();
type Direction='server-to-plugin'|'plugin-to-server';
function base64(bytes:Uint8Array):string {
  let value='';for(let offset=0;offset<bytes.length;offset+=0x8000)value+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  return btoa(value);
}
function unbase64(value:string,maxBytes:number):Uint8Array {
  if(value.length>Math.ceil(maxBytes/3)*4)throw new Error('Encrypted bridge record exceeds its limit.');
  const binary=atob(value);
  if(binary.length>maxBytes)throw new Error('Encrypted bridge record exceeds its limit.');
  const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  if(base64(bytes)!==value)throw new Error('Encrypted bridge record is not canonical base64.');
  return bytes;
}
/** Every post-handshake application message is sealed, ordered and bound to one direction/session. */
export class BridgeChannel {
  private readonly outboundKey:Uint8Array;
  private readonly inboundKey:Uint8Array;
  private readonly outgoing:Direction;
  private readonly incoming:Direction;
  private sent=0;
  private received=0;
  private failed=false;
  private readonly sendLimit:number;
  private readonly receiveLimit:number;
  constructor(token:string,private readonly transcript:BridgeTranscript,role:'server'|'plugin') {
    const salt=sha256(utf8ToBytes(bridgeTranscript('channel-keys',transcript)));
    this.outgoing=role==='server'?'server-to-plugin':'plugin-to-server';
    this.incoming=role==='server'?'plugin-to-server':'server-to-plugin';
    const derive=(direction:Direction)=>hkdf(sha256,utf8ToBytes(token),salt,utf8ToBytes(`${BRIDGE_PROTOCOL}:${direction}:chacha20-poly1305`),32);
    this.outboundKey=derive(this.outgoing);this.inboundKey=derive(this.incoming);
    this.sendLimit=role==='server'?BRIDGE_MAX_COMMAND_BYTES:BRIDGE_MAX_PLAINTEXT_BYTES;
    this.receiveLimit=role==='server'?BRIDGE_MAX_PLAINTEXT_BYTES:BRIDGE_MAX_COMMAND_BYTES;
  }
  private nonce(sequence:number):Uint8Array {
    const nonce=new Uint8Array(12);new DataView(nonce.buffer).setUint32(8,sequence,false);return nonce;
  }
  private aad(direction:Direction,sequence:number):Uint8Array {
    return utf8ToBytes(JSON.stringify([BRIDGE_PROTOCOL,'record',direction,this.transcript.sessionId,sequence]));
  }
  seal(plaintext:string):string {
    try {
      if(this.failed||this.sent>0xffffffff)throw new Error('Encrypted bridge channel is exhausted or closed.');
      const bytes=utf8ToBytes(plaintext);
      if(bytes.length>this.sendLimit||(this.outgoing==='server-to-plugin'&&plaintext.length>BRIDGE_MAX_COMMAND_CHARS))throw new Error('Bridge plaintext exceeds its limit.');
      const sequence=this.sent++,ciphertext=chacha20poly1305(this.outboundKey,this.nonce(sequence),this.aad(this.outgoing,sequence)).encrypt(bytes);
      return JSON.stringify({type:'sealed',protocol:BRIDGE_PROTOCOL,sessionId:this.transcript.sessionId,sequence,ciphertext:base64(ciphertext)});
    } catch(error){this.destroy();throw error;}
  }
  open(wire:string):unknown {
    try {
      if(this.failed||wire.length>Math.ceil((this.receiveLimit+16)/3)*4+512)throw new Error('Invalid encrypted bridge record.');
      const frame=CipherFrameSchema.parse(JSON.parse(wire));
      if(frame.sessionId!==this.transcript.sessionId||frame.sequence!==this.received||this.received>0xffffffff)throw new Error('Unexpected encrypted bridge sequence or session.');
      const ciphertext=unbase64(frame.ciphertext,this.receiveLimit+16);
      const plaintext=chacha20poly1305(this.inboundKey,this.nonce(frame.sequence),this.aad(this.incoming,frame.sequence)).decrypt(ciphertext);
      if(plaintext.length>this.receiveLimit)throw new Error('Bridge plaintext exceeds its limit.');
      const text=new TextDecoder('utf-8',{fatal:true}).decode(plaintext);
      if(this.incoming==='server-to-plugin'&&text.length>BRIDGE_MAX_COMMAND_CHARS)throw new Error('Bridge command exceeds its limit.');
      const value:unknown=JSON.parse(text);
      this.received++;return value;
    } catch(error){this.destroy();throw error;}
  }
  destroy():void {this.failed=true;this.outboundKey.fill(0);this.inboundKey.fill(0);}
}
