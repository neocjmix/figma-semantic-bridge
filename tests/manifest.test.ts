import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadManifestValidator, manifestConsistencyErrors, validateManifests } from '../scripts/validate-manifests.js';

const baseline = JSON.parse(await readFile(new URL('../fixtures/public/manifest.json', import.meta.url), 'utf8'));
const synthetic = JSON.parse(await readFile(new URL('../fixtures/synthetic/manifest.json', import.meta.url), 'utf8'));

test('public and synthetic fixture registries satisfy schema and source identities', async () => {
  assert.equal(await validateManifests(), 2);
});

test('a measured metric requires a value, unit, method, scope and evidence', async () => {
  const validate = await loadManifestValidator();
  const value = structuredClone(baseline);
  value.fixtures[0].metrics.totalNodeCount = { status: 'measured' };
  assert.equal(validate(value), false);
});

test('not measured cannot carry a fake numeric zero', async () => {
  const validate = await loadManifestValidator();
  const value = structuredClone(baseline);
  value.fixtures[0].metrics.totalNodeCount.value = 0;
  assert.equal(validate(value), false);
});

test('candidate status cannot imply verified structure', async () => {
  const validate = await loadManifestValidator();
  const value = structuredClone(baseline);
  value.fixtures[0].verification.structureVerified = true;
  assert.equal(validate(value), false);
});

test('validated status requires a verified scope', async () => {
  const validate = await loadManifestValidator();
  const value = structuredClone(baseline);
  value.fixtures[0].verification.status = 'validated';
  value.fixtures[0].verification.structureVerified = true;
  assert.equal(validate(value), false);
});

test('structureVerified requires complete bounded analysis with a report', async () => {
  const validate = await loadManifestValidator();
  for (const change of [
    { method: 'page-inventory' },
    { complete: false },
    { report: null },
  ]) {
    const value = structuredClone(synthetic);
    value.fixtures[0].verification.verifiedScopes = [{
      pageId: '0:1', nodeIds: ['0:1'], method: 'bounded-plugin-analysis',
      checkedAt: '2026-10-22', complete: true, report: 'fixtures/synthetic/live-figma-measurements.json',
      ...change,
    }];
    value.fixtures[0].verification.structureVerified = true;
    assert.equal(validate(value), false);
  }
});

test('validated public fixtures require image review, license evidence and actual duplication', async () => {
  const validate = await loadManifestValidator();
  const promoted = structuredClone(baseline);
  promoted.fixtures[0].verification = {
    ...structuredClone(synthetic.fixtures[0].verification), status: 'validated',
  };
  promoted.fixtures[0].duplication.attemptStatus = 'succeeded';
  promoted.fixtures[0].duplication.copyFileKey = 'ExampleCopyKey';
  assert.equal(validate(promoted), true);
  for (const change of ['image', 'license', 'evidence', 'duplication']) {
    const value = structuredClone(promoted);
    if (change === 'image') value.fixtures[0].verification.visualReview = 'not performed';
    if (change === 'license') value.fixtures[0].license.status = 'unknown';
    if (change === 'evidence') value.fixtures[0].license.evidence = [];
    if (change === 'duplication') value.fixtures[0].duplication.attemptStatus = 'not attempted';
    assert.equal(validate(value), false);
  }
});

test('numeric Community resource ID cannot be used as a Figma file key', async () => {
  const validate = await loadManifestValidator();
  const value = structuredClone(baseline);
  value.fixtures[0].source.fileKey = value.fixtures[0].source.communityResourceId;
  assert.equal(validate(value), false);
});

test('provenance consistency detects wrong URL identities and repeated dimensions', () => {
  const value = structuredClone(baseline);
  value.fixtures[0].source.communityResourceId = '123';
  value.fixtures[0].qualitative[1].dimension = value.fixtures[0].qualitative[0].dimension;
  assert.equal(manifestConsistencyErrors(value).length, 2);
});

test('source assets cannot enter a metadata-only fixture registry', async () => {
  const validate = await loadManifestValidator();
  const value = structuredClone(baseline);
  value.artifactPolicy.sourceDataCommitted = true;
  assert.equal(validate(value), false);
});

test('public corpus cannot use the synthetic permission exception', async () => {
  const validate = await loadManifestValidator();
  const value = structuredClone(baseline);
  value.fixtures[0].license.status = 'synthetic-project-fixture';
  value.fixtures[0].duplication.permission = 'synthetic-baseline';
  assert.equal(validate(value), false);
});
