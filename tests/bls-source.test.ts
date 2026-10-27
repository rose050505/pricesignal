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

test("a company described as US-based or American, a US$ price and Latin America are not the US market (review, 28 Oct 01:10)", () => {
  assert.deepEqual(requestMarkets("We're a US-based snack exporter selling in Canada and Australia: +3%?", []).countries, ["CA", "AU"]);
  assert.deepEqual(requestMarkets("As an American snack maker exporting to Canada, is +4% ok?", []).countries, ["CA"]);
  assert.deepEqual(requestMarkets("canada food: list price US$12.50, can we raise it 3%?", []).countries, ["CA"]);
  assert.deepEqual(requestMarkets("we sell in Latin America and canada; food +3%?", []).countries, ["CA"]);
  assert.deepEqual(requestMarkets("a Germany-based exporter selling in canada, food +3%?", []).countries, ["CA"]);
  assert.deepEqual(requestMarkets("U.S and canada food +3%", []).countries, ["US", "CA"]);
  assert.deepEqual(requestMarkets("our US and Canada sales: food +3%?", []).countries, ["US", "CA"]);
});

test("Korean particles and compounds after 미국 are read (review, 28 Oct 01:10)", () => {
  assert.deepEqual(requestMarkets("미국이 요즘 식품 물가 어때? 3% 올려도 될까", []).countries, ["US"]);
  assert.deepEqual(requestMarkets("미국시장 식품 가격 3% 인상", []).countries, ["US"]);
  assert.deepEqual(requestMarkets("캐나다가 3% 올려도 될까", []).countries, ["CA"]);
});

test("the narrative check reads United States, U.S. and American as the US market (review, 28 Oct 01:10)", async () => {
  const { allowedNumbers, checkNarrative } = await import("../src/brief.ts");
  const series = (country: string, latestYoy: number, avg12: number) => ({ concept: "food", label: "Food", frequency: "M", sourceId: `x:${country}`, latestPeriod: "2026-09", latestYoy, avg12, averageCount: 12, averageExpected: 12, averageLabel: "12 of 12 monthly observations", trend: "flat", points: [] });
  const facts: any[] = [{ country: "US", agency: "BLS", category: series("US", 2.5, 2.9), suggested: { low: 2.5, high: 2.9 }, verdict: "above the market benchmark", cite: "Q1" }, { country: "CA", agency: "StatCan", category: series("CA", 2.2, 4.1), suggested: { low: 2.2, high: 4.1 }, verdict: "within the market benchmark", cite: "Q1" }];
  const req: any = { raw: "USA & canada food +3%", countries: ["US", "CA"], concept: "food", conceptWords: ["food"], proposedChangePct: 3, unknownCountries: [] };
  const allowed = allowedNumbers(facts, req, 0.7);
  for (const name of ["the United States", "the U.S.", "American food inflation"]) {
    const bad = checkNarrative({ headline: "+3% is above the market benchmark in US; within the market benchmark in CA.", markets: { CA: `Canadian food inflation is 2.2%, and ${name} is at 3.4% too.` } }, allowed, facts, req, 0.7);
    assert.ok(bad.some((b) => /US/.test(b)), `${name}: ${bad.join(" | ")}`);
  }
});

test("a BLS reply that did not process the request does not count as the source answering (review, 28 Oct 01:10)", async (t) => {
  const { sourceAnswers } = await import("../src/sources/index.ts");
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ status: "REQUEST_NOT_PROCESSED", message: ["daily threshold"] }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(await sourceAnswers("https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SAF1", "bls"), false);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ status: "REQUEST_SUCCEEDED", Results: { series: [{ data: [] }] } }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(await sourceAnswers("https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SAF1", "bls"), true);
});

test("the UI suffix is the one Zetaris names actually carry", async () => {
  const { zetarisSuffix } = await import("../src/sources/types.ts");
  assert.equal(zetarisSuffix("Video-1027"), "video_1027");
  assert.equal(zetarisSuffix(""), null);
  assert.equal(zetarisSuffix(undefined), null);
});
