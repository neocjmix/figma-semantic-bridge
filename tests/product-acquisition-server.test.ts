import { authenticatePluginSocket } from './bridge-auth-helper.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../src/server/index.js';
import { AcquisitionViewSchema, type AcquisitionPlan, type AcquisitionView } from '../src/shared/acquisition.js';
import type { NodePreviewResult, PluginCommand, Project, Selection, Snapshot, SourceNode } from '../src/shared/contracts.js';

const token = 'synthetic-acquisition-token-'.repeat(3);
const bounds = { x: -100, y: -40, width: 100, height: 80 };
const source = { fileKey: 'synthetic-file', pageId: 'synthetic-page', nodeId: 'synthetic-root' };
const root: SourceNode = {
  id: source.nodeId, parentId: source.pageId, name: 'Synthetic scope', type: 'FRAME', bbox: bounds,
  visible: true, rendering: { opacity: 1 }, sourceFileKey: source.fileKey, sourcePageId: source.pageId,
};
const selection: Selection = { fileKey: source.fileKey, pageId: source.pageId,
  nodes: [{ id: root.id, name: root.name, type: root.type, bbox: bounds }] };

function snapshot(): Snapshot {
  return { schemaVersion: '1.0.0', id: 'synthetic-capture', name: 'Synthetic capture',
    source: { fileKey: source.fileKey, pageId: source.pageId, rootId: root.id, revision: null, capturedAt: new Date().toISOString() },
    bounds: { ...bounds }, nodes: [structuredClone(root), { ...structuredClone(root), id: 'synthetic-text', parentId: root.id,
      type: 'TEXT', name: 'Original source label', text: 'Source text stays verbatim.', bbox: { x: -90, y: -30, width: 60, height: 20 } }],
    preview: null, completeness: { complete: true, reason: null }, warnings: [],
  };
}

function overview(): NodePreviewResult {
  // Synthetic wire fixture exercises the server's PNG signature/header contract;
  // it is not a native Figma render or a pixel-visibility assertion.
  const png = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(13, 8); png.write('IHDR', 12);
  png.writeUInt32BE(bounds.width, 16); png.writeUInt32BE(bounds.height, 20);
  return { fileKey: source.fileKey, pageId: source.pageId, node: structuredClone(root), observedAt: new Date().toISOString(),
    preview: { mimeType: 'image/png', base64: png.toString('base64'), width: bounds.width, height: bounds.height }, warnings: [] };
}

type Request = { type: 'request'; requestId: string; command: PluginCommand };
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 3000;
  let value: T;
  do {
    value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for synthetic acquisition: ${JSON.stringify(value!)}`);
}

async function harness(t: test.TestContext) {
  const dataDir = await mkdtemp(join(tmpdir(), 'fsb-acquisition-test-'));
  let server = await startServer({ port: 0, token, dataDir, aiConfig: null, requestTimeoutMs: 1000 });
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const ws of sockets) ws.terminate(); await server.close(); await rm(dataDir, { recursive: true, force: true }); });
  const api = (path: string, method = 'GET', body?: unknown) => fetch(server.url + path, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const created = await api('/api/projects', 'POST', { name: 'Acquisition workspace' });
  assert.equal(created.status, 201);
  const project = await created.json() as Project;
  const base = `/api/projects/${project.id}/acquisitions`;
  const ws = new WebSocket(server.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' });
  sockets.push(ws); await once(ws, 'open');
  const {sessionId} = await authenticatePluginSocket(ws,token,'synthetic-acquisition-plugin');
  const requests: Request[] = [];
  const reply = (request: Request, result: unknown) => ws.send(JSON.stringify({ type: 'response', requestId: request.requestId, ok: true, result }));
  const reject = (request: Request) => ws.send(JSON.stringify({ type: 'response', requestId: request.requestId, ok: false,
    error: { code: 'SYNTHETIC_EXPORT_FAILURE', message: 'Synthetic export did not finish.' } }));
  let onRequest: (request: Request) => void = request => { if (request.command.type === 'get_selection') reply(request, selection); };
  ws.on('message', raw => { const message = JSON.parse(raw.toString()); if (message.type === 'request') { requests.push(message); onRequest(message); } });
  const get = async (id: string) => {
    const response = await api(`${base}/${id}`); assert.equal(response.status, 200);
    return AcquisitionViewSchema.parse(await response.json());
  };
  const terminal = (id: string) => until(() => get(id), value => ['ready', 'partial', 'failed', 'cancelled', 'committed', 'interrupted'].includes(value.status));
  const prepare = async () => {
    const response = await api(base, 'POST', { expectedRevision: project.revision, expectedSessionId: sessionId });
    assert.equal(response.status, 201, await response.clone().text());
    return AcquisitionViewSchema.parse(await response.json());
  };
  const start = async (task: AcquisitionView, plan: AcquisitionPlan, limits = {}) => {
    const response = await api(`${base}/${task.id}/start`, 'POST', { plan, limits });
    assert.equal(response.status, 202, await response.clone().text());
    const view = AcquisitionViewSchema.parse(await response.json()); assert.equal(view.status, 'running'); return view;
  };
  const command = (type: PluginCommand['type'], occurrence = 1) => until(async () => requests.filter(r => r.command.type === type), values => values.length >= occurrence).then(values => values[occurrence - 1]!);
  const assertUnchanged = async () => assert.deepEqual(await (await api(`/api/projects/${project.id}`)).json(), project);
  return { api, project, base, ws, sessionId, requests, reply, reject, get, terminal, prepare, start, command, assertUnchanged, dataDir,
    get url() { return server.url; },
    handle(handler: (request: Request) => void) { onRequest = request => request.command.type === 'get_selection' ? reply(request, selection) : handler(request); },
    handleSelection(handler: (request: Request) => void) { onRequest = handler; },
    async replaceSession() {
      const replacement = new WebSocket(server.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' });
      sockets.push(replacement); await once(replacement, 'open');
      await authenticatePluginSocket(replacement,token,'replacement-synthetic-plugin'); return replacement;
    },
    async reopen() { await server.close(); server = await startServer({ port: 0, token, dataDir, aiConfig: null, requestTimeoutMs: 1000 }); },
  };
}

test('acquisition preparation pins one source without export and exposes only lightweight task state', { timeout: 10000 }, async t => {
  const h = await harness(t), task = await h.prepare();
  assert.equal(task.status, 'prepared'); assert.equal(task.plan, null);
  assert.deepEqual(task.source, { ...source, name: root.name, type: root.type, bounds });
  assert.deepEqual(h.requests.map(r => r.command.type), ['get_selection']);
  const listed = await (await h.api(h.base)).json() as { tasks: unknown[] };
  assert.equal(listed.tasks.length, 1); assert.deepEqual(AcquisitionViewSchema.parse(listed.tasks[0]), await h.get(task.id));
  assert.equal(JSON.stringify(listed).includes('base64'), false); assert.equal('nodes' in task.source, false);
  assert.equal((await h.api(`${h.base}/${task.id}/preview`)).status, 409);
  await h.assertUnchanged();
  assert.equal((await stat(join(h.dataDir, 'acquisitions', task.id + '.json'))).mode & 0o777, 0o600);
});

test('preflight rejects stale revision/session and a project edit during selection before creating a task', { timeout: 10000 }, async t => {
  const h = await harness(t);
  for (const body of [
    { expectedRevision: 1, expectedSessionId: h.sessionId },
    { expectedRevision: 0, expectedSessionId: 'replaced-session' },
  ]) {
    assert.equal((await h.api(h.base, 'POST', body)).status, 409);
  }
  assert.equal(h.requests.length, 0);
  h.handleSelection(() => {});
  const preparing = h.api(h.base, 'POST', { expectedRevision: 0, expectedSessionId: h.sessionId });
  const request = await h.command('get_selection');
  assert.equal((await h.api(`/api/projects/${h.project.id}/mutate`, 'POST', { expectedRevision: 0,
    operation: { type: 'rename_project', name: 'Edited while preparing' } })).status, 200);
  h.reply(request, selection);
  const rejected = await preparing; assert.equal(rejected.status, 409);
  assert.equal((await rejected.json() as { error: { code: string } }).error.code, 'REVISION_CONFLICT');
  assert.deepEqual(await (await h.api(h.base)).json(), { tasks: [] });
});

test('overview is independently available while structure progresses; commit is explicit, idempotent and persistent', { timeout: 15000 }, async t => {
  const h = await harness(t), task = await h.prepare(), image = overview(), metadata = snapshot();
  h.handle(request => { if (request.command.type === 'preview_capture') h.reply(request, image); });
  await h.start(task, 'overview_then_structure');
  const structure = await h.command('capture_metadata');
  assert.deepEqual(h.requests.map(r => r.command.type), ['get_selection', 'preview_capture', 'capture_metadata']);
  for (const request of h.requests.slice(1)) {
    assert.equal('fileKey' in request.command && request.command.fileKey, source.fileKey);
    assert.equal('pageId' in request.command && request.command.pageId, source.pageId);
    assert.equal('nodeId' in request.command && request.command.nodeId, source.nodeId);
  }
  const running = await h.get(task.id);
  assert.equal(running.status, 'running'); assert.equal(running.preview.status, 'ready'); assert.equal(running.structure.status, 'running');
  assert.deepEqual(await (await h.api(`${h.base}/${task.id}/preview`)).json(), image);
  h.ws.send(JSON.stringify({ type: 'progress', requestId: structure.requestId, phase: 'structure', nodes: 1, bytes: 220 }));
  const progress = await until(() => h.get(task.id), view => view.progress.nodes === 1);
  assert.equal(progress.progress.bytes, 220);
  assert.equal(JSON.stringify(progress).includes('base64'), false);
  const progressBarrier = once(h.ws, 'message', { signal: AbortSignal.timeout(2000) });
  h.ws.send(JSON.stringify({ type: 'progress', requestId: structure.requestId, phase: 'structure', nodes: 0, bytes: 100 }));
  h.ws.send(JSON.stringify({ type: 'ping' }));
  assert.deepEqual(JSON.parse((await progressBarrier)[0].toString()), { type: 'pong' });
  assert.equal((await h.get(task.id)).progress.nodes, 1); assert.equal((await h.get(task.id)).progress.bytes, 220);
  await h.assertUnchanged();
  assert.equal((await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 })).status, 409);
  h.reply(structure, metadata);
  const ready = await h.terminal(task.id); assert.equal(ready.status, 'ready'); assert.equal(ready.structure.complete, true);
  await h.assertUnchanged();
  const committed = await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 }); assert.equal(committed.status, 200);
  const project = await committed.json() as Project;
  assert.equal(project.revision, 1); assert.equal(project.snapshots.length, 1);
  const saved = project.snapshots[0]!;
  assert.deepEqual(saved.nodes, metadata.nodes); assert.deepEqual(saved.bounds, metadata.bounds); assert.deepEqual(saved.source, metadata.source);
  assert.deepEqual(saved.preview, image.preview);
  assert.equal(saved.acquisition?.taskId, task.id); assert.equal(saved.acquisition?.consistency, 'separate-observations');
  assert.equal(saved.acquisition?.previewObservedAt, image.observedAt);
  assert.deepEqual(project.annotations, []); assert.deepEqual(project.specifications, []);
  assert.deepEqual(await (await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 })).json(), project);
  await h.reopen();
  assert.equal((await h.get(task.id)).status, 'committed');
  assert.deepEqual(await (await h.api(`${h.base}/${task.id}/preview`)).json(), image);
  assert.deepEqual(await (await h.api(`/api/projects/${project.id}`)).json(), project);
});

for (const plan of ['structure', 'structure_then_overview', 'overview'] as const) {
  test(`acquisition plan ${plan} executes only its requested steps in order`, { timeout: 10000 }, async t => {
    const h = await harness(t), task = await h.prepare();
    h.handle(request => h.reply(request, request.command.type === 'capture_metadata' ? snapshot() : overview()));
    await h.start(task, plan);
    assert.equal((await h.terminal(task.id)).status, 'ready');
    assert.deepEqual(h.requests.map(r => r.command.type), ['get_selection', ...(plan === 'structure' ? ['capture_metadata'] : plan === 'overview' ? ['preview_capture'] : ['capture_metadata', 'preview_capture'])]);
    const response = await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 });
    if (plan === 'overview') {
      assert.equal(response.status, 409); assert.equal((await response.json() as { error: { code: string } }).error.code, 'SOURCE_INCOMPLETE'); await h.assertUnchanged();
    } else {
      assert.equal(response.status, 200);
      assert.equal((await response.json() as Project).snapshots[0]!.preview === null, plan === 'structure');
    }
  });
}

test('partial metadata keeps the original scope, never reports complete, and cannot be committed', { timeout: 10000 }, async t => {
  const h = await harness(t), task = await h.prepare(), partial = snapshot();
  partial.nodes = partial.nodes.slice(0, 1); partial.completeness = { complete: false, reason: 'Synthetic node budget checkpoint.' };
  h.handle(request => h.reply(request, partial)); await h.start(task, 'structure', { maxNodes: 1 });
  const result = await h.terminal(task.id);
  assert.equal(result.status, 'partial'); assert.equal(result.structure.complete, false); assert.equal(result.structure.reason, partial.completeness.reason);
  assert.deepEqual(result.source, task.source); assert.equal(result.progress.nodes, 1);
  const response = await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 });
  assert.equal(response.status, 409); assert.equal((await response.json() as { error: { code: string } }).error.code, 'SOURCE_INCOMPLETE');
  await h.assertUnchanged();
});

for (const failed of ['preview', 'structure'] as const) {
  test(`retrying failed ${failed} preserves the other completed observation`, { timeout: 10000 }, async t => {
    const h = await harness(t), task = await h.prepare(), image = overview(), metadata = snapshot();
    const failingType = failed === 'preview' ? 'preview_capture' : 'capture_metadata';
    h.handle(request => request.command.type === failingType ? h.reject(request) : h.reply(request, request.command.type === 'preview_capture' ? image : metadata));
    await h.start(task, 'overview_then_structure');
    const ended = await h.terminal(task.id); assert.equal(ended.status, 'failed'); assert.equal(ended[failed].status, 'failed');
    assert.equal(ended[failed === 'preview' ? 'structure' : 'preview'].status, 'ready');
    assert.equal((await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 })).status, 409);
    h.handle(request => h.reply(request, request.command.type === 'preview_capture' ? image : metadata));
    const retried = await h.api(`${h.base}/${task.id}/retry`, 'POST', { step: failed }); assert.equal(retried.status, 202, await retried.clone().text());
    assert.equal((await h.terminal(task.id)).status, 'ready');
    assert.equal(h.requests.filter(r => r.command.type === failingType).length, 2);
    assert.equal(h.requests.filter(r => r.command.type === (failed === 'preview' ? 'capture_metadata' : 'preview_capture')).length, 1);
    assert.deepEqual(await (await h.api(`${h.base}/${task.id}/preview`)).json(), image);
    const response = await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 }); assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as Project).snapshots[0]!.nodes, metadata.nodes);
  });
}

test('only one acquisition runs globally; cancel discards late native output and never starts the next step', { timeout: 10000 }, async t => {
  const h = await harness(t), task = await h.prepare();
  const otherProject = await (await h.api('/api/projects', 'POST', { name: 'Another workspace' })).json() as Project;
  const otherBase = `/api/projects/${otherProject.id}/acquisitions`;
  const prepared = await h.api(otherBase, 'POST', { expectedRevision: 0, expectedSessionId: h.sessionId }); assert.equal(prepared.status, 201);
  const second = AcquisitionViewSchema.parse(await prepared.json());
  await h.start(task, 'overview_then_structure'); const pending = await h.command('preview_capture');
  const busy = await h.api(`${otherBase}/${second.id}/start`, 'POST', { plan: 'structure', limits: {} });
  assert.equal(busy.status, 409); assert.equal((await busy.json() as { error: { code: string } }).error.code, 'ACQUISITION_BUSY');
  const cancelled = once(h.ws, 'message', { signal: AbortSignal.timeout(2000) });
  assert.equal((await h.api(`${h.base}/${task.id}/cancel`, 'POST', {})).status, 200);
  assert.deepEqual(JSON.parse((await cancelled)[0].toString()), { type: 'cancel', requestId: pending.requestId });
  assert.equal((await h.terminal(task.id)).status, 'cancelled');
  const barrier = once(h.ws, 'message', { signal: AbortSignal.timeout(2000) });
  h.reply(pending, overview()); h.ws.send(JSON.stringify({ type: 'ping' }));
  assert.deepEqual(JSON.parse((await barrier)[0].toString()), { type: 'pong' });
  assert.equal((await h.get(task.id)).status, 'cancelled');
  assert.equal(h.requests.some(r => r.command.type === 'capture_metadata'), false);
  assert.equal((await h.api(`${h.base}/${task.id}/preview`)).status, 409);
  assert.equal((await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 })).status, 409);
  await h.assertUnchanged();
  h.handle(request => h.reply(request, snapshot()));
  const next = await h.api(`${otherBase}/${second.id}/start`, 'POST', { plan: 'structure', limits: {} }); assert.equal(next.status, 202, await next.clone().text());
  const nextDone = await until(async () => AcquisitionViewSchema.parse(await (await h.api(`${otherBase}/${second.id}`)).json()), value => value.status === 'ready');
  assert.equal(nextDone.projectId, otherProject.id);
});

for (const changed of ['file', 'page', 'root', 'bounds', 'name'] as const) {
  test(`a structure result with changed ${changed} cannot replace the source pinned at preparation`, { timeout: 10000 }, async t => {
    const h = await harness(t), task = await h.prepare(), altered = snapshot();
    if (changed === 'file') { altered.source.fileKey = 'other-file'; for (const node of altered.nodes) node.sourceFileKey = 'other-file'; }
    if (changed === 'page') { altered.source.pageId = 'other-page'; for (const node of altered.nodes) node.sourcePageId = 'other-page'; }
    if (changed === 'root') altered.source.rootId = 'synthetic-text';
    if (changed === 'bounds') altered.bounds.x += 1;
    if (changed === 'name') altered.nodes[0]!.name = 'Changed source name';
    h.handle(request => h.reply(request, altered)); await h.start(task, 'structure');
    const ended = await h.terminal(task.id); assert.equal(ended.status, 'failed'); assert.equal(ended.structure.status, 'failed');
    assert.equal((await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 })).status, 409);
    await h.assertUnchanged();
  });
}

for (const hostile of ['svg', 'wrong-dimensions', 'foreign-source', 'node-file-provenance', 'node-page-provenance', 'unexpected-structure-image'] as const) {
  test(`acquisition rejects ${hostile} output before exposing or saving it`, { timeout: 10000 }, async t => {
    const h = await harness(t), task = await h.prepare(), image = overview(), metadata = snapshot();
    if (hostile === 'svg') image.preview.base64 = Buffer.from('<svg onload="alert(1)"/>').toString('base64');
    if (hostile === 'wrong-dimensions') image.preview.width += 1;
    if (hostile === 'foreign-source') { image.fileKey = 'other-file'; image.node.sourceFileKey = 'other-file'; }
    if (hostile === 'node-file-provenance') image.node.sourceFileKey = 'other-file';
    if (hostile === 'node-page-provenance') image.node.sourcePageId = 'other-page';
    if (hostile === 'unexpected-structure-image') metadata.preview = image.preview;
    h.handle(request => h.reply(request, hostile === 'unexpected-structure-image' ? metadata : image));
    await h.start(task, hostile === 'unexpected-structure-image' ? 'structure' : 'overview');
    assert.equal((await h.terminal(task.id)).status, 'failed');
    assert.equal((await h.api(`${h.base}/${task.id}/preview`)).status, 409);
    assert.equal((await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 })).status, 409);
    await h.assertUnchanged();
  });
}

test('overview-only can explicitly load structure later without exporting the image again', { timeout: 10000 }, async t => {
  const h = await harness(t), task = await h.prepare(), image = overview(), metadata = snapshot();
  image.warnings = ['Synthetic overview observation warning.'];
  metadata.warnings = ['Synthetic metadata observation warning.'];
  h.handle(request => h.reply(request, request.command.type === 'preview_capture' ? image : metadata));
  await h.start(task, 'overview'); assert.equal((await h.terminal(task.id)).status, 'ready');
  await h.assertUnchanged();
  const response = await h.api(`${h.base}/${task.id}/load-structure`, 'POST', { limits: {} }); assert.equal(response.status, 202, await response.clone().text());
  const ready = await h.terminal(task.id);
  assert.equal(ready.status, 'ready'); assert.equal(ready.plan, 'overview_then_structure');
  assert.deepEqual(h.requests.map(r => r.command.type), ['get_selection', 'preview_capture', 'capture_metadata']);
  assert.deepEqual(await (await h.api(`${h.base}/${task.id}/preview`)).json(), image);
  assert.ok(ready.warnings.includes(image.warnings[0]!)); assert.ok(ready.warnings.includes(metadata.warnings[0]!));
  const committed = await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 }); assert.equal(committed.status, 200);
  const saved = (await committed.json() as Project).snapshots[0]!;
  assert.deepEqual(saved.preview, image.preview); assert.deepEqual(saved.nodes, metadata.nodes);
  assert.equal(saved.acquisition?.previewObservedAt, image.observedAt);
  assert.ok(saved.warnings.includes(image.warnings[0]!)); assert.ok(saved.warnings.includes(metadata.warnings[0]!));
});

for (const changed of ['parent', 'visibility', 'opacity', 'text'] as const) {
  test(`separate observations with changed root ${changed} cannot be combined into a saved capture`, { timeout: 10000 }, async t => {
    const h = await harness(t), task = await h.prepare(), image = overview(), metadata = snapshot();
    if (changed === 'parent') metadata.nodes[0]!.parentId = 'other-parent';
    if (changed === 'visibility') metadata.nodes[0]!.visible = false;
    if (changed === 'opacity') metadata.nodes[0]!.rendering = { opacity: 0 };
    if (changed === 'text') metadata.nodes[0]!.text = 'Changed source scalar.';
    h.handle(request => h.reply(request, request.command.type === 'preview_capture' ? image : metadata));
    await h.start(task, 'overview'); assert.equal((await h.terminal(task.id)).status, 'ready');
    const loading = await h.api(`${h.base}/${task.id}/load-structure`, 'POST', { limits: {} }); assert.equal(loading.status, 202, await loading.clone().text());
    const ended = await h.terminal(task.id);
    assert.equal(ended.status, 'failed'); assert.equal(ended.error?.code, 'SOURCE_METADATA_CHANGED');
    assert.equal((await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 })).status, 409);
    assert.deepEqual(await (await h.api(`${h.base}/${task.id}/preview`)).json(), image);
    await h.assertUnchanged();
  });
}

test('removing a task releases its cache without removing a committed project capture', { timeout: 10000 }, async t => {
  const h = await harness(t), task = await h.prepare();
  await h.start(task, 'structure'); const request = await h.command('capture_metadata');
  assert.equal((await h.api(`${h.base}/${task.id}/remove`, 'POST', {})).status, 409);
  h.reply(request, snapshot()); assert.equal((await h.terminal(task.id)).status, 'ready');
  const committed = await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 }); assert.equal(committed.status, 200);
  const project = await committed.json() as Project;
  const removed = await h.api(`${h.base}/${task.id}/remove`, 'POST', {}); assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { removed: true });
  assert.equal((await h.api(`${h.base}/${task.id}`)).status, 404);
  assert.equal((await h.api(`${h.base}/${task.id}/preview`)).status, 404);
  assert.deepEqual(await (await h.api(h.base)).json(), { tasks: [] });
  await assert.rejects(stat(join(h.dataDir, 'acquisitions', task.id + '.json')), { code: 'ENOENT' });
  assert.deepEqual(await (await h.api(`/api/projects/${project.id}`)).json(), project);
  await h.reopen();
  assert.deepEqual(await (await h.api(h.base)).json(), { tasks: [] });
  assert.deepEqual(await (await h.api(`/api/projects/${project.id}`)).json(), project);
});

test('replacing a pinned Figma session during metadata keeps the earlier image but prevents retry or commit', { timeout: 10000 }, async t => {
  const h = await harness(t), task = await h.prepare(), image = overview();
  h.handle(request => { if (request.command.type === 'preview_capture') h.reply(request, image); });
  await h.start(task, 'overview_then_structure'); await h.command('capture_metadata');
  const closed = once(h.ws, 'close', { signal: AbortSignal.timeout(2000) });
  const replacement = await h.replaceSession();
  assert.equal((await closed)[0], 4001);
  const replacementRequests: unknown[] = []; replacement.on('message', data => replacementRequests.push(JSON.parse(data.toString())));
  const failed = await h.terminal(task.id); assert.equal(failed.status, 'failed'); assert.equal(failed.structure.complete, false);
  assert.deepEqual(await (await h.api(`${h.base}/${task.id}/preview`)).json(), image);
  const retry = await h.api(`${h.base}/${task.id}/retry`, 'POST', { step: 'structure' }); assert.equal(retry.status, 409);
  assert.equal((await retry.json() as { error: { code: string } }).error.code, 'PLUGIN_SESSION_CHANGED');
  assert.equal((await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 })).status, 409);
  assert.deepEqual(replacementRequests, []); await h.assertUnchanged();
});

test('closing the preflight HTTP request cancels selection work and cannot leave a prepared task', { timeout: 10000 }, async t => {
  const h = await harness(t); h.handleSelection(() => {});
  const abort = new AbortController(); t.after(() => abort.abort());
  const pending = fetch(h.url + h.base, { method: 'POST', signal: abort.signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 0, expectedSessionId: h.sessionId }) });
  const rejected = assert.rejects(pending, /abort/i);
  const request = await h.command('get_selection');
  const cancellation = once(h.ws, 'message', { signal: AbortSignal.timeout(2000) }); abort.abort(); await rejected;
  assert.deepEqual(JSON.parse((await cancellation)[0].toString()), { type: 'cancel', requestId: request.requestId });
  const barrier = once(h.ws, 'message', { signal: AbortSignal.timeout(2000) });
  h.reply(request, selection); h.ws.send(JSON.stringify({ type: 'ping' }));
  assert.deepEqual(JSON.parse((await barrier)[0].toString()), { type: 'pong' });
  assert.deepEqual(await (await h.api(h.base)).json(), { tasks: [] }); await h.assertUnchanged();
});

test('cancelling metadata retains its completed overview but discards late structure and progress', { timeout: 10000 }, async t => {
  const h = await harness(t), task = await h.prepare(), image = overview();
  h.handle(request => { if (request.command.type === 'preview_capture') h.reply(request, image); });
  await h.start(task, 'overview_then_structure'); const request = await h.command('capture_metadata');
  const cancellation = once(h.ws, 'message', { signal: AbortSignal.timeout(2000) });
  assert.equal((await h.api(`${h.base}/${task.id}/cancel`, 'POST', {})).status, 200);
  assert.deepEqual(JSON.parse((await cancellation)[0].toString()), { type: 'cancel', requestId: request.requestId });
  const cancelled = await h.terminal(task.id); assert.equal(cancelled.status, 'cancelled');
  const barrier = once(h.ws, 'message', { signal: AbortSignal.timeout(2000) });
  h.ws.send(JSON.stringify({ type: 'progress', requestId: request.requestId, phase: 'structure', nodes: 2, bytes: 700 }));
  h.reply(request, snapshot()); h.ws.send(JSON.stringify({ type: 'ping' }));
  assert.deepEqual(JSON.parse((await barrier)[0].toString()), { type: 'pong' });
  const afterLate = await h.get(task.id);
  assert.equal(afterLate.status, 'cancelled'); assert.equal(afterLate.structure.complete, false);
  assert.equal(afterLate.progress.nodes, cancelled.progress.nodes); assert.equal(afterLate.progress.bytes, cancelled.progress.bytes);
  assert.deepEqual(await (await h.api(`${h.base}/${task.id}/preview`)).json(), image);
  assert.equal((await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 })).status, 409);
  await h.assertUnchanged();
});

test('bounded task cache requires explicit removal before another preflight can read source', { timeout: 10000 }, async t => {
  const h = await harness(t), tasks: AcquisitionView[] = [];
  for (let i = 0; i < 12; i++) tasks.push(await h.prepare());
  const requestsBefore = h.requests.length;
  const rejected = await h.api(h.base, 'POST', { expectedRevision: 0, expectedSessionId: h.sessionId });
  assert.equal(rejected.status, 413); assert.equal((await rejected.json() as { error: { code: string } }).error.code, 'ACQUISITION_STORAGE_LIMIT');
  assert.equal(h.requests.length, requestsBefore);
  assert.equal((await h.api(`${h.base}/${tasks[0]!.id}/remove`, 'POST', {})).status, 200);
  await h.prepare();
  assert.equal(h.requests.length, requestsBefore + 1);
  const listed = await (await h.api(h.base)).json() as { tasks: AcquisitionView[] };
  assert.equal(listed.tasks.length, 12); await h.assertUnchanged();
});

for (const budget of ['nodes', 'bytes'] as const) {
  test(`metadata reporting complete after exceeding the agreed ${budget} budget is rejected`, { timeout: 10000 }, async t => {
    const h = await harness(t), task = await h.prepare(), oversized = snapshot();
    if (budget === 'bytes') oversized.nodes[1]!.text = 'Synthetic long text.'.repeat(200);
    h.handle(request => h.reply(request, oversized));
    await h.start(task, 'structure', budget === 'nodes' ? { maxNodes: 1 } : { maxBytes: 1024 });
    const ended = await h.terminal(task.id); assert.equal(ended.status, 'failed'); assert.equal(ended.structure.complete, false);
    assert.equal((await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 })).status, 409);
    await h.assertUnchanged();
  });
}

test('restart marks interrupted work honestly and retains a completed image without creating a snapshot', { timeout: 10000 }, async t => {
  const h = await harness(t), task = await h.prepare();
  const file = join(h.dataDir, 'acquisitions', task.id + '.json');
  const stored = JSON.parse(await readFile(file, 'utf8'));
  const image = overview();
  // Synthetic crash journal: preview was persisted, metadata was in flight.
  stored.view.status = 'running'; stored.view.stage = 'structure'; stored.view.plan = 'overview_then_structure';
  stored.view.preview = { status: 'ready', observedAt: image.observedAt, error: null };
  stored.view.structure.status = 'running'; stored.preview = image;
  await writeFile(file, JSON.stringify(stored), { mode: 0o600 });
  await h.reopen();
  const restored = await h.get(task.id);
  assert.equal(restored.status, 'interrupted'); assert.equal(restored.structure.status, 'failed'); assert.equal(restored.structure.complete, false);
  assert.equal(restored.preview.status, 'ready'); assert.deepEqual(await (await h.api(`${h.base}/${task.id}/preview`)).json(), image);
  assert.equal((await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 })).status, 409);
  await h.assertUnchanged();
});

test('restart reconciles two persisted ready observations without repeating native work', { timeout: 10000 }, async t => {
  const h = await harness(t), task = await h.prepare(), image = overview(), metadata = snapshot();
  h.handle(request => h.reply(request, request.command.type === 'preview_capture' ? image : metadata));
  await h.start(task, 'overview_then_structure'); assert.equal((await h.terminal(task.id)).status, 'ready');
  const file = join(h.dataDir, 'acquisitions', task.id + '.json');
  const stored = JSON.parse(await readFile(file, 'utf8'));
  // Crash after both validated step results were saved but before final status.
  stored.view.status = 'running'; stored.view.stage = 'structure';
  await writeFile(file, JSON.stringify(stored), { mode: 0o600 });
  await h.reopen();
  const restored = await h.get(task.id);
  assert.equal(restored.status, 'ready'); assert.equal(restored.preview.status, 'ready'); assert.equal(restored.structure.complete, true);
  assert.deepEqual(await (await h.api(`${h.base}/${task.id}/preview`)).json(), image);
  await h.assertUnchanged();
  const committed = await h.api(`${h.base}/${task.id}/commit`, 'POST', { expectedRevision: 0 }); assert.equal(committed.status, 200);
  const saved = (await committed.json() as Project).snapshots[0]!;
  assert.deepEqual(saved.nodes, metadata.nodes); assert.deepEqual(saved.preview, image.preview);
  assert.deepEqual(h.requests.map(r => r.command.type), ['get_selection', 'preview_capture', 'capture_metadata']);
});
