#!/usr/bin/env bash
# PriceSignal step 6: onboard the real DE/CA/AU series into Zetaris (no LLM) and run the federated query.
cd "$(dirname "$0")/.." || exit 1; mkdir -p logs
npx tsx src/probe.ts 2>&1 | tee logs/06_probe.log
