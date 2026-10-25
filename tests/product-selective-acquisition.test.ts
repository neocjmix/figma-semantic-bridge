import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SelectiveReader } from '../src/figma/selective-reader.js';
import type { CaptureHost, FigmaReadableNode } from '../src/figma/capture.js';
import { SelectiveAcquisition } from '../src/server/selective-acquisition.js';
import { PluginBroker } from '../src/server/broker.js';
import { ServiceError } from '../src/server/errors.js';
import { ProjectStore } from '../src/server/store.js';

const bounds = { x: -10, y: 20, width: 100, height: 80 };
const sessionId = 'synthetic-session';
type Command = { type: string; fileKey?: string; pageId?: string; scopeId?: string; nodeIds?: string[];
  fields?: 'metadata' | 'text'; parentId?: string; observationId?: string; offset?: number; limit?: number };

async function fixture(t: test.TestContext, childCount = 205) {
  const dataDir = await mkdtemp(join(tmpdir(), 'fsb-selective-'));
  const projects = new ProjectStore(dataDir); await projects.initialize();
  const project = await projects.create('Synthetic selective project');
  const page: FigmaReadableNode & { selection: FigmaReadableNode[] } =
    { id: 'page', name: 'Page', type: 'PAGE', parent: null, selection: [] };
  Object.defineProperty(page, 'children', { get() { throw Error('No page preload'); } });
  const root: FigmaReadableNode = { id: 'root', name: 'Synthetic root', type: 'FRAME', parent: page,
    absoluteBoundingBox: bounds, visible: true };
  page.selection = [root];
  const children: FigmaReadableNode[] = [];
  let childArrayReads = 0;
  Object.defineProperty(root, 'children', { get() { childArrayReads++; return children; } });
  const byId = new Map<string, FigmaReadableNode>([[root.id, root]]);
  for (let index = 0; index < childCount; index++) {
    const child: FigmaReadableNode = { id: `child-${index}`, name: `Child ${index}`, type: index === 0 ? 'TEXT' : 'RECTANGLE',
      parent: root, absoluteBoundingBox: { x: index, y: index, width: 10, height: 10 }, visible: index % 2 === 0 };
    if (index === 0) child.characters = 'Exact synthetic 𝌆 text';
    Object.defineProperty(child, 'children', { get() { throw Error('No descendant traversal'); } });
    children.push(child); byId.set(child.id, child);
  }
  const host: CaptureHost = { fileKey: 'synthetic-file', currentPage: page, skipInvisibleInstanceChildren: true,
    getNodeByIdAsync: async id => byId.get(id) ?? null,
    setCurrentPageAsync: async () => { throw Error('No navigation'); },
    selectNodes: () => { throw Error('No selection write'); },
    scrollAndZoomIntoView: () => { throw Error('No viewport write'); } };
  const reader = new SelectiveReader(host, { observedAt: () => '2026-10-25T00:00:00.000Z' });
  const status = { connected: true, sessionId, clientId: 'synthetic', pendingRequests: 0 };
  const seen: Command[] = [];
  let timeoutOnce = false, failRelease = false, alterScope = false;
  const broker = { status, request: async (command: Command) => {
    seen.push(command);
    if (!status.connected) throw new ServiceError('PLUGIN_DISCONNECTED', 'Synthetic disconnect.', 503);
    if (command.type === 'get_selection') return { fileKey: 'synthetic-file', pageId: 'page',
      nodes: [{ id: root.id, name: root.name, type: root.type, bbox: bounds }] };
    if (command.type === 'read_source_nodes') {
      const result = await reader.readNodes(command as Parameters<typeof reader.readNodes>[0]);
      return alterScope ? { ...result, scope: { ...result.scope, name: 'Changed' } } : result;
    }
    if (command.type === 'read_source_children') {
      const result = await reader.readChildren(command as Parameters<typeof reader.readChildren>[0]);
      if (timeoutOnce) { timeoutOnce = false; throw new ServiceError('PLUGIN_TIMEOUT', 'Synthetic lost reply.', 504); }
      return alterScope ? { ...result, scope: { ...result.scope, name: 'Changed' } } : result;
    }
    if (command.type === 'release_source_children') {
      if (failRelease) throw new ServiceError('PLUGIN_TIMEOUT', 'Synthetic release lost.', 504);
      return reader.release(command.observationId!);
    }
    throw Error(`Unexpected command ${command.type}`);
  } } as unknown as PluginBroker;
  const manager = new SelectiveAcquisition(dataDir, projects, broker, { requestTimeoutMs: 100 });
  await manager.initialize();
  t.after(async () => { await manager.close(); await rm(dataDir, { recursive: true, force: true }); });
  const prepared = async () => manager.prepare(project.id, project.revision, sessionId);
  return { dataDir, projects, project, manager, prepared, broker, status, reader, root, page, seen,
    get childArrayReads() { return childArrayReads; }, timeoutNext() { timeoutOnce = true; },
    releaseFailure(value: boolean) { failRelease = value; }, changeScope(value: boolean) { alterScope = value; } };
}

test('explicit node observations persist exactly, preserve Project data and replay offline', async t => {
  const f = await fixture(t, 2), inspection = await f.prepared();
  assert.equal(inspection.observationCount, 0);
  const read = await f.manager.readNodes(f.project.id, inspection.id, { nodeIds: ['child-0'], fields: 'text' });
  assert.equal(read.reused, false);
  assert.equal(read.observation.kind, 'nodes');
  if (read.observation.kind !== 'nodes') return;
  assert.equal(read.observation.result.records[0]?.node.text, 'Exact synthetic 𝌆 text');
  assert.equal(read.observation.result.requestedIdsComplete, true);
  assert.equal('subtreeComplete' in read.observation.result, false);
  assert.equal(read.view.observationCount, 1);
  assert.equal(f.childArrayReads, 0);
  assert.deepEqual(await f.projects.get(f.project.id), f.project);
  f.status.connected = false;
  const reused = await f.manager.readNodes(f.project.id, inspection.id, { nodeIds: ['child-0'], fields: 'text' });
  assert.equal(reused.reused, true);
  assert.deepEqual(reused.observation, read.observation);
  assert.equal(f.seen.filter(command => command.type === 'read_source_nodes').length, 1);
  const history = f.manager.get(f.project.id, inspection.id);
  assert.equal(history.history.length, 1);
  assert.equal(history.nextOffset, null);
  const reopened = new SelectiveAcquisition(f.dataDir, f.projects, f.broker);
  await reopened.initialize();
  assert.deepEqual(reopened.get(f.project.id, inspection.id).history, history.history);
  await reopened.close();
});

test('cached observation pages omit text until one exact segment is explicitly requested', async t => {
  const f = await fixture(t, 2), inspection = await f.prepared();
  const observed = await f.manager.readNodes(f.project.id, inspection.id, { nodeIds: ['child-0'], fields: 'text' });
  const summaries = f.manager.listObservations(f.project.id, inspection.id);
  assert.equal(summaries.total, 1);
  assert.equal(summaries.observations[0]?.id, observed.observation.id);
  assert.equal('text' in summaries.observations[0]!, false);
  const records = f.manager.readRecords(f.project.id, inspection.id, observed.observation.id, 0, 1);
  assert.equal(records.records[0]?.textLength, 'Exact synthetic 𝌆 text'.length);
  assert.equal(Object.hasOwn(records.records[0]!.node, 'text'), false);
  assert.equal(JSON.stringify(records).includes('Exact synthetic'), false);
  const first = f.manager.readText(f.project.id, inspection.id, observed.observation.id, 'child-0', 0, 7);
  assert.equal(first.text, 'Exact s');
  assert.equal(first.nextOffset, 7);
  const rest = f.manager.readText(f.project.id, inspection.id, observed.observation.id, 'child-0', 7, 4000);
  assert.equal(first.text + rest.text, 'Exact synthetic 𝌆 text');
  assert.equal(rest.nextOffset, null);
  const pairAt = 'Exact synthetic 𝌆 text'.indexOf('𝌆');
  const beforePair = f.manager.readText(f.project.id, inspection.id, observed.observation.id, 'child-0', 0, pairAt + 1);
  assert.equal(beforePair.nextOffset, pairAt);
  await assert.rejects(async () => f.manager.readText(f.project.id, inspection.id, observed.observation.id,
    'child-0', pairAt + 1), { code: 'INVALID_QUERY' });
  assert.equal(f.manager.readText(f.project.id, inspection.id, observed.observation.id, 'child-0', pairAt, 2).text, '𝌆');
  await assert.rejects(async () => f.manager.readText(f.project.id, inspection.id, observed.observation.id, 'child-1'),
    { code: 'TEXT_NOT_OBSERVED' });
});

test('immediate-child coverage is packeted and a complete parent never completes the subtree', async t => {
  const f = await fixture(t), inspection = await f.prepared();
  const first = await f.manager.readChildren(f.project.id, inspection.id, { parentId: 'root' });
  assert.equal(first.observation.kind, 'children');
  if (first.observation.kind !== 'children') return;
  const observationId = first.observation.result.observationId;
  assert.equal(first.observation.result.nodes.length, 100);
  assert.equal(first.observation.result.childrenComplete, false);
  await assert.rejects(f.manager.readChildren(f.project.id, inspection.id,
    { parentId: 'root', observationId, offset: 200 }), { code: 'CURSOR_UNAVAILABLE' });
  const replay = await f.manager.readChildren(f.project.id, inspection.id,
    { parentId: 'root', observationId, offset: 0 });
  assert.equal(replay.reused, true);
  assert.deepEqual(replay.observation, first.observation);
  const second = await f.manager.readChildren(f.project.id, inspection.id,
    { parentId: 'root', observationId, offset: 100 });
  const third = await f.manager.readChildren(f.project.id, inspection.id,
    { parentId: 'root', observationId, offset: 200 });
  assert.equal(second.observation.kind, 'children');
  assert.equal(third.observation.kind, 'children');
  if (third.observation.kind !== 'children') return;
  assert.equal(third.observation.result.childrenComplete, true);
  assert.equal('subtreeComplete' in third.observation.result, false);
  assert.equal(third.observation.result.nodes.length, 5);
  assert.equal(f.childArrayReads, 1);
  assert.equal(f.reader.hasCursor(), false);
  assert.equal(f.manager.get(f.project.id, inspection.id).history.length, 3);
  f.status.connected = false;
  const offline = await f.manager.readChildren(f.project.id, inspection.id, { parentId: 'root' });
  assert.equal(offline.reused, true);
  assert.deepEqual(offline.observation, first.observation);
  assert.equal(f.seen.filter(command => command.type === 'read_source_children').length, 3);
});

test('lost reply permits manual retry of the same first offset, without a second native child array', async t => {
  const f = await fixture(t, 3), inspection = await f.prepared();
  const observationId = 'synthetic-replay-id';
  f.timeoutNext();
  await assert.rejects(f.manager.readChildren(f.project.id, inspection.id,
    { parentId: 'root', observationId, offset: 0 }), { code: 'PLUGIN_TIMEOUT' });
  assert.equal(f.manager.get(f.project.id, inspection.id).history.length, 0);
  const recovered = await f.manager.readChildren(f.project.id, inspection.id,
    { parentId: 'root', observationId, offset: 0 });
  assert.equal(recovered.observation.kind, 'children');
  if (recovered.observation.kind !== 'children') return;
  assert.equal(recovered.observation.result.childrenComplete, true);
  assert.equal(f.childArrayReads, 1);
  assert.deepEqual(f.seen.filter(command => command.type === 'read_source_children').map(command => command.offset), [0, 0]);
});

test('session change blocks missing continuation but keeps stored packets as history', async t => {
  const f = await fixture(t), inspection = await f.prepared();
  const first = await f.manager.readChildren(f.project.id, inspection.id, { parentId: 'root' });
  if (first.observation.kind !== 'children') return;
  f.status.sessionId = 'new-session';
  await assert.rejects(f.manager.readChildren(f.project.id, inspection.id,
    { parentId: 'root', observationId: first.observation.result.observationId, offset: 100 }),
  { code: 'PLUGIN_SESSION_CHANGED' });
  assert.equal(f.manager.get(f.project.id, inspection.id).history.length, 1);
  await f.manager.remove(f.project.id, inspection.id);
  assert.equal(f.manager.list(f.project.id).length, 0);
});

test('release failure preserves cursor ownership and removal can be retried', async t => {
  const f = await fixture(t), inspection = await f.prepared();
  const first = await f.manager.readChildren(f.project.id, inspection.id, { parentId: 'root' });
  if (first.observation.kind !== 'children') return;
  f.releaseFailure(true);
  await assert.rejects(f.manager.remove(f.project.id, inspection.id), { code: 'CURSOR_RELEASE_FAILED' });
  assert.equal(f.manager.get(f.project.id, inspection.id).history.length, 1);
  await assert.rejects(f.manager.readChildren(f.project.id, inspection.id,
    { parentId: 'child-1', observationId: 'another-id', offset: 0 }), { code: 'SELECTIVE_BUSY' });
  f.releaseFailure(false);
  await f.manager.remove(f.project.id, inspection.id);
  assert.equal(f.manager.list(f.project.id).length, 0);
});

test('changed root metadata cannot be stored as a completed observation', async t => {
  const f = await fixture(t, 2), inspection = await f.prepared();
  f.changeScope(true);
  await assert.rejects(f.manager.readNodes(f.project.id, inspection.id,
    { nodeIds: ['child-0'], fields: 'metadata' }), { code: 'SOURCE_METADATA_CHANGED' });
  assert.equal(f.manager.get(f.project.id, inspection.id).history.length, 0);
});

test('a deterministic invalid child scope releases ownership for a later valid read', async t => {
  const f = await fixture(t, 2), inspection = await f.prepared();
  await assert.rejects(f.manager.readChildren(f.project.id, inspection.id,
    { parentId: 'missing-parent', observationId: 'bad-observation', offset: 0 }), { code: 'NODE_UNAVAILABLE' });
  const valid = await f.manager.readChildren(f.project.id, inspection.id, { parentId: 'root' });
  assert.equal(valid.observation.kind, 'children');
  assert.equal(f.manager.get(f.project.id, inspection.id).history.length, 1);
});

test('failed release after a rejected child read keeps the retry identity', async t => {
  const f = await fixture(t, 2), inspection = await f.prepared();
  f.releaseFailure(true);
  await assert.rejects(f.manager.readChildren(f.project.id, inspection.id,
    { parentId: 'missing-parent', observationId: 'bad-observation', offset: 0 }), { code: 'CURSOR_RELEASE_FAILED' });
  await assert.rejects(f.manager.readChildren(f.project.id, inspection.id,
    { parentId: 'root', observationId: 'another-observation', offset: 0 }), { code: 'SELECTIVE_BUSY' });
  f.releaseFailure(false);
  await assert.rejects(f.manager.readChildren(f.project.id, inspection.id,
    { parentId: 'missing-parent', observationId: 'bad-observation', offset: 0 }), { code: 'NODE_UNAVAILABLE' });
  const valid = await f.manager.readChildren(f.project.id, inspection.id, { parentId: 'root' });
  assert.equal(valid.observation.kind, 'children');
});

test('a restarted service preserves partial history but cannot assume a live cursor survived', async t => {
  const f = await fixture(t), inspection = await f.prepared();
  const first = await f.manager.readChildren(f.project.id, inspection.id, { parentId: 'root' });
  if (first.observation.kind !== 'children') return;
  await f.manager.close();
  const reopened = new SelectiveAcquisition(f.dataDir, f.projects, f.broker);
  await reopened.initialize();
  t.after(async () => reopened.close());
  assert.equal(reopened.get(f.project.id, inspection.id).history.length, 1);
  await assert.rejects(reopened.readChildren(f.project.id, inspection.id,
    { parentId: 'root', observationId: first.observation.result.observationId, offset: 100 }),
  { code: 'CURSOR_UNAVAILABLE' });
  assert.equal(reopened.get(f.project.id, inspection.id).history.length, 1);
});

test('complete packet persists even if release acknowledgement fails, and the cursor remains owned', async t => {
  const f = await fixture(t, 2), inspection = await f.prepared();
  f.releaseFailure(true);
  const complete = await f.manager.readChildren(f.project.id, inspection.id, { parentId: 'root' });
  assert.equal(complete.observation.kind, 'children');
  if (complete.observation.kind !== 'children') return;
  assert.equal(complete.observation.result.childrenComplete, true);
  assert.equal(f.manager.get(f.project.id, inspection.id).history.length, 1);
  await assert.rejects(f.manager.readChildren(f.project.id, inspection.id,
    { parentId: 'child-1', observationId: 'new-parent', offset: 0 }), { code: 'SELECTIVE_BUSY' });
  f.releaseFailure(false);
  await f.manager.remove(f.project.id, inspection.id);
  assert.equal(f.manager.list(f.project.id).length, 0);
});

test('the private inspection cache refuses a thirteenth prepared session', async t => {
  const f = await fixture(t, 0);
  for (let index = 0; index < 12; index++) await f.prepared();
  assert.equal(f.manager.list(f.project.id).length, 12);
  await assert.rejects(f.prepared(), { code: 'SELECTIVE_STORAGE_LIMIT' });
  assert.deepEqual(await f.projects.get(f.project.id), f.project);
});
