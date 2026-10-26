import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function calculator() {
  let externalCalls = 0;
  const context = vm.createContext({ fetch: () => { externalCalls++; throw new Error("network forbidden"); }, SQL: () => { externalCalls++; throw new Error("SQL forbidden"); } });
  vm.runInContext(fs.readFileSync(new URL("../public/scenario.js", import.meta.url), "utf8"), context);
  return { preview: (result: unknown, input: unknown): any => context.PriceScenario.preview(result, input), externalCalls: () => externalCalls };
}
const market = (country = "DE", extra: Record<string, unknown> = {}): any => ({ country, category: { concept: "food", label: `${country} Food`, frequency: "M", latestPeriod: "2026-09", latestYoy: 2.3, sourceId: `${country}:food` }, suggested: { low: 1.5, high: 3 }, cite: "Q1", ...extra });
const sku = (name = "A", extra: Record<string, unknown> = {}): any => ({ sku: name, product: "Sauce", country: "DE", currency: "EUR", currentPrice: 3.49, rangeLow: 1.5, rangeHigh: 3, period: "2026-09", sourceId: "DE:condiments", cite: "Q2", rateLabel: "Condiments", ...extra });
const result = (extra: Record<string, unknown> = {}): any => ({ concept: "food", proposed: 5, facts: [market()], skus: [sku()], ...extra });
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));
function deepFreeze(value: any): any {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test("accepts finite decimal proposals in the inclusive -100 to 100 percent interval", () => {
  const { preview } = calculator();
  for (const input of [-100, 100, 0, -2.5, "-100", "+100", " .5 ", "-0.25", "5.0"]) {
    const out = preview(result(), input);
    assert.equal(out.ok, true, String(input));
    assert.equal(out.proposed, Number(input));
  }
});

test("rejects blank, coercible non-decimal, non-finite and out-of-range inputs without producing prices", () => {
  const { preview } = calculator();
  for (const input of [undefined, null, "", "  ", false, true, [], [5], {}, NaN, Infinity, -Infinity, "Infinity", "NaN", "1e2", "0x10", "5%", "1_0", ".", "+", "--2", 100.01, -100.01]) {
    const out = preview(result(), input);
    assert.equal(out.ok, false, String(input));
    assert.equal(typeof out.error, "string");
    assert.equal(out.skus, undefined);
  }
});

test("each market uses its own historical range, including negative values and inclusive endpoints", () => {
  const { preview } = calculator();
  const r = result({ facts: [market("DE", { suggested: { low: -4, high: -2 } }), market("CA", { suggested: { low: -2, high: 1 } }), market("AU", { suggested: { low: 0, high: 2 } })] });
  const out = preview(r, -2);
  assert.deepEqual(plain(out.markets.map((f: any) => [f.country, f.verdict])), [["DE", "within the market benchmark"], ["CA", "within the market benchmark"], ["AU", "below the market benchmark"]]);
  assert.equal(preview(result(), 3.1).markets[0].verdict, "above the market benchmark");
  assert.equal(preview(result(), 1.5).markets[0].verdict, "within the market benchmark");
});

test("market provenance and cost recovery targets are preserved without recalculating the cost policy", () => {
  const { preview } = calculator();
  const out = preview(result({ facts: [market("DE", { costNeed: 3.36 }), market("CA", { costNeed: 0 })], passThrough: 0, cost: 99, costShare: 1 }), -20);
  assert.deepEqual(plain(out.markets.map((f: any) => f.costNeed)), [3.36, 0]);
  assert.equal(out.markets[0].period, "2026-09");
  assert.equal(out.markets[0].sourceId, "DE:food");
  assert.equal(out.markets[0].cite, "Q1");
  assert.equal(out.markets[0].label, "DE Food");
  assert.equal(out.originalProposed, 5);
  assert.equal(preview(result({ proposed: 150 }), 5).originalProposed, 150);
  assert.equal(preview(result({ proposed: null }), 5).originalProposed, null);
});

test("missing requested categories never acquire an all-items verdict while explicit all-items works", () => {
  const { preview } = calculator();
  const allItems = { ...market().category, concept: "all_items" };
  const r = result({ facts: [market("DE", { category: undefined, allItems })] });
  const missing = preview(r, 2).markets[0];
  assert.equal(missing.available, false);
  assert.match(missing.reason, /category|concept/i);
  assert.equal(missing.verdict, undefined);
  assert.equal(preview({ ...r, concept: "all_items" }, 2).markets[0].available, true);
});

test("invalid market series or ranges are unavailable without borrowing another market's range", () => {
  const { preview } = calculator();
  for (const extra of [{ category: null }, { category: { ...market().category, latestYoy: null } }, { category: { ...market().category, sourceId: "" } }, { category: { ...market().category, latestPeriod: "2026-13" } }, { suggested: undefined }, { suggested: { low: 3, high: 2 } }, { suggested: { low: NaN, high: 2 } }, { suggested: { low: "1", high: 2 } }, { suggested: { low: 1, high: Infinity } }]) {
    const out = preview(result({ facts: [market("DE"), market("CA", extra)] }), 2);
    assert.equal(out.markets[0].available, true);
    assert.equal(out.markets[1].available, false);
    assert.equal(out.markets[1].verdict, undefined);
    assert.equal(typeof out.markets[1].reason, "string");
  }
});

test("SKU calculations use each product's own range and provenance, independent of missing market facts", () => {
  const { preview } = calculator();
  const r = result({ facts: [market("CA", { category: null })], skus: [sku("A"), sku("B", { country: "CA", currency: "CAD", currentPrice: 10, rangeLow: 5, rangeHigh: 6, sourceId: "CA:food", rateLabel: "Food", coarser: true, selectionSource: "fallback", selectionFit: "broader", selectionReason: "A broader official proxy." })] });
  const out = preview(r, 3);
  assert.equal(out.markets[0].available, false);
  assert.deepEqual(plain(out.skus.map((s: any) => [s.sku, s.price, s.verdict])), [["A", 3.59, "within the market benchmark"], ["B", 10.3, "below the market benchmark"]]);
  assert.equal(out.skus[1].period, "2026-09");
  assert.equal(out.skus[1].sourceId, "CA:food");
  assert.equal(out.skus[1].cite, "Q2");
  assert.equal(out.skus[1].rateLabel, "Food");
  assert.equal(out.skus[1].coarser, true);
  assert.equal(out.skus[1].selectionSource, "fallback");
});

test("zero prices and a -100 percent scenario remain valid under the agent's cent rounding policy", () => {
  const { preview } = calculator();
  assert.equal(preview(result({ skus: [sku("FREE", { currentPrice: 0 })] }), 100).skus[0].price, 0);
  assert.equal(preview(result(), -100).skus[0].price, 0);
  assert.equal(preview(result({ skus: [sku("ROUND", { currentPrice: 2.55 })] }), 10).skus[0].price, 2.81);
  assert.equal(preview(result({ skus: [sku("FLOAT", { currentPrice: 1.005 })] }), 0).skus[0].price, 1);
});

test("invalid or overflowing SKU values are omitted with reasons instead of misleading prices", () => {
  const { preview } = calculator();
  for (const extra of [{ currentPrice: null }, { currentPrice: "3" }, { currentPrice: -1 }, { currentPrice: Infinity }, { currentPrice: Number.MAX_VALUE }, { rangeLow: undefined }, { rangeHigh: NaN }, { rangeLow: 3, rangeHigh: 2 }]) {
    const out = preview(result({ skus: [sku("BAD", extra), sku("GOOD")] }), 100);
    assert.deepEqual(plain(out.skus.map((s: any) => s.sku)), ["GOOD"]);
    assert.equal(out.omittedSkus.length, 1);
    assert.equal(out.omittedSkus[0].sku, "BAD");
    assert.equal(typeof out.omittedSkus[0].reason, "string");
  }
});

test("preview neither mutates source results nor copies original narrative, Markdown or memory outputs", () => {
  const calc = calculator();
  const r = deepFreeze(result({ narrative: { headline: "Original conclusion" }, markdown: "Original report", sinceLast: ["Old memory"], notes: ["Original note"] }));
  const before = JSON.stringify(r);
  const out = calc.preview(r, -2);
  assert.equal(JSON.stringify(r), before);
  assert.equal(out.narrative, undefined);
  assert.equal(out.markdown, undefined);
  assert.equal(out.sinceLast, undefined);
  out.markets[0].low = 88;
  out.skus[0].price = 88;
  assert.equal(JSON.stringify(r), before);
  assert.equal(calc.externalCalls(), 0);
});

test("invalid result shapes return an explicit error rather than throwing", () => {
  const { preview } = calculator();
  for (const value of [undefined, null, [], true, "result", {}, { facts: "bad" }]) assert.equal(preview(value, 5).ok, false);
  const out = preview({ facts: [], skus: [] }, 5);
  assert.equal(out.ok, true);
  assert.deepEqual(plain(out.markets), []);
  assert.deepEqual(plain(out.skus), []);
});
