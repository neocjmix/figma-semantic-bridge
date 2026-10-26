import { authenticatePluginSocket } from './bridge-auth-helper.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';
import { BridgeApi } from '../src/mcp/api-client.js';
import { startServer } from '../src/server/index.js';
import type { PluginCommand, SourceNode } from '../src/shared/contracts.js';

const bounds = { x: 0, y: 0, width: 100, height: 80 };
const observedAt = '2026-10-25T00:00:01.000Z';
const scope: SourceNode = { id: 'scope', parentId: 'page', type: 'FRAME', name: 'Synthetic scope', bbox: bounds,
  visible: true, sourceFileKey: 'synthetic-file', sourcePageId: 'page' };
const branch: SourceNode = { id: 'branch', parentId: 'scope', type: 'FRAME', name: 'Synthetic branch',
  bbox: { x: 2, y: 3, width: 30, height: 20 }, visible: true, sourceFileKey: 'synthetic-file', sourcePageId: 'page' };
const exactText = 'Synthetic untrusted requirement 𝌆';
const textNode: SourceNode = { id: 'text', parentId: 'branch', type: 'TEXT', name: 'Synthetic text',
  bbox: { x: 3, y: 4, width: 12, height: 8 }, visible: true, text: exactText,
  sourceFileKey: 'synthetic-file', sourcePageId: 'page' };
type Request = { type: 'request'; requestId: string; command: PluginCommand };
function body(value: unknown): unknown { return JSON.parse((value as { content: { text: string }[] }).content[0]!.text); }

test('selective MCP tools page metadata, explicitly read text, and prepare a branch-only collection', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fsb-selective-mcp-'));
  const server = await startServer({ port: 0, dataDir, aiConfig: null, requestTimeoutMs: 1000 });
  const project = await server.store.create('Synthetic MCP selective project');
  const ws = new WebSocket(server.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' });
  t.after(async () => { ws.terminate(); await server.close(); await rm(dataDir, { recursive: true, force: true }); });
  await once(ws, 'open');
  const {sessionId} = await authenticatePluginSocket(ws,server.token,'synthetic-selective-plugin');
  const seen: PluginCommand[] = [];
  ws.on('message', bytes => {
    const request = JSON.parse(String(bytes)) as Request | { type: 'cancel'; requestId: string };
    if (request.type !== 'request') return;
    const command = request.command; seen.push(command);
    let result: unknown;
    if (command.type === 'get_selection') result = { fileKey: 'synthetic-file', pageId: 'page',
      nodes: [{ id: scope.id, name: scope.name, type: scope.type, bbox: bounds }] };
    else if (command.type === 'read_source_nodes') {
      const requested = command.nodeIds.map(id => id === 'branch' ? branch : textNode);
      result = { fileKey: command.fileKey, pageId: command.pageId, scopeId: command.scopeId, scope,
        startedAt: observedAt, observedAt, requestedIds: command.nodeIds, fields: command.fields,
        records: requested.map(node => ({ node: command.fields === 'text' ? node : { ...node, text: undefined },
          fieldCoverage: { metadata: 'loaded', text: command.fields === 'text' && node.type === 'TEXT'
            ? 'loaded' : command.fields === 'metadata' ? 'not-requested' : 'not-applicable' } })),
        requestedIdsComplete: true, consistency: 'live-session-observation' };
    } else if (command.type === 'read_structure_chunk') {
      result = { collectionId: command.collectionId, sequence: command.sequence, fileKey: command.fileKey,
        pageId: command.pageId, root: branch, bounds: branch.bbox, startedAt: observedAt, observedAt,
        nodes: [branch, textNode], childCounts: [1, 0], complete: true, nextSequence: null,
        warnings: [], consistency: 'live-session-observation' };
    } else if (command.type === 'release_structure_cursor') result = { released: true };
    else throw Error(`Unexpected command ${command.type}`);
    ws.send(JSON.stringify({ type: 'response', requestId: request.requestId, ok: true, result }));
  });
  const mcp = createMcpServer(new BridgeApi(server.url, server.token,{allowInsecureHttp:true}));
  const client = new Client({ name: 'selective-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await mcp.close(); });
  const tools = await client.listTools();
  assert.ok(tools.tools.some(tool => tool.name === 'read_source_evidence' && tool.annotations?.readOnlyHint));
  assert.equal(tools.tools.some(tool => tool.name === 'read_selective_text'), false);
  const prepared = body(await client.callTool({ name: 'prepare_selective_inspection', arguments: {
    projectId: project.id, expectedRevision: project.revision, expectedSessionId: sessionId } })) as { id: string };
  const observed = body(await client.callTool({ name: 'inspect_source_nodes', arguments: {
    projectId: project.id, inspectionId: prepared.id, nodeIds: ['text'], fields: 'text' } })) as {
      observationId: string; records: { node: SourceNode; textLength: number }[] };
  assert.equal(observed.records[0]?.textLength, exactText.length);
  assert.equal(JSON.stringify(observed).includes(exactText), false);
  const records = body(await client.callTool({ name: 'read_selective_records', arguments: {
    projectId: project.id, inspectionId: prepared.id, observationId: observed.observationId } }));
  assert.equal(JSON.stringify(records).includes(exactText), false);
  const text = body(await client.callTool({ name: 'read_selective_text', arguments: {
    projectId: project.id, inspectionId: prepared.id, observationId: observed.observationId,
    nodeId: 'text', limit: 4000 } })) as { text: string; nextOffset: number | null };
  assert.equal(text.text, exactText); assert.equal(text.nextOffset, null);
  const collection = body(await client.callTool({ name: 'prepare_branch_collection', arguments: {
    projectId: project.id, expectedRevision: project.revision, expectedSessionId: sessionId,
    inspectionId: prepared.id, nodeId: 'branch' } })) as { id: string; source: { scopeId: string } };
  assert.equal(collection.source.scopeId, 'scope');
  const api = new BridgeApi(server.url, server.token,{allowInsecureHttp:true});
  await api.request(`/api/projects/${project.id}/collections/${collection.id}/start`, {});
  let status = 'running';
  for (let attempt = 0; attempt < 100 && status === 'running'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    status = (await api.request<{ status: string }>(`/api/projects/${project.id}/collections/${collection.id}`)).status;
  }
  assert.equal(status, 'complete');
  assert.ok(seen.some(command => command.type === 'read_structure_chunk' && command.scopeId === 'scope'));
  assert.ok(seen.filter(command => command.type === 'read_source_nodes').length >= 2);
  assert.deepEqual(await server.store.get(project.id), project);
});
