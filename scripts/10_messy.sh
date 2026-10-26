#!/usr/bin/env bash
# PriceSignal step 10: run messy real-world questions one after another and summarise.
# Usage: bash scripts/10_messy.sh        (uses live Nightshift and data sources; time and cost vary)
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs || exit $?
STAMP=$(date +%m%d_%H%M); SUM="logs/10_messy_${STAMP}_summary.txt"
QUESTIONS=(
  "우리 고추장이랑 과자, 독일·캐나다·호주에서 내년 1분기에 5% 올려도 될까? 원가 오른 건 보통 70% 정도만 가격에 반영해"
  "canda snacks price hike 4%?? is that ok, we pass thru like 60pct of costs"
  "how hot is overall inflation in oz and germany rn"
  "sauces & condiments in DE and AUS - planning +3%, we pass on about 80%"
  "japan + canada food prices, ok to raise 5%?"
  "FOOD PRICES CANADA AUSTRALIA UP 6 PERCENT???"
)
RESULT=0
echo "== messy run $STAMP  (CLI exit 0 = saved run; inspect the brief for requested-category and unsupported-market coverage; 3 = no usable series for a supported market; other = failure)" | tee "$SUM" || RESULT=$?
i=0
for q in "${QUESTIONS[@]}"; do
  i=$((i+1)); LOG="logs/10_messy_${STAMP}_q${i}.log"
  echo "--- Q$i: $q" | tee -a "$SUM" || RESULT=$?
  T0=$(date +%s)
  timeout 420 npx tsx src/cli.ts "$q" > "$LOG" 2>&1; CODE=$?
  if [ "$CODE" -ne 0 ] && [ "$RESULT" -eq 0 ]; then RESULT=$CODE; fi
  T1=$(date +%s)
  MODELS=$(grep -oE '\[(openrouter|nvidia|meterless)[^]]*\]|narrative \([^,]+' "$LOG" | sed -E 's/^\[|\]$//; s/^narrative \(/narrative:/' | sort | uniq -c | tr '\n' ';')
  WARN=$(grep -c '\[warn\]' "$LOG")
  echo "    exit=$CODE  time=$((T1-T0))s  warnings=$WARN  models: $MODELS" | tee -a "$SUM" || RESULT=$?
  # A failed run may have no headline; absence is not an additional logging failure.
  { grep -m1 -E '^#|^\*\*' "$LOG" || true; } | sed 's/^/    /' | tee -a "$SUM" || RESULT=$?
done
echo "== done (exit $RESULT). Full logs: logs/10_messy_${STAMP}_q*.log" | tee -a "$SUM" || RESULT=$?
exit "$RESULT"
