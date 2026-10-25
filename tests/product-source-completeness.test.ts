import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, approvedContext, createProject, DomainError, validateProject } from '../src/core/project.js';
import { matchRegion } from '../src/core/matching.js';
import type { Annotation, Operation, Project, Snapshot, Specification } from '../src/shared/contracts.js';

const now = '2026-10-25T00:00:00.000Z';
const bounds = { x: -100, y: 50, width: 400, height: 300 };
const itemBounds = { x: -90, y: 60, width: 100, height: 40 };
const human = { actor: 'human' as const, now, id: () => 'generated' };
const apply = (project: Project, operation: Operation) => applyOperation(project, operation, human);
const incomplete = (error: unknown) => error instanceof DomainError && error.code === 'SOURCE_INCOMPLETE';
function scope(id: string, complete = true): Snapshot {
  const common = { sourceFileKey: 'synthetic', sourcePageId: 'page', visible: true, rendering: { opacity: 1 } };
  return { schemaVersion: '1.0.0', id, name: id, bounds: { ...bounds }, preview: null,
    source: { fileKey: 'synthetic', pageId: 'page', rootId: 'root', revision: null, capturedAt: now },
    completeness: complete ? { complete: true, reason: null } : { complete: false, reason: 'Structure remains unloaded or truncated.' }, warnings: [],
    nodes: [
      { ...common, id: 'root', parentId: 'page', type: 'FRAME', name: 'Root', bbox: { ...bounds } },
      { ...common, id: 'item', parentId: 'root', type: 'RECTANGLE', name: 'Item', bbox: { ...itemBounds } },
      { ...common, id: 'text', parentId: 'root', type: 'TEXT', name: 'Requirement', text: `Exact ${id} requirement.`, bbox: { x: 100, y: 150, width: 150, height: 20 } },
    ] };
}
function annotation(): Annotation {
  return { id: 'a', snapshotId: 'ui', name: 'Human region', role: 'component', bbox: { ...itemBounds }, parentId: null,
    sourceRefs: [{ snapshotId: 'ui', nodeId: 'item', matchType: 'exact' }], origin: 'human', reviewStatus: 'proposed', revision: 0 };
}
function specification(): Specification {
  return { id: 's', text: 'Exact notes requirement.', sourceRefs: [{ snapshotId: 'notes', nodeId: 'text', matchType: 'exact' }],
    relations: [{ targetAnnotationId: 'a', relationType: 'behavior', reviewStatus: 'proposed' }], origin: 'human', reviewStatus: 'proposed', revision: 0 };
}
function setup(): Project {
  return validateProject({ ...createProject('project', 'Synthetic completeness review', now), snapshots: [scope('ui'), scope('notes')], annotations: [annotation()] });
}
function truncate(project: Project, id: string): void {
  project.snapshots.find(snapshot => snapshot.id === id)!.completeness = { complete: false, reason: 'Requested structure is incomplete.' };
}

test('approved context preserves the separate image and structure observation provenance', () => {
  const project = setup(), snapshot = project.snapshots[0]!;
  snapshot.acquisition = { taskId: 'synthetic-task', structureStartedAt: now,
    structureFinishedAt: '2026-10-25T00:00:02.000Z', previewObservedAt: '2026-10-24T23:59:00.000Z',
    consistency: 'separate-observations' };
  project.annotations[0]!.reviewStatus = 'approved';
  const exported = approvedContext(project);
  const source=exported.sources[0]!;
  assert.ok('acquisition' in source);
  assert.deepEqual(source.acquisition, snapshot.acquisition);
  assert.equal(exported.sources[0]!.source.revision, null);
  assert.equal(exported.sourceNodes[0]!.id, 'item');
  assert.equal('preview' in exported.sources[0]!, false);
});

test('an incomplete root-only image cannot produce automatic source references or a confirmed draft', () => {
  const project = setup(), snapshot = project.snapshots[0]!;
  snapshot.nodes = [snapshot.nodes[0]!]; truncate(project, 'ui');
  project.annotations = [];
  const candidate = { ...annotation(), bbox: { ...bounds }, sourceRefs: [{ snapshotId: 'ui', nodeId: 'root', matchType: 'exact' as const }] };
  const result = matchRegion(snapshot, bounds);
  assert.deepEqual(result.sourceRefs, []);
  assert.equal(result.ambiguous, true);
  assert.ok(result.warnings.some(warning => /incomplete/i.test(warning)));
  const forged = { candidates: [], ambiguous: false, warnings: [], status: 'confirmed' as const, confirmedAt: now };
  const draft = apply(project, { type: 'upsert_annotation', annotation: { ...candidate, reviewStatus: 'approved', sourceReview: forged } });
  assert.equal(draft.annotations[0]!.reviewStatus, 'proposed');
  assert.equal(draft.annotations[0]!.sourceReview?.ambiguous, true);
  assert.equal(draft.annotations[0]!.sourceReview?.status, 'unconfirmed');
  assert.deepEqual(draft.annotations[0]!.sourceRefs, candidate.sourceRefs, 'Explicit draft references remain inspectable.');
});

test('incomplete annotation sources reject match, confirmation and every new approval without changing input', () => {
  for (const status of ['proposed', 'rejected'] as const) {
    const project = setup(); truncate(project, 'ui');
    project.annotations[0]!.reviewStatus = status;
    project.annotations[0]!.sourceReview = { candidates: [], ambiguous: false, warnings: [], status: 'confirmed', confirmedAt: now };
    const before = structuredClone(project);
    for (const operation of [
      { type: 'match_annotation', id: 'a', tolerance: 0.5 },
      { type: 'confirm_annotation_sources', id: 'a', expectedAnnotationRevision: 0 },
      { type: 'review_annotation', id: 'a', status: 'approved' },
    ] as const) assert.throws(() => apply(project, operation), incomplete);
    assert.deepEqual(project, before);
  }
});

test('editing an incomplete legacy confirmed source set keeps the draft but cannot reuse its confirmation', () => {
  const project = setup(); truncate(project, 'ui');
  project.annotations[0]!.sourceReview = { candidates: [], ambiguous: false, warnings: [], status: 'confirmed', confirmedAt: now };
  const changed = apply(project, { type: 'upsert_annotation', annotation: { ...project.annotations[0]!, name: 'Edited draft' } });
  assert.equal(changed.annotations[0]!.sourceReview?.status, 'unconfirmed');
  assert.equal(changed.annotations[0]!.sourceReview?.confirmedAt, null);
  assert.throws(() => apply(changed, { type: 'review_annotation', id: 'a', status: 'approved' }), incomplete);
});

test('new specification approval requires complete text sources and complete linked component scopes', () => {
  for (const partialScope of ['ui', 'notes', 'more-notes']) {
    const project = setup();
    project.annotations[0]!.reviewStatus = 'approved';
    project.snapshots.push(scope('more-notes'));
    project.specifications = [{ ...specification(), text: 'Exact notes requirement.\n\nExact more-notes requirement.',
      sourceRefs: [...specification().sourceRefs, { snapshotId: 'more-notes', nodeId: 'text', matchType: 'exact' }] }];
    truncate(project, partialScope);
    const before = structuredClone(project);
    assert.throws(() => apply(project, { type: 'review_specification', id: 's', status: 'approved' }), incomplete);
    assert.deepEqual(project, before);
    assert.equal(project.specifications[0]!.relations[0]!.reviewStatus, 'proposed');
  }
});

test('complete metadata remains approvable without PNG and an unrelated incomplete capture does not block it', () => {
  let project = setup(); project.snapshots.push(scope('unrelated', false));
  project = apply(project, { type: 'match_annotation', id: 'a', tolerance: 0.5 });
  project = apply(project, { type: 'confirm_annotation_sources', id: 'a', expectedAnnotationRevision: project.annotations[0]!.revision });
  project = apply(project, { type: 'review_annotation', id: 'a', status: 'approved' });
  project = apply(project, { type: 'upsert_specification', specification: specification() });
  project = apply(project, { type: 'review_specification', id: 's', status: 'approved' });
  assert.equal(approvedContext(project).annotations.length, 1);
  assert.equal(approvedContext(project).specifications[0]!.text, specification().text);
});

test('incomplete sources still permit draft editing, split/merge and proposal staging without granting review', () => {
  let project = setup(); truncate(project, 'ui');
  project = apply(project, { type: 'split_annotation', id: 'a', axis: 'vertical', ratio: 0.5 });
  for (const region of project.annotations) {
    assert.equal(region.reviewStatus, 'proposed');
    assert.deepEqual(region.sourceRefs, []);
    assert.equal(region.sourceReview?.status, 'unconfirmed');
  }
  project = apply(project, { type: 'merge_annotations', ids: project.annotations.map(region => region.id), name: 'Draft region' });
  assert.equal(project.annotations[0]!.reviewStatus, 'proposed');
  const staged = applyOperation(project, { type: 'submit_proposal', draft: { annotations: [{ ...annotation(), id: 'ai-region', reviewStatus: 'approved' }], specifications: [] }, warnings: [] }, { ...human, actor: 'ai' });
  const accepted = apply(staged, { type: 'resolve_proposal', id: staged.proposals[0]!.id, decision: 'accept' });
  const aiRegion = accepted.annotations.find(region => region.id === 'ai-region')!;
  assert.equal(aiRegion.reviewStatus, 'proposed');
  assert.equal(aiRegion.sourceReview?.status, 'unconfirmed');
  assert.throws(() => apply(accepted, { type: 'review_annotation', id: aiRegion.id, status: 'approved' }), incomplete);
});

test('legacy approved incomplete records still load and export; rejection then reapproval is a new gated transition', () => {
  const project = setup(); truncate(project, 'ui'); truncate(project, 'notes');
  project.annotations[0]!.reviewStatus = 'approved';
  project.specifications = [{ ...specification(), reviewStatus: 'approved', relations: [{ ...specification().relations[0]!, reviewStatus: 'approved' }] }];
  const before = structuredClone(project);
  assert.deepEqual(validateProject(project), project);
  const exported = approvedContext(project);
  assert.equal(exported.annotations[0]!.reviewStatus, 'approved');
  assert.equal(exported.specifications[0]!.reviewStatus, 'approved');
  assert.ok(exported.unresolved.some(value => /partial/.test(value)));
  assert.equal(apply(project, { type: 'review_annotation', id: 'a', status: 'approved' }).annotations[0]!.reviewStatus, 'approved');
  assert.equal(apply(project, { type: 'review_specification', id: 's', status: 'approved' }).specifications[0]!.reviewStatus, 'approved');
  const rejectedAnnotation = apply(project, { type: 'review_annotation', id: 'a', status: 'rejected' });
  assert.throws(() => apply(rejectedAnnotation, { type: 'review_annotation', id: 'a', status: 'approved' }), incomplete);
  const rejectedSpec = apply(project, { type: 'review_specification', id: 's', status: 'rejected' });
  assert.throws(() => apply(rejectedSpec, { type: 'review_specification', id: 's', status: 'approved' }), incomplete);
  assert.deepEqual(project, before);
});
