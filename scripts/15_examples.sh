#!/usr/bin/env bash
# Record all six live examples before replacing any checked-in recording.
# Optional PSIG_MEMORY_DIR must name a NEW direct child of .pricesignal/.
# Optional PSIG_ZETARIS_NS must be fresh to demonstrate actual cold onboarding.
set -u -o pipefail
cd "$(dirname "$0")/.." || exit 1
STAMP=$(date +%Y%m%d_%H%M%S)_$$
export PSIG_MEMORY_DIR="${PSIG_MEMORY_DIR:-.pricesignal/examples-${STAMP}}"
export PSIG_ZETARIS_NS="${PSIG_ZETARIS_NS:-ex${STAMP}}"
# Never erase an existing store, and reject the normal UI store before inspecting it.
node --input-type=commonjs <<'NODE' || exit 2
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve('.pricesignal');
const target = path.resolve(process.env.PSIG_MEMORY_DIR);
if (path.dirname(target) !== base || path.basename(target) === 'memory') {
  console.error('PSIG_MEMORY_DIR must name a new direct child of .pricesignal/, other than memory.');
  process.exit(2);
}
fs.mkdirSync(base, {recursive:true});
try { fs.mkdirSync(target); }
catch { console.error('The requested memory directory already exists or cannot be created. Choose a new name.'); process.exit(2); }
NODE
BUNDLE="logs/15_examples_${STAMP}"
mkdir -p "$BUNDLE/staged" "$BUNDLE/previous" || exit 2
SUM="$BUNDLE/summary.txt"
printf 'memory: %s\nnamespace: %s\n' "$PSIG_MEMORY_DIR" "$PSIG_ZETARIS_NS" | tee "$SUM"
NAMES=()
run() { # $1 folder name, $2 question
  local NAME="$1" QUESTION="$2" LOG="$BUNDLE/$1.log"
  local T0 T1 CODE OUT
  T0=$(date +%s)
  timeout 420 npx tsx src/cli.ts "$QUESTION" > "$LOG" 2>&1
  CODE=$?
  T1=$(date +%s)
  OUT=$(sed -n 's/^\[pricesignal\] saved \(out\/[^ ]*\)\/brief\.md$/\1/p' "$LOG" | tail -n 1)
  if [ "$CODE" -ne 0 ] || [ -z "$OUT" ] || [ ! -s "$OUT/brief.md" ] || [ ! -s "$OUT/trace.json" ] || [ ! -s "$OUT/evidence.json" ]; then
    printf 'FAIL %s (%s s, exit %s) - see %s; previous examples preserved\n' "$NAME" "$((T1-T0))" "$CODE" "$LOG" | tee -a "$SUM"
    return 1
  fi
  if ! node -e 'const fs=require("node:fs"); const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(x.trace)||!Array.isArray(x.sql))process.exit(1)' "$OUT/trace.json"; then
    printf 'FAIL %s (invalid trace); previous examples preserved\n' "$NAME" | tee -a "$SUM"
    return 1
  fi
  mkdir -p "$BUNDLE/staged/$NAME" || return 1
  cp "$OUT/brief.md" "$OUT/trace.json" "$OUT/evidence.json" "$BUNDLE/staged/$NAME/" || return 1
  node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({recordedAt:new Date().toISOString(),elapsedSeconds:Number(process.argv[2]),exitCode:0,namespace:process.env.PSIG_ZETARIS_NS},null,2)+"\n")' "$BUNDLE/staged/$NAME/recording.json" "$((T1-T0))" || return 1
  NAMES+=("$NAME")
  printf 'OK   %s (%s s, exit %s)\n' "$NAME" "$((T1-T0))" "$CODE" | tee -a "$SUM"
}
run 01_cold_start "our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot?? our costs rose 8%, unit costs are 60% of our selling price. we pass on ~70% of cost increases. thinking +5% for Q1, too much?" || exit 1
run 02_same_as_last_time "same as last time, but what if we go -2%?" || exit 1
run 03_typo_market "canda snacks price hike 4%?? is that ok, we pass thru like 60pct of costs" || exit 1
run 04_unsupported_market "japan + canada food prices, ok to raise 5%?" || exit 1
run 05_within_range "canada & australia food: costs rose 8%, unit costs are 60% of our selling price; we pass on 70%; what about +3%?" || exit 1
run 06_eu_markets "france, italy and spain food prices: can we go +3%? we pass on about 70%" || exit 1
# All application runs and copies succeeded. Preserve old recordings before promotion.
mkdir -p examples || exit 2
for NAME in "${NAMES[@]}"; do
  if [ -e "examples/$NAME" ]; then mv "examples/$NAME" "$BUNDLE/previous/$NAME" || exit 2; fi
  mv "$BUNDLE/staged/$NAME" "examples/$NAME" || exit 2
done
printf 'runs ok: %s/6\nrecordings: examples/\nprevious recordings and logs: %s\n' "${#NAMES[@]}" "$BUNDLE" | tee -a "$SUM"
