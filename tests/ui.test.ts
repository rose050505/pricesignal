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
    children: Element[] = []; onclick?: () => Promise<void>; oninput?: () => void;
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
  for (const file of ["scenario.js", "preview-panel.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8"), context);
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

test('SKU choices distinguish a model match, remembered match and an unconfirmed Food fallback', () => {
  const b=browser();
  const sku={sku:'CHIPS',product:'Honey butter chips',country:'DE',currentPrice:3,currency:'EUR',yoy:1,period:'2026-09',rateLabel:'Food',coarser:true,selectionFit:'broader',selectionReason:'<unsafe> broader product coverage'};
  for (const [source,label] of [['model','Model-selected'],['memory','Remembered match'],['fallback','Unconfirmed match']] as const) {
    b.context.sample={...result(),skus:[{...sku,selectionSource:source}]};
    b.run('render(sample,"chips +3%")');
    const html=b.node('#out').innerHTML;
    assert.ok(html.includes(label),html);
    assert.match(html,/Broader proxy/);
    assert.match(html,/&lt;unsafe&gt;/);
    assert.doesNotMatch(html,/<unsafe>/);
  }
});

test('evidence distinguishes the market comparison from the SKU rate query',()=>{
  const b=browser();
  b.context.sample={...result(),facts:[{country:'DE',agency:'Eurostat',category:{label:'Food',latestYoy:1,avg12:1,latestPeriod:'2026-09',trend:'steady',points:[]}}],pricing:{id:'Q2',sql:'SELECT sku_fixture'}};
  b.run('render(sample,"food")');
  const output=b.node('#out').innerHTML;
  assert.doesNotMatch(output,/Every rate above comes from/);
  assert.match(output,/Market rates[\s\S]*?<b>Q1<\/b>/);
  assert.match(output,/SKU rates[\s\S]*?<b>Q2<\/b>/);
});

test('a cost rise without a cost share asks for the missing denominator and supplies no price target',()=>{
  const b=browser();b.context.sample={...result(),cost:8};
  b.run('render(sample,"costs rose 8%")');
  const output=b.node('#out').innerHTML;
  assert.match(output,/cost share/i);
  assert.match(output,/needed|provide|add/i);
  assert.doesNotMatch(output,/5\.6%|of category inflation/);
});

test('cost recovery uses the stated cost share while the market card is a historical benchmark',()=>{
  const b=browser();
  const fact={country:'DE',agency:'Eurostat',category:{label:'Food',latestYoy:2,avg12:2,latestPeriod:'2026-09',trend:'insufficient history',points:[],averageCount:1,averageExpected:12,averageLabel:'1 of 12 monthly observations'},suggested:{low:2,high:2},costNeed:3.4,costVsMarket:'above the market benchmark'};
  b.context.sample={...result(),cost:8,costShare:60,facts:[fact]};
  b.run('render(sample,"cost share 60%, costs rose 8%")');
  const output=b.node('#out').innerHTML;
  assert.match(output,/cost share.*60%/i);
  assert.match(output,/cost.recovery target.*3\.4%/i);
  assert.match(output,/benchmark point.*2\.0%/i);
  assert.match(output,/1 of 12 monthly observations/);
  assert.doesNotMatch(output,/12-period avg|suggested range|your costs call for|pass-through of this inflation/i);
});

test('quarterly coverage is labelled by observed quarters and SKU prices are scenarios',()=>{
  const b=browser();
  b.context.sample={...result(),facts:[{country:'AU',agency:'ABS',category:{label:'Food',frequency:'Q',latestYoy:2,avg12:2,latestPeriod:'2026-Q3',trend:'flat',points:[],averageLabel:'4 of 4 quarterly observations'}}],skus:[{sku:'X',product:'Food',country:'AU',currentPrice:1,currency:'AUD',yoy:2,period:'2026-Q3'}]};
  b.run('render(sample,"AU food")');
  const output=b.node('#out').innerHTML;
  assert.match(output,/4 of 4 quarterly observations/);
  assert.match(output,/Benchmark price scenario/);
  assert.doesNotMatch(output,/Suggested new price|12-period avg/);
});

test('an invalid cost pass-through is not displayed as a valid default or remembered policy',()=>{
  const b=browser();b.context.sample={...result(),cost:8,costShare:60,invalidPassThrough:true,passThrough:1};
  b.run('render(sample,"pass on 150%")');
  const output=b.node('#out').innerHTML;
  assert.match(output,/invalid.*cost target omitted/i);
  assert.doesNotMatch(output,/pass through 100%/i);
});

test('the interpreted category is visible separately from the official series label', () => {
  const b = browser();
  b.context.sample = { ...result(true), concept: 'condiments' };
  b.run('render(sample,"same as last time, but condiments")');
  assert.match(b.node('#out').innerHTML, /Interpreted market category:.*Condiments/);
  b.context.sample = { ...result(), concept: '<script>fake</script>' };
  b.run('render(sample,"category")');
  assert.doesNotMatch(b.node('#out').innerHTML, /<script>fake<\/script>/);
});

const alignment = () => ({
  status: 'aligned', concept: 'food', requestedCountries: ['DE', 'CA', 'AU'],
  period: '2026-08', frequency: 'M', monthsOld: 2, cite: 'Q7',
  note: 'Observation dates align; country baskets and category coverage can differ.',
  rows: [
    { country: 'DE', label: 'Food', sourceId: 'eurostat:food', yoy: 0.2, latestPeriod: '2026-09', latestYoy: 0.4 },
    { country: 'CA', label: 'Food', sourceId: 'statcan:food', yoy: 2.85, latestPeriod: '2026-09', latestYoy: 2.2 },
    { country: 'AU', label: 'Food and non-alcoholic beverages', sourceId: 'abs:food', yoy: 2.98, latestPeriod: '2026-08', latestYoy: 2.98 },
  ],
});

test('same-period comparison appears below market cards in partial and final results without replacing the latest figures', () => {
  for (const partial of [true, false]) {
    const b = browser();
    const fact = { country: 'CA', agency: 'StatCan', category: { label: 'Food', latestYoy: 2.2, avg12: 2.4, latestPeriod: '2026-09', trend: 'easing', points: [] } };
    b.context.sample = { ...result(partial), facts: [fact], alignment: alignment() };
    b.run('render(sample,"DE CA AU food")');
    const output = b.node('#out').innerHTML;
    assert.match(output, /Same-period market comparison/);
    assert.ok(output.indexOf('class="markets"') < output.indexOf('Same-period market comparison'));
    assert.match(output, /Common month[\s\S]*2026-08/);
    assert.match(output, /2 months old/);
    assert.match(output, /Food and non-alcoholic beverages/);
    assert.match(output, /2\.9%/);
    assert.match(output, /3\.0%/);
    assert.match(output, /2026-09/);
    assert.match(output, /2\.2%/);
    assert.match(output, /statcan:food/);
    assert.match(output, /Q7/);
    assert.match(output, /baskets.*category coverage/i);
    assert.match(output, /latest evidence/i);
    assert.equal(fact.category.latestYoy, 2.2);
    assert.equal(fact.category.latestPeriod, '2026-09');
  }
});

test('same-period comparison renders quarterly periods and escapes every server-supplied label and citation', () => {
  const b = browser();
  b.context.sample = { ...result(), alignment: { ...alignment(),
    concept: '<concept>', period: '2026-Q2', frequency: 'Q', monthsOld: 4, cite: '<Q7>', note: '<note>',
    requestedCountries: ['<DE>', 'CA'],
    rows: [{ country: '<DE>', label: '<official>', sourceId: '<source>', yoy: -0.25, latestPeriod: '<latest>', latestYoy: -0.1 }],
  } };
  b.run('render(sample,"quarterly food")');
  const output = b.node('#out').innerHTML;
  assert.match(output, /Common quarter[\s\S]*2026-Q2/);
  assert.match(output, /4 months old/);
  for (const text of ['concept', 'DE', 'official', 'source', 'latest', 'Q7', 'note']) {
    assert.ok(output.includes(`&lt;${text}&gt;`), text);
    assert.ok(!output.includes(`<${text}>`), text);
  }
  assert.match(output, /-0\.3%/);
  assert.doesNotMatch(output, /\+-0\.3/);
});

test('common-period raw rates use the same positive and negative tie rounding as latest cards and Markdown', () => {
  for (const [raw, rounded, text] of [[2.55, 2.6, '+2.6%'], [-2.25, -2.3, '-2.3%'], [0.04, 0, '0.0%'], [-0.04, 0, '0.0%']] as const) {
    const b = browser();
    const row = { country: 'CA', label: 'Food', sourceId: 'statcan:food', yoy: raw, latestPeriod: '2026-08', latestYoy: rounded };
    b.context.sample = { ...result(), alignment: { ...alignment(), rows: [row] } };
    b.run('render(sample,"food")');
    const output = b.node('#out').innerHTML;
    assert.ok(output.includes(`<td class="num">${text}</td>`), `common rate ${raw} must display ${text}`);
    assert.ok(output.includes(`<div class="sub">${text} YoY</div>`), 'latest and common displays must agree for the same observation');
  }
});

test('unavailable common periods show the supplied reason and never invent a table or infer one from market facts', () => {
  const b = browser();
  b.context.sample = { ...result(true), alignment: { status: 'unavailable', concept: 'food', requestedCountries: ['DE', 'AU'], reason: 'Monthly and quarterly observations cannot be aligned <reason>.', cite: 'Q8' } };
  b.run('render(sample,"DE AU food")');
  const output = b.node('#out').innerHTML;
  assert.match(output, /Same-period market comparison/);
  assert.match(output, /unavailable/i);
  assert.match(output, /Monthly and quarterly observations cannot be aligned &lt;reason&gt;/);
  assert.match(output, /Q8/);
  assert.doesNotMatch(output, /class="alignment-table"|<reason>/);
  for (const value of [undefined, null, { ...alignment(), requestedCountries: ['CA'] }]) {
    b.context.sample = { ...result(), alignment: value };
    b.run('render(sample,"CA food")');
    assert.doesNotMatch(b.node('#out').innerHTML, /Same-period market comparison/);
  }
});

test('the comparison table has its own horizontal scroll region for narrow screens', () => {
  assert.match(html, /\.alignment-scroll\s*\{[^}]*overflow-x\s*:\s*auto/);
  const b = browser(); b.context.sample = { ...result(), alignment: alignment() };
  b.run('render(sample,"food")');
  assert.match(b.node('#out').innerHTML, /class="alignment-scroll"[^>]*tabindex="0"[^>]*>[\s\S]*class="alignment-table"/);
});

test('the shared server serializer preserves alignment in partial and final payloads and uses null when absent', () => {
  // Execute the actual serializer body without starting the server, loading env,
  // opening memory, or contacting any service.
  const server = fs.readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  const body = server.match(/function toResult\(b: Brief\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body);
  const serialize = vm.runInNewContext(`(function(b) { ${body} })`, { COMPARE_COLUMNS: [] });
  const base = { ...result(), request: {}, sqlLog: [] };
  const expected = alignment();
  for (const partialStage of ['markets', 'pricing', undefined]) {
    assert.equal(serialize({ ...base, partialStage, alignment: expected }).alignment, expected);
  }
  assert.equal(serialize(base).alignment, null);
});

const coveredMarket = (country: string, concept = 'food') => ({
  country, agency: 'Official statistics',
  [concept === 'all_items' ? 'allItems' : 'category']: { concept, label: concept === 'all_items' ? 'All items' : 'Food', sourceId: `fixture:${country}:${concept}`, frequency: 'M', latestYoy: 2, avg12: 2, latestPeriod: '2026-09', trend: 'flat', points: [] },
});

test('coverage counts requested category evidence, excludes SKU rows, and includes unsupported markets in its denominator', () => {
  const b = browser();
  b.context.sample = { ...result(true), concept: 'food', requestedCountries: ['DE', 'CA'], unsupportedCountries: ['<Japan>'],
    facts: [coveredMarket('DE'), coveredMarket('CA', 'all_items')],
    skus: [{ country: 'CA', sku: 'SKU', product: 'Food', currentPrice: 10, currency: 'CAD', yoy: 2, period: '2026-09' }],
  };
  b.run('render(sample,"DE CA Japan food")');
  const output = b.node('#out').innerHTML;
  assert.match(output, /Partial coverage[^<]*1\/3/i);
  assert.ok(output.indexOf('Partial coverage') < output.indexOf('class="markets"'));
  assert.match(output, /CA[^<]*food[^<]*all.items/i);
  assert.match(output, /Unsupported markets:[^<]*&lt;Japan&gt;/i);
  assert.doesNotMatch(output, /<Japan>/);
});

test('coverage distinguishes all, partial and no requested-category evidence including old payloads', () => {
  const b = browser();
  for (const [facts, expected] of [
    [[coveredMarket('DE'), coveredMarket('CA')], /All requested markets covered[^<]*2\/2/i],
    [[coveredMarket('DE')], /Partial coverage[^<]*1\/2/i],
    [[coveredMarket('DE', 'all_items')], /No requested.market evidence[^<]*0\/2/i],
  ] as const) {
    b.context.sample = { ...result(), concept: 'food', requestedCountries: ['DE', 'CA'], facts };
    b.run('render(sample,"DE CA food")');
    assert.match(b.node('#out').innerHTML, expected);
  }
  b.context.sample = { ...result(), concept: 'food', facts: [coveredMarket('DE'), coveredMarket('CA')] };
  b.run('render(sample,"legacy fixture")');
  assert.match(b.node('#out').innerHTML, /All requested markets covered[^<]*2\/2/i);
});

test('the final run status reports partial or absent coverage instead of implying every requested market succeeded', async () => {
  for (const [facts, expected] of [[[coveredMarket('DE')], /partial coverage.*1\/2/i], [[], /no requested.market evidence.*0\/2/i]] as const) {
    const b = browser(); b.node('#q').value = 'DE CA food';
    await b.node('#go').onclick!();
    b.streams[0].listeners.result({ data: JSON.stringify({ ...result(), concept: 'food', requestedCountries: ['DE', 'CA'], facts }) });
    assert.match(b.node('#runstatus').textContent, expected);
    assert.equal(b.pageScrolls(), 0);
  }
});

test('model badges accept only successful response events and ignore model names inside errors or warnings', () => {
  const b = browser();
  for (const event of [
    { kind: 'error', title: 'warn_empty_response from nvidia/nemotron-failed' },
    { kind: 'warn', title: 'narrative (nvidia/nemotron-warn, 12 ms via Meterless Nightshift)' },
    { kind: 'llm', title: 'warn_empty_response (nvidia/nemotron-empty, 12 ms via Meterless Nightshift)' },
    { kind: 'llm', title: 'starting request for nvidia/nemotron-pending' },
  ]) {
    b.context.event = event; b.run('addTrace(event)');
    assert.equal(b.run('servedModel'), null, event.title);
  }
  b.run('addTrace({kind:"llm",title:"parsed request (nvidia/nemotron-good, 125 ms via Meterless Nightshift)"})');
  const accepted = b.node('#modelpill').textContent;
  assert.match(accepted, /nvidia\/nemotron-good/);
  b.run('addTrace({kind:"error",title:"provider failed for nvidia/nemotron-failed"})');
  assert.equal(b.node('#modelpill').textContent, accepted);
});

test('a structured successful response reports its actual model and provider', () => {
  const b = browser();
  b.run('addTrace({kind:"llm",title:"Model reply received",detail:{status:"success",model:"nvidia/nemotron-structured",provider:"fixture-provider",ms:25}})');
  assert.match(b.node('#modelpill').textContent, /nvidia\/nemotron-structured/);
  assert.match(b.node('#modelpill').textContent, /fixture-provider/);
  b.run('addTrace({kind:"llm",title:"Model reply failed",detail:{status:"error",model:"nvidia/nemotron-failed",provider:"fixture-provider",ms:25}})');
  assert.doesNotMatch(b.node('#modelpill').textContent, /nemotron-failed/);
});

test('a new run resets the previous served model to pending until a new successful response arrives', async () => {
  const b = browser();
  b.run('addTrace({kind:"llm",title:"narrative (nvidia/nemotron-previous, 25 ms via Meterless Nightshift) - numbers and verdicts match the facts"})');
  assert.match(b.node('#modelpill').textContent, /nemotron-previous/);
  b.node('#q').value = 'DE food'; await b.node('#go').onclick!();
  assert.equal(b.run('servedModel'), null);
  assert.match(b.node('#modelpill').textContent, /awaiting.*successful response/i);
  await b.run('status()');
  assert.match(b.node('#modelpill').textContent, /awaiting.*successful response/i);
  b.streams[0].listeners.result({ data: JSON.stringify(result()) });
  assert.match(b.node('#modelpill').textContent, /no successful response/i);
});

test('SKU tables scroll internally and a manual results link does not scroll the page on render', () => {
  assert.match(html, /\.sku-scroll\s*\{[^}]*overflow-x\s*:\s*auto/);
  assert.match(html, /header\s*\{[^}]*flex-wrap\s*:\s*wrap/);
  assert.match(html, /\.pill\s*\{[^}]*white-space\s*:\s*normal/);
  assert.match(html, /href="#out"/);
  const b = browser();
  b.context.sample = { ...result(), skus: [{ country: 'DE', sku: 'SKU', product: 'Food', currentPrice: 10, currency: 'EUR', yoy: 2, period: '2026-09' }] };
  b.run('render(sample,"food")');
  assert.match(b.node('#out').innerHTML, /class="sku-scroll"[^>]*tabindex="0"[^>]*>[\s\S]*<table class="skus"/);
  assert.equal(b.pageScrolls(), 0);
});

test('a completed brief connects the separate local preview and a new run removes that preview', async () => {
  const b=browser();
  b.context.sample={...result(),concept:'food',proposed:5,startedAt:'2026-10-26T17:30:00.000Z',facts:[{country:'DE',agency:'Eurostat',cite:'Q7',category:{concept:'food',label:'Food',frequency:'M',latestPeriod:'2026-09',sourceId:'de:food',latestYoy:0.4,avg12:1.4,trend:'easing',points:[]},suggested:{low:0.4,high:1.4},costNeed:3.4,verdict:'above the market benchmark'}]};
  b.run('render(sample,"food +5%")');
  const original=b.node('#out').innerHTML;
  assert.match(original,/id="scenario-proposal"/);
  assert.match(original,/Original brief/);
  assert.equal(typeof b.node('#scenario-proposal').oninput,'function');
  b.node('#scenario-proposal').value='-2'; b.node('#scenario-proposal').oninput!();
  assert.match(b.node('#scenario-results').innerHTML,/Preview at -2%/);
  assert.match(b.node('#scenario-results').innerHTML,/below the market benchmark/);
  assert.match(b.node('#scenario-results').innerHTML,/3\.4%/);
  assert.equal(b.node('#out').innerHTML,original,'updating the preview must not re-render the original brief');
  b.node('#q').value='same as last time, +3%'; await b.node('#go').onclick!();
  assert.doesNotMatch(b.node('#out').innerHTML,/id="scenario-proposal"/);
});
