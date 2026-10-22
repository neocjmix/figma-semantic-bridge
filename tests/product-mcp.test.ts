import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startServer } from '../src/server/index.js';
import { createDemoProject } from '../src/demo/project.js';
import { BridgeApi } from '../src/mcp/api-client.js';
import type { Annotation, Project, Specification } from '../src/shared/contracts.js';

test('real MCP stdio -> authenticated HTTP -> plugin WS, persisted approval reads and proposal protection', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fsb-mcp-'));
  const server = await startServer({ port: 0, dataDir });
  const api = new BridgeApi(server.url, server.token);
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/mcp/cli.ts'],
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), FSB_DATA_DIR: dataDir, FSB_SERVER_URL: server.url }, stderr: 'pipe' });
  t.after(async () => { await client.close(); await server.close(); await rm(dataDir, { recursive: true, force: true }); });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.some(tool => tool.name === 'propose_changes'));
  assert.ok(!tools.tools.some(tool => /^(approve_|delete_|shell)/.test(tool.name)));
  const disconnected = await client.callTool({ name: 'get_selected_node', arguments: {} });
  assert.equal(disconnected.isError, true);
  assert.match(JSON.stringify(disconnected), /PLUGIN_DISCONNECTED/);

  const ws = new WebSocket(server.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' });
  t.after(() => ws.terminate());
  await once(ws, 'open'); const welcomed = once(ws, 'message');
  ws.send(JSON.stringify({ type: 'hello', token: server.token, clientId: 'synthetic-plugin-emulator' })); await welcomed;
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
