import { resolve } from 'node:path';
import { test as base,expect,type Page } from '@playwright/test';
import { sourceImportFixture } from '../tests/source-import-fixture.js';
import { SettingsViewSchema } from '../src/shared/import-settings.js';

type Fixture=Awaited<ReturnType<typeof sourceImportFixture>>;
const test=base.extend<{app:Fixture}>({app:async({},use)=>{
  const app=await sourceImportFixture({nodeCount:6001,hold:true,webDir:resolve(process.env.FSB_E2E_WEB_DIR??'dist/web')});
  try{await use(app);}finally{await app.close();}
}});
async function open(page:Page,app:Fixture,locale='en'){
  await page.addInitScript(({token,id,locale})=>{sessionStorage.setItem('fsb-token',token);sessionStorage.setItem('fsb-last-project',id);localStorage.setItem('fsb-locale',locale);},
    {token:app.token,id:app.projectId,locale});await page.goto(app.url);
}
async function start(page:Page){
  const panel=page.getByRole('region',{name:'Source import',exact:true});
  await panel.getByRole('button',{name:'Add source',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Start import',exact:true})).toBeEnabled();
  await panel.getByRole('button',{name:'Start import',exact:true}).click();return panel;
}
async function saveNodes(page:Page,count:number){
  await page.getByRole('button',{name:'Settings',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Import settings'});
  await expect(dialog.getByLabel('Source node budget',{exact:true})).toBeEnabled();
  await dialog.getByLabel('Source node budget',{exact:true}).fill(String(count));
  await dialog.getByRole('button',{name:'Save settings'}).click();await expect(dialog).not.toBeVisible();
}

test('one import route prepares without heavy reads and uses a 2x image automatically',async({page,app})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await open(page,app);
  await expect(page.getByLabel('What to bring in')).toHaveCount(0);
  await expect(page.locator('details.raw-collection-panel, details.selective-source-panel')).toHaveCount(0);
  const panel=page.getByRole('region',{name:'Source import',exact:true});
  await panel.getByRole('button',{name:'Add source',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Start import',exact:true})).toBeEnabled();
  expect(app.commands.map(command=>command.type)).toEqual(['get_selection']);
  await expect(panel).toContainText('200,000 nodes');await expect(panel).toContainText('4,096');
  await panel.getByRole('button',{name:'Start import'}).click();
  await expect(page.locator('.snapshot-list .snapshot-item')).toContainText('Image draft');
  await panel.locator('.import-details > summary').click();
  await expect(panel.getByRole('img',{name:'Figma overview image'})).toBeVisible();
  const image=await panel.getByRole('img',{name:'Figma overview image'}).evaluate(node=>({width:(node as HTMLImageElement).naturalWidth,height:(node as HTMLImageElement).naturalHeight}));
  expect(image).toEqual({width:256,height:128});expect(app.commands.some(command=>command.type==='capture_metadata')).toBe(false);
  app.release();await expect(page.locator('.snapshot-list .snapshot-item')).toContainText('6,001 nodes · source structure complete');
  const saved=await app.readProject();expect(saved.scopes).toHaveLength(1);expect(saved.scopes![0]!.preview?.width).toBe(256);
  expect(saved.snapshots).toEqual([]);expect(errors).toEqual([]);
});

test('settings pause at 5,000 and continue from the next unread node after raising the limit',async({page,app})=>{
  await open(page,app);await saveNodes(page,5000);const panel=await start(page);app.release();
  await expect(panel.getByRole('button',{name:'Continue',exact:true})).toBeEnabled();
  await expect(panel).toContainText('5,000 nodes');await expect(panel).toContainText('Increase it in Settings');
  const visual=(await app.readProject()).scopes![0]!;
  await page.getByRole('button',{name:'+ Add region'}).click();await page.getByLabel('Component name').fill('Preserved region');
  await page.getByRole('button',{name:'Save region',exact:true}).click();
  await expect(page.getByRole('button',{name:'Approve region',exact:true})).toBeDisabled();
  await saveNodes(page,10000);await panel.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.locator('.snapshot-list .snapshot-item')).toContainText('6,001 nodes · source structure complete');
  const saved=await app.readProject();expect(saved.scopes).toHaveLength(1);expect(saved.scopes![0]!.id).toBe(visual.id);
  expect(saved.annotations[0]!.name).toBe('Preserved region');expect(saved.annotations[0]!.reviewStatus).toBe('proposed');
  expect(app.commands.filter(command=>command.type==='preview_capture')).toHaveLength(1);expect(app.childReads).toBe(1);
  expect(app.commands.filter(command=>command.type==='read_structure_chunk').map(command=>command.sequence)).toEqual(Array.from({length:13},(_,i)=>i));
});

test('completed structure remains usable when image rendering fails',async({page,app})=>{
  app.failImage(true);app.release();await open(page,app);await start(page);
  await expect(page.locator('.snapshot-list .snapshot-item')).toContainText('6,001 nodes · source structure complete');
  await expect(page.getByText('No overview image · use source bounds to draw regions')).toBeVisible();
  const saved=await app.readProject();expect(saved.scopes![0]!.preview).toBeNull();expect(saved.scopes![0]!.collection?.nodeCount).toBe(6001);
});

test('automatic structure attachment waits for unsaved region edits',async({page,app})=>{
  await open(page,app);await start(page);await expect(page.locator('.snapshot-list .snapshot-item')).toContainText('Image draft');
  await page.getByRole('button',{name:'+ Add region'}).click();await page.getByLabel('Component name').fill('Unsaved intent stays');
  app.release();await expect(page.getByRole('region',{name:'Source import'})).toContainText('Collection complete');
  expect((await app.readProject()).scopes![0]!.kind).toBe('visual');await expect(page.getByLabel('Component name')).toHaveValue('Unsaved intent stays');
  await page.getByRole('button',{name:'Save region',exact:true}).click();
  await expect(page.locator('.snapshot-list .snapshot-item')).toContainText('source structure complete');
  expect((await app.readProject()).annotations[0]!.name).toBe('Unsaved intent stays');
});

test('automatic image saving holds the editor until the source binding is applied',async({page,app})=>{
  await open(page,app);let release:()=>void=()=>{},entered:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;}),seen=new Promise<void>(resolve=>{entered=resolve;});
  await page.route(/\/evidence-scopes$/,async route=>{entered();await gate;await route.continue();});
  try{await start(page);await seen;await expect(page.locator('#workspace-select')).toBeDisabled();
    await expect(page.getByRole('button',{name:'+ Add region'})).toBeDisabled();release();
    await expect(page.locator('.snapshot-list .snapshot-item')).toContainText('Image draft');
  }finally{release();}
});

test('automatic structure attachment holds the editor and preserves saved region intent',async({page,app})=>{
  await open(page,app);await start(page);await expect(page.locator('.snapshot-list .snapshot-item')).toContainText('Image draft');
  await page.getByRole('button',{name:'+ Add region'}).click();const name=page.getByLabel('Component name');await name.fill('Saved before attachment');
  await page.getByRole('button',{name:'Save region',exact:true}).click();
  await expect.poll(async()=>(await app.readProject()).annotations[0]?.name).toBe('Saved before attachment');
  let release:()=>void=()=>{},entered:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;}),seen=new Promise<void>(resolve=>{entered=resolve;});
  await page.route(/\/evidence-scopes\/[^/?]+\/attach$/,async route=>{entered();await gate;await route.continue();});
  try{app.release();await seen;await expect(name).toBeDisabled();await expect(page.locator('#workspace-select')).toBeDisabled();release();
    await expect(page.locator('.snapshot-list .snapshot-item')).toContainText('source structure complete');
    await expect(name).toHaveValue('Saved before attachment');expect((await app.readProject()).annotations[0]!.name).toBe('Saved before attachment');
  }finally{release();}
});

test('saved settings survive browser reload and invalid values do not change them',async({page,app})=>{
  await open(page,app);await saveNodes(page,300000);await page.reload();
  await page.getByRole('button',{name:'Settings',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Import settings'});
  await expect(dialog.getByLabel('Source node budget',{exact:true})).toHaveValue('300000');
  await dialog.getByLabel('Source node budget',{exact:true}).fill('1000001');await dialog.getByRole('button',{name:'Save settings'}).click();
  await expect(dialog).toBeVisible();const value=SettingsViewSchema.parse(await(await app.api('/api/import-settings')).json());expect(value.settings.maxNodes).toBe(300000);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
});

test('Korean settings use the same limits and workflow',async({page,app})=>{
  await open(page,app,'ko');await page.getByRole('button',{name:'설정',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'가져오기 설정'});
  await expect(dialog.getByLabel('이미지 배율',{exact:true})).toHaveValue('2');
  await expect(dialog.getByLabel('이미지 긴 변 (px)',{exact:true})).toHaveValue('4096');
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();await expect(page.getByRole('button',{name:'원본 추가',exact:true})).toBeVisible();
});

test('settings keep an unsaved choice after a conflict and can reopen then restore defaults', async ({ page, app }) => {
  await open(page, app);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import settings', exact: true });
  const value = dialog.getByLabel('Source node budget', { exact: true });
  await expect(value).toBeEnabled();
  const current = SettingsViewSchema.parse(await (await app.api('/api/import-settings')).json());
  const changed = await app.api('/api/import-settings', { expectedRevision: current.revision,
    settings: { ...current.settings, maxNodes: 300001 } });
  expect(changed.ok).toBe(true);
  await value.fill('250000');
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(value).toHaveValue('250000');
  expect(SettingsViewSchema.parse(await (await app.api('/api/import-settings')).json()).settings.maxNodes).toBe(300001);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(value).toHaveValue('300001');
  await dialog.getByRole('button', { name: 'Restore defaults', exact: true }).click();
  await expect(value).toHaveValue('200000');
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(SettingsViewSchema.parse(await (await app.api('/api/import-settings')).json()).settings.maxNodes).toBe(200000);
});
