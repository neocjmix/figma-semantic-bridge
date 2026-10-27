import { openWorkspaceTools } from './workflow-controls.js';
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
  await page.getByText('Source files', { exact: true }).click();
  await expect(page.getByText('Figma disconnected', { exact: true })).toBeVisible();
  return page.locator('.source-transfer-panel');
}

async function exportBundle(page: Page, app: AppFixture) {
  // The former export endpoint remains a compatibility reader, outside the normal UI.
  const response = await page.request.post(`${app.url}/api/projects/${app.source.id}/capture-bundle`, {
    headers: { Authorization: `Bearer ${app.token}` },
    data: { expectedRevision: app.source.revision, snapshotIds: app.source.snapshots.map(snapshot => snapshot.id) },
  });
  expect(response.ok()).toBe(true);
  const bundle = await response.json() as CaptureBundle;
  return { path: { name: 'Transferred review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) }, bundle };
}

test('legacy source file import through the unified picker preserve sources and leave approved records unchanged', async ({ page, app }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const panel = await openTransfer(page, app);
  await expect(panel).toContainText('Annotations, specifications and approvals are not included.');
  const { path, bundle } = await exportBundle(page, app);
  expect(bundle.snapshots.map(entry => entry.snapshot)).toEqual(app.source.snapshots);
  expect(bundle).not.toHaveProperty('annotations');
  expect(bundle).not.toHaveProperty('specifications');
  expect(bundle).not.toHaveProperty('proposals');
  expect(await app.read(app.source.id)).toEqual(app.source);
  // Import also works before choosing any workspace, with only the local server paired.
  await openWorkspaceTools(page);
  await page.getByRole('button', { name: 'Disconnect editor', exact: true }).click();
  await page.getByLabel('Pairing token').fill(app.token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByText('Source files', { exact: true }).click();
  await expect(page.getByLabel('Open workspace')).toHaveValue('');
  await page.getByLabel('Source file (.ndjson or .json)', { exact: true }).setInputFiles(path);
  await page.getByRole('button', { name: 'Import source file', exact: true }).click();
  await expect(page.locator('.project-heading')).toHaveText('Transferred review');
  await expect(page.locator('.status-bar')).toHaveText('Source file imported. Draw a region and review its linked nodes.');
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
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const approved = JSON.parse(await readFile((await (await approvedDownload).path())!, 'utf8')) as { annotations: unknown[]; specifications: unknown[] };
  expect(approved.annotations).toHaveLength(1);
  expect(approved.specifications).toHaveLength(1);
  await page.getByRole('dialog', { name: 'Share approved work' }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByText('Source files', { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('capture-transfer.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('a complete older capture downloads through the same source file route',async({page,app})=>{
  const panel=await openTransfer(page,app);
  const original=app.source.snapshots[0]!;
  await panel.getByLabel('Source structure to share').selectOption(original.id);
  const downloading=page.waitForEvent('download');
  await panel.getByRole('button',{name:'Download source file',exact:true}).click();
  const bytes=await readFile(await(await downloading).path());
  expect(bytes.toString('utf8')).not.toContain('approved-search');
  await panel.getByLabel('Source file (.ndjson or .json)',{exact:true}).setInputFiles({name:'older-source.ndjson',mimeType:'application/x-ndjson',buffer:bytes});
  await panel.getByRole('button',{name:'Import source file',exact:true}).click();
  await expect(page.locator('.snapshot-item')).toHaveCount(app.source.snapshots.length+1);
  const imported=await app.read(app.source.id);
  expect(imported.snapshots).toEqual(app.source.snapshots);
  expect(imported.annotations).toEqual(app.source.annotations);expect(imported.specifications).toEqual(app.source.specifications);
  expect(imported.scopes).toHaveLength(1);expect(imported.scopes![0]!.kind).toBe('collection');
  expect(imported.scopes![0]!.preview).toEqual(original.preview);
  expect(imported.scopes![0]!.collection!.nodeCount).toBe(original.nodes.length);
});

test('oversized and malformed files are rejected without replacing or creating a workspace', async ({ page, app }) => {
  const panel = await openTransfer(page, app);
  let imports = 0;
  page.on('request', req => { if (new URL(req.url()).pathname === '/api/capture-bundles/import') imports++; });
  const input = page.getByLabel('Source file (.ndjson or .json)', { exact: true });
  await input.setInputFiles({ name: 'too-large.json', mimeType: 'application/json', buffer: Buffer.alloc(CAPTURE_BUNDLE_MAX_BYTES + 1, 32) });
  await expect(panel.getByRole('alert')).toContainText('no larger than 15 MB');
  await expect(panel.getByRole('button', { name: 'Import source file', exact: true })).toBeDisabled();
  await input.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await panel.getByRole('button', { name: 'Import source file', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be read as JSON');
  expect(imports).toBe(0);
  await input.setInputFiles({ name: 'wrong-shape.json', mimeType: 'application/json', buffer: Buffer.from('{"kind":"not-a-capture"}') });
  const rejected = page.waitForResponse(res => new URL(res.url()).pathname === '/api/capture-bundles/import');
  await panel.getByRole('button', { name: 'Import source file', exact: true }).click();
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
  await page.getByLabel('Source file (.ndjson or .json)', { exact: true }).setInputFiles(path);
  const importButton = panel.getByRole('button', { name: 'Import source file', exact: true });
  await expect(importButton).toBeEnabled();
  await page.locator('.component-list').getByRole('button', { name: 'Approved search', exact: true }).click();
  await page.getByLabel('Component name', { exact: true }).fill('Unsaved name');
  await expect(importButton).toBeDisabled();
  await expect(panel).toContainText('Save your changes before importing');
  await page.getByLabel('Component name', { exact: true }).fill('Approved search');
  await expect(importButton).toBeEnabled();
  await page.getByRole('tab', { name: 'Specifications', exact: true }).click();
  await page.locator('.spec-list button').click();
  await page.locator('.component-link-options > summary').click();
  await page.locator('.relation-options > summary').click();
  const relation = page.getByLabel('Relation to Approved search', { exact: true });
  await relation.selectOption('constraint');
  await expect(importButton).toBeDisabled();
  await relation.selectOption('behavior');
  await expect(importButton).toBeEnabled();
  await page.getByRole('tab', { name: /^Review suggestions/ }).click();
  await page.locator('.structured-proposal > summary').click();
  await page.getByLabel('Draft JSON', { exact: true }).fill('{"annotations":[]');
  await expect(importButton).toBeDisabled();
  expect(await app.read(app.source.id)).toEqual(app.source);
  expect(await app.projectCount()).toBe(1);
});

test('pending import locks workspace changes and cannot be submitted twice', async ({ page, app }) => {
  const panel = await openTransfer(page, app);
  await openWorkspaceTools(page);
  const { path } = await exportBundle(page, app);
  await page.locator('.component-list').getByRole('button', { name: 'Approved search', exact: true }).click();
  await page.getByLabel('Source file (.ndjson or .json)', { exact: true }).setInputFiles(path);
  let release!: () => void, intercepted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const seen = new Promise<void>(resolve => { intercepted = resolve; });
  let imports = 0;
  await page.route('**/api/capture-bundles/import', async route => {
    imports++; const response = await route.fetch(); intercepted(); await gate; await route.fulfill({ response });
  });
  await panel.getByRole('button', { name: 'Import source file', exact: true }).click();
  try {
    await seen;
    await expect(panel.getByRole('button', { name: 'Import source file', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Open workspace')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Disconnect editor', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Component name', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Source file (.ndjson or .json)', { exact: true })).toBeDisabled();
    await expect(page.locator('.status-bar')).toHaveText('Working…');
  } finally { release(); }
  await expect(page.locator('.project-heading')).toHaveText('Transferred review');
  expect(imports).toBe(1);
  expect(await app.projectCount()).toBe(2);
  expect(await app.read(app.source.id)).toEqual(app.source);
});
