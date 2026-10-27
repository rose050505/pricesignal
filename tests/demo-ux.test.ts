// What a judge sees while the run is in progress and in the first seconds of the answer.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { renderBrief } from "../src/brief.ts";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/demo1-narrative-drafts.json", import.meta.url), "utf8"));

function browser() {
  class Element {
    innerHTML = ""; textContent = ""; className = ""; value = ""; disabled = false;
    scrollTop = 0; scrollHeight = 100; clientHeight = 100;
    children: Element[] = []; onclick?: () => Promise<void>;
    appendChild(child: Element) { this.children.push(child); }
    scrollIntoView() {}
    setAttribute() {}
  }
  const nodes = new Map<string, Element>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector)!; };
  const streams: any[] = [];
  class EventSource {
    listeners: Record<string, (message: { data: string }) => void> = {};
    onerror?: () => void; onopen?: () => void;
    constructor() { streams.push(this); }
    addEventListener(name: string, fn: (message: { data: string }) => void) { this.listeners[name] = fn; }
    close() {}
  }
  const context = vm.createContext({
    document: { querySelector: node, createElement: () => new Element() },
    fetch: async (url: string) => ({ json: async () => url === "/api/ask" ? { id: "offline-run" } : { state: "online", provider: "meterless", fast: "fake", zetaris: "online", memoryRecords: 0 } }),
    EventSource, setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {},
  });
  for (const file of ["scenario.js", "preview-panel.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8"), context);
  vm.runInContext(script, context);
  return { context, node, streams, run: (code: string) => vm.runInContext(code, context) };
}

const req = { raw: fx.question, countries: fx.requestedCountries, concept: fx.concept, conceptWords: [fx.concept], proposedChangePct: fx.proposed, passThrough: fx.passThrough, unknownCountries: [] };
const nemotron = { headline: "Food CPI cools in DE; Canada above benchmark; AU flat at 3.0%", markets: { DE: "German food CPI was 0.4% YoY in September 2026." } };
function resultWith(narrative: any) {
  const brief: any = { request: req, facts: fx.facts, notes: fx.notes, passThrough: fx.passThrough, compared: { id: "Q7", sql: "", columns: [], rows: [], ms: 0 }, sqlLog: [], views: [], ms: 39000, trace: [], narrative };
  return { facts: fx.facts, notes: fx.notes, views: [], sql: [], skus: [], passThrough: fx.passThrough, ms: 39000, compared: { id: "Q7", sql: "SELECT 1" }, markdown: renderBrief(brief), concept: "food", requestedCountries: ["DE", "CA", "AU"], proposed: 5, narrative, startedAt: "2026-10-27T00:29:57Z" };
}

test("the example questions step aside while a run is in progress, so the agent trace is in view", async () => {
  const b = browser(); b.node("#q").value = "food +5%";
  await b.node("#go").onclick!();
  assert.match(b.node("#examples").className, /running/);
  b.streams[0].listeners.result({ data: JSON.stringify(resultWith(null)) });
  assert.doesNotMatch(b.node("#examples").className, /running/);
});

test("only reusing remembered evidence is labelled as reuse; storing a new memory is not", async () => {
  const b = browser(); b.node("#q").value = "food +5%";
  await b.node("#go").onclick!();
  b.run('addTrace({kind:"discover",title:"Eurostat (HICP): 1 candidate(s) for \\"food\\""})');
  b.run('addTrace({kind:"memory",title:"stored mapping mem-2"})');
  assert.doesNotMatch(b.node("#runstatus").textContent, /Reusing remembered/);
  b.run('addTrace({kind:"memory",title:"reused mem-2: DE food -> psig.v_de_food (26 rows, latest 2026-09)"})');
  assert.match(b.node("#runstatus").textContent, /Reusing remembered/);
});

test("consecutive 'already in Zetaris' lines collapse into one counter line", async () => {
  const b = browser(); b.node("#q").value = "food +5%";
  await b.node("#go").onclick!();
  const trace = b.node("#trace");
  for (let i = 0; i < 3; i++) b.run(`addTrace({kind:"sql",title:"already in Zetaris (not created again): CREATE LIGHTNING REST TABLE t${i} FROM X REQUEST("})`);
  b.run('addTrace({kind:"compare",title:"federated query Q7 over 6 views -> 84 rows"})');
  b.run('addTrace({kind:"sql",title:"already in Zetaris (not created again): CREATE SCHEMASTORE VIEW v9 WITH CONTAINER psig AS"})');
  assert.equal(trace.children.length, 3);
  assert.match(trace.children[0].innerHTML, /3 Zetaris objects already existed/);
  assert.match(trace.children[1].innerHTML, /federated query Q7/);
  assert.match(trace.children[2].innerHTML, /1 Zetaris object already existed/);
});

test("the big headline answers the question in code; Nemotron's headline is quoted under it", () => {
  const md = resultWith(nemotron).markdown;
  assert.match(md, /^\*\*\+5% is above the market benchmark in DE, CA and AU\.\*\*$/m);
  assert.match(md, /^> Nemotron: Food CPI cools in DE; Canada above benchmark; AU flat at 3\.0%$/m);
  const b = browser();
  b.context.sample = resultWith(nemotron);
  b.run('render(sample,"demo question 1")');
  const out = b.node("#out").innerHTML;
  assert.match(out, /class="headline">\+5% is above the market benchmark in DE, CA and AU\./);
  assert.match(out, /Nemotron:.*Food CPI cools in DE; Canada above benchmark/);
});

test("the price preview is collapsed in place and hides the cost column when there is no cost target", () => {
  const b = browser();
  b.context.sample = resultWith(nemotron);
  b.run('render(sample,"demo question 1")');
  const out = b.node("#out").innerHTML;
  assert.match(out, /<details class="card preview" id="scenario-panel"><summary>/);
  assert.doesNotMatch(out, /Cost target \(unchanged\)/);
  assert.ok(out.indexOf('id="scenario-panel"') < out.indexOf('class="markets"'));
});

test("the planner's no-action reply reads as a retry, not a failure", () => {
  const src = fs.readFileSync(new URL("../src/agent.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /planner reply unusable/);
  assert.match(src, /planner reply had no action JSON/);
});

test("while waiting for numbers, the answer area shows the agent's steps filled from the trace", async () => {
  const b = browser(); b.node("#q").value = "food +5%";
  await b.node("#go").onclick!();
  const steps = [
    { kind: "llm", title: "parsed request (openrouter/nvidia/nemotron-3.5-lightning, 3831 ms via Meterless Nightshift)" },
    { kind: "request", title: 'markets DE, CA, AU | category "food" | proposed +5%' },
    { kind: "discover", title: 'Eurostat (HICP): 1 candidate(s) for "food"' },
    { kind: "discover", title: 'Statistics Canada (CPI): 1 candidate(s) for "food"' },
    { kind: "onboard", title: "onboarded eurostat CP01 -> psig.v_de_food (created 2 SQL objects; 0 already existed; verified: 26 rows, latest 2026-09)" },
    { kind: "memory", title: "reused mem-3: AU food -> psig.v_au_food (13 rows, latest 2026-08)" },
  ];
  for (const e of steps) b.run(`addTrace(${JSON.stringify(e)})`);
  let out = b.node("#out").innerHTML;
  assert.match(out, /markets DE, CA, AU \| category &quot;food&quot; \| proposed \+5%/);
  assert.match(out, /Nemotron/);
  assert.match(out, /Eurostat \(HICP\) · Statistics Canada \(CPI\)/);
  assert.match(out, /1 series registered and verified · 2 SQL objects created/);
  assert.match(out, /1 series recalled from H-MEM/);
  assert.doesNotMatch(out, /class="done"><b>✓ One federated SQL/);
  b.run('addTrace({kind:"compare",title:"federated query Q7 over 6 views -> 84 rows"})');
  out = b.node("#out").innerHTML;
  assert.match(out, /class="done"><b>✓ One federated SQL query across the agencies<\/b><div class="sub">federated query Q7 over 6 views -&gt; 84 rows/);
  // Market numbers replace the steps; later trace lines do not bring them back.
  b.streams[0].listeners.partial({ data: JSON.stringify({ ...resultWith(null), partial: true, partialStage: "markets" }) });
  b.run('addTrace({kind:"pricing",title:"the price list sells condiments"})');
  assert.doesNotMatch(b.node("#out").innerHTML, /class="steps"/);
});
