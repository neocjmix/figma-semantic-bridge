import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { sourceImportFixture } from '../tests/source-import-fixture.js';
import { translate, type Locale, type MessageKey } from '../web/locale.js';

type Fixture = Awaited<ReturnType<typeof sourceImportFixture>>;
const test = base.extend<{ app: Fixture }>({ app: async ({}, use) => {
  const app = await sourceImportFixture({ nodeCount: 12, webDir: resolve(process.env.FSB_E2E_WEB_DIR ?? 'dist/web') });
  try { await use(app); } finally { await app.close(); }
} });
const exactText = ' Exact 한글 👩‍💻\r\n source text ';
const word = (locale: Locale, key: string) => locale === 'en' ? key : translate(locale, key as MessageKey);
const button = (page: Page, locale: Locale, key: string) => page.getByRole('button', { name: word(locale, key), exact: true });

async function openAndImport(page: Page, app: Fixture, locale: Locale = 'en') {
  await page.addInitScript(({ token, id, locale }) => {
    sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', id);
    localStorage.setItem('fsb-locale', locale);
  }, { token: app.token, id: app.projectId, locale });
  await page.goto(app.url);
  await button(page, locale, 'Add source').click();
  await button(page, locale, 'Start import').click();
  await expect.poll(async () => (await app.readProject()).scopes?.[0]?.kind).toBe('collection');
  await expect(page.locator('.snapshot-list .snapshot-item')).toHaveCount(1);
}

async function region(page: Page, app: Fixture, locale: Locale = 'en', name = 'Reviewed card') {
  await button(page, locale, '+ Add region').click();
  await page.getByLabel(word(locale, 'Component name'), { exact: true }).fill(name);
  await page.getByText(word(locale, 'Region settings'), { exact: true }).click();
  for (const [field, value] of Object.entries({ x: -10, y: 20, width: 10, height: 10 })) {
    await page.getByLabel(word(locale, `Region ${field}`), { exact: true }).fill(String(value));
  }
  await button(page, locale, 'Save region').click();
  await expect.poll(async () => (await app.readProject()).annotations.find(value => value.name === name)?.sourceRefs.length ?? 0).toBeGreaterThan(0);
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await button(page, locale, 'Confirm sources').click();
  await button(page, locale, 'Approve region').click();
  await expect.poll(async () => (await app.readProject()).annotations.find(value => value.name === name)?.reviewStatus).toBe('approved');
}

async function beginSpecification(page: Page, locale: Locale) {
  await button(page, locale, 'Link specification').click();
  await page.getByText(word(locale, 'Choose original text'), { exact: true }).click();
  await button(page, locale, 'Use original text').click();
  await button(page, locale, 'Create specification').click();
  await expect(page.locator('.relation-list input[type=checkbox]').first()).toBeChecked();
}

async function diagnosticRecords(app: Fixture) {
  const contents = await readFile(resolve(app.directory, 'logs/server.ndjson'), 'utf8');
  return contents.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
}

test.afterEach(async ({ app }, testInfo) => {
  const records = await diagnosticRecords(app);
  const path = testInfo.outputPath('local-diagnostics.ndjson');
  await writeFile(path, records.map(value => JSON.stringify(value)).join('\n'));
  await testInfo.attach('local-diagnostics', { path, contentType: 'application/x-ndjson' });
});

for (const locale of ['en', 'ko'] as const) {
  test(`${locale}: normal import leads through region and exact specification approval to both share formats`, async ({ page, app }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await openAndImport(page, app, locale);
    await region(page, app, locale);
    await beginSpecification(page, locale);
    await button(page, locale, 'Save specification').click();
    await button(page, locale, 'Approve specification').click();
    await expect.poll(async () => (await app.readProject()).specifications[0]?.reviewStatus).toBe('approved');
    await button(page, locale, 'Share').click();
    const share = page.getByRole('dialog', { name: word(locale, 'Share approved work'), exact: true });
    await expect(share).toBeVisible();
    const jsonDownload = page.waitForEvent('download');
    await share.getByRole('button', { name: word(locale, 'Export JSON'), exact: true }).click();
    const jsonFile = await (await jsonDownload).path();
    const exported = JSON.parse(await readFile(jsonFile!, 'utf8'));
    expect(exported.annotations.map((value: { name: string }) => value.name)).toEqual(['Reviewed card']);
    expect(exported.specifications[0].text).toBe(exactText);
    expect(exported.specifications[0].relations).toHaveLength(1);
    const mdDownload = page.waitForEvent('download');
    await share.getByRole('button', { name: word(locale, 'Markdown'), exact: true }).click();
    const markdown = await readFile((await (await mdDownload).path())!, 'utf8');
    expect(markdown).toContain('Reviewed card');
    expect(markdown).toContain('source text');
    const saved = await app.readProject();
    expect(saved.snapshots).toEqual([]);
    expect(saved.scopes?.[0]?.kind).toBe('collection');
    await page.reload();
    await expect(page.locator('.component-list')).toContainText('Reviewed card');
    expect((await app.readProject()).specifications[0]?.text).toBe(exactText);
    expect((await app.readProject()).annotations[0]?.sourceReview?.status).toBe('confirmed');
    expect(pageErrors).toEqual([]);
    const unexpected = (await diagnosticRecords(app)).filter(value => value.level === 'error' && value.code !== 'CANCELLED');
    expect(unexpected).toEqual([]);
  });
}

test('collection-backed split, merge, delete and history retain recoverable region and source state', async ({ page, app }) => {
  await openAndImport(page, app);
  await region(page, app);
  const before = await app.readProject();
  await page.getByText('Split or remove region', { exact: true }).click();
  await button(page, 'en', 'Split vertically').click();
  await expect.poll(async () => (await app.readProject()).annotations.length).toBe(2);
  const split = await app.readProject();
  expect(split.annotations.every(value => value.reviewStatus === 'proposed' && value.sourceReview?.status !== 'confirmed')).toBe(true);
  expect(split.annotations.reduce((sum, value) => sum + value.bbox.width, 0)).toBe(before.annotations[0]!.bbox.width);
  await button(page, 'en', 'Undo').click();
  await expect.poll(async () => (await app.readProject()).annotations.length).toBe(1);
  expect((await app.readProject()).annotations[0]?.reviewStatus).toBe('approved');
  await button(page, 'en', 'Redo').click();
  await expect.poll(async () => (await app.readProject()).annotations.length).toBe(2);
  await button(page, 'en', 'Select regions to merge').click();
  for (const checkbox of await page.locator('.component-list input[type=checkbox]').all()) await checkbox.check();
  await button(page, 'en', 'Merge 2 selected').click();
  await expect.poll(async () => (await app.readProject()).annotations.length).toBe(1);
  expect((await app.readProject()).annotations[0]?.reviewStatus).toBe('proposed');
  await page.locator('.component-list button').first().click();
  await page.getByText('Split or remove region', { exact: true }).click();
  await button(page, 'en', 'Delete region').click();
  await expect.poll(async () => (await app.readProject()).annotations.length).toBe(0);
  await button(page, 'en', 'Undo').click();
  await expect.poll(async () => (await app.readProject()).annotations.length).toBe(1);
});

test('a specification draft stays intact while other edits and fresh specification creation are gated', async ({ page, app }) => {
  await openAndImport(page, app);
  await region(page, app);
  await beginSpecification(page, 'en');
  const before = await app.readProject();
  await expect(page.getByRole('tab', { name: 'Component', exact: true })).toBeDisabled();
  await expect(button(page, 'en', 'New specification')).toBeDisabled();
  await expect(button(page, 'en', 'Add source')).toBeDisabled();
  await expect(page.locator('.component-list input[type=checkbox]')).toBeHidden();
  await expect(page.locator('.component-list input[type=checkbox]')).toBeDisabled();
  expect((await app.readProject()).revision).toBe(before.revision);
  await expect(page.locator('.spec-text')).toContainText('Exact 한글 👩‍💻');
  await button(page, 'en', 'Save specification').click();
  await expect(page.getByRole('tab', { name: 'Component', exact: true })).toBeEnabled();
  await button(page, 'en', 'New specification').click();
  await expect(button(page, 'en', 'Create specification')).toBeDisabled();
  expect((await app.readProject()).specifications[0]?.text).toBe(exactText);
});

test('an invalid region keeps its draft and can be corrected then saved without losing the last approval', async ({ page, app }) => {
  await openAndImport(page, app);
  await region(page, app);
  const before = await app.readProject();
  await page.getByLabel('Component name', { exact: true }).fill('Corrected card');
  await page.getByLabel('Region x', { exact: true }).fill('-1000');
  const failure = page.waitForResponse(response => response.url().endsWith('/mutate') && response.status() === 400);
  await button(page, 'en', 'Save region').click();
  const requestId = (await failure).headers()['x-fsb-request-id'];
  expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByText('Error details', { exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(requestId!);
  await expect.poll(async () => (await diagnosticRecords(app)).some(value => value.event === 'http.error'
    && value.requestId === requestId && value.operation === 'upsert_annotation' && value.code === 'INVALID_PROJECT'
    && value.reason === 'Annotation lies outside its captured image bounds.')).toBe(true);
  await expect.poll(async () => (await diagnosticRecords(app)).some(value => value.event === 'http.complete'
    && value.requestId === requestId && value.status === 400)).toBe(true);
  await expect(page.getByLabel('Component name', { exact: true })).toHaveValue('Corrected card');
  expect((await app.readProject()).revision).toBe(before.revision);
  expect((await app.readProject()).annotations[0]?.reviewStatus).toBe('approved');
  await page.getByLabel('Region x', { exact: true }).fill('-10');
  await button(page, 'en', 'Save region').click();
  await expect.poll(async () => (await app.readProject()).annotations[0]?.name).toBe('Corrected card');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await app.readProject()).annotations[0]?.reviewStatus).toBe('proposed');
});

test('typing signed fractional coordinates preserves intermediate text and saves exact numbers', async ({ page, app }) => {
  await openAndImport(page, app);
  await region(page, app);
  const x = page.getByLabel('Region x', { exact: true });
  const shape = page.locator('.region.selected > rect').first();
  async function clearAndType(text: string) {
    await x.click();
    await x.press('ControlOrMeta+A');
    await x.press('Backspace');
    await x.pressSequentially(text, { delay: 30 });
  }
  await clearAndType('-780.25');
  await expect(x).toHaveValue('-780.25');
  await expect(shape).toHaveAttribute('x', '-780.25');
  expect((await app.readProject()).annotations[0]?.bbox.x).toBe(-10);
  await clearAndType('-');
  await expect(x).toHaveValue('-');
  await expect(shape).toHaveAttribute('x', '-780.25');
  await x.pressSequentially('.');
  await expect(x).toHaveValue('-.');
  await expect(shape).toHaveAttribute('x', '-780.25');
  await x.pressSequentially('125');
  await expect(x).toHaveValue('-.125');
  await expect(shape).toHaveAttribute('x', '-0.125');
  await clearAndType('-10.123456789');
  await expect(x).toHaveValue('-10.123456789');
  await button(page, 'en', 'Save region').click();
  await expect.poll(async () => (await app.readProject()).annotations[0]?.bbox.x).toBe(-10.123456789);
  await page.reload();
  await page.locator('.component-list').getByRole('button', { name: 'Reviewed card', exact: true }).click();
  await page.getByText('Region settings', { exact: true }).click();
  await expect(x).toHaveValue('-10.123456789');
});

test('saved specifications protect dirty relationships and support rejection, deletion and undo', async ({ page, app }) => {
  await openAndImport(page, app);
  await region(page, app);
  await beginSpecification(page, 'en');
  await button(page, 'en', 'Save specification').click();
  await button(page, 'en', 'Approve specification').click();
  await expect.poll(async () => (await app.readProject()).specifications[0]?.reviewStatus).toBe('approved');
  await page.locator('.component-link-options > summary').click();
  await page.locator('.relation-options > summary').click();
  await page.getByLabel('Relation to Reviewed card', { exact: true }).selectOption('constraint');
  await expect(button(page, 'en', 'Reject')).toBeDisabled();
  await expect(button(page, 'en', 'Approve specification')).toBeDisabled();
  expect((await app.readProject()).specifications[0]?.relations[0]?.relationType).toBe('describes');
  await button(page, 'en', 'Discard specification changes').click();
  await button(page, 'en', 'Reject').click();
  await expect.poll(async () => (await app.readProject()).specifications[0]?.reviewStatus).toBe('rejected');
  await button(page, 'en', 'Approve specification').click();
  await expect.poll(async () => (await app.readProject()).specifications[0]?.reviewStatus).toBe('approved');
  await button(page, 'en', 'Delete specification').click();
  await expect.poll(async () => (await app.readProject()).specifications.length).toBe(0);
  await button(page, 'en', 'Undo').click();
  await expect.poll(async () => (await app.readProject()).specifications[0]?.reviewStatus).toBe('approved');
  expect((await app.readProject()).specifications[0]?.text).toBe(exactText);
});

test('browser console and runtime failures are locally observable without source text or credentials', async ({ page, app }) => {
  await openAndImport(page, app);
  const secret = 'PRIVATE-SYNTHETIC-DIAGNOSTIC-SENTINEL-492016';
  await page.evaluate(value => {
    console.error(value, { sourceText: value }, new Error(value));
    window.dispatchEvent(new ErrorEvent('error', { message: value, error: new TypeError(value) }));
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error(value) }));
  }, secret);
  await expect.poll(async () => {
    const events = (await diagnosticRecords(app)).map(value => value.event);
    return ['web.console', 'web.error', 'web.unhandledrejection'].every(value => events.includes(value));
  }).toBe(true);
  const records = await diagnosticRecords(app), encoded = JSON.stringify(records);
  expect(records.find(value => value.event === 'web.console')).toMatchObject({ source: 'web', level: 'error', argumentCount: 3 });
  expect(records.find(value => value.event === 'web.console')?.frames).toEqual(expect.arrayContaining([
    expect.stringMatching(/^assets\/[^:]+:\d+:\d+$/),
  ]));
  expect(records.find(value => value.event === 'web.error')).toMatchObject({ errorType: 'TypeError', source: 'web' });
  expect(encoded).not.toContain(secret);
  expect(encoded).not.toContain(exactText);
  expect(encoded).not.toContain(app.token);
  expect(encoded).not.toContain(app.projectId);
});

test('dragging a different saved region cannot replace the current unsaved region', async ({ page, app }) => {
  await openAndImport(page, app);
  await region(page, app, 'en', 'First region');
  await button(page, 'en', '+ Add region').click();
  await page.getByLabel('Component name', { exact: true }).fill('Second region');
  const settings = page.locator('.region-settings');
  if (!await settings.evaluate(element => (element as HTMLDetailsElement).open)) await settings.locator(':scope > summary').click();
  for (const [field, value] of Object.entries({ x: 40, y: 40, width: 10, height: 10 })) {
    await page.getByLabel(`Region ${field}`, { exact: true }).fill(String(value));
  }
  await button(page, 'en', 'Save region').click();
  await expect.poll(async () => (await app.readProject()).annotations.length).toBe(2);
  await page.locator('.component-list').getByRole('button', { name: 'First region', exact: true }).click();
  await page.getByLabel('Component name', { exact: true }).fill('First region unsaved intent');
  const before = await app.readProject();
  const points = await page.getByRole('img', { name: 'Design canvas' }).evaluate(element => {
    const matrix = (element as SVGSVGElement).getScreenCTM()!;
    return [new DOMPoint(45, 45), new DOMPoint(55, 50)].map(point => {
      const mapped = point.matrixTransform(matrix); return { x: mapped.x, y: mapped.y };
    });
  });
  await page.mouse.move(points[0]!.x, points[0]!.y); await page.mouse.down();
  await page.mouse.move(points[1]!.x, points[1]!.y, { steps: 4 }); await page.mouse.up();
  await expect(page.getByLabel('Component name', { exact: true })).toHaveValue('First region unsaved intent');
  expect(await app.readProject()).toEqual(before);
  await button(page, 'en', 'Discard region changes').click();
  await expect(page.getByLabel('Component name', { exact: true })).toHaveValue('First region');
});

test('saved source names and image crops are local, and a manually chosen set survives later geometry edits', async ({ page, app }) => {
  await openAndImport(page, app);
  await region(page, app);
  await expect(page.getByRole('img', { name: 'Captured area: Annotated region', exact: true })).toBeVisible();
  await expect(page.locator('.source-references')).toContainText('Synthetic layer 0');
  const nativeReadCount = app.commands.length;
  const rows = page.locator('.source-references > div');
  while (await rows.count() > 1) await rows.last().getByRole('button', { name: 'Remove', exact: true }).click();
  await button(page, 'en', 'Save region').click();
  await expect.poll(async () => (await app.readProject()).annotations[0]?.sourceRefs.length).toBe(1);
  const selected = (await app.readProject()).annotations[0]!.sourceRefs;
  await page.getByLabel('Region x', { exact: true }).fill('-9');
  await page.getByLabel('Region width', { exact: true }).fill('9');
  await button(page, 'en', 'Save region').click();
  await expect.poll(async () => (await app.readProject()).annotations[0]?.bbox.x).toBe(-9);
  expect((await app.readProject()).annotations[0]!.sourceRefs).toEqual(selected);
  expect(app.commands.length).toBe(nativeReadCount);
});

test('sharing explains an empty result and retries a failed context read', async ({ page, app }) => {
  await openAndImport(page, app);
  await button(page, 'en', 'Share').click();
  let dialog = page.getByRole('dialog', { name: 'Share approved work', exact: true });
  await expect(dialog).toContainText('Approve a region to start sharing.');
  await expect(dialog.getByRole('button', { name: 'Export JSON', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await region(page, app);
  await page.route('**/api/projects/*/export', route => route.fulfill({ status: 503,
    json: { error: { code: 'TEMPORARY_FAILURE', message: 'Synthetic temporary failure' } } }), { times: 1 });
  await button(page, 'en', 'Share').click();
  dialog = page.getByRole('dialog', { name: 'Share approved work', exact: true });
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Export JSON', exact: true })).toBeEnabled();
  await expect(dialog).toContainText('1 regions and 0 specifications are ready to share.');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect((await app.readProject()).annotations[0]?.reviewStatus).toBe('approved');
});
