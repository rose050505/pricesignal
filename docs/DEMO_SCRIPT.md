# 데모 영상 대본 (목표 3분 20초, 규정 1~4분)

녹화: 노트북 화면 녹화(Ubuntu는 Ctrl+Alt+Shift+R 또는 OBS). 내레이션은 영어 자막이나 음성 중 편한 쪽. 아래 영어 문장은 그대로 읽거나 자막으로 넣으면 됩니다.

## 녹화 전 준비 (5분)
1. 데스크탑 Nightshift 켜져 있음(Console에 online), 노트북 Zetaris 기동 중(`docker ps`).
2. 노트북: `cd ~/해커톤/open_agent && rm -rf .pricesignal && npm run ui` → 브라우저 전체 화면으로 http://localhost:5177
3. 탭 미리 열기: Zetaris(localhost:3000 → Data Explorer), Nightshift Console(데스크탑 화면 캡처 이미지로 대체 가능), GitHub 레포.
4. 키·토큰이 화면에 나오지 않는지 확인(Nightshift API KEY는 Reveal 누르지 않기).

## 장면

**0:00–0:20 문제** (화면: PriceSignal 첫 화면)
"A small food exporter sells in Germany, Canada and Australia. Every quarter someone has to decide: can we raise prices by 5 percent? The evidence is official inflation data — but it lives in three agencies with three formats, three category schemes, and datasets that quietly move."

**0:20–1:20 1회차: 지저분한 질문** (첫 번째 예시 클릭 → Investigate, 진행 단계가 쌓이는 왼쪽 패널을 보여 줌)
"I ask the way a pricing manager actually talks — typos, 'deutschland', 'aus', 'gochujang and snacks', and our policy of passing on about 70 percent of cost increases."
(DISCOVER/ONBOARD 줄이 뜰 때) "The agent, running on Meterless Nightshift, discovers the matching series at each agency. Eurostat's usual dataset stopped in December 2025 — the agent notices and switches to its successor. Canada only publishes 'Food', so it says so."
(SQL/ONBOARD 줄) "Each series is onboarded into Zetaris as a REST table plus a decoding view in Lightning SQL, all in one common schema."
(COMPARE 줄) "Then one federated SQL query across all three agencies."

**1:20–2:00 결과** (오른쪽 시장 카드 3개, 범위 막대, Fragmentation, Evidence)
"Per market: the latest year-on-year rate, the trend, and a suggested range — 70 percent of category inflation. A flat 5 percent is above the evidence in all three markets; Germany's food inflation is under half a percent."
(Evidence의 SQL과 출처 id 확대) "Every number is computed from the Zetaris result, and the model is only allowed to write prose around them — if it invents a number, the brief rejects it."

**2:00–2:35 2회차: 메모리** (네 번째 예시 "same as last time" → Investigate)
"Next quarter, I just say 'same as last time'. H-MEM, Meterless's memory engine, remembers the six series mappings and my pass-through policy — so the agent skips discovery and onboarding and goes straight to the comparison." (trace의 MEMORY reused 줄, 상단 'H-MEM · N memories' 강조)

**2:35–3:05 스폰서 기술이 실제로 도는 모습**
- Zetaris Data Explorer에서 PSIG_EUROSTAT/PSIG_STATCAN/PSIG_ABS와 psig 뷰 목록 (5초)
- Nightshift Console 'Apps' 또는 Activity에서 pricesignal 요청 기록, 레인 모델(Nemotron) (10초)
- 터미널에서 `npm run conformance` 마지막 줄 "13/13 checks passed" (5초)
"Zetaris holds the onboarded sources, Nightshift routes every model call — including NVIDIA Nemotron — and the H-MEM engine passes its conformance suite."

**3:05–3:20 마무리** (GitHub 레포 README)
"PriceSignal turns fragmented official statistics into one cited answer in under a minute. Code and setup are on GitHub."

## 녹화 후
- 4분 넘으면 1회차 대기 구간을 빨리감기(2배)로 편집.
- 유튜브 '일부 공개'로 올리고 링크를 HackOS 제출 폼에.
