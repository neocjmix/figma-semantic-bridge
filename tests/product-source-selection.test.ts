import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createDemoProject } from '../src/demo/project.js';
import { startServer } from '../src/server/index.js';
import type { Project, Selection } from '../src/shared/contracts.js';

const token = 'synthetic-selection-review-token-'.repeat(2);
async function harness(t: test.TestContext, withoutIdentity = false) {
  const dataDir = await mkdtemp(join(tmpdir(), 'fsb-selection-review-'));
  const server = await startServer({ port: 0, dataDir, token, aiConfig: null });
  t.after(async () => { await server.close(); await rm(dataDir, { recursive: true, force: true }); });
  const demo = createDemoProject(), snapshot = demo.snapshots[0]!;
  snapshot.preview = null;
  const brand = snapshot.nodes.find(node => node.id === 'brand')!;
  const target = snapshot.nodes.find(node => node.id === 'heading')!;
  const sidebar = snapshot.nodes.find(node => node.id === 'sidebar')!;
  sidebar.type = 'FRAME'; brand.parentId = sidebar.id;
  snapshot.nodes.push({ ...target, id: 'header-branch', type: 'FRAME', parentId: snapshot.source.rootId });
  target.parentId = 'header-branch';
  if (withoutIdentity) {
    snapshot.source.fileKey = null;
    for (const node of snapshot.nodes) node.sourceFileKey = null;
  }
  demo.annotations = [{ id: 'review-target', snapshotId: snapshot.id, name: 'Reviewed brand', role: 'element',
    bbox: brand.bbox!, parentId: null, sourceRefs: [{ snapshotId: snapshot.id, nodeId: brand.id, matchType: 'exact' }],
    origin: 'human', reviewStatus: 'approved', revision: 1 }];
  const specNode = demo.snapshots[1]!.nodes.find(node => node.id === 'spec-search')!;
  demo.specifications = [{ id: 'approved-spec', text: specNode.text!,
    sourceRefs: [{ snapshotId: demo.snapshots[1]!.id, nodeId: specNode.id, matchType: 'exact' }],
    relations: [{ targetAnnotationId: 'review-target', relationType: 'behavior', reviewStatus: 'approved' }],
    origin: 'human', reviewStatus: 'approved', revision: 1 }];
  const project = await server.store.importProject(demo);
  const path = `/api/projects/${project.id}/source-selection`;
  const api = (body: unknown, signal?: AbortSignal) => fetch(server.url + path, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), ...(signal ? { signal } : {}),
  });
  const connect = async () => {
    const ws = new WebSocket(server.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' });
    t.after(() => ws.terminate());
    await once(ws, 'open');
    const welcomed = once(ws, 'message');
    ws.send(JSON.stringify({ type: 'hello', token, clientId: 'synthetic-selection-review' }));
    const welcome = JSON.parse((await welcomed)[0].toString()) as { sessionId: string };
    return { ws, sessionId: welcome.sessionId };
  };
  const plugin = await connect();
  const selection: Selection = { fileKey: snapshot.source.fileKey, pageId: snapshot.source.pageId,
    nodes: [{ id: target.id, name: target.name, type: target.type, bbox: target.bbox }] };
  const input = { expectedRevision: project.revision, annotationId: 'review-target', expectedSessionId: plugin.sessionId };
  const disk = () => readFile(join(dataDir, 'projects', `${project.id}.json`), 'utf8');
  return { ...server, ...plugin, project, snapshot, target, selection, input, api, path, connect, disk };
}
function reply(ws: WebSocket, request: { requestId: string }, selection: Selection) {
  ws.send(JSON.stringify({ type: 'response', requestId: request.requestId, ok: true, result: selection }));
}
async function expectCode(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, code);
}

test('source-selection returns a distant captured node without changing approvals, source or history', async t => {
  const h = await harness(t), before = await h.disk();
  h.ws.on('message', raw => {
    const request = JSON.parse(raw.toString());
    assert.equal(request.command.type, 'get_selection');
    reply(h.ws, request, h.selection);
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await h.api(h.input);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { projectId: h.project.id, revision: h.project.revision,
      annotationId: 'review-target', snapshotId: h.snapshot.id, sessionId: h.sessionId, selected: h.selection.nodes[0],
      sourceRef: { snapshotId: h.snapshot.id, nodeId: h.target.id, matchType: 'partial' } });
    assert.equal(await h.disk(), before);
    assert.deepEqual(await h.store.get(h.project.id), h.project);
  }
  assert.notEqual(h.target.parentId, h.snapshot.nodes.find(node => node.id === 'brand')!.parentId);
  assert.notDeepEqual(h.target.bbox, h.project.annotations[0]!.bbox);
});

test('source-selection rejects wrong identity, uncaptured IDs and stale selection metadata without writes', async t => {
  const h = await harness(t), before = await h.disk();
  let selection = h.selection;
  h.ws.on('message', raw => reply(h.ws, JSON.parse(raw.toString()), selection));
  const cases: Array<{ value: Selection; status: number; code: string }> = [
    { value: { ...h.selection, nodes: [] }, status: 400, code: 'INVALID_SELECTION' },
    { value: { ...h.selection, nodes: [...h.selection.nodes, h.selection.nodes[0]!] }, status: 400, code: 'INVALID_SELECTION' },
    { value: { ...h.selection, fileKey: null }, status: 409, code: 'FILE_IDENTITY_UNAVAILABLE' },
    { value: { ...h.selection, fileKey: 'different-file-with-same-node-ids' }, status: 409, code: 'WRONG_FILE' },
    { value: { ...h.selection, pageId: 'different-page' }, status: 409, code: 'WRONG_PAGE' },
    { value: { ...h.selection, nodes: [{ ...h.selection.nodes[0]!, id: 'uncaptured-node' }] }, status: 409, code: 'SOURCE_OUTSIDE_CAPTURE' },
    { value: { ...h.selection, nodes: [{ ...h.selection.nodes[0]!, name: 'Changed name' }] }, status: 409, code: 'SOURCE_METADATA_CHANGED' },
    { value: { ...h.selection, nodes: [{ ...h.selection.nodes[0]!, type: 'RECTANGLE' }] }, status: 409, code: 'SOURCE_METADATA_CHANGED' },
    { value: { ...h.selection, nodes: [{ ...h.selection.nodes[0]!, bbox: { ...h.target.bbox!, x: h.target.bbox!.x + 1 } }] }, status: 409, code: 'SOURCE_METADATA_CHANGED' },
    { value: { ...h.selection, nodes: [{ ...h.selection.nodes[0]!, bbox: null }] }, status: 409, code: 'SOURCE_METADATA_CHANGED' },
  ];
  for (const scenario of cases) {
    selection = scenario.value;
    await expectCode(await h.api(h.input), scenario.status, scenario.code);
    assert.equal(await h.disk(), before);
  }
  assert.deepEqual(await h.store.get(h.project.id), h.project);
});

test('source-selection rejects stale project/session and missing annotation before plugin dispatch', async t => {
  const h = await harness(t), before = await h.disk(), dispatch = t.mock.method(h.broker, 'request');
  await expectCode(await h.api({ ...h.input, expectedRevision: 1 }), 409, 'REVISION_CONFLICT');
  await expectCode(await h.api({ ...h.input, expectedSessionId: 'previous-session' }), 409, 'PLUGIN_SESSION_CHANGED');
  await expectCode(await h.api({ ...h.input, annotationId: 'missing' }), 404, 'NOT_FOUND');
  await expectCode(await h.api({ ...h.input, forgedNodeIds: [h.target.id] }), 400, 'INVALID_INPUT');
  assert.equal(dispatch.mock.callCount(), 0);
  assert.equal(await h.disk(), before);
});

test('source-selection rejects unidentified captures before plugin dispatch', async t => {
  const h = await harness(t, true), before = await h.disk(), dispatch = t.mock.method(h.broker, 'request');
  await expectCode(await h.api(h.input), 409, 'FILE_IDENTITY_UNAVAILABLE');
  assert.equal(dispatch.mock.callCount(), 0);
  assert.equal(await h.disk(), before);
});

test('source-selection rechecks project revision after a plugin response', async t => {
  const h = await harness(t);
  const requested = once(h.ws, 'message');
  const pending = h.api(h.input);
  const request = JSON.parse((await requested)[0].toString());
  const updated = await h.store.mutate(h.project.id, h.project.revision, { type: 'rename_project', name: 'Concurrent edit' });
  const afterConcurrentEdit = await h.disk();
  reply(h.ws, request, h.selection);
  await expectCode(await pending, 409, 'REVISION_CONFLICT');
  assert.equal(await h.disk(), afterConcurrentEdit);
  assert.deepEqual(await h.store.get(h.project.id), updated);
});

test('source-selection rechecks the plugin session after the final asynchronous project read', { timeout: 5000 }, async t => {
  const h = await harness(t), before = await h.disk();
  let entered!: () => void, release!: () => void, reads = 0;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const get = h.store.get.bind(h.store);
  t.mock.method(h.store, 'get', async (id: string) => {
    const result = await get(id);
    if (++reads === 2) { entered(); await gate; }
    return result;
  });
  h.ws.on('message', raw => reply(h.ws, JSON.parse(raw.toString()), h.selection));
  const pending = h.api(h.input);
  await reading;
  const replacement = await h.connect();
  assert.notEqual(replacement.sessionId, h.sessionId);
  release();
  await expectCode(await pending, 409, 'PLUGIN_SESSION_CHANGED');
  assert.equal(await h.disk(), before);
});

test('source-selection cancelled during the initial project read never dispatches or writes', { timeout: 5000 }, async t => {
  const h = await harness(t), before = await h.disk(), dispatch = t.mock.method(h.broker, 'request');
  let entered!: () => void, release!: () => void, closed!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  t.after(() => release());
  t.mock.method(h.store, 'get', async () => { entered(); await gate; return h.project; }, { times: 1 });
  const emit = ServerResponse.prototype.emit;
  t.mock.method(ServerResponse.prototype, 'emit', function (this: ServerResponse, event: string | symbol, ...args: unknown[]) {
    const result = emit.call(this, event, ...args);
    if (event === 'close' && this.req.url === h.path) closed();
    return result;
  });
  const abort = new AbortController();
  const rejection = assert.rejects(h.api(h.input, abort.signal), /abort/i);
  await reading;
  abort.abort(); await rejection; await disconnected;
  release();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(dispatch.mock.callCount(), 0);
  assert.equal(h.broker.status.pendingRequests, 0);
  assert.equal(await h.disk(), before);
});

test('source-selection cancellation reaches the plugin and ignores a late reply', { timeout: 5000 }, async t => {
  const h = await harness(t), before = await h.disk();
  const requested = once(h.ws, 'message');
  const abort = new AbortController();
  const rejection = assert.rejects(h.api(h.input, abort.signal), /abort/i);
  const request = JSON.parse((await requested)[0].toString());
  const cancelled = once(h.ws, 'message');
  abort.abort(); await rejection;
  assert.deepEqual(JSON.parse((await cancelled)[0].toString()), { type: 'cancel', requestId: request.requestId });
  const pong = once(h.ws, 'message');
  reply(h.ws, request, h.selection);
  h.ws.send(JSON.stringify({ type: 'ping' }));
  assert.deepEqual(JSON.parse((await pong)[0].toString()), { type: 'pong' });
  assert.equal(h.broker.status.pendingRequests, 0);
  assert.equal(await h.disk(), before);
});
