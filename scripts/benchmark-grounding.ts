import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { matchRegion } from '../src/core/matching.js';
import type { Rect, Snapshot, SourceNode } from '../src/shared/contracts.js';

interface GroundingCase {
  id: string;
  description: string;
  nodes: SourceNode[];
  region: Rect;
  acceptableSourceSets: string[][];
  expectedAmbiguous: boolean;
  complete?: boolean;
}
const box = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const node = (id: string, bbox: Rect, parentId = 'root', options: { visible?: boolean; opacity?: number; type?: string } = {}): SourceNode => ({
  id, name: id, type: options.type ?? 'RECTANGLE', parentId, bbox, visible: options.visible ?? true,
  sourceFileKey: 'generated-grounding', sourcePageId: 'generated-page',
  rendering: { opacity: options.opacity ?? 1, siblingIndex: 0 },
});
const root: SourceNode = { ...node('root', box(-100, -100, 1200, 1200), '', { type: 'FRAME' }), parentId: null };

/** Literal construction labels, declared without calling the matcher or copying its scoring rules.
 * These specify acceptable geometric source sets, not independent human semantic judgments. */
export const groundingCases: readonly GroundingCase[] = [
  { id: 'single-exact', description: 'The selected rectangle is exactly one isolated source.',
    nodes: [node('button', box(20, 30, 80, 40))], region: box(20, 30, 80, 40), acceptableSourceSets: [['button']], expectedAmbiguous: false },
  { id: 'tolerance-edge', description: 'A 0.3px selection offset still refers to the isolated rectangle.',
    nodes: [node('card', box(10, 10, 100, 100))], region: box(9.7, 10, 100, 100), acceptableSourceSets: [['card']], expectedAmbiguous: false },
  { id: 'equal-sibling-bounds', description: 'Two siblings occupy the same rectangle; either geometric candidate is acceptable, but ambiguity is required.',
    nodes: [node('layer-a', box(20, 20, 100, 60)), node('layer-b', box(20, 20, 100, 60))],
    region: box(20, 20, 100, 60), acceptableSourceSets: [['layer-a'], ['layer-b']], expectedAmbiguous: true },
  { id: 'equal-parent-child-bounds', description: 'A container and its fill share bounds; geometry alone does not establish their semantic role.',
    nodes: [node('container', box(20, 20, 100, 60), 'root', { type: 'FRAME' }), node('fill', box(20, 20, 100, 60), 'container')],
    region: box(20, 20, 100, 60), acceptableSourceSets: [['container'], ['fill']], expectedAmbiguous: true },
  { id: 'aggregate-siblings-with-gap', description: 'The region spans two distinct sibling boxes and the empty gap between them.',
    nodes: [node('left', box(0, 0, 80, 50)), node('right', box(120, 0, 80, 50))],
    region: box(0, 0, 200, 50), acceptableSourceSets: [['left', 'right']], expectedAmbiguous: false },
  { id: 'aggregate-distant-ancestry', description: 'Two selected controls belong to separate large tree branches; neither branch is the selected visual region.',
    nodes: [node('branch-a', box(0, 0, 400, 900), 'root', { type: 'FRAME' }), node('control-a', box(100, 100, 80, 40), 'branch-a'),
      node('branch-b', box(500, 0, 500, 900), 'root', { type: 'FRAME' }), node('control-b', box(600, 100, 80, 40), 'branch-b')],
    region: box(100, 100, 580, 40), acceptableSourceSets: [['control-a', 'control-b']], expectedAmbiguous: false },
  { id: 'container-frontier', description: 'Two complete controls cover their own nested labels; including label IDs would duplicate the chosen sources.',
    nodes: [node('control-a', box(0, 0, 80, 50), 'root', { type: 'FRAME' }), node('label-a', box(10, 10, 50, 20), 'control-a'),
      node('control-b', box(120, 0, 80, 50), 'root', { type: 'FRAME' }), node('label-b', box(130, 10, 50, 20), 'control-b')],
    region: box(0, 0, 200, 50), acceptableSourceSets: [['control-a', 'control-b']], expectedAmbiguous: false },
  { id: 'partly-overlapping-siblings', description: 'The selected strip intersects two overlapping sources; both need explicit review.',
    nodes: [node('left', box(0, 0, 120, 100)), node('right', box(80, 0, 120, 100))],
    region: box(20, 0, 160, 100), acceptableSourceSets: [['left', 'right']], expectedAmbiguous: true },
  { id: 'hidden-ancestry', description: 'Hidden parent and descendant are unavailable visual candidates; the visible sibling remains.',
    nodes: [node('hidden-parent', box(0, 0, 100, 100), 'root', { type: 'FRAME', visible: false }),
      node('hidden-child', box(0, 0, 100, 100), 'hidden-parent'), node('visible-control', box(0, 0, 100, 100))],
    region: box(0, 0, 100, 100), acceptableSourceSets: [['visible-control']], expectedAmbiguous: false },
  { id: 'zero-opacity-ancestry', description: 'A zero-opacity parent suppresses its child from automatic visual grounding.',
    nodes: [node('transparent-parent', box(0, 0, 100, 100), 'root', { type: 'FRAME', opacity: 0 }),
      node('transparent-child', box(0, 0, 100, 100), 'transparent-parent'), node('visible-control', box(0, 0, 100, 100))],
    region: box(0, 0, 100, 100), acceptableSourceSets: [['visible-control']], expectedAmbiguous: false },
  { id: 'child-outside-parent', description: 'A child lies entirely outside its parent bounds and must still be discoverable.',
    nodes: [node('parent', box(0, 0, 100, 100), 'root', { type: 'FRAME' }), node('overflow-child', box(300, 40, 60, 40), 'parent')],
    region: box(300, 40, 60, 40), acceptableSourceSets: [['overflow-child']], expectedAmbiguous: false },
  { id: 'empty-gap', description: 'The selection covers only empty space between two source nodes; a broad root is not the answer.',
    nodes: [node('left', box(0, 0, 80, 50)), node('right', box(120, 0, 80, 50))],
    region: box(90, 0, 20, 50), acceptableSourceSets: [[]], expectedAmbiguous: false },
  { id: 'touching-edge-only', description: 'Touching the outside edge has no positive intersection and must remain unresolved.',
    nodes: [node('source', box(0, 0, 80, 50))], region: box(80, 0, 20, 50), acceptableSourceSets: [[]], expectedAmbiguous: false },
  { id: 'incomplete-observation', description: 'Even an exact captured source cannot justify complete grounding when the requested scope is truncated.',
    nodes: [node('captured-source', box(20, 30, 80, 40))], region: box(20, 30, 80, 40),
    acceptableSourceSets: [[]], expectedAmbiguous: true, complete: false },
];

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function uniqueSorted(ids: readonly string[]): string[] {
  if (new Set(ids).size !== ids.length) throw new Error('Source sets must contain distinct IDs.');
  return [...ids].sort(compare);
}
const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
function metrics(tp: number, fp: number, fn: number) {
  return { tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), f1: ratio(2 * tp, 2 * tp + fp + fn) };
}
export function scoreSourceIds(predicted: readonly string[], alternatives: readonly (readonly string[])[]) {
  if (!alternatives.length) throw new Error('At least one explicit expected source set is required.');
  const predictedIds = uniqueSorted(predicted), predictedSet = new Set(predictedIds);
  const scores = alternatives.map(ids => {
    const expectedIds = uniqueSorted(ids), expectedSet = new Set(expectedIds);
    const tp = expectedIds.filter(id => predictedSet.has(id)).length;
    const fp = predictedIds.filter(id => !expectedSet.has(id)).length, fn = expectedIds.length - tp;
    return { expectedIds, predictedIds, ...metrics(tp, fp, fn), exactAcceptableSet: fp === 0 && fn === 0 };
  });
  // Pick one whole acceptable set; never union alternatives or maximize precision and recall separately.
  scores.sort((a, b) => Number(b.exactAcceptableSet) - Number(a.exactAcceptableSet) || (b.f1 ?? 0) - (a.f1 ?? 0) ||
    compare(JSON.stringify(a.expectedIds), JSON.stringify(b.expectedIds)));
  return scores[0]!;
}
const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const average = (values: Array<number | null>) => {
  const measured = values.filter((value): value is number => value !== null);
  return { value: measured.length ? measured.reduce((sum, value) => sum + value, 0) / measured.length : null, measuredCases: measured.length };
};

export function runGroundingBenchmark(options: { warmup?: number; repetitions?: number } = {}) {
  const warmup = options.warmup ?? 3, repetitions = options.repetitions ?? 25;
  if (!Number.isInteger(warmup) || warmup < 0 || !Number.isInteger(repetitions) || repetitions < 1) throw new Error('Invalid repetition count.');
  const cases = groundingCases.map(fixture => {
    const knownIds = new Set([root.id, ...fixture.nodes.map(value => value.id)]);
    if (knownIds.size !== fixture.nodes.length + 1 || fixture.acceptableSourceSets.some(set => set.some(id => !knownIds.has(id)))) {
      throw new Error(`Invalid constructed labels for ${fixture.id}.`);
    }
    const snapshot: Snapshot = { schemaVersion: '1.0.0', id: fixture.id, name: fixture.id,
      source: { fileKey: 'generated-grounding', pageId: 'generated-page', rootId: 'root', revision: null, capturedAt: '2026-10-26T00:00:00.000Z' },
      bounds: root.bbox!, nodes: [root, ...fixture.nodes], preview: null,
      completeness: { complete: fixture.complete ?? true, reason: fixture.complete === false ? 'maxNodes' : null }, warnings: [] };
    const result = matchRegion(snapshot, fixture.region);
    const permutations = [[...snapshot.nodes].reverse(), [...snapshot.nodes.slice(1), snapshot.nodes[0]!]];
    const deterministic = permutations.every(nodes => JSON.stringify(matchRegion({ ...snapshot, nodes }, fixture.region)) === JSON.stringify(result));
    for (let i = 0; i < warmup; i++) matchRegion(snapshot, fixture.region);
    const samples: number[] = [];
    for (let i = 0; i < repetitions; i++) {
      const started = performance.now(); matchRegion(snapshot, fixture.region); samples.push(rounded(performance.now() - started));
    }
    const sorted = [...samples].sort((a, b) => a - b);
    return { id: fixture.id, description: fixture.description, nodeCount: snapshot.nodes.length, scopeComplete: snapshot.completeness.complete, region: fixture.region,
      acceptableSourceSets: fixture.acceptableSourceSets, ...scoreSourceIds(result.sourceRefs.map(ref => ref.nodeId), fixture.acceptableSourceSets),
      ambiguous: result.ambiguous, expectedAmbiguous: fixture.expectedAmbiguous, candidateCount: result.candidates.length,
      deterministic, runtimeMs: { samples, median: sorted[Math.floor(sorted.length / 2)]!, min: sorted[0]!, max: sorted.at(-1)! } };
  });
  const tp = cases.reduce((sum, value) => sum + value.tp, 0), fp = cases.reduce((sum, value) => sum + value.fp, 0), fn = cases.reduce((sum, value) => sum + value.fn, 0);
  const noMatchCases = cases.filter(value => value.acceptableSourceSets.every(set => set.length === 0));
  return { schemaVersion: '1.0.0', kind: 'constructed-geometry-grounding-benchmark', measuredAt: new Date().toISOString(),
    command: 'npm run benchmark:grounding', generator: 'scripts/benchmark-grounding.ts',
    corpusSha256: createHash('sha256').update(JSON.stringify(groundingCases)).digest('hex'),
    runtime: { node: process.version, platform: process.platform, arch: process.arch, warmupPerCase: warmup, repetitionsPerCase: repetitions },
    labelMethod: 'Literal source-ID sets and acceptable alternatives written from constructed geometry roles; expected sets never invoke the matcher. Authored by the implementation agent, not independent human reviewers.',
    scoreMethod: 'Set TP/FP/FN against one acceptable set chosen by highest set F1; exact empty/empty is a successful no-match, with null precision/recall/F1 denominators. Ties use lexicographically sorted source IDs. Macro means exclude null denominators and report their counts.',
    limitations: ['Constructed scalar geometry only: no real Figma reads, images, paint order, mask or clipping interpretation.',
      'Perfect scores on these small selected cases do not establish representative accuracy, unseen-case generalization or semantic correctness.',
      'Equal-bounds alternatives deliberately do not label which layer is current or visibly on top. Ambiguity is reported separately from source-set accuracy.',
      'Runtime includes per-call index construction on 2–5 nodes; three warmups and 25 repetitions by default are local observations, not a performance gate.',
      'The incomplete-observation case labels required abstention, not the unknown complete source set. No-match and withheld cases are reported explicitly.'],
    semanticAccuracy: { status: 'not measured', reason: 'No independent human component/spec labels or representative real-world corpus.' },
    aggregate: { caseCount: cases.length, micro: metrics(tp, fp, fn), macro: { precision: average(cases.map(value => value.precision)), recall: average(cases.map(value => value.recall)), f1: average(cases.map(value => value.f1)) },
      exactAcceptableSetCount: cases.filter(value => value.exactAcceptableSet).length, deterministicCaseCount: cases.filter(value => value.deterministic).length,
      ambiguousCaseCount: cases.filter(value => value.ambiguous).length, ambiguityAgreementCount: cases.filter(value => value.ambiguous === value.expectedAmbiguous).length,
      completeScopeAmbiguousCount: cases.filter(value => value.scopeComplete && value.ambiguous).length,
      completeScopeAmbiguousFrequency: ratio(cases.filter(value => value.scopeComplete && value.ambiguous).length, cases.filter(value => value.scopeComplete).length),
      noMatchCaseCount: noMatchCases.length, correctNoMatchCount: noMatchCases.filter(value => value.predictedIds.length === 0).length,
      positiveCaseAbstentions: cases.filter(value => value.expectedIds.length > 0 && value.predictedIds.length === 0).length,
      completeEmptySpaceCases: groundingCases.filter(value => value.complete !== false && value.acceptableSourceSets.every(set => set.length === 0)).length,
      requiredIncompleteAbstentions: groundingCases.filter(value => value.complete === false).length }, cases };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const report = runGroundingBenchmark();
  await mkdir('docs/evaluation', { recursive: true });
  await writeFile('docs/evaluation/geometry-grounding.json', JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report.aggregate, null, 2) + '\n');
}
