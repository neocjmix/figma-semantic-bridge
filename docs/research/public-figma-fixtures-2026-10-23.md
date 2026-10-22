# 공개 Figma 실전 테스트 파일 조사

조사일: **2026-10-23 (Asia/Seoul)**  
대상 프로젝트: Figma Semantic Bridge  
범위: Figma Community 중심의 제품 화면·UX 플로우·설명/명세 혼합 파일. 단순 UI Kit와 디자인 시스템은 주후보에서 제외.

## 결론

**본 후보 17개(Community 12개, 실제 제품 팀의 공유 파일 5개)를 조사하고 최종 조사 우선순위 5개를 선정했다.** 최종 후보는 **TATA NEU, Zomato Group Order, WashEase, Bonafide, Open Collective Production Ready**다.

**실제 에디터 내부 구조 검증 완료: 0개. 실제 복제 성공 확인: 0개.** 공개 소개문과 개발 이슈에서 확인한 내용만으로 선정했다. 아래 5개는 *구조 확인을 우선할 조건부 최종 후보*이며, 모든 요구를 충족하는 검증된 테스트 데이터셋이라는 뜻이 아니다. UI·플로우·정책·인터랙션 명세가 모두 같은 파일 안에 존재한다고 검증된 파일도 아직 없다.

| 순서 | 최종 후보 | 선정 근거 | 복제 / 이용 조건 | 예상 테스트 가치 및 남은 조건 |
|---|---|---|---|---|
| 1 | [TATA NEU][c01] | 제작자 설명상 60+ 화면, 6개 기능 영역, 상세 UX case study | 공개 페이지의 Open in Figma 및 CC BY 4.0 표시 확인. 실제 복제는 미검증 | 화면 규모·도메인별 범위 제한·의미 경계 테스트. 정책/주석의 실제 배치는 미확인 |
| 2 | [Zomato Group Order][c02] | 설명상 22+ 화면, 3개 흐름, 개인 예산 한도·분할결제 등 구체적인 업무 규칙 | 복제 UI·개별 라이선스 미확인 | 규칙과 UI 상태의 연결에 유망. 정책이 캔버스 TEXT인지, 외부 소개문에만 있는지 확인 필요 |
| 3 | [WashEase][c03] | 제작자가 flow·IA·lo-fi·hi-fi·사업 설명을 한 파일에 합쳤다고 명시 | 복제 UI·개별 라이선스 미확인 | UI/설명/도식의 분류와 서로 다른 설계 단계 구분. 화면 수·정책/명세 밀도 미확인 |
| 4 | [Bonafide][c04] | 3개 흐름, wireflow, prototype, do/don't 설명을 포함한다는 소개 | 수집된 Community 본문에 Open in Figma 및 CC BY 4.0. 학습용 복제 의도도 명시. 실제 복제 미검증 | 원본 편집 트리와 의미 구조 차이, 설명 대상 연결. 대규모 여부·정책 텍스트는 미확인 |
| 5 | [Open Collective Production Ready][c13] | 서로 다른 실제 개발 이슈가 같은 fileKey의 다른 노드를 구현 대상으로 참조 | 현재 공개 열람·복제·디자인 라이선스 모두 미확인. MCP는 편집 권한 오류 | 다기능·역할·반응형 제품의 실전성 보완. 접근/이용 조건과 스펙의 파일 내 존재 확인 후 채택 |

처음 확보할 파일은 이용 조건 근거가 있는 **TATA NEU와 Bonafide**를 권장한다. 정책 추출에는 **Zomato**, 자료 유형 혼합에는 **WashEase**, 실제품의 누적 복잡도에는 **Open Collective**를 추가한다. 이는 연구자의 테스트 설계 제안이며 파일 내부를 실행한 결과는 아니다.

## 1. 조사 기준과 증거 수준

프로젝트의 [context](../context.md), [pipeline](../pipeline.md), [feasibility](../feasibility.md), [AGENTS.md](../../AGENTS.md)를 기준으로 선정했다. 특히 UI copy와 설명 텍스트의 분리, BBox 영역의 원본 노드 매칭, many-to-many spec 연결, bounded extraction에 도움이 되는 파일을 우선했다.

| 표기 | 의미 | 이 조사에서 보장하지 않는 것 |
|---|---|---|
| 공개 설명 확인 | 제작자의 Community 소개문을 검색/페이지 수집으로 읽음 | 내부 페이지/노드/텍스트를 직접 확인했다는 뜻이 아님 |
| 개발 이슈 확인 | 실제 제품 팀의 공개 이슈에서 파일 링크와 개발 맥락 확인 | 이슈에 있는 정책이 Figma 안에도 있다는 뜻이 아님 |
| 표시 확인 | 수집된 페이지 본문에서 버튼·라이선스 문구 확인 | 클릭·복제 성공 또는 현재 계정 접근 보장 아님 |
| 미확인 | 충분한 직접 증거 없음 | 없다는 뜻도, 가능하다는 뜻도 아님 |
| 예상 가치 / 예상 복잡도 | 확인된 설명으로부터 도출한 테스트 가설 | 실측 화면 수·노드 수·성능 평가 아님 |

수치가 있는 경우 모두 **제작자 기재 수치**다. 모든 후보의 실제 페이지 수, 총 노드 수, 파일 용량, 화면 밖 spec TEXT 수, prototype 연결 수는 **미확인**이다. 60~74개 화면이라는 설명만으로 원래 문제였던 약 4GB JSON 사례와 동급이라고 판단하지 않았다.

검색은 case study, end-to-end flow, handoff, annotation, product implementation을 중심으로 수행했다. Community 원문은 Exa로 조회했고 주요 파일은 Firecrawl의 live fetch(`maxAge: 0`)로 보강했다. 일반 웹 검색은 Community에서 robots 제한을 반환한 경우가 있었다. Exa의 인덱스/추출 본문과 live 응답을 구분했으며, HTTP 200이라도 navigation shell만 반환된 경우에는 본문 확인 성공으로 세지 않았다.

## 2. 전체 후보 17개

### 2.1 Figma Community — 12개

아래 각 제목 링크가 원본 URL이자 해당 행의 소개문 근거다. 표의 내용은 모두 **공개 설명 근거**이고 에디터 내부 구조는 전부 **미확인**이다. ‘복제 미확인’은 불가능 판정이 아니다.

| ID / 파일·제작자 | 공개 설명에서 확인한 구성 | 복잡도와 예상 테스트 가치 | 복제 / 이용 조건 | 판정 |
|---|---|---|---|---|
| C01 [TATA NEU – SUPER APP UX Case Study][c01] / Nayan | 60+ 화면, 쇼핑·결제·약국·스토리·숏비디오·프로필, 사용자 조사 기반 재설계 | 규모 근거가 비교적 강함. 여러 도메인의 UI 범위를 잘라 처리하는 테스트 | Open in Figma·CC BY 4.0 표시 확인, 실행 미검증 | 최종 |
| C02 [Zomato Group Order Feature][c02] / Anubhav Raj | 22+ 화면·3개 흐름, 여러 식당 주문·개인 예산·UPI 분할결제, 연구·사용성 테스트 소개 | 화면 규모는 중간 수준의 후보. 업무 규칙과 상태 매핑 가치가 높음 | 복제·라이선스 미확인 | 최종 |
| C03 [WashEase – Complete UI/UX Case Study][c03] / singhkiku005's team | 세탁 서비스의 flow·IA·lo-fi·hi-fi·사업 발표 자료를 한 파일로 통합 | 혼합 자료의 동일 파일 포함 근거가 직접적. 학생 과제이며 크기 미확인 | 복제·라이선스 미확인 | 최종 |
| C04 [Caso de estudio: Bonafide app – UI][c04] / Diego Villarroel | 가입·배송 구매·게이미피케이션 3개 흐름, wireflow·prototype·do/don't | 여러 충실도 버전과 설명의 구분에 유망. 대학 프로젝트, 크기 미확인 | Open in Figma·CC BY 4.0 표시, 학습용 복제 명시. 실행 미검증 | 최종 |
| C05 [BOC – BankingApp UFMn-2.0 Demo][c05] / ERNI Management Services AG | 은행 앱 mock-up에 UFMn 2.0 흐름 표기법 적용 | UI와 흐름 연결의 정답 라벨링 후보. 데모이며 대규모 근거 없음 | 복제·라이선스 미확인 | 1순위 예비: 흐름 전용 |
| C06 [E-Commerce Website UX/UI Case Study (Persian)][c06] / Behshad Hasany | 자동차 시트 쇼핑몰 재설계, 연구·persona·journey·flow·wireframe·hi-fi 소개 | RTL/페르시아어 의미 추출 후보. 사용 도구에 FigJam도 있어 산출물 전체의 동일 파일 수록은 미확인 | 복제·라이선스 미확인 | 예비: 다국어 |
| C07 [Bank Jago UI Recreate][c07] / Afin | 74개 hi-fi, wireframe·moodboard, 미완성 atomic components | 많은 화면 및 미완성 구조 후보. 정책/스펙 증거 부족 | 복제·정식 라이선스 미확인. 제작자가 학습·개인 연습용이며 상업적 용도가 아니라고 명시 | 보류: 이용 범위 확인 필요 |
| C08 [e-Commerce UX Case Study / a2z.com][c08] / Johnson Ogbonna | 음식·세탁·affiliate 서비스, 연구→flow→hi-fi→prototype→handoff 과정 소개 | 여러 서비스의 관계 테스트 가능성. 과정 설명과 실제 파일 수록물은 구별 필요 | 복제·라이선스 미확인 | 예비: 내부 구성 증거 부족 |
| C09 [Fast Cash: Fintech Mobile Banking Application][c09] / Rayhan Nasir | onboarding에서 전체 flow로 확장했다고 설명. 송금·카드·거래 내역 등 | 금융 기능 범위는 넓으나 상세 case study는 별도 Behance 링크 | 복제·라이선스 미확인 | 후순위: 설명이 외부에 분리될 가능성 |
| C10 [Moblie Application BNPL][c10] / Layla Ahmed | 상품 선택·지불 관리·지불 선택/확인 3개 흐름, 연구부터 UI까지 진행 | 금융 흐름 후보. 대규모 화면·업무 정책 텍스트 미확인 | 복제·라이선스 미확인 | 예비 |
| C11 [SPIRIT – A Jewellery Store][c11] / Nayan | 제목에 25 UI screens + UX case study. 탐색·카테고리·프로필·장바구니·체크아웃 | TATA NEU보다 작은 범위의 비교군 후보. 명세/정책 밀도 미확인 | 복제·라이선스 미확인 | 예비: 중간 규모 |
| C12 [Bloodborne – UI Case Study][c12] / YBdesigning, Yelnar Bolatov | 많은 게임 화면, 큰 prototype, 여러 흐름·영상·애니메이션. 변경 이력에 Welcome Guide 설명, Layer Analysis 페이지, 일부 component 설명 추가 기록 | 깊은 컴포넌트·오버레이·게임 상태 테스트 후보. 정확한 규모는 미확인, 설명 일부는 향후 추가 예정 | live 수집 본문에서 Open in Figma·CC BY 4.0 표시 확인. 실행 미검증. 원작 게임 자산 권리는 별도 | 강한 예비: 업무 정책보다 인터랙션 중심 |

### 2.2 실제 제품 팀의 공유 파일 — 5개

아래는 **공개 개발 자료에 Figma 링크가 존재함**을 확인한 후보다. 현재 파일 자체가 익명 공개인지, 복제 가능한지, 어떤 라이선스가 적용되는지는 **미확인**이다. Community 무료 파일의 라이선스를 자동 적용하지 않는다.

| ID / 원본 파일 | 개발 자료에서 확인한 사실 | 예상 테스트 가치 / 한계 | 판정 |
|---|---|---|---|
| C13 [Open Collective — Production Ready][c13] | [#3880][oc3880]이 역할별 대시보드·반응형 구현 파일로 연결. [#4200][oc4200]도 같은 fileKey의 별도 node를 기여금 기능으로 참조 | 실제 여러 기능이 같은 파일을 참조한다는 근거. 화면 수·파일 내 스펙 배치는 미확인 | 최종, 접근/이용 조건 해결 후 |
| C14 [Open Collective — OC.COM XX1 Lab][c14] | [#2552][oc2552]가 신규 Collective 생성 wireframe 및 prototype로 연결 | 탐색안·가입 분기 테스트 후보. 파일 내 정책 TEXT와 현재 크기는 미확인 | 예비 |
| C15 [Wikipedia — Explore feed explorations][c15] | [T418781][wm418781]에서 디자이너가 해당 노드를 flow로 공유. 관심사/이력에 따른 개인화 상태와 기본값 규칙 논의 | 조건별 UI 상태 연결 후보. 상위 프로젝트의 모든 화면이 동일 파일에 포함된다는 근거는 없음 | 강한 예비: 실제 정책 분기 |
| C16 [Wikipedia — Explore feed QA audit][c16] | [T408030][wm408030]에서 iOS/Android·phone/tablet 캡처를 Figma에 sections로 정리했다고 기록, annotations 추가 요청 | UI 이미지와 설명 분리 후보. UI가 스크린샷이면 원본 UI 노드 매칭에는 부적합. 주석 추가 완료는 미확인 | 예비: 이미지/설명 혼합 |
| C17 [Mattermost — Permalink Previews and Shared Messages][c17] | [#15638][mm15638]에 기본/hover/긴 본문/첨부/중첩, 채널 권한, 원문 수정·삭제 등 동작과 설계 링크 | 상태·권한별 매핑 후보. 정책은 이슈에서 확인했으며 Figma 내부 존재와 대규모 여부는 미확인 | 보조 후보 |

### 2.3 주후보 수에 포함하지 않은 대조군

- [The UX writer’s guide to Figma companion][uxwriter]: [Figma 공식 가이드][uxguide]가 Annotations 페이지와 주석 구성을 설명한다. UI copy와 설명 텍스트 구분용 소규모 대조군. 대규모 실제품 파일이라는 증거는 없다.
- [Dev Mode playground][playground]: [Figma 공식 개발자 안내][engineers]에 연결된 교육 리소스. 도구 동작 확인용이며 본 요청의 실전 파일로 세지 않았다.
- [Application workflow – guidelines – community][workflow]: BRD·API·QA 등을 다루는 프로세스 가이드. 스펙 문장 분류에는 쓸 수 있으나 다수의 실제 UI 화면을 포함하는지 미확인이다.
- [Mattermost — Keywords Trigger Mentions][mmkeywords]: [#22205][mm22205]가 화면별 notes를 **comments**로 제공한다고 명시. 캔버스 TEXT와 다른 채널이다. Community 복제는 원본 comments를 보존하지 않으므로, 복제본의 캔버스 설명 추출 시험과 혼동하면 안 된다. 이 일반 공유 파일의 복제 허용 여부는 미확인이다.

## 3. 최종 후보의 구체적 검증 계획

아래 기대 결과는 **앞으로 실행할 테스트 설계**다. 이미 수행한 실험이나 발견한 내부 페이지 이름이 아니다.

### 3.1 TATA NEU — 규모와 도메인 경계

- 원본: [Community 파일][c01]. 제작자 Nayan. 실제 서비스의 공식 디자인 원본으로 확인된 것은 아니며 사용자 조사 기반 재설계 사례다.
- 확인 근거: 60+ 화면과 6개 기능 영역, 상세 case study를 제공한다는 소개. live 페이지 본문에서 복제 진입 버튼과 CC BY 4.0 확인.
- 예상 복잡도: 화면 범위는 큰 편일 가능성이 있지만 계층 깊이·중복·섹션 구성은 미확인.
- 검증 과제: 서로 다른 기능 영역에서 각 1개 흐름을 고르고, UI 안의 문구와 화면 주변 연구/설명을 분리한다. 선택한 범위만 읽었을 때 원본 노드와 텍스트를 복원할 수 있는지 측정한다.
- 채택 조건: 화면들이 편집 가능한 노드이고, case study가 단순 외부 링크/단일 이미지가 아닌지 확인. 구현 정책/인터랙션 설명이 부족하면 규모 시험용으로만 사용.

### 3.2 Zomato Group Order — 업무 규칙과 상태 연결

- 원본: [Community 파일][c02]. 제작자 Anubhav Raj. 제안/재설계 case study이며 Zomato 공식 납품 원본 여부는 미확인.
- 확인 근거: 22+ 화면·3개 흐름과 예산 제한·UPI 분할결제 등의 구체 규칙을 제작자가 기재. live 수집은 제목/요약만, 상세 내용은 인덱스 본문으로 확인.
- 예상 복잡도: 대형 스트레스 테스트보다 정책 매핑 시험에 적합한 중간 규모 후보.
- 검증 과제: 예산·결제 관련 설명을 실제 TEXT 노드로 찾고, 하나의 규칙이 여러 화면/상태에 연결되는지 라벨링한다. 가까이 있다는 이유만으로 잘못 연결하는 경우를 검사한다.
- 채택 조건: 업무 규칙이 소개문에만 있다면 spec 추출용에서 제외. 복제와 개별 이용 조건 확인이 선행되어야 한다.

### 3.3 WashEase — 한 파일의 서로 다른 자료 유형

- 원본: [Community 파일][c03]. 제작자 singhkiku005's team. 제목과 설명상 교육 과제다.
- 확인 근거: flow·IA·lo-fi·hi-fi·사업 발표 자료를 한 파일로 통합했다는 직접적인 설명. 화면 수와 파일 크기는 기재 근거를 확보하지 못했다.
- 예상 복잡도: 자료 종류의 다양성은 유망하지만 기술 명세·정책의 존재는 미확인.
- 검증 과제: UI, 흐름도, 설명, 제외할 장식 영역을 분류하고, 같은 기능의 lo-fi와 hi-fi를 별도 디자인 상태로 유지할 수 있는지 본다.
- 채택 조건: 설명과 UI가 모두 실제 노드로 존재해야 한다. 발표 자료가 이미지뿐이면 이미지/텍스트 구분 보조군으로 강등. 복제·라이선스 미확인.

### 3.4 Bonafide — 흐름·버전·설명 관계

- 원본: [Community 파일][c04]. 제작자 Diego Villarroel. 대학 프로젝트/학습용 템플릿이라는 출처를 유지한다.
- 확인 근거: 가입·배송 구매·게이미피케이션 흐름, lo-fi/wireflow/hi-fi/prototype, do/don't를 제공한다고 설명. 수집된 본문에 학습용 복제 의도와 CC BY 4.0 표시.
- 예상 복잡도: 설계 단계와 설명 유형은 다양하나 화면·노드 수는 미확인.
- 검증 과제: 동일 기능의 여러 버전을 혼동하지 않고 의미 영역과 원본 노드를 연결하는지, do/don't가 설명하는 실제 대상을 매핑할 수 있는지 평가한다.
- 채택 조건: 설명이 독립 TEXT인지 검사하고, 업무 정책과 단순 시각 스타일 가이드를 구분한다. 단순 UI Kit 수준으로 판명되면 주후보에서 제외.

### 3.5 Open Collective Production Ready — 실제품 누적 파일

- 원본: [구현 파일][c13]. 공개 팀 이슈의 실제 구현 맥락을 확인했다. Community 파일은 아니다.
- 확인 근거: [대시보드 이슈][oc3880]의 `10902:0`과 [기여금 이슈][oc4200]의 `13104:204710`이 같은 `ZQBMWhnGGtRWeIZknFW1eP` 파일을 가리킨다. 전자는 여러 역할과 Desktop/Tablet/Mobile 화면을 설명한다.
- 예상 복잡도: 여러 제품 기능이 누적되었을 가능성이 높다. 이는 외부 이슈에서 추론한 것이며 전체 파일 크기/현재 내용은 미확인.
- 검증 과제: 두 기능의 제한된 영역을 각각 열어 공통 UI와 기능별 설명을 분리한다. 권한·반응형·상태 차이를 같은 의미 컴포넌트의 관계로 표현할 수 있는지 평가한다.
- 채택 조건: 현재 읽기/복제 권한과 디자인 이용 조건 확인. 정책이 GitHub에만 있으면 ‘한 파일 내부 spec 추출’ 시험에는 부적합하므로 별도 외부 명세 연결 사례로 분리한다.

## 4. 실제 접근·구조 검증 기록

| 대상 / 방식 | 실제 결과 | 해석 |
|---|---|---|
| TATA NEU / Firecrawl live 본문 | 설명·60+ 수치·작성자·Open in Figma·CC BY 4.0 표시 확보 | 공개 리소스 페이지 검증. 캔버스/노드 구조 검증 아님 |
| Bonafide / Exa 본문 + live 요약 | 인덱스 본문에 복제 문구와 라이선스, live 응답에는 제목/OG 요약 | 본문 현재성은 live 전체 확인보다 약함. 구조 미확인 |
| Zomato, WashEase / Exa 본문 + live 요약 | 설명 확보, live는 주로 navigation shell/OG 메타데이터 | 복제 버튼·개별 라이선스 검증 실패. 파일 내부 미확인 |
| Bloodborne / Firecrawl live 본문 및 Exa | 설명·변경 이력·Open in Figma·CC BY 4.0 확보 | 제작자가 적은 페이지/기능 이력만 확인. 직접 노드 검증 아님 |
| Bloodborne Community URL / 브라우저 | `Site Unavailable` / `Unable to access this site.` | 이 브라우저에서 열람 실패. 사이트 전체 장애·삭제·봇 차단으로 단정하지 않음 |
| Wikipedia Explore explorations 직접 design URL / 브라우저 | 같은 `Site Unavailable` 응답 | 실제 캔버스 열기 실패 |
| Wikipedia explorations `1863:15767`, QA audit `7221:3` / Figma get_metadata | 편집 권한 없음 오류 | 노드 구조를 반환받지 못함 |
| Open Collective Production Ready, Lab 및 Mattermost Permalink / Figma get_metadata | 각각 편집 권한 없음 오류 | 노드 구조를 반환받지 못함 |
| Figma 연결 상태 / whoami | 계정 연결 정상 확인 | 인증 실패가 아니라 대상 파일 접근 제약. 계정 식별 정보는 보고서에 저장하지 않음 |

Community의 숫자 resource ID를 일반 `/design/` 파일의 fileKey로 간주하지 않았다. 내부 검증에 실패한 상황에서 임의의 페이지명·노드 수·스크린샷 관찰 결과를 만들어 넣지 않았다. 원본 Figma 수정, 사본 생성, 유료 구매는 수행하지 않았다.

## 5. 복제와 이용 조건

[Figma 공식 라이선스 안내][license]에 따르면 **무료 Community 파일**은 CC BY 4.0이다. 파일이 무료인지와 개별 표시를 확인하지 않은 후보에 이를 일괄 확정 적용하지 않았다. 일반 공개 링크 파일도 별도 확인 대상이다. 무료 플러그인 등에 적용되는 Community Free Resource License와 디자인 파일의 CC BY 4.0은 다르다. 유료 전체 파일에는 Paid Resource License가 적용되며, 무료 미리보기 콘텐츠의 라이선스와 구분해야 한다.

[CC BY 4.0][ccby] 적용 자료를 사용할 때는 제작자·출처·라이선스 링크와 변경 여부를 표시해야 한다. 포함된 타사 브랜드·게임 이미지 등에 필요한 모든 권리가 자동으로 확인되는 것은 아니다. Bank Jago의 개인 학습용 문구처럼 별도 설명이 있는 경우 적용 범위를 확인하기 전 재배포 가능한 자료로 분류하지 않았다.

[공식 복제 안내][duplicate]상 Community 파일은 계정으로 Open in Figma를 실행해 Drafts 사본을 만든다. **버튼 표시와 실제 복제 성공은 별개**다. 복제본은 원본의 버전 이력·comments·권한을 이어받지 않으며, 원본의 이후 변경도 자동 반영되지 않는다. 따라서 주석이 comments에만 있는 파일은 복제 후 테스트 내용이 달라질 수 있다.

저장소의 현행 [AGENTS.md](../../AGENTS.md)는 공개 fixtures·screenshots·CI에 synthetic data를 요구한다. 이번 문서는 **출처 링크와 조사 결과만** 기록한다. 외부 파일의 공개 여부와 관계없이 원본 `.fig`, JSON dump, 캔버스 캡처, 원문 스펙 묶음을 저장소에 추가하지 않았다. 실전 파일은 허용된 범위의 로컬 수동 검증에 사용하고, 공개 회귀 테스트에는 같은 구조적 문제를 재현한 synthetic fixture를 사용한다.

## 6. 실제 테스트 데이터로 승격하는 절차

1. **접근과 출처:** 현재 공개 페이지, 작성자, 라이선스, 복제 가능 여부를 확인한다. 사본을 사용한다면 원본 URL과 사본 fileKey를 따로 기록한다.
2. **범위 확인:** 페이지 목록과 후보 흐름만 조사한다. 전체 문서를 무제한 재귀 순회하거나 JSON으로 덤프하지 않는다.
3. **자료 종류 확인:** 화면, wireflow, 설명, 정책, interaction spec를 구별한다. 캔버스 TEXT, native annotation, comment, 이미지 속 글자는 별도로 기록한다.
4. **혼재 검증:** 같은 파일에 UI와 설명이 실제 있는지, 같은 페이지의 공간적 혼재인지 페이지 분리인지 확인한다. 외부 문서만 있으면 해당 조건을 미충족으로 기록한다.
5. **표본 라벨링:** 제안 표본은 서로 다른 흐름의 UI 화면 10개, UI 밖 설명 5개, 조건/정책 2개다. 이 수치는 앞으로의 최소 표본 제안이며 현재 후보에서 관찰한 수치가 아니다. 부족하면 주후보에서 보조군으로 분류한다.
6. **원본 연결:** 각 표본의 node ID, BBox, 원문과 범위, 대상 UI, 판단 근거를 보존한다. 하나의 설명이 여러 UI에 연결되거나 대상이 불명확한 경우도 남긴다.
7. **F2/F4/F5 측정:** 선택 영역 export/추출 지연, 읽은 노드·바이트, peak memory, 원본 매칭 정확도/모호성, 사람이 수정한 횟수와 시간을 측정한다. 파일의 화면 수만으로 성능을 판정하지 않는다.
8. **채택 기록:** 파일별로 `accepted / limited-use / rejected`와 이유를 남긴다. 구조·정책 조건을 충족하는지 확인하기 전에는 본 보고서의 조건부 상태를 유지한다.

권장 기록 항목: 조사 시각, 원본 URL, 원본/사본 구분, 파일 버전 또는 관찰 시점, 선택 page/node, 범위 내 frame/text/instance 수, UI/설명 매체, 정책 표본 수, 복제 결과, 라이선스 근거, 측정치, 실패/미확인 항목. 원본 node와 사본 node의 식별자를 검증 없이 동일시하지 않는다.

## 출처

후보별 원본 링크는 아래 reference 목록을 사용한다. Community 소개의 화면/흐름 수는 제작자 주장, 제품 정책은 연결된 개발 이슈의 내용이다. 모든 자료의 확인일은 위 조사일이며 인덱스 본문의 정확한 수집 시점은 별도 보장되지 않는다.

[c01]: https://www.figma.com/community/file/1148330409355808941/tata-neu-super-app-ux-case-study-product-redesign
[c02]: https://www.figma.com/community/file/1645766255262568144/zomato-group-order-feature-multi-restaurant-group-ordering-feature-design
[c03]: https://www.figma.com/community/file/1585151211941208653/ui-ux-assignment-10-washease-complete-ui-ux-case-study
[c04]: https://www.figma.com/community/file/1437922574500111933/caso-de-estudio-bonafide-app-ui
[c05]: https://www.figma.com/community/file/1354739296750341312/boc-bankingapp-ufmn-2-0-demo
[c06]: https://www.figma.com/community/file/1547529364476168303/e-commerce-website-ux-ui-case-study-persian
[c07]: https://www.figma.com/community/file/1585561801910690901/bank-jago-ui-recreate
[c08]: https://www.figma.com/community/file/1251891440425823351/e-commerce-ux-case-study
[c09]: https://www.figma.com/community/file/1148093082580859934/fast-cash-fintech-mobile-banking-application
[c10]: https://www.figma.com/community/file/1454163608933017302/moblie-application-bnpl
[c11]: https://www.figma.com/community/file/1145239122356098262/spirit-a-jewellery-store-25-ui-screens-and-ux-case-study
[c12]: https://www.figma.com/community/file/1324779949340768558/bloodborne-ui-case-study
[c13]: https://www.figma.com/file/ZQBMWhnGGtRWeIZknFW1eP/OC-Design-Production-Ready-%E2%9C%85?node-id=10902%3A0
[c14]: https://www.figma.com/file/KinuveYf4WUlRIXzMTnmIsmO/OC.COM-XX1-Lab?node-id=638%3A12661
[c15]: https://www.figma.com/design/VwBaV9KZ7LWfOY2dt1BJyQ/explore-feed-explorations?node-id=1863-15767
[c16]: https://www.figma.com/design/73yyobmXtw7CfzfLCsvrTY/explore-feed?node-id=7221-3
[c17]: https://www.figma.com/file/kjqwbjlr4J4efNzFusAAUc/MM-22845-Permalink-Previews-and-Shared-Messages?node-id=546%3A0
[oc3880]: https://github.com/opencollective/opencollective/issues/3880
[oc4200]: https://github.com/opencollective/opencollective/issues/4200
[oc2552]: https://github.com/opencollective/opencollective/issues/2552
[wm418781]: https://phabricator.wikimedia.org/T418781
[wm408030]: https://phabricator.wikimedia.org/T408030
[mm15638]: https://github.com/mattermost/mattermost/issues/15638
[uxwriter]: https://www.figma.com/community/file/1134493298949032174
[uxguide]: https://www.figma.com/best-practices/the-ux-writers-guide-to-figma/
[playground]: https://www.figma.com/community/file/1234941143610339388/dev-mode-playground
[engineers]: https://www.figma.com/engineers/
[workflow]: https://www.figma.com/community/file/1487699070999364804/application-workflow-guidelines-community
[mmkeywords]: https://www.figma.com/file/JQFNfgZ35D5gXCaFtOKDKJ/MM-11388-Keywords-Trigger-Mentions?node-id=0%3A1
[mm22205]: https://github.com/mattermost/mattermost/issues/22205
[license]: https://help.figma.com/hc/en-us/articles/360042296374-Figma-Community-copyright-and-licensing
[duplicate]: https://help.figma.com/hc/en-us/articles/360038510873-Duplicate-Community-files
[ccby]: https://creativecommons.org/licenses/by/4.0/
