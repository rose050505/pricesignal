# PriceSignal

**An agent that tells an exporter's pricing manager how much to raise prices in each market, and shows the official evidence behind every number.**

Open Agent Hackathon 2026 · Track 01 — Solving Fragmented Intelligence · built with **Zetaris**, **Meterless** (Nightshift runtime + H-MEM engine) and **NVIDIA Nemotron** (via Nightshift).

---

## The problem

A small food exporter selling into Germany, Canada and Australia wants to know whether a +5% price rise next quarter is justified. The answer sits in three official statistics agencies that do not agree on anything:

| | Germany | Canada | Australia |
|---|---|---|---|
| Agency | Eurostat (HICP) | Statistics Canada (CPI) | Australian Bureau of Statistics (CPI) |
| Format | JSON-stat 2.0 | WDS JSON | SDMX-JSON 2.0 |
| What it publishes | annual rate of change | index, 2002 = 100 | index, monthly and quarterly series |
| Category scheme | ECOICOP v2 (`coicop18`) | product/vector ids | ABS index codes |
| Gotcha we hit | the dataset everyone links to (`prc_hicp_manr`) stopped at 2025-12 and was replaced by `prc_hicp_minr` | the data methods used in public recipes are POST-only; the GET method returns a top-level array | a broad query is too large for one fetch; series must be scoped to one key |

Doing this by hand takes half a day per pricing round. PriceSignal does it in about a minute and keeps the receipts.

## What it does

1. **Understands a messy request** — typos, country nicknames (`deutschland`, `aus`), category slang (`gochujang & snacks`), Korean or English, a proposed change (`+5%`) and a pricing policy (`we pass on ~70% of cost increases`).
2. **Discovers the matching official series** at each agency, and reports what it had to work around (a discontinued dataset, a coarser category, a different frequency).
3. **Onboards each series into Zetaris** as a Lightning REST table plus a decoding view with a common schema — the agency APIs become governed SQL tables.
4. **Answers with one federated SQL query** across all three agencies in Zetaris.
5. **Computes the facts in code** (latest year-on-year rate, 12-period average, trend, staleness, suggested price range = pass-through × inflation) and lets the model write only the prose. Any number in the prose that does not appear in the facts is rejected.
6. **Remembers** (Meterless H-MEM): series mappings, the user's pricing policy and past onboarding notes persist across sessions. The second time you ask, it skips discovery and onboarding entirely.

## Architecture

```
messy question
     │
     ▼
┌──────────────── PriceSignal agent (TypeScript) ─────────────────┐
│ planner loop: JSON action protocol, batched actions              │
│   recall_memory · use_memory_mapping · discover_and_onboard      │
│   compare · finish                                               │
│                                                                  │
│  LLM ──► Meterless Nightshift runtime (OpenAI-compatible /v1)    │
│          routing lanes → NVIDIA Nemotron and other models        │
│  Memory ► Meterless H-MEM engine (reference impl, conformance ✔) │
│  Data ──► Zetaris REST API  /sql-editor/sqls/run                 │
│            ├─ PSIG_EUROSTAT  (REST table → psig view)            │
│            ├─ PSIG_STATCAN   (REST table → psig view)            │
│            └─ PSIG_ABS       (REST table → psig view)            │
│  Guardrails: SELECT-only federated query, number-grounding check │
└──────────────────────────────────────────────────────────────────┘
     │
     ▼
evidence-backed brief (per market: latest rate, trend, suggested range,
verdict on the proposed change, source series id, SQL behind it)
```

## Sponsor technology

**Zetaris** is where the fragmented sources become one dataset. The agent registers each agency endpoint with `CREATE LIGHTNING REST TABLE` and a decoding `CREATE SCHEMASTORE VIEW` (JSON-stat, WDS and SDMX are flattened in Lightning SQL), all in a common schema `(country, concept, category_label, frequency, period, yoy_pct, source_id)`. Every number the user sees comes from one federated `UNION ALL` query over those views, and its query id is cited in the brief.

**Meterless Nightshift** is the application's primary AI provider. The app implements the Meterless Runtime provider contract: OpenAI-compatible `/v1/chat/completions`, Bearer runtime token, `meterless-app` on every request, `meterless-scope: user` on chat, `GET /v1/models` to decide online / unauthorized / offline, routing modes `meterless/fast` and `meterless/deep`. The model that served each step is shown in the agent trace.

**Meterless H-MEM** gives the agent memory across sessions. `src/hmem_impl.ts` re-exports the Meterless reference engine unchanged, and the H-MEM conformance suite is run against that exact file (`npm run conformance` → 13/13 checks pass). Series mappings are stored as long-term factual memories with structured tags (so a recalled memory can be acted on, not just quoted), superseded when re-onboarded, and given `helpful` feedback when reused.

**NVIDIA Nemotron** runs inside the product through Nightshift lanes (for example `nvidia/nemotron-3.5-lightning` wrote the narrative in our test runs).

## Run it

Requirements: Node 20+, Docker (for Zetaris), a Zetaris hackathon registry login, and Meterless Nightshift running on a Windows/Mac machine reachable from the app.

```bash
npm install
npm run setup               # vendors the Meterless H-MEM reference engine into vendor/hmem
npm run setup:conformance   # vendors the H-MEM conformance suite
npm run conformance         # 13/13 checks pass against src/hmem_impl.ts
npm test                    # offline agent tests (fake model, fake Zetaris)

cp .env.example .env        # then fill in (never commit .env):
#   ZETARIS_REST_URL, ZETARIS_ORG_ID, ZETARIS_API_KEY
#   LLM_PROVIDER=meterless, METERLESS_BASE_URL (Nightshift Console), METERLESS_RUNTIME_TOKEN

npm run smoke               # Zetaris, Nightshift, the three agencies, H-MEM
npm run ui                  # http://localhost:5177
npm run ask -- "is food inflation in deutschland, canada & aus still hot? thinking +5%"
```

Helper scripts used on our machine (Ubuntu laptop + Windows desktop running Nightshift) are in `scripts/` (Docker install, Zetaris install, secret entry without echo, smoke tests, integration probe, network check).

## Repository layout

```
src/agent.ts          planner loop, actions, guardrails
src/brief.ts          facts computed from Zetaris rows, number-grounding check, rendering
src/sources/          one adapter per agency: discover() + Lightning SQL onboarding templates
src/zetaris.ts        Zetaris REST client
src/llm.ts            Meterless Runtime provider (plus dev fallbacks)
src/memory.ts         agent memory on H-MEM
src/hmem_impl.ts      the H-MEM implementation the agent runs and the conformance suite tests
src/server.ts         UI server (Server-Sent Events trace)
public/index.html     single-page UI
tests/                offline tests
```

## What was built during the window

Everything in this repository was written during the build window (22–27 October 2026). Pre-existing open-source components, used unchanged: the Meterless H-MEM reference implementation and conformance suite (Apache-2.0, vendored by `npm run setup`), and the Lightning SQL decoding patterns documented in Zetaris's getting-started recipes. No other pre-existing product code is included.

## Data sources and licences

Eurostat (`prc_hicp_minr`, re-use policy aligned with CC BY 4.0), Statistics Canada table 18-10-0004-01 (Statistics Canada Open Licence), Australian Bureau of Statistics CPI (CC BY). PriceSignal reports official statistics; its suggested ranges are a decision aid, not financial advice.
