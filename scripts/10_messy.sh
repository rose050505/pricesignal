#!/usr/bin/env bash
# PriceSignal step 10: run messy real-world questions one after another and summarise.
# Usage: bash scripts/10_messy.sh        (takes ~5-8 min; uses Nightshift, a few cents at most)
cd "$(dirname "$0")/.." || exit 1; mkdir -p logs
STAMP=$(date +%m%d_%H%M); SUM="logs/10_messy_${STAMP}_summary.txt"
QUESTIONS=(
  "우리 고추장이랑 과자, 독일·캐나다·호주에서 내년 1분기에 5% 올려도 될까? 원가 오른 건 보통 70% 정도만 가격에 반영해"
  "canda snacks price hike 4%?? is that ok, we pass thru like 60pct of costs"
  "how hot is overall inflation in oz and germany rn"
  "sauces & condiments in DE and AUS - planning +3%, we pass on about 80%"
  "japan + canada food prices, ok to raise 5%?"
  "FOOD PRICES CANADA AUSTRALIA UP 6 PERCENT???"
)
echo "== messy run $STAMP  (exit 0 = every market answered, 3 = some market not covered, other = failure)" | tee "$SUM"
i=0
for q in "${QUESTIONS[@]}"; do
  i=$((i+1)); LOG="logs/10_messy_${STAMP}_q${i}.log"
  echo "--- Q$i: $q" | tee -a "$SUM"
  T0=$(date +%s)
  timeout 420 npx tsx src/cli.ts "$q" > "$LOG" 2>&1; CODE=$?
  T1=$(date +%s)
  MODELS=$(grep -oE '\[(openrouter|nvidia|meterless)[^]]*\]|narrative \([^,]+' "$LOG" | sed -E 's/^\[|\]$//; s/^narrative \(/narrative:/' | sort | uniq -c | tr '\n' ';')
  WARN=$(grep -c '\[warn\]' "$LOG")
  echo "    exit=$CODE  time=$((T1-T0))s  warnings=$WARN  models: $MODELS" | tee -a "$SUM"
  grep -m1 -E '^#|^\*\*' "$LOG" | sed 's/^/    /' | tee -a "$SUM"
done
echo "== done. Full logs: logs/10_messy_${STAMP}_q*.log" | tee -a "$SUM"
