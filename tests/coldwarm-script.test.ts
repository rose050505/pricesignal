import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pricesignal-coldwarm-"));
  for (const dir of ["scripts", "bin", ".pricesignal/memory", ".pricesignal/older-experiment"]) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.copyFileSync(new URL("../scripts/13_coldwarm.sh", import.meta.url), path.join(root, "scripts/13_coldwarm.sh"));
  fs.writeFileSync(path.join(root, ".pricesignal/memory/keep.txt"), "fixture UI memory");
  fs.writeFileSync(path.join(root, ".pricesignal/older-experiment/keep.txt"), "fixture earlier experiment");
  const fake = `#!${process.execPath}
const fs=require('node:fs');
const role=process.argv[1].endsWith('/npm')?'npm-test':process.argv.includes('--test')?'old-test':'app';
const calls=fs.existsSync('calls.json')?JSON.parse(fs.readFileSync('calls.json','utf8')):[];
calls.push({role,args:process.argv.slice(2),memory:process.env.PSIG_MEMORY_DIR,namespace:process.env.PSIG_ZETARIS_NS});
fs.writeFileSync('calls.json',JSON.stringify(calls));
if(role!=='app'){console.log('# tests 1\\n# pass 1\\n# fail 0');process.exit(Number(process.env.FAKE_TEST_EXIT)||0)}
const n=calls.filter(c=>c.role==='app').length, dir='out/run-'+n;fs.mkdirSync(dir,{recursive:true});
if(process.env.FAKE_MISSING!=='brief')fs.writeFileSync(dir+'/brief.md','# PriceSignal brief\\nfixture');
if(process.env.FAKE_MISSING!=='trace')fs.writeFileSync(dir+'/trace.json',JSON.stringify({trace:[],sql:[]}));
if(process.env.FAKE_MISSING!=='evidence')fs.writeFileSync(dir+'/evidence.json',process.env.FAKE_MISSING==='invalid-json'?'{':JSON.stringify({schemaVersion:1,methodVersion:2,queries:{market:{columns:[],rows:[]}},results:{facts:[],skus:[]}}));
console.log('[done] offline fixture');console.log('[pricesignal] saved '+dir+'/brief.md');
process.exit(Number(process.env.FAKE_FAIL_AT)===n?7:0);
`;
  for (const name of ["npm", "npx"]) fs.writeFileSync(path.join(root, "bin", name), fake, { mode: 0o755 });
  const run = (mode?: string, extra: Record<string, string | undefined> = {}) => {
    const env = { ...process.env, PATH: `${path.join(root, "bin")}:${process.env.PATH}`, PSIG_MEMORY_DIR: undefined, PSIG_ZETARIS_NS: undefined, ...extra };
    return spawnSync("bash", ["scripts/13_coldwarm.sh", ...(mode ? [mode] : [])], { cwd: root, env, encoding: "utf8", timeout: 15000 });
  };
  const calls = (): any[] => fs.existsSync(path.join(root, "calls.json")) ? JSON.parse(fs.readFileSync(path.join(root, "calls.json"), "utf8")) : [];
  return { root, run, calls, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const requested = { PSIG_MEMORY_DIR: ".pricesignal/requested-new", PSIG_ZETARIS_NS: "fixture-cold" };

test("cold recording preserves every existing store and uses one fresh store and namespace for both runs", () => {
  const f = fixture();
  try {
    const r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.readFileSync(path.join(f.root, ".pricesignal/memory/keep.txt"), "utf8"), "fixture UI memory");
    assert.equal(fs.readFileSync(path.join(f.root, ".pricesignal/older-experiment/keep.txt"), "utf8"), "fixture earlier experiment");
    const calls = f.calls(); assert.equal(calls[0].role, "npm-test", "all offline tests must run");
    const apps = calls.filter(c => c.role === "app"); assert.equal(apps.length, 2);
    assert.equal(path.dirname(path.resolve(f.root, apps[0].memory)), path.join(f.root, ".pricesignal"));
    assert.notEqual(path.basename(apps[0].memory), "memory"); assert.ok(apps[0].namespace);
    assert.equal(apps[0].memory, apps[1].memory); assert.equal(apps[0].namespace, apps[1].namespace);
  } finally { f.dispose(); }
});

test("cold refuses an existing requested store without tests, calls, or deletion", () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.root, requested.PSIG_MEMORY_DIR));
    fs.writeFileSync(path.join(f.root, requested.PSIG_MEMORY_DIR, "keep.txt"), "keep");
    const r = f.run(undefined, requested); assert.notEqual(r.status, 0);
    assert.equal(f.calls().length, 0);
    assert.equal(fs.readFileSync(path.join(f.root, requested.PSIG_MEMORY_DIR, "keep.txt"), "utf8"), "keep");
  } finally { f.dispose(); }
});

test("the default UI store and paths outside direct experimental children are refused before execution", () => {
  for (const memory of [".pricesignal/memory", ".pricesignal", ".pricesignal/nested/child", "outside"]) {
    const f = fixture();
    try {
      const r = f.run(undefined, { ...requested, PSIG_MEMORY_DIR: memory }); assert.notEqual(r.status, 0, memory);
      assert.equal(f.calls().length, 0, memory);
      assert.equal(fs.existsSync(path.join(f.root, ".pricesignal/memory/keep.txt")), true, memory);
    } finally { f.dispose(); }
  }
});

test("a failed offline suite stops before either live step and propagates its exit code", () => {
  const f = fixture();
  try {
    const r = f.run(undefined, { ...requested, FAKE_TEST_EXIT: "9" }); assert.equal(r.status, 9, r.stdout + r.stderr);
    assert.equal(f.calls().filter(c => c.role === "app").length, 0);
  } finally { f.dispose(); }
});

test("a failed CLI step stops the sequence and cannot report successful completion", () => {
  for (const failedStep of [1, 2]) {
    const f = fixture();
    try {
      const r = f.run(undefined, { ...requested, FAKE_FAIL_AT: String(failedStep) }); assert.equal(r.status, 7, r.stdout + r.stderr);
      assert.equal(f.calls().filter(c => c.role === "app").length, failedStep);
      assert.doesNotMatch(r.stdout, /== done/);
    } finally { f.dispose(); }
  }
});

test("missing or malformed artifacts stop the cold/warm sequence despite a zero CLI exit", () => {
  for (const missing of ["brief", "trace", "evidence", "invalid-json"]) {
    const f = fixture();
    try {
      const r = f.run(undefined, { ...requested, FAKE_MISSING: missing }); assert.notEqual(r.status, 0, missing);
      assert.equal(f.calls().filter(c => c.role === "app").length, 1, missing);
    } finally { f.dispose(); }
  }
});

test("warm-only requires an explicit store and namespace matching a successful cold context", () => {
  const f = fixture();
  try {
    for (const env of [{}, { PSIG_MEMORY_DIR: requested.PSIG_MEMORY_DIR }, { PSIG_ZETARIS_NS: requested.PSIG_ZETARIS_NS }, requested]) {
      const r = f.run("warm", env); assert.notEqual(r.status, 0, JSON.stringify(env)); assert.equal(f.calls().length, 0);
    }
    const cold = f.run(undefined, requested); assert.equal(cold.status, 0, cold.stdout + cold.stderr);
    fs.unlinkSync(path.join(f.root, "calls.json"));
    const mismatch = f.run("warm", { ...requested, PSIG_ZETARIS_NS: "wrong" }); assert.notEqual(mismatch.status, 0); assert.equal(f.calls().length, 0);
    const warm = f.run("warm", requested); assert.equal(warm.status, 0, warm.stdout + warm.stderr);
    const apps = f.calls().filter(c => c.role === "app"); assert.equal(apps.length, 1);
    assert.equal(apps[0].memory, requested.PSIG_MEMORY_DIR); assert.equal(apps[0].namespace, requested.PSIG_ZETARIS_NS);
  } finally { f.dispose(); }
});
