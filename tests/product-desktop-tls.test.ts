import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createTlsServer, request } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ensureDesktopTls } from '../src/server/desktop-tls.js';
import { startServer } from '../src/server/index.js';

const temporary = () => mkdtemp(join(process.env.FSB_SECURITY_TEST_TMP ?? tmpdir(), 'fsb-desktop-tls-'));
const tlsRead = (url: string, ca: string, headers: Record<string, string> = {}) => new Promise<{status: number; text: string}>((done, reject) => {
  request(url, { ca, headers, agent: false, checkServerIdentity: (_host, certificate) => checkServerIdentity('127.0.0.1', certificate) }, response => { let text = ''; response.on('data', part => { text += part; }); response.on('end', () => done({ status: response.statusCode!, text })); }).on('error', reject).end();
});

test('desktop TLS identity is private, persistent and fails closed on unsafe or partial state', async () => {
  const dir = await temporary();
  try {
    const first = await ensureDesktopTls(dir), second = await ensureDesktopTls(dir);
    assert.deepEqual(first, second);
    assert.equal((await stat(join(dir, 'desktop-tls'))).mode & 0o777, 0o700);
    for (const name of ['key.pem', 'cert.pem', 'pin.der']) assert.equal((await stat(join(dir, 'desktop-tls', name))).mode & 0o777, 0o600);
    await chmod(join(dir, 'desktop-tls', 'pin.der'), 0o644); await assert.rejects(ensureDesktopTls(dir));
    await chmod(join(dir, 'desktop-tls', 'pin.der'), 0o600);
    await rm(join(dir, 'desktop-tls', 'pin.der')); await assert.rejects(ensureDesktopTls(dir));
    await symlink(join(dir, 'desktop-tls', 'cert.pem'), join(dir, 'desktop-tls', 'pin.der')); await assert.rejects(ensureDesktopTls(dir));
    await rm(join(dir, 'desktop-tls', 'pin.der')); await writeFile(join(dir, 'desktop-tls', 'pin.der'), 'invalid', { mode: 0o600 }); await assert.rejects(ensureDesktopTls(dir));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('dedicated TLS listener preserves authenticated API/static behavior and rejects cross-port origins', async () => {
  const dir = await temporary(); await mkdir(join(dir, 'web')); await writeFile(join(dir, 'web/index.html'), '<!doctype html><title>TLS workspace</title>');
  const server = await startServer({ dataDir: dir, webDir: join(dir, 'web'), port: 0, desktopTlsPort: 0 });
  try {
    const { cert } = await ensureDesktopTls(dir), origin = server.desktopUrl!;
    assert.match(origin, /^https:\/\/127\.0\.0\.1:/);
    assert.equal((await tlsRead(`${origin}/api/health`, cert)).status, 401);
    const headers = { Authorization: `Bearer ${server.token}`, Origin: origin };
    assert.equal((await tlsRead(`${origin}/api/health`, cert, headers)).status, 200);
    assert.match((await tlsRead(origin, cert)).text, /TLS workspace/);
    assert.equal((await tlsRead(`${origin}/api/health`, cert, { ...headers, Origin: server.url })).status, 403);
    assert.equal((await tlsRead(`${origin}/api/health`, cert, { ...headers, Host: new URL(origin).host.replace('127.0.0.1', 'localhost') })).status, 403);
    assert.equal((await fetch(`${server.url}/api/health`, { headers: { ...headers, Origin: origin } })).status, 403);
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('actual Swift URLSession/WebKit reject wrong pins and peer replacement before credential or bootstrap delivery', { skip: process.platform !== 'darwin', timeout: 90_000 }, async () => {
  const dir = await temporary(), legitimate = join(dir, 'legitimate'), hostile = join(dir, 'hostile');
  await mkdir(legitimate, { mode: 0o700 }); await mkdir(hostile, { mode: 0o700 });
  const identity = await ensureDesktopTls(legitimate), other = await ensureDesktopTls(hostile), binary = join(dir, 'trust-check');
  const compiler = '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc';
  const sdk = '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk';
  const run = (program: string, args: string[]) => new Promise<{code: number | null; output: string}>((done, reject) => {
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    child.once('error', reject); child.once('exit', code => done({ code, output }));
  });
  let hits: Array<{path: string; authorization: string | undefined}> = [], delayAssets = false;
  const listener = (material: typeof identity) => createTlsServer(material, (req, res) => {
    hits.push({ path: req.url!, authorization: req.headers.authorization });
    res.setHeader('Connection', 'close');
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(delayAssets ? "<!doctype html><script>window.webkit.messageHandlers.ready.postMessage('ready')</script>" : "<!doctype html><script src='/asset.js'></script>"); }
    else if (req.url === '/asset.js') { res.setHeader('Content-Type', 'application/javascript'); res.end("fetch('/api/wk',{headers:{Authorization:'Bearer '+sessionStorage.getItem('fsb-token')}}).then(()=>window.webkit.messageHandlers.done.postMessage('ok'));"); }
    else res.end('{}');
  });
  const listen = (server: ReturnType<typeof listener>, port = 0) => new Promise<number>((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => done((server.address() as {port: number}).port)); });
  const close = (server: ReturnType<typeof listener>) => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); });
  let server = listener(identity);
  try {
    const compiled = await run(compiler, ['-sdk', sdk, '-target', 'arm64-apple-macosx13.0', '-parse-as-library', '-framework', 'AppKit', '-framework', 'WebKit', 'desktop/DesktopPolicy.swift', 'desktop/DesktopTrust.swift', 'scripts/desktop-trust-check.swift', '-o', binary]);
    assert.equal(compiled.code, 0, compiled.output);
    const port = await listen(server);
    let result = await run(binary, ['workspace', legitimate, String(port)]);
    assert.equal(result.code, 0, result.output); assert.match(result.output, /WORKSPACE_ACCEPTED/);
    assert.ok(hits.some(hit => hit.path === '/api/health' && hit.authorization === 'Bearer synthetic-native-trust-token'));
    assert.ok(hits.some(hit => hit.path === '/api/wk' && hit.authorization === 'Bearer synthetic-native-trust-token'));
    assert.ok(hits.some(hit => hit.path === '/asset.js'));
    hits = []; result = await run(binary, ['probe', hostile, String(port)]);
    assert.match(result.output, /PROBE_REJECTED/); assert.equal(hits.length, 0);
    const child = spawn(binary, ['replace', legitimate, String(port)], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', stderr = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { stderr += data; });
    const exited = new Promise<void>(done => child.once('exit', () => done()));
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Native replacement probe did not become ready')); }, 10_000);
      child.stdout.on('data', () => { if (output.includes('REPLACE_NOW')) { clearTimeout(timer); done(); } });
    });
    await close(server); server = listener(other); hits = []; await listen(server, port); child.stdin.write('x');
    await exited; assert.match(output, /WORKSPACE_REJECTED/, stderr); assert.equal(hits.length, 0, 'replacement listener must receive neither credentials nor HTML/bootstrap traffic');
    await close(server); server = listener(identity); delayAssets = true; hits = []; await listen(server, port);
    const assetChild = spawn(binary, ['workspace', legitimate, String(port)], { stdio: ['pipe', 'pipe', 'pipe'] });
    let assetOutput = ''; assetChild.stdout.on('data', data => { assetOutput += data; });
    const assetExited = new Promise<void>(done => assetChild.once('exit', () => done()));
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => { assetChild.kill(); reject(new Error('Native page did not load before asset replacement')); }, 10_000);
      assetChild.stdout.on('data', () => { if (assetOutput.includes('REPLACE_ASSETS_NOW')) { clearTimeout(timer); done(); } });
    });
    assert.ok(hits.some(hit => hit.path === '/')); assert.ok(!hits.some(hit => hit.path === '/asset.js'));
    await close(server); server = listener(other); hits = []; await listen(server, port); assetChild.stdin.write('x');
    await assetExited; assert.match(assetOutput, /WORKSPACE_REJECTED/); assert.equal(hits.length, 0, 'post-document replacement must receive neither asset nor API traffic');
  } finally { await close(server); await rm(dir, { recursive: true, force: true }); }
});
