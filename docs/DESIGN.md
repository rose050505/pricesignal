# PriceSignal — 설계 (Open Agent Hackathon 2026, 트랙 01 Solving Fragmented Intelligence)
2026-10-26 설계 세션. 요건 원문: 프로젝트 문서 `오픈에이전트/1026_요건_확정.md`. 제품 표기(README·슬라이드·UI)는 영어.

## 다섯 질문
1. 사용자: 독일·캐나다·호주에 제품을 파는 중소 수출업체의 가격 담당자(pricing manager). 예: K-푸드 수출사.
2. 문제: 나라별 물가를 근거로 가격을 조정하려면 세 통계기관의 서로 다른 API·분류·기준연도·발표 주기를 사람이 맞춰야 해서, 근거 있는 "나라별 인상 폭"을 내는 데 반나절이 걸린다.
3. 입력: 지저분한 자연어 요청 — "our gochujang & snacks: is food inflation in deutschland, canada & aus still hot? thinking +5% for Q1, too much?" (오타, 국가 별칭, 품목 속어, 모호한 기간, 한국어 혼용)
4. 출력: 나라별 최신 식품·전체 물가 상승률과 12개월 추세, 비교 가능성 경고(HICP vs CPI, 월간 vs 분기, 최신 시점·기준연도 차이, 중단된 데이터셋), 시장별 권장 인상 폭과 이유. 숫자마다 출처 시리즈 ID·Zetaris SQL·기준 기간 인용.
5. 왜 에이전트: 요청마다 (a) 품목→각 기관 분류 코드 매핑, (b) 기관별 시리즈 탐색, (c) 없는 시리즈는 Zetaris에 새 테이블로 온보딩, (d) 결과를 보고 중단·결측·주기 차이를 처리하는 다음 행동 결정이 달라진다. 고정 스크립트로는 "snacks"·"Deutschland"·"since summer" 같은 입력과 데이터셋 중단을 다룰 수 없다.

## 실제 데이터 사실 (10/26 브라우저로 직접 확인)
- 독일 Eurostat: `prc_hicp_manr`는 **2025-12에서 중단**, 대체 데이터셋 `prc_hicp_minr`(ECOICOP v2, 차원 `coicop18`: TOTAL·CP01 식품, unit `RCH_A` 연간 변화율, 월간, 최신 2026-09). JSON-stat 2.0. ← 에이전트가 중단을 알아채고 갈아타는 장면이 데모 핵심.
- 캐나다 StatCan WDS: GET `getDataFromVectorByReferencePeriodRange?vectorIds="41690973","41690974"&startRefPeriod=..&endReferencePeriod=..` (41690973 전체, 41690974 식품, 지수 2002=100, 월간, 최신 2026-09). 응답은 최상위 배열의 평범한 구조체. (Zetaris 레시피의 데이터 메서드들은 POST라 막혀 있었음 — GET 메서드를 씀)
- 호주 ABS: `ABS,CPI/1.{10001|20001}.10.50.M` 월간 지수(최신 2026-08), 분기 `.Q`도 있음. SDMX-JSON, Accept `application/vnd.sdmx.data+json`. 단일 시리즈로 좁혀야 Zetaris가 받음(레시피 caveat 2).
- 세 곳 모두 키 없음, 무료.

## 구조 (TypeScript, Node 20+)
질문 → [에이전트 루프: Nemotron via Nightshift, JSON 행동 프로토콜] → 도구들 → 근거 브리프
- `recall_memory` / `remember` — **H-MEM**(Meterless 참조 구현을 vendor/로, 디스크 영속): 품목→시리즈 매핑, 사용자 가격 정책("인플레이션의 70% 전가"), 지난 브리프. 두 번째 요청은 탐색·등록을 건너뜀(데모에서 단계 수·시간 비교).
- `discover_series(country, concept)` — 기관 메타데이터(GET)에서 후보 시리즈와 상태(중단 여부·최신 시점) 찾기.
- `onboard_series(agency, params)` — 코드가 템플릿으로 `CREATE LIGHTNING REST TABLE` + 디코드 `CREATE SCHEMASTORE VIEW` 생성(LLM이 Lightning SQL을 직접 쓰지 않음). 등록된 뷰는 공통 스키마 `(country, concept, period, value, measure, source_id)`.
- `run_sql(select)` — SELECT만 허용. 세 나라 뷰를 **한 번의 SQL로 조인·정렬**(Fragmented Intelligence의 핵심 장면).
- `write_brief` — 결정적 검증 후 출력: 브리프의 모든 숫자가 실행된 SQL 결과(cite id)에 있어야 통과, 최신 시점 3개월 초과·기준 차이는 경고.
- LLM 공급자: `meterless`(기본, 주 공급자) — OpenAI 호환, 헤더 `meterless-app: pricesignal`, `meterless-scope: user`, `GET /v1/models`로 상태 판정, 180초 타임아웃. 개발용 `nvidia`(build.nvidia.com 직접)는 Nightshift 준비 전 임시로만.
- 도구 호출은 JSON 행동 프로토콜(`{"action":..., "args":...}`)로 — Nightshift가 OpenAI tools를 넘기는지 모르므로 의존하지 않는다.

## 배치
- 노트북(리눅스): Zetaris(Docker), 앱, Claude Code.
- 윈도우 데스크탑: Nightshift(리눅스판 없음) + NVIDIA 키(Providers), Nemotron 레인. 노트북 → `http://<데스크탑IP>:<포트>/v1`. LAN 노출이 안 되면 앱을 데스크탑에서 돌리고 Zetaris를 `http://<노트북IP>:8888`로 부른다.

## 심사 기준에 맞춘 데모(3분)
1. 지저분한 요청 입력 → 2. 단계 추적 화면: 품목 매핑, Eurostat 옛 데이터셋 중단 감지 → 새 데이터셋으로 전환, 캐나다·호주 시리즈 Zetaris 온보딩 → 3. 한 SQL로 세 나라 조인 → 4. 근거 브리프(숫자 클릭 시 SQL·출처) → 5. 같은 질문 재실행: H-MEM 회상으로 단계 축소 → 6. Nightshift 콘솔에서 Nemotron 레인이 처리한 기록.

## 하지 않는 것
나라 3개 밖 확장, 환율·관세, 로그인, 배포. 시간이 남으면: 국가 추가(Eurostat의 다른 EU국은 코드만 바꾸면 됨), 웹 UI 다듬기.
