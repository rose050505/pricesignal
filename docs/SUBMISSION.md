# PriceSignal — HackOS submission form

The form has six fields: Track, Description (150–2000 characters), Sponsor technology explanation (up to 4000 characters), Video, GitHub, Pitch deck (optional). The sponsor explanation below is a condensed form of the README's "Sponsor technology"; the description links the repository.

**Track:** 01 — Solving Fragmented Intelligence
**GitHub:** https://github.com/rose050505/pricesignal
**Video:** https://youtu.be/XjbFIqRgQWk
**Pitch deck:** PDF exported from the slide deck

## Description (paste as is)

PriceSignal helps a small exporter check a proposed price change against official inflation and a separate cost recovery target.

Food inflation in Germany, Canada and Australia is fragmented across Eurostat, Statistics Canada and ABS: three APIs, three formats, three category schemes. An older Eurostat dataset stopped in December 2025. The same path covers 17 markets, including the United States through the Bureau of Labor Statistics.

Ask in plain words, typos and Korean included. It finds the official series and registers each in Zetaris: a Lightning REST table, a decoding view in one schema, and a CACHE TABLE copy. One federated query over a schemastore view compares markets; a second joins the company's price list. Each rate cites its query and SQL.

NVIDIA Nemotron, through Meterless Nightshift with its reasoning pass switched off (9-34 s per brief in the recorded runs), reads the request (typo markets, the category; code extracts every %), proposes discovery steps that code checks and completes, picks official categories for snack and condiment products, and explains the computed facts. Numeric, verdict and trend checks run per sentence; a wrong headline is rewritten, wrong sentences are dropped.

Code calculates a historical benchmark (latest YoY and recent annual mean), how far the proposal sits from it, which change would fit every market, and a cost target from cost change, unit-cost share and its timing, and pass-through. It does not forecast demand.

Meterless H-MEM (reference engine, conformance 13/13) remembers policies, requests, verified mappings and each market's last result, so "same as last time, but +3%?" skips planning and market discovery (product-category checks still run) and says what changed; stale mappings are rechecked.

Built with Claude Code and Codex; no Cursor. Recorded runs you can replay without any keys: rose050505.github.io/pricesignal. Code and limits: github.com/rose050505/pricesignal

## Sponsor technology explanation (paste as is)

Zetaris is where three agencies' data becomes one dataset. At run time the agent registers each official series it finds (Eurostat JSON-stat, Statistics Canada WDS, ABS SDMX, US BLS) with CREATE LIGHTNING REST TABLE, flattens it in a decoding CREATE SCHEMASTORE VIEW into one common schema (country, concept, category, period, yoy_pct, source_id) and keeps a CACHE TABLE copy. Each comparison is one federated query over a schemastore view that unions the markets; a second federated query joins the company's own price list (registered the same way) with each product's official category. Every rate in the brief cites its statement id and the SQL is listed. Views are validated before use (observation count, non-future period, freshness window), obsolete mappings are replaced only after the new view passes, and every statement passes a SQL allowlist. Measured: the comparison took 5.7-8.8 s uncached and 1.4-1.8 s cached.

Meterless Nightshift is the app's only AI provider: OpenAI-compatible /v1/chat/completions with the runtime token, meterless-app and meterless-scope: user headers, GET /v1/models for online/offline, and the meterless/fast route. Slow replies are hedged (a second request after 10 s, first reply wins), and every step has a time budget with a code fallback, so a slow provider cannot stop a brief. The model that served each step is shown in the trace.

Meterless H-MEM (reference engine used unchanged; npm run conformance: 13/13) is the agent's memory across sessions, and it changes what the agent does. Verified series mappings are long-term memories with structured tags: a recalled mapping skips discovery and onboarding after a live freshness check, and when every mapping is remembered the planner is not called at all. Policies, the last request and each market's last result are stored, so "same as last time, but +3%?" opens with what changed since the last brief. Re-onboarded series and changed policies supersede the old record instead of deleting it. Mappings are read by exact tags because a near match would be a different statistic.

NVIDIA Nemotron (nemotron-3.5-lightning through Nightshift's NVIDIA API lane, one reply via its OpenRouter lane) does all language work: it reads the messy request (typo markets, Korean, the product category), proposes the discovery batch that code checks and completes, picks official categories for snack and condiment products from a shortlist (it cannot invent a source), and writes the explanation of the computed facts. The setting that mattered most: sending the chat-template switch enable_thinking: false cut request reading from 56-63 s to 3.4-5.0 s; with it the eight recorded runs took 9-34 s per brief. In those runs 8 of 8 requests were read by Nemotron and 8 of 8 headlines passed the per-sentence numeric, verdict and trend checks (one after a headline rewrite). Numbers and verdicts are computed in code from the Zetaris rows, so the model cannot move them.

SpaceX AI: not used. Cursor: not used; built with Claude Code and Codex.

What is unusual: the agent registers new government sources in Zetaris while answering, instead of relying on a pre-loaded warehouse; memory decides whether planning happens at all; and the language model is kept to reading and explaining, with every figure traceable to a query.

Pre-existing components (not built by us): the Meterless H-MEM reference engine and conformance suite (Apache-2.0, used unchanged), the Zetaris platform and the Lightning SQL decoding patterns from its recipes, Meterless Nightshift, NVIDIA Nemotron, and the dev tools tsx, typescript, @types/node and degit. All other code was written during the build window. Details: README, "Sponsor technology".
