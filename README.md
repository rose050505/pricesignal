# PriceSignal

**An agent that compares an exporter's proposed price changes with official inflation and a separate cost recovery target, with the data and SQL behind each result.**

Open Agent Hackathon 2026 · Track 01 — Solving Fragmented Intelligence · built with **Zetaris**, **Meterless** (Nightshift runtime + H-MEM engine) and **NVIDIA Nemotron** (via Nightshift).

![PriceSignal: agent trace on the left, a verdict per market and new prices per SKU on the right](docs/img/ui.png)

*A live UI run on 27 Oct 2026: the messy three-market request supplied an 8% cost rise, a 60% unit-cost share and a 70% pass-through policy, producing a separate 3.4% cost recovery target. Market numbers appeared at 30.5 s; the full brief took 85.5 s. It reused 11 views with no planning calls. The provider failed while writing the summary, so the UI retained computed facts. The parser chose snacks for this mixed food/snacks request; market category lookup still uses catalogue matching, while SKU selection checks the actual product names. Earlier runs are in [`examples/`](examples/). These measurements are not speed guarantees.*

---

## The problem

A small food exporter selling into Germany, Canada and Australia wants to check a proposed +5% price rise against market history and its own costs. The answer sits in three official statistics agencies that do not agree on anything:

| | Germany | Canada | Australia |
|---|---|---|---|
| Agency | Eurostat (HICP) | Statistics Canada (CPI) | Australian Bureau of Statistics (CPI) |
| Format | JSON-stat 2.0 | WDS JSON | SDMX-JSON 2.0 |
| What it publishes | annual rate of change | index, 2002 = 100 | index, monthly and quarterly series |
| Category scheme | ECOICOP v2 (`coicop18`) | product/vector ids | ABS index codes |
| Gotcha we hit | the dataset everyone links to (`prc_hicp_manr`) stopped at 2025-12 and was replaced by `prc_hicp_minr` | the data methods used in public recipes are POST-only; the GET method returns a top-level array | a broad query is too large for one fetch; series must be scoped to one key |

Assembling a comparable answer by hand means three APIs, three formats and three category schemes every pricing round, so small exporters often just pick a round number. PriceSignal answered a cold start (nothing in memory, nothing registered in Zetaris) in 48 s in our recorded run, and keeps the receipts; a repeat question reuses remembered mappings after checking their live rows and freshness. When every requested mapping is remembered, it also skips the planning model call; stale or unavailable views go back through discovery.

## What it does

1. **Understands a messy request** — typos, country nicknames (`deutschland`, `aus`), category slang (`gochujang & snacks`), Korean or English, a proposed change (`+5%` or `-2%`), a cost recovery policy (`we pass on ~70% of cost increases`), a stated cost change and an optional cost share (`unit costs are 60% of the current selling price`).
2. **Finds the matching official series** — by catalogue lookup at Eurostat and ABS, from a vetted vector list at Statistics Canada — and reports what it had to work around (a discontinued dataset, a coarser category, a different frequency).
3. **Onboards each series into Zetaris** as a Lightning REST table plus a decoding view with a common schema — the agency APIs become governed SQL tables.
4. **Answers with one federated SQL query** across all three agencies in Zetaris.
5. **Joins the company's own price list.** The exporter's internal price list (SKU, market, product category, current shelf price) is a Zetaris REST table too. For narrow SKU categories, Nemotron chooses from official candidates using the actual product names (for example, honey butter chips rather than the word snacks alone). Code validates that choice before onboarding. A second federated query joins each SKU to the chosen category or an explicitly marked broader Food proxy, then code calculates hypothetical prices at those benchmark rates.
6. **Computes the facts in code** — latest year-on-year inflation, a recent one-year mean with the actual observation count, trend where a six-month comparison exists, the historical benchmark and the proposal's position against it. The model explains these facts. Numeric and comparison checks reject mismatches, request one rewrite, then use a computed summary if needed.
7. **Separates cost recovery from the market.** With "costs rose 8%, unit costs are 60% of our current selling price, pass on 70%", the price-change target is `8% × 60% × 70% = 3.36%` (displayed as 3.4%). If cost share is missing, the brief asks for it and supplies no cost-derived price target. The historical market benchmark is independent of this cost policy.
8. **Remembers** (Meterless H-MEM): series mappings, the user's pricing policy and the last request persist across sessions. "Same as last time, but +3%?" is resolved from memory, and remembered mappings skip discovery and onboarding while they still pass live freshness checks. If all requested market mappings are remembered, no planning model turn is needed. Product-checked SKU selections have separate memory scopes keyed by their product set; changing products, stale data, a review flag or a selection-version change triggers a new choice. The UI reports actual model requests (including hedges and retries), planning requests, discovery calls and reused views.

**What the market benchmark means.** It spans the latest official year-on-year rate and the mean of valid observations in the 12-month window ending at the latest observation: up to 12 monthly or four quarterly readings. The UI shows the actual coverage. Equal values produce a single reference point; negative rates remain negative. This is a descriptive comparison, not a confidence interval, a forecast, or an estimate of customers' willingness to pay. The SKU price scenario applies that same historical percentage to the current sample price; it is not a recommended price.

**What the cost target means.** Target price change = current unit-cost share of the selling price × stated percentage change in unit costs × share of the cost change passed on. It assumes a consistent unit, currency and selling-price basis and holds sales volume and the cost mix fixed. It does not estimate a target profit margin, taxes, exchange-rate changes or demand response. Missing inputs stay missing.

The sample price list in `data/price_list.json` is illustrative data for a fictional K-food exporter; point `PSIG_PRICE_LIST_URL` at your own endpoint to use real prices.

## Architecture

```
messy question
     │
     ▼
┌──────────────── PriceSignal agent (TypeScript) ─────────────────┐
│ planner loop: JSON action protocol, batched actions              │
│   recall_memory · use_memory_mapping · discover_and_onboard      │
│   compare · finish   (code guardrails + deterministic fallback)  │
│                                                                  │
│  LLM ──► Meterless Nightshift runtime (OpenAI-compatible /v1)    │
│          meterless/fast → pinned lane: NVIDIA Nemotron 3.5        │
│  Memory ► Meterless H-MEM engine (reference impl, conformance ✔) │
│  Data ──► Zetaris REST API  /sql-editor/sqls/run                 │
│            ├─ PSIG_EUROSTAT  (REST table → psig view)            │
│            ├─ PSIG_STATCAN   (REST table → psig view)            │
│            ├─ PSIG_ABS       (REST table → psig view)            │
│            └─ PSIG_INTERNAL  (company price list → psig view)    │
│  Guardrails: SQL allowlist, number+verdict check, staleness      │
└──────────────────────────────────────────────────────────────────┘
     │
     ▼
evidence-backed brief (per market: latest rate, trend, historical benchmark,
verdict on the proposed change, source series id, SQL behind it)
```

## Sponsor technology

**Zetaris** is where the fragmented sources become one dataset. The agent registers each agency endpoint with `CREATE LIGHTNING REST TABLE` and a decoding `CREATE SCHEMASTORE VIEW` (JSON-stat, WDS and SDMX are flattened in Lightning SQL), all in a common schema `(country, concept, category_label, frequency, period, yoy_pct, source_id)`. Market rates come from one federated `UNION ALL` query over those views, and the brief cites the statement id (Q7, Q8, …) next to each rate, with the SQL behind it listed at the end. The company's internal price list is registered the same way (`PSIG_INTERNAL`), and a second federated query joins each internal SKU with its selected official category or a marked broader Food proxy; the per-SKU rate, average and benchmark are then computed in code like the market facts. Onboarding is idempotent: when Zetaris already has a table or view from an earlier run, the trace says so ("already in Zetaris") instead of claiming it was created. Remembered views are checked before reuse: a view whose data stops more than three months ago (six for quarterly series) is not reused, and the agent goes back to discovery. A small successor map handles known dataset moves, such as Eurostat's `prc_hicp_manr` → `prc_hicp_minr`. Every SQL statement the agent sends passes an allowlist (`SELECT`, plus the `CREATE LIGHTNING …` / `CREATE SCHEMASTORE …` statements used for onboarding); anything else is blocked in code.

**Meterless Nightshift** is the application's primary AI provider. The app implements the Meterless Runtime provider contract: OpenAI-compatible `/v1/chat/completions`, Bearer runtime token, `meterless-app` on every request, `meterless-scope: user` on chat, `GET /v1/models` to decide online / unauthorized / offline, and the `meterless/fast` routing mode (`meterless/deep` is configurable but not used by default). The model that served each step is shown in the agent trace. Nemotron's response time through Nightshift varied from about 1 s to over 50 s between consecutive calls on 26 Oct, so parsing, planning and narrative calls are hedged: if no reply has come after 10 s (`PSIG_HEDGE_MS`), the same request is sent once more, the first reply wins and the other request is cancelled; the trace says when this happened.

**Meterless H-MEM** gives the agent memory across sessions. We run the Meterless reference engine unchanged (`src/hmem_impl.ts` re-exports it, and `npm run conformance` runs the official suite against that file: 13/13). Our work is in how the agent uses it: series mappings are long-term factual memories with structured tags, so a recalled memory changes what the agent does next (skip discovery and onboarding); a re-onboarded series supersedes the old mapping; reused mappings get `helpful` feedback; the pricing policy is a preference memory and the brief says when it was remembered rather than stated; and the last request is stored so "same as last time" works.

**NVIDIA Nemotron** powers the agent. Nightshift has a pinned lane ("Use tools & agents") serving NVIDIA Nemotron 3.5 Lightning, so every `meterless/fast` call (request parsing, planning, SKU category selection, narrative) is routed through the Nemotron-pinned Nightshift lane. In our robustness run on 26 Oct 2026, every model call in all six questions was served by `nvidia/nemotron-3.5-lightning`, as shown in the trace logs. For narrow SKU categories, one bounded request sees product names and official candidate labels, and selects an index with a coverage reason. It cannot invent a source or query. Code rejects invalid choices, known savoury-chip/confectionery conflicts and reasons containing numeric claims or common price-advice patterns. The choice has a 20-second limit and no hedge; failure uses a verified broad Food series, visibly labelled "Unconfirmed match", or omits those SKU prices when no such alternative is usable. Validated model selections are remembered separately from general market mappings.

## Markets

Germany, Canada and Australia are the demo markets. Because Eurostat publishes HICP for every EU member through the same API, the same discover-and-onboard path also covers France, Italy, Spain, the Netherlands, Belgium, Austria, Ireland, Portugal, Finland, Sweden, Denmark, Poland and Czechia (market names, local names or ISO codes). Markets outside these are reported as not covered rather than silently dropped. The EU path was verified live on 26 Oct 2026 for France, Italy and Spain (six views registered, one federated query of 90 rows; see `examples/06_eu_markets`). The sample price list only has SKUs for Germany, Canada and Australia.

## Limits (stated, not hidden)

- **Canada:** our adapter maps only StatCan's Food and All-items CPI vectors, so narrower categories (snacks, sauces) are compared at the Food level and the brief says so.
- **SKU categories** use product-aware model selection from a bounded official shortlist. A broader series can still be the best available proxy; the table distinguishes model-selected, remembered and unconfirmed matches and names the actual series. This is a coverage check, not a guarantee that an official category precisely describes each product. Earlier examples predate this selection guard and can contain the old German chips/confectionery match.
- **Historical benchmarks are descriptive.** A point or narrow span is possible; it does not express confidence, price headroom or a prediction. Cost recovery requires both a stated cost change and the current cost-to-price share.
- **The price list is sample data** for a fictional exporter.
- **Speed** depends on the model's response time, which varied from 1 s to 43 s per call in our runs: 36–113 s per question in `examples/`. Market numbers are shown immediately after the federated comparison, before SKU discovery and pricing finish; SKU prices and the checked prose follow. A disconnected UI retries the event stream for up to 10 s, preserving available numbers and replaying the latest snapshot on reconnection.

## Earlier recorded runs in `examples/` (26 Oct 2026, Nemotron via Nightshift)

These recordings predate the 27 Oct methodology correction and product-selection guard. Their weighted ranges, "evidence" verdicts and SKU matches are historical outputs, not the current benchmark method.

The six questions below were run back to back by `scripts/15_examples.sh` with an empty H-MEM store and a fresh set of Zetaris object names (`PSIG_ZETARIS_NS`), so the first run really discovers and registers everything; each later run uses what the earlier ones left in memory. Every brief and its full trace is in the folder named.

| Example | Question | What happened | Time |
|---|---|---|---|
| `01_cold_start` | "our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot?? thinking +5% … we usually pass on ~70%" | 12 series found at three agencies and registered in Zetaris (11 REST tables, 13 views incl. the price list); 9 SKUs priced on their own category; +5% above the evidence in DE, CA and AU | 48 s (numbers at 27 s) |
| `02_same_as_last_time` | "same as last time, but what if we only go +3%?" | markets, category and the 70% policy recalled from H-MEM; 12 views reused, nothing registered again; +3% within the evidence in DE and AU, above in CA; "Since your last brief" compares each market with run 01 | 113 s; Nemotron's summary failed (empty response, then timeout), so the computed summary was shown |
| `03_typo_market` | "canda snacks price hike 4%?? is that ok, we pass thru like 60pct of costs" | "canda" resolved to Canada only; the 60% policy supersedes the remembered 70%; snacks compared at the Food level, and the brief says so | 36 s |
| `04_unsupported_market` | "japan + canada food prices, ok to raise 5%?" | Canada answered; "japan: not covered yet" stated in the brief | 48 s |
| `05_within_range` | "canada & australia food: is +2% enough this quarter? we pass on 70%" | within the evidence in CA, below it in AU | 51 s |
| `06_eu_markets` | "france, italy and spain food prices: can we go +3%? we pass on about 70%" | six more Eurostat series registered and compared in one federated query (90 rows) | 113 s |

Run time is mostly the model: a single Nemotron call through Nightshift took between 1 s and 43 s in these runs. An earlier robustness run of six other messy questions (Korean, all-caps, "oz" for Australia) surfaced four bugs (typo dropped a market, an unsupported market silently ignored, a remembered series not reused before comparison, a verdict with a hidden tolerance contradicting the prose); all four are fixed, and the runs above go through the same cases (a typo, an unsupported market, memory reuse, verdicts other than "above").

## Run it

Requirements: Node 20+, Docker (for Zetaris), a Zetaris hackathon registry login, and Meterless Nightshift running on a Windows/Mac machine reachable from the app.

```bash
npm install
npm run setup               # vendors the Meterless H-MEM reference engine into vendor/hmem
npm run setup:conformance   # vendors the H-MEM conformance suite
npm run conformance         # 13/13 checks pass against src/hmem_impl.ts
npm test                    # offline agent tests (fake model, fake Zetaris)
npm run typecheck           # strict TypeScript check of src/ and tests/ (after npm run setup)

cp .env.example .env        # then fill in (never commit .env):
#   ZETARIS_REST_URL, ZETARIS_ORG_ID, ZETARIS_API_KEY
#   LLM_PROVIDER=meterless, METERLESS_BASE_URL (Nightshift Console), METERLESS_RUNTIME_TOKEN

npm run smoke               # Zetaris, Nightshift, the three agencies, H-MEM
npm run ui                  # http://localhost:5177
# a true cold start: fresh H-MEM store and a fresh set of Zetaris tables/views (names get the suffix)
PSIG_MEMORY_DIR=.pricesignal/cold PSIG_ZETARIS_NS=cold1 npm run ui
npm run ask -- "is food inflation in deutschland, canada & aus still hot? thinking +5%"
```

Helper scripts used on our machine (Ubuntu laptop + Windows desktop running Nightshift) are in `scripts/` (Docker install, Zetaris install, secret entry without echo, smoke tests, integration probe, network check).

## Repository layout

```
src/agent.ts          planner loop, actions, guardrails
src/selection.ts      bounded product-aware official-series selection and validation
src/brief.ts          facts computed from Zetaris rows, number and verdict check, rendering
src/sources/          one adapter per agency: discover() + Lightning SQL onboarding templates;
                      pricelist.ts registers the internal price list and joins it with the rates
data/price_list.json  sample internal price list (fictional exporter)
examples/             real runs: brief.md plus trace.json with every model call and SQL statement
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

Eurostat (`prc_hicp_minr`, re-use policy aligned with CC BY 4.0), Statistics Canada table 18-10-0004-01 (Statistics Canada Open Licence), Australian Bureau of Statistics CPI (CC BY). PriceSignal reports official statistics and explicit scenarios; it does not estimate demand or guarantee a pricing outcome.
