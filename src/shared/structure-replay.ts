import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { z } from 'zod';
import type { StructureChunk } from './structure-collection.js';

// No runtime contracts.ts dependency: the command schema imports this module.
const Id = z.string().min(1).max(160);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const StructureReplayHintSchema = z.object({
  nodeCount: z.number().int().min(1).max(500), contentHash: Hash,
}).strict();
export type StructureReplayHint = z.infer<typeof StructureReplayHintSchema>;
export const StructureReplayResultSchema = z.object({
  kind: z.literal('unchanged-structure-chunk'),
  collectionId: Id, sequence: z.number().int().min(0).max(1_000_000),
  fileKey: Id, pageId: Id, rootId: Id,
  startedAt: z.string().datetime(), observedAt: z.string().datetime(),
  nodeCount: z.number().int().min(1).max(500), contentHash: Hash,
  complete: z.boolean(), nextSequence: z.number().int().min(1).max(1_000_000).nullable(),
  consistency: z.literal('live-session-observation'),
}).strict().superRefine((value, context) => {
  if (value.nextSequence !== (value.complete ? null : value.sequence + 1) ||
      Date.parse(value.observedAt) < Date.parse(value.startedAt))
    context.addIssue({ code: 'custom', message: 'Replay sequence or observation interval is invalid.' });
});
export type StructureReplayResult = z.infer<typeof StructureReplayResultSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const result:Record<string,unknown>={};
    for(const key of Object.keys(value).sort()){
      const item=(value as Record<string,unknown>)[key];
      if(item!==undefined)Object.defineProperty(result,key,{value:canonical(item),enumerable:true});
    }
    return result;
  }
  return value;
}

/** Figma's main sandbox need not provide the browser TextEncoder API. */
function utf8(value:string):Uint8Array {
  const bytes=new Uint8Array(value.length*3);let offset=0;
  for(let i=0;i<value.length;i++){
    let code=value.charCodeAt(i);
    if(code>=0xd800&&code<=0xdbff){
      const next=value.charCodeAt(i+1);
      if(next>=0xdc00&&next<=0xdfff){code=0x10000+((code-0xd800)<<10)+next-0xdc00;i++;}
      else code=0xfffd;
    }else if(code>=0xdc00&&code<=0xdfff)code=0xfffd;
    if(code<0x80)bytes[offset++]=code;
    else if(code<0x800){bytes[offset++]=0xc0|(code>>6);bytes[offset++]=0x80|(code&63);}
    else if(code<0x10000){bytes[offset++]=0xe0|(code>>12);bytes[offset++]=0x80|((code>>6)&63);bytes[offset++]=0x80|(code&63);}
    else{bytes[offset++]=0xf0|(code>>18);bytes[offset++]=0x80|((code>>12)&63);bytes[offset++]=0x80|((code>>6)&63);bytes[offset++]=0x80|(code&63);}
  }
  return bytes.subarray(0,offset);
}

/** Exact observed payload equality, never evidence that unobserved Figma data is unchanged. */
export function structureChunkContentHash(chunk: StructureChunk): string {
  const { collectionId: _id, sequence: _sequence, startedAt: _start, observedAt: _end,
    nextSequence: _next, ...payload } = chunk;
  return bytesToHex(sha256(utf8(JSON.stringify(['fsb-structure-payload-v1', canonical(payload)]))));
}

/** Call only after a fresh bounded traversal has actually produced this packet. */
export function compactStructureChunk(chunk: StructureChunk, rawHint?: StructureReplayHint): StructureChunk | StructureReplayResult {
  if (!rawHint) return chunk;
  const hint = StructureReplayHintSchema.parse(rawHint);
  if (hint.nodeCount !== chunk.nodes.length) return chunk;
  const contentHash = structureChunkContentHash(chunk);
  if (contentHash !== hint.contentHash) return chunk;
  return StructureReplayResultSchema.parse({ kind: 'unchanged-structure-chunk',
    collectionId: chunk.collectionId, sequence: chunk.sequence,
    fileKey: chunk.fileKey, pageId: chunk.pageId, rootId: chunk.root.id,
    startedAt: chunk.startedAt, observedAt: chunk.observedAt, nodeCount: chunk.nodes.length,
    contentHash, complete: chunk.complete, nextSequence: chunk.nextSequence, consistency: chunk.consistency });
}

/** Caller must first load the previous packet through its integrity-checked store. */
export function restoreReplayedStructureChunk(previous: StructureChunk, rawReceipt: StructureReplayResult): StructureChunk {
  const receipt = StructureReplayResultSchema.parse(rawReceipt);
  if (structureChunkContentHash(previous) !== receipt.contentHash || previous.nodes.length !== receipt.nodeCount ||
      previous.fileKey !== receipt.fileKey || previous.pageId !== receipt.pageId || previous.root.id !== receipt.rootId ||
      previous.complete !== receipt.complete || previous.consistency !== receipt.consistency)
    throw new Error('Replayed source payload does not match its verified previous observation.');
  return { ...previous, collectionId: receipt.collectionId, sequence: receipt.sequence,
    startedAt: receipt.startedAt, observedAt: receipt.observedAt,
    nextSequence: receipt.nextSequence, complete: receipt.complete };
}
