import { authenticatePluginSocket } from '../tests/bridge-auth-helper.js';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, expect } from '@playwright/test';
import WebSocket from 'ws';
import { createDemoProject } from '../src/demo/project.js';
import { startServer } from '../src/server/index.js';
import { ProjectStore } from '../src/server/store.js';
import type { NodePreviewResult, PluginCommand, Project, SourceNode } from '../src/shared/contracts.js';
import type { StructureChunk } from '../src/shared/structure-collection.js';

type PluginRequest = { type: 'request'; requestId: string; command: PluginCommand };
const bounds = { x: -20, y: 10, width: 980, height: 650 };
const fileKey = 'synthetic-evidence-file', pageId = 'synthetic-evidence-page';
const exactText = '한글😀'.repeat(1500);
const root: SourceNode = { id: 'synthetic-evidence-root', parentId: pageId, name: 'Synthetic evidence frame', type: 'FRAME',
  bbox: bounds, visible: true, sourceFileKey: fileKey, sourcePageId: pageId };
const child: SourceNode = { id: 'synthetic-evidence-text', parentId: root.id, name: 'Exact synthetic evidence text', type: 'TEXT',
  bbox: { x: 30, y: 40, width: 500, height: 100 }, text: exactText, visible: true, sourceFileKey: fileKey, sourcePageId: pageId };
const startedAt = '2026-10-26T00:00:00.000Z';
function chunk(collectionId: string, sequence: number): StructureChunk {
  return { collectionId, sequence, fileKey, pageId, root, bounds, startedAt,
    observedAt: `2026-10-26T00:00:0${sequence + 1}.000Z`, nodes: sequence === 0 ? [root] : [child],
    childCounts: sequence === 0 ? [1] : [0], complete: sequence === 1, nextSequence: sequence === 0 ? 1 : null,
    warnings: ['Synthetic WebSocket structure observation.'], consistency: 'live-session-observation' };
}

interface AppFixture { url: string; token: string; projectId: string; secondProjectId: string; commands: PluginCommand[];
  preview: NonNullable<Project['snapshots'][number]['preview']>; readProject(projectId?: string): Promise<Project> }
const test = base.extend<{ app: AppFixture }>({
  app: async ({}, use) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fsb-evidence-browser-'));
    const token = 'synthetic-evidence-browser-token-0123456789';
    const server = await startServer({ port: 0, token, dataDir, aiConfig: null, requestTimeoutMs: 10000,
      webDir: resolve(process.env.FSB_E2E_WEB_DIR ?? 'dist/web') });
    const project = await server.store.create('Synthetic evidence workspace');
    const secondProject = await server.store.create('Second synthetic workspace');
    const preview = createDemoProject().snapshots[0]!.preview!;
    const overview: NodePreviewResult = { fileKey, pageId, node: root, preview,
      observedAt: new Date().toISOString(), warnings: ['Synthetic browser overview, not a native Figma render.'] };
    const commands: PluginCommand[] = [];
    const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' });
    await once(socket, 'open');
    await authenticatePluginSocket(socket, token, 'synthetic-evidence-browser');
    const reply = (request: PluginRequest, result: unknown) => socket.send(JSON.stringify({ type: 'response', requestId: request.requestId, ok: true, result }));
    socket.on('message', bytes => {
      const message = JSON.parse(String(bytes)) as PluginRequest | { type: 'cancel' | 'pong' };
      if (message.type !== 'request') return;
      commands.push(message.command);
      if (message.command.type === 'get_selection') reply(message, { fileKey, pageId,
        nodes: [{ id: root.id, name: root.name, type: root.type, bbox: bounds }] });
      else if (message.command.type === 'preview_capture') {
        overview.observedAt = new Date().toISOString(); reply(message, overview);
      } else if (message.command.type === 'read_structure_chunk') reply(message, chunk(message.command.collectionId, message.command.sequence));
      else if (message.command.type === 'read_source_nodes') {
        const command = message.command;
        const { text: _rootText, ...scope } = root;
        const observedAt = new Date().toISOString();
        reply(message, { fileKey, pageId, scopeId: root.id, scope, startedAt: observedAt, observedAt,
          requestedIds: command.nodeIds, fields: command.fields,
          records: command.nodeIds.map(id => {
            const source = id === child.id ? child : root;
            const { text, ...metadata } = source;
            return { node: command.fields === 'text' ? source : metadata,
              fieldCoverage: { metadata: 'loaded', text: command.fields === 'metadata' ? 'not-requested'
                : source.type === 'TEXT' ? 'loaded' : 'not-applicable' } };
          }), requestedIdsComplete: true, consistency: 'live-session-observation' });
      }
      else if (message.command.type === 'read_source_children') {
        const command = message.command;
        if (command.parentId !== root.id) socket.send(JSON.stringify({ type: 'response', requestId: message.requestId, ok: false,
          error: { code: 'NODE_UNAVAILABLE', message: 'Synthetic parent is unavailable.' } }));
        else {
          const { text: _text, ...metadata } = child;
          reply(message, { fileKey, pageId, scopeId: root.id, scope: root, parentId: root.id, parent: root,
            observationId: command.observationId, startedAt, observedAt: new Date().toISOString(),
            offset: 0, totalChildren: 1, nodes: [{ ...metadata, rendering: { siblingIndex: 0 } }],
            nextOffset: null, childrenComplete: true, consistency: 'live-session-observation' });
        }
      }
      else if (message.command.type === 'release_source_children') reply(message, { released: true });
      else if (message.command.type === 'release_structure_cursor') reply(message, { released: true });
      else socket.send(JSON.stringify({ type: 'response', requestId: message.requestId, ok: false,
        error: { code: 'UNEXPECTED_COMMAND', message: 'Unexpected synthetic source operation.' } }));
    });
    try {
      await use({ url: server.url, token, projectId: project.id, secondProjectId: secondProject.id, commands, preview,
        async readProject(id = project.id) { const reopened = new ProjectStore(dataDir); await reopened.initialize(); return reopened.get(id); } });
    } finally { socket.terminate(); await server.close(); await rm(dataDir, { recursive: true, force: true }); }
  },
});

// Source setup uses the existing HTTP compatibility contracts. The normal
// UI import, automatic binding and lock behavior are covered by source-import.spec.ts.
async function api(app:AppFixture,path:string,body?:unknown):Promise<any> {
  const response=await fetch(app.url+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${app.token}`,
    ...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  expect(response.ok).toBe(true);return response.json();
}
async function prepareCollection(app:AppFixture):Promise<string> {
  const current=await app.readProject(),status=await api(app,'/api/plugin/status');
  const base=`/api/projects/${app.projectId}/collections`;
  const task=await api(app,base,{expectedRevision:current.revision,expectedSessionId:status.sessionId});
  await api(app,`${base}/${task.id}/start`,{});
  await expect.poll(async()=>(await api(app,`${base}/${task.id}`)).status).toBe('complete');return task.id;
}
async function arrangeSource(page:import('@playwright/test').Page,app:AppFixture,kind:'visual'|'collection') {
  let input:Record<string,unknown>;
  if(kind==='visual'){
    const current=await app.readProject(),status=await api(app,'/api/plugin/status'),base=`/api/projects/${app.projectId}/acquisitions`;
    const task=await api(app,base,{expectedRevision:current.revision,expectedSessionId:status.sessionId});
    await api(app,`${base}/${task.id}/start`,{plan:'overview'});
    await expect.poll(async()=>(await api(app,`${base}/${task.id}`)).status).toBe('ready');input={acquisitionId:task.id};
  }else input={collectionId:await prepareCollection(app)};
  await api(app,`/api/projects/${app.projectId}/evidence-scopes`,{expectedRevision:(await app.readProject()).revision,...input});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.locator('.snapshot-list .snapshot-item')).toHaveCount((await app.readProject()).scopes!.length);
}

test('visual draft stays proposed until a complete collection is attached and human source review is confirmed', async ({ page, app }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ token, projectId }) => {
    sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', projectId);
    localStorage.setItem('fsb-locale', 'en');
  }, { token: app.token, projectId: app.projectId });
  await page.goto(app.url);
  await arrangeSource(page,app,'visual');
  await expect(page.locator('.snapshot-list .snapshot-item')).toHaveCount(1);
  await expect(page.locator('.snapshot-list .snapshot-item')).toContainText('Image draft · source structure needed');
  const visualProject = await app.readProject();
  expect(visualProject.snapshots).toHaveLength(0);
  expect(visualProject.scopes).toHaveLength(1);
  expect(visualProject.scopes![0]).toMatchObject({ kind: 'visual', collection: null, source: { rootId: root.id }, preview: app.preview });
  const scopeId = visualProject.scopes![0]!.id;

  await page.getByRole('button', { name: '+ Add region' }).click();
  await page.getByRole('button', { name: 'Save annotation' }).click();
  await expect.poll(async () => (await app.readProject()).annotations.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Approve annotation' })).toBeDisabled();
  expect((await app.readProject()).annotations).toHaveLength(1);
  expect((await app.readProject()).annotations[0]).toMatchObject({ snapshotId: scopeId, reviewStatus: 'proposed' });

  const collectionId=await prepareCollection(app);
  await api(app,`/api/projects/${app.projectId}/evidence-scopes/${scopeId}/attach`,{expectedRevision:(await app.readProject()).revision,collectionId});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByText('Source structure complete · confirm sources before approval')).toBeVisible();
  const attached = await app.readProject();
  expect(attached.scopes![0]).toMatchObject({ id: scopeId, kind: 'collection', preview: app.preview,
    collection: { nodeCount: 2 } });
  expect(attached.annotations[0]).toMatchObject({ snapshotId: scopeId, reviewStatus: 'proposed' });
  await expect(page.getByRole('button', { name: 'Approve annotation' })).toBeDisabled();

  await page.locator('.evidence-source-review details.advanced summary').click();
  const childRow = page.locator('.evidence-source-review .collection-nodes li').filter({ hasText: child.name });
  await expect(childRow).toBeVisible();
  await childRow.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save annotation' }).click();
  await expect(page.getByRole('button', { name: 'Confirm sources' })).toBeEnabled();
  await page.getByRole('button', { name: 'Confirm sources' }).click();
  await expect(page.getByRole('button', { name: 'Approve annotation' })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve annotation' }).click();
  await expect.poll(async () => (await app.readProject()).annotations[0]?.reviewStatus).toBe('approved');
  expect((await app.readProject()).annotations[0]).toMatchObject({ reviewStatus: 'approved', sourceReview: { status: 'confirmed' } });

  await page.getByRole('tab', { name: 'Specifications' }).click();
  await page.locator('.evidence-text-picker summary').click();
  await page.locator('.evidence-text-picker .collection-nodes li').filter({ hasText: child.name })
    .getByRole('button', { name: 'Use original text' }).click();
  await expect(page.getByRole('button', { name: 'Create specification' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create specification' }).click();
  await expect(page.locator('.spec-text')).toHaveText(exactText);
  await page.locator('.relation-list input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Save specification' }).click();
  await expect(page.getByRole('button', { name: 'Approve specification' })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve specification' }).click();
  await expect.poll(async () => (await app.readProject()).specifications[0]?.reviewStatus).toBe('approved');
  const approved = await app.readProject();
  expect(approved.specifications[0]).toMatchObject({ text: exactText, reviewStatus: 'approved',
    sourceRefs: [{ snapshotId: scopeId, nodeId: child.id }] });
  await page.reload();
  await expect(page.locator('.snapshot-list .snapshot-item')).toHaveCount(1);
  await expect(page.locator('.snapshot-list .snapshot-item')).toContainText('source structure complete');
  await page.getByRole('tab', { name: 'Specifications' }).click();
  await page.locator('.spec-list button').click();
  await expect(page.locator('.text-nodes .text-node')).toHaveCount(1);
  await expect(page.locator('.text-nodes .text-node')).toContainText(exactText);
  expect(app.commands.some(command => command.type === 'capture_metadata')).toBe(false);
  expect(errors).toEqual([]);
});

test('complete collection can open an honest source-only editor without inventing an image capture', async ({ page, app }) => {
  await page.addInitScript(({ token, projectId }) => {
    sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', projectId);
    localStorage.setItem('fsb-locale', 'en');
  }, { token: app.token, projectId: app.projectId });
  await page.goto(app.url);
  await arrangeSource(page,app,'collection');
  await expect(page.locator('.snapshot-list .snapshot-item')).toContainText('2 nodes · source structure complete');
  await expect(page.getByText('No overview image · use source bounds to draw regions')).toBeVisible();
  const persisted = await app.readProject();
  expect(persisted.snapshots).toHaveLength(0);
  expect(persisted.scopes).toHaveLength(1);
  expect(persisted.scopes![0]).toMatchObject({ kind: 'collection', preview: null, visualObservation: null,
    collection: { nodeCount: 2 } });
  expect(app.commands.some(command => command.type === 'preview_capture')).toBe(false);
});

test('source transfer downloads exact source only and imports a new unreviewed scope', async ({ page, app }) => {
  await page.addInitScript(({ token, projectId }) => {
    sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', projectId);
    localStorage.setItem('fsb-locale', 'en');
  }, { token: app.token, projectId: app.projectId });
  await page.goto(app.url);
  await arrangeSource(page,app,'collection');
  await expect(page.locator('.snapshot-list .snapshot-item')).toHaveCount(1);
  const originalId = (await app.readProject()).scopes![0]!.id;
  await page.getByRole('button', { name: '+ Add region' }).click();
  await page.getByRole('button', { name: 'Save annotation' }).click();
  await expect.poll(async () => (await app.readProject()).annotations.length).toBe(1);

  const panel = page.locator('details.source-transfer-panel');
  await panel.locator('summary').click();
  await expect(panel).toContainText('Annotations, specifications and approvals are not included.');
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download source file' }).click();
  const download = await downloadPromise;
  const bytes = await readFile(await download.path());
  expect(bytes.toString('utf8')).toContain(exactText);
  expect(bytes.toString('utf8')).not.toContain((await app.readProject()).annotations[0]!.id);
  await panel.getByLabel('Source file (.ndjson or .json)').setInputFiles({
    name: 'synthetic-evidence.ndjson', mimeType: 'application/x-ndjson', buffer: bytes,
  });
  const importResponse = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/projects/${app.projectId}/source-transfer`);
  await panel.getByRole('button', { name: 'Import source file' }).click();
  expect((await importResponse).status()).toBe(201);
  await expect(page.locator('.snapshot-list .snapshot-item')).toHaveCount(2);
  const imported = await app.readProject();
  expect(imported.snapshots).toHaveLength(0);
  expect(imported.scopes).toHaveLength(2);
  expect(imported.scopes![0]!.id).toBe(originalId);
  expect(imported.scopes![1]).toMatchObject({ kind: 'collection', preview: null, visualObservation: null,
    collection: { nodeCount: 2 } });
  expect(imported.scopes![1]!.id).not.toBe(originalId);
  expect(imported.annotations).toHaveLength(1);
  expect(imported.annotations[0]!.snapshotId).toBe(originalId);
  expect(imported.specifications).toHaveLength(0);
});

test('a delayed source download cannot update transfer state after switching workspaces', async ({ page, app }) => {
  await page.addInitScript(({ token, projectId }) => {
    sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', projectId);
    localStorage.setItem('fsb-locale', 'en');
  }, { token: app.token, projectId: app.projectId });
  await page.goto(app.url);
  await arrangeSource(page,app,'collection');
  const panel = page.locator('details.source-transfer-panel');
  await panel.locator('summary').click();

  const initialDownload = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download source file' }).click();
  const validFile = await readFile(await (await initialDownload).path());
  let releaseOldDownload: (() => void) | undefined;
  let oldDownloadStarted: (() => void) | undefined;
  const oldDownloadIntercepted = new Promise<void>(resolve => { oldDownloadStarted = resolve; });
  const oldDownloadGate = new Promise<void>(resolve => { releaseOldDownload = resolve; });
  await page.route(/\/source-transfer\/[^/?]+\?expectedRevision=/, async route => {
    oldDownloadStarted?.();
    await oldDownloadGate;
    try { await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: validFile }); }
    catch { /* The browser has already aborted this old workspace request. */ }
  });

  let releaseImport: (() => void) | undefined;
  let importStarted: (() => void) | undefined;
  const importIntercepted = new Promise<void>(resolve => { importStarted = resolve; });
  const importGate = new Promise<void>(resolve => { releaseImport = resolve; });
  await page.route(`**/api/projects/${app.secondProjectId}/source-transfer?**`, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    importStarted?.();
    await importGate;
    await route.continue();
  });
  try {
    await panel.getByRole('button', { name: 'Download source file' }).click();
    await oldDownloadIntercepted;
    await expect(panel.getByRole('button', { name: 'Stop download' })).toBeVisible();
    await page.locator('#workspace-select').selectOption(app.secondProjectId);
    await expect(page.locator('#workspace-select')).toHaveValue(app.secondProjectId);
    await expect(panel.getByRole('button', { name: 'Stop download' })).toBeHidden();
    await panel.getByLabel('Source file (.ndjson or .json)').setInputFiles({
      name: 'synthetic-evidence.ndjson', mimeType: 'application/x-ndjson', buffer: validFile,
    });
    await panel.getByRole('button', { name: 'Import source file' }).click();
    await importIntercepted;
    releaseOldDownload?.();
    await expect(panel.getByRole('button', { name: 'Stop import' })).toBeVisible();
    await expect(panel.getByText('Checking and importing the file on this computer. Please wait for confirmation.')).toBeVisible();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    releaseImport?.();
    await expect(page.locator('.snapshot-list .snapshot-item')).toHaveCount(1);
    expect((await app.readProject(app.secondProjectId)).scopes).toHaveLength(1);
    expect((await app.readProject()).scopes).toHaveLength(1);
  } finally {
    releaseOldDownload?.();
    releaseImport?.();
  }
});

test('source import holds the editor until its delayed workspace update is applied', async ({ page, app }) => {
  await page.addInitScript(({ token, projectId }) => {
    sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', projectId);
    localStorage.setItem('fsb-locale', 'en');
  }, { token: app.token, projectId: app.projectId });
  await page.goto(app.url);
  await arrangeSource(page,app,'collection');
  await page.getByRole('button', { name: '+ Add region' }).click();
  const name = page.getByLabel('Component name');
  await name.fill('Saved synthetic component');
  await page.getByRole('button', { name: 'Save annotation' }).click();
  await expect.poll(async () => (await app.readProject()).annotations[0]?.name).toBe('Saved synthetic component');
  const panel = page.locator('details.source-transfer-panel');
  await panel.locator('summary').click();
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download source file' }).click();
  const bytes = await readFile(await (await downloadPromise).path());
  await panel.getByLabel('Source file (.ndjson or .json)').setInputFiles({
    name: 'synthetic-evidence.ndjson', mimeType: 'application/x-ndjson', buffer: bytes,
  });
  let release: (() => void) | undefined, started: (() => void) | undefined;
  const intercepted = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/projects/${app.projectId}/source-transfer?**`, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    started?.(); await gate; await route.continue();
  });
  try {
    await panel.getByRole('button', { name: 'Import source file' }).click();
    await intercepted;
    await expect(name).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save annotation' })).toBeDisabled();
    await expect(page.locator('#workspace-select')).toBeDisabled();
    release?.();
    await expect(page.locator('.snapshot-list .snapshot-item')).toHaveCount(2);
    expect((await app.readProject()).annotations[0]?.name).toBe('Saved synthetic component');
    await expect(page.getByRole('button', { name: '+ Add region' })).toBeEnabled();
  } finally { release?.(); }
});

test('late exact text from one specification cannot enter another specification draft', async ({ page, app }) => {
  await page.addInitScript(({ token, projectId }) => {
    sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', projectId);
    localStorage.setItem('fsb-locale', 'en');
  }, { token: app.token, projectId: app.projectId });
  await page.goto(app.url);
  await arrangeSource(page,app,'collection');
  await page.getByRole('tab', { name: 'Specifications' }).click();
  let picker = page.locator('.evidence-text-picker');
  await picker.locator('summary').click();
  await picker.locator('.collection-nodes li').filter({ hasText: child.name }).getByRole('button', { name: 'Use original text' }).click();
  await expect(page.getByRole('button', { name: 'Create specification' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create specification' }).click();
  await page.getByRole('button', { name: 'Save specification' }).click();
  await expect.poll(async () => (await app.readProject()).specifications.length).toBe(1);
  await page.getByRole('button', { name: 'Create specification' }).click();
  await page.getByRole('button', { name: 'Save specification' }).click();
  await expect.poll(async () => (await app.readProject()).specifications.length).toBe(2);
  const specs = page.locator('.spec-list button');
  await specs.first().click();
  await page.getByText('Select source text (1)').click();
  await expect(page.locator('.text-nodes .text-node input')).toBeChecked();
  await page.locator('.text-nodes .text-node input').click();
  await expect(page.getByText('Select source text (0)')).toBeVisible();
  picker = page.locator('.evidence-text-picker');
  await picker.locator('summary').click();
  const choose = picker.locator('.collection-nodes li').filter({ hasText: child.name }).getByRole('button', { name: 'Use original text' });
  await expect(choose).toBeEnabled();
  let release: (() => void) | undefined, started: (() => void) | undefined, finished: (() => void) | undefined;
  const intercepted = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const routeFinished = new Promise<void>(resolve => { finished = resolve; });
  let held = false;
  await page.route(/\/evidence-scopes\/[^/?]+\/text$/, async route => {
    if (!held) { held = true; started?.(); await gate; }
    try { await route.continue(); } catch { /* Switching editor context aborts the old read. */ }
    finally { finished?.(); }
  });
  try {
    await choose.click();
    await intercepted;
    await expect(specs.nth(1)).toBeDisabled();
    await page.getByRole('button', { name: 'Discard specification changes', exact: true }).click();
    await specs.nth(1).click();
    await expect(page.locator('.spec-text')).toHaveText(exactText);
    release?.();
    await routeFinished;
    await page.waitForTimeout(200);
    await expect(page.locator('.spec-text')).toHaveText(exactText);
    expect((await app.readProject()).specifications).toHaveLength(2);
  } finally { release?.(); }
});
