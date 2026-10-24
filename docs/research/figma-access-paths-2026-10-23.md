# Figma 읽기 전용 접근 경로와 공개 샘플 검증

확인일: 2026-10-23 KST. 캡처·렌더링 증거 추가 확인: 2026-10-24 KST. 목적은 원본을 수정하지 않고 선택 영역의 ID·부모관계·좌표·원문·PNG를 확보하는 것이다. **라이선스 → 실제 접근 → 기능 완주** 순으로 판정한다. 사본 접근과 원본 can-view 권한은 별도 검증이다.

## 현재 판정

**공개 샘플 복제는 가능하다. Bonafide 사본 생성과 Desktop Dev Mode의 범위 제한 캡처를 실제 확인했다.** Dev Mode가 없는 Design can-view에서는 플러그인을 실행할 수 없지만, 앱 전체가 편집 권한을 요구해야 한다는 뜻은 아니다. 별도의 수집 경로로 저장된 자료의 로컬 검토를 제공할 수 있다.

| 경로 | 구조적 판정 | 실제 확인과 남은 조건 |
| --- | --- | --- |
| Design + can-view + Dev Mode 없음 | 현재 플러그인 수집 경로 미지원 | 공식 문서가 플러그인에 can-edit를 요구. 같은 실행을 반복하지 않음 |
| Dev Mode + 해당 파일에서 유효한 Full/Dev seat + can-view | 원본 편집 없이 Inspect 플러그인 사용 가능 | 소유 synthetic에서 캡처·연결·선택 확인 완료. **외부 원본의 can-view / Dev seat만 가진 계정은 미검증** |
| 허용된 Community 사본 | 시험용 fixture 확보 가능 | Bonafide 사본의 Desktop Dev 캡처 성공: 270 nodes, 85 TEXT, 360×800 PNG |
| 범위 제한 캡처 묶음 전달 | 읽기 전용 소비자 지원 구현 | 1~2개 Snapshot JSON/PNG 내보내기·새 작업 공간 가져오기 완료. 실제 사본의 UI+설명을 Figma 단절 상태에서 복원·MCP 조회 검증 |
| REST 선택 노드 가져오기 | 조건부 가능 | 원본 접근권한·인증·quota 필요. 새 adapter와 실제 can-view 검증 필요 |
| 공식 remote MCP | 일부 읽기 기능의 보조 경로 | 링크 기반 조회와 호출 제한. 현재 연결 도구의 외부 파일 권한 오류는 해소되지 않음 |

Design can-view의 속성·텍스트 열람과 내보내기는 가능하지만 플러그인은 can-edit를 요구한다. Dev Mode는 편집권한 없는 개발자를 위한 읽기 전용 표면이며, Inspect 플러그인의 문서 읽기·이벤트·네트워크·export를 지원한다. 파일의 복사/내보내기 제한은 별도로 존중한다. [검사 가이드][inspect], [Dev 플러그인][dev], [복사 제한][restrict]

## 공개 파일의 복제 조건

무료 Community 파일은 CC BY 4.0을 적용하며, 출처·제작자·라이선스·변경 여부를 보존해 복제·수정할 수 있다. 일반 공개 링크 파일에는 이 라이선스를 자동 적용하지 않는다. CC BY가 내장 사진·폰트·브랜드의 모든 권리를 보장하거나 상표권을 부여하지는 않는다. [Figma 라이선스][license], [CC BY 4.0][cc], [법률문 권리 범위][cclegal]

| 후보 | 현재 이용 근거 | 실행 결과와 용도 |
| --- | --- | --- |
| [Bonafide][bonafide] / Diego Villarroel | CC BY 4.0, Open in Figma, 제작자의 교육용 복제 설명을 현재 페이지에서 직접 확인 | **개인 계정 Drafts 사본 1개 생성 성공.** 실제 화면과 Dev Mode 접근 확인. 첫 범위 제한 시험 대상으로 선택 |
| [TATA NEU][tata] / Nayan | 현재 공개 페이지의 CC BY 4.0·Open in Figma 확인 | 다음 규모 시험 후보. 아직 복제하지 않음 |
| [Open Collective Production Ready][oc] | 일반 공유 파일이며 디자인 이용 라이선스 미확인 | 열람 가능, Dev 메뉴 비활성 관찰. 복제·다운로드는 보류 |

Bonafide 사본의 `High-fidelity wireframes + Proto` 페이지와 Login 프레임을 실제 열었다. 프레임 크기는 360×800이고 Design 속성 화면에서 X=-3517, Y=-3397을 확인했다. 브라우저와 Desktop에서 Dev Mode 진입을 확인한 뒤 기존 로컬 플러그인으로 이 프레임만 캡처했다.

| 실제 캡처 항목 | 결과 |
| --- | --- |
| 예산 | 1,000 nodes / metadata 500,000 bytes / 5초 / PNG 최대 변 1,024px |
| 읽은 범위 | Login subtree 270 nodes, TEXT 85개, complete=true |
| 저장 데이터 | 노드 JSON 61,015 bytes, PNG 360×800 / 29,757 bytes |
| 무결성 | 선택 file/page/root·BBox 보존, 각 노드 provenance 일치, HTTP 재조회와 디스크 일치 |
| MCP | root와 화면에서 확인한 텍스트 4개를 캐시에서 읽고 저장 원본과 일치 확인 |
| 시각 확인 | Desktop과 PNG의 화면 구성을 비교하고 눈에 보이는 텍스트 4개를 대조. 정밀 픽셀 오차·전체 원문 독립 검증은 미수행 |

**화면 밖 자식 노드가 실제 포함됐다.** 캡처된 213개 노드와 그중 67개 TEXT의 BBox가 선택 프레임과 양의 면적으로 교차하지 않는다. 이 프레임은 clipping 경고를 반환했다. 85개 TEXT를 전부 화면에 보이는 글로 취급해서는 안 된다. 이는 BBox 진단이며 opacity·paint order·가림을 판정한 결과가 아니다. preview는 선택 subtree 밖의 겹친 형제를 제외하므로 외부 덮개도 별도 검증해야 한다.

**이번 Desktop에서는 Plugins → Inspect 전환 시 연결이 종료됐다.** Plugins로 돌아오면 실행 목록이 표시됐고 플러그인을 다시 열어 페어링한 후 연결을 복원했다. 연결이 없는 동안에도 저장된 화면·원문 MCP 조회는 가능했다. 실시간 선택을 사용하려면 플러그인이 실행 중이어야 한다는 UX 조건을 유지한다. 단일 실행의 수명주기 관찰이며 모든 Figma 버전의 동작을 단정하지 않는다.

사본 URL/fileKey, 선택 page/node ID, 출처 표시, 화면 증거는 Git에서 제외된 `.bridge-local/public-fixture-access-report.json` 및 `.bridge-local/bonafide-copy-dev-proof.png`에 보관한다. 원본과 사본의 ID를 동일시하지 않는다. 원본 디자인은 수정하지 않았고, 사본도 선택·보기 모드 전환만 했다. 사본은 원본의 댓글·버전 이력·권한·이후 변경을 승계하지 않는다. [공식 복제 절차][duplicate]

원본 자산의 공개 재배포를 승인한 것은 아니다. 저장소의 공개 fixture/CI는 synthetic 원칙을 유지한다. 기존 `fixtures/public/manifest.json`과 evaluation JSON은 2026-10-22 UTC 평가 시점의 기록이며, 사본의 개인 식별자를 공개 registry에 추가하지 않는다. 최신 접근 결과는 이 문서와 로컬 보고서가 보완한다. 공개 후보의 제품 캡처는 사본 1개/Login·설명 Section·안쪽 설명 Frame 세 범위다. Login과 안쪽 Frame은 PNG까지 성공했고 설명 Section은 원문·구조만 성공했다. 별도 fixture analyzer의 전체 지표·독립 의미 라벨링에 따른 승격은 아직 0개다.

## 샘플 제한과 플랫폼 제한 구분

1. **확정된 플랫폼 조건:** Dev Mode 없는 Design can-view에서 플러그인 실행은 지원되지 않는다. 개발용 플러그인이라는 이유로 이 조건이 면제된다는 근거도 없다. [검사 가이드][inspect]
2. **확정된 연결 계정 상태:** MCP 계정 조회는 Professional의 Full seat를 반환했다. 이 조회만으로 별도 Browser/Desktop 로그인 계정의 seat를 확정하지 않는다. 이번 UI에서 확인한 것은 Dev Mode 동작과 소유 사본이며, Dev seat만 보유한 사용자 검증은 아니다. 계정/팀 식별자는 공개 문서에 저장하지 않는다.
3. **샘플별로 남은 조건:** Open Collective는 can-view/comment와 Dev 메뉴 비활성만 확인했다. 소유 플랜·해당 파일에 적용되는 seat·조직 정책 중 무엇 때문인지는 불명이다. Bonafide 사본에서 성공한 것으로 원본 실패 원인을 특정하지 않는다.
4. **seat의 적용 범위:** 유료 seat 구매가 모든 외부 파일의 Dev 사용을 보장하지 않는다. 파일의 플랜과 사용자의 적용 seat를 함께 확인해야 한다. connected folder는 별도 관리자 설정을 갖는 협업 경로다. [seat 관리][seats], [connected folders][connected]

## Dev Mode 없는 사용자를 위한 대안

### 구현·검증한 경로: 캡처 묶음 가져오기

권한 있는 디자이너 또는 Dev 사용자가 원본에서 선택 범위만 캡처한다. 수신자는 Snapshot과 PNG를 포함한 단일 JSON 묶음을 로컬 앱에 가져와 원본 ID, 좌표, 원문을 유지하면서 주석·매칭·사람 확인·MCP 제공을 수행한다. 원본 링크로 Figma에서 대상을 확인한다. 새 선택의 실시간 조회와 재캡처에는 제공자의 후속 캡처가 필요하다.

[ADR 0003](../adr/0003-portable-capture-bundles.md)에 따라 **Capture transfer**를 구현했다. 선택한 1~2개 캡처를 compact JSON으로 내보내고, 항상 새 로컬 작업 공간으로 가져온다. 15 MB 파일·노드 JSON 합계 4 MB·총 10,000 nodes 제한, SHA-256·출처·부모관계·root BBox·PNG 헤더 검증을 적용한다. 체크섬은 원본 진위나 실제 렌더링 증명이 아니다. 주석·명세·승인·AI 제안은 전달하지 않는다. 소비자에게 필요한 것은 로컬 서버 페어링이며 Figma 연결·Dev Mode는 필요 없다. 원본에서 만든 묶음과 사본에서 만든 묶음의 식별자도 그대로 구분한다.

실제 Chrome에서 Bonafide 두 캡처(107,382 bytes)를 다운로드하고 Figma 단절 상태에서 새 작업 공간으로 가져왔다. 291 nodes·92 TEXT·Login PNG·설명 PNG 부재·모든 경고가 저장 원본과 정확히 같았다. 디스크 저장, 새로고침 복원, 두 범위의 MCP 원문 조회와 빈 approved context를 확인했다. 기존 작업 공간과 승인 기록도 변하지 않았다. Chrome 확장 파일 선택은 별도 file-URL 권한 때문에 실패했지만 기본 macOS 파일 선택창으로 완료했으며 권한 설정은 바꾸지 않았다.

두 번째 범위는 별도 User stories 페이지의 섹션이다. 21 nodes·7 TEXT·4,841 metadata bytes가 complete로 읽혔고, Desktop 화면의 제목·번호·세 문장과 원문을 대조했다. 계정 보유에 관한 사용자 요구는 있으나 Login의 구체 동작 규칙까지 명시한 것은 아니므로 자동 명세 연결·승인을 하지 않았다. **PNG는 요청한 1,024px 예산을 초과해 거절되어 null로 남았다.** 노드 추출 complete와 미리보기 성공은 별도다.

2026-10-24 후속 진단에서 Section BBox 1119×686에 scale=0.9151027703306523을 요청했으나, 예상 1024×627.76 대신 **1098×701** PNG가 반환된 것을 확인했다. 단순 1px 반올림 차이가 아니다. 원인과 이미지 원점은 미확정이며, 한도 상향이나 추정 padding으로 좌표를 맞추지 않는다. 실패 경고에는 실제·예상 치수와 안쪽의 회전하지 않은 Frame을 명시적으로 선택하라는 안내를 추가했다.

같은 사본의 안쪽 설명 Frame을 따로 선택했을 때 **2 nodes / 1 TEXT / 607 metadata bytes / PNG 658×81, 5,884 bytes**가 같은 예산 안에서 정상 캡처됐다. Frame·TEXT의 opacity=1과 TEXT의 siblingIndex=0을 실제 수집했다. Desktop 화면과 문장·레이아웃을 대조했으며 정밀 픽셀 diff는 수행하지 않았다. 캡처 밖 부모를 읽지 않았기 때문에 렌더링 상태는 unknown으로 유지하고, 새 proposed 주석은 기하적 ambiguity=false여도 사람의 source confirmation을 요구했다. 원본·사본 내용을 수정하거나 의미 승인을 하지 않았다.

[ADR 0002](../adr/0002-rendering-evidence-grounding.md)의 최소 opacity 수집·상태 표시·자동 후보 제외가 구현됐다. hidden/transparent는 자동 후보에서 제외하되 원문과 수동 선택을 보존한다. 이 실제 Frame은 양의 opacity 관측 사례이며, opacity=0·숨긴 조상에 대한 제외 규칙은 synthetic 테스트로 검증했다. 다른 노드에 덮인 정도나 구버전 여부를 판정하는 기능은 아직 없다.

### Figma 연계 시각 검토: 현재 노드 이미지 비교

2026-10-24에는 **Compare current export**를 추가하고 같은 사본에서 실제 검증했다. 저장된 합성 crop과 현재 노드/subtree PNG를 각각의 관측 시각과 함께 보여준다. 안쪽 Frame은 Chrome에서 658×81 PNG로 표시됐고 TEXT는 530×17 / 5,950 bytes로 반환됐다. 선택 상태와 기존 로컬 프로젝트의 revision·이력·확인·승인은 변하지 않았다. 원본의 visibility/opacity·순서·내용을 변경하지 않는다.

요청은 저장된 캡처의 명시적 노드 하나와 현재 파일·페이지·연결에 한정한다. 1,024px / 2,000,000 bytes / cooperative 5초로 제한하고 관측된 메타데이터 변경은 거절한다. 하위 노드·paint·외부 조상 변화는 전부 검출하지 못하므로 과거 이미지의 재현이나 가림 증명이 아니다. 외부 형제는 제외되며 조상 opacity·mask·clip·blend 영향과 빈 이미지 원인은 미확정이다. 기존 Section 실패는 다시 시도하지 않았다. 실제 hidden/masked 사례와 외부 can-view 권한은 별도 검증 대상으로 남는다.

### 독립 수집이 필요할 때: REST adapter

원본에 접근 가능한 OAuth/PAT와 `file_content:read` 범위로 선택한 node IDs의 구조·TEXT·좌표와 PNG를 가져오는 경로가 있다. `files/:key/nodes`에 `ids`와 얕은 `depth`를 지정하고 필요한 하위 범위만 확장하는 방식부터 검증한다. 페이지·조상 식별자는 실제 응답에서 확인해야 한다. `files/:key?ids=…`는 관련 의존 노드와 최상위 페이지를 포함할 수 있으므로 요청 ID만으로 엄격한 응답 범위를 보장하지 않는다. node·byte·시간 상한과 중단 처리가 필요하다. [파일 endpoints][rest], [노드 속성][nodes], [인증][auth]

PNG와 노드 정보는 같은 버전으로 요청하고 export bounds/scale/clipping을 실제 비교해야 한다. REST는 현재 사용자의 Figma 선택 이벤트나 원본 선택 조작을 제공하지 않으므로 링크 입력과 재가져오기 UI가 필요하다.

현재 공식 표는 View/Collab의 Tier 1을 월 최대 20회로 표시하나 같은 문서의 예시는 6회를 쓰고, 실제 할당은 더 낮을 수 있다고 명시한다. 고정 용량으로 가정하지 않는다. quota는 원본 파일의 플랜과 사용자의 seat에도 의존하므로 다른 팀에서 유료 seat를 가진 것만으로 해결되지 않는다. 캐시·명시적 새로고침을 사용하고 429에는 Retry-After를 따른다. [REST 제한][rates]

### 보조 경로

- **공식 remote MCP:** 링크를 통한 메타데이터·스크린샷 조회를 지원하고 View seat에도 제한된 호출을 허용한다. 공식 권한 진단은 계정이 파일 소유 플랜에 속하는지도 확인하도록 안내하므로 공개 링크만으로 접근을 보장하지 않는다. 경량 XML은 앱의 전체 Snapshot 계약을 보장하지 않으며, 원격 링크 조회는 Desktop 선택 이벤트와 다르다. 이 환경에서 기존 외부 파일 호출은 편집권한 오류를 반환했다. 현재 연결 도구의 동작을 일반 공식 MCP 지원 범위와 동일시하지 않는다. 회사 디자인을 외부 모델에 보내는 사용은 별도 승인이 필요하다. [MCP 제한][mcprates], [도구 출력][mcptools], [원격 설치][mcpremote]
- **링크·PNG 수동 반입:** 시각적 검토는 가능하지만 자동 자식 트리·부모관계·정확한 원문 grounding을 대체하지 못한다. 별도 기능 축소 모드로만 고려한다.
- **.fig 저장/재가져오기:** 복사 허용 파일의 백업·사본 시험용이다. 원본에 연결된 실시간 경로가 아니며 독자적인 바이너리 파서를 주 수집 경로로 삼지 않는다. [로컬 사본][localcopy]

## 다음 실행과 중단 기준

1. Bonafide UI+설명 수집·이동과 안쪽 설명 Frame의 PNG 경로를 검증했다. Section의 실제 반환 치수는 확인했으나 원점·범위 불일치 원인은 남아 있다. 동일한 실패를 반복하기 전에 Section export 좌표 계약을 규명해야 한다. 정밀 픽셀 대응, 가림 판정과 fixture analyzer의 지표는 별도 남은 항목이다.
2. 기존 유료 팀에서 **실제로 can-view인 원본**을 확보했을 때 Dev Inspect의 읽기·export·선택/이동을 검증한다. 필요한 파일/seat 조건을 확보하지 않고 can-edit 사본의 성공으로 대체하지 않는다.
3. no-Dev 소비자의 로컬 검토는 캡처 묶음으로 지원한다. 수집자 도움 없이 직접 읽는 요구가 있으면 REST의 단일 scope 실험을 추가한다. 현재 묶음 전달은 원본 권한을 우회하거나 최신 원본을 자동 동기화하지 않는다.

복사 금지, API 403, 비활성 Dev 메뉴, quota 초과에 같은 요청을 반복하거나 우회 경로를 만들지 않는다. 라이선스 불명은 복제 중단, 인증/권한 부족은 해당 수집 경로 중단, 좌표·출처 불명은 grounding 승인 중단, 예산 초과는 명시적 partial 결과로 처리한다. 이 원칙은 opacity 0·겹침·가려진 구버전 등 시각적 모호성 검증에도 적용한다. 읽기 경로 확보만으로 가림 판정이 구현된 것은 아니다.

[inspect]: https://help.figma.com/hc/en-us/articles/22012921621015-Guide-to-inspecting
[dev]: https://developers.figma.com/docs/plugins/working-in-dev-mode/
[restrict]: https://help.figma.com/hc/en-us/articles/360040045574-Restrict-copying-and-sharing-on-files
[license]: https://help.figma.com/hc/en-us/articles/360042296374-Figma-Community-copyright-and-licensing
[cc]: https://creativecommons.org/licenses/by/4.0/
[cclegal]: https://creativecommons.org/licenses/by/4.0/legalcode.en#s2b
[duplicate]: https://help.figma.com/hc/en-us/articles/360038510873-Duplicate-Community-files
[bonafide]: https://www.figma.com/community/file/1437922574500111933/caso-de-estudio-bonafide-app-ui
[tata]: https://www.figma.com/community/file/1148330409355808941/tata-neu-super-app-ux-case-study-product-redesign
[oc]: https://www.figma.com/file/ZQBMWhnGGtRWeIZknFW1eP/OC-Design-Production-Ready-%E2%9C%85?node-id=10902%3A0
[seats]: https://help.figma.com/hc/en-us/articles/360039960434-Compare-and-manage-seats-in-Figma
[connected]: https://help.figma.com/hc/en-us/articles/30124855491863-Guide-to-connected-folders
[rest]: https://developers.figma.com/docs/rest-api/file-endpoints/
[nodes]: https://developers.figma.com/docs/rest-api/file-node-types/
[auth]: https://developers.figma.com/docs/rest-api/authentication/
[rates]: https://developers.figma.com/docs/rest-api/rate-limits/
[mcprates]: https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/
[mcptools]: https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/
[mcpremote]: https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/
[localcopy]: https://help.figma.com/hc/en-us/articles/8403626871063-Save-a-local-copy-of-files
