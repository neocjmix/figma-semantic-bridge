import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DATA_SCHEMA_VERSION, PRODUCT_VERSION, SERVICE_NAME } from '../src/shared/version.js';

test('release identity agrees across package metadata, lockfile and native compatibility policy', async () => {
  const [pkg, lock, native] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../package-lock.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../desktop/DesktopPolicy.swift', import.meta.url), 'utf8'),
  ]);
  assert.equal(PRODUCT_VERSION, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  for (const [field, expected] of Object.entries({ service: SERVICE_NAME, version: PRODUCT_VERSION, schemaVersion: DATA_SCHEMA_VERSION })) {
    assert.equal(native.match(new RegExp(`static let ${field} = "([^"]+)"`))?.[1], expected, `native ${field} must match the local service`);
  }
});

test('desktop runtime starts outside the checkout, serves packaged assets and never prints its token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fsb-desktop-runtime-'));
  const web = join(dir, 'web'); await mkdir(web); await writeFile(join(web, 'index.html'), '<!doctype html><title>Packaged application</title>');
  const probe = createServer(); await new Promise<void>(resolvePort => probe.listen(0, '127.0.0.1', resolvePort));
  const port = (probe.address() as { port: number }).port;
  const tlsProbe = createServer(); await new Promise<void>(resolvePort => tlsProbe.listen(0, '127.0.0.1', resolvePort));
  const tlsPort = (tlsProbe.address() as { port: number }).port;
  await Promise.all([new Promise<void>(done => probe.close(() => done())), new Promise<void>(done => tlsProbe.close(() => done()))]);
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: dir, FSB_DESKTOP: '1', FSB_PORT: String(port), FSB_DESKTOP_TLS_PORT: String(tlsPort), FSB_DATA_DIR: join(dir, 'data'), FSB_WEB_DIR: web };
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('src/server/cli.ts')], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += String(chunk); }); child.stderr.on('data', chunk => { stderr += String(chunk); });
  const exited = new Promise<void>(resolveExit => child.once('exit', () => resolveExit()));
  try {
    await new Promise<void>((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error('Desktop startup did not report readiness')), 10_000);
      const check = () => { if (stdout.includes('"event":"ready"')) { clearTimeout(timeout); resolveReady(); } };
      child.stdout.on('data', check); child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Desktop startup exited ${code}`)); });
      check();
    });
    const token = (await readFile(join(dir, 'data', 'pairing-token'), 'utf8')).trim();
    const ready = JSON.parse(stdout.trim());
    assert.deepEqual(ready, { event: 'ready', service: 'figma-semantic-bridge', version: PRODUCT_VERSION, url: `https://127.0.0.1:${tlsPort}` });
    assert.ok(!stdout.includes(token) && !stderr.includes(token));
    const ca = await readFile(join(dir, 'data', 'desktop-tls', 'cert.pem'));
    const pinnedFetch = (url: string, options: { headers?: Record<string, string> } = {}) => new Promise<{status: number; json: () => Promise<unknown>; text: () => Promise<string>}>((done, reject) => {
      httpsRequest(url, { ca, ...options, agent: false }, response => {
        let body = ''; response.on('data', part => { body += part; });
        response.on('end', () => done({ status: response.statusCode!, json: async () => JSON.parse(body), text: async () => body }));
      }).on('error', reject).end();
    });
    const headers = { Authorization: `Bearer ${token}` };
    const health = await pinnedFetch(`${ready.url}/api/health`, { headers });
    assert.deepEqual(await health.json(), { ok: true, service: 'figma-semantic-bridge', version: PRODUCT_VERSION, schemaVersion: '1.0.0' });
    assert.equal((await pinnedFetch(`${ready.url}/api/health`)).status, 401);
    assert.match(await (await pinnedFetch(ready.url)).text(), /Packaged application/);
    assert.equal((await (await pinnedFetch(`${ready.url}/api/ai/status`, { headers })).json() as {enabled: boolean}).enabled, false);
  } finally {
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 5_000);
    await exited; clearTimeout(force); await rm(dir, { recursive: true, force: true });
  }
});
