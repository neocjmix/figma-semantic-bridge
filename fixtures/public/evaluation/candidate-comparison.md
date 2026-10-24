# 공개 Figma Fixture 기술 평가

2026-10-23 후속 실행: Bonafide 사본 생성과 Login 한 프레임의 제품 캡처가 성공했다. 아래 표와 manifest는 초기 평가 시점의 기록이다. 최신 결과와 권한별 제약은 [접근 경로 검증](../../../docs/research/figma-access-paths-2026-10-23.md)을 참조한다. 사본의 개인 식별자와 캡처는 공개 registry에 추가하지 않는다.

검증일: 2026-10-22 UTC. 이 시각은 Asia/Seoul에서 2026-10-23이다. 기존 [Work 조사](../../../docs/research/public-figma-fixtures-2026-10-23.md)는 저장소 기준 커밋 `5ea3703`에서 복원했다. 신규 후보를 추측해 늘리지 않고, 기존 17개 중 우선순위 5개를 재평가했다. 현재 결과와 과거 조사 결과를 구분한다.

**최종 추천은 아래 5개 조건부 후보이며, 실전 파일의 내부 구조 검증 완료는 0개다.** 공개 소개·라이선스 표시 4개와 실제 제품 개발 이슈 2개를 이번 실행에서 재확인했다. 원본 데이터·캔버스 이미지·원문 스펙은 커밋하지 않았다. 파일별 상태는 [manifest](../manifest.json), 조회 근거는 [research-evidence.json](research-evidence.json)에 기록한다. 기존 synthetic fixture는 실전 후보와 별도 대조군으로 유지한다. 실제 synthetic 실행은 [구조 측정](../../synthetic/live-figma-measurements.json)과 [이미지·구조 정성 검토](../../synthetic/live-visual-review.md)에 별도 기록하며 공개 실전 파일 검증 수에 합산하지 않는다.

## 증거 해석

- **관찰 사실:** 이번 도구 호출이 반환한 공개 소개문, 라이선스 표시, 개발 이슈 링크, 접근 오류. 소개문을 읽었다는 사실과 소개문의 내용이 실제 파일 안에 있다는 주장은 다르다.
- **제작자 주장:** 화면 수, 흐름 수, 파일에 포함된 작업물의 종류. 에디터의 노드 수·페이지 수·스펙 TEXT 수로 바꾸어 쓰지 않는다.
- **LLM 판단 / 테스트 가설:** 그 자료가 의미론적 경계나 스펙 연결 시험에 유용할 가능성. 사람이 승인한 분할 정답이나 실제 정성 평가 결과가 아니다.
- **not measured / 미검증:** 실제 노드·이미지·실행 결과가 없어 결론을 내릴 수 없는 항목. 부재나 실패를 의미하지 않는다.

이 평가는 크기 점수를 합산하지 않는다. 많은 화면이 규칙·상태·설명 연결의 어려움을 보장하지 않기 때문이다. 불규칙 Frame/Group/Component 계층과 깊이를 직접 보기 전에는 복잡도를 높게 판정하지 않는다.

## 최종 추천 5개 비교

| 후보 / 출처 | 이번에 관찰한 공개 근거 | 제작자 주장 또는 외부 개발 맥락 | LLM의 예상 테스트 가치 | 이용 조건·접근 및 채택 조건 |
|---|---|---|---|---|
| [TATA NEU][tata] / Nayan | live 본문, `Open in Figma`, `CC BY 4.0` 표시 | 사용자 조사 기반 재설계, 60+ 화면, 쇼핑·결제·약국·스토리·숏비디오·프로필 | 서로 다른 도메인의 선택 범위 분리, UI copy와 설명의 경계 | 실제 서비스의 공식 원본으로 확인하지 못했다. 사례 설명이 외부 링크/단일 이미지인지 검사해야 한다. 복제 실행·노드 구조 미검증 |
| [Bonafide][bonafide] / Diego Villarroel | 초기 shell 이후 3초 hydration 재조회에서 전체 EN/ES 본문·복제 학습 의도·버튼·CC BY 표시 | 대학 프로젝트. 가입, 배송 구매, 게이미피케이션 3개 흐름; lo-fi, wireflow, hi-fi, prototype, 직접 만든 UI kit와 do/don't | 같은 기능의 버전별 경계와 설명 대상 연결, 다국어 텍스트 보존 | Atomic Design 교육 템플릿이므로 잘 정리된 kit에 그칠 위험이 있다. 설명이 실제 TEXT인지, 스타일 안내 외 업무 정책도 있는지 확인 후 실전/보조군 구분 |
| [Zomato Group Order][zomato] / Anubhav Raj | 이번 live 전체 본문·버튼·CC BY 표시로 과거 미확인 라이선스 근거 보강 | 22+ 화면, 3개 흐름, 여러 식당 주문, 개인별 예산, UPI 분할결제, 사용성 테스트 | 규모보다 정책 한 개가 여러 UI 상태에 연결되는 many-to-many 관계 시험에 우선 | 정책의 캔버스 TEXT 존재는 미확인. 외부 소개에만 있다면 파일 내부 spec 추출 fixture로 채택하지 않는다. 복제 미실행 |
| [WashEase][washease] / singhkiku005's team | 이번 live 전체 본문·버튼·CC BY 표시로 과거 이용 조건 근거 보강 | 교육 과제. flow, IA, lo-fi, hi-fi, 사업 발표를 한 파일에 통합했다고 명시 | UI·도식·설명 분류, lo-fi/hi-fi를 다른 상태로 보존하는 시험 | 편집 가능한 UI·텍스트인지 미확인. 발표 자료가 이미지 위주라면 이미지/설명 보조군. 화면 수·정책 밀도 미확인 |
| [Open Collective Production Ready][oc] | 공개 [#3880][oc3880], [#4200][oc4200]를 GitHub 도구로 재확인. 같은 fileKey의 서로 다른 node 링크 | 대시보드/설정 통합, 여러 역할·반응형 구현과 crypto contributions 기능의 실제 개발 맥락 | 실제 제품 기능 누적과 역할·화면 관계의 실전성 보완 | 일반 공유 파일로 Community 라이선스를 적용할 수 없다. 현재 도구에서 edit access 오류. 디자인 라이선스·복제·내부 spec 존재 모두 미확인 |

첫 로컬 확보 대상으로 TATA NEU와 Bonafide, 정책 관계에는 Zomato, 자료 종류 혼합에는 WashEase를 추천한다. Open Collective는 실제 제품 맥락 때문에 유지하되 현재 접근/이용 조건을 해결하기 전에는 실행 코퍼스에 편입하지 않는다. 이 순서는 실측 품질 순위가 아니다.

## 요청한 여섯 기준의 충족 상태

`주장`은 제작자의 소개문, `외부`는 제품 팀의 개발 이슈를 뜻한다. 모두 직접 캔버스 검증과 구별한다.

| 후보 | 다수 제품 화면 | UI와 스펙 텍스트 혼재 | 흐름·상태 화면 | 불규칙 Frame/Group/Component | 많은 노드·깊은 계층 | 복제·테스트 이용 |
|---|---|---|---|---|---|---|
| TATA NEU | 60+ 주장 | case study 주장; 실제 TEXT 미검증 | 여러 기능 주장; 상태 미검증 | 미검증 | not measured | CC BY 표시 확인; 복제 실행 미검증 |
| Bonafide | UI 화면 주장; 수 미검증 | do/don't 주장; 정책 미검증 | 3개 흐름·prototype 주장; 상태 미검증 | 미검증; Atomic Design 주장만 있음 | not measured | CC BY 및 학습 복제 의도 확인; 실행 미검증 |
| Zomato | 22+ 주장 | 업무 규칙 소개 확인; 캔버스 내 존재 미검증 | 3개 흐름 주장; 상태 미검증 | 미검증 | not measured | CC BY 표시 확인; 복제 실행 미검증 |
| WashEase | hi-fi 화면 주장; 수 미검증 | 발표·UI 한 파일 주장; spec 미검증 | flow 주장; 상태 미검증 | 미검증 | not measured | CC BY 표시 확인; 복제 실행 미검증 |
| Open Collective | 역할·반응형 화면 외부 근거 | 이슈에 정책 존재; 파일 내부 미검증 | 두 기능 개발 이슈 외부 근거 | 미검증 | not measured | 디자인 라이선스·복제 미검증; 도구 접근 실패 |

기존 12개 나머지 후보의 원본 링크와 평가 이유는 Work 조사에 남긴다. 특히 Bank Jago는 74개 화면 주장만으로 승격하지 않고, Bloodborne는 인터랙션 보조군, Wikipedia 탐색안은 실제 정책 분기 예비군으로 유지한다. 이번 Wikipedia Figma 접근 확인도 권한 오류이므로 내부 검증 실적에 포함하지 않는다.

## 실제 접근 결과와 정성 평가의 한계

| 실행 대상 | 실행 결과 | 검증 가능한 범위 |
|---|---|---|
| Community 4개 | Firecrawl `maxAge: 0` 전체 소개·라이선스·버튼 확인. Bonafide 초기 200은 shell, `waitFor: 3000` 재조회 성공 | 공개 페이지의 게시 주장과 이용 표시만 확인 |
| Community editor key 탐색 | 제공된 링크에서 `/design/` 또는 `/file/` editor fileKey를 발견하지 못함. Bonafide embed는 숫자 resource ID의 `hf_embed` | Community resource ID를 fileKey로 바꿔 호출하지 않음 |
| Open Collective Production Ready, Wikipedia explorations | 2026-10-22T21:10:55Z root의 읽기 전용 `use_figma` 시도에서 edit access 관련 `INVALID_ARGUMENT` | 이 계정/도구의 접근 실패. 삭제·비공개·익명 브라우저 불가로 단정하지 않음 |
| Community cover 4개 | 임시 디렉터리로 요청했으나 실행 환경 proxy tunnel `403 Forbidden`; 저장·시각 검토 실패 | 표지 이미지도 직접 관찰했다고 주장하지 않음. 다른 경로로 재시도하지 않음 |
| Figma 문서 쓰기·복제 | 수행하지 않음 | 원본 변경 없음. `Open in Figma` 표시는 실제 복제 성공이 아님 |

공개 후보의 **이미지와 노드 구조를 함께 검토한 정성 평가도 0개**다. 따라서 다음 다섯 항목 모두 실제 판정은 미검증이다: UI/스펙 혼재 정도, 의미론적 컴포넌트 경계의 모호성, 시각 구조와 트리 불일치, spec와 UI 연결 난이도, 프론트엔드 구현에 가까운 정도. 위 비교표의 예상 가치는 공개 설명에 대한 LLM의 가설이며 이 다섯 항목의 관찰 결과를 대신하지 않는다.

전체/페이지별 노드 수, 타입 분포, 최대/평균 깊이, Frame/Group/Component/Instance 비율, Auto Layout 비율, TEXT 수/밀도, 동일/유사 BBox 비율, 공간 중첩/포함, 원본 ancestry 불일치, 선택 추출 시간, plugin memory, 전달 bytes는 **공개 후보 모두 not measured**다. HTTP 응답 코드나 웹 조회 시간은 해당 지표가 아니다. 작은 synthetic 결과를 실제품 성능으로 외삽하지 않는다.

## 이용 조건과 커밋 범위

이번에 재조회한 [Figma 공식 안내][license]는 무료 Community 파일을 CC BY 4.0으로 설명한다. 네 후보는 각각 자신의 페이지에 CC BY 4.0을 표시했다. 제작자·원본·라이선스·변경 여부의 표시가 필요하며, 포함된 타사 브랜드/사진 등의 별도 권리까지 이 조회로 확인한 것은 아니다. 일반 공유 파일인 Open Collective에는 이 조건을 자동 적용하지 않는다.

[복제 안내][duplicate]에 따르면 계정으로 `Open in Figma`를 실행한 사본은 Drafts에 생성되며 원본 version history, comments, permissions와 이후 변경을 이어받지 않는다. 캔버스 TEXT, native annotation, comments, 이미지 속 문자를 서로 다른 매체로 기록해야 한다. 댓글의 정책을 사본의 TEXT로 측정하면 안 된다.

사용자의 이번 요청 범위에 따라 `public/`에는 출처, 라이선스 근거, 접근 결과, 집계값/평가만 보관한다. 현행 AGENTS.md의 synthetic 공개 CI 원칙을 유지하며 원본 `.fig`, JSON dump, 원문 스펙, 캔버스 이미지 등은 추가하지 않는다. 라이선스 표시가 있어도 자료 자동 재배포를 시작하지 않았다.

## 코퍼스 승격과 후속 시험

1. Community 계정에서 개별 조건을 확인하고 사본을 열어 source URL/resource ID와 실제 사본 fileKey를 각각 기록한다. 일반 공유 파일은 읽기·복제·테스트 이용 권한을 별도 확인한다.
2. 한 Frame부터 분석하고 필요할 때만 현재 Page의 한정된 범위를 늘린다. 원본 버전 또는 관찰 시각, page/scope ID, 필터·예산·중단 사유를 기록한다. 합계는 모든 범위를 중복 없이 완주한 경우에만 파일/페이지 총계로 승격한다.
3. 라이선스가 확인된 로컬 미리보기와 해당 scope의 노드 구조를 함께 본다. UI 화면 10개, UI 밖 설명 5개, 정책/조건 2개를 **목표 표본**으로 삼되 실제 존재하지 않으면 미충족으로 남긴다.
4. 두 명의 프론트엔드 검토자가 semantic boundary와 spec 대상의 0-to-many 관계를 독립 라벨링한다. 단일 정답을 강제하지 않고 불일치와 이유를 보존한다. LLM 제안은 `proposed`로 유지한다.
5. 선택 화면별 cold/warm 반복 실행에서 추출 시간, bytes, 노드 수, 예산 초과·실패를 보고한다. 실제 plugin heap 측정 수단이 없으면 `not measured`로 남기고 JSON bytes를 메모리로 대체하지 않는다.
6. 동일/유사 BBox, 원본 부모와 공간 포함 불일치, clipping/rotation, UI·spec 가까움에도 의미상 무관한 사례를 수집한다. 원본 콘텐츠를 공개하지 않고 같은 문제를 재현하는 synthetic 회귀 사례를 추가한다.
7. F2 bounded performance와 F4 grounding 실험의 증거로만 사용한다. 이 작업은 F1 Desktop↔localhost↔MCP 왕복, F3 좌표 fidelity, F5 생산성, F6 보안 통과를 주장하지 않는다.

승격 조건은 접근/이용 확인, 독립 노드와 스펙의 실제 존재, 제한된 추출 완주, 검토 가능한 이미지+구조 근거다. `candidate` → `limited-use` 또는 `validated`는 이 근거를 얻은 뒤 갱신한다. 정돈된 UI Kit나 이미지 기반 발표자료로 확인되면 보조군으로 남기거나 `rejected` 처리한다.

[tata]: https://www.figma.com/community/file/1148330409355808941/tata-neu-super-app-ux-case-study-product-redesign
[zomato]: https://www.figma.com/community/file/1645766255262568144/zomato-group-order-feature-multi-restaurant-group-ordering-feature-design
[washease]: https://www.figma.com/community/file/1585151211941208653/ui-ux-assignment-10-washease-complete-ui-ux-case-study
[bonafide]: https://www.figma.com/community/file/1437922574500111933/caso-de-estudio-bonafide-app-ui
[oc]: https://www.figma.com/file/ZQBMWhnGGtRWeIZknFW1eP/OC-Design-Production-Ready-%E2%9C%85?node-id=10902%3A0
[oc3880]: https://github.com/opencollective/opencollective/issues/3880
[oc4200]: https://github.com/opencollective/opencollective/issues/4200
[license]: https://help.figma.com/hc/en-us/articles/360042296374-Figma-Community-copyright-and-licensing
[duplicate]: https://help.figma.com/hc/en-us/articles/360038510873-Duplicate-Community-files
