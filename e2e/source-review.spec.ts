import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import WebSocket from 'ws';
import { startServer } from '../src/server/index.js';
import { createDemoProject } from '../src/demo/project.js';
import type { Project, Selection } from '../src/shared/contracts.js';

interface AppFixture {
  url: string; token: string; projectId: string;
  select(id: string, fileKey?: string): void;
  read(): Promise<Project>;
  disconnect(): Promise<void>;
}
const test = base.extend<{ app: AppFixture }>({
  app: async ({}, use) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fsb-source-review-'));
    const token = 'synthetic-source-review-token-0123456789';
    const server = await startServer({ port: 0, token, dataDir, webDir: resolve(process.env.FSB_E2E_WEB_DIR ?? 'dist/web'), aiConfig: null });
    const seed = createDemoProject(), snapshot = seed.snapshots[0]!;
    const original = snapshot.nodes.find(node => node.id === 'search-bg')!;
    snapshot.nodes.push({ ...original, id: 'legacy-search', name: 'Legacy search layer' });
    for (let index = 0; index < 510; index++) snapshot.nodes.push({ ...original, id: `extra-${index}`, name: `Synthetic extra ${index}`, bbox: { x: 110, y: 110, width: 1, height: 1 } });
    snapshot.nodes.push({ ...original, id: 'late-source', name: 'Source beyond initial 500', bbox: { x: 150, y: 150, width: 20, height: 20 } });
    let project = await server.store.importProject(seed);
    project = await server.store.mutate(project.id, project.revision, { type: 'upsert_annotation', annotation: {
      id: 'review-region', snapshotId: snapshot.id, name: 'Search review', role: 'component', bbox: original.bbox!, parentId: null,
      sourceRefs: [], origin: 'human', reviewStatus: 'proposed', revision: 0,
    } }, 'human');
    let selection: Selection;
    const select = (id: string, fileKey = snapshot.source.fileKey!) => {
      const node = snapshot.nodes.find(item => item.id === id) ?? { id, name: 'Uncaptured source', type: 'RECTANGLE', bbox: { x: 0, y: 0, width: 10, height: 10 } };
      selection = { fileKey, pageId: snapshot.source.pageId, nodes: [{ id: node.id, name: node.name, type: node.type, bbox: node.bbox }] };
    };
    select('search-bg');
    const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' });
    await once(socket, 'open');
    const welcome = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'hello', token, clientId: 'synthetic-source-review' }));
    await welcome;
    socket.on('message', bytes => {
      const message = JSON.parse(String(bytes));
      if (message.type === 'ping') { socket.send(JSON.stringify({ type: 'pong' })); return; }
      if (message.type !== 'request') return;
      const result = message.command.type === 'get_selection' ? selection : { highlightedNodeIds: message.command.nodeIds };
      socket.send(JSON.stringify({ type: 'response', requestId: message.requestId, ok: true, result }));
    });
    try { await use({ url: server.url, token, projectId: project.id, select, read: () => server.store.get(project.id),
      disconnect: async () => { const closed = once(socket, 'close'); socket.close(); await closed; } }); }
    finally { socket.terminate(); await server.close(); await rm(dataDir, { recursive: true, force: true }); }
  },
});

async function openReview(page: Page, app: AppFixture) {
  await page.addInitScript(({ token, projectId }) => {
    sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', projectId);
  }, { token: app.token, projectId: app.projectId });
  await page.goto(app.url);
  await page.locator('.component-list').getByRole('button', { name: 'Search review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add current Figma selection', exact: true })).toBeEnabled();
}
async function addSelection(page: Page) {
  const response = page.waitForResponse(response => /\/source-selection$/.test(response.url()));
  await page.getByRole('button', { name: 'Add current Figma selection', exact: true }).click();
  await response;
  await expect(page.getByRole('button', { name: 'Add current Figma selection', exact: true })).toBeEnabled();
}

test('native selections accumulate only in the draft, then save, confirm and approve separately', async ({ page, app }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openReview(page, app);
  const initial = await app.read();
  await expect(page.getByRole('button', { name: 'Approve annotation', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Source matching warnings')).toContainText('Equal or near-equal');
  const candidate = page.locator('.source-candidate').filter({ hasText: 'Legacy search layer' });
  await candidate.getByRole('button', { name: 'Preview captured area' }).click();
  const crop = page.getByRole('img', { name: 'Captured area: Legacy search layer (legacy-search)', exact: true });
  await expect(crop).toBeVisible();
  // A wide viewBox has letterbox bands in the fixed-height preview. Clip the
  // composite inside document space so adjacent source pixels cannot fill them.
  const clipping = await crop.evaluate(element => {
    const clip = element.querySelector('clipPath')!, rectangle = clip.querySelector('rect')!;
    return { units: clip.getAttribute('clipPathUnits'), target: element.querySelector('image')!.parentElement!.getAttribute('clip-path'),
      id: clip.id, bounds: ['x', 'y', 'width', 'height'].map(name => Number(rectangle.getAttribute(name))) };
  });
  expect(clipping.units).toBe('userSpaceOnUse');
  expect(clipping.target).toBe(`url(#${clipping.id})`);
  expect(clipping.bounds).toEqual([320, 250, 480, 48]);
  await page.locator('.candidate-preview').screenshot({ path: '.bridge-local/source-review-crop-proof.png' });
  await expect(page.locator('.candidate-preview')).toContainText('Overlapping layers remain combined');
  await candidate.getByRole('button', { name: 'Show in Figma' }).click();
  await expect(page.getByRole('status')).toContainText('Source node selected in Figma');
  await addSelection(page);
  await addSelection(page);
  expect((await app.read()).revision).toBe(initial.revision);
  expect((await app.read()).annotations[0]!.sourceRefs).toEqual([]);
  await expect(page.locator('.source-references > div')).toHaveCount(1);
  app.select('table-title');
  await addSelection(page);
  await expect(page.locator('.source-references > div')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Confirm sources', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save annotation', exact: true }).click();
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve annotation', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Confirm sources', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.bridge-local/source-review-editor-proof.png', fullPage: true });
  await page.getByRole('button', { name: 'Confirm sources', exact: true }).click();
  await expect(page.getByText('Sources confirmed by a human', { exact: true })).toBeVisible();
  expect((await app.read()).annotations[0]!.reviewStatus).toBe('proposed');
  await page.getByRole('button', { name: 'Approve annotation', exact: true }).click();
  await expect(page.locator('.inspector-content > .section-title .badge')).toHaveText('approved');
  const approved = (await app.read()).annotations[0]!;
  expect(approved.sourceRefs.map(ref => ref.nodeId)).toEqual(['search-bg', 'table-title']);
  expect(approved.sourceReview?.status).toBe('confirmed');
  await page.reload();
  await page.locator('.component-list').getByRole('button', { name: 'Search review', exact: true }).click();
  await expect(page.getByText('Sources confirmed by a human', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove source table-title', exact: true }).click();
  await expect(page.getByText('Sources confirmed by a human', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Unsaved changes — save to refresh source review', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve annotation', exact: true })).toBeDisabled();
  expect((await app.read()).annotations[0]!.sourceReview?.status).toBe('confirmed');
  expect(errors).toEqual([]);
});

test('wrong file and outside-capture selections show errors without changing the draft or storage', async ({ page, app }) => {
  await openReview(page, app);
  const before = await app.read();
  app.select('search-bg', 'different-source-file');
  await addSelection(page);
  await expect(page.getByRole('alert')).toContainText('different source file');
  app.select('uncaptured');
  await addSelection(page);
  await expect(page.getByRole('alert')).toContainText('outside this captured scope');
  await expect(page.locator('.source-references > div')).toHaveCount(0);
  expect(await app.read()).toEqual(before);
});

test('manual search reaches later captured nodes and supports removing a staged reference', async ({ page, app }) => {
  await openReview(page, app);
  await page.getByText('Adjust source references manually', { exact: true }).click();
  await page.getByRole('button', { name: 'Next nodes', exact: true }).click();
  await expect(page.getByText(/captured nodes · page 2 of/)).toBeVisible();
  await page.getByLabel('Search captured nodes', { exact: true }).fill('late-source');
  await page.locator('.manual-sources').getByRole('checkbox', { name: /Source beyond initial 500/ }).check();
  await expect(page.locator('.source-references')).toContainText('late-source');
  await page.getByRole('button', { name: 'Remove source late-source', exact: true }).click();
  await expect(page.locator('.source-references > div')).toHaveCount(0);
  expect((await app.read()).annotations[0]!.sourceRefs).toEqual([]);
});

test('a connection change while a selection response is pending discards the stale result', async ({ page, app }) => {
  await openReview(page, app);
  let release!: () => void;
  const gate = new Promise<void>(resolveGate => { release = resolveGate; });
  let intercepted!: () => void;
  const seen = new Promise<void>(resolveSeen => { intercepted = resolveSeen; });
  await page.route('**/api/projects/*/source-selection', async route => {
    const response = await route.fetch(); intercepted(); await gate; await route.fulfill({ response });
  }, { times: 1 });
  await page.getByRole('button', { name: 'Add current Figma selection', exact: true }).click();
  await seen;
  await expect(page.getByLabel('Component name', { exact: true })).toBeDisabled();
  await expect(page.locator('.component-list').getByRole('button', { name: 'Search review', exact: true })).toBeDisabled();
  await app.disconnect();
  await expect(page.getByText('Figma disconnected', { exact: true })).toBeVisible();
  release();
  await expect(page.getByRole('alert')).toContainText('Figma connection changed');
  await expect(page.locator('.source-references > div')).toHaveCount(0);
  expect((await app.read()).annotations[0]!.sourceRefs).toEqual([]);
});
