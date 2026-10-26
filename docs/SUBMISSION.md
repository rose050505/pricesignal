# PriceSignal — HackOS submission form

The form has five fields: Track, Description (150–2000 characters), Video, GitHub, Pitch deck (optional). The integration explanation lives in the README ("Sponsor technology"), linked from the description.

**Track:** 01 — Solving Fragmented Intelligence
**GitHub:** https://github.com/rose050505/pricesignal
**Video:** (YouTube unlisted link, 1–4 min)
**Pitch deck:** PDF exported from the slide deck

## Description (paste as is)

PriceSignal helps a small exporter's pricing manager decide how much to raise prices in each market, using official statistics instead of a round number.

The evidence is fragmented. Food inflation for Germany, Canada and Australia sits in Eurostat, Statistics Canada and the Australian Bureau of Statistics, with three APIs, three formats (JSON-stat, WDS JSON, SDMX-JSON) and three category schemes. Eurostat's widely linked dataset even stopped in December 2025.

You ask in plain words, typos and Korean included: "our gochujang & snacks: is food inflation in deutschland, canada & aus still hot? thinking +5%, we pass on ~70%". The agent finds the matching series (catalogue search at Eurostat and ABS, a vetted vector list at Statistics Canada), notices discontinued datasets and coarser categories, and onboards each series into Zetaris as a Lightning REST table plus a decoding view in one schema. One federated SQL query compares the markets; a second joins the company's internal price list, also a Zetaris REST table, with the official series of each product's own category, so the brief ends with a suggested new price per SKU. Every rate cites the Zetaris statement that returned it, and that SQL is listed in the brief; the model only writes the prose, and numbers that are not in the facts are rejected.

Zetaris is where the agent builds its own data layer at run time. Meterless Nightshift is the application's AI provider, with a pinned lane serving NVIDIA Nemotron 3.5 Lightning for parsing, planning and narrative. Meterless H-MEM (reference engine, conformance 13/13) remembers series mappings, the pricing policy and the last request, so "same as last time, but +3%?" skips discovery and onboarding.

Built with Claude as the coding assistant; Cursor was not used. Setup and integration details are in the README; live runs with full agent traces are in examples/.
