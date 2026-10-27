import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, createProject, validateProject } from '../src/core/project.js';
import { matchRegion } from '../src/core/matching.js';
import { matchCollectionRegion } from '../src/core/collection-matching.js';
import type { Annotation, Rect, Snapshot } from '../src/shared/contracts.js';
import type { StructureChunk } from '../src/shared/structure-collection.js';

const time = '2026-10-27T00:00:00.000Z';
const context = { actor: 'human' as const, now: time, id: () => 'second' };
const bounds = { x: -10, y: -10, width: 20, height: 20 };
const snapshot: Snapshot = { schemaVersion: '1.0.0', id: 'scope', name: 'Synthetic decimal geometry', bounds,
  source: { fileKey: 'synthetic', pageId: 'page', rootId: 'root', revision: null, capturedAt: time },
  nodes: [{ id: 'root', parentId: 'page', type: 'FRAME', name: 'Root', bbox: bounds,
    visible: true, sourceFileKey: 'synthetic', sourcePageId: 'page' }], preview: null,
  completeness: { complete: true, reason: null }, warnings: [] };
const region = (bbox: Rect): Annotation => ({ id: 'region', snapshotId: 'scope', name: 'Region', role: 'component',
  bbox, parentId: null, sourceRefs: [], origin: 'human', reviewStatus: 'proposed', revision: 0 });
const setup = () => applyOperation(createProject('project', 'Synthetic', time), { type: 'add_snapshot', snapshot }, context);
async function* packets(): AsyncIterable<StructureChunk> {
  yield { collectionId: 'collection', sequence: 0, fileKey: 'synthetic', pageId: 'page', root: snapshot.nodes[0]!, bounds,
    startedAt: time, observedAt: time, nodes: snapshot.nodes, childCounts: [0], complete: true, nextSequence: null,
    warnings: [], consistency: 'live-session-observation' };
}

test('decimal and negative-coordinate region scores always satisfy their probability bounds', async () => {
  for (const x of [0, -0.3, -9.13]) for (const y of [0.1, -0.1, -9.29]) {
    const box = { x, y, width: 0.1, height: 0.05 };
    const results = [matchRegion(snapshot, box), await matchCollectionRegion('scope', box, packets(), { expectedNodeCount: 1 })];
    for (const result of results) for (const candidate of result.candidates) {
      assert.ok(Number.isFinite(candidate.coverage) && candidate.coverage >= 0 && candidate.coverage <= 1);
      assert.ok(Number.isFinite(candidate.iou) && candidate.iou >= 0 && candidate.iou <= 1);
    }
  }
});

test('fractional region split, move and merge preserve coordinates and remain valid', () => {
  for (const axis of ['horizontal', 'vertical'] as const) {
    const bbox = { x: 0, y: 0.1, width: 0.1, height: 0.1 };
    let project = applyOperation(setup(), { type: 'upsert_annotation', annotation: region(bbox) }, context);
    project = applyOperation(project, { type: 'split_annotation', id: 'region', axis, ratio: 0.5 }, context);
    assert.equal(project.annotations.length, 2);
    validateProject(project);
    project = applyOperation(project, { type: 'merge_annotations', ids: project.annotations.map(a => a.id), name: 'Merged' }, context);
    assert.equal(project.annotations[0]!.bbox.x, bbox.x);
    assert.equal(project.annotations[0]!.bbox.y, bbox.y);
    const moved = { ...project.annotations[0]!, bbox: { ...bbox, x: -0.3 } };
    validateProject(applyOperation(project, { type: 'upsert_annotation', annotation: moved }, context));
  }
});

test('saving with matching is one proposed edit; ordinary save preserves manually chosen references', () => {
  let project = applyOperation(setup(), { type: 'upsert_annotation', annotation: region(bounds), matchSources: true }, context);
  assert.deepEqual(project.annotations[0]!.sourceRefs.map(ref => ref.nodeId), ['root']);
  assert.equal(project.revision, 2);
  assert.equal(project.annotations[0]!.reviewStatus, 'proposed');
  assert.equal(project.annotations[0]!.sourceReview?.status, 'unconfirmed');
  project = applyOperation(project, { type: 'upsert_annotation', annotation: { ...project.annotations[0]!, sourceRefs: [] } }, context);
  assert.deepEqual(project.annotations[0]!.sourceRefs, []);
});
