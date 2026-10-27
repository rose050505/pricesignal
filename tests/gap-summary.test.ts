// "Is +5% too much?" needs how far, not only above/within/below: a line computed in code from the same facts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildFacts, gapSummary, renderBrief } from "../src/brief.ts";
import type { Request } from "../src/agent.ts";

const rows = [["DE", 2.4, 0.4], ["CA", 4.0, 2.2], ["AU", 3.4, 3.0]].flatMap(([country, prior, latest]) => [
  { country, concept: "food", category_label: "Food", frequency: "M", period: "2026-08", yoy_pct: prior, source_id: `${country}:food` },
  { country, concept: "food", category_label: "Food", frequency: "M", period: "2026-09", yoy_pct: latest, source_id: `${country}:food` },
]);
const brief = (req: Request): any => {
  const facts = buildFacts(rows, req, "Q1", req.passThrough ?? 1, new Date("2026-10-27"));
  return { request: req, facts, notes: [], passThrough: req.passThrough ?? 1, compared: { id: "Q1", sql: "", columns: [], rows: [], ms: 0 }, sqlLog: [], views: [], ms: 1, trace: [] };
};
const base: Request = { raw: "DE CA AU food +5%", countries: ["DE", "CA", "AU"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, passThrough: 0.7, unknownCountries: [] };

test("the gap line states how far the proposal is from each market's benchmark", () => {
  const b = brief(base);
  assert.deepEqual(b.facts.map((f: any) => [f.country, f.suggested.low, f.suggested.high]), [["DE", 0.4, 1.4], ["CA", 2.2, 3.1], ["AU", 3, 3.2]]);
  assert.equal(gapSummary(b), "How far: +5% is 3.6 pp above the DE benchmark top (1.4%), 1.9 pp above CA (3.1%), 1.8 pp above AU (3.2%).");
  const within = brief({ ...base, proposedChangePct: 3 });
  assert.equal(gapSummary(within), "How far: +3% is 1.6 pp above the DE benchmark top (1.4%), within CA (2.2–3.1%), within AU (3.0–3.2%).");
  const below = brief({ ...base, proposedChangePct: 0 });
  assert.match(gapSummary(below)!, /0\.4 pp below the DE benchmark bottom \(0\.4%\)|0\.0%/);
  assert.equal(gapSummary(brief({ ...base, proposedChangePct: undefined })), undefined);
});

test("with a cost-recovery scenario the gap line also compares the proposal with it", () => {
  const b = brief({ ...base, costIncreasePct: 8, costSharePct: 60 });
  assert.equal(b.facts[0].costNeed, 3.4);
  assert.match(gapSummary(b)!, / Your cost-recovery scenario is \+3\.4%: \+5% is 1\.6 pp more\.$/);
});

test("the brief shows the gap line right under the headline, not as the headline", () => {
  const md = renderBrief(brief(base));
  const lines = md.split("\n").filter(Boolean);
  const h = lines.findIndex((l) => /^\*\*\+5% is above/.test(l));
  assert.ok(h >= 0);
  assert.match(lines[h + 1], /^How far: \+5% is 3\.6 pp above/);
});

test("without a cost change the policy line invites the cost inputs instead of an inert sentence, and the benchmark caveats are stated once", () => {
  const md = renderBrief(brief(base));
  assert.doesNotMatch(md, /This policy does not scale the market benchmark\./);
  assert.match(md, /Add your cost change and unit-cost share/);
  assert.match(md, /one-off price change with about a year of consumer-price growth/);
  assert.match(md, /Exchange-rate moves are not included/);
  const withCost = renderBrief(brief({ ...base, costIncreasePct: 8, costSharePct: 60 }));
  assert.doesNotMatch(withCost, /Add your cost change/);
});

test("the UI shows the gap line under the headline", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  class El { innerHTML = ""; textContent = ""; className = ""; value = ""; disabled = false; scrollTop = 0; scrollHeight = 0; clientHeight = 0; children: El[] = []; appendChild(c: El) { this.children.push(c); } scrollIntoView() {} setAttribute() {} }
  const nodes = new Map<string, El>();
  const node = (q: string) => { if (!nodes.has(q)) nodes.set(q, new El()); return nodes.get(q)!; };
  const context = vm.createContext({ document: { querySelector: node, createElement: () => new El() }, fetch: async () => ({ json: async () => ({}) }), EventSource: class { addEventListener() {} close() {} }, setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} });
  for (const file of ["scenario.js", "preview-panel.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8"), context);
  vm.runInContext(script, context);
  const b = brief(base);
  (context as any).sample = { facts: b.facts, notes: [], views: [], sql: [], skus: [], passThrough: 0.7, ms: 1000, compared: { id: "Q1", sql: "SELECT 1" }, markdown: renderBrief(b), concept: "food", requestedCountries: ["DE", "CA", "AU"], proposed: 5, gap: gapSummary(b) };
  vm.runInContext('render(sample,"q")', context);
  assert.match(node("#out").innerHTML, /class="headline">[^<]*<\/p><p class="gap">How far: \+5% is 3\.6 pp above the DE benchmark top/);
});
