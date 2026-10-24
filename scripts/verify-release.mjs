import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { releaseWebAssets } from './release-web-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); process.chdir(root);
const { values } = parseArgs({ options: { 'require-clean': { type: 'boolean', default: false } } });
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const releaseDir = resolve('dist/releases');
const staging = await mkdtemp(join(tmpdir(), 'fsb-release-acceptance-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let child, exit, force, mounted = false;
const mountpoint = join(staging, 'dmg');
try {
  const checksumBytes = await readFile(join(releaseDir, 'SHA256SUMS'));
  const sums = checksumBytes.toString().trim().split('\n');
  const expectedAssets = [
    `figma-semantic-bridge-${pkg.version}-macos-arm64.zip`,
    `figma-semantic-bridge-${pkg.version}-macos-arm64.dmg`,
    `figma-semantic-bridge-plugin-${pkg.version}.zip`,
    `figma-semantic-bridge-${pkg.version}-release.json`,
    `figma-semantic-bridge-${pkg.version}-INSTALLATION.md`,
  ];
  const assetSha256 = {};
  for (const line of sums) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9._-]+)$/.exec(line); assert.ok(match, 'Checksum lines must name flat release assets');
    assert.ok(expectedAssets.includes(match[2]), `Unexpected release asset: ${match[2]}`);
    assert.ok(!Object.hasOwn(assetSha256, match[2]), `Duplicate release asset: ${match[2]}`);
    const actual = sha(await readFile(join(releaseDir, match[2])));
    assert.equal(actual, match[1], `Checksum mismatch: ${match[2]}`);
    assetSha256[match[2]] = actual;
  }
  assert.deepEqual(Object.keys(assetSha256).sort(), expectedAssets.sort(), 'Every required release asset needs a checksum.');
  const publishedRelease = JSON.parse(await readFile(join(releaseDir, `figma-semantic-bridge-${pkg.version}-release.json`), 'utf8'));
  assert.match(publishedRelease.sourceRevision, /^[a-f0-9]{40}$/);
  assert.equal(typeof publishedRelease.sourceDirty, 'boolean');
  const git = '/Library/Developer/CommandLineTools/usr/bin/git';
  let currentSourceRevision = run(git, ['rev-parse', 'HEAD']).trim();
  let currentSourceDirty = run(git, ['status', '--porcelain']).trim().length > 0;
  if (values['require-clean']) {
    assert.equal(publishedRelease.sourceDirty, false, 'Release was built from a dirty source tree; rebuild from the release commit.');
    assert.equal(currentSourceDirty, false, 'Current source tree must be clean for final release verification.');
    assert.equal(publishedRelease.sourceRevision, currentSourceRevision, 'Release source revision must match the current Git HEAD.');
  }
  const zip = join(releaseDir, `figma-semantic-bridge-${pkg.version}-macos-arm64.zip`);
  run('/usr/bin/ditto', ['-x', '-k', zip, staging]);
  const app = join(staging, 'Figma Semantic Bridge.app'), resources = join(app, 'Contents/Resources');
  const node = join(resources, 'runtime/node');
  const release = JSON.parse(await readFile(join(resources, 'release.json'), 'utf8'));
  assert.deepEqual(release, publishedRelease, 'Public release metadata must match the packaged application.');
  assert.equal(release.version, pkg.version); assert.equal(release.channel, 'alpha');
  assert.equal(release.platform, 'darwin'); assert.equal(release.arch, 'arm64');
  assert.equal(run(node, ['--version']).trim(), `v${release.node.version}`);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  await mkdir(mountpoint);
  run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountpoint, join(releaseDir, `figma-semantic-bridge-${pkg.version}-macos-arm64.dmg`)]);
  mounted = true;
  const diskApp = join(mountpoint, 'Figma Semantic Bridge.app');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', diskApp]);
  assert.equal(sha(await readFile(join(diskApp, 'Contents/Resources/release.json'))), sha(await readFile(join(resources, 'release.json'))));
  assert.equal(run(join(diskApp, 'Contents/Resources/runtime/node'), ['--version']).trim(), `v${release.node.version}`);
  // No repository-local or user-owned sources may enter the application archive.
  const forbidden = new Set(['.bridge-local', '.fixture-local', '.git', 'pairing-token', 'projects', '.env', '.npmrc']);
  async function inspect(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      assert.ok(!forbidden.has(entry.name), `Private content path in app: ${entry.name}`);
      if (entry.isSymbolicLink()) assert.ok(!(await readlink(join(path, entry.name))).startsWith('/'), 'Application contains an absolute symlink');
      if (entry.isDirectory()) await inspect(join(path, entry.name));
    }
  }
  await inspect(app);
  await inspect(diskApp);
  const appDependency = JSON.parse(await readFile(join(resources, 'app/node_modules/zod/package.json'), 'utf8'));
  assert.ok(appDependency.version); assert.ok((await stat(join(resources, 'THIRD-PARTY-NOTICES.md'))).size > 0);
  const probe = createServer(); await new Promise(resolvePort => probe.listen(0, '127.0.0.1', resolvePort));
  const port = probe.address().port; await new Promise(resolveClose => probe.close(resolveClose));
  const data = join(staging, 'test-data');
  const env = { PATH: '/usr/bin:/bin', HOME: staging, FSB_DESKTOP: '1', FSB_PORT: String(port), FSB_DATA_DIR: data, FSB_WEB_DIR: join(resources, 'app/web') };
  child = spawn(node, [join(resources, 'app/server.mjs')], { cwd: tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  exit = new Promise(resolveExit => child.once('exit', resolveExit));
  let stdout = '', stderr = ''; child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Packaged server startup timeout')), 10_000);
    child.stdout.on('data', () => { if (stdout.includes('"event":"ready"')) { clearTimeout(timer); resolveReady(); } });
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Packaged runtime exited ${code}: ${stderr}`)); });
  });
  const token = (await readFile(join(data, 'pairing-token'), 'utf8')).trim();
  assert.ok(!stdout.includes(token) && !stderr.includes(token), 'Packaged runtime leaked pairing token');
  const url = `http://127.0.0.1:${port}`;
  async function api(path, body) {
    const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, body === undefined ? 200 : path === '/api/demo' || path === '/api/capture-bundles/import' ? 201 : 200);
    return response.json();
  }
  const health = await api('/api/health'); assert.equal(health.version, pkg.version); assert.equal(health.service, 'figma-semantic-bridge');
  assert.equal((await fetch(url + '/api/health')).status, 401);
  assert.equal((await fetch(url + '/api/health', { headers: { Authorization: `Bearer ${token}`, Origin: 'https://untrusted.invalid' } })).status, 403);
  const webAssets = await releaseWebAssets(join(resources, 'app/web'));
  assert.deepEqual((await readdir(join(resources, 'app/web'))).sort(), ['assets', 'index.html']);
  assert.deepEqual((await readdir(join(resources, 'app/web/assets'))).sort(), webAssets.filter(name => name.startsWith('assets/')).map(name => name.slice(7)).sort());
  for (const name of webAssets) {
    const response = await fetch(`${url}/${name}`); assert.equal(response.status, 200);
    const mime = name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
    assert.ok(response.headers.get('content-type')?.startsWith(mime));
    assert.equal(sha(Buffer.from(await response.arrayBuffer())), sha(await readFile(join(resources, 'app/web', name))));
  }
  assert.equal((await api('/api/ai/status')).enabled, false);
  const project = await api('/api/demo', {});
  const persisted = await api(`/api/projects/${project.id}`); assert.deepEqual(persisted, project);
  const bundle = await api(`/api/projects/${project.id}/capture-bundle`, { expectedRevision: project.revision, snapshotIds: project.snapshots.slice(0, 2).map(s => s.id) });
  const imported = await api('/api/capture-bundles/import', { bundle, name: 'Packaged offline import' });
  assert.deepEqual(imported.snapshots, project.snapshots.slice(0, 2)); assert.equal(imported.annotations.length, 0);
  const transport = new StdioClientTransport({ command: node, args: [join(resources, 'app/mcp.mjs')], env: { ...env, FSB_SERVER_URL: url }, stderr: 'pipe' });
  const client = new Client({ name: 'release-acceptance', version: pkg.version });
  try {
    await client.connect(transport);
    const tools = await client.listTools(); assert.ok(tools.tools.some(t => t.name === 'get_approved_context'));
    const result = await client.callTool({ name: 'list_projects', arguments: {} }); assert.ok(!result.isError);
    const approved = await client.callTool({ name: 'get_approved_context', arguments: { projectId: imported.id } }); assert.ok(!approved.isError);
  } finally { await client.close(); }
  // Do not attest to assets replaced while the runtime smoke check was running.
  assert.equal(sha(await readFile(join(releaseDir, 'SHA256SUMS'))), sha(checksumBytes), 'Release checksum list changed during verification.');
  for (const [name, digest] of Object.entries(assetSha256)) {
    assert.equal(sha(await readFile(join(releaseDir, name))), digest, `Release asset changed during verification: ${name}`);
  }
  currentSourceRevision = run(git, ['rev-parse', 'HEAD']).trim();
  currentSourceDirty = run(git, ['status', '--porcelain']).trim().length > 0;
  if (values['require-clean']) {
    assert.equal(currentSourceDirty, false, 'Source tree changed during final release verification.');
    assert.equal(release.sourceRevision, currentSourceRevision, 'Git HEAD changed during final release verification.');
  }
  const report = { version: pkg.version, checkedAt: new Date().toISOString(), requireClean: values['require-clean'],
    sourceRevision: release.sourceRevision, sourceDirty: release.sourceDirty, currentSourceRevision, currentSourceDirty,
    assetSha256, checksumsFileSha256: sha(checksumBytes), artifactChecksums: sums.length,
    extractionOutsideCheckout: true, bundledNode: release.node.version, adHocSignatureVerified: true, mountedDmgVerified: true, noAbsoluteAppSymlinks: true, noKnownPrivatePaths: true, webAssetAllowlistVerified: true, authenticatedHealth: true, untrustedOriginRejected: true, webAssetsServed: webAssets.length, demoPersistence: true, captureTransfer: true, bundledMcp: true, secretOutput: false, aiEnabled: false, nativeGuiAndFigma: 'Separate manual acceptance required' };
  const reportName = `figma-semantic-bridge-${pkg.version}-verification.json`;
  const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(releaseDir, reportName), reportBytes);
  // The report binds the checked assets; its own digest stays separate to avoid
  // a SHA256SUMS -> report -> SHA256SUMS cycle.
  await writeFile(join(releaseDir, `${reportName}.sha256`), `${sha(reportBytes)}  ${reportName}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (child) { child.kill('SIGTERM'); force = setTimeout(() => child.kill('SIGKILL'), 5_000); await exit; clearTimeout(force); }
  if (mounted) run('/usr/bin/hdiutil', ['detach', mountpoint]);
  await rm(staging, { recursive: true, force: true });
}
