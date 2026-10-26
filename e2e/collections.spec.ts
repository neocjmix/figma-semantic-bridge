import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, expect, type Page, type Route } from '@playwright/test';
import { startServer } from '../src/server/index.js';
import type { CollectionView } from '../src/shared/structure-collection.js';

const test = base.extend<{ app: { url: string; token: string } }>({
  app: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'fsb-collection-ui-'));
    const token = 'synthetic-collection-ui-token-0123456789';
    const server = await startServer({ port: 0, token, dataDir: dir, webDir: resolve(process.env.FSB_E2E_WEB_DIR ?? 'dist/web') });
    try { await use({ url: server.url, token }); }
    finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
  },
});
const sessionId = 'synthetic-collection-session';
const observedAt = '2026-10-25T00:00:00.000Z';
const bounds = { x: 10, y: 20, width: 3000, height: 1500 };
const source = { fileKey: 'synthetic-file', pageId: 'synthetic-page', nodeId: 'synthetic-root', name: 'Synthetic large frame', type: 'FRAME', bounds };

function prepared(projectId: string): CollectionView {
  return { id: 'synthetic-collection', projectId, sessionId, source, status: 'prepared', pauseRequested: false,
    nodeCount: 0, byteCount: 0, chunkCount: 0, createdAt: observedAt, updatedAt: observedAt, finishedAt: null,
    elapsedMs: 0, error: null, warnings: [], consistency: 'live-session-observation', reviewStatus: 'unreviewed' };
}

async function mockCollections(page: Page) {
  let current: CollectionView | null = null, clock = 0;
  const calls = { list: 0, prepare: 0, start: 0, stop: 0, resume: 0, remove: 0, nodes: [] as number[], text: [] as number[] };
  const update = (patch: Partial<CollectionView>) => {
    if (!current) throw new Error('Prepare before updating the collection.');
    current = { ...current, ...patch, updatedAt: new Date(Date.parse(observedAt) + ++clock * 1000).toISOString() };
  };
  const send = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  await page.route('**/api/plugin/status', route => send(route, { connected: true, sessionId }));
  await page.route(/\/api\/projects\/[^/]+\/collections(?:\/[^/?]+(?:\/[^/?]+)?)?(?:\?.*)?$/, route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const match = path.match(/^\/api\/projects\/([^/]+)\/collections(?:\/([^/]+))?(?:\/([^/]+))?$/);
    if (!match) return send(route, { error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const [, projectId, collectionId, action] = match;
    if (request.method() === 'GET' && !collectionId) { calls.list++; return send(route, { collections: current ? [current] : [] }); }
    if (request.method() === 'POST' && !collectionId) {
      const input = request.postDataJSON() as { expectedRevision: number; expectedSessionId: string };
      expect(input.expectedSessionId).toBe(sessionId); expect(input.expectedRevision).toBeGreaterThanOrEqual(0);
      calls.prepare++; current = prepared(projectId!); return send(route, current, 201);
    }
    if (collectionId !== 'synthetic-collection' || !current) return send(route, { error: { code: 'NOT_FOUND', message: 'No collection' } }, 404);
    if (request.method() === 'GET' && !action) return send(route, current);
    if (request.method() === 'POST' && action === 'start') {
      calls.start++; expect(request.postDataJSON()).toEqual({});
      update({ status: 'running', nodeCount: 500, chunkCount: 1, byteCount: 800_000, elapsedMs: 1200 });
      return send(route, current, 202);
    }
    if (request.method() === 'POST' && action === 'stop') {
      calls.stop++; update({ pauseRequested: true }); return send(route, current);
    }
    if (request.method() === 'POST' && action === 'resume') {
      calls.resume++; update({ status: 'running', pauseRequested: false }); return send(route, current, 202);
    }
    if (request.method() === 'POST' && action === 'remove') {
      calls.remove++; current = null; return send(route, { removed: true });
    }
    if (request.method() === 'POST' && action === 'nodes') {
      const input = request.postDataJSON() as { offset: number; limit: number };
      calls.nodes.push(input.offset); expect(input.limit).toBe(50);
      const nodes = Array.from({ length: input.offset === 0 ? 50 : 1 }, (_, index) => {
        const number = input.offset + index;
        return { id: `synthetic-node-${number}`, parentId: source.nodeId, type: number === 0 ? 'TEXT' : 'FRAME',
          name: number === 0 ? 'Synthetic exact text' : `Synthetic child ${number}`, bbox: bounds, visible: true,
          sourceFileKey: source.fileKey, sourcePageId: source.pageId, textLength: number === 0 ? 5000 : null };
      });
      return send(route, { nodes, nextOffset: input.offset === 0 ? 50 : null, total: 51, complete: true, reviewStatus: 'unreviewed' });
    }
    if (request.method() === 'POST' && action === 'text') {
      const input = request.postDataJSON() as { nodeId: string; offset: number; limit: number };
      expect(input.nodeId).toBe('synthetic-node-0'); expect(input.limit).toBe(4000);
      calls.text.push(input.offset);
      return send(route, { nodeId: input.nodeId, text: (input.offset === 0 ? 'A' : 'B').repeat(input.offset === 0 ? 4000 : 1000),
        offset: input.offset, nextOffset: input.offset === 0 ? 4000 : null, totalLength: 5000, reviewStatus: 'unreviewed' });
    }
    return send(route, { error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  });
  return { calls, update, get current() { return current; } };
}

async function openDemo(page: Page, app: { url: string; token: string }, mock: Awaited<ReturnType<typeof mockCollections>>) {
  await page.goto(app.url);
  await page.getByLabel('Pairing token').fill(app.token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  await page.locator('details.raw-collection-panel summary').click();
  await expect(page.getByRole('button', { name: 'Choose selected area' })).toBeEnabled();
  await expect.poll(() => mock.calls.list).toBeGreaterThan(0);
}

test('collection preflight reveals limits and does not start heavy work until chosen', async ({ page, app }) => {
  const mock = await mockCollections(page); await openDemo(page, app, mock);
  await page.getByRole('button', { name: 'Choose selected area' }).click();
  await expect(page.locator('.collection-detail > strong')).toContainText('Synthetic large frame');
  await expect(page.getByText('Up to 200,000 nodes and 64 MB.', { exact: false })).toBeVisible();
  await expect(page.getByText('You can resume within 10 minutes', { exact: false })).toBeVisible();
  await expect(page.getByText('The design is read in stages, not all at once.', { exact: false })).toBeVisible();
  expect(mock.calls.prepare).toBe(1); expect(mock.calls.start).toBe(0);
  await page.getByRole('button', { name: 'Start collection' }).click();
  await expect.poll(() => mock.calls.start).toBe(1);
  await expect(page.getByRole('progressbar', { name: 'Collection progress' })).toBeVisible();
  await expect(page.locator('.collection-detail')).toContainText('500 nodes');
  await page.getByRole('button', { name: 'Pause collection' }).click();
  await expect.poll(() => mock.calls.stop).toBe(1);
  await expect(page.getByText('Pausing after the current part is read and saved.')).toBeVisible();
  mock.update({ status: 'paused', pauseRequested: false, nodeCount: 1000, chunkCount: 2, byteCount: 1_600_000 });
  await expect(page.getByRole('button', { name: 'Resume collection' })).toBeEnabled();
  await expect(page.getByText('Collection paused. Resume within 10 minutes with the same plugin connection.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Resume collection' }).click();
  await expect.poll(() => mock.calls.resume).toBe(1);
});

test('completed raw collection pages nodes and exact text without changing the workspace', async ({ page, app }) => {
  const mock = await mockCollections(page); await openDemo(page, app, mock);
  const revisionBefore = await page.locator('.revision').textContent();
  const snapshotCountBefore = await page.locator('.snapshot-item').count();
  await page.getByRole('button', { name: 'Choose selected area' }).click();
  await page.getByRole('button', { name: 'Start collection' }).click();
  await expect.poll(() => mock.calls.start).toBe(1);
  mock.update({ status: 'complete', nodeCount: 51, chunkCount: 3, byteCount: 2_000_000, finishedAt: observedAt });
  await expect(page.getByRole('button', { name: 'Browse source nodes' })).toBeEnabled();
  await page.getByRole('button', { name: 'Browse source nodes' }).click();
  await expect.poll(() => mock.calls.nodes).toEqual([0]);
  await expect(page.getByText('Nodes 1–50 of 51 · not reviewed')).toBeVisible();
  await page.getByRole('button', { name: 'Read exact text' }).click();
  await expect.poll(() => mock.calls.text).toEqual([0]);
  await expect(page.getByText('Loaded 4,000 of 5,000 characters · unreviewed')).toBeVisible();
  await page.getByRole('button', { name: 'Load more text' }).click();
  await expect.poll(() => mock.calls.text).toEqual([0, 4000]);
  await expect(page.getByText('Loaded 5,000 of 5,000 characters · unreviewed')).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect.poll(() => mock.calls.nodes).toEqual([0, 50]);
  await expect(page.getByText('Nodes 51–51 of 51 · not reviewed')).toBeVisible();
  await expect(page.locator('.revision')).toHaveText(revisionBefore!);
  expect(await page.locator('.snapshot-item').count()).toBe(snapshotCountBefore);
});

test('completed collection history survives reload and removal leaves captures unchanged', async ({ page, app }) => {
  const mock = await mockCollections(page); await openDemo(page, app, mock);
  await page.getByRole('button', { name: 'Choose selected area' }).click();
  await page.getByRole('button', { name: 'Start collection' }).click();
  await expect.poll(() => mock.calls.start).toBe(1);
  mock.update({ status: 'complete', nodeCount: 51, chunkCount: 3, byteCount: 2_000_000, finishedAt: observedAt });
  await expect(page.getByRole('button', { name: 'Browse source nodes' })).toBeEnabled();
  const revisionBefore = await page.locator('.revision').textContent();
  const listCallsBefore = mock.calls.list;
  await page.reload();
  await expect.poll(() => mock.calls.list).toBeGreaterThan(listCallsBefore);
  await page.locator('details.raw-collection-panel summary').click();
  await expect(page.getByLabel('Structure collection history').locator('option')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Browse source nodes' })).toBeEnabled();
  await page.getByRole('button', { name: 'Delete collection record' }).click();
  await expect.poll(() => mock.calls.remove).toBe(1);
  await expect(page.getByLabel('Structure collection history')).toHaveCount(0);
  await expect(page.locator('.revision')).toHaveText(revisionBefore!);
});
