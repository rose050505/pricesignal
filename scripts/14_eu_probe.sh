#!/usr/bin/env bash
# Check that the Eurostat path works beyond Germany (no LLM, ~1-2 min): FR, IT, ES, NL.
cd "$(dirname "$0")/.." || exit 1; mkdir -p logs
npx tsx src/probe.ts FR IT ES NL 2>&1 | tee logs/14_eu_probe.log
