import test from "node:test";
import assert from "node:assert/strict";
import { exportEvidence, verifyEvidence } from "../src/evidence.ts";
import { buildFacts, type Brief } from "../src/brief.ts";
import { buildAlignment } from "../src/alignment.ts";
import type { Request } from "../src/agent.ts";
import { COMPARE_COLUMNS } from "../src/sources/index.ts";
import { PRICING_COLUMNS, SKU_RATE_COLUMNS } from "../src/sources/pricelist.ts";
import type { SqlResult } from "../src/zetaris.ts";

const calculatedAt = "2026-10-27T00:00:00.000Z";
const request = (): Request => ({ raw: "DE CA food +5%; costs +8%, cost share 60%, recover 70%", countries: ["DE", "CA"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, costIncreasePct: 8, costSharePct: 60, passThrough: 0.7, unknownCountries: [] });
const objects = (q: SqlResult, columns = q.columns) => q.rows.map(row => Object.fromEntries(columns.map((column, i) => [column, row[i]])));
function fixture(mode: "history" | "legacy" | "none" = "history"): Brief {
  const req = request();
  const compared: SqlResult = { id: "Q1", sql: "SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM fixture", columns: [...COMPARE_COLUMNS], rows: [["DE", "food", "Food", "M", "2026-08", 0.25, "de:food"], ["DE", "food", "Food", "M", "2026-09", 0.35, "de:food"], ["CA", "food", "Food", "M", "2026-08", 2.85, "ca:food"], ["CA", "food", "Food", "M", "2026-09", 2.2, "ca:food"]], ms: 1 };
  const facts = buildFacts(objects(compared), req, compared.id, 0.7, new Date(calculatedAt));
  const base: any = { request: req, startedAt: "2026-10-26T23:59:59.000Z", calculatedAt, passThrough: 0.7, facts, alignment: buildAlignment(objects(compared), req, facts, compared.id, new Date(calculatedAt)), compared, notes: [], views: [], trace: [], sqlLog: [compared], ms: 1 };
  if (mode === "none") return base;
  const common = { sku: "GCJ", product: "Sauce", country: "DE", skuCategory: "condiments", currency: "EUR", currentPrice: 3.49, period: "2026-09", sourceId: mode === "history" ? "de:condiments" : "de:food", cite: "Q2", atProposed: 3.66, verdict: "above the market benchmark" };
  if (mode === "history") {
    base.pricingQuery = { id: "Q2", sql: "SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.concept AS rate_concept, s.category_label, s.frequency, s.period, s.yoy_pct, s.source_id FROM fixture", columns: [...SKU_RATE_COLUMNS], rows: [["GCJ", "Sauce", "DE", "condiments", "EUR", 3.49, "condiments", "Condiments", "M", "2026-08", -0.2, "de:condiments"], ["GCJ", "Sauce", "DE", "condiments", "EUR", 3.49, "condiments", "Condiments", "M", "2026-09", 1.4, "de:condiments"]], ms: 1 };
    base.skus = [{ ...common, yoy: 1.4, avg12: 0.6, rangeLow: 0.6, rangeHigh: 1.4, low: 3.51, high: 3.54, rateLabel: "Condiments", coarser: false, selectionSource: "model", selectionFit: "specific", selectionReason: "Covers sauces." }];
  } else {
    base.pricingQuery = { id: "Q2", sql: "SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.period, s.yoy_pct, s.source_id FROM fixture", columns: [...PRICING_COLUMNS], rows: [["GCJ", "Sauce", "DE", "condiments", "EUR", 3.49, "2026-09", 0.35, "de:food"]], ms: 1 };
    base.skus = [{ ...common, yoy: 0.35, low: 3.50, high: 3.50 }];
  }
  return base;
}

function checked(value: unknown) {
  const verification = verifyEvidence(value);
  assert.equal(verification.ok, true, verification.errors.join("\n"));
  return verification;
}

test("exports only run evidence and verifies a JSON round-trip with unrounded observations", () => {
  const b: any = fixture();
  b.environment = { SECRET: "must-not-export" };
  b.memory = { records: ["must-not-export"] };
  b.trace = [{ kind: "memory", title: "must-not-export" }];
  b.request.env = "must-not-export";
  b.facts[0].credentials = "must-not-export";
  b.sqlLog.push({ sql: "HEADER Authorization must-not-export" });
  const before = JSON.stringify(b);
  const evidence = exportEvidence(b);
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /must-not-export|credentials|HEADER Authorization/);
  assert.equal(JSON.stringify(b), before);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.methodVersion, 2);
  assert.equal(evidence.calculatedAt, calculatedAt);
  assert.equal(evidence.queries.market.rows[0][5], 0.25);
  assert.equal(evidence.queries.market.rows[2][5], 2.85);
  const verified = checked(JSON.parse(serialized));
  assert.equal(verified.coverage.verifiedSkus, 1);
  assert.deepEqual(verified.coverage.verifiedMarkets, ["DE", "CA"]);
  assert.ok(verified.checks > 10);
  assert.match(verified.limitations.join(" "), /authenticity|source/i);
  assert.match(verified.limitations.join(" "), /index|YoY/);
  assert.match(verified.limitations.join(" "), /semantic|selection/i);
});

test("exported nested data has no shared mutable reference to the original brief", () => {
  const b = fixture(), e = exportEvidence(b);
  e.queries.market.rows[0][5] = 999;
  e.results.facts[0].category!.points[0].yoy = 999;
  assert.equal(b.compared.rows[0][5], 0.25);
  assert.equal(b.facts[0].category!.points[0].yoy, 0.3);
});

test("market means, observation counts, ranges, verdicts, costs and source periods fail when changed", () => {
  for (const [path, value] of [["avg12", 9], ["averageCount", 99], ["averageExpected", 4], ["latestYoy", 9], ["latestPeriod", "2026-08"], ["sourceId", "other"], ["trend", "rising"]] as const) {
    const e: any = exportEvidence(fixture()); e.results.facts[0].category[path] = value;
    assert.equal(verifyEvidence(e).ok, false, path);
  }
  for (const update of [(e: any) => e.results.facts[0].suggested.low = 9, (e: any) => e.results.facts[0].verdict = "within the market benchmark", (e: any) => e.results.facts[0].costNeed = 9, (e: any) => e.results.facts[0].costVsMarket = "within the market benchmark", (e: any) => e.queries.market.rows[0][5] = 90, (e: any) => e.results.facts.pop()]) {
    const e = exportEvidence(fixture()); update(e); assert.equal(verifyEvidence(e).ok, false);
  }
});

test("alignment raw values, selected period and frozen calculation date are independently replayed", (t) => {
  const e: any = exportEvidence(fixture());
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2035-01-01T00:00:00Z") });
  checked(e);
  for (const mutate of [(x: any) => x.results.alignment.period = "2026-08", (x: any) => x.results.alignment.rows[0].yoy = 0.3, (x: any) => x.results.alignment.monthsOld = 0, (x: any) => x.calculatedAt = "2026-11-27T00:00:00.000Z"]) {
    const copy = structuredClone(e); mutate(copy); assert.equal(verifyEvidence(copy).ok, false);
  }
});

test("per-SKU history and legacy latest joins use their distinct price and rate formulas", () => {
  const history = exportEvidence(fixture()), legacy = exportEvidence(fixture("legacy"));
  checked(history); checked(legacy);
  assert.equal(history.queries.pricing!.mode, "sku-history");
  assert.equal(legacy.queries.pricing!.mode, "legacy-pricing");
  assert.equal(history.results.skus[0].yoy, 1.4);
  assert.equal(legacy.results.skus[0].yoy, 0.35, "legacy retains its raw latest rate");
  for (const field of ["currentPrice", "low", "high", "atProposed", "yoy", "avg12", "rangeLow", "rangeHigh"]) {
    const e: any = structuredClone(history); e.results.skus[0][field] = 999;
    assert.equal(verifyEvidence(e).ok, false, field);
  }
  for (const field of ["country", "sku", "product", "skuCategory", "currency", "period", "sourceId", "cite", "rateLabel"]) {
    const e: any = structuredClone(history); e.results.skus[0][field] = "altered";
    assert.equal(verifyEvidence(e).ok, false, field);
  }
});

test("missing SKU raw evidence or omitted output SKUs cannot be reported as verified", () => {
  for (const mutate of [(e: any) => delete e.queries.pricing, (e: any) => e.queries.pricing.rows = [], (e: any) => e.results.skus = [], (e: any) => e.queries.pricing.rows.forEach((r: any[]) => r[0] = "OTHER")]) {
    const e = exportEvidence(fixture()); mutate(e);
    assert.equal(verifyEvidence(e).ok, false);
  }
  const none = checked(exportEvidence(fixture("none")));
  assert.equal(none.coverage.verifiedSkus, 0);
  assert.match(none.warnings.join(" "), /SKU|pricing/i);
});

test("generic returned columns and reordered named columns retain their actual metadata and effective mapping", () => {
  const b = fixture(); b.compared.columns = b.compared.columns.map((_, i) => `c${i}`); b.pricingQuery!.columns = b.pricingQuery!.columns.map((_, i) => `c${i}`);
  const generic = exportEvidence(b);
  checked(generic);
  assert.equal(generic.queries.market.columns[0], "c0");
  assert.deepEqual(generic.queries.market.effectiveColumns, COMPARE_COLUMNS);
  const reordered = fixture(); reordered.compared.columns.reverse(); reordered.compared.rows.forEach(r => r.reverse());
  checked(exportEvidence(reordered));
  const missingNames = fixture(); missingNames.compared.columns = [];
  checked(exportEvidence(missingNames));
});

test("unknown versions, malformed shapes, non-finite values and bad column mappings fail closed", () => {
  for (const value of [null, undefined, {}, [], "json"]) assert.equal(verifyEvidence(value).ok, false);
  for (const mutate of [(e: any) => e.schemaVersion = 99, (e: any) => e.methodVersion = 99, (e: any) => e.calculatedAt = "bad", (e: any) => e.queries.market.rows[0].pop(), (e: any) => e.queries.market.columns[0] = "wrong", (e: any) => e.queries.market.columns[0] = "concept", (e: any) => e.queries.market.effectiveColumns[0] = "wrong", (e: any) => e.queries.market.rows[0][5] = Infinity, (e: any) => e.queries.pricing.mode = "guess", (e: any) => e.request.countries = ["XX"], (e: any) => e.passThrough = NaN, (e: any) => e.results.facts = null, (e: any) => e.environment = { token: "unallowed" }]) {
    const e = exportEvidence(fixture()); mutate(e); assert.equal(verifyEvidence(e).ok, false);
  }
  const b: any = fixture(); delete b.calculatedAt;
  assert.throws(() => exportEvidence(b), /calculatedAt/);
});

test("partial market coverage remains explicit and cannot become a full-coverage claim", () => {
  const b = fixture("none"); b.compared.rows = b.compared.rows.filter(r => r[0] === "DE");
  b.facts = buildFacts(objects(b.compared), b.request, "Q1", 0.7, new Date(calculatedAt));
  b.alignment = buildAlignment(objects(b.compared), b.request, b.facts, "Q1", new Date(calculatedAt));
  const e = exportEvidence(b), v = checked(e);
  assert.deepEqual(v.coverage.verifiedMarkets, ["DE"]);
  assert.deepEqual(v.coverage.unavailableMarkets, ["CA"]);
  assert.equal(e.results.alignment?.status, "unavailable");
  const changed: any = structuredClone(e); changed.results.facts[1].category = changed.results.facts[0].category;
  assert.equal(verifyEvidence(changed).ok, false);
});

test("unsupported-only runs preserve an explicit empty evidence scope", () => {
  const b: any = fixture("none");
  b.request.countries = []; b.request.unknownCountries = ["Japan"];
  b.compared = { id: "-", sql: "", columns: COMPARE_COLUMNS, rows: [], ms: 0 };
  b.facts = []; delete b.alignment;
  const v = checked(JSON.parse(JSON.stringify(exportEvidence(b))));
  assert.deepEqual(v.coverage.verifiedMarkets, []);
  assert.equal(v.coverage.requestedMarkets, 1);
  assert.deepEqual(v.coverage.unsupportedMarkets, ["Japan"]);
  assert.equal(v.coverage.rawMarketRows, 0);
  assert.match(v.warnings.join(" "), /no .*market|no .*evidence/i);
  assert.match(v.warnings.join(" "), /unsupported.*Japan/i);
});

test("supported and unsupported request scope remains separate, including malformed unsupported names", () => {
  const b = fixture("none"); b.request.unknownCountries = ["Japan", "United States"];
  const e = exportEvidence(b), v = checked(e);
  assert.equal(v.coverage.requestedMarkets, 4);
  assert.deepEqual(v.coverage.unsupportedMarkets, ["Japan", "United States"]);
  assert.deepEqual(v.coverage.verifiedMarkets, ["DE", "CA"]);
  const changed = structuredClone(e); changed.request.unknownCountries = [" "];
  assert.equal(verifyEvidence(changed).ok, false);
});

test("numeric SQL strings and quarterly observations replay without losing raw precision", () => {
  const b = fixture();
  for (const row of b.compared.rows) { row[3] = "Q"; row[4] = row[4] === "2026-08" ? "2026-Q2" : "2026-Q3"; row[5] = String(row[5]); }
  for (const row of b.pricingQuery!.rows) { row[5] = String(row[5]); row[8] = "Q"; row[9] = row[9] === "2026-08" ? "2026-Q2" : "2026-Q3"; row[10] = String(row[10]); }
  b.facts = buildFacts(objects(b.compared), b.request, "Q1", 0.7, new Date(calculatedAt));
  b.alignment = buildAlignment(objects(b.compared), b.request, b.facts, "Q1", new Date(calculatedAt));
  b.skus![0].period = "2026-Q3";
  const e = exportEvidence(b); checked(JSON.parse(JSON.stringify(e)));
  assert.equal(e.queries.market.rows[0][5], "0.25");
  assert.equal(e.results.facts[0].category!.averageExpected, 4);
  assert.equal(e.results.alignment?.status === "aligned" && e.results.alignment.monthsOld, 1);
});

test("zero-priced SKUs, negative proposals, absent proposals and invalid policies retain the calculation contract", () => {
  const b = fixture(); b.request.proposedChangePct = -100;
  for (const row of b.pricingQuery!.rows) row[5] = 0;
  Object.assign(b.skus![0], { currentPrice: 0, low: 0, high: 0, atProposed: 0, verdict: "below the market benchmark" });
  b.facts = buildFacts(objects(b.compared), b.request, "Q1", 0.7, new Date(calculatedAt));
  checked(exportEvidence(b));
  delete b.request.proposedChangePct; b.request.invalidPassThrough = true;
  delete b.skus![0].atProposed; delete b.skus![0].verdict;
  b.facts = buildFacts(objects(b.compared), b.request, "Q1", 0.7, new Date(calculatedAt));
  const e = exportEvidence(b); checked(e);
  assert.equal(e.results.facts[0].costNeed, undefined);
});

test("conflicting duplicate observations and changing SKU metadata are rejected instead of silently choosing a row", () => {
  for (const mutate of [(e: any) => e.queries.market.rows.push([...e.queries.market.rows[0].slice(0, 5), 999, "de:food"]), (e: any) => e.queries.pricing.rows[1][4] = "USD", (e: any) => e.queries.pricing.rows[1][5] = 9, (e: any) => e.queries.pricing.rows[1][11] = "other-source"]) {
    const e = exportEvidence(fixture()); mutate(e); assert.equal(verifyEvidence(e).ok, false);
  }
  const e = exportEvidence(fixture()); e.queries.market.rows.push([...e.queries.market.rows[0]]);
  checked(e);
});
