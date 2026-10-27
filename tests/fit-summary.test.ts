// "Too much?" also needs the other side: which change would sit inside every market benchmark (independent judge
// review, 27 Oct 18:15: the answer stops at "above" and never says how much fits). Benchmark tops restated, not advice.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildFacts, fitSummary, renderBrief } from "../src/brief.ts";
import type { Request } from "../src/agent.ts";

const rows = [["DE", 2.4, 0.4], ["CA", 4.0, 2.2], ["AU", 3.4, 3.0]].flatMap(([country, prior, latest]) => [
  { country, concept: "food", category_label: "Food", frequency: "M", period: "2026-08", yoy_pct: prior, source_id: `${country}:food` },
  { country, concept: "food", category_label: "Food", frequency: "M", period: "2026-09", yoy_pct: latest, source_id: `${country}:food` },
]);
const brief = (req: Request, only?: string[]): any => {
  const facts = buildFacts(rows.filter((r) => !only || only.includes(String(r.country))), req, "Q1", req.passThrough ?? 1, new Date("2026-10-27"));
  return { request: req, facts, notes: [], passThrough: req.passThrough ?? 1, compared: { id: "Q1", sql: "", columns: [], rows: [], ms: 0 }, sqlLog: [], views: [], ms: 1, trace: [] };
};
const base: Request = { raw: "DE CA AU food +5%", countries: ["DE", "CA", "AU"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, passThrough: 0.7, unknownCountries: [] };

test("when no single change fits every benchmark, the line names the two markets that disagree and each market's top", () => {
  assert.equal(fitSummary(brief(base)), "No single change is within every market benchmark: the DE top (1.4%) is below the AU bottom (3.0%). Highest change within each: DE +1.4%, CA +3.1%, AU +3.2%.");
});

test("when the benchmarks overlap, the line gives the common range; one market or a missing market gives no line", () => {
  const two: Request = { ...base, countries: ["CA", "AU"] };
  assert.equal(fitSummary(brief(two, ["CA", "AU"])), "Within every market benchmark: +3.0% to +3.1%.");
  assert.equal(fitSummary(brief({ ...base, countries: ["DE"] }, ["DE"])), undefined);
  assert.equal(fitSummary(brief(base, ["CA", "AU"])), undefined, "DE has no benchmark, so 'every market' would be false");
  assert.equal(fitSummary(brief({ ...two, proposedChangePct: undefined }, ["CA", "AU"])), "Within every market benchmark: +3.0% to +3.1%.");
});

test("the brief and the result card show the line under How far", () => {
  const b = brief(base);
  const md = renderBrief(b).split("\n");
  const h = md.findIndex((l) => l.startsWith("How far:"));
  assert.match(md[h + 2], /^No single change is within every market benchmark/);
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  class El { innerHTML = ""; textContent = ""; className = ""; value = ""; disabled = false; scrollTop = 0; scrollHeight = 0; clientHeight = 0; children: El[] = []; appendChild(c: El) { this.children.push(c); } scrollIntoView() {} setAttribute() {} }
  const nodes = new Map<string, El>();
  const node = (q: string) => { if (!nodes.has(q)) nodes.set(q, new El()); return nodes.get(q)!; };
  const context = vm.createContext({ document: { querySelector: node, createElement: () => new El() }, fetch: async () => ({ json: async () => ({}) }), EventSource: class { addEventListener() {} close() {} }, setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} });
  for (const file of ["scenario.js", "preview-panel.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8"), context);
  vm.runInContext(script, context);
  (context as any).sample = { headline: "+5% is above the market benchmark in DE, CA and AU.", gap: "How far: x", fit: fitSummary(b), facts: [], notes: [], views: [], sql: [], skus: [], passThrough: 0.7, ms: 1000, markdown: "", concept: "food", requestedCountries: ["DE", "CA", "AU"], compared: { id: "Q1", sql: "", rows: [] } };
  vm.runInContext('render(sample,"q")', context);
  assert.match(node("#out").innerHTML, /<p class="gap">How far: x<\/p><p class="gap">No single change is within every market benchmark: the DE top \(1\.4%\) is below the AU bottom \(3\.0%\)\./);
});

test("the server sends the line with the result", () => {
  const server = fs.readFileSync(new URL("../src/result.ts", import.meta.url), "utf8");
  assert.match(server, /fit: b\.facts\.length \? fitSummary\(b\) \?\? null : null/);
});
