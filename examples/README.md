# Example runs (live, 26 Oct 2026)

Each folder is the output of one real run on our machine: Zetaris in Docker, the agent's model calls served by NVIDIA Nemotron 3.5 Lightning through Meterless Nightshift, memory in H-MEM. The six runs were made in this order with a fresh H-MEM store (`bash scripts/15_examples.sh`), so what each run recalls was learned by the runs before it.

`brief.md` is what the user reads. `trace.json` is every step the agent took: model calls with the model that answered, memory reads and writes, and each SQL statement with its row count and time. You can see how the agent reached each number without running anything.

| Folder | Question | What to look at |
|---|---|---|
| `01_cold_start` | "our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot?? thinking +5% for Q1 … we usually pass on ~70%" | Empty memory: the agent finds the series at three agencies, notices Eurostat's discontinued dataset, onboards six series and the company price list into Zetaris, then prices nine SKUs. |
| `02_same_as_last_time` | "same as last time, but what if we only go +3%?" | The last request and the 70% policy come back from H-MEM (the brief says the policy was remembered); the +3% overrides the earlier +5%; all six series are reused and nothing is onboarded again. |
| `03_typo_market` | "canda snacks price hike 4%?? is that ok, we pass thru like 60pct of costs" | "canda" resolves to Canada only, the 60% policy replaces the remembered 70%, and the brief says Canada is compared at the Food level. |
| `04_unsupported_market` | "japan + canada food prices, ok to raise 5%?" | Japan is not covered, and the brief says so instead of dropping it. |
| `05_within_range` | "canada & australia food: is +2% enough this quarter? we pass on 70%" | Not every answer is "too high": the verdict depends on each market's evidence. |
| `06_eu_markets` | "france, italy and spain food prices: can we go +3%? we pass on about 70%" | Markets beyond the demo three: three more Eurostat series onboarded and compared in the same federated query. The sample price list has no SKUs for these markets. |

Numbers in each brief come from the Zetaris statements cited next to them (the SQL is listed at the end of the brief); the prose is written by the model and checked so it cannot introduce numbers that are not in the facts. The price list is sample data for a fictional exporter.
