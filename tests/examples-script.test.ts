import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pricesignal-examples-'));
  for (const dir of ['scripts', 'bin', '.pricesignal', 'examples/01_cold_start']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.copyFileSync(new URL('../scripts/15_examples.sh', import.meta.url), path.join(root, 'scripts/15_examples.sh'));
  fs.writeFileSync(path.join(root, 'examples/01_cold_start/brief.md'), 'previous recording');
  fs.writeFileSync(path.join(root, 'bin/npx'), `#!${process.execPath}
const fs=require('node:fs');
const calls=fs.existsSync('calls.json')?JSON.parse(fs.readFileSync('calls.json','utf8')):[];
calls.push({memory:process.env.PSIG_MEMORY_DIR,namespace:process.env.PSIG_ZETARIS_NS});
fs.writeFileSync('calls.json',JSON.stringify(calls));
const n=calls.length,dir='out/run-'+n;fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(dir+'/brief.md','recording '+n);
if(process.env.FAKE_MISSING_TRACE!=='1')fs.writeFileSync(dir+'/trace.json',JSON.stringify({question:process.argv.at(-1),trace:[],sql:[]}));
if(process.env.FAKE_MISSING_EVIDENCE!=='1')fs.writeFileSync(dir+'/evidence.json',JSON.stringify({schemaVersion:1,methodVersion:2,queries:{market:{columns:['country'],rows:[]}}}));
if(process.env.FAKE_MISSING_RESULT!=='1')fs.writeFileSync(dir+'/result.json',JSON.stringify({partials:[],final:{headline:'recording '+n}}));
console.log('[done] fixture complete');console.log('[pricesignal] saved '+dir+'/brief.md');
process.exit(Number(process.env.FAKE_FAIL_AT)===n?3:0);
`, { mode: 0o755 });
  const run = (extra: Record<string, string> = {}) => spawnSync('bash', ['scripts/15_examples.sh'], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}`, PSIG_MEMORY_DIR: '.pricesignal/requested-new', PSIG_ZETARIS_NS: 'fixture-fresh', ...extra },
  });
  return { root, run, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('the example recorder respects an isolated requested store and namespace', () => {
  const f = fixture();
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const calls = JSON.parse(fs.readFileSync(path.join(f.root, 'calls.json'), 'utf8'));
    assert.equal(calls.length, 8);
    for (const call of calls) {
      assert.equal(path.resolve(f.root, call.memory), path.join(f.root, '.pricesignal/requested-new'));
      assert.equal(call.namespace, 'fixture-fresh');
    }
    assert.equal(fs.readFileSync(path.join(f.root, 'examples/01_cold_start/brief.md'), 'utf8'), 'recording 1');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'examples/01_cold_start/evidence.json'), 'utf8')).schemaVersion, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'examples/01_cold_start/result.json'), 'utf8')).final.headline, 'recording 1');
  } finally { f.dispose(); }
});

test('a missing UI result (needed by npm run demo) prevents promotion', () => {
  const f = fixture();
  try {
    const result = f.run({ FAKE_MISSING_RESULT: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(path.join(f.root, 'examples/01_cold_start/brief.md'), 'utf8'), 'previous recording');
  } finally { f.dispose(); }
});

test('the example recorder refuses an existing store before invoking the application', () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.root, '.pricesignal/requested-new'));
    fs.writeFileSync(path.join(f.root, '.pricesignal/requested-new/keep.txt'), 'keep');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(f.root, 'calls.json')), false);
    assert.equal(fs.readFileSync(path.join(f.root, '.pricesignal/requested-new/keep.txt'), 'utf8'), 'keep');
  } finally { f.dispose(); }
});

test('a nonzero CLI exit cannot be published as success or partly replace prior examples', () => {
  const f = fixture();
  try {
    const result = f.run({ FAKE_FAIL_AT: '3' });
    assert.notEqual(result.status, 0, result.stdout);
    assert.equal(fs.readFileSync(path.join(f.root, 'examples/01_cold_start/brief.md'), 'utf8'), 'previous recording');
    assert.match(result.stdout + result.stderr, /FAIL.*03_typo_market/);
  } finally { f.dispose(); }
});

test('a missing trace prevents publication even if a brief was saved', () => {
  const f = fixture();
  try {
    const result = f.run({ FAKE_MISSING_TRACE: '1' });
    assert.notEqual(result.status, 0, result.stdout);
    assert.equal(fs.readFileSync(path.join(f.root, 'examples/01_cold_start/brief.md'), 'utf8'), 'previous recording');
  } finally { f.dispose(); }
});


test('a missing evidence bundle prevents promotion even if the brief and trace were saved', () => {
  const f = fixture();
  try {
    const result = f.run({ FAKE_MISSING_EVIDENCE: '1' });
    assert.notEqual(result.status, 0, result.stdout);
    assert.equal(fs.readFileSync(path.join(f.root, 'examples/01_cold_start/brief.md'), 'utf8'), 'previous recording');
  } finally { f.dispose(); }
});
