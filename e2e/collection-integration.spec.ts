import { authenticatePluginSocket } from '../tests/bridge-auth-helper.js';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, expect } from '@playwright/test';
import WebSocket from 'ws';
import { startServer } from '../src/server/index.js';
import { CollectionStore } from '../src/server/structure-collection-store.js';
import { ProjectStore } from '../src/server/store.js';
import { CollectionViewSchema, type StructureChunk } from '../src/shared/structure-collection.js';
import type { PluginCommand, Project, SourceNode } from '../src/shared/contracts.js';

type PluginRequest = { type: 'request'; requestId: string; command: PluginCommand };
type Manifest = { view: { status: string; nodeCount: number }; chunks: { sequence: number }[] };
const bounds = { x: -20, y: 10, width: 3000, height: 1500 };
const fileKey = 'synthetic-collection-file', pageId = 'synthetic-collection-page';
const exactText = '한글😀'.repeat(1500);
const root: SourceNode = { id: 'synthetic-root', parentId: pageId, name: 'Synthetic source frame', type: 'FRAME', bbox: bounds,
  visible: true, sourceFileKey: fileKey, sourcePageId: pageId };
const child: SourceNode = { id: 'synthetic-text', parentId: root.id, name: 'Exact synthetic text', type: 'TEXT', bbox: bounds,
  visible: true, sourceFileKey: fileKey, sourcePageId: pageId, text: exactText };

function chunk(collectionId: string, sequence: number): StructureChunk {
  return { collectionId, sequence, fileKey, pageId, root, bounds,
    startedAt: '2026-10-25T00:00:00.000Z', observedAt: `2026-10-25T00:00:0${sequence + 1}.000Z`,
    nodes: sequence === 0 ? [root] : [child], childCounts: sequence === 0 ? [1] : [0],
    complete: sequence === 1, nextSequence: sequence === 0 ? 1 : null,
    warnings: ['Synthetic WebSocket observation; no native Figma plugin was used.'], consistency: 'live-session-observation' };
}

interface AppFixture {
  url: string; token: string; projectId: string; initial: Project; commands: PluginCommand[];
  releaseFirst(): void;
  manifest(collectionId: string): Promise<Manifest>;
  readProject(): Promise<Project>;
  reopenCollection(collectionId: string): Promise<{ status: string; nodeCount: number }>;
}

const test = base.extend<{ app: AppFixture }>({
  app: async ({}, use) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fsb-collection-browser-integration-'));
    const token = 'synthetic-collection-browser-token-0123456789';
    const server = await startServer({ port: 0, token, dataDir, aiConfig: null, requestTimeoutMs: 10000,
      webDir: resolve(process.env.FSB_E2E_WEB_DIR ?? 'dist/web') });
    const initial = await server.store.create('Synthetic collection workspace');
    const commands: PluginCommand[] = [];
    let pendingFirst: PluginRequest | null = null;
    const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' });
    await once(socket, 'open');
    await authenticatePluginSocket(socket, token, 'synthetic-collection-browser');
    const reply = (request: PluginRequest, result: unknown) => socket.send(JSON.stringify({ type: 'response', requestId: request.requestId, ok: true, result }));
    socket.on('message', bytes => {
      const message = JSON.parse(String(bytes)) as PluginRequest | { type: 'cancel' | 'pong' };
      if (message.type !== 'request') return;
      commands.push(message.command);
      if (message.command.type === 'get_selection') reply(message, { fileKey, pageId,
        nodes: [{ id: root.id, name: root.name, type: root.type, bbox: bounds }] });
      else if (message.command.type === 'read_structure_chunk') {
        if (message.command.sequence === 0) pendingFirst = message;
        else reply(message, chunk(message.command.collectionId, message.command.sequence));
      } else if (message.command.type === 'release_structure_cursor') reply(message, { released: true });
      else socket.send(JSON.stringify({ type: 'response', requestId: message.requestId, ok: false,
        error: { code: 'UNEXPECTED_COMMAND', message: 'Unexpected synthetic source operation.' } }));
    });
    try {
      await use({ url: server.url, token, projectId: initial.id, initial, commands,
        releaseFirst() {
          if (!pendingFirst || pendingFirst.command.type !== 'read_structure_chunk') throw new Error('First chunk is not pending.');
          reply(pendingFirst, chunk(pendingFirst.command.collectionId, 0)); pendingFirst = null;
        },
        async manifest(collectionId) {
          return JSON.parse(await readFile(join(dataDir, 'structure-collections', collectionId, 'manifest.json'), 'utf8')) as Manifest;
        },
        async readProject() {
          const reopened = new ProjectStore(dataDir); await reopened.initialize(); return reopened.get(initial.id);
        },
        async reopenCollection(collectionId) {
          const reopened = new CollectionStore(dataDir); await reopened.initialize();
          const value = reopened.get(initial.id, collectionId);
          return { status: value.status, nodeCount: value.nodeCount };
        },
      });
    } finally { socket.terminate(); await server.close(); await rm(dataDir, { recursive: true, force: true }); }
  },
});

test('collection UI drives real HTTP, WebSocket and disk through pause, resume and complete raw inspection', async ({ page, app }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ token, projectId }) => {
    sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', projectId);
    localStorage.setItem('fsb-locale', 'en');
  }, { token: app.token, projectId: app.projectId });
  await page.goto(app.url);
  await page.locator('details.raw-collection-panel summary').click();
  const prepare = page.getByRole('button', { name: 'Choose selected area' });
  await expect(prepare).toBeEnabled();
  const preparedResponse = page.waitForResponse(response => response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `/api/projects/${app.projectId}/collections`);
  await prepare.click();
  const preparedHttp = await preparedResponse; expect(preparedHttp.status()).toBe(201);
  const prepared = CollectionViewSchema.parse(await preparedHttp.json());
  expect(prepared.status).toBe('prepared'); expect(prepared.source.nodeId).toBe(root.id);
  expect(app.commands.map(command => command.type)).toEqual(['get_selection']);
  await expect(page.getByText('Up to 200,000 nodes and 64 MB.', { exact: false })).toBeVisible();
  await expect(page.getByText('You can resume within 10 minutes', { exact: false })).toBeVisible();
  expect(await app.manifest(prepared.id)).toMatchObject({ view: { status: 'prepared', nodeCount: 0 }, chunks: [] });
  expect(await app.readProject()).toEqual(app.initial);

  await page.getByRole('button', { name: 'Start collection' }).click();
  await expect.poll(() => app.commands.filter(command => command.type === 'read_structure_chunk')
    .map(command => command.type === 'read_structure_chunk' && command.sequence)).toEqual([0]);
  await expect(page.getByRole('progressbar', { name: 'Collection progress' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause collection' }).click();
  await expect(page.getByText('Pausing after the current part is read and saved.')).toBeVisible();
  app.releaseFirst();
  await expect(page.getByRole('button', { name: 'Resume collection' })).toBeEnabled();
  expect(await app.manifest(prepared.id)).toMatchObject({ view: { status: 'paused', nodeCount: 1 }, chunks: [{ sequence: 0 }] });
  expect(app.commands.filter(command => command.type === 'read_structure_chunk')).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Browse source nodes' })).toHaveCount(0);
  expect(await app.readProject()).toEqual(app.initial);

  await page.getByRole('button', { name: 'Resume collection' }).click();
  await expect.poll(() => app.commands.filter(command => command.type === 'read_structure_chunk')
    .map(command => command.type === 'read_structure_chunk' && command.sequence)).toEqual([0, 1]);
  await expect(page.getByRole('button', { name: 'Browse source nodes' })).toBeEnabled();
  expect(await app.manifest(prepared.id)).toMatchObject({ view: { status: 'complete', nodeCount: 2 },
    chunks: [{ sequence: 0 }, { sequence: 1 }] });
  await page.getByRole('button', { name: 'Browse source nodes' }).click();
  await expect(page.getByText('Nodes 1–2 of 2 · not reviewed')).toBeVisible();
  await page.getByRole('button', { name: 'Read exact text' }).click();
  await expect(page.getByText('Loaded 4,000 of 6,000 characters · unreviewed')).toBeVisible();
  await page.getByRole('button', { name: 'Load more text' }).click();
  await expect(page.getByText('Loaded 6,000 of 6,000 characters · unreviewed')).toBeVisible();
  await expect(page.locator('.collection-text pre')).toHaveText(exactText);
  expect(await app.readProject()).toEqual(app.initial);
  await expect(page.locator('.snapshot-list .snapshot-item')).toHaveCount(0);

  await page.reload();
  await page.locator('details.raw-collection-panel summary').click();
  await expect(page.getByLabel('Structure collection history').locator('option')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Browse source nodes' })).toBeEnabled();
  expect(await app.reopenCollection(prepared.id)).toEqual({ status: 'complete', nodeCount: 2 });
  expect(await app.readProject()).toEqual(app.initial);
  expect(errors).toEqual([]);
});
