import { openRegionSettings, openSourceOptions } from './workflow-controls.js';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { test as base, expect, type Page } from '@playwright/test';
import { sourceImportFixture } from '../tests/source-import-fixture.js';
import { SettingsViewSchema } from '../src/shared/import-settings.js';
import { CollectionViewSchema } from '../src/shared/structure-collection.js';

type Fixture = Awaited<ReturnType<typeof sourceImportFixture>>;
const test = base.extend<{ app: Fixture }>({ app: async ({}, use) => {
  const app = await sourceImportFixture({ nodeCount: 12, hold: true, webDir: resolve(process.env.FSB_E2E_WEB_DIR ?? 'dist/web') });
  try { await use(app); } finally { await app.close(); }
} });

async function pausedImport(page: Page, app: Fixture, locale = 'en') {
  const settings = SettingsViewSchema.parse(await (await app.api('/api/import-settings')).json());
  const saved = await app.api('/api/import-settings', { expectedRevision: settings.revision, settings: { ...settings.settings, maxNodes: 4 } });
  expect(saved.ok).toBe(true);
  await page.addInitScript(({ token, id, language }) => {
    sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', id); localStorage.setItem('fsb-locale', language);
  }, { token: app.token, id: app.projectId, language: locale });
  await page.goto(app.url);
  const panel = page.getByRole('region', { name: locale === 'ko' ? '원본 가져오기' : 'Source import', exact: true });
  await panel.getByRole('button', { name: locale === 'ko' ? '원본 추가' : 'Add source', exact: true }).click();
  await panel.getByRole('button', { name: locale === 'ko' ? '가져오기 시작' : 'Start import', exact: true }).click();
  app.release();
  await expect(panel.getByRole('button', { name: locale === 'ko' ? '계속' : 'Continue', exact: true })).toBeEnabled();
  return panel;
}

test('saved partial sources and exact text remain browsable after reload without new Figma reads', async ({ page, app }) => {
  const panel = await pausedImport(page, app);
  await panel.getByText('Received sources', { exact: true }).click();
  await expect(panel).toContainText('4 saved sources match this search');
  await expect(panel).toContainText('This part still has missing source nodes.');
  await expect(panel).toContainText('This part has all its saved source nodes.');
  const beforeText = app.commands.length;
  await panel.getByRole('button', { name: 'Read original text', exact: true }).click();
  await expect(panel.getByRole('region', { name: 'Saved original text' })).toBeVisible();
  expect(await panel.locator('.source-original-text').textContent()).toBe(' Exact 한글 👩‍💻\r\n source text ');
  expect(app.commands.length).toBe(beforeText);
  await page.reload();
  await panel.getByText('Received sources', { exact: true }).click();
  await expect(panel).toContainText('4 saved sources match this search');
  expect(app.commands.length).toBe(beforeText);
  expect((await app.readProject()).scopes?.[0]?.kind).toBe('visual');
});

test('Continue explains reread cost before the user authorizes a new source check', async ({ page, app }) => {
  const panel = await pausedImport(page, app);
  const result = await (await app.api(`/api/projects/${app.projectId}/collections`)).json() as { collections: Array<Record<string, unknown>> };
  const current = result.collections[0]!;
  let continueRequests = 0;
  await page.route(/\/collections\/[^/?]+\/continue-plan$/, route => route.fulfill({ json: {
    kind: 'revalidate', requiresConfirmation: true, savedNodes: 4, reason: 'The connection changed.',
  } }));
  await page.route(/\/collections\/[^/?]+\/continue$/, route => {
    continueRequests++;
    expect(route.request().postDataJSON()).toMatchObject({ confirmRevalidation: true, expectedSessionId: app.sessionId });
    return route.fulfill({ json: current });
  });
  await panel.getByRole('button', { name: 'Continue', exact: true }).click();
  const decision = panel.getByRole('region', { name: 'Check before continuing' });
  await expect(decision).toContainText('4 saved nodes remain available');
  await expect(decision).toContainText('whole selected source again');
  expect(continueRequests).toBe(0);
  await decision.getByRole('button', { name: 'Keep working with saved material' }).click();
  await expect(decision).not.toBeVisible(); expect(continueRequests).toBe(0);
  await panel.getByRole('button', { name: 'Continue', exact: true }).click();
  await decision.getByRole('button', { name: 'Continue and check the source' }).click();
  await expect.poll(() => continueRequests).toBe(1);
});

test('an incomplete text response is rejected instead of displayed as the original', async ({ page, app }) => {
  const panel = await pausedImport(page, app);
  await panel.getByText('Received sources', { exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Read original text' })).toBeVisible();
  await page.route(/\/collections\/[^/?]+\/evidence-text$/, async route => {
    const response = await route.fetch(); const value = await response.json() as { totalLength: number };
    await route.fulfill({ json: { ...value, totalLength: value.totalLength + 1 } });
  });
  await panel.getByRole('button', { name: 'Read original text' }).click();
  await expect(panel.locator('.partial-source-browser [role="alert"]')).toBeVisible();
  await expect(panel.locator('.source-original-text')).toHaveCount(0);
});

test('Korean partial-source browsing explains saved coverage without claiming approval', async ({ page, app }) => {
  const panel = await pausedImport(page, app, 'ko');
  await expect(panel).toContainText('아직 확인하지 못한 원본이 남아 있습니다.');
  await panel.getByText('받은 원본 자료', { exact: true }).click();
  await expect(panel).toContainText('저장된 원본 중 4개를 찾았습니다.');
  await expect(panel).toContainText('현재 Figma와 같은지는 아직 확인하지 않았습니다.');
  await panel.getByRole('button', { name: '원문 읽기', exact: true }).click();
  await expect(panel.getByRole('region', { name: '저장된 원문' })).toBeVisible();
});

test('a complete saved part keeps the full image and copies a proposed region for separate human approval', async ({ page, app }) => {
  const panel = await pausedImport(page, app);
  await page.getByRole('button', { name: '+ Add region', exact: true }).click();
  await page.getByLabel('Component name', { exact: true }).fill('Region kept at its original position');
  await openRegionSettings(page);
  for (const [key, value] of Object.entries({ x: -10, y: 20, width: 10, height: 10 }))
    await page.getByLabel(`Region ${key}`, { exact: true }).fill(String(value));
  await page.getByRole('button', { name: 'Save region', exact: true }).click();
  await expect.poll(async () => (await app.readProject()).annotations.length).toBe(1);
  const before = await app.readProject(), original = before.annotations[0]!;
  await panel.getByText('Received sources', { exact: true }).click();
  const node = panel.locator('.partial-source-browser li').filter({ hasText: 'Synthetic layer 0' });
  await node.getByRole('button', { name: 'Review this part', exact: true }).click();
  await expect(page.locator('.snapshot-item.active')).toContainText('only this part is complete');
  await expect(page.getByLabel('Component name', { exact: true })).toHaveValue(original.name);
  await expect(page.locator('.design-canvas image')).toHaveAttribute('x', '-20');
  await expect(page.locator('.design-canvas image')).toHaveAttribute('width', '128');
  await expect(page.getByLabel('Complete source area', { exact: true })).toHaveAttribute('width', '10');
  await expect(page.getByRole('button', { name: 'Approve region', exact: true })).toBeDisabled();
  await openSourceOptions(page);
  await page.getByRole('button', { name: 'Match source', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm sources', exact: true }).click();
  await page.getByRole('button', { name: 'Approve region', exact: true }).click();
  await expect.poll(async () => (await app.readProject()).annotations.filter(value => value.reviewStatus === 'approved').length).toBe(1);
  const after = await app.readProject(), copied = after.annotations.find(value => value.id !== original.id)!;
  expect(after.annotations.find(value => value.id === original.id)).toEqual(original);
  expect(copied.bbox).toEqual(original.bbox); expect(copied.reviewStatus).toBe('approved');
  expect(after.scopes?.find(value => value.id === original.snapshotId)?.kind).toBe('visual');
  await expect(panel).toContainText('Some source content is still missing.');
  await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
});

test('a restarted connection continues through one confirmed recovery and preserves the existing image draft', async ({ page, app }) => {
  const panel = await pausedImport(page, app);
  await page.getByRole('button', { name: '+ Add region', exact: true }).click();
  await page.getByLabel('Component name', { exact: true }).fill('Keep across restart');
  await page.getByRole('button', { name: 'Save region', exact: true }).click();
  await expect.poll(async () => (await app.readProject()).annotations.length).toBe(1);
  const before = await app.readProject(), visual = before.scopes![0]!;
  await app.restart();
  const settings = SettingsViewSchema.parse(await (await app.api('/api/import-settings')).json());
  expect((await app.api('/api/import-settings', { expectedRevision: settings.revision, settings: { ...settings.settings, maxNodes: 20 } })).ok).toBe(true);
  const reads = app.commands.filter(command => command.type === 'read_structure_chunk').length;
  await page.goto(app.url);
  await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  expect(app.commands.filter(command => command.type === 'read_structure_chunk')).toHaveLength(reads);
  await panel.getByRole('button', { name: 'Continue', exact: true }).click();
  const decision = panel.getByRole('region', { name: 'Check before continuing' });
  await expect(decision).toBeVisible();
  expect(app.commands.filter(command => command.type === 'read_structure_chunk')).toHaveLength(reads);
  await decision.getByRole('button', { name: 'Continue and check the source' }).click();
  await expect(panel).toContainText('Collection complete');
  await expect(page.locator('.snapshot-list .snapshot-item')).toContainText('12 nodes · source structure complete');
  const after = await app.readProject();
  expect(after.scopes).toHaveLength(1); expect(after.scopes![0]!.id).toBe(visual.id);
  expect(after.scopes![0]!.preview).toEqual(visual.preview);
  expect(after.annotations[0]!.name).toBe('Keep across restart'); expect(after.annotations[0]!.reviewStatus).toBe('proposed');
  expect(app.commands.filter(command => command.type === 'preview_capture')).toHaveLength(1);
  await expect(panel).toContainText('Checked 4 source nodes again; reused 1 unchanged saved parts');
});

test('an unfinished saved part is prepared on demand without completing or rerendering the whole source', async ({ page }) => {
  const app=await sourceImportFixture({nodeCount:12,nestedChildren:5,hold:true,webDir:resolve(process.env.FSB_E2E_WEB_DIR??'dist/web')});
  try {
    const panel=await pausedImport(page,app);
    await page.getByRole('button',{name:'+ Add region',exact:true}).click();
    await page.getByLabel('Component name',{exact:true}).fill('Focused region');
    await openRegionSettings(page);
    for(const [key,value]of Object.entries({x:-10,y:20,width:50,height:30}))
      await page.getByLabel(`Region ${key}`,{exact:true}).fill(String(value));
    await page.getByRole('button',{name:'Save region',exact:true}).click();
    await expect.poll(async()=>(await app.readProject()).annotations.length).toBe(1);
    const before=await app.readProject(),original=before.annotations[0]!;
    const settings=SettingsViewSchema.parse(await(await app.api('/api/import-settings')).json());
    expect((await app.api('/api/import-settings',{expectedRevision:settings.revision,settings:{...settings.settings,maxNodes:20}})).ok).toBe(true);
    await panel.getByText('Received sources',{exact:true}).click();
    const group=panel.locator('.partial-source-browser li').filter({hasText:'Synthetic incomplete group'});
    await expect(group).toContainText('This part still has missing source nodes.');
    const readCount=app.commands.filter(command=>command.type==='read_structure_chunk').length;
    await group.getByRole('button',{name:'Prepare this part',exact:true}).click();
    const decision=panel.getByRole('region',{name:'Check before preparing this part'});
    await expect(decision).toContainText('Continuing the full import later will require checking its source again.');
    expect(app.commands.filter(command=>command.type==='read_structure_chunk')).toHaveLength(readCount);
    await decision.getByRole('button',{name:'Prepare this part',exact:true}).click();
    await expect(panel.getByRole('region',{name:'Selected part',exact:true})).toContainText('Collection complete');
    await expect(page.locator('.snapshot-item.active')).toContainText('6 nodes · only this part is complete');
    await expect(page.getByLabel('Component name',{exact:true})).toHaveValue('Focused region');
    await expect(page.locator('.design-canvas image')).toHaveAttribute('x','-20');
    await expect(page.locator('.design-canvas image')).toHaveAttribute('width','128');
    const result=await(await app.api(`/api/projects/${app.projectId}/collections`)).json() as {collections:unknown[]};
    const tasks=result.collections.map(value=>CollectionViewSchema.parse(value)),part=tasks.find(value=>value.partOf)!;
    const parent=tasks.find(value=>value.id===part.partOf!.collectionId)!;
    expect(parent.nodeCount).toBe(4);expect(parent.status).not.toBe('complete');
    expect(part.nodeCount).toBe(6);expect(part.source.nodeId).toBe('group');
    expect(app.commands.filter(command=>command.type==='preview_capture')).toHaveLength(1);
    const newReads=app.commands.filter(command=>command.type==='read_structure_chunk').slice(readCount);
    expect(newReads.length).toBeGreaterThan(0);expect(newReads.every(command=>command.type==='read_structure_chunk'&&command.nodeId==='group')).toBe(true);
    const after=await app.readProject();
    expect(after.annotations.find(value=>value.id===original.id)).toEqual(original);
    expect(after.annotations.find(value=>value.id!==original.id)?.bbox).toEqual(original.bbox);
    expect(after.scopes?.find(value=>value.kind==='branch')?.preview).toEqual(before.scopes![0]!.preview);
    const finalReads=app.commands.length;
    await page.reload();
    await expect(panel.getByRole('region',{name:'Selected part',exact:true})).toContainText('Collection complete');
    expect(app.commands.length).toBe(finalReads);
  } finally {await app.close();}
});

test('the source file route shares a prepared part with its original image and bounded coverage',async({page,app})=>{
  const panel=await pausedImport(page,app);
  await panel.getByText('Received sources',{exact:true}).click();
  await panel.locator('.partial-source-browser li').filter({hasText:'Synthetic layer 0'}).getByRole('button',{name:'Review this part',exact:true}).click();
  await expect(page.locator('.snapshot-item.active')).toContainText('only this part is complete');
  const before=await app.readProject(),branch=before.scopes!.find(scope=>scope.kind==='branch')!;
  const transfer=page.locator('.source-transfer-panel');
  await transfer.locator('summary').click();
  await expect(transfer.getByLabel('Source structure to share')).toContainText('Prepared part');
  const downloading=page.waitForEvent('download');
  await transfer.getByRole('button',{name:'Download source file',exact:true}).click();
  const bytes=await readFile(await(await downloading).path());
  const commandsBefore=app.commands.length;
  await transfer.getByLabel('Source file (.ndjson or .json)',{exact:true}).setInputFiles({name:'prepared-part.ndjson',mimeType:'application/x-ndjson',buffer:bytes});
  await transfer.getByRole('button',{name:'Import source file',exact:true}).click();
  await expect(page.locator('.snapshot-item')).toHaveCount(3);
  const after=await app.readProject(),imported=after.scopes!.find(scope=>scope.kind==='branch'&&scope.id!==branch.id)!;
  expect(imported.preview).toEqual(branch.preview);expect(imported.visualBounds).toEqual(branch.visualBounds);
  expect(imported.coverageBounds).toEqual(branch.coverageBounds);expect(imported.branch!.nodeCount).toBe(1);
  expect(imported.branch!.ancestorRendering).toEqual(branch.branch!.ancestorRendering);
  expect(after.annotations).toEqual(before.annotations);expect(after.specifications).toEqual(before.specifications);
  expect(app.commands.length).toBe(commandsBefore);
});

test('a paused requested part exposes its saved sources and Continue resumes that part',async({page})=>{
  const app=await sourceImportFixture({nodeCount:12,nestedChildren:5,hold:true,webDir:resolve(process.env.FSB_E2E_WEB_DIR??'dist/web')});
  try{
    const panel=await pausedImport(page,app);
    await panel.getByText('Received sources',{exact:true}).click();
    await panel.locator('.partial-source-browser li').filter({hasText:'Synthetic incomplete group'}).getByRole('button',{name:'Prepare this part',exact:true}).click();
    await panel.getByRole('region',{name:'Check before preparing this part'}).getByRole('button',{name:'Prepare this part',exact:true}).click();
    const part=panel.getByRole('region',{name:'Selected part',exact:true});
    await expect(part).toContainText('Paused · 4 nodes');
    await part.getByText('Received sources',{exact:true}).click();
    await expect(part).toContainText('4 saved sources match this search');
    const commands=app.commands.length;
    await part.getByRole('button',{name:'Read original text',exact:true}).click();
    expect(await part.locator('.source-original-text').textContent()).toBe(' Exact 한글 👩‍💻\r\n source text ');
    expect(app.commands.length).toBe(commands);
    const settings=SettingsViewSchema.parse(await(await app.api('/api/import-settings')).json());
    expect((await app.api('/api/import-settings',{expectedRevision:settings.revision,settings:{...settings.settings,maxNodes:20}})).ok).toBe(true);
    await panel.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(part).toContainText('Collection complete · 6 nodes');
    await expect(page.locator('.snapshot-item.active')).toContainText('6 nodes · only this part is complete');
    const result=await(await app.api(`/api/projects/${app.projectId}/collections`)).json() as {collections:unknown[]};
    const tasks=result.collections.map(value=>CollectionViewSchema.parse(value));
    expect(tasks).toHaveLength(2);expect(tasks.find(value=>!value.partOf)?.nodeCount).toBe(4);
    expect(tasks.find(value=>value.partOf)?.status).toBe('complete');
  }finally{await app.close();}
});
