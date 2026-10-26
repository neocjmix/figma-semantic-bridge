import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCollectionRegion } from '../src/core/collection-matching.js';
import { matchRegion } from '../src/core/matching.js';
import type { Rect, Snapshot, SourceNode } from '../src/shared/contracts.js';
import type { StructureChunk } from '../src/shared/structure-collection.js';

const scopeId = 'collection-scope', fileKey = 'synthetic-file', pageId = 'synthetic-page';
const time = '2026-10-25T00:00:00.000Z';
const bounds: Rect = { x: -800, y: -500, width: 2000, height: 2000 };
function node(id: string, parentId: string | null, bbox: Rect | null, extra: Partial<SourceNode> = {}): SourceNode {
  return { id, parentId, bbox, name: id, type: 'FRAME', visible: true, rendering: { opacity: 1 }, sourceFileKey: fileKey, sourcePageId: pageId, ...extra };
}
const root = () => node('root', pageId, bounds);
function packet(nodes: SourceNode[], childCounts: number[], sequence: number, complete: boolean, sourceRoot: SourceNode): StructureChunk {
  return { collectionId: 'synthetic-collection', sequence, fileKey, pageId, root: sourceRoot, bounds,
    startedAt: time, observedAt: time, nodes, childCounts, complete, nextSequence: complete ? null : sequence + 1,
    warnings: [], consistency: 'live-session-observation' };
}
async function* chunks(nodes: SourceNode[], size = 2): AsyncIterable<StructureChunk> {
  const children = new Map<string, number>();
  for (const value of nodes) if (value.parentId) children.set(value.parentId, (children.get(value.parentId) ?? 0) + 1);
  for (let offset = 0, sequence = 0; offset < nodes.length; offset += size, sequence++) {
    const selected = nodes.slice(offset, offset + size);
    yield packet(selected, selected.map(value => children.get(value.id) ?? 0), sequence, offset + size >= nodes.length, nodes[0]!);
  }
}
function snapshot(nodes: SourceNode[]): Snapshot {
  return { schemaVersion: '1.0.0', id: scopeId, name: 'Synthetic collection', bounds, nodes, preview: null,
    source: { fileKey, pageId, rootId: 'root', capturedAt: time, revision: null }, completeness: { complete: true, reason: null }, warnings: [] };
}
async function equivalent(nodes: SourceNode[], region: Rect): Promise<void> {
  const before = structuredClone(nodes);
  const result = await matchCollectionRegion(scopeId, region, chunks(nodes), { expectedNodeCount: nodes.length });
  assert.deepEqual(result, matchRegion(snapshot(nodes), region));
  assert.deepEqual(nodes, before, 'Matching must not mutate observed records or exact source text.');
}
const box = (x: number, y: number, width = 100, height = 100): Rect => ({ x, y, width, height });

test('streaming matches equal, containing, aggregate and partial small-scope decisions', async () => {
  const nodes = [root(), node('section', 'root', box(0, 0, 100, 100)), node('section-child', 'section', box(0, 0)),
    node('sibling', 'root', box(200, 0)), node('partial', 'root', box(280, 0)), node('fit', 'root', box(400, 0))];
  for (const region of [box(0, 0), box(403, 3, 94, 94), box(0, 0, 300, 100), box(240, 0, 100, 100), box(900, 900, 10, 10)]) {
    await equivalent(nodes, region);
  }
});

test('hidden and zero-opacity ancestry is excluded but descendants outside parent bounds remain candidates', async () => {
  const target = box(500, 500);
  const nodes = [root(), node('hidden', 'root', box(-500, -500), { visible: false }), node('hidden-child', 'hidden', target),
    node('transparent', 'root', box(-300, -300), { rendering: { opacity: 0 } }), node('transparent-child', 'transparent', target),
    node('outside-parent', 'root', box(0, 0)), node('outside-child', 'outside-parent', target, { type: 'TEXT', text: 'Exact 한글 👩‍💻 e\u0301\r\n' }),
    node('null-parent', 'root', null), node('null-child', 'null-parent', box(700, 700))];
  await equivalent(nodes, target); await equivalent(nodes, box(700, 700));
  const result = await matchCollectionRegion(scopeId, target, chunks(nodes), { expectedNodeCount: nodes.length });
  assert.deepEqual(result.sourceRefs.map(value => value.nodeId), ['outside-child']);
  assert.equal(result.candidates.some(value => ['hidden-child', 'transparent-child'].includes(value.nodeId)), false);
});

test('legacy missing rendering and external ancestor boundary preserve existing match semantics', async () => {
  const parent = root(); parent.parentId = 'outside-captured-scope'; delete parent.rendering;
  const child = node('child', 'root', box(0, 0)); delete child.rendering;
  await equivalent([parent, child], box(0, 0));
});

test('closed branch retains known hidden or transparent rendering above its captured root', async () => {
  const branch=root();branch.parentId='saved-outside-parent';
  const nodes=[branch,node('child','root',box(0,0))];
  for(const ancestorRendering of ['hidden','transparent'] as const){
    const result=await matchCollectionRegion(scopeId,box(0,0),chunks(nodes),{expectedNodeCount:2,ancestorRendering});
    assert.deepEqual(result.sourceRefs,[]);assert.deepEqual(result.candidates,[]);
    assert.ok(result.warnings.some(value=>value.includes('saved ancestor outside this branch')));
  }
  const unknown=await matchCollectionRegion(scopeId,box(0,0),chunks(nodes),{expectedNodeCount:2,ancestorRendering:'unknown'});
  assert.deepEqual(unknown.sourceRefs.map(value=>value.nodeId),['child']);
  assert.ok(unknown.warnings.some(value=>value.includes('not fully known')));
});

test('all near-equal candidates affect ambiguity even when only 200 diagnostics are returned', async () => {
  const nodes = [root(), ...Array.from({ length: 250 }, (_, i) => node(`equal-${String(i).padStart(3, '0')}`, 'root', box(0, 0)))];
  await equivalent(nodes, box(0, 0));
  const result = await matchCollectionRegion(scopeId, box(0, 0), chunks(nodes, 37), { expectedNodeCount: nodes.length });
  assert.equal(result.ambiguous, true); assert.equal(result.candidates.length, 200);
  assert.ok(result.warnings.some(value => value.includes('Only the first 200 candidate diagnostics')));
});

test('more than 200 nonexact candidates withhold automatic references without narrowing the scan', async () => {
  const nodes = [root(), ...Array.from({ length: 250 }, (_, i) => node(`inside-${i}`, 'root', box(i, 0, 1, 1)))];
  await equivalent(nodes, box(0, 0, 300, 200));
});

test('deterministic varied trees agree with the existing matcher across geometry and rendering states', async () => {
  let seed = 918273;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let trial = 0; trial < 40; trial++) {
    const nodes = [root()];
    const visit = (parent: string, depth: number) => {
      const count = Math.floor(random() * 5);
      for (let i = 0; i < count && nodes.length < 80; i++) {
        const id = `node-${nodes.length}`, rect = random() < 0.1 ? null : box(Math.floor(random() * 500) - 200, Math.floor(random() * 500) - 200,
          Math.floor(random() * 150) + 1, Math.floor(random() * 150) + 1);
        const value = node(id, parent, rect, { visible: random() > 0.15, rendering: random() > 0.2 ? { opacity: random() > 0.15 ? 1 : 0 } : {} });
        nodes.push(value); if (depth < 4) visit(id, depth + 1);
      }
    };
    visit('root', 0);
    await equivalent(nodes, box(-100, -100, 300, 300));
    await equivalent(nodes, box(0, 0, 50, 40));
    const selected = nodes.find(value => value.id !== 'root' && value.bbox)?.bbox;
    if (selected) await equivalent(nodes, selected);
  }
});

test('105,837 streamed nodes include the last source record in the full-scope match', { timeout: 60000 }, async () => {
  const total = 105837, sourceRoot = root(), target = box(1000, 1000, 10, 10); let produced = 0;
  async function* large(): AsyncIterable<StructureChunk> {
    for (let offset = 0, sequence = 0; offset < total; offset += 500, sequence++) {
      const selected = Array.from({ length: Math.min(500, total - offset) }, (_, index) => {
        const ordinal = offset + index;
        return ordinal === 0 ? sourceRoot : node(`node-${ordinal}`, 'root', ordinal === total - 1 ? target : box(0, 0, 1, 1));
      });
      produced += selected.length;
      yield packet(selected, selected.map(value => value.id === 'root' ? total - 1 : 0), sequence, produced === total, sourceRoot);
    }
  }
  const result = await matchCollectionRegion(scopeId, target, large(), { expectedNodeCount: total });
  assert.equal(produced, total); assert.deepEqual(result.sourceRefs.map(value => value.nodeId), ['node-105836']);
  assert.equal(result.ambiguous, false);
});

test('25,000-deep preorder uses iterative ancestry and keeps global exact-candidate ambiguity', { timeout: 60000 }, async () => {
  const total = 25000, sourceRoot = root(), target = box(0, 0, 10, 10);
  async function* deep(): AsyncIterable<StructureChunk> {
    for (let offset = 0, sequence = 0; offset < total; offset += 500, sequence++) {
      const selected = Array.from({ length: Math.min(500, total - offset) }, (_, index) => {
        const ordinal = offset + index;
        return ordinal === 0 ? sourceRoot : node(`deep-${ordinal}`, ordinal === 1 ? 'root' : `deep-${ordinal - 1}`, target);
      });
      yield packet(selected, selected.map((_, index) => offset + index === total - 1 ? 0 : 1), sequence, offset + 500 >= total, sourceRoot);
    }
  }
  const result = await matchCollectionRegion(scopeId, target, deep(), { expectedNodeCount: total });
  assert.deepEqual(result.sourceRefs.map(value => value.nodeId), ['deep-1']);
  assert.equal(result.ambiguous, true); assert.equal(result.candidates.length, 200);
});

for (const fault of ['missing-final', 'false-complete', 'duplicate', 'parent', 'sequence', 'provenance', 'root-changed', 'count'] as const) {
  test(`invalid ${fault} collection cannot return usable match evidence`, async () => {
    const nodes = [root(), node('one', 'root', box(0, 0)), node('two', 'root', box(200, 0))];
    const values: StructureChunk[] = [];
    for await (const value of chunks(nodes, 2)) values.push(value);
    if (fault === 'missing-final') values.pop();
    if (fault === 'false-complete') { values[0]!.complete = true; values[0]!.nextSequence = null; values.pop(); }
    if (fault === 'duplicate') values[1]!.nodes[0]!.id = 'one';
    if (fault === 'parent') values[1]!.nodes[0]!.parentId = 'one';
    if (fault === 'sequence') values[1]!.sequence = 3;
    if (fault === 'provenance') values[1]!.nodes[0]!.sourceFileKey = 'different-file';
    if (fault === 'root-changed') values[1]!.root = { ...values[1]!.root, name: 'Changed root' };
    const iterate = async function* () { yield* values; };
    await assert.rejects(matchCollectionRegion(scopeId, box(0, 0), iterate(), { expectedNodeCount: fault === 'count' ? 4 : 3 }),
      { code: ['missing-final', 'false-complete', 'count'].includes(fault) ? 'SOURCE_INCOMPLETE' : 'INVALID_COLLECTION' });
  });
}

test('an interrupted iterator never yields partial matching evidence', async () => {
  const nodes = [root(), node('one', 'root', box(0, 0)), node('two', 'root', box(200, 0))];
  async function* interrupted() {
    yield packet(nodes.slice(0, 2), [2, 0], 0, false, nodes[0]!);
    throw new Error('Synthetic read interrupted');
  }
  await assert.rejects(matchCollectionRegion(scopeId, box(0, 0), interrupted(), { expectedNodeCount: 3 }), /Synthetic read interrupted/);
});
