import assert from 'node:assert/strict';
import test from 'node:test';
import { groundingCases, runGroundingBenchmark, scoreSourceIds } from '../scripts/benchmark-grounding.js';

test('grounding score reports false positives, omissions, abstentions and empty denominators', () => {
  assert.deepEqual(scoreSourceIds(['one', 'extra'], [['one', 'missing']]), {
    expectedIds: ['missing', 'one'], predictedIds: ['extra', 'one'], tp: 1, fp: 1, fn: 1,
    precision: 0.5, recall: 0.5, f1: 0.5, exactAcceptableSet: false,
  });
  const empty = scoreSourceIds([], [[]]);
  assert.equal(empty.precision, null); assert.equal(empty.recall, null); assert.equal(empty.f1, null);
  assert.equal(empty.exactAcceptableSet, true);
  const abstained = scoreSourceIds([], [['required']]);
  assert.equal(abstained.precision, null); assert.equal(abstained.recall, 0); assert.equal(abstained.fn, 1);
  assert.equal(abstained.f1, 0);
  const extra = scoreSourceIds(['unexpected'], [[]]);
  assert.equal(extra.precision, 0); assert.equal(extra.recall, null); assert.equal(extra.fp, 1);
  assert.throws(() => scoreSourceIds(['duplicate', 'duplicate'], [['duplicate']]));
  assert.throws(() => scoreSourceIds([], []));
});

test('alternative labels choose one consistent set and stable tie, not a union of acceptable sets', () => {
  const score = scoreSourceIds(['b', 'c'], [['a', 'c'], ['b', 'd']]);
  assert.deepEqual(score.expectedIds, ['a', 'c']);
  assert.equal(score.tp, 1); assert.equal(score.fp, 1); assert.equal(score.fn, 1);
  assert.deepEqual(scoreSourceIds(['b', 'c'], [['b', 'd'], ['a', 'c']]), score);
});

test('literal synthetic labels cover geometry modes and report ambiguity separately from matching accuracy', () => {
  const report = runGroundingBenchmark({ warmup: 0, repetitions: 1 });
  assert.equal(report.cases.length, groundingCases.length);
  assert.ok(report.cases.length >= 12);
  assert.equal(report.aggregate.exactAcceptableSetCount, groundingCases.length);
  assert.equal(report.aggregate.deterministicCaseCount, groundingCases.length);
  assert.equal(report.aggregate.ambiguityAgreementCount, groundingCases.length);
  assert.ok(report.aggregate.ambiguousCaseCount > 0);
  assert.ok(report.aggregate.correctNoMatchCount > 0);
  assert.equal(report.aggregate.micro.fp, 0); assert.equal(report.aggregate.micro.fn, 0);
  assert.equal(report.semanticAccuracy.status, 'not measured');
  assert.ok(report.cases.every(result => result.runtimeMs.samples.length === 1));
});
