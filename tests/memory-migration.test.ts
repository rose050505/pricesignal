import { test } from "node:test";
import assert from "node:assert/strict";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { HMEM } from "../src/hmem_impl.ts";
import { skuScope, SELECTION_VERSION } from "../src/selection.ts";
import type { Candidate, Country } from "../src/sources/types.ts";

function memoryOnly(): AgentMemory {
  const memory = Object.create(AgentMemory.prototype);
  memory.hmem = new HMEM();
  return memory;
}
function fixture(country: Country = "CA", concept = "food") {
  const memory = memoryOnly();
  const agency = country === "CA" ? "statcan" : country === "AU" ? "abs" : "eurostat";
  const candidate: Candidate = { country, agency, dataset: "fixture", code: concept === "food" ? agency === "statcan" ? "v41690974" : agency === "abs" ? "20001" : "CP01" : "condiments", label: concept === "food" ? "Food" : "Food additives and condiments", frequency: "M", measure: "index", status: "active", lastPeriod: "2026-09", sourceUrl: "https://fixture.invalid/unused" };
  const state = { discoveries: 0, selections: 0, probes: [] as string[], probeCount: 12 as unknown, probePeriod: "2026-09" as unknown, onboardCount: 12 as unknown, onboardPeriod: "2026-09" as unknown, onboardOk: true, existed: false, createdObjects: undefined as number | undefined, existingObjects: undefined as number | undefined };
  const ctx = { views: new Map(), candidates: new Map(), notes: [] as string[], key: (a: string, b: string) => `${a}:${b}`, pairs: [{ country, concept }], getCompared: () => undefined, setCompared: () => {} };
  const req = { raw: `${country} ${concept}`, countries: [country], concept, conceptWords: [concept], unknownCountries: [] };
  const agent = new PriceSignalAgent({ memory, hedgeMs: Infinity,
    sql: { run: async sql => { state.probes.push(sql); return { id: "fixture", sql, rows: [[state.probeCount, state.probePeriod]], columns: [], ms: 0 }; } },
    discoverFn: async (_country, requested) => { state.discoveries++; return { country, concept: requested, candidates: requested === concept ? [candidate] : [], notes: [] }; },
    onboardFn: async () => ({ table: "fixture", view: "new_decoder_view", ok: state.onboardOk, existed: state.existed, createdObjects: state.createdObjects, existingObjects: state.existingObjects, rows: state.onboardCount as number, latest: state.onboardPeriod as string, sql: [] }),
    llm: async messages => {
      state.selections++;
      const groups = JSON.parse(String(messages.at(-1)!.content)).groups;
      return { text: JSON.stringify({ selections: groups.map((g: any) => ({ id: g.id, candidate: 0, fit: "specific", reason: "Condiments cover the named sauce." })) }), model: "fixture", provider: "fixture", ms: 0 };
    },
  });
  const store = (extra: any = {}) => memory.rememberMapping({ country, concept, agency, dataset: "fixture", code: candidate.code, label: candidate.label, view: "old_decoder_view", frequency: "M", ...extra });
  return { memory, candidate, state, ctx, req, agent, store, execute: (action: string) => (agent as any).execute({ action, args: { country, concept } }, req, ctx) };
}

test("ABS and StatCan legacy mappings migrate after verification while policy and the last request survive", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  for (const country of ["CA", "AU"] as const) for (const version of [undefined, 1]) {
    const f = fixture(country);
    const old = f.store({ decoderVersion: version });
    const policy = f.memory.rememberPolicy(0.7, "recover 70%");
    const last = f.memory.rememberRequest({ countries: [country], concept: "food", conceptWords: ["food"], costIncreasePct: 8, costSharePct: 60, raw: "first" });
    assert.equal(f.memory.findMapping(country, "food")!.id, old, "legacy mappings remain discoverable for supersession");
    await f.execute("discover_and_onboard");
    assert.ok(f.state.discoveries > 0);
    assert.ok(!f.state.probes.some(q => q.includes("old_decoder_view")), "obsolete decoder output is never probed for reuse");
    const current = f.memory.findMapping(country, "food")!;
    assert.equal((current.mapping as any).decoderVersion, 2);
    assert.equal(f.memory.hmem.store.get(current.id).supersedes, old);
    assert.equal(f.memory.latestPolicy()!.id, policy);
    assert.equal(f.memory.lastRequest()!.id, last);
    assert.equal(f.memory.lastRequest()!.request.costSharePct, 60);
  }
});

test("failed decoder migration never uses or supersedes the old mapping", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  const f = fixture(); const old = f.store(); f.state.onboardOk = false;
  await f.execute("discover_and_onboard");
  assert.equal(f.ctx.views.size, 0);
  assert.equal(f.memory.findMapping("CA", "food")!.id, old);
  assert.ok(!f.state.probes.some(q => q.includes("old_decoder_view")));
});

test("Eurostat unversioned mappings remain compatible with decoder one", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  const f = fixture("DE"); const old = f.store();
  await f.execute("discover_and_onboard");
  assert.equal(f.state.discoveries, 0);
  assert.equal(f.ctx.views.get("DE:food").via, "memory");
  assert.equal(f.memory.findMapping("DE", "food")!.id, old);
});

const invalidPeriods = [undefined, null, "", "2026-00", "2026-13", "2026-9", "2027-01", "2026-01", "2026-Q3"];
const invalidCounts = [undefined, null, "", false, 0, -1, 0.5, NaN, Infinity];
test("market memory rejects malformed, future and stale periods and unusable counts", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  for (const period of invalidPeriods) {
    const f = fixture("DE"); f.store(); f.state.probePeriod = period;
    const result = await f.execute("use_memory_mapping");
    assert.notEqual(result.ok, true, String(period));
    assert.equal(f.ctx.views.size, 0, String(period));
  }
  for (const count of invalidCounts) {
    const f = fixture("DE"); f.store(); f.state.probeCount = count;
    const result = await f.execute("use_memory_mapping");
    assert.notEqual(result.ok, true, String(count));
    assert.equal(f.ctx.views.size, 0, String(count));
  }
});

test("new injected onboard results must pass the same market period and count gates", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  for (const [field, values] of [["onboardPeriod", invalidPeriods], ["onboardCount", invalidCounts]] as const) for (const value of values) {
    const f = fixture(); f.state[field] = value;
    await f.execute("discover_and_onboard");
    assert.equal(f.ctx.views.size, 0, `${field}: ${String(value)}`);
    assert.equal(f.memory.findMapping("CA", "food"), undefined);
  }
});

test("fresh quarterly releases and numeric-string counts pass the shared gates", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  const remembered = fixture("AU");
  remembered.store({ decoderVersion: 2, frequency: "Q" });
  remembered.state.probeCount = "12"; remembered.state.probePeriod = "2026-Q3";
  assert.equal((await remembered.execute("use_memory_mapping")).ok, true);
  const fresh = fixture("AU"); fresh.candidate.frequency = "Q";
  fresh.state.onboardCount = "12"; fresh.state.onboardPeriod = "2026-Q3";
  await fresh.execute("discover_and_onboard");
  assert.equal(fresh.ctx.views.size, 1);
  assert.equal(fresh.memory.findMapping("AU", "food")!.mapping!.decoderVersion, 2);
});

test("product-checked SKU mappings also migrate their decoder without replacing general market memory", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  const f = fixture("AU", "condiments");
  const products = ["Gochujang 500 g"];
  const general = f.store({ decoderVersion: 2 });
  const old = f.store({ scope: skuScope(products), selectionVersion: SELECTION_VERSION, selection: { candidate: 0, fit: "specific", reason: "Condiments cover this sauce.", by: "model", model: "fixture" } });
  const skus = new Map();
  await (f.agent as any).selectSkuViews([{ country: "AU", concept: "condiments", products }], skus, f.ctx.views, f.ctx.notes);
  assert.equal(f.state.selections, 1);
  assert.equal(skus.get("AU:condiments").selectionSource, "model");
  const updated = f.memory.findMapping("AU", "condiments", skuScope(products))!;
  assert.equal((updated.mapping as any).decoderVersion, 2);
  assert.equal(f.memory.hmem.store.get(updated.id).supersedes, old);
  assert.equal(f.memory.findMapping("AU", "condiments")!.id, general);
});

test("SKU count gates reject an invalid remembered count and invalid new results", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  for (const count of invalidCounts) {
    const f = fixture("AU", "condiments"); const products = ["Gochujang 500 g"];
    const old = f.store({ decoderVersion: 2, scope: skuScope(products), selectionVersion: SELECTION_VERSION, selection: { candidate: 0, fit: "specific", reason: "Condiments cover this sauce.", by: "model", model: "fixture" } });
    f.state.probeCount = count; f.state.onboardCount = count;
    const skus = new Map();
    await (f.agent as any).selectSkuViews([{ country: "AU", concept: "condiments", products }], skus, f.ctx.views, f.ctx.notes);
    assert.equal(skus.size, 0, String(count));
    assert.equal(f.memory.findMapping("AU", "condiments", skuScope(products))!.id, old);
  }
});

test("failed SKU decoder migration keeps the old record for audit without pricing from it", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  const f = fixture("AU", "condiments"); const products = ["Gochujang 500 g"];
  const old = f.store({ scope: skuScope(products), selectionVersion: SELECTION_VERSION, selection: { candidate: 0, fit: "specific", reason: "Condiments cover this sauce.", by: "model", model: "fixture" } });
  f.state.onboardOk = false;
  const skus = new Map();
  await (f.agent as any).selectSkuViews([{ country: "AU", concept: "condiments", products }], skus, f.ctx.views, f.ctx.notes);
  assert.equal(skus.size, 0);
  assert.equal(f.memory.findMapping("AU", "condiments", skuScope(products))!.id, old);
  assert.ok(!f.state.probes.some(q => q.includes("old_decoder_view")));
});

test("a decoder change is not described as an official same-period revision", () => {
  for (const decoderVersion of [undefined, 1]) {
    const f = fixture();
    f.memory.rememberOutcome({ country: "CA", concept: "food", period: "2026-09", yoy: 3, low: 3, high: 3, sourceId: "statcan:food", methodVersion: 2, decoderVersion, at: "2026-10-26T00:00:00Z" } as any);
    const facts = [{ country: "CA", category: { concept: "food", label: "Food", sourceId: "statcan:food", latestPeriod: "2026-09", latestYoy: 2.2 }, suggested: { low: 2.2, high: 2.6 } }];
    const text = (f.agent as any).compareWithLastBrief(facts, f.req, 0.7).join(" ");
    assert.match(text, /decoder|calculation.*version/i);
    assert.match(text, /not directly comparable/i);
    assert.doesNotMatch(text, /official data or history revised|new official release/);
    const outcome: any = f.memory.lastOutcome("CA", "food")!.outcome;
    assert.equal(outcome.decoderVersion, 2);
    assert.equal(outcome.sourceId, "statcan:food");
    assert.equal(outcome.methodVersion, 2);
  }
});

test("mixed onboarding reports the new decoding view separately from the existing raw table", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  for (const mode of ["market", "sku"]) {
    const f = fixture("AU", "condiments");
    f.state.existed = true; f.state.createdObjects = 1; f.state.existingObjects = 1;
    if (mode === "market") await f.execute("discover_and_onboard");
    else await (f.agent as any).selectSkuViews([{ country: "AU", concept: "condiments", products: ["Gochujang 500 g"] }], new Map(), f.ctx.views, f.ctx.notes);
    const title = f.agent.trace.find(e => e.kind === "onboard")!.title;
    assert.match(title, /created 1 SQL object/i, mode);
    assert.match(title, /1 already existed/i, mode);
    assert.doesNotMatch(title, /Zetaris already had it - reused/i, mode);
  }
});
