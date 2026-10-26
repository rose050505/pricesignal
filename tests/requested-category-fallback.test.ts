import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PriceSignalAgent, type Request } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { HMEM } from "../src/hmem_impl.ts";
import { allowedNumbers, buildFacts, checkNarrative, factsForNarrative, fallbackHeadline, renderBrief, seriesFacts, type Brief } from "../src/brief.ts";
import { buildAlignment } from "../src/alignment.ts";
import { exportEvidence, verifyEvidence } from "../src/evidence.ts";
import { COMPARE_COLUMNS } from "../src/sources/index.ts";
import { PRICING_COLUMNS, SKU_RATE_COLUMNS } from "../src/sources/pricelist.ts";

const calculatedAt = "2026-10-27T00:00:00.000Z";
const request = (extra: Partial<Request> = {}): Request => ({ raw: "Germany food, proposed +3%", countries: ["DE"], unknownCountries: [], concept: "food", conceptWords: ["food"], proposedChangePct: 3, costIncreasePct: 8, costSharePct: 60, passThrough: 0.7, ...extra });
const row = (country = "DE", concept = "all_items", value = 4, label = "All-items") => ({ country, concept, category_label: label, frequency: "M", period: "2026-09", yoy_pct: value, source_id: `${country}:${concept}` });
function fixture(rows = [row()], req = request()): Brief {
  const compared = { id: "Q1", sql: "SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM fixture", columns: [...COMPARE_COLUMNS], rows: rows.map(r => COMPARE_COLUMNS.map(c => (r as any)[c])), ms: 0 };
  const facts = buildFacts(rows, req, "Q1", 0.7, new Date(calculatedAt));
  return { request: req, calculatedAt, facts, alignment: buildAlignment(rows, req, facts, "Q1", new Date(calculatedAt)), compared, sqlLog: [compared], notes: [], views: [], trace: [], ms: 0, passThrough: 0.7 };
}
function narrativeErrors(b: Brief, text: string, field: "market" | "headline" | "watch" = "market") {
  const n = { headline: field === "headline" ? text : "Requested category unavailable.", markets: (field === "market" ? { DE: text } : {}) as Record<string, string>, ...(field === "watch" ? { watch: text } : {}) };
  return checkNarrative(n, allowedNumbers(b.facts, b.request, b.passThrough), b.facts, b.request, b.passThrough);
}
function memoryOnly() {
  const memory = Object.create(AgentMemory.prototype) as AgentMemory;
  (memory as any).hmem = new HMEM();
  return memory;
}
function compare(memory: AgentMemory, b: Brief) {
  const agent = new PriceSignalAgent({ memory, hedgeMs: Infinity, llm: async () => { throw new Error("unexpected model call"); }, sql: { run: async () => { throw new Error("unexpected SQL call"); } } });
  return (agent as any).compareWithLastBrief(b.facts, b.request, b.passThrough) as string[];
}

test("missing requested category keeps all-items context without a benchmark or verdict", () => {
  const [f] = fixture().facts;
  assert.equal(f.category, undefined);
  assert.equal(f.allItems?.latestYoy, 4);
  assert.equal(f.suggested, undefined);
  assert.equal(f.verdict, undefined);
  assert.equal(f.costVsMarket, undefined);
  assert.equal(f.costNeed, 3.4);
});

test("a valid cost scenario survives absent market observations and never invents a comparison", () => {
  const [f] = fixture([]).facts;
  assert.equal(f.costNeed, 3.4);
  assert.equal(f.suggested, undefined);
  assert.equal(f.costVsMarket, undefined);
  assert.equal(fixture([], request({ costSharePct: undefined })).facts[0].costNeed, undefined);
});

test("explicit all-items and a broader Food series mapped to the requested concept retain their benchmark", () => {
  for (const b of [fixture([row()], request({ concept: "all_items" })), fixture([row("DE", "snacks", 4, "Food")], request({ concept: "snacks" }))]) {
    assert.equal(b.facts[0].suggested?.low, 4);
    assert.equal(b.facts[0].verdict, "below the market benchmark");
    assert.equal(b.facts[0].costVsMarket, "below the market benchmark");
  }
});

test("partial coverage computes only the market that has the requested category", () => {
  const b = fixture([row(), row("CA", "food", 2, "Food")], request({ countries: ["DE", "CA"] }));
  assert.equal(b.facts[0].suggested, undefined);
  assert.equal(b.facts[1].suggested?.low, 2);
  assert.equal(b.facts[1].verdict, "above the market benchmark");
  assert.match(fallbackHeadline(b)!, /DE.*unavailable/i);
  assert.match(fallbackHeadline(b)!, /above.*CA/i);
});

test("narrative facts explicitly distinguish unavailable requested category and context-only all-items", () => {
  const [f] = factsForNarrative(fixture().facts, request(), 0.7) as any[];
  assert.equal(f.requested_category, "food");
  assert.equal(f.requested_category_available, false);
  assert.equal(f.all_items_context_only, true);
  assert.equal(f.benchmark_range_pct, undefined);
  assert.equal(f.cost_need_pct, 3.4);
  assert.equal(f.cost_vs_market, undefined);
});

test("new narrative coverage keys cannot leak into user-facing prose", () => {
  for (const key of ["requested_category", "requested_category_available", "all_items_context_only", "coverage_note"]) {
    assert.ok(narrativeErrors(fixture(), `${key}: unavailable.`).some(e => /internal payload key/.test(e)), key);
  }
});

test("known English missing-category observation and verdict claims are rejected in every narrative field", () => {
  const b = fixture();
  for (const field of ["market", "headline", "watch"] as const) for (const text of ["Food inflation is 4%.", "Food prices rose 4%.", "The proposal is below the food benchmark.", "The proposal is below the market benchmark."]) {
    assert.ok(narrativeErrors(b, text, field).length, `${field}: ${text}`);
  }
});

test("missing-category colon, CPI, remains-at and standalone benchmark claims fail in every narrative field", () => {
  const b = fixture();
  for (const field of ["market", "headline", "watch"] as const) for (const text of [
    "Food inflation: 4%.",
    "Food CPI is 4%.",
    "The food benchmark is 4%.",
    "Food inflation remains at 4%.",
  ]) assert.ok(narrativeErrors(b, text, field).length, `${field}: ${text}`);
});

test("missing-category rate-claim guards preserve explicit all-items context and unavailable caveats", () => {
  const b = fixture();
  for (const field of ["market", "headline", "watch"] as const) for (const text of [
    "Food data is unavailable. All-items inflation: 4%, for context only.",
    "Food CPI is unavailable. All-items CPI is 4%, for context only.",
    "The food benchmark is unavailable. All-items inflation remains at 4%, for context only.",
  ]) assert.deepEqual(narrativeErrors(b, text, field), [], `${field}: ${text}`);
});

test("explicit all-items context and an unavailable-category caveat remain valid narrative", () => {
  const b = fixture();
  assert.deepEqual(narrativeErrors(b, "Food data is unavailable. All-items inflation is 4%, for context only."), []);
  assert.deepEqual(narrativeErrors(b, "Food data is unavailable; the proposal cannot be classified against its benchmark."), []);
  const available = fixture([row()], request({ concept: "all_items" }));
  assert.deepEqual(narrativeErrors(available, "All-items inflation is 4%. The proposal is below the market benchmark."), []);
});

test("mixed-market narrative does not treat one country's valid food evidence as another country's coverage", () => {
  const b = fixture([row(), row("CA", "food", 4, "Food")], request({ countries: ["DE", "CA"] }));
  assert.ok(narrativeErrors(b, "Germany food inflation is 4%.", "headline").length);
  assert.ok(narrativeErrors(b, "Food inflation is 4% in every market.", "headline").length);
  assert.deepEqual(narrativeErrors(b, "Canada food inflation is 4%. Germany food data is unavailable.", "headline"), []);
});

test("Markdown labels the missing category and context rates without an invented benchmark", () => {
  const b = fixture(), text = renderBrief(b);
  assert.match(fallbackHeadline(b)!, /requested category.*unavailable|food.*unavailable/i);
  assert.match(text, /requested category.*unavailable|food.*unavailable/i);
  assert.match(text, /All-items.*context only/i);
  assert.match(text, /\+4\.0%/);
  assert.match(text, /DE:all_items/);
  assert.doesNotMatch(text, /below the market benchmark|4\.0–4\.0%|undefined/);
});

test("method 3 exports and replays missing-category coverage plus independent cost arithmetic", () => {
  for (const b of [fixture(), fixture([])]) {
    const e = exportEvidence(b);
    assert.equal(e.methodVersion, 3);
    const v = verifyEvidence(JSON.parse(JSON.stringify(e)));
    assert.equal(v.ok, true, v.errors.join("\n"));
    assert.deepEqual(v.coverage.verifiedMarkets, []);
    assert.deepEqual(v.coverage.unavailableMarkets, ["DE"]);
    assert.equal(e.results.facts[0].costNeed, 3.4);
    const tampered = structuredClone(e);
    tampered.results.facts[0].suggested = { low: 4, high: 4, basis: "invented all-items fallback" };
    assert.equal(verifyEvidence(tampered).ok, false);
  }
});

test("method 2 replays its historical all-items fallback, including legacy SKU prices, without silently upgrading it", () => {
  const b = fixture(), allItems = seriesFacts([row()])!;
  b.facts = [{ country: "DE", agency: "Eurostat (HICP)", allItems, cite: "Q1", monthsStale: 1, suggested: { low: 4, high: 4, basis: "All-items historical market benchmark: latest 4% and average 4% (1 of 12 monthly observations)" }, verdict: "below the market benchmark", costNeed: 3.4, costVsMarket: "below the market benchmark" }];
  b.pricingQuery = { id: "Q2", sql: "SELECT sku, product, country, sku_category, currency, current_price, period, yoy_pct, source_id FROM fixture", columns: [...PRICING_COLUMNS], rows: [["SKU1", "Sauce", "DE", "food", "EUR", 100, "2026-09", 4, "DE:all_items"]], ms: 0 };
  b.skus = [{ sku: "SKU1", product: "Sauce", country: "DE", skuCategory: "food", currency: "EUR", currentPrice: 100, period: "2026-09", yoy: 4, sourceId: "DE:all_items", low: 104, high: 104, atProposed: 103, verdict: "below the market benchmark", cite: "Q2" }];
  const e: any = exportEvidence(b); e.methodVersion = 2;
  const v = verifyEvidence(e);
  assert.equal(v.ok, true, v.errors.join("\n"));
  assert.deepEqual(v.coverage.verifiedMarkets, []);
  assert.equal(v.coverage.verifiedSkus, 1);
  e.methodVersion = 3;
  assert.equal(verifyEvidence(e).ok, false, "method 3 must reject the old fallback output");
});

test("method 3 legacy SKU joins keep the proposed price but cannot inherit an all-items benchmark", () => {
  const b = fixture();
  b.pricingQuery = { id: "Q2", sql: "SELECT sku, product, country, sku_category, currency, current_price, period, yoy_pct, source_id FROM fixture", columns: [...PRICING_COLUMNS], rows: [["SKU1", "Sauce", "DE", "food", "EUR", 100, "2026-09", 4, "DE:all_items"]], ms: 0 };
  b.skus = [{ sku: "SKU1", product: "Sauce", country: "DE", skuCategory: "food", currency: "EUR", currentPrice: 100, period: "2026-09", yoy: 4, sourceId: "DE:all_items", atProposed: 103, cite: "Q2" }];
  const v = verifyEvidence(exportEvidence(b));
  assert.equal(v.ok, true, v.errors.join("\n"));
  assert.equal(v.coverage.verifiedSkus, 1);
  assert.deepEqual(v.coverage.verifiedMarkets, []);
});

test("independently joined SKU category history can still have a benchmark when the market category is absent", () => {
  const b = fixture();
  b.pricingQuery = { id: "Q2", sql: "SELECT sku, product, country, sku_category, currency, current_price, rate_concept, category_label, frequency, period, yoy_pct, source_id FROM fixture", columns: [...SKU_RATE_COLUMNS], rows: [["SKU1", "Sauce", "DE", "condiments", "EUR", 100, "condiments", "Condiments", "M", "2026-08", 2, "DE:condiments"], ["SKU1", "Sauce", "DE", "condiments", "EUR", 100, "condiments", "Condiments", "M", "2026-09", 5, "DE:condiments"]], ms: 0 };
  b.skus = [{ sku: "SKU1", product: "Sauce", country: "DE", skuCategory: "condiments", currency: "EUR", currentPrice: 100, period: "2026-09", yoy: 5, sourceId: "DE:condiments", low: 103.5, high: 105, atProposed: 103, verdict: "below the market benchmark", rateLabel: "Condiments", avg12: 3.5, rangeLow: 3.5, rangeHigh: 5, cite: "Q2" }];
  const v = verifyEvidence(exportEvidence(b));
  assert.equal(v.ok, true, v.errors.join("\n"));
  assert.equal(v.coverage.verifiedSkus, 1);
  assert.deepEqual(v.coverage.unavailableMarkets, ["DE"]);
});

test("method 2 with no market rows preserves its omitted cost output while method 3 requires the valid cost scenario", () => {
  const e: any = exportEvidence(fixture([]));
  e.methodVersion = 2;
  delete e.results.facts[0].costNeed;
  const old = verifyEvidence(e);
  assert.equal(old.ok, true, old.errors.join("\n"));
  e.methodVersion = 3;
  assert.equal(verifyEvidence(e).ok, false);
});

test("all six preserved method-2 evidence packets retain their 2343 recorded checks", () => {
  let checks = 0, packets = 0;
  for (const entry of readdirSync(new URL("../examples/", import.meta.url), { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^0[1-6]_/.test(entry.name)) continue;
    const e = JSON.parse(readFileSync(new URL(`../examples/${entry.name}/evidence.json`, import.meta.url), "utf8"));
    assert.equal(e.methodVersion, 2);
    const v = verifyEvidence(e);
    assert.equal(v.ok, true, `${entry.name}: ${v.errors.join("\n")}`);
    checks += v.checks; packets++;
  }
  assert.equal(packets, 6);
  assert.equal(checks, 2343);
});

test("method-2 outcomes are not compared as a data revision and new outcomes record method 3", () => {
  const memory = memoryOnly(), b = fixture([row("DE", "food", 4, "Food")]);
  memory.rememberOutcome({ country: "DE", concept: "food", period: "2026-09", yoy: 2, low: 2, high: 2, policy: 0.7, at: "2026-10-26T00:00:00Z", sourceId: "DE:food", methodVersion: 2 });
  const text = compare(memory, b).join("\n");
  assert.match(text, /method.*changed/i);
  assert.match(text, /not directly comparable/i);
  assert.doesNotMatch(text, /history revised|new official release/);
  assert.equal(memory.lastOutcome("DE", "food")!.outcome.methodVersion, 3);
  assert.match(compare(memory, b).join("\n"), /no new official release/);
});

test("a missing requested category cannot overwrite the remembered all-items outcome", () => {
  const memory = memoryOnly();
  memory.rememberOutcome({ country: "DE", concept: "all_items", period: "2026-08", yoy: 2, low: 2, high: 2, policy: 0.7, at: "2026-10-26T00:00:00Z", sourceId: "DE:all_items", methodVersion: 3 });
  const before = JSON.stringify(memory.lastOutcome("DE", "all_items"));
  assert.deepEqual(compare(memory, fixture()), []);
  assert.equal(JSON.stringify(memory.lastOutcome("DE", "all_items")), before);
});
