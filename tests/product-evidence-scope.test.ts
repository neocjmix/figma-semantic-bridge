import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, approvedContext, createProject, sourceTextForReferences, validateProject, type OperationContext, type SourceAccess } from '../src/core/project.js';
import { matchRegion } from '../src/core/matching.js';
import { completeScope, inlineScope, scopeNodeCount, sourceScope, sourceScopes } from '../src/core/source-scopes.js';
import type { Annotation, EvidenceScope, Operation, Project, Snapshot, SourceNode, Specification } from '../src/shared/contracts.js';

const time = '2026-10-26T00:00:00.000Z', bounds = { x: -100, y: -100, width: 1000, height: 1000 }, box = { x: 20, y: 20, width: 100, height: 100 };
const text = '원문 👩‍💻 e\u0301\r\n  <exact>\t';
const png = { mimeType: 'image/png' as const, width: 1, height: 1, base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' };
const source = { fileKey: 'synthetic-file', pageId: 'page', rootId: 'root', revision: null, capturedAt: time };
const binding = { id: 'synthetic-collection', contentHash: 'a'.repeat(64), nodeCount: 4, byteCount: 1500, observedAt: time };
const common = { visible: true, rendering: { opacity: 1 }, sourceFileKey: source.fileKey, sourcePageId: source.pageId };
const nodes: SourceNode[] = [
  { ...common, id: 'root', parentId: 'page', name: 'Root', type: 'FRAME', bbox: bounds },
  { ...common, id: 'item', parentId: 'root', name: 'Item', type: 'RECTANGLE', bbox: box },
  { ...common, id: 'other', parentId: 'root', name: 'Other', type: 'RECTANGLE', bbox: { ...box, x: 300 } },
  { ...common, id: 'text', parentId: 'root', name: 'Text', type: 'TEXT', bbox: { ...box, y: 300 }, text },
];
const access: SourceAccess = {
  hasNode: (scopeId, nodeId) => ['scope', 'scope-2'].includes(scopeId) && nodes.some(node => node.id === nodeId),
  getNode: (scopeId, nodeId) => ['scope', 'scope-2'].includes(scopeId) ? nodes.find(node => node.id === nodeId) : undefined,
};
const snapshot = (id: string): Snapshot => ({ schemaVersion: '1.0.0', id, name: id, source, bounds, nodes, preview: null, completeness: { complete: true, reason: null }, warnings: [] });
const context: OperationContext = { actor: 'human', now: time, sources: access, id: () => 'generated',
  match: (id, region, tolerance) => matchRegion(snapshot(id), region, { tolerance: tolerance ?? 0.5 }) };
const plain: OperationContext = { actor: 'human', now: time, id: () => 'generated' };
function evidence(kind: 'visual' | 'collection' = 'collection', id = 'scope'): EvidenceScope {
  return { id, name: 'Synthetic evidence', kind, source, bounds, preview: kind === 'visual' ? png : null, warnings: [],
    visualObservation: kind === 'visual' ? { taskId: 'synthetic-task', observedAt: time } : null, collection: kind === 'collection' ? binding : null };
}
function annotation(): Annotation {
  return { id: 'region', snapshotId: 'scope', name: 'Region', role: 'component', parentId: null, bbox: box,
    sourceRefs: [{ snapshotId: 'scope', nodeId: 'item', matchType: 'exact' }], reviewStatus: 'proposed', revision: 0, origin: 'human' };
}
function spec(): Specification {
  return { id: 'requirement', text, sourceRefs: [{ snapshotId: 'scope', nodeId: 'text', matchType: 'exact' }],
    relations: [{ targetAnnotationId: 'region', relationType: 'behavior', reviewStatus: 'proposed' }], origin: 'human', reviewStatus: 'proposed', revision: 0 };
}
const apply = (project: Project, operation: Operation, ctx = context) => applyOperation(project, operation, ctx);
function setup(kind: 'visual' | 'collection' = 'collection') {
  return apply(createProject('synthetic-project', 'Evidence review', time), { type: 'add_evidence_scope', scope: evidence(kind) }, { ...plain, evidenceWrite: true });
}
function saved() { return apply(setup(), { type: 'upsert_annotation', annotation: annotation() }); }
function confirm(project: Project, ctx = context) {
  return apply(project, { type: 'confirm_annotation_sources', id: 'region', expectedAnnotationRevision: project.annotations.find(item => item.id === 'region')!.revision }, ctx);
}
function approved() { return apply(confirm(saved()), { type: 'review_annotation', id: 'region', status: 'approved' }); }

test('visual scopes remain explicit, node-free proposed regions until a complete collection is attached', () => {
  let project = setup('visual');
  const forged = { ...annotation(), sourceRefs: [], reviewStatus: 'approved' as const,
    sourceReview: { candidates: [], ambiguous: false, warnings: [], status: 'confirmed' as const, confirmedAt: time } };
  project = apply(project, { type: 'upsert_annotation', annotation: forged }, plain);
  assert.equal(project.annotations[0]!.reviewStatus, 'proposed'); assert.equal(project.annotations[0]!.sourceReview?.status, 'unconfirmed');
  assert.equal(completeScope(project.scopes![0]!), false); assert.equal(scopeNodeCount(project.scopes![0]!), 0);
  assert.throws(() => apply(project, { type: 'review_annotation', id: 'region', status: 'approved' }), { code: 'SOURCE_INCOMPLETE' });
  assert.throws(() => apply(project, { type: 'match_annotation', id: 'region', tolerance: 0.5 }), { code: 'SOURCE_INCOMPLETE' });
  assert.throws(() => apply(project, { type: 'upsert_annotation', annotation: annotation() }), { code: 'INVALID_PROJECT' });
  const before = project.scopes![0]!;
  project = apply(project, { type: 'attach_scope_collection', scopeId: 'scope', collection: binding }, { ...context, evidenceWrite: true });
  assert.equal(project.scopes![0]!.kind, 'collection'); assert.deepEqual(project.scopes![0]!.preview, before.preview);
  assert.deepEqual(project.scopes![0]!.visualObservation, before.visualObservation);
  assert.equal(project.annotations[0]!.sourceReview, undefined); assert.equal(project.annotations[0]!.revision, 1);
  assert.equal('nodes' in project.scopes![0]!, false); assert.equal(project.snapshots.length, 0);
  assert.throws(() => apply(project, { type: 'attach_scope_collection', scopeId: 'scope', collection: { ...binding, contentHash: 'b'.repeat(64) } }, { ...context, evidenceWrite: true }), { code: 'IMMUTABLE_SOURCE' });
  project = apply(project, { type: 'upsert_annotation', annotation: { ...project.annotations[0]!, sourceRefs: annotation().sourceRefs } });
  project = apply(confirm(project), { type: 'review_annotation', id: 'region', status: 'approved' });
  assert.equal(project.annotations[0]!.reviewStatus, 'approved');
});

test('generic human and AI operations cannot create or replace trusted evidence bindings', () => {
  assert.throws(() => apply(createProject('p', 'P'), { type: 'add_evidence_scope', scope: evidence() }, plain), { code: 'FORBIDDEN' });
  const project = setup('visual'), before = structuredClone(project);
  assert.throws(() => apply(project, { type: 'attach_scope_collection', scopeId: 'scope', collection: binding }, plain), { code: 'FORBIDDEN' });
  assert.throws(() => apply(project, { type: 'attach_scope_collection', scopeId: 'scope', collection: binding }, { ...context, actor: 'ai', evidenceWrite: true }), { code: 'FORBIDDEN' });
  assert.deepEqual(project, before);
});

test('scope discriminants, shared IDs and explicit backing are runtime checked', () => {
  const project = setup(); assert.equal(sourceScopes(project).length, 1); assert.equal(inlineScope(sourceScope(project, 'scope')!), false);
  assert.equal(scopeNodeCount(project.scopes![0]!), 4); assert.equal(completeScope(project.scopes![0]!), true);
  for (const scope of [{ ...evidence(), collection: null }, { ...evidence('visual'), preview: null }, { ...evidence(), nodes: [nodes[0]] }]) {
    assert.throws(() => validateProject({ ...project, scopes: [scope] }), { code: 'INVALID_PROJECT' });
  }
  assert.throws(() => validateProject({ ...project, snapshots: [snapshot('scope')] }), { code: 'INVALID_PROJECT' });
});

test('collection source sets require human confirmation even for nonambiguous exact geometry', () => {
  const project = saved(), before = structuredClone(project);
  assert.equal(project.annotations[0]!.sourceReview?.ambiguous, false);
  assert.equal(project.annotations[0]!.sourceReview?.renderingReviewRequired, true);
  assert.throws(() => apply(project, { type: 'review_annotation', id: 'region', status: 'approved' }), { code: 'SOURCE_CONFIRMATION_REQUIRED' });
  assert.throws(() => apply(project, { type: 'confirm_annotation_sources', id: 'region', expectedAnnotationRevision: 999 }), { code: 'STALE_SOURCE_REVIEW' });
  assert.throws(() => confirm(project, { ...context, actor: 'ai' }), { code: 'FORBIDDEN' });
  assert.deepEqual(project, before);
  const empty = apply(project, { type: 'upsert_annotation', annotation: { ...project.annotations[0]!, sourceRefs: [] } });
  assert.throws(() => confirm(empty), { code: 'SOURCE_REFERENCES_REQUIRED' });
});

test('coordinate, source-set, scope and rematch edits invalidate confirmation; labels preserve only source confirmation', () => {
  let project = approved();
  project = apply(project, { type: 'add_evidence_scope', scope: evidence('collection', 'scope-2') }, { ...context, evidenceWrite: true });
  const original = project.annotations[0]!;
  for (const operation of [
    { type: 'upsert_annotation', annotation: { ...original, bbox: { ...box, x: 21 } } },
    { type: 'upsert_annotation', annotation: { ...original, sourceRefs: [{ snapshotId: 'scope', nodeId: 'other', matchType: 'partial' }] } },
    { type: 'upsert_annotation', annotation: { ...original, snapshotId: 'scope-2', sourceRefs: [{ snapshotId: 'scope-2', nodeId: 'item', matchType: 'exact' }] } },
    { type: 'match_annotation', id: 'region', tolerance: 0.5 },
  ] satisfies Operation[]) {
    const changed = apply(project, operation);
    assert.equal(changed.annotations[0]!.sourceReview?.status, 'unconfirmed'); assert.equal(changed.annotations[0]!.reviewStatus, 'proposed');
  }
  const renamed = apply(project, { type: 'upsert_annotation', annotation: { ...original, name: 'Renamed', role: 'section' } });
  assert.equal(renamed.annotations[0]!.sourceReview?.status, 'confirmed'); assert.equal(renamed.annotations[0]!.reviewStatus, 'proposed');
});

test('collection confirmation, approval and saved-reference edits fail without trusted source access', () => {
  const pending = saved(), confirmed = confirm(pending), before = structuredClone(confirmed);
  assert.throws(() => confirm(pending, plain), { code: 'SOURCE_RESOLUTION_REQUIRED' });
  assert.throws(() => apply(confirmed, { type: 'review_annotation', id: 'region', status: 'approved' }, plain), { code: 'SOURCE_RESOLUTION_REQUIRED' });
  assert.throws(() => apply(pending, { type: 'upsert_annotation', annotation: { ...pending.annotations[0]!, name: 'Edited' } }, plain), { code: 'SOURCE_RESOLUTION_REQUIRED' });
  assert.deepEqual(validateProject(confirmed), confirmed, 'Loading existing evidence does not silently rewrite review records.');
  assert.deepEqual(confirmed, before);
});

test('unknown source IDs and wrong resolved provenance cannot become annotation or exact-text evidence', () => {
  assert.throws(() => apply(setup(), { type: 'upsert_annotation', annotation: { ...annotation(), sourceRefs: [{ snapshotId: 'scope', nodeId: 'missing', matchType: 'exact' }] } }), { code: 'INVALID_PROJECT' });
  for (const changed of [{ id: 'different' }, { sourceFileKey: 'different' }, { sourcePageId: 'different' }]) {
    const wrong: SourceAccess = { hasNode: access.hasNode, getNode: (scopeId, id) => {
      const value = access.getNode(scopeId, id); return value ? { ...value, ...changed } : undefined;
    } };
    assert.throws(() => sourceTextForReferences(setup(), spec().sourceRefs, wrong), { code: 'INVALID_PROJECT' });
  }
});

test('external specifications require resolved, ordered, exact original text before saving or AI staging', () => {
  const project = saved();
  assert.throws(() => apply(project, { type: 'upsert_specification', specification: spec() }, plain), { code: 'SOURCE_RESOLUTION_REQUIRED' });
  assert.throws(() => apply(project, { type: 'upsert_specification', specification: { ...spec(), text: text.trim() } }), { code: 'INVALID_PROJECT' });
  assert.throws(() => apply(project, { type: 'submit_proposal', draft: { annotations: [], specifications: [spec()] }, warnings: [] }, { ...plain, actor: 'ai' }), { code: 'SOURCE_RESOLUTION_REQUIRED' });
  const savedSpec = apply(project, { type: 'upsert_specification', specification: spec() });
  assert.equal(savedSpec.specifications[0]!.text, text);
  assert.throws(() => apply(savedSpec, { type: 'review_specification', id: 'requirement', status: 'approved' }), { code: 'APPROVAL_REQUIRED' });
});

test('new specification approval validates collection-backed targets even when text comes from inline captures', () => {
  let project = apply(approved(), { type: 'add_snapshot', snapshot: snapshot('notes') });
  const value = { ...spec(), sourceRefs: [{ snapshotId: 'notes', nodeId: 'text', matchType: 'exact' as const }] };
  project = apply(project, { type: 'upsert_specification', specification: value });
  assert.throws(() => apply(project, { type: 'review_specification', id: 'requirement', status: 'approved' }, plain), { code: 'SOURCE_RESOLUTION_REQUIRED' });
  const next = apply(project, { type: 'review_specification', id: 'requirement', status: 'approved' });
  assert.equal(next.specifications[0]!.reviewStatus, 'approved');
});

test('approved export requires source resolution even when source-detail limits precede collection references', () => {
  let project = approved(); project.annotations[0]!.id = 'z-collection';
  project = apply(project, { type: 'add_snapshot', snapshot: snapshot('inline') });
  project.annotations.push({ ...annotation(), id: 'a-inline', snapshotId: 'inline', sourceRefs: [{ snapshotId: 'inline', nodeId: 'item', matchType: 'exact' }], reviewStatus: 'approved' });
  assert.throws(() => approvedContext(project, { maxSourceNodes: 1 }), { code: 'SOURCE_RESOLUTION_REQUIRED' });
  const result = approvedContext(project, { maxSourceNodes: 1 }, access);
  assert.equal(result.annotations.length, 2); assert.equal(result.sourceNodes.length, 1); assert.equal(result.truncated, true);
  assert.deepEqual(result.annotations.find(item => item.id === 'z-collection')!.sourceRefs, project.annotations[0]!.sourceRefs);
});

test('approved collection exports keep exact text and collection provenance, while AI cannot replace approvals', () => {
  let project = apply(approved(), { type: 'upsert_specification', specification: spec() });
  project = apply(project, { type: 'review_specification', id: 'requirement', status: 'approved' });
  const before = structuredClone(project), result = approvedContext(project, {}, access);
  assert.equal(result.specifications[0]!.text, text); assert.equal(result.sourceNodes.find(node => node.id === 'text')!.text, text);
  assert.ok(result.sources.some(scope => 'collection' in scope && scope.collection?.contentHash === binding.contentHash));
  assert.equal(result.sources.some(scope => 'preview' in scope), false);
  assert.throws(() => apply(project, { type: 'submit_proposal', draft: { annotations: [annotation()], specifications: [] }, warnings: [] }, { ...context, actor: 'ai' }), { code: 'APPROVED_PROTECTED' });
  assert.deepEqual(project, before);
});

test('legacy inline approvals remain unchanged without resolvers despite unrelated new source scopes', () => {
  const project = setup(); project.snapshots.push(snapshot('inline'));
  project.annotations = [{ ...annotation(), snapshotId: 'inline', sourceRefs: [{ snapshotId: 'inline', nodeId: 'item', matchType: 'exact' }], reviewStatus: 'approved' }];
  const before = structuredClone(project);
  assert.deepEqual(validateProject(project), project); assert.equal(approvedContext(project).annotations[0]!.reviewStatus, 'approved');
  assert.equal(approvedContext(project).annotations[0]!.sourceReview, undefined); assert.deepEqual(project, before);
});
