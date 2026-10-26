import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, expect, type Page, type Route } from '@playwright/test';
import { startServer } from '../src/server/index.js';
import type { AcquisitionPlan, AcquisitionView } from '../src/shared/acquisition.js';
import type { NodePreviewResult } from '../src/shared/contracts.js';

const test = base.extend<{ app: { url: string; token: string } }>({
  app: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'fsb-acquisition-ui-'));
    const token = 'synthetic-acquisition-ui-token-0123456789';
    const server = await startServer({ port: 0, token, dataDir: dir, webDir: resolve(process.env.FSB_E2E_WEB_DIR ?? 'dist/web') });
    try { await use({ url: server.url, token }); }
    finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
  },
});

const sessionId = 'synthetic-plugin-session';
const observedAt = '2026-10-25T00:00:00.000Z';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=';
const bounds = { x: 100, y: 200, width: 400, height: 300 };
const source = { fileKey: 'synthetic-file', pageId: 'synthetic-page', nodeId: 'synthetic-root', name: 'Synthetic selected frame', type: 'FRAME', bounds };
const preview: NodePreviewResult = {
  fileKey: source.fileKey, pageId: source.pageId,
  node: { id: source.nodeId, parentId: null, name: source.name, type: source.type, bbox: bounds, visible: true,
    sourceFileKey: source.fileKey, sourcePageId: source.pageId },
  observedAt, preview: { mimeType: 'image/png', base64: png, width: 1, height: 1 }, warnings: [],
};

function prepared(projectId: string, revision: number): AcquisitionView {
  return { id: 'synthetic-task', projectId, baseRevision: revision, sessionId, source, status: 'prepared', stage: 'prepared', plan: null,
    limits: { maxNodes: 5000, maxBytes: 2_000_000, maxDurationMs: 5000, maxImageDimension: 2048 },
    progress: { nodes: 0, bytes: 0, elapsedMs: 0 },
    preview: { status: 'idle', observedAt: null, error: null },
    structure: { status: 'idle', complete: false, reason: null, error: null },
    warnings: [], error: null, createdAt: observedAt, updatedAt: observedAt, resultSnapshotId: null };
}

async function mockAcquisition(page: Page) {
  let current: AcquisitionView | null = null, history: AcquisitionView[] = [], previewResult = preview, clock = 0;
  const calls = { list: 0, prepare: 0, start: [] as { plan: AcquisitionPlan; limits: unknown }[],
    loadStructure: 0, cancel: 0, retry: [] as string[], preview: 0, commit: 0, remove: 0 };
  const update = (patch: Partial<AcquisitionView>) => {
    if (!current) throw new Error('Prepare before updating the acquisition.');
    current = { ...current, ...patch, updatedAt: new Date(Date.parse(observedAt) + ++clock * 1000).toISOString() };
  };
  const send = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  await page.route('**/api/plugin/status', route => send(route, { connected: true, sessionId }));
  await page.route(/\/api\/projects\/[^/]+\/acquisitions(?:\/[^/?]+(?:\/[^/?]+)?)?(?:\?.*)?$/, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const match = path.match(/^\/api\/projects\/([^/]+)\/acquisitions(?:\/([^/]+))?(?:\/([^/]+))?$/);
    if (!match) return send(route, { error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const [, projectId, taskId, action] = match;
    if (request.method() === 'GET' && !taskId) { calls.list++; return send(route, { tasks: current ? [current, ...history] : history }); }
    if (request.method() === 'POST' && !taskId) {
      const input = request.postDataJSON() as { expectedRevision: number; expectedSessionId: string };
      expect(input.expectedSessionId).toBe(sessionId);
      calls.prepare++; current = prepared(projectId!, input.expectedRevision); return send(route, current);
    }
    const archived = history.find(value => value.id === taskId);
    if (request.method() === 'GET' && !action && archived) return send(route, archived);
    if (request.method() === 'POST' && action === 'remove' && archived) {
      calls.remove++; history = history.filter(value => value.id !== taskId); return send(route, { removed: true });
    }
    if (taskId !== 'synthetic-task' || !current) return send(route, { error: { code: 'NOT_FOUND', message: 'No task' } }, 404);
    if (request.method() === 'GET' && !action) return send(route, current);
    if (request.method() === 'GET' && action === 'preview') { calls.preview++; return send(route, previewResult); }
    if (request.method() === 'POST' && action === 'start') {
      const input = request.postDataJSON() as { plan: AcquisitionPlan; limits: unknown };
      calls.start.push(input);
      const first = input.plan === 'structure' || input.plan === 'structure_then_overview' ? 'structure' : 'preview';
      update({ status: 'running', stage: first, plan: input.plan,
        preview: { status: first === 'preview' ? 'running' : 'idle', observedAt: null, error: null },
        structure: { status: first === 'structure' ? 'running' : 'idle', complete: false, reason: null, error: null } });
      return send(route, current);
    }
    if (request.method() === 'POST' && action === 'cancel') { calls.cancel++; update({ status: 'cancel_requested' }); return send(route, current); }
    if (request.method() === 'POST' && action === 'load-structure') {
      calls.loadStructure++; expect(request.postDataJSON()).toEqual({ limits: {} });
      update({ status: 'running', stage: 'structure', plan: 'overview_then_structure',
        structure: { status: 'running', complete: false, reason: null, error: null } });
      return send(route, current);
    }
    if (request.method() === 'POST' && action === 'retry') {
      const input = request.postDataJSON() as { step: 'preview' | 'structure' };
      calls.retry.push(input.step);
      update({ status: 'running', stage: input.step,
        [input.step]: input.step === 'preview' ? { status: 'running', observedAt: null, error: null }
          : { status: 'running', complete: false, reason: null, error: null } });
      return send(route, current);
    }
    if (request.method() === 'POST' && action === 'commit') { calls.commit++; return send(route, { error: { code: 'UNEXPECTED', message: 'Commit should be disabled in this test.' } }, 500); }
    if (request.method() === 'POST' && action === 'remove') { calls.remove++; current = null; return send(route, { removed: true }); }
    return send(route, { error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  });
  return { calls, update, addHistory(value: AcquisitionView) { history.push(value); },
    setPreview(value: NodePreviewResult) { previewResult = value; }, get current() { return current; } };
}

async function openDemo(page: Page, app: { url: string; token: string }, mock: Awaited<ReturnType<typeof mockAcquisition>>) {
  await page.goto(app.url);
  await page.getByLabel('Pairing token').fill(app.token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Capture Figma selection', exact: true })).toBeEnabled();
  await expect.poll(() => mock.calls.list).toBeGreaterThan(0);
}

test('preflight pins the source and never starts acquisition before the user chooses a plan', async ({ page, app }) => {
  const mock = await mockAcquisition(page); await openDemo(page, app, mock);
  await page.getByRole('button', { name: 'Capture Figma selection', exact: true }).click();
  await expect(page.locator('.acquisition-source')).toContainText('Synthetic selected frame');
  await expect(page.getByText('Large designs may take longer; the total size and time are not known yet.', { exact: false })).toBeVisible();
  expect(mock.calls.prepare).toBe(1); expect(mock.calls.start).toHaveLength(0);
  await expect(page.getByText('The overview is limited to 2,048 px', { exact: false })).toBeVisible();
  await expect(page.getByText('The image and structure are read at different times', { exact: false })).toBeVisible();
  await expect(page.getByText('Your Figma design is not changed.')).toBeVisible();
  await page.getByLabel('What to bring in').selectOption('structure_then_overview');
  await page.getByRole('button', { name: 'Start import' }).click();
  await expect.poll(() => mock.calls.start.length).toBe(1);
  expect(mock.calls.start[0]).toEqual({ plan: 'structure_then_overview', limits: {} });
  await expect(page.getByText('Reading source structure ·', { exact: false })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Figma import progress' })).toBeVisible();
});

test('partial structure cannot be saved as a complete capture', async ({ page, app }) => {
  const mock = await mockAcquisition(page); await openDemo(page, app, mock);
  await page.getByRole('button', { name: 'Capture Figma selection', exact: true }).click();
  await page.getByLabel('What to bring in').selectOption('structure');
  await page.getByRole('button', { name: 'Start import' }).click();
  await expect.poll(() => mock.calls.start.length).toBe(1);
  mock.update({ status: 'partial', stage: 'done', progress: { nodes: 47, bytes: 12345, elapsedMs: 5100 },
    structure: { status: 'partial', complete: false, reason: 'Synthetic node budget reached.', error: null } });
  await expect(page.getByText('Structure is incomplete: Synthetic node budget reached.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save complete capture' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Restart structure read' })).toBeEnabled();
  expect(mock.calls.commit).toBe(0);
});

test('overview remains visible when later structure reading fails', async ({ page, app }) => {
  const mock = await mockAcquisition(page); await openDemo(page, app, mock);
  await page.getByRole('button', { name: 'Capture Figma selection', exact: true }).click();
  await page.getByRole('button', { name: 'Start import' }).click();
  await expect.poll(() => mock.calls.start.length).toBe(1);
  mock.update({ status: 'running', stage: 'structure', preview: { status: 'ready', observedAt, error: null },
    structure: { status: 'running', complete: false, reason: null, error: null } });
  await expect(page.getByRole('img', { name: 'Figma overview image' })).toBeVisible();
  expect(mock.calls.preview).toBeGreaterThan(0);
  mock.update({ status: 'partial', stage: 'done', structure: { status: 'failed', complete: false, reason: null,
    error: { code: 'SYNTHETIC_FAILURE', message: 'Synthetic metadata read failed.' } } });
  await expect(page.getByText('Could not read the source structure: Synthetic metadata read failed.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Figma overview image' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save complete capture' })).toBeDisabled();
  await page.getByRole('button', { name: 'Restart structure read' }).click();
  await expect.poll(() => mock.calls.retry).toEqual(['structure']);
  await expect(page.getByRole('img', { name: 'Figma overview image' })).toBeVisible();
});

test('overview-only work can request structure later without rendering another image', async ({ page, app }, testInfo) => {
  const mock = await mockAcquisition(page); await openDemo(page, app, mock);
  await page.setViewportSize({ width: 1680, height: 960 });
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 500;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ecf3f7'; context.fillRect(0, 0, 800, 500);
    context.fillStyle = '#19374f'; context.fillRect(0, 0, 180, 500);
    context.fillStyle = '#fdfefe'; context.font = 'bold 24px sans-serif'; context.fillText('Synthetic', 20, 55);
    context.fillStyle = '#27435a'; context.fillText('Overview preview', 220, 70);
    context.fillStyle = '#fff'; context.fillRect(220, 110, 530, 320);
    context.fillStyle = '#dae8ee'; for (let row = 0; row < 4; row++) context.fillRect(240, 135 + row * 70, 490, 48);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  mock.setPreview({ ...preview, preview: { ...preview.preview, base64, width: 800, height: 500 } });
  await page.getByRole('button', { name: 'Capture Figma selection', exact: true }).click();
  await page.getByLabel('What to bring in').selectOption('overview');
  await page.getByRole('button', { name: 'Start import' }).click();
  await expect.poll(() => mock.calls.start.length).toBe(1);
  mock.update({ status: 'ready', stage: 'done', preview: { status: 'ready', observedAt, error: null } });
  await expect(page.getByRole('img', { name: 'Figma overview image' })).toBeVisible();
  const imageRequests = mock.calls.preview;
  await page.getByRole('button', { name: 'Enlarge overview' }).click();
  const overviewDialog = page.getByRole('dialog', { name: 'Enlarged overview' });
  await expect(overviewDialog.getByRole('img', { name: 'Figma overview image' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('enlarged-overview.png') });
  await page.keyboard.press('Escape');
  await expect(overviewDialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Enlarge overview' })).toBeFocused();
  expect(mock.calls.preview).toBe(imageRequests);
  await expect(page.getByText('Overview ready', { exact: true })).toBeVisible();
  await expect(page.getByText('Ready to save', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save complete capture' })).toBeDisabled();
  await page.getByRole('button', { name: 'Load source structure' }).click();
  await expect.poll(() => mock.calls.loadStructure).toBe(1);
  await expect(page.getByRole('img', { name: 'Figma overview image' })).toBeVisible();
  expect(mock.calls.preview).toBe(imageRequests);
  mock.update({ status: 'ready', stage: 'done', structure: { status: 'ready', complete: true, reason: null, error: null } });
  await expect(page.getByText('Ready to save', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save complete capture' })).toBeEnabled();
});

test('saved acquisition records remain selectable after reload and can be removed without changing the workspace', async ({ page, app }) => {
  const mock = await mockAcquisition(page); await openDemo(page, app, mock);
  await page.getByRole('button', { name: 'Capture Figma selection', exact: true }).click();
  await expect(page.locator('.acquisition-source')).toContainText('Synthetic selected frame');
  const projectId = mock.current!.projectId;
  mock.addHistory({ ...prepared(projectId, mock.current!.baseRevision), id: 'saved-task', status: 'committed', stage: 'done',
    plan: 'structure', structure: { status: 'ready', complete: true, reason: null, error: null },
    resultSnapshotId: 'synthetic-saved-snapshot' });
  const revisionBefore = await page.locator('.revision').textContent();
  const listCallsBeforeReload = mock.calls.list;
  await page.reload();
  await expect.poll(() => mock.calls.list).toBeGreaterThan(listCallsBeforeReload);
  const jobs = page.getByLabel('Recent imports');
  await expect(jobs.locator('option')).toHaveCount(2);
  await jobs.selectOption('saved-task');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete import record' }).click();
  await expect.poll(() => mock.calls.remove).toBe(1);
  await expect(jobs.locator('option')).toHaveCount(1);
  await expect(jobs.locator('option[value="saved-task"]')).toHaveCount(0);
  await expect(page.locator('.revision')).toHaveText(revisionBefore!);
  await page.reload();
  await expect(page.getByLabel('Recent imports').locator('option')).toHaveCount(1);
});

test('removing a stopped acquisition clears its observations without changing the workspace', async ({ page, app }) => {
  const mock = await mockAcquisition(page); await openDemo(page, app, mock);
  await page.getByRole('button', { name: 'Capture Figma selection', exact: true }).click();
  await expect(page.locator('.acquisition-source')).toContainText('Synthetic selected frame');
  const before = await page.locator('.revision').textContent();
  await page.getByRole('button', { name: 'Delete import record' }).click();
  await expect.poll(() => mock.calls.remove).toBe(1);
  await expect(page.locator('.acquisition-source')).toHaveCount(0);
  await expect(page.locator('.revision')).toHaveText(before!);
  await expect(page.getByRole('button', { name: 'Capture Figma selection', exact: true })).toBeEnabled();
});

test('a late ready status cannot undo a requested cancellation', async ({ page, app }) => {
  const mock = await mockAcquisition(page); await openDemo(page, app, mock);
  await page.getByRole('button', { name: 'Capture Figma selection', exact: true }).click();
  await page.getByRole('button', { name: 'Start import' }).click();
  await expect(page.getByRole('button', { name: 'Stop import from Figma' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop import from Figma' }).click();
  await expect(page.getByText('Stopping after the current Figma image export finishes.')).toBeVisible();
  mock.update({ status: 'ready', stage: 'done', preview: { status: 'ready', observedAt, error: null },
    structure: { status: 'ready', complete: true, reason: null, error: null } });
  await page.waitForTimeout(1400);
  await expect(page.getByText('Stopping after the current Figma image export finishes.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save complete capture' })).toBeDisabled();
  expect(mock.calls.cancel).toBe(1); expect(mock.calls.commit).toBe(0);
  mock.update({ status: 'cancelled' });
  await expect(page.getByText('Import stopped. Results already received are still available.')).toBeVisible();
});
