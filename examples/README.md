# Recorded runs — 27 Oct 2026 (KST)

These six consecutive runs use the current historical-benchmark and cost-share method introduced on 27 Oct. They ran against Zetaris in Docker, NVIDIA Nemotron 3.5 Lightning through Meterless Nightshift, and a fresh H-MEM store. The first run also used a fresh Zetaris suffix, `night1027c7`; later runs reused what earlier runs left behind. This was a new set of application tables and views, not an empty Zetaris installation.

Each folder contains the actual `brief.md`, `trace.json` (model and agent events plus SQL statements, row counts and timings), and `recording.json` (UTC recording time, CLI elapsed seconds, exit code and namespace). Raw briefs and traces are not edited to improve their outcomes. Timing in the table includes CLI startup; “numbers” is the agent's measured time to the first market result.

| Folder | Request and observed behavior | CLI / numbers | Model-written summary |
|---|---|---|---|
| [01_cold_start](01_cold_start/brief.md) | Messy DE/CA/AU request: proposal +5%, costs +8%, cost share 60%, pass-through 70%. Cost target 3.4%. Created 9 REST tables and 15 views, compared three markets and priced 9 SKUs. | 85 s / 29.1 s | Provider error/timeout; computed summary retained |
| [02_same_as_last_time](02_same_as_last_time/brief.md) | “Same as last time, but -2%”: markets, category, cost/share and policy remembered; negative proposal preserved. Nine views reused, no planning or new DDL; 6 SKU-category discoveries retried after the preceding selection timed out. | 80 s / 24.5 s | Provider error/timeout; computed summary retained |
| [03_typo_market](03_typo_market/brief.md) | “canda” resolves to Canada; 60% policy replaces 70%. Proposed +4% is within Food's 2.2–4.1% benchmark. Nemotron selected broader Food proxies for two product groups in 12.7 s. | 47 s / 12.2 s | Passed numeric and comparison checks |
| [04_unsupported_market](04_unsupported_market/brief.md) | Japan is explicitly not covered; Canada is answered. Proposed +5% is above 2.2–4.1%. The two Canadian product choices are reused from memory. | 19 s / 9.2 s | Passed numeric and comparison checks |
| [05_within_range](05_within_range/brief.md) | Canada/Australia Food: +3% is within both market benchmarks. Cost target 3.4% is within Canada's benchmark and above Australia's. Nemotron selected the Australian condiment and snack series in 7.9 s; the Canadian broader proxies were remembered. | 47 s / 13.2 s | Passed numeric and comparison checks |
| [06_eu_markets](06_eu_markets/brief.md) | France/Italy/Spain Food: six new Eurostat series registered, one comparison query returned 90 rows. +3% is above all three benchmarks. The sample price list has no SKUs for these markets. | 79 s / 38.1 s | Passed numeric and comparison checks |

The first two runs timed out while choosing narrow SKU categories, so all six affected product groups used visibly marked broader Food proxies. This is not a successful model-selection demonstration; examples 03 and 05 show successful choices, and 04 shows reuse.

**Category limitation visible in these recordings:** the mixed food/snacks request in 01 was parsed as `snacks`. Its German market card uses “Sugar, confectionery and desserts”, while its German chips SKU uses a broader Food proxy. Market catalogue matching and product-aware SKU selection are separate paths; the market card is not a validated match for the named products. Check the actual official category label when interpreting the result. The Canadian adapter only supports Food and All-items vectors.

Historical benchmarks describe the latest YoY rate and recent one-year mean; they are not recommended prices, forecasts or confidence intervals. The price list is illustrative data for a fictional exporter. Numeric and comparison checks help reject incorrect prose but do not establish complete semantic correctness.

To make a new recording, run `bash scripts/15_examples.sh`. It generates a new memory directory and Zetaris suffix by default. If overriding them, choose unused names. It refuses an existing memory directory, requires all six successful exits and complete artifacts before replacing these folders, and keeps previous recordings and logs under `logs/`. The older policy-scaled examples remain in Git history.
