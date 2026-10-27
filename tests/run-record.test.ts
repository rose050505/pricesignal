// A UI run leaves the same activity log as a CLI run: trace.json and brief.md under out/.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveRunRecord } from "../src/run-record.ts";

test("a finished UI run is saved with its question, trace, SQL log and brief", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "psig-record-"));
  const brief: any = { markdown: "# PriceSignal brief\n**+5% is above the market benchmark in DE.**", trace: [{ t: 1, kind: "compare", title: "federated query Q7 on the semantic view psig.v_market_inflation_x -> 84 rows" }], sqlLog: [{ id: "Q7", sql: "SELECT country FROM psig.v_market_inflation_x", rows: [[1], [2]], ms: 1300 }] };
  const dir = saveRunRecord(root, "DE food +5%", brief, new Date("2026-10-27T13:05:00.123Z"));
  assert.match(path.basename(dir), /^ui-2026-10-27T13-05-00-123Z$/);
  const trace = JSON.parse(fs.readFileSync(path.join(dir, "trace.json"), "utf8"));
  assert.equal(trace.question, "DE food +5%");
  assert.equal(trace.source, "ui");
  assert.match(trace.trace[0].title, /semantic view/);
  assert.deepEqual(trace.sql, [{ id: "Q7", sql: "SELECT country FROM psig.v_market_inflation_x", rows: 2, ms: 1300 }]);
  assert.match(fs.readFileSync(path.join(dir, "brief.md"), "utf8"), /above the market benchmark/);
});

test("the UI server saves each finished run and tells the browser where", () => {
  const server = fs.readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(server, /saveRunRecord\(path\.join\(ROOT, "out"\), question, b\)/);
  assert.match(server, /record:/);
});

test("a UI run also saves its replayable evidence packet and reports the offline check result", async () => {
  const { saveEvidence } = await import("../src/run-record.ts");
  const { buildFacts } = await import("../src/brief.ts");
  const { buildAlignment } = await import("../src/alignment.ts");
  const { verifyEvidence } = await import("../src/evidence.ts");
  const { COMPARE_COLUMNS } = await import("../src/sources/index.ts");
  const calculatedAt = "2026-10-27T00:00:00.000Z";
  const req: any = { raw: "DE CA food +5%", countries: ["DE", "CA"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, passThrough: 0.7, unknownCountries: [] };
  const compared: any = { id: "Q1", sql: "SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM fixture", columns: [...COMPARE_COLUMNS], rows: [["DE", "food", "Food", "M", "2026-08", 0.25, "de:food"], ["DE", "food", "Food", "M", "2026-09", 0.35, "de:food"], ["CA", "food", "Food", "M", "2026-08", 2.85, "ca:food"], ["CA", "food", "Food", "M", "2026-09", 2.2, "ca:food"]], ms: 1 };
  const objects = compared.rows.map((r: unknown[]) => Object.fromEntries(COMPARE_COLUMNS.map((c, i) => [c, r[i]])));
  const facts = buildFacts(objects, req, "Q1", 0.7, new Date(calculatedAt));
  const brief: any = { request: req, startedAt: "2026-10-26T23:59:59.000Z", calculatedAt, passThrough: 0.7, facts, alignment: buildAlignment(objects, req, facts, "Q1", new Date(calculatedAt)), compared, notes: [], views: [], trace: [], sqlLog: [compared], ms: 1, markdown: "" };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "psig-record-ev-"));
  const v = saveEvidence(root, brief);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.ok(v.checks > 10);
  assert.equal(v.path, path.join(root, "evidence.json"));
  assert.equal(verifyEvidence(JSON.parse(fs.readFileSync(v.path, "utf8"))).ok, true, "the saved file replays on its own");
});

test("the UI server saves the evidence next to the activity log and sends the check result", () => {
  const server = fs.readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(server, /saveEvidence\(/);
  assert.match(server, /verification/);
});
