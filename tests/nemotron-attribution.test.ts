// Nemotron is credited on screen only for replies that a Nemotron model actually served and that the agent used
// (independent sponsor review, 27 Oct 12:55: a reply without JSON was logged as "parsed request" and credited).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";

process.env.PSIG_VERBOSE = "0";
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
function browser() {
  class Element { innerHTML = ""; textContent = ""; className = ""; value = ""; disabled = false; scrollTop = 0; scrollHeight = 100; clientHeight = 100; children: Element[] = []; onclick?: () => Promise<void>; appendChild(c: Element) { this.children.push(c); } scrollIntoView() {} setAttribute() {} }
  const nodes = new Map<string, Element>();
  const node = (s: string) => { if (!nodes.has(s)) nodes.set(s, new Element()); return nodes.get(s)!; };
  class EventSource { addEventListener() {} close() {} }
  const context = vm.createContext({ document: { querySelector: node, createElement: () => new Element() }, fetch: async (u: string) => ({ json: async () => u === "/api/ask" ? { id: "r" } : { state: "online" } }), EventSource, setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} });
  for (const f of ["scenario.js", "preview-panel.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8"), context);
  vm.runInContext(script, context);
  return { context, node, run: (c: string) => vm.runInContext(c, context) };
}

test("a parse reply without JSON is a warning that rules read the request, not a Nemotron parse", async () => {
  const agent = new PriceSignalAgent({ llm: async () => ({ text: "I cannot help with that.", model: "openrouter/nvidia/nemotron-3.5-lightning", provider: "meterless", ms: 5 }), sql: { run: async () => ({ id: "Q", sql: "", columns: [], rows: [], ms: 0 }) } as any, memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-attr-"))), hedgeMs: Infinity } as any);
  await (agent as any).parse("DE food +5%");
  assert.ok(!agent.trace.some((e) => /^parsed request/.test(e.title)));
  assert.ok(agent.trace.some((e) => e.kind === "warn" && /model reply had no usable JSON - the request was read by rules/.test(e.title)));
});

test("only replies served by a Nemotron model count toward the Nemotron line and the progress card", async () => {
  const b = browser(); b.node("#q").value = "food +5%";
  await b.node("#go").onclick!();
  b.run('addTrace({kind:"llm",title:"parsed request (some/other-model, 900 ms via Meterless Nightshift)"})');
  b.run('addTrace({kind:"llm",title:"SKU category selection (some/other-model, 800 ms via Meterless Nightshift) - accepted 4 of 4 product groups in one request"})');
  assert.doesNotMatch(b.node("#out").innerHTML, /Understand the question \(Nemotron\)/);
  assert.equal(b.run("nemoLine()"), "");
  b.run('addTrace({kind:"llm",title:"parsed request (openrouter/nvidia/nemotron-3.5-lightning, 2600 ms via Meterless Nightshift)"})');
  assert.match(b.node("#out").innerHTML, /Understand the question \(Nemotron\)/);
  assert.match(b.run("nemoLine()"), /read the request \(2\.6 s\)/);
});

test("the summary line names the model that wrote it", () => {
  const b = browser();
  const base = { headline: "x", facts: [{ country: "DE" }], notes: [], views: [], sql: [], skus: [], passThrough: 0.7, ms: 1000, markdown: "", concept: "food", requestedCountries: ["DE"], compared: { id: "Q1", sql: "", rows: [] } };
  b.context.sample = { ...base, narrative: { headline: "h", markets: { DE: "a." }, model: "openrouter/nvidia/nemotron-3.5-lightning" } };
  b.run('render(sample,"q")');
  assert.match(b.node("#out").innerHTML, /Summary written by NVIDIA Nemotron \(openrouter\/nvidia\/nemotron-3\.5-lightning\) via Meterless Nightshift/);
  b.context.sample = { ...base, narrative: { headline: "h", markets: { DE: "a." }, model: "some/other-model" } };
  b.run('render(sample,"q")');
  const out = b.node("#out").innerHTML;
  assert.match(out, /Summary written by some\/other-model via Meterless Nightshift/);
  assert.doesNotMatch(out, /Summary written by NVIDIA Nemotron/);
});
