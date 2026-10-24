import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { test as base, expect, type Page } from '@playwright/test';
import WebSocket from 'ws';
import { startServer } from '../src/server/index.js';
import { createDemoProject } from '../src/demo/project.js';
import { PluginRequestSchema, type NodePreviewResult, type Project } from '../src/shared/contracts.js';

// Fully decodable synthetic RGBA pixels; these are not native Figma exports.
function solidPng(width: number, height: number, color: readonly number[]): string {
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    for (let channel = 0; channel < 4; channel++) pixels[y * (width * 4 + 1) + 1 + x * 4 + channel] = color[channel]!;
  }
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

interface AppFixture {
  url: string; token: string; initial: Project; previewRequests: string[]; navigationRequests: string[][];
  read(): Promise<Project>; replaceSession(): Promise<string>; disconnect(): Promise<void>; changeMetadata(nodeId: string): void;
  pausePreviews(): void; resumePreviews(): void; cancellations: string[];
}
const test = base.extend<{ app: AppFixture }>({
  app: async ({}, use) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fsb-node-preview-'));
    const token = 'synthetic-node-preview-token-0123456789';
    const server = await startServer({ port: 0, token, dataDir, webDir: resolve(process.env.FSB_E2E_WEB_DIR ?? 'dist/web'), aiConfig: null });
    const sockets: WebSocket[] = [], previewRequests: string[] = [], navigationRequests: string[][] = [];
    try {
      const seed = createDemoProject(), snapshot = seed.snapshots[0]!;
      snapshot.source.capturedAt = '2026-10-23T00:00:00.000Z';
      for (const node of snapshot.nodes) node.rendering = { opacity: 1 };
      snapshot.nodes[0]!.parentId = snapshot.source.pageId;
      const source = snapshot.nodes.find(node => node.id === 'search-bg')!;
      snapshot.nodes.push({ ...source, id: 'alternate-search', name: 'Alternate search field' });
      snapshot.nodes.push({ ...source, id: 'hidden-source', name: 'Hidden manual source', visible: false, rendering: { opacity: 0 } });
      seed.annotations.push({ id: 'original-approved', snapshotId: snapshot.id, name: 'Original approved region', role: 'component',
        bbox: snapshot.nodes.find(node => node.id === 'heading')!.bbox!, parentId: null,
        sourceRefs: [{ snapshotId: snapshot.id, nodeId: 'heading', matchType: 'exact' }], origin: 'human', reviewStatus: 'approved', revision: 2 });
      let project = await server.store.importProject(seed);
      project = await server.store.mutate(project.id, project.revision, { type: 'upsert_annotation', annotation: {
        id: 'review-region', snapshotId: snapshot.id, name: 'Search review', role: 'component', bbox: source.bbox!, parentId: null,
        sourceRefs: [{ snapshotId: snapshot.id, nodeId: source.id, matchType: 'exact' }], origin: 'human', reviewStatus: 'proposed', revision: 0,
      } }, 'human');
      let changedNode: string | null = null, paused = false;
      const replies: Array<() => void> = [], cancellations: string[] = [];
      const connect = async () => {
        const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' });
        sockets.push(socket);
        await once(socket, 'open');
        const welcomed = once(socket, 'message');
        socket.send(JSON.stringify({ type: 'hello', token, clientId: `synthetic-node-preview-${sockets.length}` }));
        const [welcome] = await welcomed;
        socket.on('message', bytes => {
          const message: unknown = JSON.parse(String(bytes));
          const control = message as { type?: string; requestId?: string };
          if (control.type === 'cancel' && control.requestId) { cancellations.push(control.requestId); return; }
          const parsed = PluginRequestSchema.safeParse(message);
          if (!parsed.success) return;
          const { requestId, command } = parsed.data;
          if (command.type === 'preview_node') {
            previewRequests.push(command.nodeId);
            const node = structuredClone(snapshot.nodes.find(item => item.id === command.nodeId)!);
            if (node.id === changedNode) node.name += ' changed';
            const width = node.bbox!.width, height = node.bbox!.height;
            const color = node.id === 'hidden-source' ? [0, 0, 0, 0] : node.id === 'alternate-search' ? [20, 60, 220, 255] : [220, 40, 20, 255];
            const result: NodePreviewResult = { fileKey: snapshot.source.fileKey!, pageId: snapshot.source.pageId, node,
              observedAt: '2026-10-24T00:00:00.000Z', preview: { mimeType: 'image/png', width, height, base64: solidPng(width, height, color) },
              warnings: ['Synthetic current export. Descendant styles and external ancestors are not verified.'] };
            const reply = () => socket.send(JSON.stringify({ type: 'response', requestId, ok: true, result }));
            if (paused) replies.push(reply); else reply();
          } else if (command.type === 'highlight_nodes') {
            navigationRequests.push(command.nodeIds);
            socket.send(JSON.stringify({ type: 'response', requestId, ok: true, result: { highlightedNodeIds: command.nodeIds } }));
          }
        });
        return String(JSON.parse(String(welcome)).sessionId);
      };
      await connect();
      await use({ url: server.url, token, initial: project, previewRequests, navigationRequests, read: () => server.store.get(project.id),
        pausePreviews: () => { paused = true; }, resumePreviews: () => { paused = false; for (const reply of replies.splice(0)) reply(); }, cancellations,
        replaceSession: connect, changeMetadata: nodeId => { changedNode = nodeId; },
        disconnect: async () => { const socket = sockets.at(-1)!; const closed = once(socket, 'close'); socket.close(); await closed; } });
    } finally { for (const socket of sockets) socket.terminate(); await server.close(); await rm(dataDir, { recursive: true, force: true }); }
  },
});

async function openReview(page: Page, app: AppFixture) {
  await page.addInitScript(({ token, projectId }) => {
    sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', projectId);
  }, { token: app.token, projectId: app.initial.id });
  await page.goto(app.url);
  await page.locator('.component-list').getByRole('button', { name: 'Search review', exact: true }).click();
  await expect(page.getByLabel('Selected source references').getByRole('button', { name: 'Compare current export' })).toBeEnabled();
}

async function imagePixel(page: Page): Promise<number[]> {
  return page.locator('.node-export-image img').evaluate(async element => {
    const image = element as HTMLImageElement; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data];
  });
}

test('closing a pending export cancels the broker request and permits a fresh export', async ({ page, app }) => {
  await openReview(page, app);
  const before = await app.read(), compare = page.getByLabel('Selected source references').getByRole('button', { name: 'Compare current export' });
  app.pausePreviews(); await compare.click();
  await expect(page.getByText('Requesting this node from Figma…', { exact: true })).toBeVisible();
  await expect.poll(() => app.previewRequests.length).toBe(1);
  await page.getByRole('button', { name: 'Close current export', exact: true }).click();
  await expect.poll(() => app.cancellations.length).toBe(1);
  await expect(compare).toBeEnabled();
  app.resumePreviews();
  await expect(page.getByLabel('Current node export comparison')).toHaveCount(0);
  await compare.click(); await expect(page.locator('.node-export-image img')).toBeVisible();
  expect(app.previewRequests).toHaveLength(2);
  expect(await app.read()).toEqual(before);
});

test('choosing another annotation cancels its pending export and discards a late image', async ({ page, app }) => {
  test.setTimeout(8_000); // Must finish before the broker's 20-second timeout could hide a blocked click.
  await openReview(page, app);
  const before = await app.read();
  app.pausePreviews();
  await page.getByLabel('Selected source references').getByRole('button', { name: 'Compare current export' }).click();
  await expect.poll(() => app.previewRequests.length).toBe(1);
  const otherAnnotation = page.locator('.component-list').getByRole('button', { name: 'Original approved region', exact: true });
  await expect(otherAnnotation).toBeEnabled({ timeout: 2_000 });
  await otherAnnotation.click({ timeout: 2_000 });
  await expect.poll(() => app.cancellations.length, { timeout: 2_000 }).toBe(1);
  app.resumePreviews();
  await expect(page.getByLabel('Current node export comparison')).toHaveCount(0);
  await page.locator('.component-list').getByRole('button', { name: 'Search review', exact: true }).click();
  await page.getByLabel('Selected source references').getByRole('button', { name: 'Compare current export' }).click();
  await expect(page.locator('.node-export-image img')).toBeVisible();
  expect(app.previewRequests).toHaveLength(2);
  expect(await app.read()).toEqual(before);
});

test('saving cancels a pending export while retaining the normal mutation lock', async ({ page, app }) => {
  test.setTimeout(8_000);
  await openReview(page, app);
  const before = await app.read();
  app.pausePreviews();
  const compare = page.getByLabel('Selected source references').getByRole('button', { name: 'Compare current export' });
  await compare.click();
  await expect.poll(() => app.previewRequests.length).toBe(1);
  let release!: () => void, received = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  const mutationPath = '**/api/projects/*/mutate';
  await page.route(mutationPath, async route => { received = true; await held; await route.continue(); });
  try {
    await page.getByLabel('Component name', { exact: true }).fill('Updated search review');
    await page.getByRole('button', { name: 'Save annotation', exact: true }).click({ timeout: 2_000 });
    await expect.poll(() => received, { timeout: 2_000 }).toBe(true);
    await expect.poll(() => app.cancellations.length, { timeout: 2_000 }).toBe(1);
    await expect(page.locator('.component-list').getByRole('button', { name: 'Original approved region', exact: true })).toBeDisabled();
    await expect(compare).toBeDisabled();
    app.resumePreviews();
    await expect(page.getByLabel('Current node export comparison')).toHaveCount(0);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await expect(page.locator('.component-list').getByRole('button', { name: 'Updated search review', exact: true })).toBeEnabled();
  const after = await app.read();
  expect(after.revision).toBe(before.revision + 1);
  expect(after.annotations.find(annotation => annotation.id === 'review-region')?.name).toBe('Updated search review');
  expect(after.annotations.find(annotation => annotation.id === 'original-approved')).toEqual(before.annotations.find(annotation => annotation.id === 'original-approved'));
  await compare.click();
  await expect(page.locator('.node-export-image img')).toBeVisible();
  expect(await app.read()).toEqual(after);
});

test('current exports compare distinct node images without changing captured or approved records', async ({ page, app }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openReview(page, app);
  const before = await app.read(), comparison = page.getByLabel('Current node export comparison');
  expect(app.previewRequests).toEqual([]);
  await page.getByLabel('Selected source references').getByRole('button', { name: 'Compare current export' }).click();
  await expect(comparison.getByRole('img', { name: 'Current node export: Search field (search-bg)', exact: true })).toBeVisible();
  await expect(comparison.locator('time').first()).toHaveAttribute('datetime', '2026-10-23T00:00:00.000Z');
  await expect(comparison.locator('time').last()).toHaveAttribute('datetime', '2026-10-24T00:00:00.000Z');
  await expect(comparison.getByRole('img', { name: 'Captured area: Search field (search-bg)', exact: true })).toBeVisible();
  expect(await imagePixel(page)).toEqual([220, 40, 20, 255]);
  await expect(page.locator('.node-export-image img')).toHaveCSS('object-fit', 'contain');
  const capturedImage = await comparison.locator('.source-crop image').getAttribute('href');
  await page.locator('.source-candidate').filter({ hasText: 'Alternate search field' }).getByRole('button', { name: 'Compare current export' }).click();
  await expect(comparison.getByRole('img', { name: 'Current node export: Alternate search field (alternate-search)', exact: true })).toBeVisible();
  expect(await imagePixel(page)).toEqual([20, 60, 220, 255]);
  expect(await comparison.locator('.source-crop image').getAttribute('href')).toBe(capturedImage);
  await expect(page.locator('.node-export-image img')).toHaveCount(1);
  await expect(comparison).toContainText('does not prove pixel contribution or occlusion');
  const enlarge = comparison.getByRole('button', { name: 'Enlarge comparison', exact: true });
  const originalExport = await comparison.locator('.node-export-image img').getAttribute('src');
  await enlarge.click();
  const dialog = page.getByRole('dialog', { name: 'Enlarged source comparison', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(true);
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(1000);
  expect((await dialog.locator('.node-export-image img').boundingBox())!.width).toBeGreaterThan(500);
  await expect(dialog.locator('.node-export-image img')).toHaveAttribute('src', originalExport!);
  await expect(dialog.locator('time').first()).toHaveAttribute('datetime', '2026-10-23T00:00:00.000Z');
  await expect(dialog.locator('time').last()).toHaveAttribute('datetime', '2026-10-24T00:00:00.000Z');
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await dialog.screenshot({ path: testInfo.outputPath('enlarged-node-export-comparison.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(enlarge).toBeFocused();
  await enlarge.click();
  await dialog.getByRole('button', { name: 'Close comparison', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(enlarge).toBeFocused();
  await expect(page.locator('.node-export-image img')).toHaveCount(1);
  expect(app.previewRequests).toEqual(['search-bg', 'alternate-search']);
  expect(await app.read()).toEqual(before);
  await expect(page.getByRole('button', { name: 'Approve annotation', exact: true })).toBeDisabled();
  await comparison.getByRole('button', { name: 'Show in Figma', exact: true }).click();
  expect(app.navigationRequests).toEqual([['alternate-search']]);
  expect(app.previewRequests).toEqual(['search-bg', 'alternate-search']);
  expect(await app.read()).toEqual(before);
  await comparison.screenshot({ path: testInfo.outputPath('node-export-comparison.png') });
  await page.locator('.component-list').getByRole('button', { name: 'Original approved region', exact: true }).click();
  await expect(comparison).toHaveCount(0);
  await expect(page.locator('.inspector-content > .section-title .badge')).toHaveText('approved');
  expect(errors).toEqual([]);
});

test('manual blank exports do not select sources and changed metadata prompts recapture', async ({ page, app }) => {
  await openReview(page, app);
  const before = await app.read();
  await page.getByText('Adjust source references manually', { exact: true }).click();
  await page.getByLabel('Search captured nodes', { exact: true }).fill('hidden-source');
  const manual = page.locator('.manual-source').filter({ hasText: 'Hidden manual source' });
  await expect(manual.getByRole('checkbox')).not.toBeChecked();
  await manual.getByRole('button', { name: 'Compare current export' }).click();
  const comparison = page.getByLabel('Current node export comparison');
  await expect(comparison.getByRole('img', { name: /Current node export: Hidden manual source/ })).toBeVisible();
  expect(await imagePixel(page)).toEqual([0, 0, 0, 0]);
  await expect(comparison).toContainText('Its cause is not determined');
  await expect(manual.getByRole('checkbox')).not.toBeChecked();
  expect(await app.read()).toEqual(before);
  app.changeMetadata('hidden-source');
  await manual.getByRole('button', { name: 'Compare current export' }).click();
  await expect(comparison.getByRole('alert')).toContainText('Capture the scope again');
  await expect(page.locator('.node-export-image img')).toHaveCount(0);
  expect(await app.read()).toEqual(before);
  await app.disconnect();
  await expect(manual.getByRole('button', { name: 'Compare current export' })).toBeDisabled();
  await expect(comparison).toHaveCount(0);
});

test('a successful response delayed across a new plugin session cannot restore an old image', async ({ page, app }) => {
  await openReview(page, app);
  const before = await app.read(), compare = page.getByLabel('Selected source references').getByRole('button', { name: 'Compare current export' });
  await compare.click();
  await expect(page.locator('.node-export-image img')).toBeVisible();
  let releaseResponse!: () => void, responseReady!: () => void;
  const held = new Promise<void>(resolve => { releaseResponse = resolve; });
  const ready = new Promise<void>(resolve => { responseReady = resolve; });
  await page.route('**/source-preview', async route => {
    const response = await route.fetch(); responseReady(); await held; await route.fulfill({ response });
  });
  try {
    await compare.click(); await ready;
    await expect(page.getByText('Requesting this node from Figma…', { exact: true })).toBeVisible();
    const sessionId = await app.replaceSession();
    await page.waitForResponse(async response => response.url().endsWith('/api/plugin/status') && (await response.json()).sessionId === sessionId);
    await expect(page.getByLabel('Current node export comparison')).toHaveCount(0);
    releaseResponse();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(compare).toBeEnabled();
    await expect(page.getByLabel('Current node export comparison')).toHaveCount(0);
    await expect(page.locator('.node-export-image img')).toHaveCount(0);
    expect(await app.read()).toEqual(before);
  } finally { releaseResponse(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('exports clear after a saved revision change and remain unavailable for an unsaved annotation', async ({ page, app }) => {
  await openReview(page, app);
  await page.getByLabel('Selected source references').getByRole('button', { name: 'Compare current export' }).click();
  await expect(page.locator('.node-export-image img')).toBeVisible();
  await page.getByRole('textbox', { name: 'Component name', exact: true }).fill('Renamed review');
  await page.getByRole('button', { name: 'Save annotation', exact: true }).click();
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await expect(page.getByLabel('Current node export comparison')).toHaveCount(0);
  const after = await app.read();
  expect(after.annotations.find(annotation => annotation.id === 'original-approved')).toEqual(app.initial.annotations.find(annotation => annotation.id === 'original-approved'));
  expect(after.snapshots).toEqual(app.initial.snapshots);
  await page.getByRole('button', { name: '+ Add region', exact: true }).click();
  await page.getByText('Adjust source references manually', { exact: true }).click();
  await page.getByLabel('Search captured nodes', { exact: true }).fill('hidden-source');
  await expect(page.locator('.manual-sources').getByRole('button', { name: 'Compare current export' })).toBeDisabled();
});
