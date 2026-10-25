import { authenticatePluginSocket } from './bridge-auth-helper.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../src/server/index.js';
import { ProjectStore } from '../src/server/store.js';
import type { Annotation, NodePreviewResult, Operation, PluginCommand, Project, SourceNode } from '../src/shared/contracts.js';
import type { CollectionView, StructureChunk } from '../src/shared/structure-collection.js';
import type { AcquisitionView } from '../src/shared/acquisition.js';

const bounds = { x: -100, y: -100, width: 1000, height: 1000 }, box = { x: 20, y: 20, width: 100, height: 100 };
const exactText = ' 원문 👩‍💻 e\u0301\r\n  <exact>\t';
const root: SourceNode = { id: 'root', parentId: 'page', name: 'Synthetic root', type: 'FRAME', bbox: bounds,
  visible: true, rendering: { opacity: 1 }, sourceFileKey: 'synthetic-file', sourcePageId: 'page' };
const time = '2026-10-26T00:00:00.000Z';
type Request = { type: 'request'; requestId: string; command: PluginCommand };

function packet(collectionId: string, sequence: number, count: number, selected: SourceNode): StructureChunk {
  const offset = sequence * 500, end = Math.min(count, offset + 500), nodes: SourceNode[] = [];
  for (let index = offset; index < end; index++) nodes.push(index === 0 ? selected : {
    ...selected, id: `node-${index}`, parentId: selected.id, name: index === count - 1 ? 'Final requirement' : `Synthetic ${index}`,
    type: index === count - 1 ? 'TEXT' : 'RECTANGLE',
    bbox: index === count - 1 ? box : { x: 600 + index % 20, y: 600 + index % 20, width: 2, height: 2 },
    rendering: { opacity: 1, siblingIndex: index - 1 }, ...(index === count - 1 ? { text: exactText } : {}),
  });
  return { collectionId, sequence, fileKey: selected.sourceFileKey!, pageId: selected.sourcePageId!, root: selected, bounds: selected.bbox!,
    startedAt: time, observedAt: time, nodes, childCounts: nodes.map((_, index) => offset + index === 0 ? count - 1 : 0),
    complete: end === count, nextSequence: end === count ? null : sequence + 1, warnings: [], consistency: 'live-session-observation' };
}

function preview(selected: SourceNode): NodePreviewResult {
  // Header-only synthetic PNG tests transport/storage contracts, not native pixels.
  const png = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(1000, 16); png.writeUInt32BE(1000, 20);
  return { fileKey: selected.sourceFileKey!, pageId: selected.sourcePageId!, node: selected, observedAt: time,
    preview: { mimeType: 'image/png', base64: png.toString('base64'), width: 1000, height: 1000 }, warnings: [] };
}

async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  // This exercises 105k records through encrypted sockets and durable storage.
  // Its deadline is a CI safety bound, not a native performance requirement.
  const end = Date.now() + 60000;
  do { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 5)); } while (Date.now() < end);
  assert.fail('Synthetic evidence acquisition did not settle.');
}

async function fixture(t: test.TestContext, count = 501) {
  const dataDir = await mkdtemp(join(tmpdir(), 'fsb-evidence-server-'));
  let server = await startServer({ port: 0, dataDir, aiConfig: null, requestTimeoutMs: 1000 });
  const token = server.token, requests: Request[] = [];
  const api = (path: string, body?: unknown) => fetch(server.url + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async <T>(path: string, body?: unknown, status = 200): Promise<T> => {
    const response = await api(path, body); assert.equal(response.status, status, await response.clone().text()); return response.json() as Promise<T>;
  };
  let project = await json<Project>('/api/projects', { name: 'Synthetic backed evidence' }, 201), selected = root;
  const base = `/api/projects/${project.id}`;
  const ws = new WebSocket(server.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' });
  t.after(async () => { ws.terminate(); await server.close(); await rm(dataDir, { recursive: true, force: true }); });
  await once(ws, 'open'); const {sessionId} = await authenticatePluginSocket(ws,token,'synthetic-evidence-plugin');
  let releaseHandler: ((request: Request, reply: () => void) => void) | undefined;
  ws.on('message', raw => {
    const request = JSON.parse(String(raw)) as Request; if (request.type !== 'request') return; requests.push(request);
    const command = request.command;
    const result = command.type === 'get_selection' ? { fileKey: selected.sourceFileKey, pageId: selected.sourcePageId,
      nodes: [{ id: selected.id, name: selected.name, type: selected.type, bbox: selected.bbox }] }
      : command.type === 'preview_capture' ? preview(selected)
      : command.type === 'read_structure_chunk' ? packet(command.collectionId, command.sequence, count, selected)
      : command.type === 'release_structure_cursor' ? { released: true } : undefined;
    const reply = () => ws.send(JSON.stringify({ type: 'response', requestId: request.requestId, ok: true, result }));
    if (command.type === 'release_structure_cursor' && releaseHandler) releaseHandler(request, reply);
    else if (result !== undefined) reply();
  });
  const mutate = async (operation: Operation) => project = await json<Project>(base + '/mutate', { expectedRevision: project.revision, operation });
  const prepare = { expectedSessionId: sessionId };
  const collection = async () => {
    const prepared = await json<CollectionView>(base + '/collections', { ...prepare, expectedRevision: project.revision }, 201);
    await json(base + `/collections/${prepared.id}/start`, {}, 202);
    const complete = await until(() => json<CollectionView>(base + `/collections/${prepared.id}`), value => value.status === 'complete' || value.error !== null);
    assert.equal(complete.status, 'complete', JSON.stringify(complete.error)); return complete;
  };
  const overview = async () => {
    const prepared = await json<AcquisitionView>(base + '/acquisitions', { ...prepare, expectedRevision: project.revision }, 201);
    await json(base + `/acquisitions/${prepared.id}/start`, { plan: 'overview', limits: {} }, 202);
    const ready = await until(() => json<AcquisitionView>(base + `/acquisitions/${prepared.id}`), value => ['ready', 'failed'].includes(value.status));
    assert.equal(ready.status, 'ready'); return ready;
  };
  const createScope = async (input: { acquisitionId?: string; collectionId?: string }) => {
    project = await json<Project>(base + '/evidence-scopes', { expectedRevision: project.revision, ...input }, 201); return project.scopes!.at(-1)!;
  };
  const annotation = (scopeId: string): Annotation => ({ id: 'region', snapshotId: scopeId, name: 'Synthetic component', role: 'component',
    parentId: null, bbox: box, sourceRefs: [], reviewStatus: 'proposed', origin: 'human', revision: 0 });
  const matched = async () => {
    const complete = await collection(), scope = await createScope({ collectionId: complete.id });
    await mutate({ type: 'upsert_annotation', annotation: annotation(scope.id) });
    await mutate({ type: 'match_annotation', id: 'region', tolerance: 0.5 }); return { complete, scope };
  };
  const confirm = () => mutate({ type: 'confirm_annotation_sources', id: 'region', expectedAnnotationRevision: project.annotations[0]!.revision });
  const approve = () => mutate({ type: 'review_annotation', id: 'region', status: 'approved' });
  return { api, json, base, dataDir, requests, ws, collection, overview, createScope, mutate, annotation, matched, confirm, approve,
    get project() { return project; }, get server() { return server; }, select(value: SourceNode) { selected = value; },
    holdRelease(handler: NonNullable<typeof releaseHandler>) { releaseHandler = handler; },
    async attach(scopeId: string, collectionId: string) { project = await json<Project>(base + `/evidence-scopes/${scopeId}/attach`, { expectedRevision: project.revision, collectionId }); return project; },
    async history(direction: 'undo' | 'redo') { project = await json<Project>(base + '/' + direction, { expectedRevision: project.revision }); return project; },
    async unchanged() { assert.deepEqual(await json<Project>(base), project); },
    async restart() { await server.close(); server = await startServer({ port: 0, dataDir, token, aiConfig: null }); },
    chunkPath(id: string, sequence = 0) { return join(dataDir, 'structure-collections', id, `${sequence}.json`); },
  };
}

test('HTTP overview draft attaches a complete collection beyond Snapshot limits, matches its final node and exports exact approved evidence', async t => {
  const h = await fixture(t, 105837), image = await h.overview(), scope = await h.createScope({ acquisitionId: image.id });
  assert.equal(scope.kind, 'visual'); assert.equal(h.project.snapshots.length, 0);
  await h.mutate({ type: 'upsert_annotation', annotation: h.annotation(scope.id) });
  for (const operation of [{ type: 'review_annotation', id: 'region', status: 'approved' }, { type: 'match_annotation', id: 'region', tolerance: 0.5 }]) {
    const response = await h.api(h.base + '/mutate', { expectedRevision: h.project.revision, operation });
    assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'SOURCE_INCOMPLETE');
  }
  const complete = await h.collection(); assert.equal(complete.nodeCount, 105837);
  await h.attach(scope.id, complete.id); assert.deepEqual(h.project.scopes![0]!.preview, scope.preview);
  assert.equal(Object.hasOwn(h.project.annotations[0]!, 'sourceReview'), false);
  h.ws.close(); await once(h.ws, 'close');
  await h.mutate({ type: 'match_annotation', id: 'region', tolerance: 0.5 });
  assert.deepEqual(h.project.annotations[0]!.sourceRefs, [{ snapshotId: scope.id, nodeId: 'node-105836', matchType: 'exact', coverage: 1 }]);
  assert.equal(h.project.annotations[0]!.sourceReview?.status, 'unconfirmed');
  const premature = await h.api(h.base + '/mutate', { expectedRevision: h.project.revision, operation: { type: 'review_annotation', id: 'region', status: 'approved' } });
  assert.equal(premature.status, 400); assert.equal((await premature.json()).error.code, 'SOURCE_CONFIRMATION_REQUIRED');
  await h.confirm(); await h.approve();
  const resolved = await h.json<{ nodes: SourceNode[] }>(h.base + `/evidence-scopes/${scope.id}/resolve`, { nodeIds: ['node-105836'] });
  assert.equal(resolved.nodes[0]!.text, exactText);
  await h.mutate({ type: 'upsert_specification', specification: { id: 'requirement', text: exactText,
    sourceRefs: [{ snapshotId: scope.id, nodeId: 'node-105836', matchType: 'exact' }],
    relations: [{ targetAnnotationId: 'region', relationType: 'behavior', reviewStatus: 'proposed' }], reviewStatus: 'proposed', origin: 'human', revision: 0 } });
  await h.mutate({ type: 'review_specification', id: 'requirement', status: 'approved' });
  const exported = await h.json<{ specifications: { text: string }[]; sourceNodes: SourceNode[]; sources: { collection: { contentHash: string; nodeCount: number } }[] }>(h.base + '/export');
  assert.equal(exported.specifications[0]!.text, exactText); assert.equal(exported.sourceNodes[0]!.text, exactText);
  assert.equal(exported.sources[0]!.collection.nodeCount, 105837);
  assert.equal(exported.sources[0]!.collection.contentHash, h.project.scopes![0]!.collection!.contentHash);
  assert.equal(JSON.stringify(exported).includes('base64'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(h.project)) < 15000); assert.equal(h.project.snapshots.length, 0);
  await h.history('undo'); assert.equal(h.project.specifications[0]!.reviewStatus, 'proposed');
  await h.history('redo'); assert.equal(h.project.specifications[0]!.reviewStatus, 'approved');
  const listed = await h.json<{ projects: { id: string; snapshotCount: number }[] }>('/api/projects');
  assert.equal(listed.projects.find(value => value.id === h.project.id)!.snapshotCount, 1);
  const beforeRestart = await h.json(h.base + '/export');
  await h.restart(); await h.unchanged(); assert.deepEqual(await h.json(h.base + '/export'), beforeRestart);
});

test('HTTP rejects forged scopes, stale writes, foreign or wrong source binding, and deletion of bound collections', async t => {
  const h = await fixture(t), image = await h.overview(), scope = await h.createScope({ acquisitionId: image.id });
  const forged = await h.api(h.base + '/mutate', { expectedRevision: h.project.revision, operation: { type: 'add_evidence_scope', scope: { ...scope, id: 'forged' } } });
  assert.equal(forged.status, 403);
  h.select({ ...root, id: 'other-root' }); const wrong = await h.collection(); h.select(root);
  const mismatch = await h.api(h.base + `/evidence-scopes/${scope.id}/attach`, { expectedRevision: h.project.revision, collectionId: wrong.id });
  assert.equal(mismatch.status, 409); assert.equal((await mismatch.json()).error.code, 'SOURCE_BINDING_CHANGED'); await h.unchanged();
  const complete = await h.collection();
  const stale = await h.api(h.base + `/evidence-scopes/${scope.id}/attach`, { expectedRevision: 0, collectionId: complete.id }); assert.equal(stale.status, 409);
  const other = await h.json<Project>('/api/projects', { name: 'Other workspace' }, 201);
  const foreign = await h.api(`/api/projects/${other.id}/evidence-scopes`, { expectedRevision: 0, collectionId: complete.id }); assert.equal(foreign.status, 404);
  await h.attach(scope.id, complete.id);
  assert.equal((await h.api(h.base + `/collections/${complete.id}/remove`, {})).status, 409);
  assert.equal((await h.api(h.base + `/collections/${wrong.id}/remove`, {})).status, 200); await h.unchanged();
});

test('HTTP refuses nonverbatim specification text and unknown source references without modifying the project', async t => {
  const h = await fixture(t), { scope } = await h.matched();
  const annotation = h.project.annotations[0]!;
  const missing = await h.api(h.base + '/mutate', { expectedRevision: h.project.revision, operation: { type: 'upsert_annotation',
    annotation: { ...annotation, sourceRefs: [{ snapshotId: scope.id, nodeId: 'missing', matchType: 'partial' }] } } });
  assert.ok([400, 404].includes(missing.status));
  const changed = await h.api(h.base + '/mutate', { expectedRevision: h.project.revision, operation: { type: 'upsert_specification', specification: {
    id: 'bad-text', text: exactText.trim(), sourceRefs: annotation.sourceRefs,
    relations: [{ targetAnnotationId: 'region', relationType: 'behavior', reviewStatus: 'proposed' }], reviewStatus: 'proposed', origin: 'human', revision: 0 } } });
  assert.equal(changed.status, 400); await h.unchanged();
});

for (const action of ['confirm', 'approve', 'export'] as const) test(`HTTP ${action} rejects damaged unreferenced chunks instead of trusting cached completeness`, async t => {
  const h = await fixture(t), { complete } = await h.matched();
  if (action !== 'confirm') await h.confirm();
  if (action === 'export') await h.approve();
  // The approved/final node is in chunk 1. Damage chunk 0 to invalidate full
  // coverage while leaving the selected record and in-memory index intact.
  await writeFile(h.chunkPath(complete.id), '{}');
  const response = action === 'export' ? await h.api(h.base + '/export') : await h.api(h.base + '/mutate', {
    expectedRevision: h.project.revision, operation: action === 'confirm'
      ? { type: 'confirm_annotation_sources', id: 'region', expectedAnnotationRevision: h.project.annotations[0]!.revision }
      : { type: 'review_annotation', id: 'region', status: 'approved' },
  });
  assert.equal(response.status, 500); assert.equal((await response.json()).error.code, 'COLLECTION_INTEGRITY'); await h.unchanged();
});

for (const direction of ['undo', 'redo'] as const) test(`HTTP ${direction} cannot restore external approval when backing disappears or is corrupt`, async t => {
  const h = await fixture(t), { complete } = await h.matched(); await h.confirm(); await h.approve();
  if (direction === 'undo') await h.mutate({ type: 'upsert_annotation', annotation: { ...h.project.annotations[0]!, name: 'Edited label' } });
  else await h.history('undo');
  const before = await readFile(join(h.dataDir, 'projects', h.project.id + '.json'));
  if (direction === 'undo') await rm(h.chunkPath(complete.id)); else await writeFile(h.chunkPath(complete.id), '{}');
  const response = await h.api(h.base + '/' + direction, { expectedRevision: h.project.revision });
  assert.equal(response.status, 500); assert.equal((await response.json()).error.code, 'COLLECTION_INTEGRITY');
  assert.deepEqual(await readFile(join(h.dataDir, 'projects', h.project.id + '.json')), before); await h.unchanged();
});

test('a store without an evidence resolver cannot restore collection-backed approval from history', async t => {
  const h = await fixture(t); await h.matched(); await h.confirm(); await h.approve();
  await h.mutate({ type: 'upsert_annotation', annotation: { ...h.project.annotations[0]!, name: 'Edited label' } });
  const unconfigured = new ProjectStore(h.dataDir); await unconfigured.initialize();
  await assert.rejects(unconfigured.history(h.project.id, h.project.revision, 'undo'), { code: 'SOURCE_RESOLUTION_REQUIRED' }); await h.unchanged();
});

test('collection removal waiting for Figma cannot delete a scope attached during that wait', async t => {
  const h = await fixture(t), complete = await h.collection(); let release: (() => void) | undefined;
  h.holdRelease((_request, reply) => { release = reply; });
  const removing = h.api(h.base + `/collections/${complete.id}/remove`, {});
  await until(async () => release, value => value !== undefined);
  const scope = await h.createScope({ collectionId: complete.id });
  release!(); const response = await removing; assert.equal(response.status, 409);
  const resolved = await h.json<{ nodes: SourceNode[] }>(h.base + `/evidence-scopes/${scope.id}/resolve`, { nodeIds: ['node-500'] });
  assert.equal(resolved.nodes[0]!.text, exactText); await h.unchanged();
});

test('source import aborted during evidence preparation never starts the atomic project commit', async t => {
  const h = await fixture(t), complete = await h.collection(), scope = await h.createScope({ collectionId: complete.id });
  const target = await h.json<Project>('/api/projects', { name: 'Cancelled import target' }, 201), abort = new AbortController();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  h.server.store.setEvidenceResolver(async (project, operation) => {
    if (project.id === target.id && operation.type === 'add_evidence_scope') { enter(); await held; }
    return h.server.evidence.context(project, operation);
  });
  async function* source() { for await (const line of h.server.transfers.export(h.project.id, scope.id, h.project.revision)) yield Buffer.from(line); }
  const importing = h.server.transfers.import(target.id, 0, source(), abort.signal);
  await entered; abort.abort(); release();
  await assert.rejects(importing, { code: 'CANCELLED' });
  assert.deepEqual(await h.json(`/api/projects/${target.id}`), target); assert.equal(h.server.collections.list(target.id).length, 0);
});

test('a queued trusted mutation observes cancellation after acquiring the project lock', async t => {
  const h = await fixture(t), abort = new AbortController(); let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  h.server.store.setEvidenceResolver(async (project, operation) => {
    if (operation.type === 'rename_project' && operation.name === 'First writer') { enter(); await held; }
    return h.server.evidence.context(project, operation);
  });
  const first = h.server.store.mutate(h.project.id, h.project.revision, { type: 'rename_project', name: 'First writer' });
  await entered;
  const queued = h.server.store.mutate(h.project.id, h.project.revision + 1, { type: 'rename_project', name: 'Cancelled writer' }, 'human', false, abort.signal);
  abort.abort(); release(); const committed = await first;
  await assert.rejects(queued, { code: 'CANCELLED' }); assert.deepEqual(await h.json(h.base), committed);
});

test('component lists, detail and specification reads revalidate collection backing before exposing approvals', async t => {
  const h = await fixture(t), { complete } = await h.matched(); await h.confirm(); await h.approve();
  await h.mutate({ type: 'upsert_specification', specification: { id: 'requirement', text: exactText, sourceRefs: h.project.annotations[0]!.sourceRefs,
    relations: [{ targetAnnotationId: 'region', relationType: 'behavior', reviewStatus: 'proposed' }], reviewStatus: 'proposed', origin: 'human', revision: 0 } });
  await h.mutate({ type: 'review_specification', id: 'requirement', status: 'approved' });
  const paths = ['/components', '/components/region', '/specifications'];
  for (const path of paths) assert.equal((await h.api(h.base + path)).status, 200);
  await writeFile(h.chunkPath(complete.id), '{}');
  for (const path of paths) {
    const response = await h.api(h.base + path); assert.equal(response.status, 500, path);
    assert.equal((await response.json()).error.code, 'COLLECTION_INTEGRITY');
  }
  await h.unchanged();
});
