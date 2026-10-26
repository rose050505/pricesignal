#!/usr/bin/env bash
# PriceSignal step 5: layer checks (Zetaris, LLM provider, agencies, H-MEM). Optional arg: zetaris|llm|sources|memory
cd "$(dirname "$0")/.." || exit 1; mkdir -p logs
{ echo "== $(date +%H:%M:%S) smoke ${1:-all}"; npx tsx src/smoke.ts "${1:-}"; } 2>&1 | tee -a logs/05_smoke.log
