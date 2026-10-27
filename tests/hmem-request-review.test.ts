import { test } from "node:test";
import assert from "node:assert/strict";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { HMEM } from "../src/hmem_impl.ts";
import type { Candidate } from "../src/sources/types.ts";

function memoryOnly(): AgentMemory {
  const memory = Object.create(AgentMemory.prototype);
  memory.hmem = new HMEM();
  return memory;
}

function parser(memory: AgentMemory, reply: object | Error) {
  return new PriceSignalAgent({
    memory, hedgeMs: Infinity,
    sql: { run: async () => { throw new Error("Unexpected SQL in parsing fixture"); } },
    llm: async () => {
      if (reply instanceof Error) throw reply;
      return { text: JSON.stringify(reply), model: "fixture", provider: "fixture", ms: 0 };
    },
  });
}

async function rememberMixedRequest(memory: AgentMemory) {
  const req = await parser(memory, { countries: ["japan", "canada"], concept: "food", proposed_change_pct: 5 })
    .parse("japan + canada food prices, ok to raise 5%?");
  memory.rememberRequest(req);
  return req;
}

test("same-as-last preserves supported and unsupported markets with empty, hallucinated or failed model replies", async () => {
  const memory = memoryOnly();
  await rememberMixedRequest(memory);
  for (const reply of [{ countries: [] }, { countries: ["DE", "brazil"] }, new Error("fixture unavailable")]) {
    const req = await parser(memory, reply).parse("same as last time, but +3%?");
    assert.deepEqual(req.countries, ["CA"]);
    assert.deepEqual(req.unknownCountries, ["japan"]);
    assert.equal(req.defaultMarkets, undefined);
    assert.equal(req.proposedChangePct, 3);
  }
});

test("explicit supported or unsupported market replacement clears the other remembered markets and model guesses", async () => {
  const memory = memoryOnly();
  await rememberMixedRequest(memory);
  const cases = [
    { raw: "same as last time, but Germany only +3%", names: ["Germany", "japan"], countries: ["DE"], unknown: [] },
    { raw: "same as last time, but Japan only +3%", names: ["Japan", "Canada"], countries: [], unknown: ["Japan"] },
    { raw: "same as last time, but Germany and Japan +3%", names: ["Germany", "Japan", "Brazil"], countries: ["DE"], unknown: ["Japan"] },
    { raw: "same as last time, but United Kingdom only +3%", names: ["United Kingdom", "CA"], countries: [], unknown: ["United Kingdom"] },
    { raw: "same as last time, but United States only +3%", names: ["United States", "CA"], countries: ["US"], unknown: [] },
    { raw: "same as last time, but canda only +3%", names: ["canda", "japan"], countries: ["CA"], unknown: [] },
    { raw: "same as last time, but Japan only +3%", names: [], countries: [], unknown: ["japan"] },
  ];
  for (const c of cases) {
    const req = await parser(memory, { countries: c.names }).parse(c.raw);
    assert.deepEqual(req.countries, c.countries, c.raw);
    assert.deepEqual(req.unknownCountries, c.unknown, c.raw);
  }
});

test("old last-request records without unsupported countries remain readable", async () => {
  const memory = memoryOnly();
  const old = { countries: ["FR", "IT"], concept: "food", conceptWords: ["food"], proposedChangePct: 5 };
  memory.hmem.add({ content: "Legacy request", type: "general", source: "fixture:legacy", tags: ["last-request", `json:${JSON.stringify(old)}`] });
  const req = await parser(memory, { countries: ["DE", "Japan"] }).parse("same as last time, but +3%?");
  assert.deepEqual(req.countries, ["FR", "IT"]);
  assert.deepEqual(req.unknownCountries, []);
});

test("unsupported-only results replace an older supported request and repeat without default markets or SQL", async () => {
  const memory = memoryOnly();
  const old = memory.rememberRequest({ countries: ["DE", "CA", "AU"], concept: "food", conceptWords: ["food"], raw: "earlier", proposedChangePct: 5 });
  const first = await parser(memory, { countries: ["japan"], concept: "food", proposed_change_pct: 5 }).run("japan food +5%?");
  assert.deepEqual(first.request.countries, []);
  assert.deepEqual(first.request.unknownCountries, ["japan"]);
  const remembered = memory.lastRequest()!;
  assert.notEqual(remembered.id, old);
  assert.equal(memory.hmem.store.get(remembered.id).supersedes, old);
  const repeated = await parser(memory, { countries: [] }).run("same as last time, but +3%?");
  assert.deepEqual(repeated.request.countries, []);
  assert.deepEqual(repeated.request.unknownCountries, ["japan"]);
  assert.equal(repeated.request.defaultMarkets, undefined);
  assert.equal(repeated.sqlLog.length, 0);
  assert.match(repeated.markdown!, /japan: not covered/);
});

function reviewedMapping() {
  const memory = memoryOnly();
  const old = memory.rememberMapping({ country: "DE", concept: "food", agency: "eurostat", dataset: "fixture", code: "CP01", label: "Food", view: "reviewed_view", frequency: "M", decoderVersion: 1 });
  memory.hmem.feedback(old, "wrong");
  const confidence = memory.hmem.store.get(old).confidence;
  const state = { probes: [] as string[], discoveries: 0, onboarding: 0, failedDiscovery: false, noCandidates: false, onboardOk: true, rows: 12, latest: "2026-09", feedback: [] as string[] };
  const feedback = memory.feedback.bind(memory);
  memory.feedback = (id, kind) => { state.feedback.push(`${id}:${kind}`); feedback(id, kind); };
  const candidate: Candidate = { country: "DE", agency: "eurostat", dataset: "fixture", code: "CP01", label: "Food", frequency: "M", measure: "yoy_pct", status: "active", sourceUrl: "https://fixture.invalid/unused" };
  const agent = new PriceSignalAgent({
    memory, hedgeMs: Infinity,
    llm: async () => { throw new Error("Unexpected model call in mapping fixture"); },
    sql: { run: async sql => { state.probes.push(sql); return { id: "fixture", sql, columns: ["n", "latest"], rows: [[12, "2026-09"]], ms: 0 }; } },
    discoverFn: async () => { state.discoveries++; if (state.failedDiscovery) throw new Error("fixture agency unavailable"); return { country: "DE", concept: "food", candidates: state.noCandidates ? [] : [candidate], notes: [] }; },
    onboardFn: async () => { state.onboarding++; return { table: "fixture", view: "verified_view", ok: state.onboardOk, existed: false, rows: state.rows, latest: state.latest, sql: [] }; },
  });
  const req = { raw: "DE food", countries: ["DE"], concept: "food", conceptWords: ["food"], unknownCountries: [] };
  const ctx = { views: new Map(), candidates: new Map(), notes: [] as string[], key: (a: string, b: string) => `${a}:${b}`, pairs: [{ country: "DE", concept: "food" }], getCompared: () => undefined, setCompared: () => {} };
  const execute = (action: string) => (agent as any).execute({ action, args: { country: "DE", concept: "food" } }, req, ctx);
  return { memory, old, confidence, state, agent, ctx, execute };
}

test("review-marked market mappings are refused before probing or helpful feedback", async () => {
  const f = reviewedMapping();
  const result = await f.execute("use_memory_mapping");
  assert.match(result.error, /review/i);
  assert.equal(f.ctx.views.size, 0);
  assert.deepEqual(f.state.probes, []);
  assert.deepEqual(f.state.feedback, []);
  assert.equal(f.memory.hmem.store.get(f.old).confidence, f.confidence);
  assert.equal(f.memory.findMapping("DE", "food")!.id, f.old, "reviewed records remain available for supersession");
});

test("successful verified rediscovery supersedes a reviewed market mapping", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  const f = reviewedMapping();
  await f.execute("discover_and_onboard");
  assert.equal(f.state.discoveries, 1);
  assert.equal(f.state.onboarding, 1);
  assert.equal(f.ctx.views.get("DE:food").view, "verified_view");
  assert.equal(f.ctx.views.get("DE:food").via, "onboarded");
  const current = f.memory.findMapping("DE", "food")!;
  assert.notEqual(current.id, f.old);
  assert.equal(f.memory.hmem.store.get(current.id).supersedes, f.old);
  assert.ok(!f.memory.hmem.store.get(current.id).tags.includes("review"));
  assert.equal(f.memory.hmem.store.get(f.old).confidence, f.confidence);
  assert.deepEqual(f.state.feedback, []);
  assert.ok(!f.state.probes.some(sql => sql.includes("reviewed_view")));
});

test("failed rediscovery or invalid new observations never revive a reviewed mapping during compare", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  for (const failure of ["agency", "no-candidates", "onboarding", "empty", "stale"] as const) {
    const f = reviewedMapping();
    if (failure === "agency") f.state.failedDiscovery = true;
    if (failure === "no-candidates") f.state.noCandidates = true;
    if (failure === "onboarding") f.state.onboardOk = false;
    if (failure === "empty") f.state.rows = 0;
    if (failure === "stale") f.state.latest = "2026-01";
    await f.execute("discover_and_onboard");
    const compared = await f.execute("compare");
    assert.match(compared.error, /no views/, failure);
    assert.equal(f.ctx.views.size, 0, failure);
    assert.equal(f.memory.findMapping("DE", "food")!.id, f.old, failure);
    assert.equal(f.memory.hmem.store.get(f.old).confidence, f.confidence, failure);
    assert.deepEqual(f.state.feedback, [], failure);
    assert.deepEqual(f.state.probes, [], failure);
  }
});

test("compare can use another verified view after review rediscovery fails without reviving the reviewed view", async () => {
  const f = reviewedMapping();
  f.state.failedDiscovery = true;
  f.ctx.views.set("DE:all_items", { view: "healthy_view", label: "All items", via: "memory" });
  await f.execute("discover_and_onboard");
  const compared = await f.execute("compare");
  assert.ok(compared.id);
  assert.equal(f.ctx.views.has("DE:food"), false);
  // The semantic view is defined over the healthy view only, and the comparison reads it.
  assert.equal(f.state.probes.length, 2);
  assert.match(f.state.probes[0], /^CREATE OR REPLACE SCHEMASTORE VIEW v_market_inflation_\S+ WITH CONTAINER psig AS\nSELECT .* FROM psig\.healthy_view WHERE/);
  assert.ok(!f.state.probes.some(sql => sql.includes("reviewed_view")));
  assert.deepEqual(f.state.feedback, []);
  assert.equal(f.memory.hmem.store.get(f.old).confidence, f.confidence);
  assert.equal(f.memory.findMapping("DE", "food")!.id, f.old);
});

test("a market remembered as not covered is covered on the next 'same as last time' once it is supported (US, 28 Oct)", async () => {
  const memory = memoryOnly();
  // A request remembered before the US was supported: US stored under unknownCountries.
  memory.rememberRequest({ raw: "united states + canada food prices, ok to raise 5%?", countries: ["CA"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, unknownCountries: ["United States"] } as any);
  const req = await parser(memory, { countries: [], concept: null, proposed_change_pct: 4 }).parse("same as last time, but +4%");
  assert.deepEqual(req.countries, ["CA", "US"]);
  assert.deepEqual(req.unknownCountries, []);
});
