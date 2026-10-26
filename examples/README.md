# Recorded runs — 27 Oct 2026 (KST)

These six consecutive runs include the historical-benchmark and cost-share method, explicit comparison-category handling, calendar-based ABS/StatCan YoY decoders, common-period comparison and sentence-boundary parsing correction. They ran against Zetaris in Docker, NVIDIA Nemotron 3.5 Lightning through Meterless Nightshift, and a fresh H-MEM store. The first run also used a fresh Zetaris suffix, `night1027c12`; later runs reused what earlier runs left behind. This was a new set of application tables and views, not an empty Zetaris installation.

Each folder contains the actual `brief.md`, `trace.json` (model and agent events plus SQL statements, row counts and timings), `recording.json` (UTC recording time, CLI elapsed seconds, exit code and namespace), and `evidence.json` (versioned calculation inputs, raw SQL results and derived outputs). Raw briefs and traces are not edited to improve their outcomes. Timing includes CLI startup; “numbers” is the agent's measured time to the first market result. The separate evidence packet retains unrounded market and pricing rows, actual column metadata and the calculation time. All six packets passed `npm run verify -- <folder>/evidence.json`: 2,343 field comparisons, 368 market rows and 417 pricing rows. A separate Decimal-based arithmetic audit checked 739 values with no mismatch.

| Folder | Request and observed behavior | CLI / numbers | Model-written summary |
|---|---|---|---|
| [01_cold_start](01_cold_start/brief.md) | Messy DE/CA/AU request: explicit Food comparison, proposal +5%, costs +8%, cost share 60%, pass-through 70%, with sentence breaks. Cost target 3.4%. Created 10 REST tables and 13 views; compared three markets and priced 9 SKUs. Nemotron selected all six narrow product groups in 19.7 s. | 110 s / 52.9 s | HTTP 502 then retry timeout; computed summary retained |
| [02_same_as_last_time](02_same_as_last_time/brief.md) | “Same as last time, but -2%”: markets, category, cost/share and policy remembered; negative proposal preserved. Twelve views and all product choices reused, with no planning, discovery or new DDL. | 94 s / 39.5 s | Provider timeout; computed summary retained |
| [03_typo_market](03_typo_market/brief.md) | “canda” resolves to Canada; 60% policy replaces 70%. Proposed +4% is within the broader Food 2.2–4.1% benchmark used for snacks. Canadian product choices reused. | 66 s / 44.8 s | Passed numeric and comparison checks |
| [04_unsupported_market](04_unsupported_market/brief.md) | Japan is explicitly not covered; Canada is answered. Proposed +5% is above 2.2–4.1%. The two Canadian product choices are reused from memory. | 21 s / 9.1 s | Passed numeric and comparison checks |
| [05_within_range](05_within_range/brief.md) | Canada/Australia Food: +3% is within both market benchmarks. Cost target 3.4% is within Canada's benchmark and above Australia's. Eight views and all product choices reused, with no planning or discovery. | 68 s / 13.0 s | Rejected CA/AU numeric attribution; rewrite timed out; computed summary retained |
| [06_eu_markets](06_eu_markets/brief.md) | France/Italy/Spain Food: six new Eurostat series registered, one comparison query returned 90 rows. +3% is above all three benchmarks. The sample price list has no SKUs for these markets. | 83 s / 44.2 s | Passed numeric and comparison checks |

Example 01 shows successful model selection: German gochujang uses the condiment series; German chips use a broader Food proxy; Australian condiments and snacks use their selected series; Canadian narrow categories use broader Food proxies. These choices are validated and remembered, not guaranteed exact product matches. The Canadian adapter only supports Food and All-items vectors. A supported request category such as snacks can therefore have broader Food evidence.

The common-period table uses August 2026 for the DE/CA/AU and CA/AU comparisons, and September 2026 for FR/IT/ES. Latest market cards keep each market's latest available period. Aligning dates does not make national baskets or categories identical.

**Verification scope:** the offline command checks that saved rows reproduce market means, counts, benchmarks, cost comparisons, common-period alignment and recorded SKU price arithmetic. It preserves Japan as unsupported in example 04: two markets requested, one verified. Example 06 has no pricing evidence and verifies no SKUs. Verification does not authenticate the agency/database response, replay the source index-to-YoY decoder, assess product-category fit, or prove the full meaning of model prose. Consistent changes to both rows and results can still pass. Numeric checks are not a guarantee of complete semantic correctness. Earlier recordings remain unchanged in Git history and local backups.

```bash
npm run verify -- examples/01_cold_start/evidence.json
npm run --silent verify -- examples/04_unsupported_market/evidence.json --json
```

Historical benchmarks describe the latest YoY rate and recent one-year mean; they are not recommended prices, forecasts or confidence intervals. The price list is illustrative data for a fictional exporter. The earlier mixed food/snacks and policy-scaled recordings remain in Git history and local recording backups; they are not the current method.

To make a new recording, run `bash scripts/15_examples.sh`. It generates a new memory directory and Zetaris suffix by default. If overriding them, choose unused names. It refuses an existing memory directory, requires all six successful exits and complete artifacts before replacing these folders, and keeps previous recordings and logs under `logs/`.
