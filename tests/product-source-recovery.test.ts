import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../src/server/index.js';
import { StructureReader } from '../src/figma/structure-reader.js';
import { SelectiveReader } from '../src/figma/selective-reader.js';
import { executePluginCommand, PluginCommandError, type CaptureHost, type FigmaReadableNode } from '../src/figma/capture.js';
import type { Operation, PluginCommand, Project } from '../src/shared/contracts.js';
import { CollectionViewSchema, type CollectionView } from '../src/shared/structure-collection.js';
import { CollectionEvidencePageSchema, CollectionEvidenceTextSchema } from '../src/shared/collection-evidence.js';
import { SettingsViewSchema } from '../src/shared/import-settings.js';
import { StructureReplayResultSchema } from '../src/shared/structure-replay.js';
import { authenticatePluginSocket } from './bridge-auth-helper.js';
import { syntheticPng } from './source-import-fixture.js';

const originalText = ' Original 한글 e\u0301 👩‍💻\r\n\t<&> ';
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const end = Date.now() + 8000;
  while (Date.now() < end) { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Synthetic recovery did not settle.');
}

/** Real local HTTP, AEAD WebSocket, adapter readers and disk; no Figma account or source document. */
async function fixture(t: test.TestContext) {
  const dataDir = await mkdtemp(join(tmpdir(), 'fsb-source-recovery-'));
  let server = await startServer({ port: 0, dataDir, aiConfig: null, requestTimeoutMs: 1000 });
  const token = server.token, originalProject = await server.store.create('Synthetic recovery workspace');
  const projectId = originalProject.id, base = `/api/projects/${projectId}/collections`;
  const page: FigmaReadableNode & { selection: FigmaReadableNode[] } = { id: 'page', name: 'Synthetic page', type: 'PAGE', parent: null, selection: [] };
  let childReads = 0, observedClock = 0;
  const root: FigmaReadableNode = { id: 'root', name: 'Synthetic source', type: 'FRAME', parent: page, visible: true, opacity: 1,
    absoluteBoundingBox: { x: -200, y: 100, width: 100, height: 50 }, absoluteTransform: [[1, 0, -200], [0, 1, 100]],
    exportAsync: async settings => syntheticPng(Math.round(100 * settings.constraint.value), Math.round(50 * settings.constraint.value)) };
  const children = Array.from({ length: 7 }, (_, index): FigmaReadableNode => ({ id: `leaf-${index}`, name: `Synthetic leaf ${index}`, type: 'TEXT',
    parent: root, visible: true, opacity: 1, absoluteBoundingBox: { x: -190 + index, y: 110, width: 3, height: 4 }, characters: index === 0 ? originalText : `text-${index}` }));
  Object.defineProperty(root, 'children', { get() { childReads++; return children; } }); page.selection = [root];
  const host: CaptureHost = { fileKey: 'synthetic-file', currentPage: page, skipInvisibleInstanceChildren: true,
    getNodeByIdAsync: async id => id === root.id ? root : children.find(node => node.id === id) ?? null,
    setCurrentPageAsync: async () => { throw new Error('Unexpected navigation'); }, selectNodes: () => { throw new Error('Unexpected source selection change'); },
    scrollAndZoomIntoView: () => { throw new Error('Unexpected viewport change'); } };
  let reader: StructureReader, selective: SelectiveReader, socket: WebSocket, sessionId = '';
  const commands: PluginCommand[] = [], results: unknown[] = [];
  async function connect() {
    reader = new StructureReader(host, { observedAt: () => new Date(Date.UTC(2026, 9, 26) + observedClock++).toISOString() });
    selective = new SelectiveReader(host);
    socket = new WebSocket(server.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' }); await once(socket, 'open');
    sessionId = (await authenticatePluginSocket(socket, token, 'synthetic-recovery-plugin')).sessionId;
    const current = socket;
    current.on('message', async bytes => {
      const message = JSON.parse(String(bytes)) as { type: string; requestId: string; command: PluginCommand };
      if (message.type !== 'request') return; commands.push(message.command);
      try {
        const command = message.command;
        const result = command.type === 'read_structure_chunk' ? await reader.readChunkWithReplay(command) :
          command.type === 'release_structure_cursor' ? reader.release(command.collectionId) :
          command.type === 'read_source_nodes' ? await selective.readNodes(command) : await executePluginCommand(host, command);
        results.push(result);
        if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'response', requestId: message.requestId, ok: true, result }));
      } catch (error) {
        if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'response', requestId: message.requestId, ok: false,
          error: { code: error instanceof PluginCommandError ? error.code : 'SYNTHETIC_FAILURE', message: error instanceof Error ? error.message : 'Synthetic failure' } }));
      }
    });
  }
  await connect();
  t.after(async () => { selective.clear(); reader.clear(); socket.terminate(); await server.close(); await rm(dataDir, { recursive: true, force: true }); });
  const api = (path: string, body?: unknown) => fetch(server.url + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const get = async (id: string) => CollectionViewSchema.parse(await (await api(`${base}/${id}`)).json());
  const setLimit = async (maxNodes: number) => {
    const current = SettingsViewSchema.parse(await (await api('/api/import-settings')).json());
    assert.equal((await api('/api/import-settings', { expectedRevision: current.revision, settings: { ...current.settings, maxNodes } })).status, 200);
  };
  const preparePartial = async () => {
    await setLimit(4);
    const response = await api(base, { expectedRevision: originalProject.revision, expectedSessionId: sessionId, withOverview: true });
    assert.equal(response.status, 201); const task = CollectionViewSchema.parse(await response.json());
    assert.equal((await api(`${base}/${task.id}/start`, {})).status, 202);
    return until(() => get(task.id), task => task.status === 'paused');
  };
  const resume = async (id: string, confirmRevalidation = true) => api(`${base}/${id}/continue`, {
    expectedRevision: originalProject.revision, expectedSessionId: sessionId, confirmRevalidation });
  return { dataDir, base, projectId, api, get, setLimit, preparePartial, resume, children, root, page, commands, results,
    get server() { return server; },
    get childReads() { return childReads; }, get url() { return server.url; },
    async restart() { socket.terminate(); selective.clear(); reader.clear(); await server.close();
      server = await startServer({ port: 0, dataDir, token, aiConfig: null, requestTimeoutMs: 1000 }); await connect(); },
    async reconnect() { socket.terminate(); await until(async () => server.broker.status.connected, connected => !connected); selective.clear(); reader.clear(); await connect(); },
    async unchangedProject() { assert.deepEqual(await server.store.get(projectId), originalProject); },
  };
}

test('restart keeps partial evidence readable and explicit Continue revalidates saved records using compact receipts', async t => {
  const f = await fixture(t), partial = await f.preparePartial();
  assert.equal(partial.nodeCount, 4); assert.equal(partial.pauseReason, 'nodes');
  const savedPath = join(f.dataDir, 'structure-collections', partial.id, '0.json'), saved = await readFile(savedPath);
  await f.restart();
  assert.equal((await f.get(partial.id)).status, 'interrupted');
  const page = CollectionEvidencePageSchema.parse(await (await f.api(`${f.base}/${partial.id}/evidence`, {})).json());
  assert.equal(page.snapshot.scopeComplete, false); assert.equal(page.total, 4);
  const text = CollectionEvidenceTextSchema.parse(await (await f.api(`${f.base}/${partial.id}/evidence-text`, { nodeId: 'leaf-0' })).json());
  assert.equal(text.text, originalText); assert.equal((await f.api(`${f.base}/${partial.id}/nodes`, {})).status, 409);
  const plan = await (await f.api(`${f.base}/${partial.id}/continue-plan`)).json();
  assert.equal(plan.kind, 'revalidate'); assert.equal(plan.requiresConfirmation, true);
  const before = f.commands.length, refusal = await f.resume(partial.id, false);
  assert.equal(refusal.status, 409); assert.equal((await refusal.json()).error.code, 'RECOVERY_CONFIRMATION_REQUIRED');
  assert.equal(f.commands.length, before);
  await f.setLimit(20);
  const started = await f.resume(partial.id); assert.equal(started.status, 202);
  const next = CollectionViewSchema.parse(await started.json()); assert.notEqual(next.id, partial.id);
  const complete = await until(() => f.get(next.id), value => value.status === 'complete');
  assert.equal(complete.nodeCount, 8); assert.equal(complete.recovery!.revalidatedNodes, 4); assert.equal(complete.recovery!.reusedPackets, 1);
  assert.equal(complete.overviewAcquisitionId, partial.overviewAcquisitionId);
  assert.equal(f.commands.filter(command => command.type === 'preview_capture').length, 1);
  assert.equal(f.results.filter(result => StructureReplayResultSchema.safeParse(result).success).length, 1);
  assert.equal(f.childReads, 2); // Saved fields were actually re-read; a hash is not a remote freshness oracle.
  assert.deepEqual(await readFile(savedPath), saved);
  assert.equal((await f.get(partial.id)).status, 'interrupted'); await f.unchangedProject();
});

test('reconnected source recovery can pause at a configured budget and continue in the same generation', async t => {
  const f = await fixture(t), partial = await f.preparePartial(); await f.reconnect();
  const response = await f.resume(partial.id); assert.equal(response.status, 202);
  const next = CollectionViewSchema.parse(await response.json());
  const paused = await until(() => f.get(next.id), task => task.status === 'paused');
  assert.equal(paused.nodeCount, 4); assert.equal(paused.recovery!.reusedPackets, 1);
  const plan = await (await f.api(`${f.base}/${next.id}/continue-plan`)).json();
  assert.equal(plan.kind, 'resume'); assert.equal(plan.requiresConfirmation, false);
  await f.setLimit(20); const resumed = await f.resume(next.id, false); assert.equal(resumed.status, 202);
  assert.equal(CollectionViewSchema.parse(await resumed.json()).id, next.id);
  const complete = await until(() => f.get(next.id), task => task.status === 'complete'); assert.equal(complete.nodeCount, 8);
  const sequences = f.commands.filter(command => command.type === 'read_structure_chunk' && command.collectionId === next.id).map(command => command.type === 'read_structure_chunk' && command.sequence);
  assert.deepEqual(sequences, [0, 1]); assert.equal(f.childReads, 2); await f.unchangedProject();
});

const changes = ['same-id-text', 'insert-child', 'delete-child', 'reorder-children', 'unread-tail-text'] as const;
for (const change of changes) test(`recovery observes ${change} despite unchanged root bounds and preserves historical evidence`, async t => {
  const f = await fixture(t), partial = await f.preparePartial();
  const savedPath = join(f.dataDir, 'structure-collections', partial.id, '0.json'), saved = await readFile(savedPath);
  await f.restart();
  if (change === 'same-id-text') f.children[0]!.characters = 'Changed exact 한글 👩‍💻\r\n';
  if (change === 'insert-child') f.children.splice(1, 0, { ...f.children[1]!, id: 'inserted', name: 'Inserted child' });
  if (change === 'delete-child') f.children.splice(1, 1);
  if (change === 'reorder-children') [f.children[0], f.children[1]] = [f.children[1]!, f.children[0]!];
  if (change === 'unread-tail-text') f.children[6]!.characters = 'Changed previously unread tail';
  // Changing current selection must not redirect the original task.
  f.page.selection = [f.children.at(-1)!];
  await f.setLimit(20); const response = await f.resume(partial.id); assert.equal(response.status, 202);
  const next = CollectionViewSchema.parse(await response.json());
  const complete = await until(() => f.get(next.id), task => task.status === 'complete');
  assert.equal(complete.source.nodeId, 'root'); assert.deepEqual(complete.source.bounds, partial.source.bounds);
  assert.equal(complete.nodeCount, f.children.length + 1);
  assert.equal(complete.recovery!.reusedPackets, change === 'unread-tail-text' ? 1 : 0);
  const current = await (await f.api(`${f.base}/${next.id}/nodes`, { parentId: 'root' })).json();
  assert.deepEqual(current.nodes.map((node: { id: string }) => node.id), f.children.map(node => node.id));
  for (const node of [f.children[0]!, f.children.at(-1)!]) {
    const result = await (await f.api(`${f.base}/${next.id}/text`, { nodeId: node.id })).json(); assert.equal(result.text, node.characters);
  }
  const historical = CollectionEvidenceTextSchema.parse(await (await f.api(`${f.base}/${partial.id}/evidence-text`, { nodeId: 'leaf-0' })).json());
  assert.equal(historical.text, originalText); assert.deepEqual(await readFile(savedPath), saved); await f.unchangedProject();
});

test('a closed saved branch supports explicit review without declaring the enclosing partial source complete', async t => {
  const f = await fixture(t), partial = await f.preparePartial(), base = `/api/projects/${f.projectId}`;
  let project = await f.server.evidence.create(f.projectId, 0, { acquisitionId: partial.overviewAcquisitionId! });
  const visual = project.scopes![0]!;
  const mutate = async (operation: Operation) => {
    const response = await f.api(base + '/mutate', { expectedRevision: project.revision, operation });
    assert.equal(response.status, 200, await response.clone().text()); project = await response.json() as Project;
  };
  await mutate({ type: 'upsert_annotation', annotation: { id: 'original-draft', snapshotId: visual.id, name: 'Saved text region', role: 'component',
    parentId: null, bbox: f.children[0]!.absoluteBoundingBox!, sourceRefs: [], reviewStatus: 'proposed', origin: 'human', revision: 0 } });
  const draft = structuredClone(project.annotations[0]!);
  await assert.rejects(f.server.evidence.createBranch(f.projectId, project.revision, { collectionId: partial.id, nodeId: 'root', contextScopeId: visual.id }), { code: 'SOURCE_INCOMPLETE' });
  project = await f.server.evidence.createBranch(f.projectId, project.revision, { collectionId: partial.id, nodeId: 'leaf-0', contextScopeId: visual.id });
  const branch = project.scopes!.at(-1)!;
  assert.equal(branch.kind, 'branch'); assert.equal(branch.branch!.nodeCount, 1);
  assert.deepEqual(branch.preview, visual.preview); assert.deepEqual(branch.visualBounds, visual.bounds);
  assert.deepEqual(branch.coverageBounds, f.children[0]!.absoluteBoundingBox);
  assert.equal(branch.collection, null); assert.equal((await f.get(partial.id)).status, 'paused');
  const unavailable = await f.api(base + `/evidence-scopes/${branch.id}/resolve`, { nodeIds: ['leaf-1'] });
  assert.equal(unavailable.status, 404);
  project = await f.server.evidence.copyRegions(f.projectId, branch.id, project.revision, visual.id, ['original-draft']);
  assert.deepEqual(project.annotations.find(annotation => annotation.id === 'original-draft'), draft);
  const copied = project.annotations.find(annotation => annotation.snapshotId === branch.id)!;
  assert.ok(copied); assert.equal(copied.reviewStatus, 'proposed'); assert.equal(copied.sourceReview?.status, 'unconfirmed');
  const premature = await f.api(base + '/mutate', { expectedRevision: project.revision,
    operation: { type: 'review_annotation', id: copied.id, status: 'approved' } });
  assert.equal(premature.status, 400); assert.equal((await premature.json()).error.code, 'SOURCE_REFERENCES_REQUIRED');
  await mutate({ type: 'match_annotation', id: copied.id, tolerance: 0.5 });
  const matched = project.annotations.find(annotation => annotation.id === copied.id)!;
  assert.deepEqual(matched.sourceRefs.map(reference => reference.nodeId), ['leaf-0']);
  const unconfirmed = await f.api(base + '/mutate', { expectedRevision: project.revision,
    operation: { type: 'review_annotation', id: copied.id, status: 'approved' } });
  assert.equal(unconfirmed.status, 400); assert.equal((await unconfirmed.json()).error.code, 'SOURCE_CONFIRMATION_REQUIRED');
  await mutate({ type: 'confirm_annotation_sources', id: copied.id, expectedAnnotationRevision: matched.revision });
  await mutate({ type: 'review_annotation', id: copied.id, status: 'approved' });
  assert.equal(project.annotations.find(annotation => annotation.id === 'original-draft')!.reviewStatus, 'proposed');
  await mutate({ type: 'upsert_annotation', annotation: { ...matched, id: 'oversized-region', bbox: visual.bounds,
    sourceRefs: [{ snapshotId: branch.id, nodeId: 'leaf-0', matchType: 'partial' }], sourceReview: undefined, revision: 0 } });
  const oversized = project.annotations.find(annotation => annotation.id === 'oversized-region')!;
  for (const operation of [
    { type: 'confirm_annotation_sources', id: oversized.id, expectedAnnotationRevision: oversized.revision },
    { type: 'review_annotation', id: oversized.id, status: 'approved' },
  ]) {
    const rejected = await f.api(base + '/mutate', { expectedRevision: project.revision, operation });
    assert.equal(rejected.status, 400); assert.equal((await rejected.json()).error.code, 'SOURCE_REGION_INCOMPLETE');
  }
  const exported = await (await f.api(base + '/export')).json();
  assert.equal(exported.annotations.length, 1); assert.equal(exported.sourceNodes.length, 1);
  assert.equal(exported.sourceNodes[0].id, 'leaf-0'); assert.equal(exported.sourceNodes[0].text, originalText);
  assert.equal(exported.sourceNodes[0].parentId, 'root');
  const exportedBranch = exported.sources.find((source: { snapshotId: string }) => source.snapshotId === branch.id);
  assert.equal(exportedBranch.branch.nodeCount, 1); assert.equal(exportedBranch.kind, 'branch');
  assert.equal(exportedBranch.branch.enclosingRootId, 'root'); assert.deepEqual(exportedBranch.coverageBounds, branch.coverageBounds);
  assert.equal(exportedBranch.collection, null);
  const approvedProject = structuredClone(project);
  await f.reconnect(); f.children[0]!.characters = 'A later current source observation'; await f.setLimit(20);
  const recovery = await f.api(`${f.base}/${partial.id}/continue`, { expectedRevision: project.revision,
    expectedSessionId: f.server.broker.status.sessionId, confirmRevalidation: true });
  assert.equal(recovery.status, 202); const next = CollectionViewSchema.parse(await recovery.json());
  await until(() => f.get(next.id), value => value.status === 'complete');
  assert.deepEqual(await f.server.store.get(f.projectId), approvedProject);
  assert.deepEqual(await (await f.api(base + '/export')).json(), exported);
  await f.restart(); assert.deepEqual(await (await f.api(base + '/export')).json(), exported);
  assert.equal((await f.api(`${f.base}/${partial.id}/remove`, {})).status, 409);
  const persistedProject = await readFile(join(f.dataDir, 'projects', f.projectId + '.json'));
  await writeFile(join(f.dataDir, 'structure-collections', partial.id, '0.json'), '{}');
  const corrupted = await f.api(base + '/export'); assert.equal(corrupted.status, 500);
  assert.equal((await corrupted.json()).error.code, 'COLLECTION_INTEGRITY');
  assert.deepEqual(await readFile(join(f.dataDir, 'projects', f.projectId + '.json')), persistedProject);
});
