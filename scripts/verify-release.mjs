import { guideDocumentNames, guideImageNames, loadGuideImages, upgradeAppendix, userAppendix } from './guide-assets.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { releaseWebAssets } from './release-web-assets.mjs';
import { renderOfflineGuide } from './render-offline-guide.mjs';
import { readProjectLicense } from './package-plugin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); process.chdir(root);
const { values } = parseArgs({ options: { 'require-clean': { type: 'boolean', default: false }, 'release-dir': { type: 'string' } } });
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const releaseDir = resolve(values['release-dir'] ?? 'dist/releases');
const staging = await mkdtemp(join(tmpdir(), 'fsb-release-acceptance-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
const expectedNativeIdentity = { service: 'figma-semantic-bridge', version: pkg.version, schemaVersion: '1.0.0' };
function verifyNativeIdentity(application) {
  const plist = join(application, 'Contents/Info.plist');
  for (const [key, expected] of Object.entries({
    CFBundleIdentifier: 'com.neocjmix.figma-semantic-bridge.desktop',
    CFBundleExecutable: 'FigmaSemanticBridge',
    CFBundleShortVersionString: pkg.version,
    CFBundleVersion: pkg.version,
  })) {
    assert.equal(run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).trim(), expected, `Packaged ${key} does not match this release.`);
  }
  // --release-info exits before app state or networking. Retain --self-test as
  // a fallback for a stale 0.1.0 host: it then exits without opening its GUI,
  // and its non-JSON output fails this check. Current hosts prefer release-info.
  const identity = JSON.parse(run(join(application, 'Contents/MacOS/FigmaSemanticBridge'), ['--release-info', '--self-test'], { timeout: 10_000 }));
  assert.deepEqual(identity, expectedNativeIdentity, 'Packaged native host identity does not match this release.');
  return identity;
}
function verifyLicenseMetadata(metadata, projectLicense) {
  assert.equal(metadata.license, projectLicense.license, 'Packaged license metadata differs from package.json.');
  assert.equal(Object.hasOwn(metadata, 'license'), projectLicense.license !== undefined, 'Unselected license metadata must be omitted.');
}
async function verifyApplicationLicense(resources, projectLicense) {
  const bundled = await readProjectLicense(resources, pkg);
  assert.deepEqual(bundled.bytes, projectLicense.bytes, 'Packaged project LICENSE differs from the source.');
  const metadata = JSON.parse(await readFile(join(resources, 'app/package.json'), 'utf8'));
  assert.equal(metadata.name, pkg.name);
  assert.equal(metadata.version, pkg.version);
  verifyLicenseMetadata(metadata, projectLicense);
  const lock = JSON.parse(await readFile(join(resources, 'app/package-lock.json'), 'utf8'));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages?.['']?.version, pkg.version);
  verifyLicenseMetadata(lock.packages?.[''] ?? {}, projectLicense);
}
let child, exit, force, mounted = false;
const mountpoint = join(staging, 'dmg');
try {
  const projectLicense = await readProjectLicense(root, pkg);
  const checksumBytes = await readFile(join(releaseDir, 'SHA256SUMS'));
  const sums = checksumBytes.toString().trim().split('\n');
  const expectedAssets = [
    `figma-semantic-bridge-${pkg.version}-macos-arm64.zip`,
    `figma-semantic-bridge-${pkg.version}-macos-arm64.dmg`,
    `figma-semantic-bridge-plugin-${pkg.version}.zip`,
    `figma-semantic-bridge-${pkg.version}-release.json`,
    `figma-semantic-bridge-${pkg.version}-INSTALLATION.md`,
    `figma-semantic-bridge-${pkg.version}-INSTALLATION.en.md`,
    `figma-semantic-bridge-${pkg.version}-USER-GUIDE.ko.md`,
    `figma-semantic-bridge-${pkg.version}-USER-GUIDE.en.md`,
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
  verifyLicenseMetadata(publishedRelease, projectLicense);
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
  const pluginName = `figma-semantic-bridge-plugin-${pkg.version}`;
  const pluginZip = join(releaseDir, `${pluginName}.zip`);
  const pluginChecksumBytes = await readFile(`${pluginZip}.sha256`);
  assert.equal(pluginChecksumBytes.toString().trim(), `${assetSha256[`${pluginName}.zip`]}  ${pluginName}.zip`, 'Plugin ZIP checksum sidecar differs from the verified archive.');
  const expectedPluginFiles = ['README.md', 'README.en.md', 'README.ko.md', 'SHA256SUMS', 'THIRD_PARTY_NOTICES.txt',
    'code.js', 'manifest.json', 'release.json', ...guideDocumentNames.map(name => `docs/${name}`), ...guideImageNames.map(name => `docs/images/${name}`), ...(projectLicense.bytes ? ['LICENSE'] : [])];
  // List and read only allowlisted entries without extracting an archive path.
  // unzip independently checks ZIP structure and CRC; SHA checks bind every byte.
  assert.ok((await stat(pluginZip)).size <= 10_000_000, 'Plugin ZIP exceeds its bounded production package size.');
  run('/usr/bin/unzip', ['-t', pluginZip], { timeout: 10_000 });
  const pluginEntries = run('/usr/bin/unzip', ['-Z1', pluginZip], { timeout: 10_000 }).trim().split('\n');
  assert.deepEqual(pluginEntries.slice().sort(), expectedPluginFiles.map(name => `${pluginName}/${name}`).sort(), 'Plugin ZIP differs from its file allowlist.');
  const pluginFiles = new Map(expectedPluginFiles.map(name => [name, run('/usr/bin/unzip', ['-p', pluginZip, `${pluginName}/${name}`],
    { encoding: 'buffer', maxBuffer: 8_000_000, timeout: 10_000 })]));
  const pluginMetadata = JSON.parse(pluginFiles.get('release.json').toString());
  assert.equal(pluginMetadata.name, 'figma-semantic-bridge-plugin');
  assert.equal(pluginMetadata.version, pkg.version);
  assert.equal(pluginMetadata.channel, 'alpha');
  assert.equal(pluginMetadata.distribution, 'figma-desktop-development-import');
  assert.deepEqual(pluginMetadata.locales, ['ko', 'en']);
  verifyLicenseMetadata(pluginMetadata, projectLicense);
  assert.deepEqual(pluginFiles.get('LICENSE'), projectLicense.bytes, 'Plugin project LICENSE differs from the source.');
  const metadataFiles = expectedPluginFiles.filter(name => name !== 'release.json' && name !== 'SHA256SUMS');
  assert.deepEqual(Object.keys(pluginMetadata.files).sort(), metadataFiles.slice().sort(), 'Plugin file metadata is incomplete.');
  for (const name of metadataFiles) {
    assert.deepEqual(pluginMetadata.files[name], { bytes: pluginFiles.get(name).length, sha256: sha(pluginFiles.get(name)) }, `Plugin metadata mismatch: ${name}`);
  }
  const pluginSums = new Map();
  for (const line of pluginFiles.get('SHA256SUMS').toString().trim().split('\n')) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9._/-]+)$/.exec(line);
    assert.ok(match && expectedPluginFiles.includes(match[2]) && match[2] !== 'SHA256SUMS', 'Unexpected plugin checksum entry.');
    assert.ok(!pluginSums.has(match[2]), 'Duplicate plugin checksum entry.');
    assert.equal(sha(pluginFiles.get(match[2])), match[1], `Plugin checksum mismatch: ${match[2]}`);
    pluginSums.set(match[2], match[1]);
  }
  assert.deepEqual([...pluginSums.keys()].sort(), expectedPluginFiles.filter(name => name !== 'SHA256SUMS').sort(), 'Every plugin file needs a checksum.');
  const zip = join(releaseDir, `figma-semantic-bridge-${pkg.version}-macos-arm64.zip`);
  run('/usr/bin/ditto', ['-x', '-k', zip, staging]);
  const app = join(staging, 'Figma Semantic Bridge.app'), resources = join(app, 'Contents/Resources');
  const node = join(resources, 'runtime/node');
  const release = JSON.parse(await readFile(join(resources, 'release.json'), 'utf8'));
  assert.deepEqual(release, publishedRelease, 'Public release metadata must match the packaged application.');
  assert.equal(release.version, pkg.version); assert.equal(release.channel, 'alpha');
  assert.equal(release.platform, 'darwin'); assert.equal(release.arch, 'arm64');
  assert.deepEqual(release.locales, ['ko', 'en']);
  await verifyApplicationLicense(resources, projectLicense);
  for (const name of ['manifest.json', 'code.js']) assert.deepEqual(pluginFiles.get(name), await readFile(join(resources, 'plugins/semantic-bridge', name)), `Plugin ZIP and app differ: ${name}`);
  const guideImages = await loadGuideImages();
  const upgradeMarkdown = await readFile(join(resources, 'docs/upgrade-guide.md'), 'utf8');
  const releaseNotes = (await readFile(join('docs/releases', `${pkg.version}.md`), 'utf8')).replaceAll('(../local-diagnostics.md)', '(local-diagnostics.md)');
  assert.equal(await readFile(join(resources, 'RELEASE-NOTES.md'), 'utf8'), releaseNotes);
  const guideAssets = new Map([['RELEASE-NOTES.md', sha(releaseNotes)]]);
  for (const name of guideImageNames) {
    const content = await readFile(join(resources, 'docs/images', name));
    assert.deepEqual(content, await readFile(join('docs/images', name)));
    assert.deepEqual(content, pluginFiles.get(`docs/images/${name}`));
    assert.deepEqual(content, await readFile(join(resources, 'images', name)));
    guideAssets.set(`docs/images/${name}`, sha(content));
    guideAssets.set(`images/${name}`, sha(content));
  }
  for (const file of guideDocumentNames) {
    const content = await readFile(join(resources, 'docs', file));
    assert.equal(sha(content), sha(await readFile(join('docs', file))));
    assert.equal(sha(content), sha(pluginFiles.get(`docs/${file}`)));
    assert.equal(sha(content), sha(await readFile(join(resources, file))));
    guideAssets.set(`docs/${file}`, sha(content));
    guideAssets.set(file, sha(content));
  }
  for (const locale of release.locales) {
    const setupFile = locale === 'ko' ? 'alpha-installation.md' : 'alpha-installation.en.md';
    for (const [kind, file] of [['setup', setupFile], ['user', `user-guide.${locale}.md`]]) {
      const html = await readFile(join(resources, `${kind}-guide-${locale}.html`), 'utf8');
      assert.ok(Buffer.byteLength(html) <= 4_000_000, 'Offline guide exceeds native host limit.');
      assert.ok(html.includes(`<html lang="${locale}">`));
      assert.ok(!/<(?:script|iframe|a|link|object)\b/i.test(html), 'Offline guides must not fetch resources or execute scripts.');
      const markdown = await readFile(join(resources, 'docs', file), 'utf8');
      assert.equal(sha(markdown), sha(await readFile(join('docs', file))));
      assert.equal(sha(pluginFiles.get(`docs/${file}`)), sha(markdown), 'Plugin and app guides differ.');
      const title = `Figma Semantic Bridge ${pkg.version} — ${locale === 'ko' ? (kind === 'user' ? '사용 가이드' : '설치 안내') : (kind === 'user' ? 'User Guide' : 'Setup Guide')}`;
      const appendix = kind === 'setup' ? upgradeAppendix(upgradeMarkdown, locale)
        : userAppendix(await readFile(join(resources, `docs/acquisition-workflow.${locale}.md`), 'utf8'),
          await readFile(join(resources, `docs/user-scenarios.${locale}.md`), 'utf8'),
          await readFile(join(resources, 'docs/local-diagnostics.md'), 'utf8'), locale);
      assert.equal(html, renderOfflineGuide(title, markdown + appendix, { locale, kind, images: guideImages }), 'Offline HTML must render the packaged guide and its matching workflow, scenarios, diagnostics or update instructions.');
      const alias = kind === 'user' ? `USER-GUIDE.${locale}.md` : locale === 'ko' ? 'INSTALLATION.md' : 'INSTALLATION.en.md';
      assert.equal(sha(await readFile(join(resources, alias))), sha(markdown));
      assert.equal(sha(await readFile(join(releaseDir, `figma-semantic-bridge-${pkg.version}-${alias}`))), sha(markdown));
      guideAssets.set(`${kind}-guide-${locale}.html`, sha(html));
      guideAssets.set(`docs/${file}`, sha(markdown));
      guideAssets.set(alias, sha(markdown));
    }
  }
  assert.equal(run(node, ['--version']).trim(), `v${release.node.version}`);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const nativeIdentity = verifyNativeIdentity(app);
  await mkdir(mountpoint);
  run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountpoint, join(releaseDir, `figma-semantic-bridge-${pkg.version}-macos-arm64.dmg`)]);
  mounted = true;
  const diskApp = join(mountpoint, 'Figma Semantic Bridge.app');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', diskApp]);
  assert.deepEqual(verifyNativeIdentity(diskApp), nativeIdentity, 'DMG native host identity differs from the ZIP.');
  await verifyApplicationLicense(join(diskApp, 'Contents/Resources'), projectLicense);
  for (const name of ['manifest.json', 'code.js']) assert.deepEqual(pluginFiles.get(name), await readFile(join(diskApp, 'Contents/Resources/plugins/semantic-bridge', name)), `Plugin ZIP and DMG differ: ${name}`);
  assert.equal(sha(await readFile(join(diskApp, 'Contents/Resources/release.json'))), sha(await readFile(join(resources, 'release.json'))));
  for (const [name, hash] of guideAssets) assert.equal(sha(await readFile(join(diskApp, 'Contents/Resources', name))), hash, `DMG guide differs from ZIP: ${name}`);
  for (const alias of ['INSTALLATION.md', 'INSTALLATION.en.md', 'USER-GUIDE.ko.md', 'USER-GUIDE.en.md', ...guideDocumentNames]) {
    assert.equal(sha(await readFile(join(mountpoint, alias))), guideAssets.get(alias), `DMG root guide differs from app: ${alias}`);
  }
  assert.equal(run(join(diskApp, 'Contents/Resources/runtime/node'), ['--version']).trim(), `v${release.node.version}`);
  // No repository-local or user-owned sources may enter the application archive.
  const forbidden = new Set(['.bridge-local', '.fixture-local', '.git', 'pairing-token', 'desktop-tls', 'projects', '.env', '.npmrc']);
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
  await new Promise(resolvePort => probe.listen(0, '127.0.0.1', resolvePort));
  const tlsPort = probe.address().port; await new Promise(resolveClose => probe.close(resolveClose));
  const data = join(staging, 'test-data');
  const env = { PATH: '/usr/bin:/bin', HOME: staging, FSB_DESKTOP: '1', FSB_PORT: String(port), FSB_DESKTOP_TLS_PORT: String(tlsPort), FSB_DATA_DIR: data, FSB_WEB_DIR: join(resources, 'app/web') };
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
  const url = `https://127.0.0.1:${tlsPort}`;
  assert.equal(JSON.parse(stdout.trim()).url, url);
  const pin = await readFile(join(data, 'desktop-tls/pin.der'));
  const cert = new X509Certificate(pin);
  async function secureFetch(target, options = {}) {
    assert.equal(new URL(target).origin, url);
    return new Promise((resolveResponse, reject) => {
      const request = httpsRequest(target, { ...options, ca: cert.toString(), rejectUnauthorized: true, agent: false,
        checkServerIdentity: (host, peer) => peer.raw?.equals(pin) ? checkServerIdentity(host, peer) : new Error('Packaged peer pin mismatch'),
      }, response => {
        const chunks = []; let bytes = 0;
        response.on('data', chunk => { bytes += chunk.length; if (bytes > 20_000_000) request.destroy(new Error('Verification response too large')); else chunks.push(chunk); });
        response.on('error', reject);
        response.on('end', () => resolveResponse(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
      });
      request.setTimeout(25_000, () => request.destroy(new Error('Verification request timed out')));
      request.on('error', reject); request.end(options.body);
    });
  }
  async function api(path, body) {
    const response = await secureFetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, body === undefined ? 200 : path === '/api/demo' || path === '/api/capture-bundles/import' ? 201 : 200);
    return response.json();
  }
  const health = await api('/api/health');
  assert.equal(health.ok, true);
  for (const [key, expected] of Object.entries(nativeIdentity)) assert.equal(health[key], expected, `Packaged service ${key} does not match the native host.`);
  assert.equal((await secureFetch(url + '/api/health')).status, 401);
  assert.equal((await secureFetch(url + '/api/health', { headers: { Authorization: `Bearer ${token}`, Origin: 'https://untrusted.invalid' } })).status, 403);
  const webAssets = await releaseWebAssets(join(resources, 'app/web'));
  assert.deepEqual((await readdir(join(resources, 'app/web'))).sort(), ['assets', 'index.html']);
  assert.deepEqual((await readdir(join(resources, 'app/web/assets'))).sort(), webAssets.filter(name => name.startsWith('assets/')).map(name => name.slice(7)).sort());
  for (const name of webAssets) {
    const response = await secureFetch(`${url}/${name}`); assert.equal(response.status, 200);
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
  let mcpIdentity;
  try {
    await client.connect(transport);
    const serverVersion = client.getServerVersion();
    assert.equal(serverVersion?.name, 'figma-semantic-bridge', 'Packaged MCP server name does not match this release.');
    assert.equal(serverVersion?.version, pkg.version, 'Packaged MCP server version does not match this release.');
    mcpIdentity = { name: serverVersion.name, version: serverVersion.version };
    const tools = await client.listTools(); assert.ok(tools.tools.some(t => t.name === 'get_approved_context'));
    const result = await client.callTool({ name: 'list_projects', arguments: {} }); assert.ok(!result.isError);
    const approved = await client.callTool({ name: 'get_approved_context', arguments: { projectId: imported.id } }); assert.ok(!approved.isError);
  } finally { await client.close(); }
  // Do not attest to assets replaced while the runtime smoke check was running.
  assert.equal(sha(await readFile(join(releaseDir, 'SHA256SUMS'))), sha(checksumBytes), 'Release checksum list changed during verification.');
  assert.equal(sha(await readFile(`${pluginZip}.sha256`)), sha(pluginChecksumBytes), 'Plugin checksum sidecar changed during verification.');
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
    pluginArchiveFiles: pluginFiles.size, pluginChecksumFileSha256: sha(pluginChecksumBytes),
    projectLicense: { identifier: projectLicense.license ?? null, included: projectLicense.bytes !== undefined, sha256: projectLicense.bytes ? sha(projectLicense.bytes) : null },
    extractionOutsideCheckout: true, bundledNode: release.node.version, nativeIdentity, mcpIdentity, nativePlistVersionsVerified: true, bilingualOfflineGuides: true, locales: release.locales, adHocSignatureVerified: true, mountedDmgVerified: true, noAbsoluteAppSymlinks: true, noKnownPrivatePaths: true, webAssetAllowlistVerified: true, authenticatedHealth: true, untrustedOriginRejected: true, webAssetsServed: webAssets.length, demoPersistence: true, captureTransfer: true, bundledMcp: true, secretOutput: false, aiEnabled: false, nativeGuiAndFigma: 'Separate manual acceptance required' };
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
