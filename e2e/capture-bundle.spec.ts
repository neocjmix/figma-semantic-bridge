import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { startServer } from '../src/server/index.js';
import { createDemoProject } from '../src/demo/project.js';
import { CAPTURE_BUNDLE_MAX_BYTES, type CaptureBundle } from '../src/shared/capture-bundle.js';
import type { Project } from '../src/shared/contracts.js';

interface AppFixture {
  url: string; token: string; source: Project;
  read(id: string): Promise<Project>;
  projectCount(): Promise<number>;
}
const test = base.extend<{ app: AppFixture }>({
  app: async ({}, use) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fsb-capture-transfer-'));
    const token = 'synthetic-capture-transfer-token-0123456789';
    const server = await startServer({ port: 0, token, dataDir, webDir: resolve(process.env.FSB_E2E_WEB_DIR ?? 'dist/web'), aiConfig: null });
    try {
      const seed = createDemoProject();
      const ui = seed.snapshots[0]!, notes = seed.snapshots[1]!;
      // Seed approved human records so transfer must leave real persisted records intact.
      seed.annotations.push({ id: 'approved-search', snapshotId: ui.id, name: 'Approved search', role: 'component',
        bbox: ui.nodes.find(node => node.id === 'search-bg')!.bbox!, parentId: null,
        sourceRefs: [{ snapshotId: ui.id, nodeId: 'search-bg', matchType: 'exact' }], origin: 'human', reviewStatus: 'approved', revision: 1 });
      seed.specifications.push({ id: 'approved-behavior', text: notes.nodes.find(node => node.id === 'spec-search')!.text!,
        sourceRefs: [{ snapshotId: notes.id, nodeId: 'spec-search', matchType: 'exact' }],
        relations: [{ targetAnnotationId: 'approved-search', relationType: 'behavior', reviewStatus: 'approved' }],
        origin: 'human', reviewStatus: 'approved', revision: 1 });
      const source = await server.store.importProject(seed);
      await use({ url: server.url, token, source, read: id => server.store.get(id), projectCount: async () => (await server.store.list()).length });
    } finally { await server.close(); await rm(dataDir, { recursive: true, force: true }); }
  },
});

async function openTransfer(page: Page, app: AppFixture, source = true) {
  await page.addInitScript(({ token, projectId }) => {
    sessionStorage.setItem('fsb-token', token);
    if (projectId) sessionStorage.setItem('fsb-last-project', projectId);
  }, { token: app.token, projectId: source ? app.source.id : null });
  await page.goto(app.url);
  await page.getByText('Capture transfer', { exact: true }).click();
  await expect(page.getByText('Figma disconnected', { exact: true })).toBeVisible();
  return page.getByRole('region', { name: 'Capture transfer', exact: true });
}

async function exportBundle(page: Page, app: AppFixture) {
  const panel = page.getByRole('region', { name: 'Capture transfer', exact: true });
  for (const snapshot of app.source.snapshots) await panel.getByRole('checkbox', { name: `Export capture ${snapshot.name}`, exact: true }).check();
  const downloading = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export captures', exact: true }).click();
  const file = await downloading;
  const path = (await file.path())!;
  const content = await readFile(path, 'utf8');
  const bundle = JSON.parse(content) as CaptureBundle;
  expect(content).toBe(JSON.stringify(bundle)); // Compact serialization keeps the server's byte budget meaningful.
  return { path, bundle };
}

test('disconnected capture export and import preserve sources and leave approved records unchanged', async ({ page, app }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const panel = await openTransfer(page, app);
  await expect(panel).toContainText('without annotations or approvals');
  const { path, bundle } = await exportBundle(page, app);
  expect(bundle.snapshots.map(entry => entry.snapshot)).toEqual(app.source.snapshots);
  expect(bundle).not.toHaveProperty('annotations');
  expect(bundle).not.toHaveProperty('specifications');
  expect(bundle).not.toHaveProperty('proposals');
  expect(await app.read(app.source.id)).toEqual(app.source);
  // Import also works before choosing any workspace, with only the local server paired.
  await page.getByRole('button', { name: 'Disconnect editor', exact: true }).click();
  await page.getByLabel('Pairing token').fill(app.token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByText('Capture transfer', { exact: true }).click();
  await expect(page.getByLabel('Open workspace')).toHaveValue('');
  await page.getByLabel('Capture file (.json)', { exact: true }).setInputFiles(path);
  await page.getByLabel('New workspace name for this import', { exact: true }).fill('Transferred review');
  await page.getByRole('button', { name: 'Import captures', exact: true }).click();
  await expect(page.locator('.project-heading')).toHaveText('Transferred review');
  await expect(page.getByRole('status')).toContainText('Source contents are unverified');
  const importedId = await page.getByLabel('Open workspace').inputValue();
  expect(importedId).not.toBe(app.source.id);
  const imported = await app.read(importedId);
  expect(imported.snapshots).toEqual(app.source.snapshots);
  expect(imported.annotations).toEqual([]);
  expect(imported.specifications).toEqual([]);
  expect(imported.proposals).toEqual([]);
  expect(await app.read(app.source.id)).toEqual(app.source);
  expect(await app.projectCount()).toBe(2);
  await page.getByLabel('Open workspace').selectOption(app.source.id);
  await expect(page.locator('.component-list')).toContainText('Approved search');
  const approvedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const approved = JSON.parse(await readFile((await (await approvedDownload).path())!, 'utf8')) as { annotations: unknown[]; specifications: unknown[] };
  expect(approved.annotations).toHaveLength(1);
  expect(approved.specifications).toHaveLength(1);
  await page.getByText('Capture transfer', { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('capture-transfer.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('oversized and malformed files are rejected without replacing or creating a workspace', async ({ page, app }) => {
  const panel = await openTransfer(page, app);
  let imports = 0;
  page.on('request', req => { if (new URL(req.url()).pathname === '/api/capture-bundles/import') imports++; });
  const input = page.getByLabel('Capture file (.json)', { exact: true });
  await input.setInputFiles({ name: 'too-large.json', mimeType: 'application/json', buffer: Buffer.alloc(CAPTURE_BUNDLE_MAX_BYTES + 1, 32) });
  await expect(panel.getByRole('alert')).toContainText('no larger than 15 MB');
  await expect(panel.getByRole('button', { name: 'Import captures', exact: true })).toBeDisabled();
  await input.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await panel.getByRole('button', { name: 'Import captures', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be read as JSON');
  expect(imports).toBe(0);
  await input.setInputFiles({ name: 'wrong-shape.json', mimeType: 'application/json', buffer: Buffer.from('{"kind":"not-a-capture"}') });
  const rejected = page.waitForResponse(res => new URL(res.url()).pathname === '/api/capture-bundles/import');
  await panel.getByRole('button', { name: 'Import captures', exact: true }).click();
  expect((await rejected).status()).toBe(400);
  await expect(page.getByRole('alert')).toBeVisible();
  expect(imports).toBe(1);
  expect(await app.projectCount()).toBe(1);
  expect(await app.read(app.source.id)).toEqual(app.source);
  await expect(page.getByLabel('Open workspace')).toHaveValue(app.source.id);
});

test('unsaved annotations, specifications and draft input block importing', async ({ page, app }) => {
  const panel = await openTransfer(page, app);
  const { path } = await exportBundle(page, app);
  await page.getByLabel('Capture file (.json)', { exact: true }).setInputFiles(path);
  const importButton = panel.getByRole('button', { name: 'Import captures', exact: true });
  await expect(importButton).toBeEnabled();
  await page.locator('.component-list').getByRole('button', { name: 'Approved search', exact: true }).click();
  await page.getByLabel('Component name', { exact: true }).fill('Unsaved name');
  await expect(importButton).toBeDisabled();
  await expect(panel).toContainText('Save your unsaved');
  await page.getByLabel('Component name', { exact: true }).fill('Approved search');
  await expect(importButton).toBeEnabled();
  await page.getByRole('tab', { name: 'Specifications', exact: true }).click();
  await page.locator('.spec-list button').click();
  const relation = page.getByLabel('Relation to Approved search', { exact: true });
  await relation.selectOption('constraint');
  await expect(importButton).toBeDisabled();
  await relation.selectOption('behavior');
  await expect(importButton).toBeEnabled();
  await page.getByRole('tab', { name: /^Drafts/ }).click();
  await page.getByLabel('Draft JSON', { exact: true }).fill('{"annotations":[]');
  await expect(importButton).toBeDisabled();
  expect(await app.read(app.source.id)).toEqual(app.source);
  expect(await app.projectCount()).toBe(1);
});

test('pending import locks workspace changes and cannot be submitted twice', async ({ page, app }) => {
  const panel = await openTransfer(page, app);
  const { path } = await exportBundle(page, app);
  await page.locator('.component-list').getByRole('button', { name: 'Approved search', exact: true }).click();
  await page.getByLabel('Capture file (.json)', { exact: true }).setInputFiles(path);
  let release!: () => void, intercepted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const seen = new Promise<void>(resolve => { intercepted = resolve; });
  let imports = 0;
  await page.route('**/api/capture-bundles/import', async route => {
    imports++; const response = await route.fetch(); intercepted(); await gate; await route.fulfill({ response });
  });
  await panel.getByRole('button', { name: 'Import captures', exact: true }).click();
  try {
    await seen;
    await expect(panel.getByRole('button', { name: 'Import captures', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Open workspace')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Disconnect editor', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Component name', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Capture file (.json)', { exact: true })).toBeDisabled();
    await expect(page.getByRole('status')).toHaveText('Working…');
  } finally { release(); }
  await expect(page.locator('.project-heading')).toHaveText('Imported captures');
  expect(imports).toBe(1);
  expect(await app.projectCount()).toBe(2);
  expect(await app.read(app.source.id)).toEqual(app.source);
});
