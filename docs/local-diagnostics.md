# 로컬 진단 / Local diagnostics

## 한국어

앱의 **브리지 → 진단 로그 폴더 보기**에서 현재 로그를 연다. 기본 위치는
`~/.figma-semantic-bridge/logs/`다. 개발 서버에 `FSB_DATA_DIR`를 지정했다면 그
폴더의 `logs/`를 사용한다. 로그는 자동 전송되지 않는다.

- `server.ndjson`: HTTP 요청, 작업 종류, 검증 오류, Figma 명령과 진행·완료 시간.
- `native.ndjson`: 앱과 내장 서버의 시작·종료, 웹뷰 콘솔 경고·오류, 웹 실행 오류,
  파일 내보내기와 웹뷰 종료. 로컬 API가 응답하지 않을 때도 네이티브 기록은 가능하다.
- 일반 브라우저의 웹 오류는 인증된 로컬 진단 API를 거쳐 `server.ndjson`에 기록된다.

오류 화면에 표시된 요청 ID를 검색하면 해당 요청과 실패 지점을 연결할 수 있다.
ID는 매 요청마다 서버가 생성하며 `X-FSB-Request-Id` 응답 헤더에도 담긴다.

```sh
tail -f ~/.figma-semantic-bridge/logs/server.ndjson ~/.figma-semantic-bridge/logs/native.ndjson
rg '요청-ID를-여기에' ~/.figma-semantic-bridge/logs/*.ndjson
rg '"level":"error"' ~/.figma-semantic-bridge/logs/*.ndjson
```

각 줄은 JSON이다. `time`, `version`, `sessionId`, `source`, `event`, `level`이
실행 환경을 식별한다. 서버와 네이티브의 `sessionId`는 별도 실행을 구분하며
서로 같은 값일 필요가 없다. 두 파일은 요청 ID와 시각·버전으로 연결한다.
Figma 명령은 별도의 `pluginRequestId`, 명령 종류, 노드·바이트 수와 시간을 남긴다.
작업 공간·Figma 파일·노드의 실제 식별자와 이름은 기록하지 않는다.

HTTP 기록은 식별자를 제거한 `route`, `method`, `operation`, `status`,
`durationMs`를 포함한다. 오류에는 `code`, 안전한 고정 검증 이유 `reason`,
필드 경로와 제한값 `issues`, 앱 내부 호출 위치 `frames`가 추가된다.
응답 완료 전에 연결이 닫힌 요청은 `status: 499`, `state: cancelled`로 기록한다.
499는 진단용 표시이며 이미 닫힌 연결에 전송한 HTTP 응답은 아니다.
취소·연결 종료·잘못된 입력을 의도적으로 시험하면 오류 기록이 남는 것이 정상이다.
QA 보고서에는 시험에서 의도한 오류와 예상 밖 오류를 나누어 기록한다.

콘솔 인수, 오류에 섞인 임의 문자열, 요청·응답 본문, 인증 헤더, 토큰, 원문,
이미지, 검색어와 사용자 파일 경로는 저장하지 않는다. 콘솔은 단계·인수 개수와
호출 위치를 기록하므로 디자인 내용이 포함된 콘솔 메시지를 그대로 재생하지 않는다.
이 때문에 임의 JavaScript 오류의 원문 대신 오류 종류와 호출 위치를 확인한다.
더 상세한 로컬 검사가 필요하면 **브리지 → 웹 검사 활성화**를 켠 뒤 Safari의
개발자 도구를 사용한다(macOS 13.3 이상). 검사기는 디자인과 인증 정보에 접근할 수
있으므로 검사기 화면·전체 덤프를 공유하지 않는다. 기본 상태는 꺼짐이다.

배포 JavaScript의 호출 위치는 번들 파일의 줄·열이다. 현재 배포에는 소스맵을
넣지 않으므로 원본 TypeScript로 자동 변환되지 않는다. 동일 버전의 정확한 번들과
커밋을 보존해 대조한다. 개발 환경은 소스 파일 위치를 제공할 수 있다.

로그는 기록기별 현재 파일과 이전 4개, 파일당 최대 5MB로 순환한다. 7일보다 오래된
서버 기록은 시작 시, 네이티브 기록은 다음 기록 시 정리한다. 폴더 권한은 0700,
파일은 0600이다. 일반 이벤트와 오류에는 별도 속도 제한이 있으며 오류용 여유를
남긴다. 기록 장치 오류나 대량 로그가 편집을 막지 않도록 기록은 최선형이다.
로그가 없다고 오류가 없었다고 단정하지 않는다. 진단 API는 로그 내용을 반환하거나
자동 업로드하지 않는다.

## English

Open **Bridge → Reveal Diagnostic Logs**. The default location is
`~/.figma-semantic-bridge/logs/`, or `logs/` inside a development server's
`FSB_DATA_DIR`. Nothing is uploaded automatically.

- `server.ndjson` records HTTP requests, operation types, validation failures,
  Figma commands, progress counts and elapsed time.
- `native.ndjson` records app/runtime lifecycle, WebView console warnings and
  errors, JavaScript failures, native exports and renderer termination. This path
  works even when the local API is unavailable.
- A normal browser sends safe events to the authenticated local diagnostics API;
  those events appear in `server.ndjson`.

Search for the request ID shown with an error. The server generates a fresh ID for
each request and returns it in `X-FSB-Request-Id`.

```sh
tail -f ~/.figma-semantic-bridge/logs/server.ndjson ~/.figma-semantic-bridge/logs/native.ndjson
rg 'paste-request-id-here' ~/.figma-semantic-bridge/logs/*.ndjson
rg '"level":"error"' ~/.figma-semantic-bridge/logs/*.ndjson
```

Each JSON line includes `time`, `version`, `sessionId`, `source`, `event` and
`level`. Server and native session IDs identify separate process runs; correlate
the files by request ID, time and version. Plugin commands have their own
`pluginRequestId`, command type, node/byte counts and duration. Actual workspace,
Figma file and node identities and names are omitted.

HTTP events include an identifier-free `route`, `method`, `operation`, `status`
and `durationMs`. Errors add `code`, a safe fixed validation `reason`, `issues`
containing field paths and bounds, and application-relative `frames`. Cancellation
before a response completes is recorded as `status: 499` with
`state: cancelled`; this is a diagnostic marker, not a response sent on the closed connection.
Intentional cancellation, disconnection and invalid-input tests produce expected errors.
Record expected and unexpected failures separately in QA reports.

Logs exclude console arguments, arbitrary error text, request/response bodies,
authorization headers, tokens, original text, images, search terms and user file
paths. Console observations retain argument counts and call sites, so they do not
replay design content. Arbitrary JavaScript failures retain their type and call
sites rather than their raw message. For deeper local inspection, enable
**Bridge → Enable Web Inspector** and use Safari's developer tools on macOS 13.3
or later. The inspector can access design and authentication data; do not share
its screen or full dumps. Inspection is disabled by default.

Release stack frames identify bundled JavaScript lines and columns. Source maps
are not included in the current package, so frames do not automatically resolve
to TypeScript. Keep the exact version's bundle and commit for comparison.
Development builds may expose source locations.

Each writer keeps the current file and four rotations, up to 5MB per file.
Server files older than seven days are removed at startup; native files are
pruned on the next write. Directory mode is 0700 and file mode is 0600. Errors
have a reserved rate quota separate from normal events. Logging is best effort:
storage failures and floods must not block editing, and missing logs do not prove
that no error occurred. The diagnostic API neither serves the logs nor uploads
them.
