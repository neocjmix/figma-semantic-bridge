import test from 'node:test';
import assert from 'node:assert/strict';
import { SelectiveReader } from '../src/figma/selective-reader.js';
import type { CaptureHost, FigmaReadableNode } from '../src/figma/capture.js';
import type { SelectiveReadChildrenCommand, SelectiveReadNodesCommand } from '../src/shared/selective-source.js';
import { SELECTIVE_CHILDREN_WIRE_BYTES } from '../src/shared/selective-source.js';

const fileKey = 'synthetic-file', pageId = 'synthetic-page', scopeId = 'synthetic-scope';
const bounds = { x: 0, y: 0, width: 100, height: 80 };
const timestamp = '2026-10-25T00:00:00.000Z';
const nodesCommand = (nodeIds: string[], fields: 'metadata' | 'text' = 'metadata'): SelectiveReadNodesCommand =>
  ({ type: 'read_source_nodes', fileKey, pageId, scopeId, nodeIds, fields });
const childrenCommand = (observationId: string, offset: number, limit = 100): SelectiveReadChildrenCommand =>
  ({ type: 'read_source_children', fileKey, pageId, scopeId, parentId: scopeId, observationId, offset, limit });

function fixture() {
  const page: FigmaReadableNode & { selection: FigmaReadableNode[] } =
    { id: pageId, name: 'Synthetic page', type: 'PAGE', parent: null, selection: [] };
  Object.defineProperty(page, 'children', { get() { throw Error('No page preload'); } });
  const scope: FigmaReadableNode = { id: scopeId, name: 'Synthetic scope', type: 'FRAME', parent: page,
    absoluteBoundingBox: bounds };
  const children: FigmaReadableNode[] = [];
  let childReads = 0, textReads = 0, currentEpoch = 0;
  Object.defineProperty(scope, 'children', { get() { childReads++; return children; } });
  const byId = new Map<string, FigmaReadableNode>([[scopeId, scope]]);
  const host: CaptureHost = { fileKey, currentPage: page, skipInvisibleInstanceChildren: true,
    getNodeByIdAsync: async id => byId.get(id) ?? null,
    setCurrentPageAsync: async () => { throw Error('No page navigation'); },
    selectNodes: () => { throw Error('No selection write'); },
    scrollAndZoomIntoView: () => { throw Error('No viewport write'); } };
  const add = (id: string, type = 'RECTANGLE', parent: FigmaReadableNode = scope, name = id) => {
    const node: FigmaReadableNode = { id, name, type, parent, absoluteBoundingBox: bounds, visible: false };
    Object.defineProperty(node, 'children', { get() { throw Error('No descendant traversal'); } });
    Object.defineProperty(node, 'characters', { configurable: true, get() { textReads++; throw Error('Text was not requested'); } });
    byId.set(id, node);
    if (parent === scope) children.push(node);
    return node;
  };
  return { host, page, scope, children, add, byId, get childReads() { return childReads; },
    get textReads() { return textReads; }, get epoch() { return currentEpoch; }, change() { currentEpoch++; } };
}

test('explicit metadata reads never touch text, children, selection or another page', async () => {
  const f = fixture();
  const target = f.add('text-1', 'TEXT');
  const reader = new SelectiveReader(f.host, { observedAt: () => timestamp, getChangeEpoch: () => f.epoch });
  const result = await reader.readNodes(nodesCommand([target.id]));
  assert.equal(result.scope.name, 'Synthetic scope');
  assert.deepEqual(result.requestedIds, [target.id]);
  assert.equal(result.records[0]?.fieldCoverage.text, 'not-requested');
  assert.equal('text' in result.records[0]!.node, false);
  assert.equal(result.records[0]?.node.visible, false);
  assert.equal(result.requestedIdsComplete, true);
  assert.equal('subtreeComplete' in result, false);
  assert.equal(f.textReads, 0);
  assert.equal(f.childReads, 0);
  assert.deepEqual(f.page.selection, []);
  assert.equal(f.host.skipInvisibleInstanceChildren, true);
  assert.equal(result.startedAt, timestamp);
  assert.equal(result.observedAt, timestamp);
});

test('exact text is loaded only when requested, including an empty string', async () => {
  const f = fixture();
  const textNode = f.add('text-1', 'TEXT');
  const emptyNode = f.add('text-empty', 'TEXT');
  let reads = 0;
  Object.defineProperty(textNode, 'characters', { get() { reads++; return 'Exact synthetic 𝌆\ntext'; } });
  Object.defineProperty(emptyNode, 'characters', { get() { reads++; return ''; } });
  const shape = f.add('shape-1');
  const reader = new SelectiveReader(f.host, { observedAt: () => timestamp });
  const result = await reader.readNodes(nodesCommand([textNode.id, emptyNode.id, shape.id], 'text'));
  assert.deepEqual(result.records.map(record => record.fieldCoverage.text), ['loaded', 'loaded', 'not-applicable']);
  assert.equal(result.records[0]?.node.text, 'Exact synthetic 𝌆\ntext');
  assert.equal(result.records[1]?.node.text, '');
  assert.equal(result.records[2]?.node.text, undefined);
  assert.equal(reads, 2);
  assert.equal(f.childReads, 0);
  assert.equal(f.host.skipInvisibleInstanceChildren, true);
});

test('invalid scope, missing IDs and exact text limits fail without partial coverage', async () => {
  const f = fixture();
  const outside: FigmaReadableNode = { id: 'outside', name: 'Outside', type: 'RECTANGLE', parent: f.page };
  f.byId.set(outside.id, outside);
  const longText = f.add('long-text', 'TEXT');
  Object.defineProperty(longText, 'characters', { get() { return '𝌆'.repeat(25_001); } });
  const reader = new SelectiveReader(f.host);
  await assert.rejects(reader.readNodes(nodesCommand([outside.id])), { code: 'WRONG_SCOPE' });
  await assert.rejects(reader.readNodes(nodesCommand(['missing'])), { code: 'NODE_UNAVAILABLE' });
  await assert.rejects(reader.readNodes(nodesCommand([longText.id], 'text')), { code: 'TEXT_TOO_LARGE' });
  await assert.rejects(reader.readNodes(nodesCommand([longText.id, longText.id])), { code: 'DUPLICATE_ID' });
  assert.equal(f.host.skipInvisibleInstanceChildren, true);
});

test('metadata batch rejects a source change after yielding and never reports a partial batch complete', async () => {
  const f = fixture();
  const ids = Array.from({ length: 30 }, (_, index) => f.add(`batch-${index}`).id);
  const reader = new SelectiveReader(f.host, { getChangeEpoch: () => f.epoch });
  await assert.rejects(reader.readNodes(nodesCommand(ids),
    { yieldControl: async () => { f.change(); } }), { code: 'SOURCE_CHANGED' });
  assert.equal(f.host.skipInvisibleInstanceChildren, true);
  assert.equal(f.childReads, 0);
});

test('metadata batch rejects an oversized exact response instead of trimming requested IDs', async () => {
  const f = fixture();
  const ids = Array.from({ length: 90 }, (_, index) => {
    const node = f.add(`text-${index}`, 'TEXT');
    Object.defineProperty(node, 'characters', { get() { return 'X'.repeat(12_000); } });
    return node.id;
  });
  const reader = new SelectiveReader(f.host);
  await assert.rejects(reader.readNodes(nodesCommand(ids, 'text')), { code: 'SOURCE_RESPONSE_TOO_LARGE' });
  assert.equal(f.host.skipInvisibleInstanceChildren, true);
});

test('immediate children have one native array read, bounded packets and replay', async () => {
  const f = fixture();
  for (let index = 0; index < 205; index++) f.add(`child-${index}`, index % 7 === 0 ? 'TEXT' : 'RECTANGLE');
  const reader = new SelectiveReader(f.host, { observedAt: () => timestamp });
  const first = await reader.readChildren(childrenCommand('observation-1', 0));
  assert.equal(first.nodes.length, 100);
  assert.equal(first.totalChildren, 205);
  assert.equal(first.childrenComplete, false);
  assert.equal(first.nextOffset, 100);
  assert.equal(first.scope.id, scopeId);
  assert.equal(first.parent.id, scopeId);
  assert.deepEqual(await reader.readChildren(childrenCommand('observation-1', 0)), first);
  await assert.rejects(reader.readChildren(childrenCommand('observation-1', 200)), { code: 'CURSOR_SEQUENCE' });
  await assert.rejects(reader.readChildren(childrenCommand('another-observation', 0)), { code: 'CURSOR_MISMATCH' });
  const second = await reader.readChildren(childrenCommand('observation-1', 100));
  const third = await reader.readChildren(childrenCommand('observation-1', 200));
  assert.equal(second.childrenComplete, false);
  assert.equal(third.nodes.length, 5);
  assert.equal(third.childrenComplete, true);
  assert.equal(third.nextOffset, null);
  assert.equal('subtreeComplete' in third, false);
  assert.deepEqual(await reader.readChildren(childrenCommand('observation-1', 200)), third);
  assert.deepEqual([...first.nodes, ...second.nodes, ...third.nodes].map(node => node.rendering?.siblingIndex),
    Array.from({ length: 205 }, (_, index) => index));
  assert.equal(f.childReads, 1);
  assert.equal(f.textReads, 0);
  assert.equal(f.host.skipInvisibleInstanceChildren, true);
  reader.release('observation-1');
  assert.equal(reader.hasCursor(), false);
});

test('empty parent is complete only for its immediate children', async () => {
  const f = fixture();
  const reader = new SelectiveReader(f.host, { observedAt: () => timestamp });
  const result = await reader.readChildren(childrenCommand('empty-observation', 0));
  assert.equal(result.totalChildren, 0);
  assert.deepEqual(result.nodes, []);
  assert.equal(result.childrenComplete, true);
  assert.equal(result.nextOffset, null);
  assert.equal('subtreeComplete' in result, false);
  assert.equal(f.childReads, 1);
});

test('source epoch invalidates a yielded read and its cached child cursor', async () => {
  const f = fixture();
  for (let index = 0; index < 55; index++) f.add(`child-${index}`);
  const reader = new SelectiveReader(f.host, { getChangeEpoch: () => f.epoch });
  await assert.rejects(reader.readChildren(childrenCommand('changed', 0),
    { yieldControl: async () => { f.change(); } }), { code: 'SOURCE_CHANGED' });
  assert.equal(reader.hasCursor(), false);
  await assert.rejects(reader.readChildren(childrenCommand('changed', 0)), { code: 'SOURCE_CHANGED' });
  assert.equal(f.host.skipInvisibleInstanceChildren, true);
  const newPacket = await reader.readChildren(childrenCommand('new-observation', 0));
  assert.equal(newPacket.childrenComplete, true);
});

test('cancellation does not publish a child offset; a same-sequence retry succeeds', async () => {
  const f = fixture();
  for (let index = 0; index < 30; index++) f.add(`child-${index}`);
  const reader = new SelectiveReader(f.host);
  let cancelled = false;
  await assert.rejects(reader.readChildren(childrenCommand('cancelled', 0),
    { cancelled: () => cancelled, yieldControl: async () => { cancelled = true; } }), { code: 'CANCELLED' });
  cancelled = false;
  const packet = await reader.readChildren(childrenCommand('cancelled', 0));
  assert.equal(packet.offset, 0);
  assert.equal(packet.nodes.length, 30);
  assert.equal(packet.childrenComplete, true);
  assert.equal(f.childReads, 1);
});

test('response byte limit splits wide child summaries and idle expiry loses continuation', async () => {
  const f = fixture();
  for (let index = 0; index < 100; index++) f.add(`child-${index}`, 'RECTANGLE', f.scope, 'N'.repeat(1000));
  let now = 0;
  const reader = new SelectiveReader(f.host, { now: () => now, idleMs: 10_000 });
  const first = await reader.readChildren(childrenCommand('wide', 0));
  assert.ok(first.nodes.length < 100);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= SELECTIVE_CHILDREN_WIRE_BYTES);
  assert.equal(first.childrenComplete, false);
  now = 10_001;
  await assert.rejects(reader.readChildren(childrenCommand('wide', first.nextOffset!)), { code: 'CURSOR_UNAVAILABLE' });
  assert.equal(reader.hasCursor(), false);
  assert.equal(f.host.skipInvisibleInstanceChildren, true);
});
