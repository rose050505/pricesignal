#!/usr/bin/env bash
# Measure the demo path honestly: empty memory (cold), then "same as last time" (warm).
# Also proves the internal price list join. Usage: bash scripts/13_coldwarm.sh   (or: ... warm  to keep memory and run only the warm step)
cd "$(dirname "$0")/.." || exit 1; mkdir -p logs
STAMP=$(date +%m%d_%H%M); SUM="logs/13_coldwarm_${STAMP}_summary.txt"
echo "== offline tests" | tee "$SUM"; npx tsx --test tests/agent.test.ts 2>&1 | grep -E "(^# |^ℹ )(tests|pass|fail)" | tee -a "$SUM"
[ "$1" = "warm" ] || rm -rf .pricesignal
run(){ # $1 label, $2 question
  local LOG="logs/13_coldwarm_${STAMP}_$1.log"; local T0=$(date +%s)
  timeout 420 npx tsx src/cli.ts "$2" > "$LOG" 2>&1; local CODE=$?; local T1=$(date +%s)
  echo "--- $1 ($((T1-T0)) s, exit $CODE): $2" | tee -a "$SUM"
  grep -E '\[(memory|pricing|onboard|warn|error|done)\]' "$LOG" | sed 's/^/    /' | cut -c1-220 | tee -a "$SUM"
  grep -A12 '^## Your price list' "$LOG" | sed 's/^/    /' | tee -a "$SUM"
}
[ "$1" = "warm" ] || run cold "our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot?? thinking +5% for Q1, too much? we usually pass on ~70% of cost increases"
run warm "same as last time, but what if we only go +3%?"
echo "== done: $SUM" | tee -a "$SUM"
