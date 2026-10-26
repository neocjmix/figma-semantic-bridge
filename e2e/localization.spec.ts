import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, expect } from '@playwright/test';
import { startServer } from '../src/server/index.js';
import { createDemoProject } from '../src/demo/project.js';
import type { Project } from '../src/shared/contracts.js';

const test = base.extend<{ app: { url: string; token: string; project: Project; read(): Promise<Project> } }>({
  app: async ({}, use) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fsb-localization-'));
    const token = 'synthetic-localization-token-0123456789';
    const server = await startServer({ port: 0, token, dataDir, webDir: resolve(process.env.FSB_E2E_WEB_DIR ?? 'dist/web'), aiConfig: null });
    try {
      const seed = createDemoProject(); seed.snapshots[0]!.warnings.push('Original source diagnostic stays verbatim.');
      const project = await server.store.importProject(seed);
      await use({ url: server.url, token, project, read: () => server.store.get(project.id) });
    } finally { await server.close(); await rm(dataDir, { recursive: true, force: true }); }
  },
});

test('unpaired users can select and persist a language before entering a token', async ({ page, app }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'language', { value: 'ko-KR' }));
  await page.goto(app.url);
  const selector = page.getByLabel('Language / 언어', { exact: true });
  await expect(selector).toHaveValue('ko');
  await expect(page.getByRole('button', { name: '연결', exact: true })).toBeVisible();
  await page.getByLabel('연결 토큰', { exact: true }).fill('unsaved-token-input');
  await selector.selectOption('en');
  await expect(page.getByLabel('Pairing token', { exact: true })).toHaveValue('unsaved-token-input');
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fsb-locale'))).toBe('en');
  await page.reload();
  await expect(selector).toHaveValue('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('language changes preserve unsaved annotations and original sources, then save unchanged wire values', async ({ page, app }) => {
  await page.addInitScript(({ token, id }) => { sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', id); }, { token: app.token, id: app.project.id });
  await page.goto(app.url);
  await page.getByRole('button', { name: '+ Add region', exact: true }).click();
  const name = '고객 계정 — Billing name remains exact';
  await page.getByLabel('Component name', { exact: true }).fill(name);
  await page.getByLabel('Region width', { exact: true }).fill('123.4');
  const original = await app.read();
  await page.getByLabel('Language / 언어', { exact: true }).selectOption('ko');
  await expect(page.getByLabel('구성요소 이름', { exact: true })).toHaveValue(name);
  await expect(page.getByLabel('영역 너비', { exact: true })).toHaveValue('123.4');
  await expect(page.locator('.unsaved')).toContainText('저장하지 않은 변경');
  await expect(page.getByRole('status')).toHaveText('새 영역을 그렸습니다. 이름을 정한 뒤 주석을 저장하세요.');
  await page.locator('.scope-warning summary').click();
  await expect(page.locator('.scope-warning')).toContainText('Original source diagnostic stays verbatim.');
  expect(await app.read()).toEqual(original);
  await page.getByLabel('역할', { exact: true }).selectOption({ label: '구역' });
  await page.getByRole('button', { name: '주석 저장', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('주석을 저장했습니다. 원본 노드를 연결한 뒤 검토하세요.');
  const saved = await app.read();
  expect(saved.annotations.at(-1)).toMatchObject({ name, role: 'section', reviewStatus: 'proposed', origin: 'human', bbox: { width: 123.4 } });
  expect(saved.snapshots).toEqual(original.snapshots);
  await page.getByLabel('Language / 언어', { exact: true }).selectOption('en');
  await expect(page.getByRole('status')).toHaveText('Annotation saved. Match source nodes, then review it.');
  await expect(page.getByLabel('Component name', { exact: true })).toHaveValue(name);
  await page.getByRole('tab', { name: 'Specifications', exact: true }).click();
  await expect(page.locator('.text-nodes')).toContainText('When no members match, show an empty state and keep the active filters visible.');
  await page.reload();
  await page.locator('.component-list').getByRole('button', { name, exact: true }).click();
  await expect(page.getByLabel('Component name', { exact: true })).toHaveValue(name);
});

test('native locale wins initially and native events update live without echo or discarding draft input', async ({ page, app }) => {
  await page.addInitScript(() => {
    localStorage.setItem('fsb-locale', 'ko');
    Object.defineProperty(navigator, 'language', { value: 'ko-KR' });
    const host = window as Window & { __FSB_DESKTOP_LOCALE__?: string; localePosts?: unknown[]; webkit?: unknown };
    host.__FSB_DESKTOP_LOCALE__ = 'en'; host.localePosts = [];
    host.webkit = { messageHandlers: { fsbLocale: { postMessage: (value: unknown) => host.localePosts!.push(value) } } };
  });
  await page.goto(app.url);
  const selector = page.getByLabel('Language / 언어', { exact: true });
  await expect(selector).toHaveValue('en');
  await page.getByLabel('Pairing token', { exact: true }).fill('preserved-native-draft');
  await selector.selectOption('ko');
  expect(await page.evaluate(() => (window as Window & { localePosts?: unknown[] }).localePosts)).toEqual([{ locale: 'ko' }]);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fsb-locale-change', { detail: 'en' })));
  await expect(selector).toHaveValue('en');
  await expect(page.getByLabel('Pairing token', { exact: true })).toHaveValue('preserved-native-draft');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fsb-locale-change', { detail: 'fr' })));
  await expect(selector).toHaveValue('en');
  expect(await page.evaluate(() => (window as Window & { localePosts?: unknown[] }).localePosts)).toEqual([{ locale: 'ko' }]);
});

test('storage denial still permits session language changes and the narrow header stays accessible', async ({ page, app }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.addInitScript(({ token, id }) => {
    sessionStorage.setItem('fsb-token', token); sessionStorage.setItem('fsb-last-project', id);
    Object.defineProperty(navigator, 'language', { value: 'ko-KR' });
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage denied', 'SecurityError'); } });
  }, { token: app.token, id: app.project.id });
  await page.goto(app.url);
  const selector = page.getByLabel('Language / 언어', { exact: true });
  await expect(selector).toHaveValue('ko');
  await expect(page.getByRole('button', { name: '편집기 연결 해제', exact: true })).toBeVisible();
  for (const locale of ['ko', 'en']) {
    await selector.selectOption(locale);
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => { const box = document.querySelector(selector)!.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }; };
      return { brand: rect('.brand'), pill: rect('.local-pill'), language: rect('.language-selector'), connection: rect('.connection'), unpair: rect('.header-actions button'), width: innerWidth };
    });
    expect(layout.brand.right).toBeLessThanOrEqual(layout.pill.left);
    expect(layout.pill.right).toBeLessThanOrEqual(layout.language.left);
    expect(layout.language.right).toBeLessThanOrEqual(layout.connection.left);
    expect(layout.connection.right).toBeLessThanOrEqual(layout.unpair.left);
    expect(layout.unpair.right).toBeLessThanOrEqual(layout.width);
  }
  await expect(page.getByRole('button', { name: 'Save annotation', exact: true })).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(errors).toEqual([]);
});
