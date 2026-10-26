# PriceSignal — HackOS submission form

The form has five fields: Track, Description (150–2000 characters), Video, GitHub, Pitch deck (optional). The integration explanation lives in the README ("Sponsor technology"), linked from the description.

**Track:** 01 — Solving Fragmented Intelligence
**GitHub:** https://github.com/rose050505/pricesignal
**Video:** (YouTube unlisted link, 1–4 min)
**Pitch deck:** PDF exported from the slide deck

## Description (paste as is)

PriceSignal helps a small exporter's pricing manager compare a proposed price rise across markets using official evidence.

Food inflation in Germany, Canada and Australia is fragmented across Eurostat, Statistics Canada and ABS: three APIs, three formats and three category schemes. Eurostat's widely linked dataset even stopped in December 2025.

Ask in plain words, typos and Korean included: "our gochujang & snacks: is food inflation in deutschland, canada & aus still hot? thinking +5%, we pass on ~70%". The agent searches Eurostat and ABS catalogues and a vetted Canadian vector list, then registers official sources in Zetaris as Lightning REST tables and decoding views in one schema. A federated SQL query compares the markets; another joins the company's price list. Every rate cites the local query reference and its SQL.

NVIDIA Nemotron, through Meterless Nightshift, parses requests, plans discovery, selects official categories using actual product names, and explains computed results. Product selections are bounded to the supplied shortlist. Invalid or timed-out choices use a visibly marked broader Food proxy, or omit affected SKU prices. Code calculates ranges, verdicts and prices, checks narrative numbers and verdict terms, and falls back to a computed summary on failure. A stated cost increase adds a separate cost comparison.

Meterless H-MEM remembers policies, requests and verified series. "Same as last time, but +3%?" reuses fresh mappings and skips the planning call when all market mappings are available. Product choices have separate memory scopes and are rechecked when products change or stored series become stale or unavailable.

Built with Claude Code and Codex; Cursor was not used. README documents integrations and limits; examples/ contains recorded runs with full traces. Earlier examples predate the latest product-selection guard.
