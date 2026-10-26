import { authenticatePluginSocket } from '../tests/bridge-auth-helper.js';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, expect } from '@playwright/test';
import WebSocket from 'ws';
import { startServer } from '../src/server/index.js';
import { ProjectStore } from '../src/server/store.js';
import { createDemoProject } from '../src/demo/project.js';
import { AcquisitionViewSchema } from '../src/shared/acquisition.js';
import type { NodePreviewResult, PluginCommand, Project, Selection, Snapshot } from '../src/shared/contracts.js';

type PluginRequest = { type: 'request'; requestId: string; command: PluginCommand };
interface AppFixture {
  url: string;
  token: string;
  projectId: string;
  metadata: Snapshot;
  overview: NodePreviewResult;
  commands: PluginCommand[];
  releaseStructure(): void;
  read(): Promise<Project>;
  readPersisted(): Promise<Project>;
}

const test = base.extend<{ app: AppFixture }>({
  app: async ({}, use) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fsb-acquisition-integration-'));
    const token = 'synthetic-acquisition-integration-token-0123456789';
    const server = await startServer({ port: 0, token, dataDir, aiConfig: null, requestTimeoutMs: 10000,
      webDir: resolve(process.env.FSB_E2E_WEB_DIR ?? 'dist/web') });
    const project = await server.store.create('Acquisition integration workspace');
    // Public generated fixture supplies an actual decodable PNG. Only the Figma
    // adapter is synthetic; browser requests use the real HTTP manager and store.
    const source = createDemoProject().snapshots[0]!;
    const root = source.nodes.find(node => node.id === source.source.rootId)!;
    const metadata: Snapshot = { ...structuredClone(source), preview: null };
    const overview: NodePreviewResult = { fileKey: source.source.fileKey!, pageId: source.source.pageId,
      node: structuredClone(root), observedAt: new Date().toISOString(), preview: source.preview!,
      warnings: ['Synthetic browser integration overview; not a native Figma render.'] };
    const selection: Selection = { fileKey: source.source.fileKey, pageId: source.source.pageId,
      nodes: [{ id: root.id, name: root.name, type: root.type, bbox: root.bbox }] };
    const commands: PluginCommand[] = [];
    let pendingStructure: PluginRequest | null = null;
    const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' });
    await once(socket, 'open');
    await authenticatePluginSocket(socket, token, 'synthetic-acquisition-integration');
    const reply = (request: PluginRequest, result: unknown) => socket.send(JSON.stringify({ type: 'response', requestId: request.requestId, ok: true, result }));
    socket.on('message', bytes => {
      const message = JSON.parse(String(bytes)) as PluginRequest | { type: 'cancel' | 'pong' };
      if (message.type !== 'request') return;
      commands.push(message.command);
      if (message.command.type === 'get_selection') reply(message, selection);
      else if (message.command.type === 'preview_capture') {
        overview.observedAt = new Date().toISOString(); reply(message, overview);
      } else if (message.command.type === 'capture_metadata') {
        pendingStructure = message;
        socket.send(JSON.stringify({ type: 'progress', requestId: message.requestId, phase: 'structure', nodes: 1, bytes: 300 }));
      } else socket.send(JSON.stringify({ type: 'response', requestId: message.requestId, ok: false,
        error: { code: 'UNEXPECTED_COMMAND', message: 'This synthetic scenario did not request that source operation.' } }));
    });
    try {
      await use({ url: server.url, token, projectId: project.id, metadata, overview, commands,
        releaseStructure() {
          if (!pendingStructure) throw new Error('No structure request is pending.');
          metadata.source.capturedAt = new Date().toISOString(); reply(pendingStructure, metadata); pendingStructure = null;
        },
        read: () => server.store.get(project.id),
        async readPersisted() {
          const envelope = JSON.parse(await readFile(join(dataDir, 'projects', project.id + '.json'), 'utf8')) as { project: Project };
          const reopened = new ProjectStore(dataDir); await reopened.initialize();
          const validated = await reopened.get(project.id); expect(validated).toEqual(envelope.project); return validated;
        },
      });
    } finally { socket.terminate(); await server.close(); await rm(dataDir, { recursive: true, force: true }); }
  },
});

test('overview-first acquisition crosses real HTTP and WebSocket boundaries, lazily reads structure, and persists only after save', async ({ page, app }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ token, projectId }) => {
    sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', projectId); localStorage.setItem('fsb-locale', 'en');
  }, { token: app.token, projectId: app.projectId });
  await page.goto(app.url);
  const panel = page.getByRole('region', { name: 'Import from Figma', exact: true });
  const capture = panel.getByRole('button', { name: 'Capture Figma selection', exact: true });
  await expect(capture).toBeEnabled();
  const initial = await app.read(); expect(initial.snapshots).toEqual([]);

  const preparedResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/projects/${app.projectId}/acquisitions`);
  await capture.click();
  const preparedHttp = await preparedResponse; expect(preparedHttp.status()).toBe(201);
  const prepared = AcquisitionViewSchema.parse(await preparedHttp.json());
  expect(prepared.status).toBe('prepared');
  expect(prepared.source.nodeId).toBe(app.metadata.source.rootId); expect(prepared.source.bounds).toEqual(app.metadata.bounds);
  await expect(panel.locator('.acquisition-status')).toHaveText('Prepared');
  expect(app.commands.map(command => command.type)).toEqual(['get_selection']);
  expect(await app.read()).toEqual(initial);

  await panel.getByLabel('What to bring in').selectOption('overview');
  const startedResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/${prepared.id}/start`));
  await panel.getByRole('button', { name: 'Start import', exact: true }).click();
  expect((await startedResponse).status()).toBe(202);
  const image = panel.getByRole('img', { name: 'Figma overview image', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => {
    const image = element as HTMLImageElement;
    return { complete: image.complete, width: image.naturalWidth, height: image.naturalHeight };
  })).toEqual({ complete: true, width: app.overview.preview.width, height: app.overview.preview.height });
  await expect(panel.getByText('An overview can be used for drafts. Source confirmation and approval need the complete source structure.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Save complete capture', exact: true })).toBeDisabled();
  expect(app.commands.map(command => command.type)).toEqual(['get_selection', 'preview_capture']);
  expect(await app.readPersisted()).toEqual(initial);
  await expect(page.locator('.snapshot-list .snapshot-item')).toHaveCount(0);

  const loadedResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/${prepared.id}/load-structure`));
  await panel.getByRole('button', { name: 'Load source structure', exact: true }).click();
  expect((await loadedResponse).status()).toBe(202);
  await expect.poll(() => app.commands.map(command => command.type)).toEqual(['get_selection', 'preview_capture', 'capture_metadata']);
  await expect(panel.getByRole('progressbar', { name: 'Figma import progress', exact: true })).toBeVisible();
  await expect(image).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Save complete capture', exact: true })).toBeDisabled();
  expect(await app.readPersisted()).toEqual(initial);
  for (const command of app.commands.slice(1)) {
    expect('fileKey' in command && command.fileKey).toBe(prepared.source.fileKey);
    expect('pageId' in command && command.pageId).toBe(prepared.source.pageId);
    expect('nodeId' in command && command.nodeId).toBe(prepared.source.nodeId);
  }

  app.releaseStructure();
  const save = panel.getByRole('button', { name: 'Save complete capture', exact: true });
  await expect(save).toBeEnabled();
  expect(await app.readPersisted()).toEqual(initial);
  const committedResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/${prepared.id}/commit`));
  await save.click();
  const committedHttp = await committedResponse; expect(committedHttp.status()).toBe(200);
  const committed = await committedHttp.json() as Project;
  await expect(panel.locator('.acquisition-status')).toHaveText('Saved');
  await expect(page.getByRole('status')).toContainText('Complete capture saved.');
  expect(committed.revision).toBe(initial.revision + 1); expect(committed.snapshots).toHaveLength(1);
  const saved = committed.snapshots[0]!;
  expect(saved.source).toEqual(app.metadata.source); expect(saved.bounds).toEqual(app.metadata.bounds); expect(saved.nodes).toEqual(app.metadata.nodes);
  expect(saved.preview).toEqual(app.overview.preview); expect(saved.completeness).toEqual({ complete: true, reason: null });
  expect(saved.acquisition).toEqual({ taskId: prepared.id, consistency: 'separate-observations', previewObservedAt: app.overview.observedAt,
    structureStartedAt: expect.any(String), structureFinishedAt: expect.any(String) });
  expect(Date.parse(saved.acquisition!.structureStartedAt)).toBeLessThanOrEqual(Date.parse(saved.acquisition!.structureFinishedAt));
  expect(committed.annotations).toEqual([]); expect(committed.specifications).toEqual([]); expect(committed.proposals).toEqual([]);
  expect(await app.readPersisted()).toEqual(committed);

  await page.reload();
  await expect(page.locator('.snapshot-list .snapshot-item')).toHaveCount(1);
  await expect(page.locator('.snapshot-list .snapshot-item')).toContainText(`${app.metadata.nodes.length} nodes`);
  await expect(page.getByRole('img', { name: 'Design canvas', exact: true })).toBeVisible();
  await expect(panel.locator('.acquisition-status')).toHaveText('Saved');
  expect(await app.readPersisted()).toEqual(committed);
  expect(app.commands.map(command => command.type)).toEqual(['get_selection', 'preview_capture', 'capture_metadata']);
  expect(errors).toEqual([]);
});
