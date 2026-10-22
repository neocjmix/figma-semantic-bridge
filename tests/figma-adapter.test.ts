import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAnalysisRoot, figmaNodeAdapter, withHiddenInstanceChildren, type FigmaNodeLike } from '../src/fixture-analysis/figma-adapter.js';
import { analyzeFigmaScope } from '../plugins/fixture-analyzer/mcp.js';

test('Figma adapter reads scalar geometry without accessing text, name, assets or descendants', () => {
  const source = {
    id: '1:1', type: 'TEXT', parent: null, visible: false,
    absoluteBoundingBox: { x: -1, y: 2, width: 3, height: 4 },
    get characters(): never { throw new Error('must not read text'); },
    get name(): never { throw new Error('must not read names'); },
    get fills(): never { throw new Error('must not read images'); },
    get children(): never { throw new Error('must not traverse during scalar read'); },
  };
  assert.deepEqual(figmaNodeAdapter.read(source), {
    id: '1:1', parentId: null, type: 'TEXT', visible: false,
    bbox: { x: -1, y: 2, width: 3, height: 4 }, layoutMode: null,
  });
  assert.notEqual(figmaNodeAdapter.read(source).bbox, source.absoluteBoundingBox);
  assert.deepEqual(figmaNodeAdapter.children({ id: '1:2', type: 'TEXT', parent: null }), []);
});

test('scope roots are explicit containers; document roots are rejected', () => {
  for (const type of ['PAGE', 'FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION']) {
    assert.doesNotThrow(() => assertAnalysisRoot({ id: 'n', type, parent: null }));
  }
  assert.throws(() => assertAnalysisRoot({ id: 'doc', type: 'DOCUMENT', parent: null }), /Select one/);
});

test('MCP wrapper switches only to the requested page and rejects a foreign root', async () => {
  const initial: FigmaNodeLike = { id: 'initial', type: 'PAGE', parent: null };
  const page: FigmaNodeLike = { id: 'p', type: 'PAGE', parent: null };
  const root: FigmaNodeLike = { id: 'r', type: 'FRAME', parent: page, children: [] };
  const foreign: FigmaNodeLike = { id: 'foreign', type: 'FRAME', parent: initial };
  const calls: string[] = [];
  const api = {
    currentPage: initial,
    skipInvisibleInstanceChildren: true,
    async getNodeByIdAsync(id: string) {
      calls.push(`get:${id}`);
      return [page, root, foreign].find(node => node.id === id) ?? null;
    },
    async setCurrentPageAsync(next: FigmaNodeLike) {
      calls.push(`page:${next.id}`);
      this.currentPage = next;
    },
  };
  const report = await analyzeFigmaScope(api, { pageId: 'p', rootId: 'r' });
  assert.equal(report.structure.nodeCount, 1);
  assert.equal(report.hiddenInstanceChildren.status, 'measured');
  assert.equal(report.bytes.reportJsonUtf8, Buffer.byteLength(JSON.stringify(report)));
  assert.equal(api.skipInvisibleInstanceChildren, true);
  assert.deepEqual(calls, ['get:p', 'page:p', 'get:r']);
  await assert.rejects(analyzeFigmaScope(api, { pageId: 'p', rootId: 'foreign' }), /does not belong/);
  assert.equal(calls.filter(call => call.startsWith('page:')).length, 1);
  await assert.rejects(analyzeFigmaScope(api, { pageId: '', rootId: 'r' }), /required/);
});

test('hidden instance traversal flag is restored after failure and unknown runtimes are explicit', async () => {
  const runtime = { skipInvisibleInstanceChildren: true };
  await assert.rejects(withHiddenInstanceChildren(runtime, async () => {
    assert.equal(runtime.skipInvisibleInstanceChildren, false);
    throw new Error('synthetic read error');
  }), /synthetic read error/);
  assert.equal(runtime.skipInvisibleInstanceChildren, true);
  const unknown = await withHiddenInstanceChildren({}, async () => 1);
  assert.equal(unknown.hiddenInstanceChildren.status, 'not measured');
});
