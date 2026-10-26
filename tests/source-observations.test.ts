import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as abs from "../src/sources/abs.ts";
import * as statcan from "../src/sources/statcan.ts";
import { onboard } from "../src/sources/index.ts";
import type { Candidate } from "../src/sources/types.ts";
import type { SqlRunner } from "../src/zetaris.ts";

const now = new Date("2026-10-27T00:00:00Z");
const candidate = (agency: "abs" | "statcan", frequency: "M" | "Q" = "M"): Candidate => ({
  agency, country: agency === "abs" ? "AU" : "CA", dataset: agency === "abs" ? "ABS,CPI" : "18100004",
  code: agency === "abs" ? "20001" : "v41690974", label: "Food", frequency,
  measure: "index", status: "active", sourceUrl: "https://fixture.invalid/unused",
});

// Python 3 with its standard-library sqlite3 is a test dependency. Execute the
// actual generated view SELECT; only the Zetaris-specific JSON decoder is
// replaced by a local table with the same decoded period/index columns.
function executeGeneratedView(c: Candidate, rows: [string, number][]): Map<string, number | null> {
  const plan = (c.agency === "abs" ? abs : statcan).onboardSql(c, "food");
  const viewSql = plan.statements[1].slice(plan.statements[1].indexOf("\nSELECT") + 1);
  const decoder = c.agency === "abs"
    ? /SELECT period_label\.id AS period,[\s\S]*?WHERE CAST\(obs_key AS INT\) = obs_position/
    : /SELECT SUBSTR\(dp\.refPer, 1, 7\) AS period,[\s\S]*?LATERAL VIEW explode\(object\.vectorDataPoint\) AS dp/;
  assert.ok(decoder.test(viewSql), "replace only the agency JSON decoder, leaving generated YoY SQL intact");
  const sql = viewSql.replace(decoder, "SELECT period, idx FROM observations");
  const result = execFileSync("python3", ["-c", `
import json, sqlite3, sys
request = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.execute('CREATE TABLE observations (period TEXT, idx REAL)')
db.executemany('INSERT INTO observations VALUES (?, ?)', request['rows'])
cursor = db.execute(request['sql'])
names = [column[0] for column in cursor.description]
print(json.dumps([dict(zip(names, row)) for row in cursor.fetchall()]))
`], { input: JSON.stringify({ sql, rows }), encoding: "utf8" });
  return new Map((JSON.parse(result) as { period: string; yoy_pct: number | null }[]).map(r => [r.period, r.yoy_pct]));
}

test("monthly index YoY compares the same calendar month despite missing observations", () => {
  const rows: [string, number][] = [["2024-12", 90], ["2025-01", 100], ...Array.from({ length: 10 }, (_, i): [string, number] => [`2025-${String(i + 3).padStart(2, "0")}`, 102 + i]), ["2026-01", 110], ["2026-02", 120]];
  for (const agency of ["abs", "statcan"] as const) {
    const result = executeGeneratedView(candidate(agency), rows);
    assert.equal(result.get("2026-01"), 10, `${agency}: a missing February cannot shift January's denominator`);
    assert.equal(result.get("2026-02"), null, `${agency}: no same-month observation one year ago means no YoY`);
  }
});

test("quarterly index YoY uses the same quarter and rejects a missing prior-year quarter", () => {
  const result = executeGeneratedView(candidate("abs", "Q"), [["2024-Q1", 90], ["2024-Q4", 100], ["2025-Q1", 101], ["2025-Q3", 105], ["2025-Q4", 110], ["2026-Q1", 111], ["2026-Q2", 120]]);
  assert.equal(result.get("2025-Q4"), 10);
  assert.equal(result.get("2026-Q1"), 9.9);
  assert.equal(result.get("2026-Q2"), null);
});

test("YoY refuses a two-year gap and nonpositive denominators, while retaining deflation", () => {
  for (const agency of ["abs", "statcan"] as const) {
    const c = candidate(agency);
    assert.equal(executeGeneratedView(c, [["2024-01", 100], ["2026-01", 110]]).get("2026-01"), null);
    for (const previous of [0, -100]) {
      const rows: [string, number][] = [["2025-01", previous], ...Array.from({ length: 11 }, (_, i): [string, number] => [`2025-${String(i + 2).padStart(2, "0")}`, 100]), ["2026-01", 110]];
      assert.equal(executeGeneratedView(c, rows).get("2026-01"), null, `${agency}: denominator ${previous}`);
    }
    assert.equal(executeGeneratedView(c, [["2025-01", 100], ["2026-01", 98]]).get("2026-01"), -2);
  }
});

test("complete monthly and quarterly histories retain their previous valid YoY arithmetic", () => {
  const monthly: [string, number][] = [...Array.from({ length: 12 }, (_, i): [string, number] => [`2025-${String(i + 1).padStart(2, "0")}`, 100 + i]), ["2026-01", 110]];
  for (const agency of ["abs", "statcan"] as const) assert.equal(executeGeneratedView(candidate(agency), monthly).get("2026-01"), 10);
  assert.equal(executeGeneratedView(candidate("abs", "Q"), [["2025-Q1", 100], ["2025-Q2", 102], ["2025-Q3", 104], ["2025-Q4", 106], ["2026-Q1", 110]]).get("2026-Q1"), 10);
});

test("decoder changes create versioned views without renaming raw REST tables", () => {
  const monthly = abs.onboardSql(candidate("abs"), "food"), quarterly = abs.onboardSql(candidate("abs", "Q"), "food");
  assert.match(monthly.view, /_m_yoyv2(?:_|$)/);
  assert.match(quarterly.view, /_q_yoyv2(?:_|$)/);
  assert.notEqual(monthly.view, quarterly.view);
  assert.match(monthly.table, /^abs_au_cpi_20001_m(?:_|$)/);
  assert.ok(!monthly.table.includes("yoyv2"));
  const canadian = statcan.onboardSql(candidate("statcan"), "food");
  assert.match(canadian.view, /_live_yoyv2(?:_|$)/);
  assert.match(canadian.table, /^statcan_ca_v41690974_live(?:_|$)/);
  assert.ok(!canadian.table.includes("yoyv2"));
  assert.ok([...monthly.statements, ...quarterly.statements, ...canadian.statements].every(s => !/\bDROP\b/i.test(s)));
});

function probe(count: unknown, period: unknown): SqlRunner {
  return { run: async sql => ({ id: "fixture", sql, columns: [], rows: /^SELECT COUNT/.test(sql) ? [[count, period]] : [], ms: 0 }) };
}

test("onboarding rejects empty, malformed, future, stale and wrong-frequency periods", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  for (const frequency of ["M", "Q"] as const) {
    const bad = [null, undefined, "", "not-a-date", "2026-00", "2026-13", "2026-Q0", "2026-Q9", "2027-01", "2027-Q1", "2020-01", "2020-Q1", frequency === "M" ? "2026-Q3" : "2026-09"];
    for (const period of bad) {
      const result = await onboard(probe(12, period), candidate("abs", frequency), "food");
      assert.equal(result.ok, false, `${frequency}: ${String(period)}`);
      assert.match(result.error ?? "", /period|dated|fresh/i);
    }
  }
});

test("onboarding validates observation counts and accepts fresh monthly and quarterly releases", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  for (const count of [null, undefined, "", " ", true, [], 0, -1, 0.5, "1.5", NaN, Infinity, "Infinity", "not-a-count"]) {
    const result = await onboard(probe(count, "2026-09"), candidate("abs"), "food");
    assert.equal(result.ok, false, `count ${String(count)}`);
  }
  for (const [frequency, period] of [["M", "2026-09"], ["M", "2026-07"], ["Q", "2026-Q3"]] as const) {
    const result = await onboard(probe("12", period), candidate("abs", frequency), "food");
    assert.equal(result.ok, true, period);
    assert.equal(result.rows, 12);
    assert.equal(result.latest, period);
  }
});

test("the shared source validation contract covers decoder versions and strict release periods", async () => {
  const { sourceDecoderVersion, hasFreshPeriod, isUsableObservationCount } = await import("../src/sources/validation.ts");
  assert.equal(sourceDecoderVersion("abs"), 2);
  assert.equal(sourceDecoderVersion("statcan"), 2);
  assert.equal(sourceDecoderVersion("eurostat"), 1);
  assert.equal(sourceDecoderVersion("unknown"), 1);
  for (const count of [1, 12, "12"]) assert.equal(isUsableObservationCount(count), true);
  for (const count of [null, undefined, true, false, [], {}, "", " ", 0, -1, 0.5, "1.5", Infinity, NaN]) assert.equal(isUsableObservationCount(count), false);
  for (const [period, frequency, expected] of [["2026-07", "M", true], ["2026-06", "M", false], ["2026-Q2", "Q", true], ["2026-Q1", "Q", false], ["2026-Q4", "Q", false], ["2026-10", "M", true], ["2026-11", "M", false], ["2026-09", "Q", false], ["2026-Q3", "M", false], ["2026-09", "A", false], [null, "M", false], [202609, "M", false]] as const) {
    assert.equal(hasFreshPeriod(period, frequency, now), expected, `${frequency}: ${period}`);
  }
});

test("onboarding distinguishes a reused raw table from the newly created decoder view", async () => {
  for (const [existing, createdObjects, existingObjects] of [["table", 1, 1], ["both", 0, 2], ["neither", 2, 0]] as const) {
    const sql: SqlRunner = { run: async statement => {
      if (/^CREATE LIGHTNING REST TABLE/.test(statement) && existing !== "neither" || /^CREATE SCHEMASTORE VIEW/.test(statement) && existing === "both") throw new Error("already exists");
      return { id: "fixture", sql: statement, columns: [], rows: /^SELECT COUNT/.test(statement) ? [[12, "2026-09"]] : [], ms: 0 };
    } };
    const result = await onboard(sql, candidate("statcan"), "food", now);
    assert.equal(result.ok, true);
    assert.equal(result.existed, existing !== "neither", "retain compatibility with callers using the old flag");
    assert.equal(result.createdObjects, createdObjects, existing);
    assert.equal(result.existingObjects, existingObjects, existing);
  }
});
