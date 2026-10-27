// What the judge sees in the 4-minute video (independent demo review, 27 Oct 12:30): the answer as soon as the
// numbers arrive, accurate on-screen wording, the cost-recovery conclusion, and a readable live trace.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { COMPARE_COLUMNS } from "../src/sources/index.ts";
import { costInputNeeded, fallbackHeadline, gapSummary, mergeNotes, renderBrief } from "../src/brief.ts";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/demo1-narrative-drafts.json", import.meta.url), "utf8"));
const req = { raw: fx.question, countries: fx.requestedCountries, concept: fx.concept, conceptWords: [fx.concept], proposedChangePct: fx.proposed, passThrough: fx.passThrough, unknownCountries: [] };

function browser() {
  class Element { innerHTML = ""; textContent = ""; className = ""; value = ""; disabled = false; scrollTop = 0; scrollHeight = 100; clientHeight = 100; children: Element[] = []; onclick?: () => Promise<void>; appendChild(c: Element) { this.children.push(c); } scrollIntoView() {} setAttribute() {} }
  const nodes = new Map<string, Element>();
  const node = (s: string) => { if (!nodes.has(s)) nodes.set(s, new Element()); return nodes.get(s)!; };
  const streams: any[] = [];
  class EventSource { listeners: Record<string, (m: { data: string }) => void> = {}; constructor() { streams.push(this); } addEventListener(n: string, f: any) { this.listeners[n] = f; } close() {} }
  const context = vm.createContext({ document: { querySelector: node, createElement: () => new Element() }, fetch: async (u: string) => ({ json: async () => u === "/api/ask" ? { id: "r" } : { state: "online" } }), EventSource, setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} });
  for (const f of ["scenario.js", "preview-panel.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8"), context);
  vm.runInContext(script, context);
  return { context, node, run: (c: string) => vm.runInContext(c, context) };
}

const serverSrc = fs.readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
const toResult = vm.runInNewContext(`(b) => {${serverSrc.match(/function toResult\(b: Brief\) \{([\s\S]*?)\n\}/)![1]}}`, { COMPARE_COLUMNS, costInputNeeded, fallbackHeadline, gapSummary, mergeNotes });
const partialBrief: any = { request: req, facts: fx.facts, notes: fx.notes, passThrough: fx.passThrough, compared: { id: "Q7", sql: "", columns: [], rows: [] }, sqlLog: [], views: [], ms: 36000, trace: [], partialStage: "markets" };

test("the partial result already carries the code headline, and the UI shows it while the summary is written", () => {
  const r = toResult(partialBrief);
  assert.equal(r.markdown, "");
  assert.equal(r.headline, "+5% is above the market benchmark in DE, CA and AU.");
  const b = browser();
  b.context.sample = { ...r, views: [], sql: [], skus: [], partial: true };
  b.run('render(sample,"q")');
  const out = b.node("#out").innerHTML;
  assert.match(out, /class="headline">\+5% is above the market benchmark in DE, CA and AU\./);
  assert.match(out, /Market numbers ready — pricing SKUs and checking the summary/);
  // The final brief's headline is the same sentence.
  assert.match(renderBrief({ ...partialBrief, partialStage: undefined }), /^\*\*\+5% is above the market benchmark in DE, CA and AU\.\*\*$/m);
});

test("the cost-recovery scenario is compared with each market in one line, with its formula", () => {
  const b = browser();
  const facts = [{ country: "DE", costNeed: 3.1, costVsMarket: "above the market benchmark" }, { country: "CA", costNeed: 3.1, costVsMarket: "within the market benchmark" }, { country: "AU", costNeed: 3.1, costVsMarket: "within the market benchmark" }];
  b.context.sample = { headline: "+5% is above the market benchmark in DE, CA and AU.", facts, notes: [], views: [], sql: [], skus: [], passThrough: 0.7, cost: 8, costShare: 60, costShareBasis: "after_change", ms: 1000, markdown: "", concept: "food", requestedCountries: ["DE", "CA", "AU"], compared: { id: "Q1", sql: "", rows: [] } };
  b.run('render(sample,"q")');
  const out = b.node("#out").innerHTML;
  assert.match(out, /Your cost-recovery scenario \(\+3\.1% = 8% × 60% ÷ 1\.08 × 70%\) is above the market benchmark in DE; within the market benchmark in CA and AU\./);
  b.context.sample.costShareBasis = "before_change";
  b.run('render(sample,"q")');
  assert.match(b.node("#out").innerHTML, /\(\+3\.1% = 8% × 60% × 70%\)/);
});

test("on-screen counts say what happened: cached in Zetaris, verified without creating, one agency, singular planner call", () => {
  const b = browser();
  b.context.sample = { headline: "x", facts: [], notes: [], views: [], sql: [], skus: [], passThrough: 0.7, ms: 1000, markdown: "", concept: "food", requestedCountries: ["FR"], metrics: { modelCalls: 5, plannerCalls: 1, discoveries: 6, reusedViews: 0, cachedTables: 7 },
    compared: { id: "Q9", sql: "SELECT", columns: [...COMPARE_COLUMNS], rows: [["FR", "food", "Food", "M", "2026-09", 1.5, "eurostat:a"], ["IT", "food", "Food", "M", "2026-09", 2.1, "eurostat:b"]] }, semanticView: { name: "v_market_inflation_x", sql: "CREATE", members: ["a", "b", "c", "d", "e", "f"] } };
  b.run('render(sample,"q")');
  const out = b.node("#out").innerHTML;
  assert.match(out, /7 source tables cached in Zetaris/);
  assert.doesNotMatch(out, /served from the Zetaris cache/);
  assert.match(out, /1 planner call ·/);
  assert.match(out, /over 6 official series/);
  b.run('progress={request:"x",parsedBy:true,agencies:new Set(["Eurostat (HICP)"]),onboarded:6,created:0,recalled:0,compare:""};renderProgress()');
  assert.match(b.node("#out").innerHTML, /6 series verified in Zetaris \(already registered; nothing new created\)/);
});

test("the live trace labels retries and Nemotron replies and reads the plan in words", () => {
  const b = browser(); b.node("#q").value = "food +5%";
  b.run('addTrace({kind:"warn",title:"request parsing: no reply after 10 s - sent the same request again; the first reply wins"})');
  b.run('addTrace({kind:"llm",title:"parsed request (openrouter/nvidia/nemotron-3.5-lightning, 14828 ms via Meterless Nightshift)"})');
  b.run('addTrace({kind:"plan",title:"discover_and_onboard {\\"country\\":\\"DE\\",\\"concept\\":\\"food\\"} · use_memory_mapping {\\"country\\":\\"CA\\",\\"concept\\":\\"food\\"}"})');
  const rows = b.node("#trace").children.map((c: any) => c.innerHTML);
  assert.match(rows[0], /class="k retry">retry</);
  assert.match(rows[1], /class="k nemotron">nemotron</);
  assert.match(rows[2], /find and register DE food, reuse remembered CA food/);
  assert.match(html, /<h2[^>]*>Live trace<\/h2>/);
});

test("a market with no products in the price list is named as such", () => {
  const agent = fs.readFileSync(new URL("../src/agent.ts", import.meta.url), "utf8");
  assert.match(agent, /Your price list has no products in \$\{req\.countries\.join\(", "\)\}; SKU prices are omitted\./);
});

test("the preview table keeps one decimal like the market cards", () => {
  const b = browser();
  const panel = (b.context as any).PricePreviewPanel;
  assert.ok(panel);
  const src = fs.readFileSync(new URL("../public/preview-panel.js", import.meta.url), "utf8");
  assert.match(src, /pct\(m\.low\)–\$\{pct\(m\.high\)\}|toFixed\(1\)/);
});

test("the market bar is labelled, and a Food series that was the only official candidate is not called unconfirmed", () => {
  const b = browser();
  const sku = (reason: string) => ({ sku: "GCJ", product: "Gochujang 500 g", country: "CA", currency: "CAD", currentPrice: 8.4, low: 8.6, high: 8.7, rangeLow: 2.2, rangeHigh: 4.1, atProposed: 8.82, verdict: "above the market benchmark", yoy: 2.2, period: "2026-09", rateLabel: "Food", coarser: true, selectionSource: "fallback", selectionFit: "broader", selectionReason: reason });
  b.context.sample = { headline: "x", facts: fx.facts, notes: [], views: [], sql: [], passThrough: 0.7, ms: 1000, markdown: "", concept: "food", requestedCountries: fx.requestedCountries, proposed: 5, compared: { id: "Q1", sql: "", rows: [] },
    skus: [sku("The official Food series was the only candidate; no product-specific official series was found."), sku("Using the official Food series as a broader proxy; a product-specific match was not confirmed.")] };
  b.run('render(sample,"q")');
  const out = b.node("#out").innerHTML;
  assert.match(out, /market benchmark [\d.]+–[\d.]+% \(box\) · proposed \+5% \(red line\)/);
  assert.match(out, /Broader proxy · Only official option/);
  assert.match(out, /Broader proxy · Unconfirmed match/);
});
