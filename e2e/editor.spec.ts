import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { startServer } from '../src/server/index.js';
import type { Project } from '../src/shared/contracts.js';

const test = base.extend<{ app: { url: string; token: string } }>({
  app: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'fsb-browser-'));
    const token = 'synthetic-browser-test-token-0123456789';
    const server = await startServer({ port: 0, token, dataDir: dir, webDir: resolve('dist/web') });
    try { await use({ url: server.url, token }); }
    finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
  },
});

async function openDemo(page: Page, app: { url: string; token: string }) {
  await page.goto(app.url);
  await page.getByLabel('Pairing token').fill(app.token);
  await page.getByRole('button', { name: 'Pair server', exact: true }).click();
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Design canvas' })).toBeVisible();
}

async function saveAnnotation(page: Page, whilePending?: () => Promise<void>) {
  const savedResponse = page.waitForResponse(response => {
    const request = response.request();
    return request.method() === 'POST' && /\/api\/projects\/[^/]+\/mutate$/.test(new URL(response.url()).pathname)
      && request.postDataJSON()?.operation?.type === 'upsert_annotation';
  });
  const button = page.getByRole('button', { name: 'Save annotation', exact: true });
  await button.click();
  await whilePending?.();
  const response = await savedResponse;
  expect(response.status()).toBe(200);
  const saved: Project = await response.json();
  expect(saved.revision).toBe(response.request().postDataJSON().expectedRevision + 1);
  await expect(page.locator('.revision')).toHaveText(`revision ${saved.revision}`);
  await expect(page.getByRole('status')).toHaveText('Annotation saved. Match source nodes, then review it.');
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await expect(button).toBeEnabled();
  return saved;
}

async function drawRegion(page: Page, bbox: { x: number; y: number; width: number; height: number }, name: string) {
  await page.getByRole('button', { name: 'Draw region', exact: true }).click();
  const points = await page.getByRole('img', { name: 'Design canvas' }).evaluate((element, box) => {
    const matrix = (element as SVGSVGElement).getScreenCTM()!;
    const start = new DOMPoint(box.x, box.y).matrixTransform(matrix);
    const end = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix);
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
  }, bbox);
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 5 });
  await page.mouse.up();
  await page.getByLabel('Component name').fill(name);
  await saveAnnotation(page);
  await expect(page.locator('.component-list')).toContainText(name);
}

test('draw, ground, approve, map many-to-many specs, export and restore a workspace', async ({ page, app }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await openDemo(page, app);
  await drawRegion(page, { x: 320, y: 330, width: 720, height: 300 }, 'Members table');
  await page.getByRole('button', { name: 'Match source', exact: true }).click();
  await expect(page.locator('.source-references')).toContainText('table-bg');
  await page.getByRole('button', { name: 'Approve annotation', exact: true }).click();
  await expect(page.locator('.inspector-content .badge').first()).toHaveText('approved');
  await drawRegion(page, { x: 320, y: 250, width: 480, height: 48 }, 'Member search');
  await page.getByRole('button', { name: 'Match source', exact: true }).click();
  await expect(page.locator('.source-references')).toContainText('search-bg');
  await page.getByRole('button', { name: 'Approve annotation', exact: true }).click();
  await page.getByRole('tab', { name: 'Specifications', exact: true }).click();
  await page.getByLabel(/When no members match/).check();
  await page.getByRole('button', { name: 'Create specification', exact: true }).click();
  await page.locator('.relation-list input[type=checkbox]').nth(0).check();
  await page.locator('.relation-list input[type=checkbox]').nth(1).check();
  await page.getByRole('button', { name: 'Save specification', exact: true }).click();
  await page.getByRole('button', { name: 'Approve specification', exact: true }).click();
  await expect(page.locator('.spec-list .badge').first()).toHaveText('approved');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloadEvent;
  const path = await download.path();
  const exported = JSON.parse(await readFile(path!, 'utf8')) as { annotations: { name: string }[]; specifications: { text: string; relations: unknown[] }[] };
  expect(exported.annotations.map(a => a.name)).toEqual(expect.arrayContaining(['Members table', 'Member search']));
  expect(exported.specifications[0]?.text).toBe('When no members match, show an empty state and keep the active filters visible.');
  expect(exported.specifications[0]?.relations).toHaveLength(2);
  await page.screenshot({ path: testInfo.outputPath('approved-editor.png'), fullPage: true });
  await page.reload();
  await expect(page.getByRole('img', { name: 'Design canvas' })).toBeVisible();
  await expect(page.locator('.component-list')).toContainText('Members table');
  await page.getByRole('tab', { name: 'Specifications', exact: true }).click();
  await expect(page.locator('.spec-list .badge').first()).toHaveText('approved');
  expect(pageErrors).toEqual([]);
});

test('coordinate editing, hierarchy, undo/redo and malformed proposals remain reviewable', async ({ page, app }) => {
  await openDemo(page, app);
  await page.getByRole('button', { name: '+ Add region', exact: true }).click();
  await page.getByLabel('Component name').fill('Parent');
  await saveAnnotation(page);
  await page.getByRole('button', { name: '+ Add region', exact: true }).click();
  await page.getByLabel('Component name').fill('Child');
  await page.getByLabel('Parent component').selectOption({ label: 'Parent' });
  await page.getByLabel('Region width', { exact: true }).fill('120');
  await saveAnnotation(page);
  await expect(page.locator('.component-list')).toContainText('Child');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.component-list')).not.toContainText('Child');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.component-list')).toContainText('Child');
  await page.getByRole('tab', { name: /^Drafts/ }).click();
  await page.getByLabel('Draft JSON').fill('{"annotations":[{"malformed":true}],"specifications":[]}');
  await page.getByRole('button', { name: 'Submit draft for review' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.proposal')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  const projectId = await page.getByLabel('Open workspace').inputValue();
  const response = await page.request.get(`${app.url}/api/projects/${projectId}`, { headers: { Authorization: `Bearer ${app.token}` } });
  const project: Project = await response.json();
  await page.getByLabel('Draft JSON').fill(JSON.stringify({ annotations: [{ ...project.annotations[0], id: 'suggested-region', name: 'Suggested region', origin: 'ai', reviewStatus: 'proposed', revision: 0 }], specifications: [] }));
  await page.getByRole('button', { name: 'Submit draft for review' }).click();
  await expect(page.locator('.proposal')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reject draft', exact: true }).click();
  await expect(page.locator('.proposal')).toHaveCount(0);
  await expect(page.getByLabel('Optional AI draft')).toContainText('AI is disabled');
});

test('invalid pairing token cannot open local projects', async ({ page, app }) => {
  await page.goto(app.url);
  await page.getByLabel('Pairing token').fill('invalid-pairing-token-0123456789012345');
  await page.getByRole('button', { name: 'Pair server', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('valid local pairing token');
  await expect(page.getByRole('button', { name: 'Load demo', exact: true })).toHaveCount(0);
});

test('zoomed and panned canvas moves and resizes in original document coordinates', async ({ page, app }) => {
  await openDemo(page, app);
  await drawRegion(page, { x: 500, y: 400, width: 120, height: 80 }, 'Movable region');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const canvas = page.getByRole('img', { name: 'Design canvas' });
  const box = await canvas.boundingBox();
  await page.getByRole('button', { name: 'Pan', exact: true }).click();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 30, box!.y + box!.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  async function dragPoints(start: { x: number; y: number }, end: { x: number; y: number }) {
    const screen = await canvas.evaluate((element, points) => {
      const matrix = (element as SVGSVGElement).getScreenCTM()!;
      return points.map(p => { const t = new DOMPoint(p.x, p.y).matrixTransform(matrix); return { x: t.x, y: t.y }; });
    }, [start, end]);
    await page.mouse.move(screen[0]!.x, screen[0]!.y);
    await page.mouse.down();
    await page.mouse.move(screen[1]!.x, screen[1]!.y, { steps: 5 });
    await page.mouse.up();
  }
  await dragPoints({ x: 550, y: 430 }, { x: 575, y: 415 });
  expect(Number(await page.getByLabel('Region x', { exact: true }).inputValue())).toBeCloseTo(525, 1);
  expect(Number(await page.getByLabel('Region y', { exact: true }).inputValue())).toBeCloseTo(385, 1);
  await dragPoints({ x: 645, y: 465 }, { x: 675, y: 485 });
  expect(Number(await page.getByLabel('Region width', { exact: true }).inputValue())).toBeCloseTo(150, 1);
  expect(Number(await page.getByLabel('Region height', { exact: true }).inputValue())).toBeCloseTo(100, 1);
  // Hold the real mutation before it reaches the server so pending-save feedback
  // and the subsequent reload cannot accidentally pass on a fast local machine.
  let releaseSave!: () => void;
  let markIntercepted!: () => void;
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  const intercepted = new Promise<void>(resolve => { markIntercepted = resolve; });
  await page.route('**/api/projects/*/mutate', async route => {
    markIntercepted();
    await saveGate;
    await route.continue();
  }, { times: 1 });
  await saveAnnotation(page, async () => {
    try {
      await intercepted;
      await expect(page.getByRole('button', { name: 'Save annotation', exact: true })).toBeDisabled();
      await expect(page.getByRole('status')).toHaveText('Working with your local server…');
      await expect(page.locator('.unsaved')).toBeVisible();
    } finally { releaseSave(); }
  });
  await page.reload();
  await page.locator('.component-list').getByRole('button', { name: 'Movable region', exact: true }).click();
  expect(Number(await page.getByLabel('Region width', { exact: true }).inputValue())).toBeCloseTo(150, 1);
  expect(Number(await page.getByLabel('Region x', { exact: true }).inputValue())).toBeCloseTo(525, 1);
});

test('external AI destination is disclosed and consent resets after each attempted request', async ({ page, app }) => {
  await page.route('**/api/ai/status', route => route.fulfill({ json: { enabled: true, model: 'test-model', endpointOrigin: 'https://provider.example', external: true,
    limits: { snapshots: 2, nodes: 1000, textChars: 120000, requestBytes: 8000000 } } }));
  let submitted: { consentToExternalTransfer: boolean; snapshotIds: string[] } | undefined;
  await page.route('**/api/projects/*/generate-draft', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 502, json: { error: { code: 'TEST_PROVIDER', message: 'Synthetic provider failure; nothing was sent externally.' } } });
  });
  await openDemo(page, app);
  await page.getByRole('tab', { name: /^Drafts/ }).click();
  const panel = page.getByLabel('Optional AI draft');
  await expect(panel).toContainText('https://provider.example');
  await expect(panel).toContainText('test-model');
  const button = page.getByRole('button', { name: 'Generate draft for review', exact: true });
  const consent = page.getByRole('checkbox', { name: /I allow this request/ });
  await expect(consent).not.toBeChecked();
  await expect(button).toBeDisabled();
  await consent.check();
  await button.click();
  await expect(panel.getByRole('alert')).toContainText('Synthetic provider failure');
  expect(submitted?.consentToExternalTransfer).toBe(true);
  expect(submitted?.snapshotIds).toHaveLength(1);
  await expect(consent).not.toBeChecked();
  await expect(button).toBeDisabled();
});
