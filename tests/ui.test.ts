import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];

function browser() {
  let pageScrolls = 0;
  class Element {
    innerHTML = ""; textContent = ""; className = ""; value = ""; disabled = false;
    scrollTop = 0; scrollHeight = 100; clientHeight = 100;
    children: Element[] = []; onclick?: () => Promise<void>;
    appendChild(child: Element) { this.children.push(child); this.scrollHeight += 40; }
    scrollIntoView() { pageScrolls++; }
    setAttribute() {}
  }
  const nodes = new Map<string, Element>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector)!; };
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const streams: any[] = [];
  class EventSource {
    onerror?: () => void; onopen?: () => void; onmessage?: (message: { data: string }) => void;
    listeners: Record<string, (message: { data: string }) => void> = {};
    closed = false;
    constructor() { streams.push(this); }
    addEventListener(name: string, fn: (message: { data: string }) => void) { this.listeners[name] = fn; }
    close() { this.closed = true; }
  }
  const context = vm.createContext({
    document: { querySelector: node, createElement: () => new Element() },
    fetch: async (url: string) => ({ json: async () => url === "/api/ask" ? { id: "offline-run" } : { state: "online", provider: "meterless", fast: "fake", zetaris: "online", memoryRecords: 0 } }),
    EventSource,
    setInterval: () => ++nextTimer, clearInterval: () => {},
    setTimeout: (fn: () => void) => { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  vm.runInContext(script, context);
  return { context, node, streams, timers, pageScrolls: () => pageScrolls, run: (code: string) => vm.runInContext(code, context) };
}

const result = (partial = false) => ({
  facts: [], notes: [], views: [], sql: [], skus: [], passThrough: 0.7, ms: 3200,
  compared: { id: "Q1", sql: "SELECT 1" }, markdown: "", partial, partialStage: "markets",
  metrics: { modelCalls: 2, plannerCalls: 0, discoveries: 0, reusedViews: 6, numbersMs: 2200 },
});

test("trace scrolling stays inside its panel and preserves a reader's earlier position", () => {
  const b = browser(); const trace = b.node("#trace");
  trace.scrollHeight = 500; trace.clientHeight = 100; trace.scrollTop = 400;
  b.run('addTrace({kind:"sql",title:"Q1: SELECT country FROM psig.view"})');
  assert.equal(b.pageScrolls(), 0, "trace events must not scroll the whole page");
  assert.ok(trace.scrollTop >= 440, "follow new events when already at the bottom");
  trace.scrollTop = 80;
  b.run('addTrace({kind:"sql",title:"Q2: SELECT country FROM psig.view"})');
  assert.equal(trace.scrollTop, 80, "keep a reader's position while they inspect earlier events");
});

test("negative ranges, proposal, and cost need occupy distinct positions on the chart", () => {
  const b = browser();
  const card = b.run('card({country:"DE",agency:"Eurostat",category:{label:"Food",latestYoy:-2,avg12:-1.5,latestPeriod:"2026-09",trend:"easing",points:[]},suggested:{low:-1.4,high:-1.05},costNeed:-0.7,costVsMarket:"ahead of the market",verdict:"below the evidence"},-2,null)') as string;
  const band = Number(card.match(/class="band" style="left:([\d.]+)/)![1]);
  const proposal = Number(card.match(/class="prop" style="left:([\d.]+)/)![1]);
  const cost = Number(card.match(/class="cost" style="left:([\d.]+)/)![1]);
  assert.ok(proposal < band && band < cost, "-2 < -1.4 < -0.7 must stay visually ordered");
  assert.ok(proposal > 0 && cost < 100, "negative values need visible padding inside the chart");
});

test("market partial explains the remaining work and reports measured run counters", () => {
  const b = browser();
  b.context.sample = result(true);
  b.run('render(sample,"food +3%")');
  const output = b.node("#out").innerHTML;
  assert.match(output, /Market numbers ready/i);
  assert.match(output, /SKU/i);
  assert.match(output, /2 model calls/);
  assert.match(output, /0 planner calls/);
  assert.match(output, /0 discoveries/);
  assert.match(output, /6 reused views/);
  assert.match(output, /first numbers.*2\.2 s/);
});

test("connection failure keeps partial figures and releases the form after bounded reconnect", async () => {
  const b = browser(); b.node("#q").value = "food +3%";
  await b.node("#go").onclick!();
  const stream = b.streams[0];
  stream.listeners.partial({ data: JSON.stringify(result(true)) });
  const figures = b.node("#out").innerHTML;
  assert.equal(typeof stream.onerror, "function", "SSE errors need a recovery handler");
  stream.onerror();
  assert.match(b.node("#runstatus").textContent, /reconnect/i);
  assert.equal(b.node("#go").disabled, true, "allow automatic reconnect before offering another run");
  assert.equal(b.timers.size, 1);
  for (const callback of [...b.timers.values()]) callback();
  assert.equal(stream.closed, true);
  assert.equal(b.node("#go").disabled, false);
  assert.equal(b.node("#out").innerHTML, figures, "connection loss must not erase available evidence");
  assert.match(b.node("#runstatus").textContent, /connection/i);
});

test("a reconnected stream clears the disconnect timeout and completes normally", async () => {
  const b = browser(); b.node("#q").value = "food +3%";
  await b.node("#go").onclick!();
  const stream = b.streams[0];
  assert.equal(typeof stream.onerror, "function");
  stream.onerror(); stream.onopen();
  assert.equal(b.timers.size, 0);
  stream.listeners.result({ data: JSON.stringify(result()) });
  assert.equal(b.node("#go").disabled, false);
  assert.equal(stream.closed, true);
  assert.match(b.node("#runstatus").textContent, /complete/i);
});

test("replaying trace history after reconnect does not duplicate visible events", () => {
  const b = browser();
  b.run('addTrace({t:10,kind:"sql",title:"Q1: SELECT 1"}); addTrace({t:10,kind:"sql",title:"Q1: SELECT 1"}); addTrace({t:11,kind:"sql",title:"Q1: SELECT 1"})');
  assert.equal(b.node("#trace").children.length, 2, "one replayed event is ignored, a later event remains visible");
});

test("negative SKU price ranges do not gain a contradictory plus sign", () => {
  const b = browser();
  b.context.sample = { ...result(), skus: [{ sku: "TEST", product: "Food", country: "DE", currentPrice: 10, currency: "EUR", low: 9.86, high: 9.9, rangeLow: -1.4, rangeHigh: -1, yoy: -2, period: "2026-09" }] };
  b.run('render(sample,"food -2%")');
  assert.doesNotMatch(b.node("#out").innerHTML, /\+-1\.4/);
  assert.match(b.node("#out").innerHTML, /-1\.4–-1\.0%/);
});

test("a pricing partial with no SKU rows never claims SKU prices are ready", () => {
  const b = browser(); b.context.sample = { ...result(true), partialStage: "pricing" };
  b.run('render(sample,"food +3%")');
  assert.doesNotMatch(b.node("#out").innerHTML, /SKU prices ready/);
});
