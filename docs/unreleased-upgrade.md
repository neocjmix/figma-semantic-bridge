# Source upgrade after 0.1.1 / 0.1.1 이후 소스 변경

These changes are not included in published or installed 0.1.1 binaries. The next
release must rebuild and verify the app and plugin together. Do not replace a
published 0.1.1 asset with a different build using the same release label.

공개·설치된 0.1.1에는 이 변경이 없습니다. 다음 릴리즈에서는 앱과 플러그인을
함께 다시 빌드하고 검증해야 합니다. 기존 0.1.1 배포 파일을 덮어쓰지 않습니다.

## Local transport / 로컬 연결

| Consumer / 사용처 | Current source / 변경된 소스 |
| --- | --- |
| Native app and MCP / 네이티브 앱·MCP | `https://127.0.0.1:4178`, pinned to a private local certificate / 비공개 로컬 인증서 확인 |
| Figma plugin / Figma 플러그인 | `ws://localhost:4177`, mutually authenticated and encrypted messages / 상호 인증·메시지 암호화 |
| Explicit developer browser / 개발용 브라우저 | `http://127.0.0.1:4177`, manual pairing / 수동 연결 |

Figma rejects a numeric-IP development-domain manifest. The plugin therefore
retains `localhost`; authenticated encryption protects source messages even if a
local IPv6 listener relays the handshake. This does not prevent denial of service,
or protect against an attacker who can read the user's private token/key files.

Figma는 숫자 IP를 적은 개발용 허용 도메인을 거부합니다. `localhost`를 유지하고
메시지 암호화로 중계자의 원본 열람·명령 위조를 막습니다. 서비스 방해나 사용자
비공개 토큰·키 파일을 읽을 수 있는 공격자까지 방어한다는 뜻은 아닙니다.

The service creates `desktop-tls/key.pem`, `cert.pem` and `pin.der` inside the
private data directory. Never commit, share, install into system trust, or learn
these files from a network response. Native/MCP clients fail closed for a missing
or wrong pin, incompatible service, insecure file permissions or expired identity.
Normal restart preserves the identity and the existing pairing token/projects.

서버가 비공개 데이터 폴더 안에 위 인증서 파일을 만듭니다. 저장소에 넣거나
공유하거나 시스템 인증서로 등록하지 않습니다. 앱·MCP는 신뢰 파일이 없거나
잘못된 경우, 만료·권한 오류·서버 불일치 시 연결을 거부합니다. 정상 재시작은
인증서·연결 토큰·기존 작업공간을 보존합니다.

## Upgrade order / 갱신 순서

1. Save work and quit the application or stop the known development service that
   owns ports 4177/4178. Do not terminate unrelated processes.
   작업을 저장하고 해당 포트를 사용하는 앱·개발 서버만 종료합니다.
2. Build matching source with Node 22: `npm ci`, `npm run check`. Start the service
   with `npm start`, or package the native application through the release workflow.
   같은 소스로 서버·앱·플러그인을 함께 빌드합니다.
3. Close and rerun the newly built development plugin. Old plaintext protocol
   peers are rejected; there is no automatic insecure compatibility fallback.
   Figma 개발 플러그인을 닫고 새 빌드로 다시 실행합니다.
   Keep only one registration for this plugin ID. In the native check, registering
   both the checkout and installed app caused Figma to run the other build despite
   selecting the installed path. Removing the obsolete development registration
   restored the installed pair; this removes the registration, not its source files.
   같은 플러그인 ID를 두 경로로 등록하지 마세요. 실제 검증에서 개발본과 설치본의
   중복 등록으로 다른 빌드가 실행됐습니다. 사용하지 않는 개발 등록만 제거한 뒤
   원하는 앱 경로의 플러그인을 실행하면 됩니다. 원본 코드 파일은 삭제하지 않습니다.
4. Use the native app's **Copy MCP Configuration** or set `FSB_SERVER_URL` to the
   HTTPS origin and `FSB_DATA_DIR` to the same private data directory.
   앱의 **MCP 설정 복사**를 사용하거나 HTTPS 주소와 동일 데이터 폴더를 지정합니다.
5. Verify selection, small capture and retained approved context before using a
   large source. Do not infer permission support from an owned synthetic file.
   작은 선택·캡처·기존 승인 맥락을 확인한 뒤 큰 원본을 사용합니다.

`FSB_ALLOW_INSECURE_HTTP=1` is an explicit development-only MCP override for
isolated synthetic emulators. It bypasses peer authentication and must not appear
in packaged/native or real-design configurations. Ordinary browser pairing over
HTTP has no native certificate-pinning guarantee.

위 환경변수는 격리된 합성 테스트용으로만 HTTP를 허용합니다. 실제 디자인·앱·배포
설정에는 넣지 않습니다. HTTP 브라우저 연결에는 네이티브 인증서 확인 보장이 없습니다.

## Candidate validation / 후보 검증

On 2026-10-26 the rebuilt v3 plugin connected in actual Figma Desktop with the
localhost manifest. An isolated owned synthetic file passed selective metadata
reads, paged children with cached replay, a two-node branch in one chunk, an
800×600 overview and a 21-node collection. Scripted confirmation, approval,
approved export and current node preview also passed; the original selection
was unchanged. The 143 focused bridge/application tests passed, including an
actual IPv6 relay's inability to read or forge encrypted source records.

2026-10-26 재빌드한 v3 플러그인이 실제 Figma Desktop에서 연결됐습니다. 소유 합성
파일로 필요한 메타데이터 읽기, 하위 노드 페이지 조회·캐시 재사용, 2개 노드 분기의
단일 묶음 수집, 800×600 이미지와 21개 노드 자료 수집을 확인했습니다. 스크립트로
원본 확인·승인·승인 결과 내보내기·현재 노드 미리보기도 통과했고 원래 선택은
유지됐습니다. IPv6 중계자의 원본 내용 열람·명령 위조 거부를 포함한 집중 테스트 143개도
통과했습니다.

These are unreleased source-candidate results. Scoped independent review completed;
the final full check passed 406 Node tests and the full browser suite passed 49.
Native open/save dialogs roundtripped one 21-node source NDJSON. Package provenance
is checked separately. These results do not establish the original large file,
a human review study or a new released binary.
See the [validation log](product-validation.md#unreleased-security-candidate-2026-10-26)
and [protocol decision](adr/0010-plugin-mutual-authentication.md).

이 결과는 미배포 소스 후보에 한정됩니다. 독립 범위 검토를 마쳤으며 최종 Node
테스트 406개와 브라우저 테스트 49개가 통과했습니다. 네이티브 파일 창으로 21개
노드의 NDJSON 가져오기·내보내기도 확인했습니다. 패키지 출처 검증은 별도이며,
원래 큰 파일이나 사람의 검토 연구를 완료했다는 뜻은 아닙니다. 공개·설치된
0.1.1 파일도 아직 바뀌지 않았습니다.

Large acquisition and its remaining observation limits are described in the
[English guide](acquisition-workflow.en.md) and [한국어 가이드](acquisition-workflow.ko.md).
