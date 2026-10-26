#!/usr/bin/env bash
# Regenerate examples/ from live runs with a fresh, separate H-MEM store (the UI memory is untouched).
# Each run saves brief.md + trace.json into examples/<name>/. Usage: bash scripts/15_examples.sh
cd "$(dirname "$0")/.." || exit 1; mkdir -p logs
export PSIG_MEMORY_DIR=".pricesignal/examples-memory"
rm -rf "$PSIG_MEMORY_DIR"
STAMP=$(date +%m%d_%H%M); SUM="logs/15_examples_${STAMP}_summary.txt"
: > "$SUM"
run(){ # $1 folder name, $2 question
  local LOG="logs/15_examples_${STAMP}_$1.log"; local T0=$(date +%s)
  timeout 420 npx tsx src/cli.ts "$2" > "$LOG" 2>&1; local CODE=$?; local T1=$(date +%s)
  local OUT; OUT=$(grep -o 'saved out/[^ ]*/brief.md' "$LOG" | sed 's/^saved //; s#/brief.md$##')
  if [ -n "$OUT" ] && [ -f "$OUT/brief.md" ]; then
    rm -rf "examples/$1"; mkdir -p "examples/$1"; cp "$OUT/brief.md" "$OUT/trace.json" "examples/$1/"
    echo "OK   $1 ($((T1-T0)) s, exit $CODE)" | tee -a "$SUM"
  else
    echo "FAIL $1 ($((T1-T0)) s, exit $CODE) - see $LOG" | tee -a "$SUM"
  fi
  grep -E '\[(done|warn|error)\]|Verdict|verdict' "$LOG" | head -8 | sed 's/^/    /' | cut -c1-200 | tee -a "$SUM"
}
run 01_cold_start "our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot?? thinking +5% for Q1, too much? we usually pass on ~70% of cost increases"
run 02_same_as_last_time "same as last time, but what if we only go +3%?"
run 03_typo_market "canda snacks price hike 4%?? is that ok, we pass thru like 60pct of costs"
run 04_unsupported_market "japan + canada food prices, ok to raise 5%?"
run 05_within_range "canada & australia food: is +2% enough this quarter? we pass on 70%"
run 06_eu_markets "france, italy and spain food prices: can we go +3%? we pass on about 70%"
echo "== done: $SUM" | tee -a "$SUM"
grep -c '^OK' "$SUM" | sed 's/^/runs ok: /'
