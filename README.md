# Figma Semantic Bridge 0.1.1 Alpha

[English](README.en.md) · [사용자 가이드 — 한국어](docs/user-guide.ko.md) · [User guide — English](docs/user-guide.en.md)

**Figma 화면에 사람이 의미와 요구사항을 정리하고, 승인한 내용을 코딩 AI에게 전달하는 로컬 앱입니다.**

macOS 13 이상을 빌드 대상으로 하는 Apple Silicon(M1 이상) 앱입니다. 공식 Node.js
22.23.4, 제품용 로컬 서버·웹·MCP와 미리 빌드된 Figma 플러그인을 포함합니다.
사용자가 Node.js, npm, 소스 체크아웃이나 별도 개발 서버를 준비할 필요가 없습니다.
0.1.1의 실제 로컬 업데이트·실행은 macOS 26.6.2에서 검증했으며 macOS 13 실행은 아직 확인하지 않았습니다.

**[0.1.1 다국어 알파 릴리스](https://github.com/neocjmix/figma-semantic-bridge/releases/tag/v0.1.1-alpha)를 공개했습니다.**
[MIT 라이선스](LICENSE)를 적용했습니다. 이번 공개 알파는 로컬 서비스 인증과 캡처
가져오기 입력 검증에 알려진 미수정 문제가 있습니다. 수정 전에는 본인 소유의 합성·
비민감 파일로만 평가하고 사내·고객 디자인에는 사용하지 마세요. 세부 내용은
[앱 인증 #11](https://github.com/neocjmix/figma-semantic-bridge/issues/11),
[플러그인 인증 #12](https://github.com/neocjmix/figma-semantic-bridge/issues/12),
[캡처 검증 #13](https://github.com/neocjmix/figma-semantic-bridge/issues/13)과
[배포 경계](docs/release-readiness.md)에 기록했습니다.

[상세 설치·세팅 가이드](docs/alpha-installation.md)
· [Installation — English](docs/alpha-installation.en.md)
· [릴리즈 노트](docs/releases/0.1.1.md)
· [0.1.1 업데이트 검증 집계](docs/evaluation/release-0.1.1-acceptance.json)

## 무엇을 하는 앱인가요?

1. Figma에서 필요한 Frame을 선택해 화면 이미지와 원본 노드 정보를 가져옵니다.
2. 사람이 화면 위에 영역을 표시하고 기능 이름과 구조를 정리합니다.
3. 실제 Figma 노드와 원문 설명을 연결합니다. 여러 노드가 겹치거나 숨겨졌다면
   화면과 개별 노드 이미지를 비교하고 Figma에서도 직접 확인합니다.
4. 사람이 검토하고 승인한 구조·요구사항·원본 출처를 JSON/Markdown으로 내보내거나
   MCP를 통해 Codex 등 코딩 에이전트에게 전달합니다.

원본 Figma 디자인은 수정하지 않습니다. 모호한 영역을 자동으로 정답이라 판단하거나,
AI가 사람의 승인을 덮어쓰지 않습니다. 이 앱 자체가 완성 코드를 생성하지는 않습니다.

## 화면 언어

앱 상단 오른쪽 **Language / 언어**에서 **한국어** 또는 **English**를 선택합니다.
브라우저는 명시한 선택을 저장하며 첫 기본값은 `navigator` 언어를 따릅니다.
저장을 사용할 수 없으면 현재 세션 동안 유지합니다. macOS 앱은 OS의 첫 번째 선호
언어로 시작하고 앱 메뉴와 내장 편집기의 언어를 동기화합니다. Figma 플러그인은
자신의 언어 선택을 별도로 저장합니다.

**언어 선택은 UI에만 적용됩니다. 프로젝트 이름, 사람이 쓴 주석, Figma 노드 이름과
원문, 명세와 승인 콘텐츠는 번역하거나 변경하지 않습니다.** 전체 검토 순서는
[한국어](docs/user-guide.ko.md) 또는 [영어](docs/user-guide.en.md) 사용자 가이드를 따르세요.

## 설치 파일

| 파일 | 용도 |
| --- | --- |
| `figma-semantic-bridge-0.1.1-macos-arm64.dmg` | 앱을 Applications로 복사하는 설치 이미지 |
| `figma-semantic-bridge-0.1.1-macos-arm64.zip` | 같은 앱의 ZIP 배포본 |
| `figma-semantic-bridge-plugin-0.1.1.zip` | Figma Desktop에 가져올 플러그인: 컴파일된 코드 포함 |
| `figma-semantic-bridge-0.1.1-INSTALLATION.md` | AI 에이전트와 사용자를 위한 오프라인 설치 가이드 |
| `figma-semantic-bridge-0.1.1-INSTALLATION.en.md` | 영어 설치·MCP 설정 가이드 |
| `figma-semantic-bridge-0.1.1-USER-GUIDE.ko.md` / `figma-semantic-bridge-0.1.1-USER-GUIDE.en.md` | 한국어·영어 작업 순서와 상황별 사용자 가이드 |
| `SHA256SUMS` | 다운로드한 파일의 SHA-256 확인 값 |
| `figma-semantic-bridge-0.1.1-release.json` | 버전, 플랫폼, 런타임과 서명 상태 |

GitHub가 자동 생성하는 **Source code** 압축 파일은 일반 사용자용 설치 파일이 아닙니다.
Intel Mac, Windows, Linux용 데스크톱 앱은 이번 알파에 포함하지 않습니다.

이번 앱은 ad-hoc 서명이며 **Apple Developer ID 서명·공증은 없습니다**. macOS나
회사 보안 정책이 실행을 막을 수 있습니다. 설치 에이전트는 Gatekeeper를 끄거나
격리 속성을 삭제하지 않아야 합니다. OS가 요구하는 사용자 확인은 사용자가 직접
수행하고, 조직 정책으로 금지된 환경에서는 진행을 중단하세요.

## 처음 사용하는 순서

0.1.0이 이미 설치되어 있다면 아래의 신규 설치를 반복하지 않고
[0.1.0 → 0.1.1 업데이트](docs/alpha-installation.md#9-백업업데이트복원)를 따르세요.
기존 앱 디렉터리는 그대로 두고 정상 종료 후 내부 파일을 교체하며,
프로젝트·토큰·언어 선택과 Figma 플러그인의 등록 경로를 보존합니다.

1. [0.1.1 알파 릴리스](https://github.com/neocjmix/figma-semantic-bridge/releases/tag/v0.1.1-alpha)에서
   설치 파일과 `SHA256SUMS`를 받고 체크섬을 확인합니다.
2. DMG를 열어 `Figma Semantic Bridge.app`을 `/Applications`에 복사하고 실행합니다.
3. 먼저 **Load demo**로 계정 없이 화면 표시·저장·재실행을 확인할 수 있습니다.
4. 앱의 **Reveal Figma Plugin**을 누르거나 플러그인 ZIP을 고정된 위치에 풉니다.
   Figma Desktop의 **Plugins → Development → Import plugin from manifest**에서
   해당 폴더의 `manifest.json`을 고릅니다.
5. 앱의 **Copy Pairing Token**으로 복사한 뒤 Figma 플러그인의 **Pairing token**에 붙여넣고
   **Connect**를 누릅니다. 토큰은 비밀번호처럼 다루며 채팅·로그·URL에 넣지 않습니다.
6. 사용 권한이 있는 Figma 파일에서 작은 Frame 하나를 선택하고 앱의
   **Capture Figma selection**을 누릅니다.
7. 영역을 만들고 저장한 뒤 출처를 검토합니다. 모호한 출처는 **Confirm sources**로
   확인하고, 의미와 요구사항까지 검토한 후 **Approve annotation**을 누릅니다.
8. 승인된 결과를 내보내거나 아래 MCP 설정으로 코딩 에이전트에 연결합니다.

메뉴 위치가 다른 Figma 버전, 기존 개발 서비스와의 충돌, 가져오기·내보내기,
백업·업데이트·제거 절차는 [설치 가이드](docs/alpha-installation.md)를 따르세요.

**플러그인 배포 방식:** 이번 알파는 위의 Figma Desktop 로컬 가져오기 방식입니다.
사용자가 플러그인을 빌드할 필요는 없습니다. 현재 구현의 원본 파일 식별 API가
Figma private-plugin 기능에 의존하므로 Community 등록을 마친 플러그인이라고
주장하지 않습니다. 회사의 비공개 플러그인 배포는 별도의 등록·권한 확인이 필요합니다.

## AI 에이전트에게 설치를 맡기려면

아래 요청과 이 저장소/릴리즈 링크를 함께 전달하세요.

> Figma Semantic Bridge 0.1.1 Alpha를 설치하고 실무 사용 준비를 해줘.
> 먼저 README와 docs/alpha-installation.md를 읽고, 현재 OS/CPU와 기존 설치·데이터·
> 4177 포트 사용 여부를 확인해. 릴리즈 설치 파일의 체크섬을 검증한 뒤 앱과
> 미리 빌드된 Figma 플러그인을 설치해. 기존 프로젝트와 MCP 설정을 보존하고,
> 토큰을 출력하지 말아줘. 앱의 데모 저장·재실행, 허용된 Figma Frame의 읽기 캡처,
> JSON 내보내기/캡처 가져오기, MCP 목록·승인 문맥 읽기를 실제로 검증해.
> 회사 파일을 외부 AI로 보내거나 의미·출처를 대신 승인하지 말아줘.
> 사람의 OS 승인이나 로그인·파일 접근 권한이 필요한 단계만 나에게 요청하고,
> 성공한 단계·실제 블로커·데이터 위치·다음 실행 방법을 기록해줘.

설치 완료의 기준은 파일 복사만이 아닙니다. 상세 가이드의 인수 체크리스트를
실제로 실행하고, 미검증 항목을 성공으로 표시하지 않아야 합니다.

## MCP 연결

앱을 켠 상태에서 MCP 클라이언트에 다음 실행 파일과 인수를 등록합니다.
호스트의 Node 설치나 토큰을 설정 파일에 직접 넣을 필요가 없습니다.

```json
{
  "mcpServers": {
    "figma-semantic-bridge": {
      "command": "/Applications/Figma Semantic Bridge.app/Contents/Resources/runtime/node",
      "args": ["/Applications/Figma Semantic Bridge.app/Contents/Resources/app/mcp.mjs"]
    }
  }
}
```

위 JSON은 해당 형식을 사용하는 클라이언트용 예시입니다. Codex의 TOML 설정 예시,
기존 설정을 보존하는 방법과 실제 도구 호출 확인은
[설치 가이드](docs/alpha-installation.md)에 있습니다. MCP 서버는 기본 데이터 폴더의
토큰을 직접 읽습니다. `list_projects`와 `get_approved_context`부터 확인하세요.
승인 전 문맥이 비어 있는 것은 정상일 수 있습니다.

## 데이터와 알파의 범위

- 프로젝트·이미지·원문·승인 이력은 `~/.figma-semantic-bridge`에 저장합니다.
  앱 교체나 재설치가 이 폴더를 지우지 않습니다. 백업에는 민감한 원문과 토큰이
  포함되므로 안전한 로컬 저장소를 사용하세요.
- 로컬 서비스는 `127.0.0.1:4177`에만 바인딩하고 인증을 요구합니다.
  네트워크 전체에 노출하거나 공개 프록시로 연결하지 않습니다.
- 선택한 범위만 읽습니다. 전체 파일의 JSON 덤프나 전체 페이지 사전 로딩을
  요구하지 않습니다. 이미 가져온 캡처의 검토에는 Figma/Dev Mode가 필요 없습니다.
- Section은 메타데이터만 가져옵니다. 이미지가 필요하면 회전하지 않은 내부
  Frame을 선택하세요. 겹침·양의 투명도·개별 노드 이미지만으로 최신 버전이나
  실제 화면 기여도를 확정하지 않습니다.
- 다른 소유자의 읽기 전용 파일과 Dev 전용 계정 조합은 별도 검증이 남아 있습니다.
  소유한 시험 파일에서의 성공을 그 권한 조합의 보장으로 간주하지 않습니다.
- 독립 사용자 정확도·생산성 평가, 회사 정책 승인, Apple 공증과 Figma Community
  공개 배포는 완료된 것으로 주장하지 않습니다. 알파 사용은 허용된 자료로 시작하세요.

[기존 기능의 검증 기록](docs/product-validation.md)
· [완료 항목과 외부 의존](docs/completion-status.md)
· [배포 경계와 보안 설명](docs/release-readiness.md)

## 0.1.1 후보에서 확인한 것

**198개 Node 테스트·타입 검사·빌드, 27개 브라우저 테스트, 2개 fixture manifest와
native 정책·언어 자체 검사를 통과했습니다.** 앱 ZIP과 마운트한 DMG, 플러그인 ZIP,
버전 일치와 오프라인 안내를 실제 검사했습니다.

기존 앱과 플러그인 디렉터리를 유지하는 업데이트로 15개 프로젝트 파일과 토큰을
그대로 보존했습니다. 자동 페어링, 기존 한국어 선택, 언어 전환 중 미저장 혼합 언어 입력,
네 개 오프라인 가이드와 기존 Figma manifest 등록 재사용을 확인했습니다.
플러그인의 언어 전환은 연결을 유지했고, 설치된 번들 MCP에서 실제 선택 노드를
읽었습니다. 원본 Figma는 수정하지 않았습니다.
이전 0.1.0의 21개 노드 합성 캡처도 읽기 전용으로 열었고 프로젝트 파일은 그대로 유지됐습니다.

[0.1.1 관측 기록](docs/evaluation/release-0.1.1-acceptance.json)은 문서 최종 커밋 전
설치한 후보의 결과입니다. 최종 clean commit에서 다시 생성한 패키지의 revision과
asset SHA는 별도의 `figma-semantic-bridge-0.1.1-verification.json`으로 고정합니다.
이 관측을 새로 생성할 패키지의 실행 결과로 대신하지 않습니다.

## 이전 0.1.0 설치 앱에서 확인한 것

`/Applications/Figma Semantic Bridge.app`의 번들 Node로 실행하여 내장 편집기의
자동 페어링, 합성 주석 저장, native 저장 대화상자의 JSON/Markdown 내보내기,
두 캡처 bundle의 파일 저장·가져오기를 확인했습니다. 앱에 포함된 manifest를
Figma에 등록하여 Dev Mode의 소유 합성 파일에서 21개 노드와 800×600 PNG를 캡처했고,
설치된 번들 MCP로 `list_projects`와 `get_approved_context`를 읽었습니다.

호환되지 않는 기존 개발 서비스는 정확히 거부했습니다. 해당 시험 서비스만 명시적으로
중지·백업하여 전환했고 기존 6개 프로젝트는 보존했습니다. 앱 종료 후 자신이 시작한
4177 listener가 없어졌으며, 재실행 후 토큰·프로젝트·저장 주석이 유지됐습니다.
이는 실제 설치 앱 검증이며 독립 사용자 의미 평가나 다른 Mac의 최초 다운로드 검증은 아닙니다.
이전 다국어 기준선 검사는 **196개 Node 테스트·타입 검사·빌드, 27개 브라우저 테스트 통과**입니다.
한국어/영어 메뉴·화면 동기화, 미저장 입력 보존, 오프라인 가이드 네 개, 앱/플러그인
재실행 후 언어 유지도 확인했습니다. [다국어 검증 기록](docs/evaluation/bilingual-interface-acceptance.json)에 실제 관측과 한계를 기록했습니다.
이전 기록은 역사로 유지하며, 0.1.1의 별도 결과는 위의 관측과
[릴리스 노트](docs/releases/0.1.1.md)에 구분합니다.

## 소스에서 개발·패키징하기

이 절은 소스를 수정하는 개발자용입니다. 설치 파일 사용자는 실행할 필요가 없습니다.
Node.js 22 이상이 필요하며 macOS 앱 패키징에는 macOS Apple Silicon과 이미 설치·허가된
Command Line Tools가 필요합니다.

```sh
npm ci
npm run check
npm run fixtures:validate
npm run test:e2e
npm run package:plugin
npm run package:macos
npm run release:verify
```

최종 릴리스는 변경사항이 없는 커밋에서 `npm run package:macos`로 전체 빌드를
다시 수행한 뒤 `npm run release:verify -- --require-clean`으로 검증합니다.
검증 보고서가 source revision과 실제 검사한 asset SHA를 연결하는지 확인합니다.
`--skip-build`는 최종 후보 생성에 사용하지 않습니다.

개발용 실행은 `npm start`, UI 개발 서버는 `npm run dev:web`입니다.
릴리즈 앱은 컴파일된 정적 UI와 제품 런타임을 포함하며 Vite 개발 서버를 사용하지 않습니다.
패키징 결과는 `dist/releases/`에 생성됩니다. 게시 전 라이선스, 정확한 커밋,
서명 상태, 실제 패키지 검증과 자산 체크섬을 확인해야 합니다.

## 프로젝트 문서

- [설치·MCP·선택적 AI 개발 설정](docs/product-quickstart.md)
- [프로젝트 배경](docs/context.md) · [아키텍처](docs/architecture.md) · [파이프라인](docs/pipeline.md)
- [데이터 모델](docs/data-model.md) · [로드맵](docs/roadmap.md) · [타당성 검증](docs/feasibility.md)
- [앱 패키징 결정](docs/adr/0004-packaged-macos-alpha.md)
- [렌더링·사람 검토](docs/adr/0002-rendering-evidence-grounding.md)
- [캡처 이동](docs/adr/0003-portable-capture-bundles.md)
- [공개 샘플 조사](docs/research/public-figma-fixtures-2026-10-23.md) · [샘플 도구](docs/fixture-plugin.md)
- [에이전트 작업 규칙](AGENTS.md)

원본 디자인·사내 스펙·연결 토큰을 저장소에 커밋하지 않습니다.
프로젝트가 소유한 코드와 문서의 라이선스는 [MIT](LICENSE)입니다. 외부 Figma
디자인의 권리는 이 라이선스에 포함되지 않습니다. 포함된 제3자 소프트웨어의 라이선스는 설치 파일의
`THIRD-PARTY-NOTICES.md`와 원본 라이선스 파일을 확인하세요.
