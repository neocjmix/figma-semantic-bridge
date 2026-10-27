import { openSourceOptions } from './workflow-controls.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { startServer } from '../src/server/index.js';
import { createDemoProject } from '../src/demo/project.js';
import type { Annotation, Project } from '../src/shared/contracts.js';

interface AppFixture { url: string; token: string; initial: Project; read(): Promise<Project> }
const test = base.extend<{ app: AppFixture }>({
  app: async ({}, use) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fsb-rendering-review-'));
    const token = 'synthetic-rendering-review-token-0123456789';
    const server = await startServer({ port: 0, token, dataDir, webDir: resolve(process.env.FSB_E2E_WEB_DIR ?? 'dist/web'), aiConfig: null });
    try {
      const seed = createDemoProject(), legacy = seed.snapshots[0]!;
      const observed = structuredClone(legacy);
      observed.id = 'observed-ui'; observed.name = 'Observed screen';
      for (const [index, node] of observed.nodes.entries()) {
        node.rendering = index === 0 ? { opacity: 1 } : { opacity: 1, siblingIndex: index - 1 };
        if (node.id === observed.source.rootId) node.parentId = observed.source.pageId;
      }
      const search = observed.nodes.find(node => node.id === 'search-bg')!;
      observed.nodes.push({ ...search, id: 'transparent-source', name: 'Transparent alternative', rendering: { opacity: 0, siblingIndex: 18 } });
      observed.nodes.push({ ...search, id: 'hidden-source', name: 'Hidden alternative', visible: false, rendering: { opacity: 1, siblingIndex: 19 } });
      observed.nodes.push({ ...search, id: 'unknown-source', name: 'Unobserved opacity source', bbox: { x: 905, y: 665, width: 95, height: 25 }, rendering: { siblingIndex: 20 } });
      seed.snapshots.push(observed);
      const annotation = (id: string, snapshotId: string, nodeId: string, name: string): Annotation => ({
        id, snapshotId, name, role: 'component', bbox: (snapshotId === legacy.id ? legacy : observed).nodes.find(node => node.id === nodeId)!.bbox!,
        parentId: null, sourceRefs: [{ snapshotId, nodeId, matchType: 'exact' }], origin: 'human', reviewStatus: 'proposed', revision: 0,
      });
      legacy.nodes.push({ ...legacy.nodes.find(node => node.id === 'search-bg')!, id: 'legacy-hidden-source', name: 'Legacy hidden source', visible: false });
      const oldHidden = annotation('legacy-hidden-pending', legacy.id, 'legacy-hidden-source', 'Legacy hidden pending region');
      oldHidden.sourceReview = { candidates: [], ambiguous: false, warnings: [], status: 'unconfirmed', confirmedAt: null };
      seed.annotations.push(oldHidden,
        { ...structuredClone(oldHidden), id: 'legacy-hidden-confirmed', name: 'Legacy hidden confirmed region', sourceReview: { ...oldHidden.sourceReview, status: 'confirmed', confirmedAt: '2026-10-23T00:00:00.000Z' } },
        { ...structuredClone(oldHidden), id: 'legacy-hidden-approved', name: 'Legacy hidden approved region', reviewStatus: 'approved' });
      seed.annotations.push({ ...annotation('original-approved', legacy.id, 'search-bg', 'Original approved region'), reviewStatus: 'approved', revision: 3 });
      let project = await server.store.importProject(seed);
      for (const record of [annotation('review-region', observed.id, 'search-bg', 'Rendering review'),
        annotation('unknown-region', observed.id, 'unknown-source', 'Unknown rendering review'),
        annotation('legacy-pending', legacy.id, 'heading', 'Legacy pending region')]) {
        project = await server.store.mutate(project.id, project.revision, { type: 'upsert_annotation', annotation: record }, 'human');
      }
      await use({ url: server.url, token, initial: project, read: () => server.store.get(project.id) });
    } finally { await server.close(); await rm(dataDir, { recursive: true, force: true }); }
  },
});

async function openRegion(page: Page, app: AppFixture, name: string, captureName = /Observed screen/) {
  await page.addInitScript(({ token, projectId }) => {
    sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', projectId);
  }, { token: app.token, projectId: app.initial.id });
  await page.goto(app.url);
  // Choose the capture first because the component list is scoped to that capture.
  await page.locator('.snapshot-list').getByRole('button', { name: captureName }).click();
  await page.locator('.component-list').getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review linked nodes', exact: true })).toBeVisible();
}

async function save(page: Page) {
  const saved = page.waitForResponse(response => /\/mutate$/.test(response.url()) && response.request().postDataJSON()?.operation?.type === 'upsert_annotation');
  await page.getByRole('button', { name: 'Save region', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('.unsaved')).toHaveCount(0);
}

test('excluded transparent and hidden sources remain selectable and require explicit confirmation', async ({ page, app }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openRegion(page, app, 'Rendering review');
  const approve = page.getByRole('button', { name: 'Approve region', exact: true });
  await expect(approve).toBeEnabled();
  await expect(page.getByLabel('Selected source nodes')).toContainText('May be visible in this capture');
  await expect(page.getByLabel('Review source connections')).toContainText('Other layers, masks and clipping may cover it');
  await expect(page.locator('.source-candidate').filter({ hasText: 'Transparent alternative' })).toHaveCount(0);
  await expect(page.locator('.source-candidate').filter({ hasText: 'Hidden alternative' })).toHaveCount(0);
  await openSourceOptions(page);
  await page.getByText('Choose source nodes manually', { exact: true }).click();
  await page.getByLabel('Search captured nodes', { exact: true }).fill('transparent-source');
  const transparent = page.locator('.manual-sources').getByRole('checkbox', { name: /Transparent alternative/ });
  await expect(transparent).toBeEnabled();
  await expect(page.locator('.manual-sources')).toContainText('Captured opacity: 0');
  await expect(page.locator('.manual-sources')).toContainText('Layer order: 18');
  await transparent.check();
  await expect(page.getByLabel('Selected source nodes')).toContainText('Transparent');
  await save(page);
  let current = (await app.read()).annotations.find(annotation => annotation.id === 'review-region')!;
  expect(current.sourceReview?.ambiguous).toBe(false);
  expect(current.sourceReview?.renderingReviewRequired).toBe(true);
  await expect(approve).toBeDisabled();
  await expect(page.getByText('Check source visibility before confirming', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm sources', exact: true }).click();
  await expect(approve).toBeEnabled();
  current = (await app.read()).annotations.find(annotation => annotation.id === 'review-region')!;
  expect(current.reviewStatus).toBe('proposed');
  expect(current.sourceReview?.status).toBe('confirmed');
  await approve.click();
  await expect(page.locator('.inspector-content > .section-title .badge')).toHaveText('approved');
  await page.getByLabel('Search captured nodes', { exact: true }).fill('hidden-source');
  const hidden = page.locator('.manual-sources').getByRole('checkbox', { name: /Hidden alternative/ });
  await expect(hidden).toBeEnabled();
  await hidden.check();
  await save(page);
  await expect(page.getByLabel('Selected source nodes')).toContainText('Hidden');
  await expect(approve).toBeDisabled();
  const after = await app.read();
  current = after.annotations.find(annotation => annotation.id === 'review-region')!;
  expect(current.sourceReview?.status).toBe('unconfirmed');
  expect(current.sourceReview?.renderingReviewRequired).toBe(true);
  expect(current.reviewStatus).toBe('proposed');
  expect(after.annotations.find(annotation => annotation.id === 'original-approved')).toEqual(app.initial.annotations.find(annotation => annotation.id === 'original-approved'));
  expect(after.snapshots).toEqual(app.initial.snapshots);
  await page.getByText('Check source visibility before confirming', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('rendering-source-review.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('new unknown evidence requires confirmation while legacy unknown keeps its prior approval behavior', async ({ page, app }) => {
  await openRegion(page, app, 'Unknown rendering review');
  const selected = page.getByLabel('Selected source nodes');
  await expect(selected).toContainText('Unknown');
  await expect(page.getByRole('button', { name: 'Approve region', exact: true })).toBeDisabled();
  const unknown = (await app.read()).annotations.find(annotation => annotation.id === 'unknown-region')!;
  expect(unknown.sourceReview?.ambiguous).toBe(false);
  expect(unknown.sourceReview?.renderingReviewRequired).toBe(true);
  await page.getByRole('button', { name: 'Confirm sources', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve region', exact: true })).toBeEnabled();
  await page.locator('.snapshot-list').getByRole('button', { name: /Workspace \/ Members/ }).click();
  await page.locator('.component-list').getByRole('button', { name: 'Legacy pending region', exact: true }).click();
  await expect(selected).toContainText('Unknown');
  await expect(page.locator('.rendering-legacy-note')).toContainText('existing approvals are kept');
  await expect(page.getByRole('button', { name: 'Approve region', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve region', exact: true }).click();
  await expect(page.locator('.inspector-content > .section-title .badge')).toHaveText('approved');
  const after = await app.read();
  expect(after.annotations.find(annotation => annotation.id === 'legacy-pending')?.reviewStatus).toBe('approved');
  expect(after.annotations.find(annotation => annotation.id === 'original-approved')).toEqual(app.initial.annotations.find(annotation => annotation.id === 'original-approved'));
  expect(after.snapshots).toEqual(app.initial.snapshots);
});

test('legacy pending hidden sources require confirmation even without a stored rendering flag', async ({ page, app }) => {
  const original = app.initial.annotations.find(annotation => annotation.id === 'legacy-hidden-pending')!;
  expect(original.sourceReview).toMatchObject({ ambiguous: false, status: 'unconfirmed' });
  expect(original.sourceReview?.renderingReviewRequired).toBeUndefined();
  await openRegion(page, app, 'Legacy hidden pending region', /Workspace \/ Members/);
  const approve = page.getByRole('button', { name: 'Approve region', exact: true });
  await expect(page.getByLabel('Selected source nodes')).toContainText('Hidden');
  await expect(page.getByText('Check source visibility before confirming', { exact: true })).toBeVisible();
  await expect(approve).toBeDisabled();
  expect((await app.read()).annotations.find(annotation => annotation.id === original.id)).toEqual(original);

  await page.locator('.component-list').getByRole('button', { name: 'Legacy hidden confirmed region', exact: true }).click();
  await expect(page.getByText('Sources confirmed. Review the region name and meaning, then approve it.', { exact: true })).toBeVisible();
  await expect(approve).toBeEnabled();
  await page.locator('.component-list').getByRole('button', { name: 'Legacy hidden pending region', exact: true }).click();
  await expect(approve).toBeDisabled();
  await page.getByRole('button', { name: 'Confirm sources', exact: true }).click();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.locator('.inspector-content > .section-title .badge')).toHaveText('approved');
  const after = await app.read();
  expect(after.annotations.find(annotation => annotation.id === original.id)).toMatchObject({
    reviewStatus: 'approved', sourceReview: { status: 'confirmed', renderingReviewRequired: true },
  });
  for (const id of ['original-approved', 'legacy-hidden-approved', 'legacy-hidden-confirmed']) {
    expect(after.annotations.find(annotation => annotation.id === id)).toEqual(app.initial.annotations.find(annotation => annotation.id === id));
  }
  expect(after.snapshots).toEqual(app.initial.snapshots);
});
