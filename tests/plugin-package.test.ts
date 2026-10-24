import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

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
    const result = await packagePlugin({ version: '0.1.0', outputDir, pluginDir: source.pluginDir });
    const zip = await readFile(result.zipPath), files = entries(zip);
    const prefix = 'figma-semantic-bridge-plugin-0.1.0/';
    assert.deepEqual([...files.keys()].sort(), ['README.md', 'SHA256SUMS', 'THIRD_PARTY_NOTICES.txt', 'code.js', 'manifest.json', 'release.json'].map(name => prefix + name).sort());
    assert.deepEqual(files.get(prefix + 'manifest.json'), source.manifest);
    assert.deepEqual(files.get(prefix + 'code.js'), Buffer.from(source.code));
    assert.equal(zip.includes(Buffer.from('PRIVATE_SENTINEL')), false);
    assert.equal((await readFile(result.checksumPath, 'utf8')).trim(), `${sha(zip)}  figma-semantic-bridge-plugin-0.1.0.zip`);
    const metadata = JSON.parse(files.get(prefix + 'release.json')!.toString());
    assert.equal(metadata.version, '0.1.0');
    assert.equal(metadata.distribution, 'figma-desktop-development-import');
    assert.equal(metadata.channel, 'alpha');
    for (const [name, info] of Object.entries(metadata.files) as [string, { sha256: string; bytes: number }][]) {
      assert.equal(sha(files.get(prefix + name)!), info.sha256);
      assert.equal(files.get(prefix + name)!.length, info.bytes);
    }
    for (const line of files.get(prefix + 'SHA256SUMS')!.toString().trim().split('\n')) {
      const [digest, name] = line.split('  '); assert.equal(sha(files.get(prefix + name)!), digest);
    }
    assert.match(files.get(prefix + 'README.md')!.toString(), /Import plugin from\s+manifest/);
    assert.match(files.get(prefix + 'THIRD_PARTY_NOTICES.txt')!.toString(), /MIT License/);
    const repeated = await packagePlugin({ version: '0.1.0', outputDir: join(directory, 'again'), pluginDir: source.pluginDir });
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
      await assert.rejects(packagePlugin({ version: '0.1.0', outputDir: join(directory, 'out'), pluginDir: source.pluginDir }), /Manifest/);
    }
    await writeFile(join(source.pluginDir, 'manifest.json'), source.manifest);
    await assert.rejects(packagePlugin({ version: '../unsafe', outputDir: join(directory, 'out'), pluginDir: source.pluginDir }), /version/);
    await rm(join(source.pluginDir, 'code.js'));
    await writeFile(join(directory, 'other.js'), source.code);
    await symlink(join(directory, 'other.js'), join(source.pluginDir, 'code.js'));
    await assert.rejects(packagePlugin({ version: '0.1.0', outputDir: join(directory, 'out'), pluginDir: source.pluginDir }), /regular file/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
