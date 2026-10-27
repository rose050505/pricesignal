// The US market through the U.S. Bureau of Labor Statistics CPI (keyless API v1: 25 requests a day per address).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as bls from "../src/sources/bls.ts";
import { AGENCY_FOR, discover } from "../src/sources/index.ts";
import { requestMarkets } from "../src/request.ts";
import { basketNote } from "../src/brief.ts";

test("discovery reads the vetted series list and spends none of the daily API allowance", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("no network in this test"); });
  const d = await discover("US", "food");
  assert.equal(calls, 0);
  assert.equal(AGENCY_FOR.US.agency, "bls");
  assert.deepEqual(d.candidates.map((c) => [c.agency, c.code, c.label, c.frequency, c.sourceUrl]), [["bls", "CUUR0000SAF1", "Food", "M", "https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SAF1"]]);
  const all = await discover("US", "all_items");
  assert.equal(all.candidates[0].code, "CUUR0000SA0");
  const snacks = await discover("US", "snacks");
  assert.equal(snacks.candidates[0].code, "CUUR0000SAF1");
  assert.equal(snacks.candidates[0].isBroadFallback, true);
  assert.match(snacks.notes[0], /compared at the Food level/);
  assert.deepEqual((await discover("US", "electricity")).candidates, []);
});

test("the view decodes BLS year/period pairs, skips the annual M13 and cites the series", () => {
  const c = bls.onboardSql({ agency: "bls", country: "US", dataset: "CU", code: "CUUR0000SAF1", label: "Food", frequency: "M", measure: "index", status: "unknown", sourceUrl: bls.seriesUrl("CUUR0000SAF1") }, "food");
  assert.match(c.statements[0], /^CREATE LIGHTNING REST TABLE bls_us_cuur0000saf1\w* FROM PSIG_BLS REQUEST\(\n    endpoint "https:\/\/api\.bls\.gov\/publicAPI\/v1\/timeseries\/data\/CUUR0000SAF1"/);
  assert.match(c.statements[1], /LATERAL VIEW explode\(Results\.series\) AS s\n  LATERAL VIEW explode\(s\.data\) AS d\n  WHERE d\.period LIKE 'M%' AND d\.period <> 'M13'/);
  assert.match(c.statements[1], /'bls:CU:CUUR0000SAF1' AS source_id/);
  assert.match(c.view, /^v_us_food_cuur0000saf1_yoyv2/);
});

test("YoY compares the same calendar month one year earlier (generated SQL run in SQLite)", () => {
  const plan = bls.onboardSql({ agency: "bls", country: "US", dataset: "CU", code: "CUUR0000SAF1", label: "Food", frequency: "M", measure: "index", status: "unknown", sourceUrl: "https://fixture.invalid" }, "food");
  const viewSql = plan.statements[1].slice(plan.statements[1].indexOf("\nSELECT") + 1);
  const decoder = /SELECT CONCAT\(d\.year[\s\S]*?WHERE d\.period LIKE 'M%' AND d\.period <> 'M13'/;
  assert.ok(decoder.test(viewSql), "replace only the BLS JSON decoder");
  const rows: [string, number][] = [["2025-01", 100], ["2025-03", 102], ["2025-09", 200], ["2026-01", 110], ["2026-02", 111], ["2026-09", 205]];
  const out = execFileSync("python3", ["-c", `
import json, sqlite3, sys
r = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.execute('CREATE TABLE observations (period TEXT, idx REAL)')
db.executemany('INSERT INTO observations VALUES (?, ?)', r['rows'])
cur = db.execute(r['sql'])
names = [c[0] for c in cur.description]
print(json.dumps([dict(zip(names, row)) for row in cur.fetchall()]))
`], { input: JSON.stringify({ sql: viewSql.replace(decoder, "SELECT period, idx FROM observations"), rows }), encoding: "utf8" });
  const yoy = new Map((JSON.parse(out) as { period: string; yoy_pct: number | null }[]).map((x) => [x.period, x.yoy_pct]));
  assert.equal(yoy.get("2026-01"), 10);
  assert.equal(yoy.get("2026-09"), 2.5);
  assert.equal(yoy.get("2026-02"), null, "no February a year earlier");
});

test("US is read from USA, United States, America, 미국 and the upper-case code, never from the word 'us'", () => {
  assert.deepEqual(requestMarkets("USA & canada food: can we raise prices 3%?", []).countries, ["US", "CA"]);
  assert.deepEqual(requestMarkets("united states food prices +4%?", []).countries, ["US"]);
  assert.deepEqual(requestMarkets("미국 식품 물가 3% 올려도 될까", []).countries, ["US"]);
  assert.deepEqual(requestMarkets("US and AU food +3%", []).countries, ["US", "AU"]);
  assert.deepEqual(requestMarkets("let us know: is +3% ok for canada food? tell us", []).countries, ["CA"]);
  assert.deepEqual(requestMarkets("japan + canada food prices, ok to raise 5%?", []).unknown, ["japan"], "Japan stays unsupported");
});

test("BLS Food is marked as including restaurant meals in the basket note", () => {
  const series = (sourceId: string, label: string) => ({ concept: "food", label, frequency: "M", sourceId, latestPeriod: "2026-09", latestYoy: 1, avg12: 1, averageCount: 12, averageExpected: 12, trend: "flat", points: [] });
  const facts: any[] = [{ country: "US", category: series("bls:CU:CUUR0000SAF1", "Food") }, { country: "DE", category: series("eurostat:prc_hicp_minr:CP01:RCH_A", "Food and non-alcoholic beverages") }];
  assert.match(String(basketNote(facts, { raw: "", countries: ["US", "DE"], concept: "food", conceptWords: [], unknownCountries: [] } as any)), /the US \(BLS Food\) series includes restaurant and take-away meals; the DE/);
});
