# Real-world Figma fixture evaluation results

Evaluation: 2026-10-22 UTC. Tracked in [issue #8](https://github.com/neocjmix/figma-semantic-bridge/issues/8).

**실제 이미지·노드 구조 검증: 기존 synthetic 1개. 공개 실전 파일 검증: 0개.**
기존 Work 조사에서 찾은 17개 후보를 바탕으로 5개를 재평가했다. 공개 후보에
접근하지 못한 부분을 synthetic 결과로 대체하거나 검증 완료로 표시하지 않았다.

## 결과물

- [후보 비교 보고서](../fixtures/public/evaluation/candidate-comparison.md): TATA NEU,
  Bonafide, Zomato Group Order, WashEase, Open Collective Production Ready를
  **조건부 추천**한다. 크기만으로 점수를 높이지 않았다.
- [Manifest JSON Schema](../fixtures/manifest.schema.json),
  [공개 후보](../fixtures/public/manifest.json),
  [synthetic baseline](../fixtures/synthetic/manifest.json): 이용 조건·범위·증거·미측정값 구분.
- [분석 코어](../src/fixture-analysis/index.ts),
  [Figma 어댑터](../src/fixture-analysis/figma-adapter.ts),
  [플러그인 및 수동 절차](fixture-plugin.md): 선택 범위의 점진적 읽기와 집계만 수행.
- [실제 Figma 집계](../fixtures/synthetic/live-figma-measurements.json),
  [정성 관찰](../fixtures/synthetic/live-visual-review.md),
  [생성 데이터 벤치마크](../fixtures/synthetic/benchmark-results.json),
  [접근 실패 기록](../fixtures/public/evaluation/figma-access-attempts.json).

## 실제 Figma 측정

원본은 기존 synthetic `4dKjnCZ8lTY8fVXUugJGxP`이다. 공식 Figma MCP의 Plugin API
실행 환경에서 유일한 페이지와 그 안의 세 프레임을 각각 읽었다. 노드 제한 1,000,
직렬화 레코드 제한 500,000 bytes, 5초, pair 검사 250,000, BBox 허용오차 0.5px로
모두 완주했다. 전체 JSON dump나 원문 텍스트·이미지 저장은 하지 않았다.

| 범위 | 노드 수 | TEXT | 최대 / 평균 깊이 | 추출 ms | 직렬화 레코드 bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Page `0:1` | 80 | 56 | 2 / 1.9375 | 22 | 11,793 |
| Dashboard `1:2` | 56 | 41 | 1 / 0.9821 | 13 | 8,343 |
| Notes `1:58` | 17 | 14 | 1 / 0.9412 | 15 | 2,472 |
| Geometry `1:75` | 6 | 1 | 1 / 0.8333 | 3 | 879 |

각 범위의 root를 포함하고 root 깊이는 0이다. Page 집계의 타입은 PAGE 1,
FRAME 3, RECTANGLE 20, TEXT 56이다. GROUP/COMPONENT/INSTANCE는 모두 0이며,
Auto Layout은 eligible FRAME 3개 중 0개다. TEXT 비율은 56/80 = 70%다.
페이지와 하위 프레임의 노드 수를 더하면 중복 계산이다. 분석기의 전체 파일
집계는 `not measured`로 유지하며, 유일 페이지를 완주했다는 사실을 별도로 남긴다.

Page에서 양의 면적을 가진 BBox 79개 중 동일/유사 BBox 참여 노드는 2개(2.53%),
동일 BBox 쌍은 1개다. 3,081개의 가능한 쌍 중 실제 중첩은 134쌍(4.35%),
한 방향으로만 성립하는 tolerant containment는 123쌍이다. 그중 원본 ancestry가
없는 포함은 48쌍(39.02%)이다. 부모·자식 BBox 비교 76건 중 1건에서 부모가 자식을
허용오차 내 포함하지 않았다. 이는 편집 트리와 공간 관계의 진단이며 의미론적
컴포넌트 오류나 알고리즘 정확도 판정이 아니다.

위 시간은 **초기 측정 회차의 단일 관찰**이다. 최종 번들로 네 범위를 다시 실행해
노드·공간 지표가 같고 반환 JSON byte 수가 맞는지 확인했다. 두 번째 추출 시간은
각각 25/24/8/4ms이며 JSON에 번들 SHA-256과 함께 별도 보존했다. 두 회차 모두
Date.now의 밀리초 해상도이고, cold/warm 구분을 하지 않았다.
공식 MCP 호출 왕복 시간은 별도 필드이며 선택 영역 추출 시간으로 쓰지 않았다.
레코드 bytes는 메모리 사용량·네트워크 전송량이 아니다. Plugin heap, 서버 peak heap,
실제 wire bytes는 `not measured`다. Desktop↔localhost↔MCP F1 통과를 주장하지 않는다.

## 공개 후보 검증 범위

Community 4개는 최신 소개문, `Open in Figma`, `CC BY 4.0` 표시를 관찰했다.
표시가 복제 성공이나 포함된 타사 자산의 권리까지 보장하지는 않는다. 일반 공유
파일인 Open Collective는 공개 개발 이슈에서 실제 구현 맥락을 확인했으나 디자인
라이선스가 미확인이다. Figma 읽기 시도는 edit-access 오류를 반환했다. 예비 후보인
Wikipedia 탐색안도 같은 종류의 오류였다. Community resource ID를 editor fileKey로
오인해 호출하지 않았다.

따라서 공개 후보의 노드 수·깊이·BBox·성능·메모리 등 모든 내부 지표는
`not measured`다. 공개 후보 이미지와 노드 구조를 함께 본 정성 평가는 수행하지
못했다. 예상 테스트 가치는 공개 설명에 대한 LLM 가설로 분리했다. 사본 URL을
확보한 뒤 [Desktop 절차](fixture-plugin.md)와
[후속 승격 기준](../fixtures/public/evaluation/README.md)을 실행한다.

## 검증과 남은 일

자동 검증은 생성한 synthetic 노드에 대한 결정적 기하학·예산 중단·UTF-8 bytes·
원문 미노출·어댑터 범위 검사와 Manifest 유효성에 초점을 맞춘다. 벤치마크는
생성 노드 63/1,241/6,201개를 실제 실행했으며 Figma 성능으로 해석하지 않는다.
`npm run check`(TypeScript, 테스트 26개, 플러그인 빌드),
`npm run fixtures:validate`, `git diff --check`를 실제 실행해 통과했다. 독립
검토에서도 생성 트리 500개를 brute-force oracle과 비교해 공간 지표가 일치했다.
별도 lint 도구는 저장소에 구성되어 있지 않다. GitHub Actions 구성도
추가했지만 실행 여부는 별도 CI 결과를 확인해야 한다.

Desktop 플러그인 실행, 실제 복제, 공개 파일 내부 측정, 좌표 충실도, human-labeled
grounding precision/recall, 개발자 생산성 시험은 미실행이다. 전체 파일 사전 로딩,
의미론적 자동 분할, 원본 Figma 수정, 라이선스 미확인 데이터 커밋은 하지 않았다.
