import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollectionStore } from '../src/server/structure-collection-store.js';
import { ServiceError } from '../src/server/errors.js';
import type { CollectionView, StructureChunk } from '../src/shared/structure-collection.js';
import type { SourceNode } from '../src/shared/contracts.js';

const time = '2026-10-25T00:00:00.000Z';
const bounds = { x: -800, y: -500, width: 17320, height: 14791 };
const source = { fileKey: 'synthetic-file', pageId: 'synthetic-page', nodeId: 'root', name: 'Synthetic large scope', type: 'FRAME', bounds };
const originalText = ('한글 e\u0301 👩‍💻\r\n\t<&> '.repeat(1800)).slice(0, 48000);
function node(index: number): SourceNode {
  return { id: index === 0 ? 'root' : `node-${index}`, parentId: index === 0 ? source.pageId : 'root',
    name: index === 0 ? source.name : `Synthetic ${index}`, type: index === 0 ? 'FRAME' : index === 17 ? 'TEXT' : 'RECTANGLE',
    bbox: index === 0 ? bounds : { x: -800 + index % 1000, y: -500 + index % 700, width: 1, height: 2 },
    visible: index % 7 !== 1, rendering: { opacity: index % 13 === 1 ? 0 : 1, ...(index === 0 ? {} : { siblingIndex: index - 1 }) },
    sourceFileKey: source.fileKey, sourcePageId: source.pageId, ...(index === 17 ? { text: originalText } : {}) };
}
function packet(id: string, total: number, first = 0, count = Math.min(500, total - first), sequence = Math.floor(first / 500)): StructureChunk {
  const complete = first + count === total;
  return { collectionId: id, sequence, fileKey: source.fileKey, pageId: source.pageId, root: node(0), bounds,
    startedAt: time, observedAt: time, nodes: Array.from({ length: count }, (_, i) => node(first + i)),
    childCounts: Array.from({ length: count }, (_, i) => first + i === 0 ? total - 1 : 0), complete,
    nextSequence: complete ? null : sequence + 1, warnings: [], consistency: 'live-session-observation' };
}
async function harness(t: test.TestContext) {
  const dataDir = await mkdtemp(join(tmpdir(), 'fsb-collection-store-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = new CollectionStore(dataDir); await store.initialize();
  const projectId = randomUUID(), id = randomUUID();
  const view = await store.create({ id, projectId, sessionId: 'synthetic-session', source });
  return { store, dataDir, projectId, id, view, directory: join(dataDir, 'structure-collections', id),
    async reopen() { const reopened = new CollectionStore(dataDir); await reopened.initialize(); return reopened; } };
}
const fails = (code: string) => (error: unknown) => error instanceof ServiceError && error.code === code;

test('known 105,837-node inventory survives chunking, complete paging and durable reload with exact Unicode text', { timeout: 120000 }, async t => {
  const h = await harness(t), total = 105837;
  for (let first = 0; first < total; first += 500) {
    const chunk = packet(h.id, total, first);
    const view = await h.store.append(h.projectId, h.id, chunk);
    assert.equal(view.nodeCount, first + chunk.nodes.length);
    assert.equal(view.status, chunk.complete ? 'complete' : 'running');
  }
  const view = h.store.get(h.projectId, h.id);
  assert.equal(view.chunkCount, 212); assert.equal(view.reviewStatus, 'unreviewed'); assert.ok(view.finishedAt);
  const reloaded = await h.reopen(); assert.deepEqual(reloaded.get(h.projectId, h.id), view);
  let offset: number | null = 0, count = 0;
  while (offset !== null) {
    const page = await reloaded.query(h.projectId, h.id, { offset, limit: 200 });
    assert.equal(page.total, total); assert.equal(page.complete, true); assert.equal(page.reviewStatus, 'unreviewed');
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 96000);
    for (const result of page.nodes) {
      const { text, ...expected } = node(count++);
      assert.deepEqual(result, { ...expected, textLength: text === undefined ? null : text.length });
      assert.equal('text' in result, false);
    }
    offset = page.nextOffset;
  }
  assert.equal(count, total);
  const last = await reloaded.query(h.projectId, h.id, { nodeIds: ['node-105836'], offset: 0, limit: 200 });
  assert.equal(last.nodes[0]!.id, 'node-105836');
  const children = await reloaded.query(h.projectId, h.id, { parentId: 'root', offset: 105800, limit: 200 });
  assert.equal(children.total, total - 1); assert.equal(children.nodes[0]!.id, 'node-105801'); assert.equal(children.nextOffset, null);
  const leaf = await reloaded.query(h.projectId, h.id, { parentId: 'node-42', offset: 0, limit: 100 }); assert.equal(leaf.total, 0);
  let textOffset: number | null = 0, rebuilt = '';
  while (textOffset !== null) {
    const part = await reloaded.text(h.projectId, h.id, { nodeId: 'node-17', offset: textOffset, limit: 4000 });
    assert.equal(part.offset, textOffset); assert.equal(part.totalLength, originalText.length); assert.ok(part.text.length <= 4000);
    assert.ok(!/[\uD800-\uDBFF]$/.test(part.text)); assert.ok(!/^[\uDC00-\uDFFF]/.test(part.text));
    rebuilt += part.text; textOffset = part.nextOffset;
  }
  assert.equal(rebuilt, originalText);
  assert.equal((await stat(join(h.directory, 'manifest.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(h.directory, '0.json'))).mode & 0o777, 0o600);
});

test('only durably complete collections are queryable; updates cannot manufacture completion', async t => {
  const h = await harness(t);
  await assert.rejects(h.store.query(h.projectId, h.id, { offset: 0, limit: 100 }), fails('SOURCE_INCOMPLETE'));
  await assert.rejects(h.store.update(h.projectId, h.id, { status: 'complete' }), fails('INVALID_COLLECTION'));
  const prefix = packet(h.id, 3, 0, 2, 0); await h.store.append(h.projectId, h.id, prefix);
  await assert.rejects(h.store.text(h.projectId, h.id, { nodeId: 'root', offset: 0, limit: 4000 }), fails('SOURCE_INCOMPLETE'));
  await h.store.update(h.projectId, h.id, { status: 'paused' });
  assert.equal(h.store.get(h.projectId, h.id).status, 'paused');
  await h.store.update(h.projectId, h.id, { status: 'running' });
  await h.store.append(h.projectId, h.id, packet(h.id, 3, 2, 1, 1));
  assert.equal((await h.store.query(h.projectId, h.id, { offset: 0, limit: 100 })).nodes.length, 3);
});

test('nested preorder closes each branch across packets without dropping out-of-bounds descendants', async t => {
  const h = await harness(t);
  const nodes = Array.from({ length: 6 }, (_, i) => node(i));
  nodes[2]!.parentId = 'node-1'; nodes[3]!.parentId = 'node-1'; nodes[4]!.parentId = 'node-3';
  nodes[4]!.bbox = { x: 50000, y: -50000, width: 3, height: 4 };
  const childCounts = [2, 2, 0, 1, 0, 0];
  for (let sequence = 0; sequence < 3; sequence++) {
    const chunk = packet(h.id, 6, sequence * 2, 2, sequence);
    chunk.nodes = nodes.slice(sequence * 2, sequence * 2 + 2);
    chunk.childCounts = childCounts.slice(sequence * 2, sequence * 2 + 2);
    await h.store.append(h.projectId, h.id, chunk);
  }
  const store = await h.reopen();
  const root = await store.query(h.projectId, h.id, { parentId: 'root', offset: 0, limit: 100 });
  assert.deepEqual(root.nodes.map(value => value.id), ['node-1', 'node-5']);
  const branch = await store.query(h.projectId, h.id, { parentId: 'node-1', offset: 0, limit: 100 });
  assert.deepEqual(branch.nodes.map(value => value.id), ['node-2', 'node-3']);
  const external = await store.query(h.projectId, h.id, { nodeIds: ['node-4'], offset: 0, limit: 100 });
  assert.deepEqual(external.nodes[0]!.bbox, nodes[4]!.bbox);
});

test('same-sequence replay is idempotent, changed replay/gaps fail, and reads are detached', async t => {
  const h = await harness(t), chunk = packet(h.id, 3, 0, 2, 0);
  const outcomes = await Promise.all([h.store.append(h.projectId, h.id, chunk), h.store.append(h.projectId, h.id, structuredClone(chunk))]);
  assert.deepEqual(outcomes[0], outcomes[1]); assert.equal(h.store.get(h.projectId, h.id).nodeCount, 2);
  const changed = structuredClone(chunk); changed.nodes[1]!.name = 'Changed replay';
  await assert.rejects(h.store.append(h.projectId, h.id, changed), fails('INVALID_COLLECTION'));
  await assert.rejects(h.store.append(h.projectId, h.id, { ...packet(h.id, 3, 2, 1, 1), sequence: 2 }), fails('INVALID_COLLECTION'));
  const detached = h.store.get(h.projectId, h.id); detached.source.bounds.x = 999; detached.warnings.push('Not persisted');
  assert.deepEqual(h.store.get(h.projectId, h.id), outcomes[0]);
  assert.deepEqual(h.store.list(randomUUID()), []);
  assert.throws(() => h.store.get(randomUUID(), h.id), fails('NOT_FOUND'));
  await h.store.append(h.projectId, h.id, packet(h.id, 3, 2, 1, 1));
  const complete = h.store.get(h.projectId, h.id);
  assert.deepEqual(await h.store.append(h.projectId, h.id, chunk), complete);
});

const invalid = ['missing-child', 'extra-child', 'wrong-parent', 'duplicate-id', 'root-name', 'file', 'node-page', 'counts-length', 'next-sequence'] as const;
for (const fault of invalid) test(`invalid ${fault} packet cannot advance coverage`, async t => {
  const h = await harness(t), chunk = packet(h.id, 3);
  if (fault === 'missing-child') { chunk.nodes.pop(); chunk.childCounts.pop(); }
  if (fault === 'extra-child') chunk.childCounts[0] = 1;
  if (fault === 'wrong-parent') chunk.nodes[2]!.parentId = chunk.nodes[1]!.id;
  if (fault === 'duplicate-id') chunk.nodes[2]!.id = chunk.nodes[1]!.id;
  if (fault === 'root-name') chunk.root.name = 'Different scope';
  if (fault === 'file') chunk.fileKey = 'another-file';
  if (fault === 'node-page') chunk.nodes[1]!.sourcePageId = 'another-page';
  if (fault === 'counts-length') chunk.childCounts.pop();
  if (fault === 'next-sequence') chunk.nextSequence = 1;
  await assert.rejects(h.store.append(h.projectId, h.id, chunk), fails('INVALID_COLLECTION'));
  assert.deepEqual(h.store.get(h.projectId, h.id), h.view);
});

test('restart invalidates unfinished live continuation, while cancelled work never becomes complete', async t => {
  const h = await harness(t); await h.store.append(h.projectId, h.id, packet(h.id, 3, 0, 2));
  const reopened = await h.reopen(); assert.equal(reopened.get(h.projectId, h.id).status, 'interrupted');
  await assert.rejects(reopened.append(h.projectId, h.id, packet(h.id, 3, 2, 1, 1)), fails('INVALID_COLLECTION'));
  await assert.rejects(reopened.update(h.projectId, h.id, { status: 'running' }), fails('INVALID_COLLECTION'));
  const id = randomUUID(); await reopened.create({ id, projectId: h.projectId, sessionId: 'new-session', source });
  await reopened.update(h.projectId, id, { status: 'cancelled' });
  await assert.rejects(reopened.append(h.projectId, id, packet(id, 1)), fails('INVALID_COLLECTION'));
});

test('chunk corruption fails reads and reload rather than trusting cached indexes', async t => {
  const h = await harness(t); await h.store.append(h.projectId, h.id, packet(h.id, 3));
  const path = join(h.directory, '0.json'), original = await readFile(path, 'utf8');
  await writeFile(path, original.replace('Synthetic 1', 'Synthetic X'));
  await assert.rejects(h.store.query(h.projectId, h.id, { offset: 0, limit: 100 }), fails('COLLECTION_INTEGRITY'));
  await assert.rejects(h.reopen(), fails('COLLECTION_INTEGRITY'));
});

test('uncommitted orphan chunks are not visible and may be safely replaced at the next append', async t => {
  const h = await harness(t), chunk = packet(h.id, 3), orphan = structuredClone(chunk);
  orphan.nodes[1]!.name = 'Uncommitted orphan';
  await writeFile(join(h.directory, '0.json'), JSON.stringify(orphan), { mode: 0o600 });
  assert.equal(h.store.get(h.projectId, h.id).nodeCount, 0);
  await h.store.append(h.projectId, h.id, chunk);
  assert.equal((await h.store.query(h.projectId, h.id, { offset: 0, limit: 100 })).nodes[1]!.name, 'Synthetic 1');
  const manifest = JSON.parse(await readFile(join(h.directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.chunks[0].sha256, createHash('sha256').update(await readFile(join(h.directory, '0.json'))).digest('hex'));
});

test('failed manifest replacement exposes no new progress and permits an identical durable retry', async t => {
  const h = await harness(t); await h.store.append(h.projectId, h.id, packet(h.id, 3, 0, 2));
  const before = h.store.get(h.projectId, h.id), path = join(h.directory, 'manifest.json');
  const saved = await readFile(path); await rm(path); await mkdir(path);
  await assert.rejects(h.store.append(h.projectId, h.id, packet(h.id, 3, 2, 1, 1)));
  assert.deepEqual(h.store.get(h.projectId, h.id), before);
  await assert.rejects(h.store.query(h.projectId, h.id, { offset: 0, limit: 100 }), fails('SOURCE_INCOMPLETE'));
  await rm(path, { recursive: true }); await writeFile(path, saved, { mode: 0o600 });
  await h.store.append(h.projectId, h.id, packet(h.id, 3, 2, 1, 1));
  const reopened = await h.reopen();
  assert.equal(reopened.get(h.projectId, h.id).status, 'complete');
  assert.equal((await reopened.query(h.projectId, h.id, { offset: 0, limit: 100 })).nodes.length, 3);
});

test('metadata pages honor UTF-8 response bytes, and text ranges preserve original code units', async t => {
  const h = await harness(t), chunk = packet(h.id, 100);
  for (const value of chunk.nodes.slice(1)) value.name = '한'.repeat(1000);
  chunk.nodes[1]!.text = 'a😀b'; chunk.nodes[2]!.text = '';
  await h.store.append(h.projectId, h.id, chunk);
  const page = await h.store.query(h.projectId, h.id, { offset: 0, limit: 100 });
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 96000); assert.ok(page.nodes.length < 100); assert.equal(page.nextOffset, page.nodes.length);
  const part = await h.store.text(h.projectId, h.id, { nodeId: 'node-1', offset: 0, limit: 2 }); assert.equal(part.text, 'a'); assert.equal(part.nextOffset, 1);
  const rest = await h.store.text(h.projectId, h.id, { nodeId: 'node-1', offset: 1, limit: 3 }); assert.equal(part.text + rest.text, 'a😀b');
  await assert.rejects(h.store.text(h.projectId, h.id, { nodeId: 'node-1', offset: 2, limit: 2 }), fails('INVALID_COLLECTION_QUERY'));
  assert.equal((await h.store.text(h.projectId, h.id, { nodeId: 'node-2', offset: 0, limit: 4 })).totalLength, 0);
  await assert.rejects(h.store.text(h.projectId, h.id, { nodeId: 'node-3', offset: 0, limit: 4 }), fails('TEXT_UNAVAILABLE'));
});

test('packet limits, collection count, UUID paths and symlinks fail closed; removal releases capacity', async t => {
  const h = await harness(t), oversized = packet(h.id, 10);
  for (const value of oversized.nodes.slice(1)) value.text = '한'.repeat(50000);
  await assert.rejects(h.store.append(h.projectId, h.id, oversized), fails('COLLECTION_LIMIT'));
  assert.throws(() => h.store.get(h.projectId, '../escape'), fails('NOT_FOUND'));
  for (let i = 1; i < 12; i++) await h.store.create({ id: randomUUID(), projectId: h.projectId, sessionId: 'session', source });
  await assert.rejects(h.store.create({ id: randomUUID(), projectId: h.projectId, sessionId: 'session', source }), fails('COLLECTION_LIMIT'));
  await h.store.remove(h.projectId, h.id); assert.equal(h.store.list(h.projectId).length, 11);
  await assert.rejects(stat(h.directory), { code: 'ENOENT' });
  const newId = randomUUID(); await h.store.create({ id: newId, projectId: h.projectId, sessionId: 'session', source });
  const manifest = join(h.dataDir, 'structure-collections', newId, 'manifest.json');
  await rm(manifest); await symlink(join(h.dataDir, 'outside.json'), manifest);
  await assert.rejects(h.reopen(), fails('COLLECTION_INTEGRITY'));
});
