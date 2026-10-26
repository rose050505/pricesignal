# PriceSignal — HackOS submission form

The form has five fields: Track, Description (150–2000 characters), Video, GitHub, Pitch deck (optional). The integration explanation lives in the README ("Sponsor technology"), linked from the description.

**Track:** 01 — Solving Fragmented Intelligence
**GitHub:** https://github.com/rose050505/pricesignal
**Video:** (YouTube unlisted link, 1–4 min)
**Pitch deck:** PDF exported from the slide deck

## Description (paste as is)

PriceSignal helps a small exporter compare proposed price changes with official inflation and a separate cost recovery target.

Food inflation in Germany, Canada and Australia is fragmented across Eurostat, Statistics Canada and ABS: three APIs, three formats and three category schemes. Eurostat's widely linked dataset even stopped in December 2025.

Ask in plain words, typos and Korean included. The agent searches Eurostat and ABS catalogues and a vetted Canadian vector list, then registers sources in Zetaris as Lightning REST tables and decoding views in one schema. One federated SQL query compares markets; another joins the company's price list. Each rate has a local query reference and the SQL that returned it.

NVIDIA Nemotron, through Meterless Nightshift, parses requests, plans discovery, selects official categories using actual product names, and explains computed facts. Product choices are bounded to the supplied shortlist. Invalid or timed-out choices use a visibly marked broader Food proxy or omit affected SKU prices.

Code calculates a historical benchmark from the latest YoY rate and recent annual mean, with actual observation coverage. It compares the proposal without claiming to forecast demand. A separate cost target uses unit-cost share of selling price, stated cost change and pass-through policy; missing cost share stays missing. Narrative checks reject numeric and comparison mismatches, with a computed summary on failure.

Meterless H-MEM remembers policies, requests and verified mappings. "Same as last time, but +3%?" reuses fresh evidence, skips unnecessary planning and recalls product-specific choices. Changed products or stale mappings trigger rechecking; past outcomes distinguish source and method changes.

Built with Claude Code and Codex; Cursor was not used. README documents integrations and limits; examples/ contains recorded runs with full traces.
