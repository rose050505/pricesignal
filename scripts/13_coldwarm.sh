#!/usr/bin/env bash
# Measure a cold request and its memory repeat without erasing existing stores.
# Warm-only requires the memory directory and namespace printed by a successful cold run.
set -u -o pipefail
cd "$(dirname "$0")/.." || exit 1
MODE="${1:-cold}"
if [ "$#" -gt 1 ] || { [ "$MODE" != cold ] && [ "$MODE" != warm ]; }; then
  echo 'Usage: bash scripts/13_coldwarm.sh [cold|warm]' >&2
  exit 2
fi
STAMP=$(date -u +%Y%m%d_%H%M%S)_$$
if [ "$MODE" = warm ]; then
  if [ -z "${PSIG_MEMORY_DIR:-}" ] || [ -z "${PSIG_ZETARIS_NS:-}" ]; then
    echo 'Warm-only requires explicit PSIG_MEMORY_DIR and PSIG_ZETARIS_NS from a successful cold run.' >&2
    exit 2
  fi
else
  export PSIG_MEMORY_DIR="${PSIG_MEMORY_DIR:-.pricesignal/coldwarm-${STAMP}}"
  export PSIG_ZETARIS_NS="${PSIG_ZETARIS_NS:-cw${STAMP}}"
fi
export PSIG_MEMORY_DIR PSIG_ZETARIS_NS
# Reject the UI memory name before inspecting any store; never delete a directory.
node --input-type=commonjs - "$MODE" <<'NODE' || exit 2
const fs = require('node:fs'), path = require('node:path');
const base = path.resolve('.pricesignal'), target = path.resolve(process.env.PSIG_MEMORY_DIR);
const fail = message => { console.error(message); process.exit(2); };
if (path.dirname(target) !== base || path.basename(target) === 'memory') fail('PSIG_MEMORY_DIR must name a direct experimental child of .pricesignal/, other than memory.');
if (!/^[a-zA-Z0-9_-]+$/.test(process.env.PSIG_ZETARIS_NS)) fail('PSIG_ZETARIS_NS must contain only letters, numbers, underscores or hyphens.');
try {
  if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink()) fail('The experimental memory parent must not be a symbolic link.');
  if (process.argv[2] === 'cold') {
    fs.mkdirSync(base, {recursive:true});
    fs.mkdirSync(target); // Existing stores, including symbolic links, are refused.
  } else {
    if (!fs.lstatSync(target).isDirectory() || fs.realpathSync(target) !== target) fail('Warm-only requires the original experimental directory, not a symbolic link.');
    const context = JSON.parse(fs.readFileSync(path.join(target, '.coldwarm-context.json'), 'utf8'));
    if (context.memory !== target || context.namespace !== process.env.PSIG_ZETARIS_NS) fail('Warm-only memory and namespace must match the successful cold run.');
  }
} catch {
  fail(process.argv[2] === 'cold' ? 'The cold memory directory already exists or cannot be created. Choose a new name.' : 'Warm-only requires a successful cold-run context in the specified experimental directory.');
}
NODE
mkdir -p logs || exit 2
SUM="logs/13_coldwarm_${STAMP}_summary.txt"
printf 'memory: %s\nnamespace: %s\n' "$PSIG_MEMORY_DIR" "$PSIG_ZETARIS_NS" | tee "$SUM" || exit 2
TEST_LOG="logs/13_coldwarm_${STAMP}_tests.log"
echo '== all offline tests' | tee -a "$SUM" || exit 2
npm test > "$TEST_LOG" 2>&1
TEST_CODE=$?
tail -20 "$TEST_LOG" | tee -a "$SUM" || exit 2
if [ "$TEST_CODE" -ne 0 ]; then
  printf 'FAIL offline tests (exit %s); no application run started\n' "$TEST_CODE" | tee -a "$SUM"
  exit "$TEST_CODE"
fi
run(){ # $1 label, $2 question
  local LABEL="$1" QUESTION="$2" LOG="logs/13_coldwarm_${STAMP}_$1.log"
  local T0 T1 CODE OUT
  T0=$(date +%s)
  timeout 420 npx tsx src/cli.ts "$QUESTION" > "$LOG" 2>&1
  CODE=$?
  T1=$(date +%s)
  printf '%s (%s s, exit %s) - %s\n' "$LABEL" "$((T1-T0))" "$CODE" "$LOG" | tee -a "$SUM" || return 2
  if [ "$CODE" -ne 0 ]; then
    printf 'FAIL %s; sequence stopped, existing stores preserved\n' "$LABEL" | tee -a "$SUM"
    return "$CODE"
  fi
  OUT=$(sed -n 's/^\[pricesignal\] saved \(out\/[^ ]*\)\/brief\.md$/\1/p' "$LOG" | tail -n 1)
  if [ -z "$OUT" ] || [ ! -s "$OUT/brief.md" ] || [ ! -s "$OUT/trace.json" ] || [ ! -s "$OUT/evidence.json" ]; then
    printf 'FAIL %s: missing saved brief, trace or evidence\n' "$LABEL" | tee -a "$SUM"
    return 2
  fi
  if ! node --input-type=commonjs - "$OUT" <<'NODE'
const fs=require('node:fs'), path=require('node:path');
try {
  const dir=path.resolve(process.argv[2]);
  if(path.dirname(dir)!==path.resolve('out')) throw Error('Unexpected output location');
  const trace=JSON.parse(fs.readFileSync(path.join(dir,'trace.json'),'utf8'));
  const evidence=JSON.parse(fs.readFileSync(path.join(dir,'evidence.json'),'utf8'));
  if(!Array.isArray(trace.trace)||!Array.isArray(trace.sql)||evidence.schemaVersion!==1||![2,3].includes(evidence.methodVersion)||!Array.isArray(evidence.queries?.market?.rows)||!Array.isArray(evidence.results?.facts)||!Array.isArray(evidence.results?.skus)) throw Error('Malformed saved artifacts');
} catch(error) { console.error(String(error)); process.exit(2); }
NODE
  then
    printf 'FAIL %s: invalid saved artifacts\n' "$LABEL" | tee -a "$SUM"
    return 2
  fi
  printf 'OK %s: %s/brief.md and evidence.json\n' "$LABEL" "$OUT" | tee -a "$SUM" || return 2
}
if [ "$MODE" = cold ]; then
  run cold "our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot?? thinking +5% for Q1, too much? we usually pass on ~70% of cost increases" || exit $?
  # Only a successful cold run can authorize a later warm-only measurement.
  node --input-type=commonjs <<'NODE' || exit 2
const fs=require('node:fs'), path=require('node:path');
const memory=path.resolve(process.env.PSIG_MEMORY_DIR);
fs.writeFileSync(path.join(memory,'.coldwarm-context.json'),JSON.stringify({memory,namespace:process.env.PSIG_ZETARIS_NS})+'\n',{flag:'wx'});
NODE
fi
run warm "same as last time, but what if we only go +3%?" || exit $?
printf '== done: %s\n' "$SUM" | tee -a "$SUM"
