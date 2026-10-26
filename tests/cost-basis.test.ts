import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildFacts, costInputNeeded, factsForNarrative, renderBrief, type Brief } from "../src/brief.ts";
import { buildAlignment } from "../src/alignment.ts";
import { AgentMemory } from "../src/memory.ts";
import { HMEM } from "../src/hmem_impl.ts";
import { exportEvidence, verifyEvidence } from "../src/evidence.ts";
import { COMPARE_COLUMNS } from "../src/sources/index.ts";

const now = new Date("2026-10-27T00:00:00.000Z");
function fixture(basis?: string, change = 8, share = 60, policy = 0.7): Brief {
  const request: any = { raw: "DE food; cost scenario", countries: ["DE"], concept: "food", conceptWords: ["food"], unknownCountries: [], costIncreasePct: change, costSharePct: share, passThrough: policy, ...(basis ? { costShareBasis: basis } : {}) };
  const rows = [{ country: "DE", concept: "food", category_label: "Food", frequency: "M", period: "2026-09", yoy_pct: 3.2, source_id: "official:food" }];
  const compared = { id: "Q1", sql: "SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM fixture", columns: [...COMPARE_COLUMNS], rows: rows.map(r => COMPARE_COLUMNS.map(c => r[c as keyof typeof r])), ms: 0 };
  const facts = buildFacts(rows, request, "Q1", policy, now);
  return { request, passThrough: policy, calculatedAt: now.toISOString(), facts, alignment: buildAlignment(rows, request, facts, "Q1", now), compared, skus: [], views: [], notes: [], trace: [], sqlLog: [compared], ms: 0 };
}

test("before-change and after-change cost shares use different denominators without changing the market", () => {
  const before = fixture("before_change"), after = fixture("after_change"), assumed = fixture();
  assert.equal(before.facts[0].costNeed, 3.4);
  assert.equal(assumed.facts[0].costNeed, 3.4);
  assert.equal(after.facts[0].costNeed, 3.1, "current cost 60 was 60/1.08 before the 8% rise; 70% of the difference is 3.1111");
  assert.equal(before.facts[0].costVsMarket, "above the market benchmark");
  assert.equal(after.facts[0].costVsMarket, "below the market benchmark");
  assert.deepEqual(before.facts[0].suggested, after.facts[0].suggested);
});

test("cost decreases, zero costs and non-invertible or invalid changes are explicit", () => {
  assert.equal(fixture("before_change", -20).facts[0].costNeed, -8.4);
  assert.equal(fixture("after_change", -20).facts[0].costNeed, -10.5);
  for (const basis of ["before_change", "after_change"]) {
    assert.equal(fixture(basis, 0).facts[0].costNeed, 0);
    assert.equal(fixture(basis, 8, 0).facts[0].costNeed, 0);
    for (const change of [-101, NaN, Infinity, -Infinity]) assert.equal(fixture(basis, change).facts[0].costNeed, undefined, `${basis}: ${change}`);
  }
  assert.equal(fixture("before_change", -100).facts[0].costNeed, -42);
  assert.equal(fixture("after_change", -100).facts[0].costNeed, undefined);
  assert.equal(fixture("after_change", -100, 0).facts[0].costNeed, undefined);
  assert.equal(fixture("before_change", Number.MAX_VALUE).facts[0].costNeed, undefined, "rounding must not produce an infinite target");
});

test("a recovery scenario implying negative selling prices is omitted, while exactly zero price is allowed", () => {
  const invalid = fixture("after_change", -90);
  assert.equal(invalid.facts[0].costNeed, undefined, "recovering 70% of a 540-unit saving from a 100-unit price would need -378%");
  assert.match(renderBrief(invalid), /negative selling price/i);
  assert.equal(fixture("after_change", -50, 100, 1).facts[0].costNeed, -100);
});

test("roundoff cannot turn an exact zero-price recovery scenario into a negative-price error", () => {
  const exact = fixture("after_change", -80, 25, 1);
  // Price 100, costs now 25 and previously 125: passing on the 100-unit saving leaves price zero.
  assert.equal(exact.facts[0].costNeed, -100);
  assert.equal(costInputNeeded(exact.request, 1), undefined);
  assert.equal(fixture("after_change", -80, 25.000001, 1).facts[0].costNeed, undefined, "a genuinely excessive reduction is still rejected");
});

test("Markdown and model facts state the cost basis, its assumption and specific missing input", () => {
  for (const [basis, phrase] of [["before_change", /before the stated cost change/i], ["after_change", /after the stated cost change/i], [undefined, /before the stated cost change.*assum/i]] as const) {
    const b = fixture(basis), md = renderBrief(b), n: any = factsForNarrative(b.facts, b.request, b.passThrough)[0];
    assert.match(md, phrase);
    assert.match(n.cost_share_basis, phrase);
    assert.match(md, /unchanged selling price/i);
    assert.doesNotMatch(md, /Current unit cost is/);
  }
  const invalid = fixture("after_change", -100);
  assert.match(renderBrief(invalid), /before.*cost.*change.*100%|100%.*before.*cost.*change/i);
  const n: any = factsForNarrative(invalid.facts, invalid.request, invalid.passThrough)[0];
  assert.equal(n.cost_need_pct, undefined);
  assert.match(n.cost_input_needed, /before.*cost.*change/i);
});

test("H-MEM stores the cost-share basis with the remembered denominator and retains legacy absence", () => {
  const m: AgentMemory = Object.create(AgentMemory.prototype); (m as any).hmem = new HMEM();
  m.rememberRequest(fixture("after_change").request);
  assert.equal((m.lastRequest()!.request as any).costShareBasis, "after_change");
  m.rememberRequest(fixture().request);
  assert.equal((m.lastRequest()!.request as any).costShareBasis, undefined);
});

test("evidence preserves and checks the declared basis while old saved runs retain their prior arithmetic", () => {
  const b = fixture("after_change"), e = exportEvidence(b);
  assert.equal((e.request as any).costShareBasis, "after_change");
  assert.equal(verifyEvidence(JSON.parse(JSON.stringify(e))).ok, true);
  (e.request as any).costShareBasis = "before_change";
  assert.equal(verifyEvidence(e).ok, false, "changing basis without changing the computed target is detected");
  (e.request as any).costShareBasis = "unknown";
  assert.equal(verifyEvidence(e).ok, false);
  for (const dir of fs.readdirSync(new URL("../examples/", import.meta.url)).filter(s => /^\d/.test(s))) {
    const saved = JSON.parse(fs.readFileSync(new URL(`../examples/${dir}/evidence.json`, import.meta.url), "utf8"));
    assert.equal(saved.request.costShareBasis, undefined);
    const v = verifyEvidence(saved); assert.equal(v.ok, true, `${dir}: ${v.errors.join("; ")}`);
  }
});

for (const field of ["costIncreasePct", "proposedChangePct"] as const) {
  test(`evidence rejects ${field} below -100 even if the included outputs agree with it`, () => {
    const b = fixture("before_change"); b.request[field] = -101;
    const rows = b.compared.rows.map(r => Object.fromEntries(COMPARE_COLUMNS.map((name, i) => [name, r[i]])));
    b.facts = buildFacts(rows, b.request, b.compared.id, b.passThrough, now);
    b.alignment = buildAlignment(rows, b.request, b.facts, b.compared.id, now);
    assert.equal(verifyEvidence(exportEvidence(b)).ok, false, `${field} below -100 is invalid even when arithmetic is consistent`);
    assert.equal(verifyEvidence(exportEvidence(fixture("before_change", -100))).ok, true);
  });
}

function renderUi(result: any): string {
  const elements = new Map();
  const element = (s: string) => { if (!elements.has(s)) elements.set(s, { innerHTML: "", textContent: "", value: "", setAttribute() {}, appendChild() {} }); return elements.get(s); };
  const ctx = vm.createContext({ document: { querySelector: element, createElement: () => element(`new${elements.size}`) }, fetch: async () => ({ json: async () => ({ state: "online", provider: "fixture", fast: "fixture", zetaris: "online", memoryRecords: 0 }) }), setInterval() {}, clearInterval() {}, PricePreviewPanel: { render: () => "", bind() {} }, sample: result });
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], ctx);
  vm.runInContext('render(sample,"offline cost basis")', ctx);
  return element("#out").innerHTML;
}
test("UI renders the before/after basis and a concrete unavailable-cost reason without a live server", () => {
  for (const basis of ["before_change", "after_change", undefined]) {
    const b = fixture(basis);
    const output = renderUi({ ...b, requestedCountries: ["DE"], unsupportedCountries: [], concept: "food", cost: 8, costShare: 60, costShareBasis: basis ?? null, sql: [], narrative: null });
    assert.match(output, basis === "after_change" ? /after the stated cost change/i : /before the stated cost change/i);
    if (!basis) assert.match(output, /assum/i);
  }
  const b = fixture("after_change", -100);
  const output = renderUi({ ...b, requestedCountries: ["DE"], unsupportedCountries: [], concept: "food", cost: -100, costShare: 60, costShareBasis: "after_change", costInputNeeded: "Provide unit cost before the stated cost change; a 100% decrease cannot be reversed from the post-change cost share.", sql: [], narrative: null });
  assert.match(output, /100% decrease cannot be reversed/);
});

test("the actual server serializer supplies basis and cost diagnostics to both partial and final UI payloads", () => {
  const server = fs.readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  const body = server.match(/function toResult\(b: Brief\) \{([\s\S]*?)\n\}/)![1];
  const serialize = vm.runInNewContext(`(function(b) { ${body} })`, { COMPARE_COLUMNS, costInputNeeded });
  for (const partialStage of ["markets", "pricing", undefined]) {
    const b = fixture("after_change", -100), result = serialize({ ...b, partialStage });
    assert.equal(result.costShareBasis, "after_change");
    assert.match(result.costInputNeeded, /100% decrease cannot be reversed/);
    assert.equal(result.facts[0].costNeed, undefined);
  }
  assert.equal(serialize(fixture()).costShareBasis, null);
  assert.equal(serialize(fixture("after_change")).costInputNeeded, null);
});
