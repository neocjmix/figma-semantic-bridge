import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { StructureReader } from '../src/figma/structure-reader.js';
import { compactStructureChunk, restoreReplayedStructureChunk, structureChunkContentHash,
  StructureReplayResultSchema } from '../src/shared/structure-replay.js';
import type { StructureChunk } from '../src/shared/structure-collection.js';
import { earlyTime, fileKey, fixture, laterTime, pageId, rootId, structure } from './recovery-feasibility-fixture.js';

const command = (sequence = 0) => ({ type: 'read_structure_chunk' as const,
  fileKey, pageId, nodeId: rootId, collectionId: 'fresh-collection', sequence });
const replay = (chunk: StructureChunk) => ({ nodeCount: chunk.nodes.length, contentHash: structureChunkContentHash(chunk) });

test('plugin-main hashing matches native UTF-8 without browser encoder or Object.fromEntries',async()=>{
  const prior=(await structure(fixture(1,1)))[0]!;
  prior.nodes[prior.nodes.length-1]!.text='Exact 한글 👩‍💻 e\u0301 \ud800 \udfff\r\n';
  const {collectionId:_id,sequence:_seq,startedAt:_s,observedAt:_o,nextSequence:_n,...payload}=prior;
  const sorted=(value:unknown):unknown=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?
    Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,sorted(v)])):value;
  const expected=createHash('sha256').update(JSON.stringify(['fsb-structure-payload-v1',sorted(payload)]),'utf8').digest('hex');
  const encoder=Object.getOwnPropertyDescriptor(globalThis,'TextEncoder')!,fromEntries=Object.getOwnPropertyDescriptor(Object,'fromEntries')!;
  try{
    Reflect.deleteProperty(globalThis,'TextEncoder');Reflect.deleteProperty(Object,'fromEntries');
    assert.equal(structureChunkContentHash(prior),expected);
    const result=compactStructureChunk(prior,{nodeCount:prior.nodes.length,contentHash:expected});
    assert.ok('kind' in result);
  }finally{Object.defineProperty(globalThis,'TextEncoder',encoder);Object.defineProperty(Object,'fromEntries',fromEntries);}
});

test('unchanged reconnect replay rereads exact native fields and transfers a compact receipt with new times', async t => {
  const f = fixture(), prior = (await structure(f))[0]!, priorBytes = JSON.stringify(prior);
  f.reset();
  const reader = new StructureReader(f.host, { now: () => 0, observedAt: () => laterTime });
  const result = await reader.readChunkWithReplay({ ...command(), replay: replay(prior) });
  assert.ok('kind' in result); assert.equal(result.kind, 'unchanged-structure-chunk');
  assert.equal(f.reads.text, 100); assert.equal(f.reads.children, 11);
  assert.ok(JSON.stringify(result).length < priorBytes.length / 10);
  const restored = restoreReplayedStructureChunk(prior, result);
  assert.deepEqual(restored.nodes, prior.nodes); assert.deepEqual(restored.childCounts, prior.childCounts);
  assert.equal(restored.collectionId, 'fresh-collection'); assert.equal(restored.observedAt, laterTime);
  assert.equal(prior.observedAt, earlyTime); assert.equal(JSON.stringify(prior), priorBytes);
  assert.equal(restored.consistency, 'live-session-observation');
  t.diagnostic(JSON.stringify({ nodes: prior.nodes.length, previousWireBytes: Buffer.byteLength(priorBytes),
    replayWireBytes: Buffer.byteLength(JSON.stringify(result)), actualNativeReads: f.reads }));
  const textReads = f.reads.text;
  assert.deepEqual(await reader.readChunkWithReplay({ ...command(), replay: replay(prior) }), result);
  assert.equal(f.reads.text, textReads, 'Lost acknowledgement replays the same published packet without another traversal');
  reader.clear();
});

test('replay aligns a saved partial packet boundary and continues beyond its former budget', async () => {
  const f = fixture(), prior = (await structure(f, { maxNodes: 56 }))[0]!;
  const reader = new StructureReader(f.host, { now: () => 0, observedAt: () => laterTime });
  const first = await reader.readChunkWithReplay({ ...command(), maxNodes: 200, replay: replay(prior) });
  assert.ok('kind' in first); assert.equal(first.nodeCount, 56); assert.equal(first.complete, false);
  const next = await reader.readChunkWithReplay({ ...command(1), maxNodes: 200 });
  assert.ok('nodes' in next); assert.equal(next.nodes[0]!.id, 'branch-5');
  assert.equal(next.nodes.length, 55); assert.equal(next.complete, true);
  assert.equal(next.startedAt, first.startedAt);
  reader.clear();
});

test('same-name/bounds text, insertion, deletion, moved or reordered nodes prevent stale compact reuse', async () => {
  for (const change of ['text', 'insert', 'delete', 'move', 'reorder', 'empty-text', 'unicode'] as const) {
    const f = fixture(2, 3), prior = (await structure(f))[0]!;
    const a = f.children.get('branch-0')!, b = f.children.get('branch-1')!;
    if (change === 'text') f.setText('text-0-0', 'Different exact text');
    if (change === 'empty-text') f.setText('text-0-0', '');
    if (change === 'unicode') f.setText('text-0-0', 'Exact synthetic text-0-0 𝌆\ntext');
    if (change === 'insert') f.addText('branch-0', 'inserted-text');
    if (change === 'delete') { const removed = a.pop()!; f.byId.delete(removed.id); }
    if (change === 'move') { const moved = a.pop()!; moved.parent = f.byId.get('branch-1')!; b.unshift(moved); }
    if (change === 'reorder') b.reverse();
    const reader = new StructureReader(f.host, { now: () => 0, observedAt: () => laterTime });
    const result = await reader.readChunkWithReplay({ ...command(), replay: replay(prior) });
    assert.ok('nodes' in result, `${change} must send the actual changed fields`);
    assert.notEqual(structureChunkContentHash(result), structureChunkContentHash(prior));
    if (change === 'insert') assert.equal(result.complete, false, 'The old packet length does not silently omit the newly added node');
    reader.clear();
  }
});

test('hash is canonical across object key order but includes provenance, child counts, completeness and warnings', async () => {
  const prior = (await structure(fixture(1, 1)))[0]!;
  const hash = structureChunkContentHash(prior);
  const reordered = Object.fromEntries(Object.entries(prior).reverse()) as StructureChunk;
  reordered.nodes = prior.nodes.map(node => Object.fromEntries(Object.entries(node).reverse()) as typeof node);
  assert.equal(structureChunkContentHash(reordered), hash);
  for (const changed of [
    { ...prior, fileKey: 'another-file' }, { ...prior, pageId: 'another-page' },
    { ...prior, childCounts: [2, ...prior.childCounts.slice(1)] },
    { ...prior, complete: false }, { ...prior, warnings: [...prior.warnings, 'New rendering warning'] },
  ]) assert.notEqual(structureChunkContentHash(changed), hash);
  assert.equal(structureChunkContentHash({ ...prior, collectionId: 'new', sequence: 15,
    startedAt: laterTime, observedAt: laterTime, nextSequence: null }), hash);
});

test('replay reconstruction refuses wrong saved payload, identity, count and malformed sequence', async () => {
  const prior = (await structure(fixture(1, 1)))[0]!;
  const result = compactStructureChunk({ ...prior, collectionId: 'fresh-collection', startedAt: laterTime, observedAt: laterTime }, replay(prior));
  assert.ok('kind' in result);
  assert.throws(() => restoreReplayedStructureChunk({ ...prior, nodes: [] }, result));
  assert.throws(() => restoreReplayedStructureChunk(prior, { ...result, contentHash: '0'.repeat(64) }));
  assert.throws(() => restoreReplayedStructureChunk(prior, { ...result, fileKey: 'wrong' }));
  assert.throws(() => restoreReplayedStructureChunk(prior, { ...result, nodeCount: 1 }));
  assert.equal(StructureReplayResultSchema.safeParse({ ...result, nextSequence: 1 }).success, false);
  assert.equal(StructureReplayResultSchema.safeParse({ ...result, startedAt: laterTime, observedAt: earlyTime }).success, false);
});

test('source-change and cancellation guards apply before compact replay can be published', async () => {
  const f = fixture(), prior = (await structure(f))[0]!;
  let epoch = 0;
  const reader = new StructureReader(f.host, { now: () => 0, getChangeEpoch: () => epoch });
  await assert.rejects(reader.readChunkWithReplay({ ...command(), replay: replay(prior) },
    { yieldControl: async () => { epoch++; } }), { code: 'SOURCE_CHANGED' });
  reader.clear();
  await assert.rejects(reader.readChunkWithReplay({ ...command(), replay: replay(prior) },
    { cancelled: () => true }), { code: 'CANCELLED' });
  assert.equal(f.host.skipInvisibleInstanceChildren, true);
});
