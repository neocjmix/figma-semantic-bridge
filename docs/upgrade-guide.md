# Update, backup and restore / 업데이트·백업·복원

## 한국어

0.2.0 이전 버전에서 **0.2.1 알파**로 올릴 때는 앱과 Figma 플러그인을 함께 바꾸고 MCP 설정을
갱신하세요. 기존 작업 공간·원문·승인·연결 토큰·언어 설정은 유지합니다.
앱 실행 파일은 `/Applications`, 작업 자료는 기본적으로 `~/.figma-semantic-bridge`에
별도로 있습니다. 실제 데이터 위치는 **브리지 → 로컬 데이터 폴더 보기**로 확인하세요.

### 1. 저장하고 백업

1. 주석·명세의 작성 중인 내용을 저장합니다. 진행 중인 가져오기를 중단하거나
   마친 뒤 Figma 플러그인과 앱을 정상 종료합니다.
2. MCP 등 같은 자료를 쓰는 클라이언트와 별도 관리하는 개발 서비스를 중지합니다.
   관계없는 Node 프로세스를 한꺼번에 종료하지 마세요.
3. 앱과 **데이터 폴더 전체를 복사**해 비공개 위치에 보관합니다. 프로젝트 JSON뿐 아니라
   연결된 구조 수집 자료도 필요합니다. 기본 위치의 백업 예시는 다음과 같습니다.

```sh
backup_dir="$HOME/Figma-Semantic-Bridge-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$backup_dir"
ditto "/Applications/Figma Semantic Bridge.app" "$backup_dir/Figma Semantic Bridge.app"
ditto "$HOME/.figma-semantic-bridge" "$backup_dir/data"
```

데이터 위치를 바꿨다면 실제 폴더로 대체하세요. 백업에는 원문·이미지와 연결 토큰,
`desktop-tls` 개인 키가 포함됩니다. 공유 폴더나 공개 저장소에 넣지 마세요.

### 2. 앱과 플러그인 교체

1. [0.2.1 릴리즈](https://github.com/neocjmix/figma-semantic-bridge/releases/tag/v0.2.1-alpha)의
   DMG 또는 앱 ZIP을 받고 체크섬을 확인합니다.
2. 기존 앱의 경로와 루트 폴더를 유지하며 **Contents를 교체**합니다. 기존 앱을 이동하거나
   이름을 바꾸면 Figma가 백업 사본의 플러그인을 따라갈 수 있습니다.
   앱이 종료된 상태에서 마운트된 새 앱으로 바꾸는 예시는 다음과 같습니다.

```sh
rsync -a --delete -- "/Volumes/Figma Semantic Bridge 0.2.1/Figma Semantic Bridge.app/Contents/" "/Applications/Figma Semantic Bridge.app/Contents/"
codesign --verify --deep --strict "/Applications/Figma Semantic Bridge.app"
"/Applications/Figma Semantic Bridge.app/Contents/MacOS/FigmaSemanticBridge" --release-info
```

마운트 위치가 다르면 실제 경로를 사용하세요. 양쪽 경로가 확인된 앱의 Contents인지
먼저 확인합니다. 이 명령은 앱 폴더의 정체성을 유지하면서 새 배포본에 없는 이전
파일을 제거합니다. 앱을 종료하고 백업한 뒤에만 실행하세요. 데이터 폴더를 이 명령의
대상으로 지정하지 마세요. 서명 검증이 실패하면 백업으로 되돌려 원인을 확인합니다.

3. 설치된 앱을 실행하고 Figma 플러그인을 닫았다가 다시 실행합니다. 앱 내부의
   같은 manifest 경로를 재사용하세요. 별도 ZIP으로 설치했다면 그 고정 폴더도
   같은 버전으로 업데이트합니다.
4. 같은 플러그인 ID를 앱과 체크아웃 등 여러 경로로 중복 등록하지 마세요.
   이전 등록만 제거하고 **브리지 → Figma 플러그인 폴더 보기**의 현재 manifest를
   사용합니다. 원본 코드나 Figma 문서를 삭제하는 절차가 아닙니다.
5. 필요한 경우 앱의 **연결 토큰 복사**로 다시 연결합니다. 토큰 파일을 새로 만들거나
   데이터 폴더·언어 설정을 초기화하지 않습니다.

### 3. MCP 갱신과 확인

새 앱의 **브리지 → MCP 설정 복사**로 기존 `figma_semantic_bridge` 항목만 갱신합니다.
0.2.1의 앱·MCP는 `https://127.0.0.1:4178`과 같은 데이터 폴더의 비공개 인증서를
사용합니다. 플러그인 포트는 4177입니다. 0.1.x의 HTTP 설정이나 오래된 플러그인과
섞어 쓰지 마세요. 로컬 인증서를 시스템에 설치할 필요가 없습니다.

- `--release-info`와 앱의 로컬 서비스가 `0.2.1`인지 확인합니다.
- 작은 허용된 원본의 이름·미리보기를 읽어 연결을 확인합니다.
- 기존 작업 공간과 승인 맥락을 열고 언어·원문·승인이 유지됐는지 확인합니다.
- MCP에서 실제로 `list_projects`, 필요한 작업 공간의 `get_approved_context`를 호출합니다.
- 앱 안의 설치·사용 가이드가 두 언어로 열리는지 확인합니다.

포트 충돌은 확인된 이전 앱·서비스를 정상 종료해 해결합니다. 인증서·권한 오류는
데이터 폴더를 보존한 채 원인을 확인하세요. 네트워크에서 받은 인증서를 대신
신뢰하거나 인증서 검증을 끄지 마세요.

### 복원과 삭제

복원 전에도 앱·플러그인·모든 쓰기 서비스를 중지하고 현재 상태를 별도로 백업하세요.
**같은 시점의 앱과 데이터 전체**를 복원한 뒤 등록된 플러그인 경로와 MCP 설정을
맞춥니다. 이전 앱에 새 데이터 일부만 섞는 다운그레이드는 보장하지 않습니다.
0.1.1로 돌아가면 그 버전의 알려진 보안 제한도 다시 적용됩니다.

앱만 제거해도 작업 자료는 남습니다. 자료까지 삭제하려면 필요한 전체 백업을 먼저
만들고, 실제 데이터 폴더를 확인한 후 사용자 의사에 따라 제거하세요. Figma에서는
개발 플러그인 등록을 제거합니다. 원본 디자인은 삭제할 필요가 없습니다.

## English

When moving from 0.2.0 or earlier to **0.2.1 alpha**, update the app and Figma plugin together
and refresh MCP configuration. Preserve workspaces, original text, approvals, the
pairing token and language preferences. The app in `/Applications` is separate
from the default data directory, `~/.figma-semantic-bridge`. Use **Bridge → Reveal
Local Data** to check its actual location.

### 1. Save and back up

1. Save annotation/specification edits. Finish or stop active imports, then quit
   the Figma plugin and app normally.
2. Stop other writers, including MCP clients and any separately managed service
   using this data. Do not terminate unrelated Node processes.
3. Copy the app and **entire data directory** into a private backup location.
   Project JSON alone omits linked structure data. For the default paths:

```sh
backup_dir="$HOME/Figma-Semantic-Bridge-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$backup_dir"
ditto "/Applications/Figma Semantic Bridge.app" "$backup_dir/Figma Semantic Bridge.app"
ditto "$HOME/.figma-semantic-bridge" "$backup_dir/data"
```

Substitute your actual data path if different.

The backup contains source text, images, the token and the `desktop-tls` private
key. Keep it private and out of public repositories or shared folders.

### 2. Replace the app and plugin

1. Download the DMG or app ZIP from the
   [0.2.1 release](https://github.com/neocjmix/figma-semantic-bridge/releases/tag/v0.2.1-alpha)
   and check its checksum.
2. Keep the installed app's path and root directory identity, and replace its
   **Contents** while it is closed. Moving or renaming the original app can make
   Figma follow the plugin in that backup. With the new DMG mounted:

```sh
rsync -a --delete -- "/Volumes/Figma Semantic Bridge 0.2.1/Figma Semantic Bridge.app/Contents/" "/Applications/Figma Semantic Bridge.app/Contents/"
codesign --verify --deep --strict "/Applications/Figma Semantic Bridge.app"
"/Applications/Figma Semantic Bridge.app/Contents/MacOS/FigmaSemanticBridge" --release-info
```

Use the actual mounted path and verify that both paths are the intended app
Contents directories. This keeps existing directory identities and removes old
app files absent from the new release. Run only after quitting and backing up.
Never use the data directory as the destination. If signature verification fails,
restore the backup and investigate; do not disable verification.
3. Launch the installed app and close/relaunch the Figma plugin. Reuse the same
   manifest path inside the app. If using a standalone plugin ZIP, update its
   permanent folder to the matching version too.
4. Keep only one registration for this plugin ID. Remove obsolete development
   registrations and use the current manifest revealed by **Bridge → Reveal Figma
   Plugin**. This removes registrations, not source files or Figma designs.
5. Reconnect with **Copy Pairing Token** if needed. Do not regenerate the token or
   reset the data directory or language preferences.

### 3. Refresh MCP and check the update

Use **Bridge → Copy MCP Configuration** in the new app to replace only the existing
`figma_semantic_bridge` entry. The 0.2.1 app/MCP use `https://127.0.0.1:4178` and the
private identity in the same data directory. The plugin uses port 4177. Do not mix
the old HTTP MCP configuration or plugin with the new app. Installing a system
certificate is not required.

- Check `--release-info` and the local service version are `0.2.1`.
- Read a small permitted source's name and preview to check the plugin connection.
- Open existing work and approved context; check languages, original text and approvals.
- Actually call `list_projects` and the relevant `get_approved_context` through MCP.
- Open the app's installation and user guides in both languages.

For a port conflict, stop the identified older app/service normally. Preserve the
data directory when investigating certificate or permission errors. Do not trust
a network-supplied replacement certificate or turn off certificate validation.

### Restore or remove

Before restoring, stop every writer and separately back up the current state.
Restore the **app and complete data from the same backup**, then align the plugin
registration and MCP paths. Downgrading by mixing old apps with newer partial data
is not guaranteed. Returning to 0.1.1 also restores that version's known security limits.

Removing the app leaves local work in place. Before deleting data, make a complete
backup and confirm the actual directory and the user's intent. Remove the local
development-plugin registration in Figma. Original designs do not need removal.
