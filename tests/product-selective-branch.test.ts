import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SelectiveReader } from '../src/figma/selective-reader.js';
import { StructureReader } from '../src/figma/structure-reader.js';
import type { CaptureHost, FigmaReadableNode } from '../src/figma/capture.js';
import { ProjectStore } from '../src/server/store.js';
import { SelectiveAcquisition } from '../src/server/selective-acquisition.js';
import { StructureCollections } from '../src/server/structure-collections.js';
import type { PluginBroker } from '../src/server/broker.js';
import type { PluginCommand } from '../src/shared/contracts.js';

const bounds = { x: 0, y: 0, width: 100, height: 80 };
const sessionId = 'synthetic-session';

async function fixture(t: test.TestContext) {
  const dataDir = await mkdtemp(join(tmpdir(), 'fsb-branch-'));
  const projects = new ProjectStore(dataDir); await projects.initialize();
  const project = await projects.create('Synthetic branch project');
  const page: FigmaReadableNode & { selection: FigmaReadableNode[] } =
    { id: 'page', name: 'Page', type: 'PAGE', parent: null, selection: [] };
  Object.defineProperty(page, 'children', { get() { throw Error('No page preload'); } });
  const scope: FigmaReadableNode = { id: 'scope', name: 'Pinned scope', type: 'FRAME', parent: page,
    absoluteBoundingBox: bounds, visible: true };
  const branch: FigmaReadableNode = { id: 'branch', name: 'Requested branch', type: 'FRAME', parent: scope,
    absoluteBoundingBox: { x: 5, y: 6, width: 40, height: 30 }, visible: true };
  const text: FigmaReadableNode = { id: 'text', name: 'Exact source text', type: 'TEXT', parent: branch,
    absoluteBoundingBox: { x: 7, y: 8, width: 12, height: 10 }, characters: 'Synthetic original 𝌆' };
  Object.defineProperty(scope, 'children', { get() { return [branch]; } });
  Object.defineProperty(branch, 'children', { get() { return [text]; } });
  page.selection = [scope];
  const nodes = new Map([[scope.id, scope], [branch.id, branch], [text.id, text]]);
  const host: CaptureHost = { fileKey: 'synthetic-file', currentPage: page, skipInvisibleInstanceChildren: true,
    getNodeByIdAsync: async id => nodes.get(id) ?? null,
    setCurrentPageAsync: async () => { throw Error('No navigation'); },
    selectNodes: () => { throw Error('No selection write'); },
    scrollAndZoomIntoView: () => { throw Error('No viewport write'); } };
  const selectiveReader = new SelectiveReader(host), structureReader = new StructureReader(host);
  const seen: PluginCommand[] = [];
  const broker = { status: { connected: true, sessionId, clientId: 'synthetic', pendingRequests: 0 },
    request: async (command: PluginCommand) => {
      seen.push(command);
      if (command.type === 'get_selection') return { fileKey: 'synthetic-file', pageId: 'page',
        nodes: [{ id: scope.id, name: scope.name, type: scope.type, bbox: bounds }] };
      if (command.type === 'read_source_nodes') return selectiveReader.readNodes(command);
      if (command.type === 'read_structure_chunk') return structureReader.readChunk(command);
      if (command.type === 'release_structure_cursor') return structureReader.release(command.collectionId);
      throw Error(`Unexpected plugin command ${command.type}`);
    } } as unknown as PluginBroker;
  const selective = new SelectiveAcquisition(dataDir, projects, broker);
  const collections = new StructureCollections(dataDir, projects, broker);
  await selective.initialize(); await collections.initialize();
  t.after(async () => { await collections.close(); await selective.close(); await rm(dataDir, { recursive: true, force: true }); });
  const inspection = await selective.prepare(project.id, project.revision, sessionId);
  return { project, projects, selective, collections, inspection, branch, page, seen, host };
}

async function settle(read: () => Promise<string>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const status = await read(); if (status !== 'running') return status;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Synthetic collection did not settle.');
}

test('branch preparation forces fresh scoped metadata and complete collection covers branch only', async t => {
  const f = await fixture(t);
  await f.selective.readNodes(f.project.id, f.inspection.id, { nodeIds: ['branch'], fields: 'metadata' });
  const prepared = await f.collections.prepareFromInspection(f.project.id, f.project.revision, sessionId,
    f.selective, f.inspection.id, 'branch');
  assert.equal(f.seen.filter(command => command.type === 'read_source_nodes').length, 2);
  assert.equal(prepared.source.nodeId, 'branch');
  assert.equal(prepared.source.scopeId, 'scope');
  assert.equal(prepared.source.inspectionId, f.inspection.id);
  assert.equal(prepared.source.parentId, 'scope');
  assert.equal(f.selective.get(f.project.id, f.inspection.id).view.observationCount, 2);
  await f.collections.start(f.project.id, prepared.id);
  assert.equal(await settle(async () => f.collections.get(f.project.id, prepared.id).status), 'complete');
  const complete = f.collections.get(f.project.id, prepared.id);
  assert.equal(complete.nodeCount, 2);
  assert.equal(f.seen.find(command => command.type === 'read_structure_chunk')?.type, 'read_structure_chunk');
  const chunks = f.seen.filter(command => command.type === 'read_structure_chunk');
  assert.ok(chunks.every(command => command.type === 'read_structure_chunk' && command.scopeId === 'scope'));
  assert.deepEqual((await f.collections.store.query(f.project.id, prepared.id, { offset: 0, limit: 10 })).nodes.map(node => node.id),
    ['branch', 'text']);
  assert.deepEqual(f.page.selection.map(node => node.id), ['scope']);
  assert.equal(f.host.skipInvisibleInstanceChildren, true);
  assert.deepEqual(await f.projects.get(f.project.id), f.project);
});

test('cached prior observation cannot prepare a branch that moved outside the pinned scope', async t => {
  const f = await fixture(t);
  await f.selective.readNodes(f.project.id, f.inspection.id, { nodeIds: ['branch'], fields: 'metadata' });
  f.branch.parent = f.page;
  await assert.rejects(f.collections.prepareFromInspection(f.project.id, f.project.revision, sessionId,
    f.selective, f.inspection.id, 'branch'), { code: 'WRONG_SCOPE' });
  assert.equal(f.collections.list(f.project.id).length, 0);
  assert.equal(f.seen.filter(command => command.type === 'read_source_nodes').length, 2);
});

test('branch reparent after preparation cannot be declared complete', async t => {
  const f = await fixture(t);
  const prepared = await f.collections.prepareFromInspection(f.project.id, f.project.revision, sessionId,
    f.selective, f.inspection.id, 'branch');
  f.branch.parent = f.page;
  await f.collections.start(f.project.id, prepared.id);
  assert.equal(await settle(async () => f.collections.get(f.project.id, prepared.id).status), 'interrupted');
  assert.equal(f.collections.get(f.project.id, prepared.id).nodeCount, 0);
});
