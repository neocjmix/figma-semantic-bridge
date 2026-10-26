import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';
import { BridgeApi } from '../src/mcp/api-client.js';
import { CollectionViewSchema, type CollectionView } from '../src/shared/structure-collection.js';
import { CollectionEvidencePageSchema, CollectionEvidenceTextSchema, CollectionEvidenceBranchSchema } from '../src/shared/collection-evidence.js';
import { SettingsViewSchema } from '../src/shared/import-settings.js';
import { sourceImportFixture } from './source-import-fixture.js';

function body(value: unknown): unknown { return JSON.parse((value as { content: { text: string }[] }).content[0]!.text); }
async function connect(f: Awaited<ReturnType<typeof sourceImportFixture>>) {
  const mcp = createMcpServer(new BridgeApi(f.url, f.token, { allowInsecureHttp: true }));
  const client = new Client({ name: 'synthetic-source-task-mcp', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport); await client.connect(clientTransport);
  return { client, async close() { await client.close(); await mcp.close(); } };
}
async function until(read: () => Promise<CollectionView>, expected: CollectionView['status']) {
  const end = Date.now() + 8000;
  while (Date.now() < end) { const value = await read(); if (value.status === expected) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail(`Synthetic source task did not become ${expected}`);
}

test('MCP advertises one source-task workflow while legacy tool calls keep validated compatibility handlers', async t => {
  const f = await sourceImportFixture(); t.after(() => f.close());
  const connection = await connect(f); t.after(() => connection.close()); const { client } = connection;
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 13);
  for (const name of ['acquire_source_task', 'get_source_task', 'continue_source_task', 'read_source_evidence'])
    assert.ok(tools.some(tool => tool.name === name));
  for (const name of ['capture_selection', 'prepare_selective_inspection', 'inspect_source_nodes', 'prepare_branch_collection',
    'list_source_collections', 'read_collection_nodes', 'read_collection_text', 'read_selective_text'])
    assert.equal(tools.some(tool => tool.name === name), false);
  assert.equal(tools.find(tool => tool.name === 'get_source_task')!.annotations?.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === 'read_source_evidence')!.annotations?.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === 'acquire_source_task')!.annotations?.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === 'continue_source_task')!.annotations?.readOnlyHint, false);
  assert.ok(tools.every(tool => tool.inputSchema.type === 'object'));
  const continuation = tools.find(tool => tool.name === 'continue_source_task')!;
  assert.equal((continuation.inputSchema.properties?.confirmRevalidation as { default?: boolean }).default, false);
  assert.ok(client.getInstructions()?.includes('Only set confirmRevalidation after the user authorizes'));
  const legacy = await client.callTool({ name: 'list_source_collections', arguments: { projectId: f.projectId } });
  assert.equal(legacy.isError, undefined); assert.deepEqual(body(legacy), { collections: [] });
  const oldPrepare = await client.callTool({ name: 'prepare_selective_inspection', arguments: {
    projectId: f.projectId, expectedRevision: (await f.readProject()).revision, expectedSessionId: f.sessionId } });
  assert.equal(oldPrepare.isError, undefined);
});

test('MCP prepare requires explicit start, partial evidence is readable and same-session Continue preserves saved data', async t => {
  const f = await sourceImportFixture({ nodeCount: 8 }); t.after(() => f.close());
  const connection = await connect(f); t.after(() => connection.close()); const { client } = connection;
  const original = await f.readProject(), settings = SettingsViewSchema.parse(await (await f.api('/api/import-settings')).json());
  await f.api('/api/import-settings', { expectedRevision: settings.revision, settings: { ...settings.settings, maxNodes: 4 } });
  const task = CollectionViewSchema.parse(body(await client.callTool({ name: 'acquire_source_task', arguments: {
    projectId: f.projectId, expectedRevision: original.revision, expectedSessionId: f.sessionId } })));
  assert.equal(task.status, 'prepared'); assert.ok(task.overviewAcquisitionId);
  assert.deepEqual(f.commands.map(command => command.type), ['get_selection']);
  const preflight = body(await client.callTool({ name: 'get_source_task', arguments: { projectId: f.projectId, taskId: task.id } })) as {
    continuation: unknown; connection: { sessionId: string }; settings: { settings: { maxNodes: number } } };
  assert.equal(preflight.continuation, null); assert.equal(preflight.connection.sessionId, f.sessionId);
  assert.equal(preflight.settings.settings.maxNodes, 4); assert.equal(f.commands.length, 1);
  const started = await client.callTool({ name: 'acquire_source_task', arguments: { projectId: f.projectId, taskId: task.id, action: 'start' } });
  assert.equal(started.isError, undefined);
  const readTask = async () => CollectionViewSchema.parse(await (await f.api(`/api/projects/${f.projectId}/collections/${task.id}`)).json());
  const paused = await until(readTask, 'paused'); assert.equal(paused.nodeCount, 4);
  const before = f.commands.length;
  const saved = CollectionEvidencePageSchema.parse(body(await client.callTool({ name: 'read_source_evidence', arguments: {
    projectId: f.projectId, taskId: task.id, limit: 2 } })));
  assert.equal(saved.snapshot.scopeComplete, false); assert.equal(saved.total, 4); assert.equal(saved.nextOffset, 2);
  assert.equal(saved.nodes.length, 2); assert.equal(saved.nodes[0]!.subtreeComplete, false);
  assert.equal(saved.nodes[1]!.subtreeComplete, true); assert.equal(saved.snapshot.freshness, 'not-revalidated');
  const text = CollectionEvidenceTextSchema.parse(body(await client.callTool({ name: 'read_source_evidence', arguments: {
    projectId: f.projectId, taskId: task.id, kind: 'text', nodeId: 'leaf-0' } })));
  assert.equal(text.text, ' Exact 한글 👩‍💻\r\n source text ');
  const branch = CollectionEvidenceBranchSchema.parse(body(await client.callTool({ name: 'read_source_evidence', arguments: {
    projectId: f.projectId, taskId: task.id, kind: 'branch', nodeId: 'leaf-0' } })));
  assert.equal(branch.root.id, 'leaf-0'); assert.equal(branch.nodeCount, 1); assert.equal(branch.reviewStatus, 'unreviewed');
  assert.equal(f.commands.length, before, 'Saved evidence queries must not read Figma');
  const current = SettingsViewSchema.parse(await (await f.api('/api/import-settings')).json());
  await f.api('/api/import-settings', { expectedRevision: current.revision, settings: { ...current.settings, maxNodes: 20 } });
  const continued = await client.callTool({ name: 'continue_source_task', arguments: {
    projectId: f.projectId, taskId: task.id, expectedRevision: original.revision, expectedSessionId: f.sessionId } });
  assert.equal(continued.isError, undefined); assert.equal((await until(readTask, 'complete')).nodeCount, 8);
  assert.equal(f.childReads, 1); assert.equal(f.commands.filter(command => command.type === 'preview_capture').length, 1);
  assert.deepEqual(await f.readProject(), original);
});

test('MCP reconnect defaults to refusing costly revalidation and still reads interrupted evidence', async t => {
  const f = await sourceImportFixture({ nodeCount: 8 }); t.after(() => f.close());
  let connection = await connect(f); t.after(() => connection.close());
  const original = await f.readProject(), settings = SettingsViewSchema.parse(await (await f.api('/api/import-settings')).json());
  await f.api('/api/import-settings', { expectedRevision: settings.revision, settings: { ...settings.settings, maxNodes: 4 } });
  const task = CollectionViewSchema.parse(body(await connection.client.callTool({ name: 'acquire_source_task', arguments: {
    projectId: f.projectId, expectedRevision: original.revision, expectedSessionId: f.sessionId } })));
  await connection.client.callTool({ name: 'acquire_source_task', arguments: { projectId: f.projectId, taskId: task.id, action: 'start' } });
  await until(async () => CollectionViewSchema.parse(await (await f.api(`/api/projects/${f.projectId}/collections/${task.id}`)).json()), 'paused');
  await connection.close(); await f.restart(); connection = await connect(f);
  const status = body(await connection.client.callTool({ name: 'get_source_task', arguments: { projectId: f.projectId, taskId: task.id } })) as {
    task: CollectionView; continuation: { requiresConfirmation: boolean; kind: string } };
  assert.equal(status.task.status, 'interrupted'); assert.equal(status.continuation.kind, 'revalidate'); assert.equal(status.continuation.requiresConfirmation, true);
  const before = f.commands.length;
  const refused = await connection.client.callTool({ name: 'continue_source_task', arguments: {
    projectId: f.projectId, taskId: task.id, expectedRevision: original.revision, expectedSessionId: f.sessionId } });
  assert.equal(refused.isError, true); assert.match(JSON.stringify(refused), /RECOVERY_CONFIRMATION_REQUIRED/);
  assert.equal(f.commands.length, before);
  const page = CollectionEvidencePageSchema.parse(body(await connection.client.callTool({ name: 'read_source_evidence', arguments: {
    projectId: f.projectId, taskId: task.id, nodeIds: ['leaf-0'] } })));
  assert.equal(page.nodes[0]!.id, 'leaf-0'); assert.equal(f.commands.length, before);
  assert.deepEqual(await f.readProject(), original);
});

test('MCP source-task inputs reject unsupported field combinations before any Figma work', async t => {
  const f = await sourceImportFixture(); t.after(() => f.close());
  const connection = await connect(f); t.after(() => connection.close());
  const taskId = '22222222-2222-4222-8222-222222222222';
  for (const request of [
    { name: 'acquire_source_task', arguments: { projectId: f.projectId } },
    { name: 'acquire_source_task', arguments: { projectId: f.projectId, action: 'start' } },
    { name: 'read_source_evidence', arguments: { projectId: f.projectId, taskId, limit: 201 } },
    { name: 'read_source_evidence', arguments: { projectId: f.projectId, taskId, kind: 'text' } },
    { name: 'read_source_evidence', arguments: { projectId: f.projectId, taskId, kind: 'text', nodeId: 'leaf-0', parentId: 'root' } },
    { name: 'read_source_evidence', arguments: { projectId: f.projectId, taskId, kind: 'branch', nodeId: 'leaf-0', limit: 4 } },
  ]) assert.equal((await connection.client.callTool(request)).isError, true);
  assert.deepEqual(f.commands, []);
});
