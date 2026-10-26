#!/usr/bin/env bash
# PriceSignal step 7: full agent run from the terminal. Usage: bash scripts/07_ask.sh "question"
cd "$(dirname "$0")/.." || exit 1; mkdir -p logs
npx tsx src/cli.ts "${1:-our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot?? thinking +5% for Q1, too much? we usually pass on ~70% of cost increases}" 2>&1 | tee "logs/07_ask_$(date +%H%M%S).log"
