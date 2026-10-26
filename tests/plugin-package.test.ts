import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const guideImageNames = ['workflow.ko.png', 'workflow.en.png', 'source-review.ko.png', 'source-review.en.png'];
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const moduleUrl = pathToFileURL(resolve('scripts/package-plugin.mjs')).href;

// Read the uncompressed ZIP's local entries; central-directory and CRC validation
// are also checked with an independent unzip tool when producing a release.
function entries(bytes: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0);
    assert.equal(bytes.readUInt16LE(offset + 6) & 8, 0);
    const size = bytes.readUInt32LE(offset + 18), nameSize = bytes.readUInt16LE(offset + 26), extraSize = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameSize).toString();
    const start = offset + 30 + nameSize + extraSize;
    assert.ok(!result.has(name)); result.set(name, bytes.subarray(start, start + size));
    offset = start + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.equal(bytes.readUInt16LE(bytes.length - 12), result.size);
  return result;
}

async function preparedPlugin(directory: string) {
  await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  await mkdir(join(directory, 'docs'));
  for (const file of ['user-guide.ko.md', 'user-guide.en.md', 'alpha-installation.md', 'alpha-installation.en.md', 'acquisition-workflow.ko.md', 'acquisition-workflow.en.md', 'upgrade-guide.md']) {
    await writeFile(join(directory, 'docs', file), await readFile(join('docs', file)));
  }
  await mkdir(join(directory, 'docs/images'));
  for (const name of guideImageNames) await writeFile(join(directory, 'docs/images', name), await readFile(join('docs/images', name)));
  for(const dependency of ['zod','@noble/hashes','@noble/ciphers']) {
    await mkdir(join(directory, 'node_modules',dependency), { recursive: true });
    for (const file of ['package.json', 'LICENSE']) {
      await writeFile(join(directory, 'node_modules',dependency, file), await readFile(join('node_modules',dependency, file)));
    }
  }
  const pluginDir = join(directory, 'plugin'); await mkdir(pluginDir);
  const manifest = await readFile('plugins/semantic-bridge/manifest.json');
  // Build production entrypoints into memory, without sharing generated files
  // with the other bundled-plugin tests running in parallel.
  const ui = buildSync({ entryPoints: ['plugins/semantic-bridge/ui.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020' });
  const html = (await readFile('plugins/semantic-bridge/ui.template.html', 'utf8')).replace('<!-- BRIDGE_SCRIPT -->', () => `<script>${ui.outputFiles[0]!.text.replaceAll('</script', '<\\/script')}</script>`);
  const code = buildSync({ entryPoints: ['plugins/semantic-bridge/code.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2018', define: { __html__: JSON.stringify(html) } }).outputFiles[0]!.contents;
  await writeFile(join(pluginDir, 'manifest.json'), manifest); await writeFile(join(pluginDir, 'code.js'), code);
  return { pluginDir, manifest, code };
}

test('plugin release ZIP contains only the approved prebuilt files and verifiable integrity metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fsb-plugin-package-'));
  try {
    const { packagePlugin } = await import(moduleUrl);
    const source = await preparedPlugin(directory);
    await writeFile(join(source.pluginDir, '.env'), 'PRIVATE_SENTINEL');
    await writeFile(join(source.pluginDir, 'private-capture.json'), 'PRIVATE_SENTINEL');
    const outputDir = join(directory, 'release');
    const result = await packagePlugin({ projectDir: directory, version: '0.1.0', outputDir, pluginDir: source.pluginDir });
    const zip = await readFile(result.zipPath), files = entries(zip);
    const prefix = 'figma-semantic-bridge-plugin-0.1.0/';
    assert.deepEqual([...files.keys()].sort(), ['README.md', 'README.en.md', 'README.ko.md', 'SHA256SUMS', 'THIRD_PARTY_NOTICES.txt', 'code.js', 'manifest.json', 'release.json', 'docs/user-guide.ko.md', 'docs/user-guide.en.md', 'docs/alpha-installation.md', 'docs/alpha-installation.en.md', 'docs/acquisition-workflow.ko.md', 'docs/acquisition-workflow.en.md', 'docs/upgrade-guide.md', ...guideImageNames.map(name => `docs/images/${name}`)].map(name => prefix + name).sort());
    assert.deepEqual(files.get(prefix + 'manifest.json'), source.manifest);
    assert.deepEqual(files.get(prefix + 'code.js'), Buffer.from(source.code));
    assert.match(files.get(prefix+'THIRD_PARTY_NOTICES.txt')!.toString(),/Bundled dependency: @noble\/hashes/);
    assert.match(files.get(prefix+'THIRD_PARTY_NOTICES.txt')!.toString(),/Bundled dependency: @noble\/ciphers/);
    assert.equal(zip.includes(Buffer.from('PRIVATE_SENTINEL')), false);
    assert.equal((await readFile(result.checksumPath, 'utf8')).trim(), `${sha(zip)}  figma-semantic-bridge-plugin-0.1.0.zip`);
    const metadata = JSON.parse(files.get(prefix + 'release.json')!.toString());
    assert.equal(metadata.version, '0.1.0');
    assert.equal(metadata.distribution, 'figma-desktop-development-import');
    assert.equal(metadata.channel, 'alpha');
    assert.deepEqual(metadata.locales, ['ko', 'en']);
    assert.equal(Object.hasOwn(metadata, 'license'), false);
    assert.match(files.get(prefix + 'README.md')!.toString(), /Project licensing has not been selected/);
    assert.match(files.get(prefix + 'README.ko.md')!.toString(), /프로젝트 라이선스는 아직 선택되지 않았습니다/);
    for (const locale of ['ko', 'en']) {
      assert.deepEqual(files.get(prefix + `docs/user-guide.${locale}.md`), await readFile(`docs/user-guide.${locale}.md`));
    }
    for (const [name, info] of Object.entries(metadata.files) as [string, { sha256: string; bytes: number }][]) {
      assert.equal(sha(files.get(prefix + name)!), info.sha256);
      assert.equal(files.get(prefix + name)!.length, info.bytes);
    }
    for (const line of files.get(prefix + 'SHA256SUMS')!.toString().trim().split('\n')) {
      const [digest, name] = line.split('  '); assert.equal(sha(files.get(prefix + name)!), digest);
    }
    assert.match(files.get(prefix + 'README.md')!.toString(), /Import plugin from\s+manifest/);
    assert.match(files.get(prefix + 'THIRD_PARTY_NOTICES.txt')!.toString(), /MIT License/);
    const repeated = await packagePlugin({ projectDir: directory, version: '0.1.0', outputDir: join(directory, 'again'), pluginDir: source.pluginDir });
    assert.deepEqual(await readFile(repeated.zipPath), zip, 'Identical inputs produce identical release bytes.');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('packaging rejects permission drift, alternate entrypoints, symlinks and unsafe versions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fsb-plugin-package-invalid-'));
  try {
    const { packagePlugin } = await import(moduleUrl);
    const source = await preparedPlugin(directory), manifest = JSON.parse(source.manifest.toString());
    for (const change of [
      { main: '../private.js' }, { enablePrivatePluginApi: false }, { permissions: ['currentuser'] },
      { networkAccess: { allowedDomains: ['*'], devAllowedDomains: ['ws://localhost:4177'] } },
    ]) {
      await writeFile(join(source.pluginDir, 'manifest.json'), JSON.stringify({ ...manifest, ...change }));
      await assert.rejects(packagePlugin({ projectDir: directory, version: '0.1.0', outputDir: join(directory, 'out'), pluginDir: source.pluginDir }), /Manifest/);
    }
    await writeFile(join(source.pluginDir, 'manifest.json'), source.manifest);
    await assert.rejects(packagePlugin({ projectDir: directory, version: '../unsafe', outputDir: join(directory, 'out'), pluginDir: source.pluginDir }), /version/);
    await rm(join(source.pluginDir, 'code.js'));
    await writeFile(join(directory, 'other.js'), source.code);
    await symlink(join(directory, 'other.js'), join(source.pluginDir, 'code.js'));
    await assert.rejects(packagePlugin({ projectDir: directory, version: '0.1.0', outputDir: join(directory, 'out'), pluginDir: source.pluginDir }), /regular file/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('project license bytes are optional, preserved and covered by ZIP metadata and checksums', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fsb-plugin-license-'));
  try {
    const { packagePlugin } = await import(moduleUrl);
    const source = await preparedPlugin(directory);
    const license = Buffer.from('Synthetic project license fixture.\n원본 라이선스 테스트 문구.\n');
    await writeFile(join(directory, 'LICENSE'), license);
    for (const identifier of [undefined, 'LicenseRef-Synthetic-Only']) {
      await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.1.0', ...(identifier ? { license: identifier } : {}) }));
      const result = await packagePlugin({ projectDir: directory, outputDir: join(directory, 'release'), pluginDir: source.pluginDir });
      const files = entries(await readFile(result.zipPath)), prefix = 'figma-semantic-bridge-plugin-0.1.0/';
      const metadata = JSON.parse(files.get(prefix + 'release.json')!.toString());
      assert.deepEqual(files.get(prefix + 'LICENSE'), license);
      assert.equal(metadata.license, identifier);
      assert.equal(Object.hasOwn(metadata, 'license'), identifier !== undefined);
      assert.deepEqual(metadata.files.LICENSE, { bytes: license.length, sha256: sha(license) });
      assert.ok(files.get(prefix + 'SHA256SUMS')!.toString().includes(`${sha(license)}  LICENSE\n`));
      for (const name of ['README.md', 'README.en.md', 'README.ko.md']) {
        assert.match(files.get(prefix + name)!.toString(), /\[MIT\]\(LICENSE\)/);
        assert.doesNotMatch(files.get(prefix + name)!.toString(), /not been selected|아직 선택되지/);
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('declared project licenses require a bounded regular LICENSE and valid metadata before publishing any ZIP', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fsb-plugin-license-invalid-'));
  try {
    const { packagePlugin } = await import(moduleUrl);
    const source = await preparedPlugin(directory), licensePath = join(directory, 'LICENSE'), outputDir = join(directory, 'release');
    const packageIt = () => packagePlugin({ projectDir: directory, outputDir, pluginDir: source.pluginDir });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.1.0', license: 'LicenseRef-Synthetic-Only' }));
    await assert.rejects(packageIt, /LICENSE is required/);
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(100_001, 0x61)]) {
      await writeFile(licensePath, bytes);
      await assert.rejects(packageIt, /LICENSE|bounded regular file/);
    }
    await rm(licensePath); await mkdir(licensePath);
    await assert.rejects(packageIt, /regular file/);
    await rm(licensePath, { recursive: true });
    await symlink(join(directory, 'package.json'), licensePath);
    await assert.rejects(packageIt, /regular file/);
    await rm(licensePath); await symlink(join(directory, 'missing'), licensePath);
    await assert.rejects(packageIt, /regular file/);
    await rm(licensePath); await writeFile(licensePath, 'Synthetic license fixture.\n');
    for (const license of ['', ' ', ' LicenseRef-Synthetic-Only', 'a'.repeat(257), 'value\nnext', { type: 'LicenseRef-Synthetic-Only' }]) {
      await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.1.0', license }));
      await assert.rejects(packageIt, /package.json license/);
    }
    await assert.rejects(readFile(join(outputDir, 'figma-semantic-bridge-plugin-0.1.0.zip')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
