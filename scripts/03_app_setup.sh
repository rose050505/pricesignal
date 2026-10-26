#!/usr/bin/env bash
# PriceSignal setup step 3: dependencies, Meterless H-MEM engine, conformance + offline tests.
cd "$(dirname "$0")/.." || exit 1; mkdir -p logs
{ date; node -v; npm install --no-audit --no-fund && npm run setup && npm run setup:conformance && npm run conformance; echo "CONFORMANCE_EXIT=$?"; npm test; echo "TEST_EXIT=$?"; } > logs/03_app.log 2>&1
tail -15 logs/03_app.log
