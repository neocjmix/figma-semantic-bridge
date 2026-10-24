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
  return `# Figma Semantic Bridge ${version} — local alpha plugin

[한국어 설치 안내](README.ko.md) · [English user guide](docs/user-guide.en.md) · [한국어 사용 가이드](docs/user-guide.ko.md)

This prebuilt plugin connects Figma Desktop to the separately installed local
Semantic Bridge application. It is a development-plugin import, not a Community
listing or a standalone application. No source compilation is needed to import
this folder. Keep the extracted folder in a stable location.

## Install

1. Install and start the matching Semantic Bridge application using its release
   instructions. Keep its default port 4177; the plugin endpoint is fixed.
2. Open Figma Desktop. From Plugins → Development choose **Import plugin from
   manifest**, then select this folder's **manifest.json**. Do not import the ZIP.
3. Open a permitted Figma Design file and run **Figma Semantic Bridge — Local**.
   For Dev Mode, use its Inspect plugins surface with a seat and file context
   that enable Dev Mode. Development plugins must be permitted by your account
   and organization. If import is blocked, record the permission/policy error;
   do not bypass it by changing the reviewed manifest permissions.
4. Choose Bridge → Copy Pairing Token in the application, paste into the plugin
   and Connect. Keep that token private; use Clear Copied Token after pairing.
5. Select one container in Figma and use Capture Figma selection in the app.
  Review source references before confirming and approving semantic annotations.

Choose English or 한국어 in the plugin's Language selector. The plugin remembers
its own choice independently of the app. Only controls and messages change;
Figma source text and stored annotations are never translated by this setting.
The workflow and situation-specific options are in the bundled user guides.

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
contains the bundled dependency's license.
${hasLicense ? 'Project license terms are included in [LICENSE](LICENSE). This plugin package does not introduce a separate license.' : 'Project licensing has not been selected. This local alpha package does not grant a project license.'}
`;
}

function installationReadmeKo(version, hasLicense) {
  return `# Figma Semantic Bridge ${version} — 로컬 알파 플러그인

[English](README.en.md) · [한국어 사용 가이드](docs/user-guide.ko.md) · [English user guide](docs/user-guide.en.md)

이 ZIP에는 미리 빌드된 플러그인과 두 언어의 안내서가 들어 있습니다.
별도로 설치한 Figma Semantic Bridge 앱과 함께 사용합니다. 플러그인 컴파일이나
Node 설치는 필요하지 않습니다. Figma Community 등록 플러그인은 아닙니다.

1. 같은 버전의 앱을 실행합니다. 포트 4177과 기존 데이터·토큰은 유지합니다.
2. ZIP을 고정된 위치에 풀고 Figma Desktop의 Plugins → Development →
   Import plugin from manifest에서 이 폴더의 manifest.json을 선택합니다.
3. 읽기·내보내기가 허용된 파일에서 Figma Semantic Bridge — Local을 실행합니다.
   계정·파일·조직 정책이 플러그인 실행을 허용해야 합니다.
4. 앱의 Bridge → Copy Pairing Token으로 복사한 토큰을 플러그인에 붙여넣고
   연결합니다. 토큰은 채팅이나 로그에 남기지 말고 연결 후 복사한 토큰을 지웁니다.
5. 작은 Frame 하나를 선택하고 앱에서 Figma 선택 캡처를 실행합니다.
   출처 확인과 의미 승인은 사람이 각각 검토해 수행합니다.

플러그인의 언어 선택에서 한국어/English를 고릅니다. 선택은 플러그인에 별도로
저장되며 앱 언어와 독립적입니다. 원본 텍스트·이름·승인 상태는 번역하거나 변경하지
않습니다. 기본 작업 순서와 겹침·숨김·불명확한 출처 등의 대응은 사용 가이드를 읽으세요.

원본 디자인 내용은 수정하지 않으며 명시적 Figma 탐색은 선택·뷰포트만 이동합니다.
Dev 전용 계정과 다른 소유자의 읽기 전용 파일 조합은 별도 미검증 항목입니다.
현재 manifest는 localhost 개발 연결과 private fileKey API를 사용합니다.
권한이나 정책이 막으면 우회하지 마세요. 설치·권한·알파 제한의 자세한 설명은
[설치 안내](docs/alpha-installation.md)에 있습니다.

ZIP의 SHA-256을 인접한 .sha256 파일과 대조하세요. 내부 SHA256SUMS는 자신을
제외한 파일을 검증합니다. 체크섬은 무결성 확인이며 작성자의 신원이나 사용 권한을
증명하지 않습니다. THIRD_PARTY_NOTICES.txt는 포함된 의존성 라이선스이며,
${hasLicense ? '프로젝트 라이선스 조건은 [LICENSE](LICENSE)를 확인하세요. 플러그인에 별도 라이선스를 부여하지 않습니다.' : '프로젝트 라이선스는 아직 선택되지 않았습니다. 이 로컬 알파 패키지는 프로젝트 사용 라이선스를 부여하지 않습니다.'}
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
  const notices = Buffer.from(`Bundled dependency: zod ${zod.version}\nhttps://github.com/colinhacks/zod\n\n${await readFile(join(projectDir, 'node_modules/zod/LICENSE'), 'utf8')}`);
  const files = new Map([
    ['manifest.json', manifestBytes], ['code.js', code],
    ['README.md', Buffer.from(installationReadme(version, !!projectLicense.bytes))], ['THIRD_PARTY_NOTICES.txt', notices],
    ['README.en.md', Buffer.from(installationReadme(version, !!projectLicense.bytes))], ['README.ko.md', Buffer.from(installationReadmeKo(version, !!projectLicense.bytes))],
  ]);
  if (projectLicense.bytes) files.set('LICENSE', projectLicense.bytes);
  for (const file of ['user-guide.ko.md', 'user-guide.en.md', 'alpha-installation.md', 'alpha-installation.en.md']) {
    files.set(`docs/${file}`, await readRegular(join(projectDir, 'docs', file), 200_000));
  }
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
