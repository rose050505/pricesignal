import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildFacts, type Brief } from "../src/brief.ts";
import { buildAlignment } from "../src/alignment.ts";
import { COMPARE_COLUMNS } from "../src/sources/index.ts";
import { rowsAsObjects } from "../src/zetaris.ts";
import { exportEvidence } from "../src/evidence.ts";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psig-offline-verify-"));
  const request: Brief["request"] = { raw: "Germany and Japan food, costs +8%, share 60%, pass 70%, +5%", countries: ["DE"], unknownCountries: ["Japan"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, costIncreasePct: 8, costSharePct: 60 };
  const q = { id: "Q1", sql: "SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.fixture", columns: COMPARE_COLUMNS, rows: [["DE", "food", "Food", "M", "2026-08", 2.85, "eurostat:fixture"], ["DE", "food", "Food", "M", "2026-09", 2.2, "eurostat:fixture"]], ms: 0 };
  const calculatedAt = "2026-10-27T00:00:00.000Z", rows = rowsAsObjects(q);
  const facts = buildFacts(rows, request, q.id, 0.7, new Date(calculatedAt));
  const evidence = exportEvidence({ request, calculatedAt, startedAt: calculatedAt, passThrough: 0.7, facts, alignment: buildAlignment(rows, request, facts, q.id, new Date(calculatedAt)), notes: [], compared: q, sqlLog: [q], views: [], ms: 0, trace: [] });
  const file = path.join(dir, "evidence.json");
  const guard = path.join(dir, "offline-guard.mjs");
  fs.writeFileSync(file, JSON.stringify(evidence));
  fs.writeFileSync(guard, `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const read=fs.readFileSync;fs.readFileSync=function(file,...args){if(/(?:^|\\/)\\.env(?:$|\\.)|\\.pricesignal\\/memory/.test(String(file)))throw new Error('forbidden local state read');return read.call(this,file,...args)};syncBuiltinESMExports();
globalThis.fetch=()=>{throw new Error('network forbidden in offline verifier')};`);
  const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "--import", guard, "src/verify.ts", ...args], { encoding: "utf8", timeout: 15_000 });
  return { dir, evidence, file, run, dispose: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("saved evidence verifies in a separate process without network, credentials, or memory", () => {
  const f = fixture();
  try {
    const result = f.run(f.file, "--json");
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.ok(report.checks > 0);
    assert.equal(report.coverage.requestedMarkets, 2);
    assert.deepEqual(report.coverage.unsupportedMarkets, ["Japan"]);
    assert.match(report.warnings.join(" "), /Japan/);
    assert.ok(report.limitations.length > 0);
  } finally { f.dispose(); }
});

test("the verifier exits unsuccessfully on changed facts, unsupported formats, and unreadable input", () => {
  const f = fixture();
  try {
    const changed = structuredClone(f.evidence);
    changed.results.facts[0].category!.avg12 = 999;
    fs.writeFileSync(f.file, JSON.stringify(changed));
    const result = f.run(f.file, "--json");
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).ok, false);
    fs.writeFileSync(f.file, JSON.stringify({ ...f.evidence, schemaVersion: 999 }));
    assert.equal(f.run(f.file).status, 1);
    fs.writeFileSync(f.file, "{broken");
    assert.equal(f.run(f.file).status, 1);
    assert.equal(f.run(path.join(f.dir, "absent.json")).status, 1);
    assert.equal(f.run().status, 2);
  } finally { f.dispose(); }
});


test("explicit request policy cannot disagree with the applied cost policy", () => {
  const f = fixture();
  try {
    f.evidence.request.passThrough = 0.1;
    fs.writeFileSync(f.file, JSON.stringify(f.evidence));
    const result = f.run(f.file, "--json");
    assert.equal(result.status, 1, "a changed explicit policy must not verify against the original applied policy");
    assert.equal(JSON.parse(result.stdout).ok, false);
  } finally { f.dispose(); }
});
