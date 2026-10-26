#!/usr/bin/env bash
# PriceSignal setup step 3: dependencies, Meterless H-MEM engine, conformance + offline tests.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs || exit $?

run_step() {
  local label="$1"; shift
  "$@"
  local result=$?
  printf '%s_EXIT=%s\n' "$label" "$result"
  return "$result"
}

setup_app() {
  date
  node -v || return $?
  run_step INSTALL npm install --no-audit --no-fund || return $?
  run_step SETUP npm run setup || return $?
  run_step CONFORMANCE_SETUP npm run setup:conformance || return $?
  run_step CONFORMANCE npm run conformance || return $?
  run_step TEST npm test
}

setup_app > logs/03_app.log 2>&1
setup_result=$?
tail -15 logs/03_app.log
exit "$setup_result"
