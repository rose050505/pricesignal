import { test } from "node:test";
import assert from "node:assert/strict";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { HMEM } from "../src/hmem_impl.ts";
import type { Candidate, Country } from "../src/sources/types.ts";

function memoryOnly(): AgentMemory {
  const memory = Object.create(AgentMemory.prototype);
  memory.hmem = new HMEM();
  return memory;
}
function parser(reply: unknown = new Error("offline"), memory = memoryOnly()) {
  return new PriceSignalAgent({ memory, hedgeMs: Infinity,
    sql: { run: async () => { throw new Error("unexpected SQL"); } },
    llm: async () => { if (reply instanceof Error) throw reply; return { text: JSON.stringify(reply), model: "fixture", provider: "fixture", ms: 0 }; },
  });
}

test("explicit food inflation beats a snack-product introduction and a contradictory model", async () => {
  for (const reply of [new Error("offline"), { countries: ["DE", "CA", "AU"], concept: "snacks", concept_words: ["confectionery"] }]) {
    for (const raw of [
      "our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot? thinking +5%",
      "고추장과 과자를 수출해요. 독일 캐나다 호주의 식품 물가를 비교하고 가격은 +5%로 생각해요",
    ]) {
      const req = await parser(reply).parse(raw);
      assert.equal(req.concept, "food");
      assert.ok(req.conceptWords.includes("food"));
      assert.ok(!req.conceptWords.includes("confectionery"));
    }
  }
});

test("same-as-last updates explicitly named country and category, retaining only missing fields", async () => {
  const memory = memoryOnly();
  memory.rememberRequest({ countries: ["DE", "AU"], concept: "food", conceptWords: ["food"], costIncreasePct: 8, costSharePct: 60, proposedChangePct: 5, raw: "first" });
  for (const reply of [new Error("offline"), { countries: ["DE", "AU"], concept: "food" }, { countries: ["CA"], concept: "condiments" }]) {
    for (const raw of ["same as last time, but Canada condiments", "지난번과 같은 조건, 이번에는 캐나다 조미료 물가"] ) {
      const req = await parser(reply, memory).parse(raw);
      assert.deepEqual(req.countries, ["CA"]);
      assert.equal(req.concept, "condiments");
      assert.ok(req.conceptWords.includes("condiment"));
      assert.equal(req.proposedChangePct, 5);
      assert.equal(req.costIncreasePct, 8);
      assert.equal(req.costSharePct, 60);
    }
  }
  const unchanged = await parser({ countries: ["CA"], concept: "snacks" }, memory).parse("same as last time, but -2%");
  assert.deepEqual(unchanged.countries, ["DE", "AU"]);
  assert.equal(unchanged.concept, "food");
  assert.equal(unchanged.proposedChangePct, -2);
});

test("explicit narrow and overall comparisons remain distinct from food business context", async () => {
  for (const [raw, expected] of [
    ["our food business: compare snack inflation in Australia", "snacks"],
    ["our food business: compare condiment prices in Canada", "condiments"],
    ["our food business: compare all-items inflation in Germany", "all_items"],
    ["식품 수출업체입니다. 호주의 간식 물가를 비교해 주세요", "snacks"],
    ["식품 수출업체입니다. 독일 전체 물가를 비교해 주세요", "all_items"],
    ["compare snack inflation, not food inflation, in Australia", "snacks"],
  ]) for (const reply of [new Error("offline"), { concept: "food" }]) {
    assert.equal((await parser(reply).parse(raw)).concept, expected, raw);
  }
});

test("multiple explicit comparison categories disclose the single-category limitation", async () => {
  const req = await parser({ concept: "condiments" }).parse("Compare food inflation and snack inflation in Canada");
  assert.equal(req.concept, "food");
  assert.match(req.inputIssues?.join(" ") ?? "", /one market category|single.*category/i);
});

test("unknown category model output is still sanitized before reaching SQL", async () => {
  const req = await parser({ countries: ["DE"], concept: "Children's toys'; --" }).parse("children's toys in Germany +4%");
  assert.equal(req.concept, "childrens toys --");
});

test("an unchanged business description and hallucinated country codes cannot replace remembered intent", async () => {
  const memory = memoryOnly();
  memory.rememberRequest({ countries: ["FR", "IT", "ES"], concept: "condiments", conceptWords: ["condiment"], raw: "first" });
  const req = await parser({ countries: ["DE", "CA", "AU"], concept: "food" }, memory).parse("same as last time for our food business, but can we do +4%?");
  assert.deepEqual(req.countries, ["FR", "IT", "ES"]);
  assert.equal(req.concept, "condiments");
});

for (const [label, raw] of [
  ["source wording", "지난번과 같은 조건으로 해주세요. 데이터 소스는 그대로 두고 +4%로 바꿔 주세요."],
  ["overall wording", "지난번과 같은 조건으로 해주세요. 전체적으로 +4%를 검토합니다."],
  ["product wording", "same as last time for our snack products, but can we do +4%?"],
]) test(`${label} cannot change a remembered food category`, async () => {
  const memory = memoryOnly();
  memory.rememberRequest({ countries: ["DE"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, raw: "first" });
  for (const reply of [new Error("offline"), { concept: "food" }]) {
    const req = await parser(reply, memory).parse(raw);
    assert.equal(req.concept, "food", raw);
    assert.equal(req.proposedChangePct, 4);
    assert.deepEqual(req.conceptWords, ["food"]);
  }
});

test("category shorthand and explicit category changes remain actionable without an inflation suffix", async () => {
  const memory = memoryOnly();
  memory.rememberRequest({ countries: ["DE"], concept: "food", conceptWords: ["food"], raw: "first" });
  for (const [raw, expected] of [
    ["same as last time, but Canada condiments", "condiments"],
    ["same as last time, but switch to snacks", "snacks"],
    ["same as last time, change the category to condiments", "condiments"],
    ["지난번과 같은 조건, 이번에는 조미료로 바꿔 주세요", "condiments"],
    ["지난번과 같은 조건, 범주는 간식으로 변경해 주세요", "snacks"],
    ["DE and AU food +3%", "food"],
  ]) assert.equal((await parser({ concept: "food" }, memory).parse(raw)).concept, expected, raw);
});

test("a bare category after same-as-last but is an explicit change, while a product sentence is not", async () => {
  const memory = memoryOnly();
  memory.rememberRequest({ countries: ["DE"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, raw: "first" });
  for (const reply of [new Error("offline"), { concept: "food" }]) {
    const req = await parser(reply, memory).parse("same as last time, but snacks");
    assert.equal(req.concept, "snacks");
    assert.equal(req.proposedChangePct, 5);
    assert.equal((await parser(reply, memory).parse("same as last time, but snacks are still our main products")).concept, "food");
  }
});

const candidate = (label: string, code = "sweet", country: Country = "DE", broad = false): Candidate => ({
  country, agency: country === "AU" ? "abs" : "eurostat", dataset: "fixture", code, label,
  frequency: "M", measure: "yoy_pct", status: "active", lastPeriod: "2026-09", sourceUrl: "https://fixture.invalid/unused",
  ...(broad ? { isBroadFallback: true } : {}),
});
function marketFixture(initial: Candidate[], food: Candidate[] = [], country: Country = "DE") {
  const memory = memoryOnly();
  const onboarded: Candidate[] = [];
  const discovered: string[] = [];
  const probed: string[] = [];
  const req = { raw: `${country} snack inflation`, countries: [country], concept: "snacks", conceptWords: ["snack"], unknownCountries: [] };
  const ctx = { views: new Map(), candidates: new Map(), notes: [] as string[], key: (a: string, b: string) => `${a}:${b}`, pairs: [{ country, concept: "snacks" }], getCompared: () => undefined, setCompared: () => {} };
  const agent = new PriceSignalAgent({ memory, hedgeMs: Infinity,
    llm: async () => { throw new Error("no model calls needed for this guard"); },
    sql: { run: async (sql: string) => { probed.push(sql); return { id: "fixture", sql, columns: [], rows: [[12, "2026-09"]], ms: 0 }; } },
    discoverFn: async (_country, concept) => { discovered.push(concept); return { country, concept, candidates: concept === "food" ? food : initial, notes: [] }; },
    onboardFn: async (_sql, c) => { onboarded.push(c); return { table: "fixture", view: `v_${c.code}`, ok: true, existed: false, rows: 12, latest: "2026-09", sql: [] }; },
  });
  return { memory, agent, ctx, req, onboarded, discovered, probed, execute: (action: string, extra = {}) => (agent as any).execute({ action, args: { country, concept: "snacks", ...extra } }, req, ctx) };
}

test("new snack candidates reject sweet-only categories and disclose a verified Food alternative", async () => {
  for (const label of ["Sugar, confectionery and desserts (ND)", "Confectionery", "Sugar and jams"]) {
    const f = marketFixture([candidate(label), candidate("Food and non-alcoholic beverages", "CP01", "DE", true)]);
    await f.execute("discover_and_onboard");
    assert.deepEqual(f.onboarded.map(c => c.code), ["CP01"]);
    assert.match(f.ctx.notes.join(" "), /broader.*proxy/i);
    assert.match(f.memory.findMapping("DE", "snacks")!.mapping!.note!, /broader.*proxy/i);
  }
});

test("remembered sweet-only snack mappings are rejected and rediscovered before any live reuse", async () => {
  const f = marketFixture([candidate("Food", "CP01", "DE", true)]);
  f.memory.rememberMapping({ country: "DE", concept: "snacks", agency: "eurostat", dataset: "fixture", code: "sweet", label: "Sugar, confectionery and desserts", view: "legacy_sweets", frequency: "M" });
  await f.execute("discover_and_onboard");
  assert.deepEqual(f.onboarded.map(c => c.code), ["CP01"]);
  assert.ok(!f.probed.some(sql => sql.includes("legacy_sweets")));
  assert.equal(f.memory.findMapping("DE", "snacks")!.mapping!.code, "CP01");
  assert.match(f.ctx.notes.join(" "), /sweet|confectionery/i);
});

test("a rejected shortlist checks Food once and omits the market category if no verified alternative exists", async () => {
  for (const food of [[], [candidate("Food additives and condiments", "CP01", "DE", true)], [candidate("Food", "wrong", "DE", true)]]) {
    const f = marketFixture([candidate("Sugar, confectionery and desserts")], food);
    await f.execute("discover_and_onboard");
    assert.equal(f.onboarded.length, 0);
    assert.equal(f.ctx.views.size, 0);
    assert.deepEqual(f.discovered, ["snacks", "food"]);
    assert.match(f.ctx.notes.join(" "), /no usable|omitted|no verified/i);
  }
  const f = marketFixture([candidate("Sugar, confectionery and desserts")], [candidate("Food", "CP01")]);
  await f.execute("discover_and_onboard");
  assert.deepEqual(f.onboarded.map(c => c.code), ["CP01"]);
  assert.match(f.ctx.notes.join(" "), /broader.*proxy/i);
});

test("a direct onboard action cannot bypass the snack guard while real snack categories remain usable", async () => {
  const bad = marketFixture([]);
  bad.ctx.candidates.set("DE:snacks", [candidate("Sugar, confectionery and desserts")]);
  await bad.execute("onboard_series", { candidate: 0 });
  assert.equal(bad.onboarded.length, 0);
  for (const c of [candidate("Snacks and confectionery", "115501", "AU"), candidate("Potato crisps", "crisps")]) {
    const good = marketFixture([c], [], c.country);
    await good.execute("discover_and_onboard");
    assert.equal(good.onboarded[0].code, c.code);
    assert.ok(!good.ctx.notes.some(n => /broader.*proxy/i.test(n)));
  }
});
