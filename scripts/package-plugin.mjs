import { readFile, lstat, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

async function readRegular(path, maxBytes) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw new Error('Package input must be a bounded regular file.');
  return readFile(path);
}

function validateManifest(manifest) {
  const keys = ['api', 'capabilities', 'documentAccess', 'editorType', 'enablePrivatePluginApi', 'id', 'main', 'name', 'networkAccess'];
  if (!manifest || !isDeepStrictEqual(Object.keys(manifest).sort(), keys.sort()) ||
    typeof manifest.name !== 'string' || !manifest.name || typeof manifest.id !== 'string' || !manifest.id ||
    manifest.api !== '1.0.0' || manifest.main !== 'code.js' || manifest.documentAccess !== 'dynamic-page' ||
    manifest.enablePrivatePluginApi !== true || !isDeepStrictEqual(manifest.editorType, ['figma', 'dev']) ||
    !isDeepStrictEqual(manifest.capabilities, ['inspect']) ||
    !isDeepStrictEqual(manifest.networkAccess, { allowedDomains: ['none'], devAllowedDomains: ['ws://localhost:4177'] })) {
    throw new Error('Manifest differs from the reviewed local development permissions or entrypoint.');
  }
}

// Store-only ZIP: six small allowlisted files, fixed timestamps, no platform
// archive tools, recursive traversal, symlinks, path metadata or hidden files.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [path, bytes] of entries) {
    const name = Buffer.from(path), checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12); header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, bytes);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(0x314, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(33, 14); directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE((0o100644 << 16) >>> 0, 38); directory.writeUInt32LE(offset, 42);
    central.push(directory, name); offset += header.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function installationReadme(version) {
  return `# Figma Semantic Bridge ${version} — local alpha plugin

This prebuilt plugin connects Figma Desktop to the separately installed local
Semantic Bridge server. It is a development-plugin import, not a Community
listing or a standalone application. No source compilation is needed to import
this folder. Keep the extracted folder in a stable location.

## Install

1. Install and start the matching Semantic Bridge local server using its release
   instructions. Keep its default port 4177; the plugin endpoint is fixed.
2. Open Figma Desktop. From Plugins → Development choose **Import plugin from
   manifest**, then select this folder's **manifest.json**. Do not import the ZIP.
3. Open a permitted Figma Design file and run **Figma Semantic Bridge — Local**.
   For Dev Mode, use its Inspect plugins surface with a seat and file context
   that enable Dev Mode. Development plugins must be permitted by your account
   and organization. If Figma requires a generated development ID, create a
   development plugin and replace only the local manifest's id with that assigned
   ID; keep the reviewed network and capability fields unchanged.
4. Paste the pairing token from your local server into the plugin and Connect.
   Keep that token private. Open http://127.0.0.1:4177 and pair the local web app.
5. Select one container in Figma and use Capture selection in the local web app.
   Review source references before confirming and approving semantic annotations.

The plugin reads selected scopes and does not edit source design content. Show in
Figma explicitly changes native selection/viewport. A running, paired server is
required. The archive contains no server, credentials, Figma documents, captures,
fixture analyzer, screenshots or personal configuration.

## Alpha boundary

Actual Desktop Design and Dev Mode use on owned permitted files has been tested
by the project. The intended Dev-seat plus can-view-only permission combination
is still a separate acceptance gap. Importing this ZIP does not establish that
permission boundary or approval to access an organization's files.

The manifest preserves ws://localhost:4177 in devAllowedDomains and enables the
private API used for host-provided file identity. Do not publish this manifest
unchanged. Network support for published use needs a separate allowedDomains
declaration and reasoning; localhost is not categorically forbidden. fileKey is
documented for private/Figma-owned plugins, so Community distribution needs an
identity design change or an explicitly reduced capability set. Dev Mode's
Inspect support does not remove that restriction. Organization/Enterprise
internal publication is a different possible path and is not performed here.

Official references checked 2026-10-24:
- Manifest/network/private API: https://developers.figma.com/docs/plugins/manifest/
- File identity: https://developers.figma.com/docs/plugins/api/figma/#filekey-string--undefined-readonly
- Dev Mode: https://developers.figma.com/docs/plugins/working-in-dev-mode/
- Internal publication: https://help.figma.com/hc/en-us/articles/4404228629655-Create-internal-plugins-for-an-organization
- Desktop prerequisite: https://developers.figma.com/docs/plugins/plugin-quickstart-guide/

## Verify

Compare the ZIP's SHA-256 with its adjacent .sha256 file before extraction.
SHA256SUMS lists every bundled file except itself. release.json records the
version, distribution type and hashes of the inputs. Checksums verify content
integrity; they are not signatures or publisher authentication. THIRD_PARTY_NOTICES.txt
contains the bundled dependency's license. Project licensing follows the main
release's license; this plugin package does not introduce a separate license.
`;
}

export async function packagePlugin({ version, outputDir = join(root, 'dist/releases'), pluginDir = join(root, 'plugins/semantic-bridge') } = {}) {
  if (version === undefined) version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
  if (typeof version !== 'string' || version.length > 80 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version)) {
    throw new Error('A safe semantic release version is required.');
  }
  const manifestBytes = await readRegular(join(pluginDir, 'manifest.json'), 16000);
  const code = await readRegular(join(pluginDir, 'code.js'), 8_000_000);
  validateManifest(JSON.parse(manifestBytes.toString()));
  new vm.Script(code.toString(), { filename: 'code.js' });
  if (!code.includes(Buffer.from('ws://localhost:4177/bridge'))) throw new Error('Built production plugin endpoint is missing. Run npm run build:product-plugin first.');
  const zod = JSON.parse(await readFile(join(root, 'node_modules/zod/package.json'), 'utf8'));
  const notices = Buffer.from(`Bundled dependency: zod ${zod.version}\nhttps://github.com/colinhacks/zod\n\n${await readFile(join(root, 'node_modules/zod/LICENSE'), 'utf8')}`);
  const files = new Map([
    ['manifest.json', manifestBytes], ['code.js', code],
    ['README.md', Buffer.from(installationReadme(version))], ['THIRD_PARTY_NOTICES.txt', notices],
  ]);
  files.set('release.json', encode({ formatVersion: 1, name: 'figma-semantic-bridge-plugin', version,
    channel: 'alpha', distribution: 'figma-desktop-development-import',
    pluginEntry: 'manifest.json', serverPort: 4177,
    files: Object.fromEntries([...files].map(([name, bytes]) => [name, { bytes: bytes.length, sha256: sha256(bytes) }])) }));
  files.set('SHA256SUMS', Buffer.from([...files].map(([name, bytes]) => `${sha256(bytes)}  ${name}\n`).join('')));
  const name = `figma-semantic-bridge-plugin-${version}`, archive = zip(new Map([...files].map(([path, bytes]) => [`${name}/${path}`, bytes])));
  await mkdir(outputDir, { recursive: true });
  const zipPath = join(outputDir, `${name}.zip`), checksumPath = `${zipPath}.sha256`;
  for (const [path, bytes] of [[zipPath, archive], [checksumPath, Buffer.from(`${sha256(archive)}  ${name}.zip\n`)]]) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o644 }); await rename(temporary, path);
  }
  return { zipPath, checksumPath, bytes: archive.length, sha256: sha256(archive), files: [...files.keys()] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { version: { type: 'string' }, 'output-dir': { type: 'string' } } });
    const result = await packagePlugin({ version: values.version, outputDir: values['output-dir'] });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`Plugin packaging failed: ${error.message}\n`); process.exitCode = 1;
  }
}
