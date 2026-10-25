import { authenticatePluginSocket } from './bridge-auth-helper.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startServer } from '../src/server/index.js';
import { createDemoProject } from '../src/demo/project.js';
import { BridgeApi, BridgeApiError } from '../src/mcp/api-client.js';
import { createMcpServer } from '../src/mcp/server.js';
import type { Annotation, Project, Specification } from '../src/shared/contracts.js';
import { PRODUCT_VERSION, SERVICE_NAME } from '../src/shared/version.js';

test('real MCP stdio -> authenticated HTTP -> plugin WS, persisted approval reads and proposal protection', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fsb-mcp-'));
  const server = await startServer({ port: 0, dataDir });
  const api = new BridgeApi(server.url, server.token, {allowInsecureHttp:true});
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/mcp/cli.ts'],
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), FSB_DATA_DIR: dataDir, FSB_SERVER_URL: server.url, FSB_ALLOW_INSECURE_HTTP:'1' }, stderr: 'pipe' });
  t.after(async () => { await client.close(); await server.close(); await rm(dataDir, { recursive: true, force: true }); });
  await client.connect(transport);
  assert.deepEqual(client.getServerVersion(), { name: SERVICE_NAME, version: PRODUCT_VERSION });
  const tools = await client.listTools();
  assert.ok(tools.tools.some(tool => tool.name === 'propose_changes'));
  assert.ok(!tools.tools.some(tool => /^(approve_|delete_|shell)/.test(tool.name)));
  const disconnected = await client.callTool({ name: 'get_selected_node', arguments: {} });
  assert.equal(disconnected.isError, true);
  assert.match(JSON.stringify(disconnected), /PLUGIN_DISCONNECTED/);

  const ws = new WebSocket(server.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' });
  t.after(() => ws.terminate());
  await once(ws, 'open'); await authenticatePluginSocket(ws,server.token,'synthetic-plugin-emulator');
  let highlighted = false;
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString()); if (message.type !== 'request') return;
    const snapshot = createDemoProject().snapshots[0]!;
    let result: unknown;
    if (message.command.type === 'get_selection') result = { fileKey: 'generated-demo', pageId: 'demo-page', nodes: [{ id: 'screen', name: 'Generated screen', type: 'FRAME', bbox: snapshot.bounds }] };
    else if (message.command.type === 'highlight_nodes') { highlighted = true; result = { highlightedNodeIds: message.command.nodeIds }; }
    else result = { ...snapshot, id: 'captured-emulator-scope' };
    ws.send(JSON.stringify({ type: 'response', requestId: message.requestId, ok: true, result }));
  });
  const selected = await client.callTool({ name: 'get_selected_node', arguments: {} });
  assert.equal(selected.isError, undefined); assert.match(JSON.stringify(selected), /Generated screen/);
  let project = await api.request<Project>('/api/demo', {});
  const annotation: Annotation = { id: 'search-component', snapshotId: 'demo-ui', name: 'Search', role: 'component', bbox: { x: 320, y: 250, width: 480, height: 48 }, parentId: null, sourceRefs: [], origin: 'human', reviewStatus: 'proposed', revision: 0 };
  const mutate = async (operation: unknown) => { project = await api.request<Project>(`/api/projects/${project.id}/mutate`, { expectedRevision: project.revision, operation }); };
  await mutate({ type: 'upsert_annotation', annotation });
  let context = await api.request<{ annotations: unknown[] }>(`/api/projects/${project.id}/export`); assert.equal(context.annotations.length, 0);
  await mutate({ type: 'match_annotation', id: annotation.id, tolerance: 0.5 });
  await mutate({ type: 'review_annotation', id: annotation.id, status: 'approved' });
  const specification: Specification = { id: 'search-rule', text: project.snapshots[1]!.nodes.find(n => n.id === 'spec-search')!.text!,
    sourceRefs: [{ snapshotId: 'demo-notes', nodeId: 'spec-search', matchType: 'exact' }],
    relations: [{ targetAnnotationId: annotation.id, relationType: 'behavior', reviewStatus: 'proposed' }], origin: 'human', reviewStatus: 'proposed', revision: 0 };
  await mutate({ type: 'upsert_specification', specification });
  await mutate({ type: 'review_specification', id: specification.id, status: 'approved' });
  const approved = await client.callTool({ name: 'get_approved_context', arguments: { projectId: project.id } });
  assert.equal(approved.isError, undefined);
  const encoded = JSON.stringify(approved); assert.match(encoded, /search-component/); assert.match(encoded, /Minimum input is 2 characters/); assert.doesNotMatch(encoded, /image\/png|base64/);
  assert.equal((await server.store.get(project.id)).annotations[0]!.reviewStatus, 'approved');
  for (const [name, args] of [
    ['list_components', { projectId: project.id, offset: 0, limit: 1 }],
    ['get_component', { projectId: project.id, annotationId: annotation.id }],
    ['list_specifications', { projectId: project.id, annotationId: annotation.id, offset: 0, limit: 1 }],
  ] as const) {
    const page = await client.callTool({ name, arguments: args });
    assert.equal(page.isError, undefined, JSON.stringify(page));
    assert.match(JSON.stringify(page), /search-component/);
    assert.doesNotMatch(JSON.stringify(page), /image\/png|base64/);
  }
  const missing = await client.callTool({ name: 'get_component', arguments: { projectId: project.id, annotationId: 'missing' } });
  assert.equal(missing.isError, true);
  const captured = await client.callTool({ name: 'capture_selection', arguments: { projectId: project.id, expectedRevision: project.revision } });
  assert.equal(captured.isError, undefined); assert.match(JSON.stringify(captured), /captured-emulator-scope/);
  project = await server.store.get(project.id);
  const highlight = await client.callTool({ name: 'highlight_source_nodes', arguments: { fileKey: 'generated-demo', pageId: 'demo-page', nodeIds: ['search-bg'] } });
  assert.equal(highlight.isError, undefined); assert.equal(highlighted, true);
  const blocked = await client.callTool({ name: 'propose_changes', arguments: { projectId: project.id, expectedRevision: project.revision, draft: { annotations: [{ ...project.annotations[0]!, origin: 'ai', reviewStatus: 'proposed', name: 'Overwrite' }], specifications: [] } } });
  assert.equal(blocked.isError, true); assert.equal((await server.store.get(project.id)).annotations[0]!.name, 'Search');
  const proposal = await client.callTool({ name: 'propose_changes', arguments: { projectId: project.id, expectedRevision: project.revision, draft: { annotations: [{ ...annotation, id: 'ai-suggestion', origin: 'ai' }], specifications: [] } } });
  assert.equal(proposal.isError, undefined); assert.match(JSON.stringify(proposal), /requiresHumanReview/);
  const bad = await client.callTool({ name: 'propose_changes', arguments: { projectId: project.id, expectedRevision: project.revision, draft: { annotations: [{ id: 'invalid' }], specifications: [] } } });
  assert.equal(bad.isError, true);
  context = await api.request(`/api/projects/${project.id}/export`); assert.equal(context.annotations.length, 1);
});

test('MCP API client forbids external destinations and credentials in URLs', () => {
  for (const url of ['https://example.com', 'http://127.0.0.1@evil.example', 'http://localhost:4177/path', 'http://localhost:4177/?token=secret']) {
    assert.throws(() => new BridgeApi(url, 'test-token'), /loopback/);
  }
});

test('SDK cancellation reaches the plugin and a late capture cannot persist or complete the next request', { timeout: 5000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fsb-mcp-cancel-'));
  const bridge = await startServer({ port: 0, dataDir, aiConfig: null });
  const client = new Client({ name: 'cancellation-test', version: '1.0.0' });
  const mcp = createMcpServer(new BridgeApi(bridge.url, bridge.token, {allowInsecureHttp:true}));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await mcp.close(); await bridge.close(); await rm(dataDir, { recursive: true, force: true }); });
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  const project = await bridge.store.importProject(createDemoProject());
  const ws = new WebSocket(bridge.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' });
  t.after(() => ws.terminate());
  await once(ws, 'open');
  await authenticatePluginSocket(ws,bridge.token,'synthetic-cancellation-plugin');

  const abort = new AbortController();
  const requested = once(ws, 'message');
  const pending = client.callTool({ name: 'capture_selection', arguments: { projectId: project.id, expectedRevision: project.revision } }, undefined, { signal: abort.signal });
  const rejected = assert.rejects(pending, /abort|cancel/i);
  const first = JSON.parse(String((await requested)[0])) as { type: string; requestId: string };
  assert.equal(first.type, 'request');
  const cancelled = once(ws, 'message', { signal: AbortSignal.timeout(1500) });
  abort.abort();
  await rejected;
  const cancellation = JSON.parse(String((await cancelled)[0]));
  assert.deepEqual(cancellation, { type: 'cancel', requestId: first.requestId });
  assert.equal(bridge.broker.status.pendingRequests, 0);

  const nextRequested = once(ws, 'message');
  let nextSettled = false;
  const next = client.callTool({ name: 'capture_selection', arguments: { projectId: project.id, expectedRevision: project.revision } });
  void next.then(() => { nextSettled = true; }, () => { nextSettled = true; });
  const second = JSON.parse(String((await nextRequested)[0])) as { type: string; requestId: string };
  assert.equal(second.type, 'request');
  assert.notEqual(second.requestId, first.requestId);
  const snapshot = project.snapshots[0]!;
  ws.send(JSON.stringify({ type: 'response', requestId: first.requestId, ok: true, result: { ...snapshot, id: 'late-cancelled-capture' } }));
  // A pong on the same socket proves the preceding stale response was processed.
  const pong = once(ws, 'message');
  ws.send(JSON.stringify({ type: 'ping' }));
  assert.equal(JSON.parse(String((await pong)[0])).type, 'pong');
  assert.equal(nextSettled, false);
  assert.equal(bridge.broker.status.pendingRequests, 1);
  assert.deepEqual(await bridge.store.get(project.id), project);

  ws.send(JSON.stringify({ type: 'response', requestId: second.requestId, ok: true, result: { ...snapshot, id: 'current-capture' } }));
  const completed = await next;
  assert.equal(completed.isError, undefined);
  assert.match(JSON.stringify(completed), /current-capture/);
  const stored = await bridge.store.get(project.id);
  assert.equal(stored.revision, project.revision + 1);
  assert.equal(stored.snapshots.length, project.snapshots.length + 1);
  assert.equal(stored.snapshots.some(item => item.id === 'late-cancelled-capture'), false);
  assert.equal(stored.snapshots.some(item => item.id === 'current-capture'), true);
});

test('MCP API client cancels a response body that has already started streaming', { timeout: 5000 }, async t => {
  let received!: () => void, disconnected!: () => void;
  const started = new Promise<void>(resolve => { received = resolve; });
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    received();
    return response;
  });
  const server = createServer((_request, response) => {
    response.once('close', disconnected);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"partial":');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const api = new BridgeApi(`http://127.0.0.1:${address.port}`, 'synthetic-pairing-token-'.repeat(2), {allowInsecureHttp:true});
  const abort = new AbortController();
  const pending = api.request('/api/projects', undefined, abort.signal);
  const rejection = assert.rejects(pending, error => error instanceof BridgeApiError && error.code === 'CANCELLED');
  await started;
  // Headers reached fetch; let its caller begin reading the unfinished JSON body.
  await new Promise<void>(resolve => setImmediate(resolve));
  abort.abort();
  await rejection;
  await closed;
});
