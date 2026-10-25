import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import type { FigmaReadableNode } from '../src/figma/capture.js';
import type { AnalysisReport } from '../src/fixture-analysis/index.js';

function readOnlyHost() {
  let writes = 0;
  const protect = <T extends object>(node: T): T => new Proxy(node, {
    set() { writes++; throw new Error('Document mutation is forbidden.'); },
    defineProperty() { writes++; throw new Error('Document mutation is forbidden.'); },
    deleteProperty() { writes++; throw new Error('Document mutation is forbidden.'); },
  });
  const nodeChangeListeners = new Set<(event: unknown) => void>();
  const rawPage: FigmaReadableNode & { selection: readonly FigmaReadableNode[];
    on: (type: string, listener: (event: unknown) => void) => void;
    off: (type: string, listener: (event: unknown) => void) => void } = {
    id: '0:1', name: 'Read-only page', type: 'PAGE', parent: null, children: [], selection: [],
    on(type, listener) { assert.equal(type, 'nodechange'); nodeChangeListeners.add(listener); },
    off(type, listener) { assert.equal(type, 'nodechange'); nodeChangeListeners.delete(listener); },
  };
  const page = protect(rawPage);
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(png.buffer).setUint32(16, 400);
  new DataView(png.buffer).setUint32(20, 200);
  const rawRoot: FigmaReadableNode = { id: '1:1', name: 'Panel', type: 'FRAME', parent: page,
    absoluteBoundingBox: Object.freeze({ x: -50, y: 100, width: 400, height: 200 }),
    visible: true, children: [], exportAsync: async () => png };
  const root = protect(rawRoot);
  const text = protect<FigmaReadableNode>({ id: '1:2', name: 'Rule', type: 'TEXT', parent: root,
    absoluteBoundingBox: Object.freeze({ x: -30, y: 120, width: 100, height: 20 }),
    visible: true, characters: 'Exact policy 한글', children: Object.freeze([]) });
  rawRoot.children = Object.freeze([text]);
  rawPage.children = Object.freeze([root]);
  rawPage.selection = Object.freeze([root]);
  const messages: unknown[] = [];
  const ui: { onmessage?: (message: unknown) => Promise<void>; postMessage: (message: unknown) => void } = {
    postMessage: message => messages.push(JSON.parse(JSON.stringify(message))),
  };
  const api = {
    editorType: 'dev', mode: 'inspect', fileKey: 'synthetic-view-only-file', currentPage: page,
    skipInvisibleInstanceChildren: true, ui,
    showUI: () => {}, on: (type: string) => { assert.ok(type === 'currentpagechange' || type === 'close'); }, closePlugin: () => {},
    getNodeByIdAsync: async (id: string) => [page, root, text].find(node => node.id === id) ?? null,
  };
  const figma = new Proxy(api, {
    get(target, key, receiver) {
      if (/^(create|remove|setPluginData|setRelaunchData|loadAllPages)/.test(String(key))) {
        writes++; throw new Error('A write or whole-document API was requested.');
      }
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      if (key === 'skipInvisibleInstanceChildren') return Reflect.set(target, key, value, receiver);
      writes++; throw new Error('Only the runtime traversal flag may be changed.');
    },
  });
  return { figma, ui, messages, writes: () => writes, nodeChangeListeners: () => nodeChangeListeners.size };
}

function startPlugin(directory: string, figma: object) {
  const manifest = JSON.parse(readFileSync(`plugins/${directory}/manifest.json`, 'utf8')) as {
    editorType: string[]; capabilities?: string[]; documentAccess?: string;
  };
  assert.ok(manifest.editorType.includes('dev'), 'Plugin must be registered for Dev Mode.');
  assert.ok(manifest.capabilities?.includes('inspect'), 'Plugin must support Dev Mode inspection.');
  assert.equal(manifest.documentAccess, 'dynamic-page');
  const bundle = buildSync({ entryPoints: [`plugins/${directory}/code.ts`], bundle: true, write: false,
    target: 'es2018', format: 'iife', platform: 'browser', define: { __html__: JSON.stringify('<html></html>') } });
  vm.runInNewContext(bundle.outputFiles[0]!.text, { figma,
    setTimeout: (callback: () => void, delay: number) => {
      const timer = setTimeout(callback, delay);
      if (delay >= 60_000) timer.unref();
      return timer;
    }, clearTimeout,
  }, { timeout: 2000 });
}

test('Dev Mode bridge reads selection and captures with document writes denied', async () => {
  const host = readOnlyHost();
  startPlugin('semantic-bridge', host.figma);
  const send = async (requestId: string, command: unknown) => {
    await host.ui.onmessage!({ type: 'execute', generation: 1, request: { type: 'request', requestId, command } });
    return (host.messages.at(-1) as { response: { ok: boolean; result: Record<string, unknown> } }).response;
  };
  const selection = await send('read', { type: 'get_selection' });
  assert.equal(selection.ok, true);
  assert.equal(selection.result.fileKey, 'synthetic-view-only-file');
  const capture = await send('capture', { type: 'capture_selection', limits: {} });
  assert.equal(capture.ok, true);
  const nodes = capture.result.nodes as { id: string; text?: string }[];
  assert.deepEqual(nodes.map(node => node.id), ['1:1', '1:2']);
  assert.equal(nodes[1]?.text, 'Exact policy 한글');
  assert.equal((capture.result.preview as { width: number }).width, 400);
  assert.deepEqual(capture.result.completeness, { complete: true, reason: null });
  const structure = await send('structure', { type: 'read_structure_chunk', fileKey: 'synthetic-view-only-file',
    pageId: '0:1', nodeId: '1:1', collectionId: 'synthetic-structure', sequence: 0 });
  assert.equal(structure.ok, true);
  assert.deepEqual((structure.result.nodes as { id: string; text?: string }[]).map(node => node.id), ['1:1', '1:2']);
  assert.deepEqual(structure.result.childCounts, [1, 0]);
  assert.equal(structure.result.complete, true);
  assert.equal(structure.result.nextSequence, null);
  const release = await send('release', { type: 'release_structure_cursor', collectionId: 'synthetic-structure' });
  assert.equal(release.ok, true);
  assert.deepEqual(release.result, { released: true });
  assert.equal(host.nodeChangeListeners(), 1);
  assert.deepEqual(host.figma.currentPage.selection.map(node => node.id), ['1:1']);
  assert.equal(host.figma.skipInvisibleInstanceChildren, true);
  assert.equal(host.writes(), 0);
});

test('Dev Mode fixture analyzer returns only aggregate metrics with document writes denied', async () => {
  const host = readOnlyHost();
  startPlugin('fixture-analyzer', host.figma);
  await host.ui.onmessage!({ type: 'analyze-selection' });
  const message = host.messages.at(-1) as { type: string; report: AnalysisReport };
  assert.equal(message.type, 'result');
  assert.equal(message.report.structure.nodeCount, 2);
  assert.equal(message.report.structure.textNodeCount, 1);
  assert.equal(message.report.extraction.complete, true);
  assert.doesNotMatch(JSON.stringify(message.report), /Exact policy|Read-only page|Panel/);
  assert.equal(host.figma.skipInvisibleInstanceChildren, true);
  assert.equal(host.writes(), 0);
});
