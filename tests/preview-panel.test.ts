import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function panel() {
  const nodes = new Map<string, any>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, { value: "", innerHTML: "", onclick: undefined, oninput: undefined }); return nodes.get(selector); };
  let requests = 0;
  const ctx = vm.createContext({ document: { querySelector: node }, fetch: () => { requests++; throw new Error("preview must remain offline"); }, EventSource: class { constructor() { requests++; } } });
  for (const file of ["scenario.js", "preview-panel.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8"), ctx);
  return { api: ctx.PricePreviewPanel, node, requests: () => requests };
}

function fixture() {
  return { concept: "food", proposed: 5, startedAt: "2026-10-26T17:30:00.000Z", facts: [
    { country: "DE", category: { concept: "food", label: "Food", frequency: "M", latestYoy: 0.4, latestPeriod: "2026-09", sourceId: "de:food" }, suggested: { low: 0.4, high: 1.4 }, costNeed: 3.4, cite: "Q7" },
    { country: "CA", cite: "Q7" },
  ], skus: [{ sku: "A", product: "Food <item>", country: "CA", currency: "CAD", currentPrice: 4.99, rangeLow: 1.4, rangeHigh: 2.4, period: "2026-09", sourceId: "ca:sku", cite: "Q8" }], narrative: { headline: "Original five percent summary", markets: {} }, markdown: "Original five percent summary", sinceLast: ["Original outcome"], metrics: { modelCalls: 2 } };
}

test("preview changes only its own panel, performs no request and prices from the original current price", () => {
  const p = panel(), r = fixture(), before = structuredClone(r);
  assert.match(p.api.render(r), /Preview|preview/);
  assert.match(p.api.render(r), /Original proposal.*\+5%/);
  assert.match(p.api.render(r), /2026-10-26/);
  assert.match(p.api.render(r), /not saved|No.*saved/i);
  assert.doesNotMatch(p.api.render(r), /Original five percent summary/);
  p.api.bind(r);
  for (const [proposal, price] of [["3", "5.14"], ["-2", "4.89"], ["5", "5.24"]]) {
    p.node("#scenario-proposal").value = proposal;
    p.node("#scenario-proposal").oninput();
    const html = p.node("#scenario-results").innerHTML;
    assert.match(html, new RegExp(price.replace(".", "\\.")));
    assert.match(html, /3\.4%/);
    assert.match(html, /unavailable/i, "missing CA market remains unavailable even when CA has a SKU");
    assert.match(html, /Q8/);
    assert.match(html, /ca:sku/);
    assert.doesNotMatch(html, /Food <item>/);
  }
  assert.equal(p.requests(), 0);
  assert.deepEqual(r, before);
  p.node("#scenario-reset").onclick();
  assert.equal(p.node("#scenario-proposal").value, "5");
});

test("preview rejects empty input without presenting zero and preserves proposal precision", () => {
  const p = panel(), r = fixture(); p.api.bind(r);
  p.node("#scenario-proposal").value = ""; p.node("#scenario-proposal").oninput();
  assert.match(p.node("#scenario-results").innerHTML, /enter|number|invalid/i);
  assert.doesNotMatch(p.node("#scenario-results").innerHTML, /5\.00|within the market/);
  p.node("#scenario-proposal").value = "1.399"; p.node("#scenario-proposal").oninput();
  assert.match(p.node("#scenario-results").innerHTML, /1\.399%/);
  assert.match(p.node("#scenario-results").innerHTML, /within the market benchmark/);
});

test("preview is absent during partial work and names a missing original proposal honestly", () => {
  const p = panel(), r: any = fixture();
  assert.equal(p.api.render({ ...r, partial: true }), "");
  assert.equal(p.api.render({ ...r, facts: [], skus: [] }), "");
  r.proposed = null; r.startedAt = null;
  assert.match(p.api.render(r), /Original proposal.*not supplied/);
  assert.match(p.api.render(r), /run time.*unavailable/i);
});
