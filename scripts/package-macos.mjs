import { guideImageNames, loadGuideImages, upgradeAppendix } from './guide-assets.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { releaseWebAssets } from './release-web-assets.mjs';
import { renderOfflineGuide } from './render-offline-guide.mjs';
import { readProjectLicense } from './package-plugin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const { values } = parseArgs({ options: { 'skip-build': { type: 'boolean', default: false }, 'output-dir': { type: 'string' } } });
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build this alpha on macOS Apple Silicon.');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('A numeric release version is required.');
const version = pkg.version;
const projectLicense = await readProjectLicense(root, pkg);
const nodeVersion = '22.23.4';
const nodeArchive = `node-v${nodeVersion}-darwin-arm64.tar.gz`;
const nodeSha256 = 'c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428';
const cache = resolve('.bridge-local/release-cache');
const staging = resolve('dist/macos');
const releases = resolve(values['output-dir'] ?? 'dist/releases');
const app = join(staging, 'Figma Semantic Bridge.app');
const resources = join(app, 'Contents/Resources');
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
const exists = path => stat(path).then(() => true, () => false);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(cache, { recursive: true }); await mkdir(releases, { recursive: true });
// A rebuild replaces same-version artifacts. Never leave a successful report
// from an earlier build beside a new or partially assembled candidate.
const verification = join(releases, `figma-semantic-bridge-${version}-verification.json`);
await rm(verification, { force: true });
await rm(`${verification}.sha256`, { force: true });
if (!values['skip-build']) run('npm', ['run', 'build']);
run(process.execPath, ['scripts/package-plugin.mjs', '--output-dir', releases]);

const archivePath = join(cache, nodeArchive);
if (!await exists(archivePath)) {
  const response = await fetch(`https://nodejs.org/dist/v${nodeVersion}/${nodeArchive}`, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Node download failed: ${response.status}`);
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
}
if (sha(await readFile(archivePath)) !== nodeSha256) throw new Error('Official Node archive checksum mismatch.');
run('/usr/bin/tar', ['-xzf', archivePath, '-C', cache]);
const nodeRoot = join(cache, `node-v${nodeVersion}-darwin-arm64`);

// Only a known generated directory is replaced; never copy the checkout or user data.
await rm(staging, { recursive: true, force: true });
await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
await mkdir(join(resources, 'runtime'), { recursive: true });
await mkdir(join(resources, 'app'), { recursive: true });
await cp(join(nodeRoot, 'bin/node'), join(resources, 'runtime/node'));
await cp(join(nodeRoot, 'LICENSE'), join(resources, 'runtime/NODE-LICENSE'));
for (const name of ['server.mjs', 'mcp.mjs']) await cp(join(root, 'dist', name), join(resources, 'app', name));
await mkdir(join(resources, 'app/web/assets'), { recursive: true });
for (const name of await releaseWebAssets('dist/web')) await cp(join('dist/web', name), join(resources, 'app/web', name));
for (const name of ['package.json', 'package-lock.json']) await cp(name, join(resources, 'app', name));
run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: join(resources, 'app') });
await mkdir(join(resources, 'plugins/semantic-bridge'), { recursive: true });
for (const name of ['manifest.json', 'code.js']) await cp(join('plugins/semantic-bridge', name), join(resources, 'plugins/semantic-bridge', name));
await cp('docs/alpha-installation.md', join(resources, 'INSTALLATION.md'));
await cp('docs/alpha-installation.en.md', join(resources, 'INSTALLATION.en.md'));
await cp('README.md', join(resources, 'README.md'));
await cp('README.en.md', join(resources, 'README.en.md'));
await cp(join('docs/releases', `${version}.md`), join(resources, 'RELEASE-NOTES.md'));
if (projectLicense.bytes) await writeFile(join(resources, 'LICENSE'), projectLicense.bytes);

const guideImages = await loadGuideImages(root);
const upgradeMarkdown = await readFile('docs/upgrade-guide.md', 'utf8');
await mkdir(join(resources, 'docs/images'), { recursive: true });
await mkdir(join(resources, 'images'), { recursive: true });
for (const name of guideImageNames) {
  await cp(join('docs/images', name), join(resources, 'docs/images', name));
  await cp(join('docs/images', name), join(resources, 'images', name));
}
for (const file of ['acquisition-workflow.ko.md', 'acquisition-workflow.en.md', 'upgrade-guide.md']) await cp(join('docs', file), join(resources, 'docs', file));
for (const locale of ['ko', 'en']) {
  const setupFile = locale === 'ko' ? 'alpha-installation.md' : 'alpha-installation.en.md';
  const userFile = `user-guide.${locale}.md`;
  for (const file of [setupFile, userFile]) await cp(join('docs', file), join(resources, 'docs', file));
  await cp(join('docs', userFile), join(resources, `USER-GUIDE.${locale}.md`));
  for (const [kind, file] of [['setup', setupFile], ['user', userFile]]) {
    const title = `Figma Semantic Bridge ${version} — ${locale === 'ko' ? (kind === 'user' ? '사용 가이드' : '설치 안내') : (kind === 'user' ? 'User Guide' : 'Setup Guide')}`;
    const markdown = await readFile(join('docs', file), 'utf8');
    const appendix = kind === 'setup' ? upgradeAppendix(upgradeMarkdown, locale)
      : '\n\n---\n\n' + await readFile(`docs/acquisition-workflow.${locale}.md`, 'utf8');
    const html = renderOfflineGuide(title, markdown + appendix, { locale, kind, images: guideImages });
    await writeFile(join(resources, `${kind}-guide-${locale}.html`), html);
  }
}
// Retain the old setup filename for an earlier host's fallback without removing
// the explicit language-specific guides used by the bilingual application.
await cp(join(resources, 'setup-guide-ko.html'), join(resources, 'setup-guide.html'));

const dependencies = [];
async function packagesAt(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.name.startsWith('@')) { await packagesAt(path); continue; }
    const manifest = join(path, 'package.json');
    if (!await exists(manifest)) continue;
    const metadata = JSON.parse(await readFile(manifest, 'utf8'));
    dependencies.push({ name: metadata.name, version: metadata.version, license: metadata.license ?? 'SEE PACKAGE LICENSE' });
    if (await exists(join(path, 'node_modules'))) await packagesAt(join(path, 'node_modules'));
  }
}
await packagesAt(join(resources, 'app/node_modules'));
dependencies.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
await writeFile(join(resources, 'THIRD-PARTY-NOTICES.md'), `# Third-party notices\n\nNode.js ${nodeVersion}: see runtime/NODE-LICENSE (including bundled dependencies).\n\nProduction npm dependencies are included with their original license files in app/node_modules.\n\n${dependencies.map(d => `- ${d.name}@${d.version}: ${typeof d.license === 'string' ? d.license : JSON.stringify(d.license)}`).join('\n')}\n`);
await writeFile(join(resources, 'dependencies.json'), JSON.stringify(dependencies, null, 2) + '\n');

const swift = '/Library/Developer/CommandLineTools/usr/bin/swiftc';
const sdk = '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk';
const swiftSources = (await readdir('desktop')).filter(name => name.endsWith('.swift')).sort().map(name => join('desktop', name));
run(swift, ['-swift-version', '5', '-sdk', sdk, '-target', 'arm64-apple-macosx13.0', '-O', '-framework', 'AppKit', '-framework', 'WebKit', ...swiftSources, '-o', join(app, 'Contents/MacOS/FigmaSemanticBridge')]);
const iconTool = join(staging, 'create-icon'), iconSet = join(staging, 'Bridge.iconset');
run(swift, ['-sdk', sdk, '-target', 'arm64-apple-macosx13.0', '-O', '-framework', 'AppKit', 'scripts/create-app-icon.swift', '-o', iconTool]);
run(iconTool, [iconSet]);
run('/usr/bin/iconutil', ['-c', 'icns', iconSet, '-o', join(resources, 'AppIcon.icns')]);
await writeFile(join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.neocjmix.figma-semantic-bridge.desktop</string><key>CFBundleName</key><string>Figma Semantic Bridge</string><key>CFBundleDisplayName</key><string>Figma Semantic Bridge</string><key>CFBundleExecutable</key><string>FigmaSemanticBridge</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${version}</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>NSHighResolutionCapable</key><true/><key>NSLocalNetworkUsageDescription</key><string>Connect the Figma plugin to the authenticated bridge on this Mac.</string><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>`);

const plist = join(app, 'Contents/Info.plist');
for (const [locale, explanation] of [
  ['en', 'Connect to the Figma plugin on this Mac so you can read selected design areas.'],
  ['ko', '이 Mac의 Figma 플러그인에 연결해 선택한 디자인 영역을 불러옵니다.'],
]) {
  await mkdir(join(resources, `${locale}.lproj`));
  await writeFile(join(resources, `${locale}.lproj/InfoPlist.strings`), `"NSLocalNetworkUsageDescription" = "${explanation}";\n`);
}
run('/usr/libexec/PlistBuddy', ['-c', 'Add :CFBundleIconFile string AppIcon.icns', plist]);
run('/usr/libexec/PlistBuddy', ['-c', 'Add :CFBundleDevelopmentRegion string en', plist]);
run('/usr/libexec/PlistBuddy', ['-c', 'Add :CFBundleLocalizations array', plist]);
for (const [index, locale] of ['en', 'ko'].entries()) run('/usr/libexec/PlistBuddy', ['-c', `Add :CFBundleLocalizations:${index} string ${locale}`, plist]);
const revision = execFileSync('/Library/Developer/CommandLineTools/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = execFileSync('/Library/Developer/CommandLineTools/usr/bin/git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
const manifest = { product: 'figma-semantic-bridge', version, ...(projectLicense.license === undefined ? {} : { license: projectLicense.license }), channel: 'alpha', locales: ['ko', 'en'], platform: 'darwin', arch: 'arm64', minimumMacOS: '13.0', node: { version: nodeVersion, archive: nodeArchive, sha256: nodeSha256, source: `https://nodejs.org/dist/v${nodeVersion}/` }, sourceRevision: revision, sourceDirty: dirty, signing: 'ad-hoc', notarized: false, pluginDistribution: 'Figma Desktop local development import', builtAt: new Date().toISOString() };
await writeFile(join(resources, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
run('/usr/bin/codesign', ['--force', '--sign', '-', join(resources, 'runtime/node')]);
run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
const basename = `figma-semantic-bridge-${version}-macos-arm64`;
const zip = join(releases, `${basename}.zip`), dmg = join(releases, `${basename}.dmg`);
await rm(zip, { force: true });
run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
const disk = join(staging, 'disk-image'); await mkdir(disk);
await mkdir(join(disk, 'images'));
for (const name of guideImageNames) await cp(join('docs/images', name), join(disk, 'images', name));
await cp(app, join(disk, 'Figma Semantic Bridge.app'), { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', join(disk, 'Figma Semantic Bridge.app')]);
run('/bin/ln', ['-s', '/Applications', join(disk, 'Applications')]);
await cp('docs/alpha-installation.md', join(disk, 'INSTALLATION.md'));
await cp('docs/alpha-installation.en.md', join(disk, 'INSTALLATION.en.md'));
for (const locale of ['ko', 'en']) await cp(`docs/user-guide.${locale}.md`, join(disk, `USER-GUIDE.${locale}.md`));
run('/usr/bin/hdiutil', ['create', '-volname', `Figma Semantic Bridge ${version}`, '-srcfolder', disk, '-ov', '-format', 'UDZO', dmg]);
await writeFile(join(releases, `figma-semantic-bridge-${version}-release.json`), JSON.stringify(manifest, null, 2) + '\n');
await cp('docs/alpha-installation.md', join(releases, `figma-semantic-bridge-${version}-INSTALLATION.md`));
const assets = [zip, dmg, join(releases, `figma-semantic-bridge-plugin-${version}.zip`), join(releases, `figma-semantic-bridge-${version}-release.json`), join(releases, `figma-semantic-bridge-${version}-INSTALLATION.md`)];
for (const [source, suffix] of [['docs/alpha-installation.en.md', 'INSTALLATION.en.md'], ['docs/user-guide.ko.md', 'USER-GUIDE.ko.md'], ['docs/user-guide.en.md', 'USER-GUIDE.en.md']]) {
  const target = join(releases, `figma-semantic-bridge-${version}-${suffix}`);
  await cp(source, target); assets.push(target);
}
await writeFile(join(releases, 'SHA256SUMS'), (await Promise.all(assets.map(async path => `${sha(await readFile(path))}  ${path.split('/').at(-1)}`))).join('\n') + '\n');
console.log(`Packaged ${version} alpha: ${releases}. Ad-hoc signed; not notarized. Publication requires a clean, verified release commit.`);
