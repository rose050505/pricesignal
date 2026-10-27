# PriceSignal — HackOS submission form

The form has five fields: Track, Description (150–2000 characters), Video, GitHub, Pitch deck (optional). The integration explanation lives in the README ("Sponsor technology"), linked from the description.

**Track:** 01 — Solving Fragmented Intelligence
**GitHub:** https://github.com/rose050505/pricesignal
**Video:** (YouTube unlisted link, 1–4 min)
**Pitch deck:** PDF exported from the slide deck

## Description (paste as is)

PriceSignal helps a small exporter check a proposed price change against official inflation and a separate cost recovery target.

Food inflation in Germany, Canada and Australia is fragmented across Eurostat, Statistics Canada and ABS: three APIs, three formats, three category schemes. An older Eurostat dataset stopped in December 2025.

Ask in plain words, typos and Korean included. The agent finds the official series (Eurostat and ABS category lookups, a vetted Canadian vector list) and registers each in Zetaris: a Lightning REST table, a decoding view in one schema, and a CACHE TABLE copy. One federated query over a schemastore view compares markets; a second joins the company's price list. Each rate cites its query and SQL.

NVIDIA Nemotron, through Meterless Nightshift with its reasoning pass switched off (a brief in under a minute; 12-30 s in recorded runs), reads the request (typo markets, the category; code extracts every %), proposes discovery steps that code checks and completes, picks official categories for snack and condiment products, and explains the computed facts. Numeric, verdict and trend checks run per sentence; a wrong headline is rewritten, wrong sentences are dropped.

Code calculates a historical benchmark (latest YoY and recent annual mean, with observation coverage), how far the proposal sits from it, which change would fit every market, and a cost target from cost change, unit-cost share and its timing, and pass-through. It does not forecast demand.

Meterless H-MEM (reference engine, conformance 13/13) remembers policies, requests, verified mappings and each market's last result, so "same as last time, but +3%?" skips planning and discovery and says what changed; stale mappings are rechecked.

Built with Claude Code and Codex; no Cursor. Replay without keys: rose050505.github.io/pricesignal. Code, limits, seven recorded runs with traces and offline-verifiable SQL rows: github.com/rose050505/pricesignal
