import { guideDocumentNames, guideImageNames, loadGuideImages } from './guide-assets.mjs';
import { readFile, lstat, mkdir, writeFile, rename, open } from 'node:fs/promises';
import { constants } from 'node:fs';
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

export async function readProjectLicense(projectDir, packageMetadata) {
  const license = packageMetadata.license;
  if (license !== undefined && (typeof license !== 'string' || !license || license.length > 256 ||
      license !== license.trim() || /[\u0000-\u001f\u007f]/.test(license))) {
    throw new Error('package.json license must be a non-empty bounded license identifier or expression.');
  }
  const path = join(projectDir, 'LICENSE'), maxBytes = 100_000;
  const info = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!info) {
    if (license !== undefined) throw new Error('Project LICENSE is required when package.json license is declared.');
    return {};
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw new Error('Project LICENSE must be a bounded regular file.');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.size > maxBytes) throw new Error('Project LICENSE must be a bounded regular file.');
    const buffer = Buffer.alloc(maxBytes + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, count);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    if (count === 0 || count > maxBytes) throw new Error('Project LICENSE must be non-empty and at most 100000 bytes.');
    bytes = buffer.subarray(0, count);
  } finally { await file.close(); }
  return { ...(license === undefined ? {} : { license }), bytes };
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

// Store-only ZIP: explicit allowlisted files, fixed timestamps, no platform
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

function installationReadme(version, hasLicense) {
  return `# Figma Semantic Bridge ${version} — local Figma plugin

[한국어](README.ko.md) · [User guide](docs/user-guide.en.md) · [Setup guide](docs/alpha-installation.en.md)

Use this prebuilt plugin with the matching Figma Semantic Bridge macOS app.
No compilation or system Node.js installation is required. This is a locally
installed plugin; it is not listed in Figma Community.

## Connect to the app

1. Install and open the ${version} app. If its bundled plugin is already registered
   in Figma, use that registration. Do not register a second copy from this ZIP.
2. Otherwise, extract this ZIP into a permanent folder. In Figma Desktop, choose
   Plugins → Development → **Import plugin from manifest** and select manifest.json.
3. Open a file you are allowed to access and run **Figma Semantic Bridge — Local**.
   In Dev Mode, run it from the Inspect plugins surface. Your account, seat and
   organization must allow development plugins in that file.
4. In the app, choose Bridge → Copy Pairing Token. Paste it into the plugin and
   choose Connect. Then use Clear Copied Token in the app.
5. Keep the plugin open, select one frame in Figma and return to the app. Start
   with **Add source**, check the selected frame, then choose **Start import**. The
   [user guide](docs/user-guide.en.md) walks through review, approval and export.

Choose English or 한국어 in the plugin's Language menu. This setting is saved
separately from the app and never translates Figma text or your annotations.
The plugin reads the source design. Show in Figma changes only selection and
viewport. Closing this plugin disconnects the app from the file.

## If connection fails

- Open the matching app version and copy its token again. Upgrade the app and
  plugin together, then close and rerun the plugin.
- Keep one registration for this plugin. If you moved its folder, register its
  current manifest again and remove the obsolete registration.
- If Figma blocks import or execution, check your account and organization policy.
  Editing the manifest does not grant permission. Dev-only access on someone
  else's view-only file remains an unverified alpha scenario.

For setup, updates and local MCP configuration, use the bundled installation guide.
Do not share the pairing token or include it in screenshots.

## Package integrity and license

Compare the ZIP with its adjacent SHA-256 file before extraction. SHA256SUMS lists
bundled file hashes; release.json identifies the version. Checksums detect content
changes and are not publisher signatures. THIRD_PARTY_NOTICES.txt contains the
bundled dependency licenses. Guide screenshots contain synthetic example data.
${hasLicense ? 'Project license: [MIT](LICENSE).' : 'Project licensing has not been selected. This local alpha package does not grant a project license.'}
`;
}

function installationReadmeKo(version, hasLicense) {
  return `# Figma Semantic Bridge ${version} — 로컬 Figma 플러그인

[English](README.en.md) · [사용 가이드](docs/user-guide.ko.md) · [설치 가이드](docs/alpha-installation.md)

같은 버전의 Figma Semantic Bridge macOS 앱과 함께 쓰는 플러그인입니다.
컴파일이나 별도 Node.js 설치가 필요하지 않습니다. Figma에 로컬로 설치하며,
Figma Community에 등록된 플러그인은 아닙니다.

## 앱에 연결하기

1. ${version} 앱을 설치하고 엽니다. 앱에 포함된 플러그인이 이미 Figma에 등록되어
   있다면 그대로 사용하세요. 이 ZIP으로 중복 등록하지 마세요.
2. 처음 설치한다면 ZIP을 고정된 폴더에 풀고 Figma Desktop에서 Plugins →
   Development → **Import plugin from manifest**로 manifest.json을 선택합니다.
3. 접근이 허용된 파일에서 **Figma Semantic Bridge — Local**을 실행합니다.
   Dev Mode에서는 Inspect의 플러그인 목록에서 실행합니다. 해당 파일에서 개발
   플러그인을 쓸 수 있는 계정·좌석·조직 권한이 필요합니다.
4. 앱의 브리지 → 연결 토큰 복사로 복사한 값을 플러그인에 붙여넣고 연결합니다.
   연결 후 앱에서 복사한 토큰 지우기를 선택합니다.
5. 플러그인을 열어 둔 채 Figma에서 프레임 하나를 선택하고 앱으로 돌아옵니다.
   **원본 추가**에서 선택한 프레임을 확인한 뒤 **가져오기 시작**을 누르세요.
   검토·승인·내보내기는 [사용 가이드](docs/user-guide.ko.md)를 따르세요.

언어 메뉴에서 한국어 또는 English를 선택할 수 있습니다. 앱과 별도로 저장되며,
Figma 원문이나 작성한 주석은 번역하지 않습니다. 원본 디자인은 읽기만 합니다.
Figma에서 보기는 선택과 화면 위치만 바꿉니다. 플러그인을 닫으면 파일 연결이 끊깁니다.

## 연결되지 않을 때

- 같은 버전의 앱을 열고 토큰을 다시 복사하세요. 앱과 플러그인을 함께 갱신한 뒤
  플러그인을 닫고 다시 실행하세요.
- 같은 플러그인은 한 번만 등록하세요. 폴더를 옮겼다면 현재 manifest를 다시
  등록하고 이전 등록을 제거하세요.
- Figma가 가져오기나 실행을 막으면 계정과 조직 정책을 확인하세요. manifest를
  바꿔도 권한이 생기지 않습니다. 타인 소유 읽기 전용 파일의 Dev 전용 권한
  조합은 알파에서 아직 별도 검증이 필요합니다.

설치·업데이트·로컬 MCP 설정은 함께 제공되는 설치 가이드를 보세요.
연결 토큰을 공유하거나 화면 캡처에 포함하지 마세요.

## 파일 확인과 라이선스

압축을 풀기 전에 ZIP을 옆의 SHA-256 파일과 비교하세요. SHA256SUMS에는 포함된
파일의 해시, release.json에는 버전이 있습니다. 체크섬은 파일 변경을 확인하며
배포자의 전자서명을 대신하지 않습니다. 의존성 라이선스는 THIRD_PARTY_NOTICES.txt에
있습니다. 가이드 화면은 합성 예시 데이터로 만들었습니다.
${hasLicense ? '프로젝트 라이선스: [MIT](LICENSE).' : '프로젝트 라이선스는 아직 선택되지 않았습니다. 이 로컬 알파 패키지는 프로젝트 사용 라이선스를 부여하지 않습니다.'}
`;
}

export async function packagePlugin({ projectDir = root, version, outputDir = join(projectDir, 'dist/releases'), pluginDir = join(projectDir, 'plugins/semantic-bridge') } = {}) {
  const pkg = JSON.parse(await readRegular(join(projectDir, 'package.json'), 64_000));
  const projectLicense = await readProjectLicense(projectDir, pkg);
  if (version === undefined) version = pkg.version;
  if (typeof version !== 'string' || version.length > 80 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version)) {
    throw new Error('A safe semantic release version is required.');
  }
  const manifestBytes = await readRegular(join(pluginDir, 'manifest.json'), 16000);
  const code = await readRegular(join(pluginDir, 'code.js'), 8_000_000);
  validateManifest(JSON.parse(manifestBytes.toString()));
  new vm.Script(code.toString(), { filename: 'code.js' });
  if (!code.includes(Buffer.from('ws://localhost:4177/bridge'))) throw new Error('Built production plugin endpoint is missing. Run npm run build:product-plugin first.');
  const zod = JSON.parse(await readFile(join(projectDir, 'node_modules/zod/package.json'), 'utf8'));
  const hashes = JSON.parse(await readFile(join(projectDir, 'node_modules/@noble/hashes/package.json'), 'utf8'));
  const ciphers = JSON.parse(await readFile(join(projectDir, 'node_modules/@noble/ciphers/package.json'), 'utf8'));
  const notices = Buffer.from(`Bundled dependency: zod ${zod.version}\nhttps://github.com/colinhacks/zod\n\n${await readFile(join(projectDir, 'node_modules/zod/LICENSE'), 'utf8')}\n\nBundled dependency: @noble/hashes ${hashes.version}\nhttps://github.com/paulmillr/noble-hashes\n\n${await readFile(join(projectDir, 'node_modules/@noble/hashes/LICENSE'), 'utf8')}\n\nBundled dependency: @noble/ciphers ${ciphers.version}\nhttps://github.com/paulmillr/noble-ciphers\n\n${await readFile(join(projectDir, 'node_modules/@noble/ciphers/LICENSE'), 'utf8')}`);
  const files = new Map([
    ['manifest.json', manifestBytes], ['code.js', code],
    ['README.md', Buffer.from(installationReadme(version, !!projectLicense.bytes))], ['THIRD_PARTY_NOTICES.txt', notices],
    ['README.en.md', Buffer.from(installationReadme(version, !!projectLicense.bytes))], ['README.ko.md', Buffer.from(installationReadmeKo(version, !!projectLicense.bytes))],
  ]);
  if (projectLicense.bytes) files.set('LICENSE', projectLicense.bytes);
  for (const file of guideDocumentNames) {
    files.set(`docs/${file}`, await readRegular(join(projectDir, 'docs', file), 200_000));
  }
  await loadGuideImages(projectDir);
  for (const name of guideImageNames) files.set(`docs/images/${name}`, await readRegular(join(projectDir, 'docs/images', name), 1_000_000));
  files.set('release.json', encode({ formatVersion: 1, name: 'figma-semantic-bridge-plugin', version,
    channel: 'alpha', locales: ['ko', 'en'], distribution: 'figma-desktop-development-import',
    pluginEntry: 'manifest.json', serverPort: 4177, ...(projectLicense.license === undefined ? {} : { license: projectLicense.license }),
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
