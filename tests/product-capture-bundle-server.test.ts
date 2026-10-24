import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { startServer } from '../src/server/index.js';
import { createDemoProject } from '../src/demo/project.js';
import type { Project } from '../src/shared/contracts.js';
import type { CaptureBundle } from '../src/shared/capture-bundle.js';

const token = 'synthetic-capture-bundle-token-'.repeat(2);

async function harness(t: test.TestContext) {
  const dataDir = await mkdtemp(join(tmpdir(), 'fsb-capture-bundle-http-'));
  const server = await startServer({ port: 0, token, dataDir, aiConfig: null });
  t.after(async () => { await server.close(); await rm(dataDir, { recursive: true, force: true }); });
  const api = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(server.url + path, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  return { ...server, dataDir, api };
}

function reviewedDemo(): Project {
  const project = createDemoProject();
  const notes = project.snapshots[1]!;
  notes.nodes.find(node => node.id === 'spec-search')!.text = '검색은 Enter로 실행합니다.\nKeep <script>design text</script> verbatim.';
  notes.completeness = { complete: false, reason: 'Synthetic bounded capture stopped before all descendants.' };
  notes.warnings.push('Partial source: review missing descendants.');
  notes.source.revision = null;
  notes.preview = null;
  project.annotations.push({ id: 'approved-local-component', snapshotId: 'demo-ui', name: 'Reviewed search', role: 'component',
    bbox: { x: 320, y: 250, width: 480, height: 48 }, parentId: null,
    sourceRefs: [{ snapshotId: 'demo-ui', nodeId: 'search-bg', matchType: 'exact', coverage: 1 }],
    origin: 'human', reviewStatus: 'approved', revision: 1 });
  project.specifications.push({ id: 'approved-local-spec', text: notes.nodes.find(node => node.id === 'spec-search')!.text!,
    sourceRefs: [{ snapshotId: notes.id, nodeId: 'spec-search', matchType: 'exact' }],
    relations: [{ targetAnnotationId: 'approved-local-component', relationType: 'behavior', reviewStatus: 'approved' }],
    origin: 'human', reviewStatus: 'approved', revision: 1 });
  project.proposals.push({ id: 'pending-local-proposal', createdAt: project.updatedAt, baseRevision: 0,
    status: 'pending', draft: { annotations: [], specifications: [] }, warnings: [] });
  return project;
}

test('capture bundles round-trip cached sources while disconnected into a fresh persisted project without approvals', async t => {
  const { api, store, broker, dataDir } = await harness(t);
  const source = await store.importProject(reviewedDemo());
  assert.equal(broker.status.connected, false);
  const exported = await api(`/api/projects/${source.id}/capture-bundle`, { expectedRevision: source.revision, snapshotIds: source.snapshots.map(snapshot => snapshot.id) });
  assert.equal(exported.status, 200);
  const bundle = await exported.json() as CaptureBundle;
  assert.equal(bundle.kind, 'figma-semantic-bridge.capture-bundle');
  for (const forbidden of ['annotations', 'specifications', 'proposals', 'token', 'projectId']) assert.equal(forbidden in bundle, false);
  assert.deepEqual(await store.get(source.id), source);

  const response = await api('/api/capture-bundles/import', { name: 'Imported sources for fresh review', bundle });
  assert.equal(response.status, 201);
  const imported = await response.json() as Project;
  assert.notEqual(imported.id, source.id);
  assert.equal(imported.name, 'Imported sources for fresh review');
  assert.equal(imported.revision, 0);
  assert.deepEqual(imported.snapshots, source.snapshots);
  assert.deepEqual(imported.annotations, []);
  assert.deepEqual(imported.specifications, []);
  assert.deepEqual(imported.proposals, []);
  assert.equal(broker.status.connected, false);
  assert.equal(broker.status.pendingRequests, 0);
  assert.deepEqual(await store.get(source.id), source);
  assert.equal((await store.list()).length, 2);
  const file = join(dataDir, 'projects', imported.id + '.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const saved = JSON.parse(await readFile(file, 'utf8')) as { project: Project; past: unknown[]; future: unknown[] };
  assert.deepEqual(saved, { project: imported, past: [], future: [] });
  const reopened = await startServer({ port: 0, token, dataDir, aiConfig: null });
  try { assert.deepEqual(await reopened.store.get(imported.id), imported); }
  finally { await reopened.close(); }
});

test('capture bundle routes retain authentication, Origin, Host, JSON and HTTP byte limits', async t => {
  const { api, url, store } = await harness(t);
  const source = await store.importProject(createDemoProject());
  for (const path of [`/api/projects/${source.id}/capture-bundle`, '/api/capture-bundles/import']) {
    assert.equal((await api(path, {}, { authorization: '' })).status, 401);
    assert.equal((await api(path, {}, { authorization: 'Bearer incorrect-synthetic-token' })).status, 401);
    assert.equal((await api(path, {}, { origin: 'https://outside.example' })).status, 403);
    assert.equal((await api(path, {}, { 'content-type': 'text/plain' })).status, 415);
    for (const [headers, status] of [
      [{ host: 'rebound.example' }, 403],
      [{ 'content-length': '16000001' }, 413],
    ] as const) {
      const actual = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(url + path, { method: 'POST', agent: false, headers: {
          authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers,
        } }, response => { response.resume(); response.on('end', () => { resolve(response.statusCode); request.destroy(); }); });
        request.on('error', reject);
        request.end('{}');
      });
      assert.equal(actual, status);
    }
  }
  assert.deepEqual(await store.get(source.id), source);
  assert.equal((await store.list()).length, 1);
});

test('capture bundle exports reject stale revisions and invalid scope lists without changing the source', async t => {
  const { api, store } = await harness(t);
  const source = await store.importProject(reviewedDemo());
  const path = `/api/projects/${source.id}/capture-bundle`;
  const stale = await api(path, { expectedRevision: source.revision + 1, snapshotIds: ['demo-ui'] });
  assert.equal(stale.status, 409);
  assert.equal(((await stale.json()) as { error: { code: string } }).error.code, 'REVISION_CONFLICT');
  for (const snapshotIds of [[], ['demo-ui', 'demo-ui'], ['demo-ui', 'demo-notes', 'third']]) {
    assert.equal((await api(path, { expectedRevision: source.revision, snapshotIds })).status, 400);
  }
  assert.equal((await api(path, { expectedRevision: source.revision, snapshotIds: ['missing-snapshot'] })).status, 404);
  assert.equal((await api(path, { expectedRevision: source.revision, snapshotIds: ['demo-ui'], unknown: true })).status, 400);
  const single = await api(path, { expectedRevision: source.revision, snapshotIds: ['demo-notes'] });
  assert.equal(single.status, 200);
  const imported = await api('/api/capture-bundles/import', { name: 'Only notes', bundle: await single.json() });
  assert.equal(imported.status, 201);
  assert.deepEqual(((await imported.json()) as Project).snapshots, [source.snapshots[1]]);
  assert.deepEqual(await store.get(source.id), source);
});

test('invalid capture bundle imports cannot create projects or target existing approved data', async t => {
  const { api, store } = await harness(t);
  const source = await store.importProject(reviewedDemo());
  const exported = await api(`/api/projects/${source.id}/capture-bundle`, { expectedRevision: source.revision, snapshotIds: ['demo-ui'] });
  assert.equal(exported.status, 200);
  const bundle = await exported.json() as CaptureBundle;
  const tampered = structuredClone(bundle);
  tampered.snapshots[0]!.snapshot.nodes[1]!.name = 'Tampered after export';
  const before = await store.list();
  const invalid = [
    { name: 'Malformed', bundle: {} },
    { name: 'Unsupported kind', bundle: { ...bundle, kind: 'unrecognized' } },
    { name: 'Approval injection', bundle: { ...bundle, annotations: source.annotations } },
    { name: 'Credential injection', bundle: { ...bundle, token: 'synthetic-untrusted-input' } },
    { name: 'Digest mismatch', bundle: tampered },
    { name: 'Existing target', bundle, projectId: source.id },
    { name: '', bundle },
  ];
  for (const input of invalid) {
    const response = await api('/api/capture-bundles/import', input);
    assert.equal(response.status, 400);
    assert.deepEqual(await store.list(), before);
    assert.deepEqual(await store.get(source.id), source);
  }
});
