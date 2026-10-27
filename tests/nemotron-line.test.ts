// The Nemotron prize asks for real work: the result shows, from this run's trace, what Nemotron did.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function browser() {
  class El { innerHTML = ""; textContent = ""; className = ""; value = ""; disabled = false; scrollTop = 0; scrollHeight = 0; clientHeight = 0; children: El[] = []; onclick?: () => Promise<void>; appendChild(c: El) { this.children.push(c); } scrollIntoView() {} setAttribute() {} }
  const nodes = new Map<string, El>();
  const node = (q: string) => { if (!nodes.has(q)) nodes.set(q, new El()); return nodes.get(q)!; };
  const streams: any[] = [];
  class EventSource { listeners: Record<string, (m: { data: string }) => void> = {}; constructor() { streams.push(this); } addEventListener(n: string, f: any) { this.listeners[n] = f; } close() {} }
  const context = vm.createContext({ document: { querySelector: node, createElement: () => new El() }, fetch: async (u: string) => ({ json: async () => (u === "/api/ask" ? { id: "x" } : {}) }), EventSource, setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} });
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  for (const file of ["scenario.js", "preview-panel.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8"), context);
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], context);
  return { node, streams, run: (c: string) => vm.runInContext(c, context) };
}
const result = { facts: [], notes: [], views: [], sql: [], skus: [], passThrough: 0.7, ms: 25000, compared: { id: "Q7", sql: "SELECT 1" }, markdown: "**+5% is above the market benchmark in DE.**", concept: "food", requestedCountries: ["DE"], proposed: 5, narrative: { headline: "x", markets: {} } };

test("the result names what Nemotron did in this run, taken from the live trace", async () => {
  const b = browser(); b.node("#q").value = "food +5%";
  await b.node("#go").onclick!();
  for (const e of [
    { kind: "llm", title: "parsed request (openrouter/nvidia/nemotron-3.5-lightning, 2566 ms via Meterless Nightshift)" },
    { kind: "plan", title: 'discover_and_onboard {"country":"DE","concept":"food"}  [openrouter/nvidia/nemotron-3.5-lightning via Meterless Nightshift]' },
    { kind: "plan", title: "all markets compared - finishing without another planner turn" },
    { kind: "llm", title: "narrative (openrouter/nvidia/nemotron-3.5-lightning, 2830 ms via Meterless Nightshift) - numbers and verdicts match the facts" },
    { kind: "llm", title: "SKU category selection (openrouter/nvidia/nemotron-3.5-lightning, 2192 ms via Meterless Nightshift) - accepted 4 of 4 product groups in one request" },
  ]) b.run(`addTrace(${JSON.stringify(e)})`);
  b.streams[0].listeners.result({ data: JSON.stringify(result) });
  const out = b.node("#out").innerHTML;
  assert.match(out, /NVIDIA Nemotron in this run: read the request \(2\.6 s\) · planned 1 turn · chose official categories for 4 of 4 product groups \(2\.2 s\) · wrote the summary \(2\.8 s, every sentence passed the check\)/);
});

test("a salvaged summary and a failed selection are stated as they happened", async () => {
  const b = browser(); b.node("#q").value = "food +5%";
  await b.node("#go").onclick!();
  for (const e of [
    { kind: "warn", title: "SKU category selection unavailable or invalid - using marked Food fallbacks where available (Error: HTTP 502)" },
    { kind: "llm", title: "narrative (openrouter/nvidia/nemotron-3.5-lightning, 11019 ms via Meterless Nightshift) - does not match the facts: x" },
    { kind: "llm", title: "narrative kept: the fact check removed 1 sentence that contradicted the computed facts (headline computed in code)" },
  ]) b.run(`addTrace(${JSON.stringify(e)})`);
  b.streams[0].listeners.result({ data: JSON.stringify(result) });
  const out = b.node("#out").innerHTML;
  assert.match(out, /wrote the summary \(11\.0 s, 1 sentence removed by the check\)/);
  assert.match(out, /product categories: not available this run/);
  assert.doesNotMatch(out, /read the request/);
});

test("an offline render without trace events shows no Nemotron line", () => {
  const b = browser();
  b.run(`render(${JSON.stringify(result)},"q")`);
  assert.doesNotMatch(b.node("#out").innerHTML, /NVIDIA Nemotron in this run/);
});

test("a draft the check rejected before the rewrite passed is not hidden (QA, 28 Oct 00:15)", async () => {
  const b = browser(); b.node("#q").value = "food +5%";
  await b.node("#go").onclick!();
  for (const e of [
    { kind: "llm", title: "narrative (nvidia/nemotron-3.5-lightning-30b-a3b, 7580 ms via Meterless Nightshift) - does not match the facts: headline: says inflation itself is above the market benchmark; the verdict is about the proposed change" },
    { kind: "llm", title: "narrative (nvidia/nemotron-3.5-lightning-30b-a3b, 4120 ms via Meterless Nightshift) - numbers and verdicts match the facts" },
  ]) b.run(`addTrace(${JSON.stringify(e)})`);
  b.streams[0].listeners.result({ data: JSON.stringify(result) });
  const out = b.node("#out").innerHTML;
  assert.match(out, /wrote the summary \(11\.7 s over 2 replies: the check rejected the first draft, then the rewrite passed\)/);
  assert.doesNotMatch(out, /every sentence passed the check/);
});

test("the live trace leaves out the run's Zetaris suffix; the status endpoint names it", () => {
  const b = browser();
  b.run('runSuffix="ex20261027_235644_2343121"');
  b.run(`addTrace(${JSON.stringify({ kind: "onboard", title: "onboarded bls CUUR0000SAF1 -> psig.v_us_food_cuur0000saf1_yoyv2_ex20261027_235644_2343121 (verified: 20 rows)" })})`);
  const row = b.node("#trace").children.at(-1)!.innerHTML;
  assert.match(row, /psig\.v_us_food_cuur0000saf1_yoyv2 \(verified: 20 rows\)/);
  assert.doesNotMatch(row, /ex20261027/);
  const server = fs.readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(server, /namespace: zetarisSuffix\(\)/);
});
