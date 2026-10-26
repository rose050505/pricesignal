import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as eurostat from "../src/sources/eurostat.ts";
import * as abs from "../src/sources/abs.ts";
import * as statcan from "../src/sources/statcan.ts";
import * as types from "../src/sources/types.ts";

function mockFetch(t: TestContext, fixture: (url: URL) => unknown) {
  const urls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    urls.push(url);
    return new Response(JSON.stringify(fixture(url)), { status: 200 });
  });
  return urls;
}

function euroFixture(labels: Record<string, string>) {
  return (url: URL) => url.pathname.endsWith("/prc_hicp_manr")
    ? { extension: { description: "Discontinued and replaced by dataset prc_hicp_minr" }, dimension: { time: { category: { index: { "2025-12": 0 } } } } }
    : { dimension: { coicop18: { category: { label: labels } }, time: { category: { index: { "2026-09": 0 } } } } };
}

function absFixture(codes: { id: string; name: string }[], periods: Record<string, string | undefined> = {}) {
  return (url: URL) => {
    if (url.pathname.endsWith("/CL_CPI_INDEX")) return { data: { codelists: [{ codes }] } };
    const match = url.pathname.match(/\/1\.(\d+)\.10\.50\.([MQ])$/);
    assert.ok(match, `unexpected ABS fixture request: ${url.pathname}`);
    const key = `${match[1]}:${match[2]}`;
    const period = Object.hasOwn(periods, key) ? periods[key] : match[2] === "M" ? "2026-09" : undefined;
    return { data: { structures: [{ dimensions: { observation: [{ values: period ? [{ id: period }] : [] }] } }] } };
  };
}

test("Eurostat narrow categories keep catalog Food as the last, explicitly broad alternative", async (t) => {
  for (const concept of ["snacks", "condiments"]) await t.test(concept, async (st) => {
    const urls = mockFetch(st, euroFixture({ TOTAL: "All-items", CP01: "Food and non-alcoholic beverages", CP0118: "Sugar, confectionery and desserts", CP0119: "Salt, spices and sauces" }));
    const r = await eurostat.discover("DE", concept);
    assert.equal(r.candidates.at(-1)?.code, "CP01");
    assert.equal(r.candidates.at(-1)?.isBroadFallback, true);
    assert.equal(r.candidates.at(-1)?.lastPeriod, "2026-09");
    assert.ok(r.candidates.slice(0, -1).every((c) => !c.isBroadFallback));
    assert.equal(urls.length, 2, "a broad Eurostat option uses the existing metadata response");
    assert.match(r.candidates.at(-1)!.sourceUrl, /coicop18=CP01/);
  });
});

test("Eurostat never invents a Food fallback and moves an already matched CP01 to the end once", async (t) => {
  for (const [name, labels, words, expected] of [
    ["missing", { CP0118: "Sugar, confectionery and desserts" }, ["confectionery"], ["CP0118"]],
    ["wrong label", { CP01: "Transport", CP0118: "Sugar, confectionery and desserts" }, ["confectionery"], ["CP0118"]],
    ["already ranked", { CP01: "Food", CP0118: "Sugar, confectionery and desserts" }, ["food", "confectionery"], ["CP0118", "CP01"]],
    ["only broad", { CP01: "Food" }, ["confectionery"], ["CP01"]],
    ["empty", {}, ["confectionery"], []],
  ] as const) await t.test(name, async (st) => {
    mockFetch(st, euroFixture(labels));
    const r = await eurostat.discover("DE", "snacks", [...words]);
    assert.deepEqual(r.candidates.map((c) => c.code), [...expected]);
    assert.equal(r.candidates.filter((c) => c.isBroadFallback).length, expected.includes("CP01" as never) ? 1 : 0);
  });
});

test("Eurostat exact food and all-items requests retain their existing meaning", async (t) => {
  mockFetch(t, euroFixture({ TOTAL: "All-items", CP01: "Food and non-alcoholic beverages", CP0118: "Confectionery" }));
  for (const [concept, code] of [["food", "CP01"], ["all_items", "TOTAL"]]) {
    const r = await eurostat.discover("DE", concept);
    assert.deepEqual(r.candidates.map((c) => c.code), [code]);
    assert.ok(r.candidates.every((c) => !c.isBroadFallback));
  }
});

test("ABS appends verified Food after narrow candidates and marks its real frequency", async (t) => {
  const urls = mockFetch(t, absFixture([{ id: "30001", name: "Snacks and confectionery" }, { id: "20001", name: "Food and non-alcoholic beverages" }], { "20001:M": undefined, "20001:Q": "2026-Q3" }));
  const r = await abs.discover("AU", "snacks");
  assert.deepEqual(r.candidates.map((c) => c.code), ["30001", "20001"]);
  assert.equal(r.candidates[1].isBroadFallback, true);
  assert.equal(r.candidates[1].frequency, "Q");
  assert.equal(r.candidates[1].lastPeriod, "2026-Q3");
  assert.match(r.candidates[1].sourceUrl, /1\.20001\.10\.50\.Q/);
  assert.equal(urls.length, 4, "codelist, narrow monthly probe, broad monthly and quarterly probes");
});

test("ABS requires a real Food codelist entry and recent data, and never duplicates it", async (t) => {
  for (const [name, codes, periods, words, expected] of [
    ["missing", [{ id: "30001", name: "Confectionery" }], {}, ["confectionery"], ["30001"]],
    ["wrong label", [{ id: "20001", name: "Transport" }], {}, ["confectionery"], []],
    ["no observations", [{ id: "20001", name: "Food" }], { "20001:M": undefined, "20001:Q": undefined }, ["confectionery"], []],
    ["duplicate entry", [{ id: "20001", name: "Food" }, { id: "20001", name: "Food" }, { id: "30001", name: "Confectionery" }], {}, ["food", "confectionery"], ["30001", "20001"]],
    ["only broad", [{ id: "20001", name: "Food" }], {}, ["confectionery"], ["20001"]],
    ["empty", [], {}, ["confectionery"], []],
  ] as const) await t.test(name, async (st) => {
    mockFetch(st, absFixture([...codes], periods));
    const r = await abs.discover("AU", "snacks", [...words]);
    assert.deepEqual(r.candidates.map((c) => c.code), [...expected]);
    assert.equal(r.candidates.filter((c) => c.isBroadFallback).length, expected.includes("20001" as never) ? 1 : 0);
  });
});

test("ABS exact food and all-items requests keep their existing path without a broad marker", async (t) => {
  const urls = mockFetch(t, absFixture([{ id: "10001", name: "All groups CPI" }, { id: "20001", name: "Food and non-alcoholic beverages" }]));
  for (const [concept, code] of [["food", "20001"], ["all_items", "10001"]]) {
    const r = await abs.discover("AU", concept);
    assert.deepEqual(r.candidates.map((c) => c.code), [code]);
    assert.ok(r.candidates.every((c) => !c.isBroadFallback));
  }
  assert.equal(urls.length, 4);
});

test("StatCan labels a narrow-category Food substitution as broad, but exact requests stay exact", async (t) => {
  mockFetch(t, () => [{ object: { vectorDataPoint: [{ refPer: "2026-09-01", value: 120 }] } }]);
  for (const concept of ["snacks", "condiments"]) {
    const r = await statcan.discover("CA", concept);
    assert.equal(r.candidates[0].code, "v41690974");
    assert.equal(r.candidates[0].isBroadFallback, true);
  }
  for (const concept of ["food", "all_items"]) {
    const r = await statcan.discover("CA", concept);
    assert.ok(r.candidates.every((c) => !c.isBroadFallback));
  }
});

test("SKU chip search uses scalar product names without changing market concept words", () => {
  const original = [...types.CONCEPT_WORDS.snacks];
  assert.equal(typeof types.skuSearchWords, "function");
  const words = types.skuSearchWords("snacks", ["Honey butter chips 60 g", "Sea salt crisps"]);
  assert.deepEqual(words, [...original, "potato", "crisp", "chip"]);
  assert.deepEqual(types.CONCEPT_WORDS.snacks, original);
  assert.deepEqual(types.skuSearchWords("snacks", ["Chocolate bar", "Crispy chocolate"]), original);
  assert.deepEqual(types.skuSearchWords("food", ["Potato chips"]), types.CONCEPT_WORDS.food);
  assert.deepEqual(types.skuSearchWords("condiments", ["Chips sauce"]), types.CONCEPT_WORDS.condiments);
  assert.deepEqual(types.skuSearchWords("snacks", []), original);
});
