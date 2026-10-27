// A draft that fails the fact check keeps the sentences that pass on their own, when the remainder also
// passes as a whole; removed sentences and their reasons are shown. Drafts are real Nemotron replies (27 Oct).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { PriceSignalAgent, type Request } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { allowedNumbers, checkNarrative, renderBrief, salvageNarrative, type Narrative } from "../src/brief.ts";

const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/demo1-narrative-drafts.json", import.meta.url), "utf8"));
const req: Request = { raw: fx.question, countries: fx.requestedCountries, concept: fx.concept, conceptWords: [fx.concept], proposedChangePct: fx.proposed, passThrough: fx.passThrough, unknownCountries: [] };
const noteNumbers = [...new Set(fx.notes as string[])].join(" ").replace(/\b(19|20)\d{2}(-(Q[1-4]|\d{2}))?\b/g, " ").match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
const allowed = [...allowedNumbers(fx.facts, req, fx.passThrough), ...noteNumbers];
const salvage = (n: Narrative) => salvageNarrative(n, allowed, fx.facts, req, fx.passThrough, noteNumbers);
const check = (n: Narrative) => checkNarrative(n, allowed, fx.facts, req, fx.passThrough, noteNumbers);

test("every real draft fails the whole-text check", () => {
  for (const draft of Object.values(fx.drafts) as Narrative[]) assert.ok(check(draft).length);
});

test("a false headline is replaced by the code headline and the market paragraphs are kept", () => {
  const s = salvage(fx.drafts.headlineOnly)!;
  assert.ok(s, "salvaged");
  assert.equal(s.headlineByCode, true);
  assert.deepEqual(Object.keys(s.markets).sort(), ["AU", "CA", "DE"]);
  assert.equal(s.markets.DE, fx.drafts.headlineOnly.markets.DE);
  assert.deepEqual(s.removed!.map((r) => r.field), ["headline"]);
  assert.match(s.removed![0].problems.join(" "), /missing although it is in the facts/);
  assert.deepEqual(check({ ...s, headline: "Historical market comparison" }), []);
});

test("a salvaged draft keeps the model that wrote it, so the UI names the Nemotron endpoint", () => {
  const s = salvage({ ...fx.drafts.headlineOnly, model: "nvidia/nemotron-3.5-lightning-30b-a3b" })!;
  assert.equal(s.model, "nvidia/nemotron-3.5-lightning-30b-a3b");
});

test("invented cost sentences are removed one by one and the rest of each paragraph stays", () => {
  const s = salvage(fx.drafts.costInvented)!;
  assert.ok(s, "salvaged");
  for (const code of ["DE", "CA", "AU"]) {
    assert.doesNotMatch(s.markets[code], /cost need/i, code);
    assert.match(s.markets[code], /above the market benchmark range/, code);
  }
  const removed = s.removed!.filter((r) => r.field !== "headline");
  assert.equal(removed.length, 3);
  assert.ok(removed.every((r) => /cost need of 3\.4%/.test(r.sentence)));
  assert.equal(s.watch, fx.drafts.costInvented.watch, "the correct watch sentence is kept");
});

test("a paragraph that denies available data is dropped whole; the other markets keep theirs", () => {
  const s = salvage(fx.drafts.canadaDenied)!;
  assert.ok(s, "salvaged");
  assert.equal(s.markets.CA, undefined);
  assert.ok(s.markets.DE && s.markets.AU);
  assert.ok(s.removed!.some((r) => r.field === "CA" && /unavailable/.test(r.sentence)));
});

test("nothing is salvaged when no market paragraph survives", () => {
  const bad = { headline: "Canadian data absent", markets: { CA: "Canadian food CPI data is unavailable." }, watch: "Re-check next month." };
  assert.equal(salvage(bad), undefined);
});

test("the agent keeps the best salvageable draft after the rewrite also fails, and says so in the trace", async () => {
  const replies = [fx.drafts.costInvented, fx.drafts.canadaDenied];
  const agent = new PriceSignalAgent({
    llm: (async () => ({ text: JSON.stringify(replies.shift()), model: "nemotron", provider: "meterless", ms: 1 })) as any,
    sql: { run: async () => { throw new Error("no SQL"); } } as any,
    memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-salvage-"))),
    hedgeMs: Infinity,
  });
  const res = await (agent as any).narrate(req, fx.facts, fx.notes, fx.passThrough);
  assert.ok(res.narrative, "a salvaged narrative is returned");
  assert.equal(res.issue, undefined);
  // The first draft keeps all three market paragraphs; the rewrite would lose Canada.
  assert.deepEqual(Object.keys(res.narrative.markets).sort(), ["AU", "CA", "DE"]);
  assert.ok(agent.trace.some((e) => /fact check removed 4 sentences/.test(e.title)), agent.trace.map((e) => e.title).join("\n"));
});

test("the brief and the UI show which sentences the fact check removed", () => {
  const s = salvage(fx.drafts.costInvented)!;
  const brief: any = { request: req, facts: fx.facts, notes: fx.notes, passThrough: fx.passThrough, compared: { id: "Q19", sql: "", columns: [], rows: [], ms: 0 }, sqlLog: [], views: [], ms: 1, trace: [], narrative: s };
  const md = renderBrief(brief);
  assert.doesNotMatch(md, /^\*\*Euro food CPI cools/m, "the false headline is not the headline");
  assert.match(md, /~~Euro food CPI cools/, "it is listed as removed");
  assert.match(md, /^\*\*\+5% is above the market benchmark/m);
  assert.match(md, /Fact check removed 4 sentences from Nemotron's draft/);
  assert.match(md, /~~A cost need of 3\.4%/);

  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  class El { innerHTML = ""; textContent = ""; className = ""; value = ""; disabled = false; scrollTop = 0; scrollHeight = 0; clientHeight = 0; children: El[] = []; appendChild(c: El) { this.children.push(c); } scrollIntoView() {} setAttribute() {} }
  const nodes = new Map<string, El>();
  const node = (q: string) => { if (!nodes.has(q)) nodes.set(q, new El()); return nodes.get(q)!; };
  const context = vm.createContext({ document: { querySelector: node, createElement: () => new El() }, fetch: async () => ({ json: async () => ({}) }), EventSource: class { addEventListener() {} close() {} }, setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} });
  for (const file of ["scenario.js", "preview-panel.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8"), context);
  vm.runInContext(script, context);
  (context as any).sample = { facts: fx.facts, notes: fx.notes, views: [], sql: [], skus: [], passThrough: fx.passThrough, ms: 35000, compared: { id: "Q19", sql: "SELECT 1" }, markdown: md, concept: "food", requestedCountries: ["DE", "CA", "AU"], proposed: 5, narrative: s };
  vm.runInContext('render(sample,"demo question 1")', context);
  const out = node("#out").innerHTML;
  assert.match(out, /<b>Fact check: 7 sentences kept · 4 removed<\/b> \(the headline is computed in code\)/);
  assert.match(out, /<details class="removed"><summary>What was removed and why<\/summary>/);
  assert.match(out, /<s>A cost need of 3\.4%/);
  assert.match(out, /Summary written by NVIDIA Nemotron/);
});

test("a bare number from the check is shown as a readable reason", () => {
  const s = salvage(fx.drafts.costInvented)!;
  const cost = s.removed!.find((r) => /cost need/.test(r.sentence))!;
  assert.ok(cost.problems.includes("3.4 is not among the computed figures"), JSON.stringify(cost.problems));
});
