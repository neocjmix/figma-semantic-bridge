import { chromium } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startServer } from '../src/server/index.js';
import { createDemoProject } from '../src/demo/project.js';

// Reproducible documentation images from generated data only. No live Figma,
// existing projects, user profile or external network is used.
const dataDir = await mkdtemp(join(tmpdir(), 'fsb-guide-'));
const token = 'synthetic-guide-token-01234567890123456789';
const server = await startServer({ port: 0, token, dataDir, webDir: resolve('dist/web'), aiConfig: null });
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  let project = await server.store.importProject(createDemoProject());
  for (const [id, name, bbox] of [
    ['guide-table', 'Members table', { x: 320, y: 330, width: 720, height: 300 }],
    ['guide-search', 'Member search', { x: 320, y: 250, width: 480, height: 48 }],
  ] as const) {
    project = await server.store.mutate(project.id, project.revision, { type: 'upsert_annotation', annotation: {
      id, name, snapshotId: 'demo-ui', role: 'component', bbox, parentId: null,
      sourceRefs: [], origin: 'human', reviewStatus: 'proposed', revision: 0,
    } }, 'human');
    project = await server.store.mutate(project.id, project.revision, { type: 'match_annotation', id, tolerance: 0.5 }, 'human');
  }
  await mkdir('docs/images', { recursive: true });
  for (const locale of ['ko', 'en']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.route('**/*', route => new URL(route.request().url()).origin === server.url ? route.continue() : route.abort());
    await page.addInitScript(({ token, projectId, locale }) => {
      sessionStorage.setItem('fsb-token', token);
      sessionStorage.setItem('fsb-last-project', projectId);
      localStorage.setItem('fsb-locale', locale);
    }, { token, projectId: project.id, locale });
    await page.goto(server.url);
    await page.locator('.component-list').getByRole('button', { name: 'Members table', exact: true }).click();
    await page.locator('.source-review').waitFor();
    await page.screenshot({ path: `docs/images/workflow.${locale}.png` });
    await page.locator('.component-list').getByRole('button', { name: 'Member search', exact: true }).click();
    // Capture the actual review panel with readable controls, not the entire page
    // scaled down. Preserve the application's width and natural line wrapping.
    await page.locator('.source-review').screenshot({ path: `docs/images/source-review.${locale}.png` });
    await context.close();
  }
  console.log('Saved four synthetic guide screenshots in docs/images.');
} finally {
  await browser.close();
  await server.close();
  await rm(dataDir, { recursive: true, force: true });
}
