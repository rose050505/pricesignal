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
