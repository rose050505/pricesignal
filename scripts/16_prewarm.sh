#!/usr/bin/env bash
# PriceSignal step 16 (admin, before a recording): register and cache the demo sources in Zetaris.
# Runs demo question 1 once in the recording namespace with its own memory folder. The market series, the SKU
# category series and the internal price list are registered as Lightning REST tables + views, and their raw
# REST tables are cached (CACHE TABLE), so later queries read Zetaris instead of calling the agencies again.
# The recording UI then starts with an empty memory: the agent still discovers each series, and Zetaris already
# has it registered and cached. New markets are still discovered and registered at run time.
# Usage: PSIG_ZETARIS_NS=video1027 bash scripts/16_prewarm.sh ["question"]
# Then:  PSIG_ZETARIS_NS=video1027 PSIG_MEMORY_DIR=.pricesignal/video1027 npm run ui
# The cache lives in the running Zetaris server; restart Zetaris and it is gone (run this again).
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
if [ -z "${PSIG_ZETARIS_NS:-}" ]; then
  echo "set PSIG_ZETARIS_NS to the namespace you will record with, e.g. PSIG_ZETARIS_NS=video1027 bash scripts/16_prewarm.sh" >&2
  exit 2
fi
mkdir -p logs || exit $?
export PSIG_MEMORY_DIR=".pricesignal/prewarm-$PSIG_ZETARIS_NS"
question="${1:-our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot?? thinking +5% for Q1, too much? we usually pass on ~70% of cost increases}"
log="logs/16_prewarm_$(date +%H%M%S).log"
npx tsx src/cli.ts "$question" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
cached=$(grep -oE "CACHE TABLE [a-z_]+\.[a-z0-9_]+" "$log" | sort -u | wc -l)
echo "[prewarm] namespace $PSIG_ZETARIS_NS: ${cached// /} raw source table(s) cached in Zetaris (log: $log)"
if [ "$status" = 3 ]; then echo "[prewarm] not every market was covered (an agency may be down); run it again before recording" >&2; fi
failed=$(grep -E "\[onboard\] FAILED" "$log")
if [ -n "$failed" ]; then
  echo "[prewarm] $(printf '%s\n' "$failed" | wc -l | tr -d ' ') source(s) failed to register or cache; the run will register them live (or omit them if the agency is still down):" >&2
  printf '%s\n' "$failed" | sed -E 's/^.*FAILED (SKU )?/  - /; s/ -> .*$//' >&2
  [ "$status" = 0 ] && status=4
fi
uncached=$(grep -E "\[onboard\] onboarded " "$log" | grep -v "source cached in Zetaris")
if [ -n "$uncached" ]; then
  echo "[prewarm] $(printf '%s\n' "$uncached" | wc -l | tr -d ' ') source(s) registered without a Zetaris cache; later queries will call the agency again:" >&2
  printf '%s\n' "$uncached" | sed -E 's/^.*onboarded (SKU )?/  - /; s/ -> .*$//' >&2
  [ "$status" = 0 ] && status=4
fi
exit "$status"
