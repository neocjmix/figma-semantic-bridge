import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollectionStore } from '../src/server/structure-collection-store.js';
import { ServiceError } from '../src/server/errors.js';
import { CollectionEvidenceBranchSchema, CollectionEvidencePageSchema, CollectionEvidenceTextSchema } from '../src/shared/collection-evidence.js';
import type { SourceNode } from '../src/shared/contracts.js';
import type { StructureChunk } from '../src/shared/structure-collection.js';

const time = '2026-10-25T00:00:00.000Z', bounds = { x: -500, y: 800, width: 100, height: 200 };
const source = { fileKey: 'synthetic-file', pageId: 'synthetic-page', nodeId: 'root', name: 'Synthetic root', type: 'FRAME', bounds };
const text = '한글 e\u0301 👩‍💻\r\n\t<&>';
const nodes: SourceNode[] = [
  { id: 'root', parentId: source.pageId, name: source.name, type: 'FRAME', bbox: bounds, visible: true },
  { id: 'a', parentId: 'root', name: 'Closed branch', type: 'FRAME', bbox: bounds, visible: true },
  { id: 'a1', parentId: 'a', name: 'Original text', type: 'TEXT', bbox: bounds, visible: true, text },
  { id: 'a2', parentId: 'a', name: 'Nested branch', type: 'FRAME', bbox: bounds, visible: true },
  { id: 'a21', parentId: 'a2', name: 'Observed empty text', type: 'TEXT', bbox: bounds, visible: true, text: '' },
  { id: 'b', parentId: 'root', name: 'Last sibling', type: 'FRAME', bbox: bounds, visible: true },
].map(node => ({ ...node, sourceFileKey: source.fileKey, sourcePageId: source.pageId, rendering: { opacity: 1 } }));
const counts = [2, 2, 0, 1, 0, 0];
function packet(id: string, start: number, end: number, sequence: number): StructureChunk {
  return { collectionId: id, sequence, root: structuredClone(nodes[0]!), fileKey: source.fileKey, pageId: source.pageId, bounds,
    nodes: structuredClone(nodes.slice(start, end)), childCounts: counts.slice(start, end), startedAt: time,
    observedAt: `2026-10-25T00:00:0${sequence}.000Z`, complete: end === nodes.length, nextSequence: end === nodes.length ? null : sequence + 1,
    warnings: [], consistency: 'live-session-observation' };
}
async function harness(t: test.TestContext) {
  const dataDir = await mkdtemp(join(tmpdir(), 'fsb-partial-evidence-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = new CollectionStore(dataDir); await store.initialize();
  const projectId = randomUUID(), id = randomUUID();
  await store.create({ projectId, id, sessionId: 'synthetic-session', source });
  return { store, dataDir, projectId, id, directory: join(dataDir, 'structure-collections', id),
    async reopen() { const reloaded = new CollectionStore(dataDir); await reloaded.initialize(); return reloaded; } };
}
const fails = (code: string) => (error: unknown) => error instanceof ServiceError && error.code === code;

test('saved partial records remain inspectable after restart without weakening complete-only APIs', async t => {
  const h = await harness(t);
  const empty = await h.store.evidence(h.projectId, h.id, { offset: 0, limit: 200 });
  assert.equal(empty.total, 0); assert.equal(empty.snapshot.scopeComplete, false); assert.equal(empty.snapshot.observedAt, null);
  await h.store.append(h.projectId, h.id, packet(h.id, 0, 3, 0));
  const store = await h.reopen();
  assert.equal(store.get(h.projectId, h.id).status, 'interrupted');
  const page = CollectionEvidencePageSchema.parse(await store.evidence(h.projectId, h.id, { offset: 0, limit: 200 }));
  assert.equal(page.total, 3); assert.equal(page.snapshot.nodeCount, 3); assert.equal(page.snapshot.scopeComplete, false);
  assert.equal(page.coverage, 'observed-records-only'); assert.equal(page.snapshot.freshness, 'not-revalidated');
  assert.deepEqual(page.nodes.map(node => [node.id, node.subtreeComplete, node.observedChildCount, node.declaredChildCount]),
    [['root', false, 1, 2], ['a', false, 1, 2], ['a1', true, 0, 0]]);
  assert.equal(page.nodes[0]!.textAvailable, false); assert.equal(page.nodes[0]!.textLength, null);
  assert.equal(page.nodes[2]!.textLength, text.length); assert.ok(page.nodes.every(node => !('text' in node)));
  await assert.rejects(store.query(h.projectId, h.id, { offset: 0, limit: 200 }), fails('SOURCE_INCOMPLETE'));
  await assert.rejects(store.text(h.projectId, h.id, { nodeId: 'a1', offset: 0, limit: 4000 }), fails('SOURCE_INCOMPLETE'));
  assert.throws(() => store.descriptor(h.projectId, h.id), fails('SOURCE_INCOMPLETE'));
  await assert.rejects(store.records(h.projectId, h.id, ['a1']), fails('SOURCE_INCOMPLETE'));
  await assert.rejects(store.evidence(h.projectId, h.id, { nodeIds: ['b'], offset: 0, limit: 200 }), fails('NOT_FOUND'));
  await assert.rejects(store.evidence(randomUUID(), h.id, { offset: 0, limit: 200 }), fails('NOT_FOUND'));
  page.nodes[0]!.bbox!.x = 999;
  assert.deepEqual((await store.evidence(h.projectId, h.id, { nodeIds: ['root'], offset: 0, limit: 200 })).nodes[0]!.bbox, bounds);
});

test('closed branch range is exact across packet boundaries, stable after unrelated append, and retains original ancestry', async t => {
  const h = await harness(t); await h.store.append(h.projectId, h.id, packet(h.id, 0, 3, 0));
  await assert.rejects(h.store.evidenceBranch(h.projectId, h.id, 'a'), fails('SOURCE_INCOMPLETE'));
  await h.store.append(h.projectId, h.id, packet(h.id, 3, 5, 1));
  const branch = CollectionEvidenceBranchSchema.parse(await h.store.evidenceBranch(h.projectId, h.id, 'a'));
  assert.equal(branch.root.parentId, 'root'); assert.deepEqual(branch.source, source);
  assert.equal(branch.startOffset, 1); assert.equal(branch.endOffset, 5); assert.equal(branch.nodeCount, 4);
  assert.equal(branch.startedAt, time); assert.equal(branch.observedAt, '2026-10-25T00:00:01.000Z');
  await assert.rejects(h.store.evidenceBranch(h.projectId, h.id, 'root'), fails('SOURCE_INCOMPLETE'));
  const page = await h.store.evidence(h.projectId, h.id, { offset: 0, limit: 200 }, branch);
  assert.deepEqual(page.nodes.map(node => node.id), ['a', 'a1', 'a2', 'a21']); assert.equal(page.snapshot.scopeComplete, false);
  assert.ok(page.nodes.every(node => node.subtreeComplete));
  const emitted: SourceNode[] = [];
  for await (const packet of h.store.iterateEvidenceBranch(h.projectId, h.id, branch)) {
    assert.equal(packet.branchNodeId, 'a'); emitted.push(...packet.nodes);
  }
  assert.deepEqual(emitted, nodes.slice(1, 5));
  assert.deepEqual(await h.store.evidenceRecords(h.projectId, h.id, ['a21', 'a1'], branch), [nodes[4], nodes[2]]);
  await assert.rejects(h.store.evidenceRecords(h.projectId, h.id, ['root'], branch), fails('NOT_FOUND'));
  await assert.rejects(h.store.evidence(h.projectId, h.id, { nodeIds: ['root'], offset: 0, limit: 200 }, branch), fails('NOT_FOUND'));
  await h.store.append(h.projectId, h.id, packet(h.id, 5, 6, 2));
  assert.deepEqual(await h.store.evidenceBranch(h.projectId, h.id, 'a'), branch);
  const reloaded = await h.reopen(); assert.deepEqual(await reloaded.evidenceBranch(h.projectId, h.id, 'a'), branch);
  assert.equal((await reloaded.evidence(h.projectId, h.id, { offset: 0, limit: 200 })).snapshot.scopeComplete, true);
  await assert.rejects(reloaded.evidenceRecords(h.projectId, h.id, ['a1'], { ...branch, endOffset: 6 }), fails('SOURCE_BINDING_CHANGED'));
});

test('partial text preserves exact Unicode and distinguishes observed empty from unread text', async t => {
  const h = await harness(t); await h.store.append(h.projectId, h.id, packet(h.id, 0, 5, 0));
  let offset: number | null = 0, result = '';
  while (offset !== null) {
    const part = CollectionEvidenceTextSchema.parse(await h.store.evidenceText(h.projectId, h.id, { nodeId: 'a1', offset, limit: 2 }));
    result += part.text; offset = part.nextOffset; assert.equal(part.snapshot.scopeComplete, false);
  }
  assert.equal(result, text);
  const empty = await h.store.evidenceText(h.projectId, h.id, { nodeId: 'a21', offset: 0, limit: 4000 });
  assert.equal(empty.text, ''); assert.equal(empty.totalLength, 0);
  await assert.rejects(h.store.evidenceText(h.projectId, h.id, { nodeId: 'root', offset: 0, limit: 4000 }), fails('TEXT_UNAVAILABLE'));
  const surrogate = text.indexOf('👩');
  await assert.rejects(h.store.evidenceText(h.projectId, h.id, { nodeId: 'a1', offset: surrogate + 1, limit: 4 }), fails('INVALID_COLLECTION_QUERY'));
  const leaves = await h.store.evidence(h.projectId, h.id, { query: 'text', textOnly: true, offset: 0, limit: 200 });
  assert.deepEqual(leaves.nodes.map(node => node.id), ['a1', 'a21']); assert.equal(leaves.total, 2);
});

test('partial reads ignore uncommitted packets and reject corruption and forged branch bindings', async t => {
  const h = await harness(t); await h.store.append(h.projectId, h.id, packet(h.id, 0, 5, 0));
  const branch = await h.store.evidenceBranch(h.projectId, h.id, 'a');
  await writeFile(join(h.directory, '1.json'), JSON.stringify(packet(h.id, 5, 6, 1)));
  const reloaded = await h.reopen();
  assert.equal((await reloaded.evidence(h.projectId, h.id, { offset: 0, limit: 200 })).total, 5);
  await assert.rejects(reloaded.evidenceRecords(h.projectId, h.id, ['b']), fails('NOT_FOUND'));
  const path = join(h.directory, '0.json'); const encoded = await readFile(path, 'utf8');
  await writeFile(path, encoded.replace('Original text', 'Tampered text'));
  await assert.rejects(reloaded.evidence(h.projectId, h.id, { offset: 0, limit: 200 }), fails('COLLECTION_INTEGRITY'));
  await assert.rejects(reloaded.evidenceText(h.projectId, h.id, { nodeId: 'a1', offset: 0, limit: 4000 }), fails('COLLECTION_INTEGRITY'));
  await assert.rejects(reloaded.evidenceBranch(h.projectId, h.id, 'a'), fails('COLLECTION_INTEGRITY'));
  await assert.rejects(reloaded.evidenceRecords(h.projectId, h.id, ['a1'], branch), fails('COLLECTION_INTEGRITY'));
  await assert.rejects(h.reopen(), fails('COLLECTION_INTEGRITY'));
});

test('partial response budgets and saved-packet reads stay bounded and exclude uncommitted files', async t => {
  const h = await harness(t), chunk = packet(h.id, 0, 1, 0);
  chunk.nodes = [nodes[0]!, ...Array.from({ length: 99 }, (_, index): SourceNode => ({ ...nodes[2]!, id: `n${index}`, parentId: 'root', name: '한'.repeat(1000), text: '한'.repeat(10000) }))];
  chunk.childCounts = [100, ...Array.from({ length: 99 }, () => 0)];
  // Keep each saved packet below 1 MB while several selected records together
  // would exceed the response bound.
  for (let start = 0, sequence = 0; start < chunk.nodes.length; start += 20, sequence++) {
    await h.store.append(h.projectId, h.id, { ...chunk, sequence, nodes: chunk.nodes.slice(start, start + 20),
      childCounts: chunk.childCounts.slice(start, start + 20), nextSequence: sequence + 1 });
  }
  const page = await h.store.evidence(h.projectId, h.id, { offset: 0, limit: 200 });
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 96000); assert.ok(page.nodes.length < 100); assert.equal(page.nextOffset, page.nodes.length);
  assert.equal((await h.store.savedChunk(h.projectId, h.id, 0))!.nodes.length, 20);
  await writeFile(join(h.directory, '5.json'), JSON.stringify(chunk));
  assert.equal(await h.store.savedChunk(h.projectId, h.id, 5), null);
  await assert.rejects(h.store.savedChunk(h.projectId, h.id, -1), fails('INVALID_COLLECTION_QUERY'));
  await assert.rejects(h.store.evidenceRecords(h.projectId, h.id, Array.from({ length: 50 }, (_, i) => `n${i}`)), fails('RESPONSE_LIMIT'));
  await assert.rejects(h.store.evidenceRecords(h.projectId, h.id, ['n0', 'n0']), fails('INVALID_COLLECTION_QUERY'));
});

test('branch streaming reserves source retention until iterator completion or cancellation', async t => {
  const h = await harness(t); await h.store.append(h.projectId, h.id, packet(h.id, 0, 3, 0));
  await h.store.append(h.projectId, h.id, packet(h.id, 3, 5, 1));
  await h.store.update(h.projectId, h.id, { status: 'paused' });
  const branch = await h.store.evidenceBranch(h.projectId, h.id, 'a');
  const stream = h.store.iterateEvidenceBranch(h.projectId, h.id, branch);
  assert.equal((await stream.next()).done, false);
  await assert.rejects(h.store.remove(h.projectId, h.id), fails('COLLECTION_BUSY'));
  await stream.return(undefined);
  await h.store.remove(h.projectId, h.id);
  assert.throws(() => h.store.get(h.projectId, h.id), fails('NOT_FOUND'));
});

test('recovery lineage is immutable, validation counters are monotonic, and a deleted original remains historical provenance', async t => {
  const h = await harness(t); await h.store.append(h.projectId, h.id, packet(h.id, 0, 3, 0));
  await h.store.update(h.projectId, h.id, { status: 'interrupted' });
  const id = randomUUID(), recovery = { previousCollectionId: h.id, originalCollectionId: h.id, revalidatedNodes: 0, reusedPackets: 0 };
  await h.store.create({ id, projectId: h.projectId, sessionId: 'second-session', source, recovery });
  await h.store.update(h.projectId, id, { recovery: { ...recovery, revalidatedNodes: 3, reusedPackets: 1 } });
  await assert.rejects(h.store.update(h.projectId, id, { recovery }), fails('INVALID_COLLECTION'));
  await assert.rejects(h.store.update(h.projectId, id, { recovery: undefined }), fails('INVALID_COLLECTION'));
  await assert.rejects(h.store.update(h.projectId, id, { recovery: { ...recovery, previousCollectionId: randomUUID() } }), fails('INVALID_COLLECTION'));
  await assert.rejects(h.store.update(h.projectId, h.id, { recovery }), fails('INVALID_COLLECTION'));
  await h.store.append(h.projectId, id, packet(id, 0, 6, 0));
  await h.store.remove(h.projectId, h.id);
  const later = randomUUID();
  await h.store.create({ id: later, projectId: h.projectId, sessionId: 'third-session', source,
    recovery: { previousCollectionId: id, originalCollectionId: h.id, revalidatedNodes: 0, reusedPackets: 0 } });
  const reopened = await h.reopen();
  assert.equal(reopened.get(h.projectId, later).recovery!.originalCollectionId, h.id);
  await assert.rejects(reopened.create({ id: randomUUID(), projectId: h.projectId, sessionId: 'forged-session', source,
    recovery: { previousCollectionId: id, originalCollectionId: randomUUID(), revalidatedNodes: 0, reusedPackets: 0 } }), fails('INVALID_COLLECTION'));
});

test('focused parts retain validated context lineage across restart and prevent removal of their parent evidence', async t => {
  const h = await harness(t); await h.store.append(h.projectId, h.id, packet(h.id, 0, 3, 0));
  const id = randomUUID(), partOf = { collectionId: h.id, contextCollectionId: h.id, contextRootId: 'root', contextBounds: bounds };
  const partSource = { ...source, nodeId: 'a', name: nodes[1]!.name, scopeId: 'root', parentId: 'root' };
  const input = { id, projectId: h.projectId, sessionId: 'part-session', source: partSource, partOf };
  for (const bad of [
    { ...input, partOf: { ...partOf, contextRootId: 'invented' } },
    { ...input, partOf: { ...partOf, contextBounds: { ...bounds, x: 999 } } },
    { ...input, source: { ...partSource, nodeId: 'missing' } },
    { ...input, source: { ...partSource, nodeId: 'a1' } },
    { ...input, source: { ...partSource, scopeId: 'invented' } },
  ]) await assert.rejects(h.store.create(bad), fails('INVALID_COLLECTION'));
  await h.store.create(input);
  await h.store.update(h.projectId, h.id, { status: 'paused' });
  await assert.rejects(h.store.remove(h.projectId, h.id), fails('COLLECTION_IN_USE'));
  const reopened = await h.reopen(); assert.deepEqual(reopened.get(h.projectId, id).partOf, partOf);
  const manifestPath = join(h.dataDir, 'structure-collections', id, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')); manifest.view.partOf.contextRootId = 'tampered';
  await writeFile(manifestPath, JSON.stringify(manifest)); await assert.rejects(h.reopen(), fails('COLLECTION_INTEGRITY'));
});

for (const state of ['hidden', 'transparent', 'unknown'] as const) test(`branch retains verified ${state} ancestor evidence outside its own packet range`, async t => {
  const h = await harness(t), first = packet(h.id, 0, 2, 0), second = packet(h.id, 2, 5, 1);
  if (state === 'hidden') { first.root.visible = false; first.nodes[0]!.visible = false; }
  if (state === 'transparent') { first.root.rendering!.opacity = 0; first.nodes[0]!.rendering!.opacity = 0; }
  if (state === 'unknown') { first.root.rendering = {}; first.nodes[0]!.rendering = {}; }
  second.root = structuredClone(first.root);
  await h.store.append(h.projectId, h.id, first); await h.store.append(h.projectId, h.id, second);
  const branch = await h.store.evidenceBranch(h.projectId, h.id, 'a1');
  assert.deepEqual(branch.ancestorRendering, { status: state, sourceNodeId: 'root' });
  const reopened = await h.reopen(); assert.deepEqual(await reopened.evidenceBranch(h.projectId, h.id, 'a1'), branch);
  // Node a1 is in packet 1. Its inherited rendering also depends on packet 0.
  await writeFile(join(h.directory, '0.json'), '{}');
  await assert.rejects(reopened.evidenceBranch(h.projectId, h.id, 'a1'), fails('COLLECTION_INTEGRITY'));
});
