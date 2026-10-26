import { test } from "node:test";
import assert from "node:assert/strict";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { HMEM } from "../src/hmem_impl.ts";

function memoryOnly(): AgentMemory {
  const memory = Object.create(AgentMemory.prototype);
  memory.hmem = new HMEM();
  return memory;
}
function agentWith(memory = memoryOnly(), reply: unknown = new Error("offline parser"), sql?: any): PriceSignalAgent {
  return new PriceSignalAgent({ memory, hedgeMs: Infinity,
    llm: async () => { if (reply instanceof Error) throw reply; return { text: JSON.stringify(reply), model: "fixture", provider: "fixture", ms: 0 }; },
    sql: sql ?? { run: async () => { throw new Error("unexpected SQL"); } },
  });
}

test("four percentages keep their denominators and preserve a negative proposal with or without the model", async () => {
  const raw = "Germany food: our costs rose 8%, unit costs are 80% of selling price, we pass on 70%; would -2% work?";
  for (const reply of [new Error("offline"), { countries: ["DE"], concept: "food", proposed_change_pct: 2, cost_increase_pct: 8, cost_share_pct: 80, pass_through: 0.7 }]) {
    const req: any = await agentWith(memoryOnly(), reply).parse(raw);
    assert.equal(req.costIncreasePct, 8);
    assert.equal(req.costSharePct, 80);
    assert.equal(req.passThrough, 0.7);
    assert.equal(req.proposedChangePct, -2, "the sign in the user's text wins over a contradictory model value");
  }
  const korean: any = await agentWith().parse("독일 식품 원가가 8% 올랐고 원가 비중은 판매가의 60%, 증가분의 70% 반영, 가격은 −2%로");
  assert.equal(korean.costIncreasePct, 8);
  assert.equal(korean.costSharePct, 60);
  assert.equal(korean.passThrough, 0.7);
  assert.equal(korean.proposedChangePct, -2);
});

test("same as last time remembers the cost denominator and changes only percentages explicitly supplied", async () => {
  const memory = memoryOnly();
  memory.rememberRequest({ countries: ["DE"], concept: "food", conceptWords: ["food"], proposedChangePct: -2, costIncreasePct: 8, costSharePct: 80, raw: "first" } as any);
  const repeated: any = await agentWith(memory, { proposed_change_pct: 70, pass_through: 0.7 }).parse("same as last time, but pass on 70%");
  assert.equal(repeated.proposedChangePct, -2);
  assert.equal(repeated.costSharePct, 80);
  assert.equal(repeated.costShareRemembered, true);
  assert.equal(repeated.costRemembered, true);
  const changed: any = await agentWith(memory).parse("same as last time, but cost share 60% and price -3%");
  assert.equal(changed.costSharePct, 60);
  assert.equal(changed.costShareRemembered, undefined);
  assert.equal(changed.costIncreasePct, 8);
  assert.equal(changed.proposedChangePct, -3);
});

test("a named cost-to-price ratio is a denominator, including its zero and full-share boundaries", async () => {
  for (const share of [0, 60, 100]) {
    const req: any = await agentWith(memoryOnly(), { cost_share_pct: share, cost_increase_pct: 8 }).parse(`DE food, unit cost-to-price ratio ${share}%, costs rose 8%, price -2%`);
    assert.equal(req.costSharePct, share);
    assert.equal(req.costIncreasePct, 8);
    assert.equal(req.proposedChangePct, -2);
  }
});

test("a following price-cut clause cannot reverse the preceding cost increase", async () => {
  const reply = { countries: ["DE"], concept: "food", cost_increase_pct: 8, cost_share_pct: 60, pass_through: 0.7, proposed_change_pct: -2 };
  for (const connector of ["but prices should fall", "and reduce prices"]) {
    for (const model of [reply, new Error("offline")]) {
      const req: any = await agentWith(memoryOnly(), model).parse(`DE food, costs rose 8% ${connector} 2%, cost share 60%, pass through 70%`);
      assert.equal(req.costIncreasePct, 8, connector);
      assert.equal(req.proposedChangePct, -2, connector);
      assert.equal(req.costSharePct, 60);
      assert.equal(req.passThrough, 0.7);
    }
  }
});

test("a percentage followed by cost share updates the remembered denominator rather than the proposal", async () => {
  const memory = memoryOnly();
  memory.rememberRequest({ countries: ["DE"], concept: "food", conceptWords: ["food"], proposedChangePct: 4, costIncreasePct: 8, costSharePct: 80, raw: "first" });
  for (const model of [{ cost_share_pct: 60, proposed_change_pct: null }, new Error("offline")]) {
    const req: any = await agentWith(memory, model).parse("same as last time, but 60% cost share");
    assert.equal(req.costSharePct, 60);
    assert.equal(req.costShareRemembered, undefined);
    assert.equal(req.proposedChangePct, 4);
    assert.equal(req.costIncreasePct, 8);
  }
  const invalid: any = await agentWith(memory).parse("same as last time, but 120% cost share and price -2%");
  assert.equal(invalid.costSharePct, undefined);
  assert.equal(invalid.costShareRemembered, undefined);
  assert.equal(invalid.proposedChangePct, -2);
  assert.match(invalid.inputIssues.join(" "), /Cost share must be between/);
});

test("cost shares and pass-throughs report impossible ratios without reusing a past value", async () => {
  const memory = memoryOnly();
  memory.rememberRequest({ countries: ["DE"], concept: "food", conceptWords: [], costSharePct: 80, raw: "first" } as any);
  for (const raw of ["DE food, cost share 120%, price +4%", "DE food, cost share -1%, price +4%", "DE food, pass on 150%, price +4%", "DE food, pass on -5%, price +4%"]) {
    const req: any = await agentWith(memory).parse(`same as last time, ${raw}`);
    assert.match(req.inputIssues?.join(" ") ?? "", /between|range|0.*100|0.*1/i, raw);
    if (/cost share/.test(raw)) assert.equal(req.costSharePct, undefined);
    else { assert.equal(req.passThrough, undefined); assert.equal(req.invalidPassThrough, true); }
    assert.equal(req.proposedChangePct, 4);
  }
  const missing: any = await agentWith(memoryOnly(), { cost_increase_pct: 8, cost_share_pct: 80, pass_through: 0.7 }).parse("DE food, costs rose 8%, pass on 70%");
  assert.equal(missing.costSharePct, undefined, "a model cannot invent the cost-to-price denominator");
  assert.equal(missing.proposedChangePct, undefined);
});

test("remembered policy describes recovery of cost increases rather than multiplying market inflation", () => {
  const memory = memoryOnly();
  const id = memory.rememberPolicy(0.7, "pass on 70%");
  const text = memory.hmem.store.all().find((r: any) => r.id === id).content;
  assert.match(text, /cost increase/i);
  assert.doesNotMatch(text, /category inflation/i);
});

function market(period = "2026-09", yoy = 4, sourceId = "official:food") {
  return { country: "DE", agency: "Official", category: { concept: "food", label: "Food", frequency: "M", sourceId, latestPeriod: period, latestYoy: yoy, avg12: yoy, trend: "flat", points: [] }, suggested: { low: yoy, high: yoy, basis: "benchmark" }, verdict: "above the market benchmark", cite: "Q1" };
}
function prior(extra: Record<string, unknown> = {}) {
  return { country: "DE", concept: "food", period: "2026-09", yoy: 2, low: 2, high: 2, policy: 0.7, at: "2026-10-26T00:00:00Z", sourceId: "official:food", methodVersion: 3, ...extra };
}
function compare(old: any, current: any) {
  const memory = memoryOnly();
  memory.rememberOutcome(old);
  const text = (agentWith(memory) as any).compareWithLastBrief([current], { raw: "DE food", countries: ["DE"], concept: "food", conceptWords: ["food"], unknownCountries: [] }, 0.7).join("\n");
  return { memory, text };
}

test("remembered outcomes distinguish same-period revisions and preserve the newer baseline after data regresses", () => {
  const revision = compare(prior(), market());
  assert.match(revision.text, /revis/i);
  assert.match(revision.text, /\+2\.0%.*\+4\.0%/);
  assert.doesNotMatch(revision.text, /no new official release/);
  const regressed = compare(prior(), market("2026-08"));
  assert.match(regressed.text, /older|regress|earlier/i);
  assert.doesNotMatch(regressed.text, /new official release/);
  assert.equal(regressed.memory.lastOutcome("DE", "food")!.outcome.period, "2026-09");
});

test("old methodology or a changed source is not presented as a like-for-like market change", () => {
  const legacy = compare(prior({ methodVersion: undefined, sourceId: undefined }), market());
  assert.match(legacy.text, /method|legacy/i);
  assert.match(legacy.text, /not directly comparable|cannot.*compar/i);
  const changed = compare(prior(), market("2026-09", 4, "official:other-food"));
  assert.match(changed.text, /source.*chang/i);
  assert.match(changed.text, /not directly comparable|cannot.*compar/i);
  const stored: any = changed.memory.lastOutcome("DE", "food")!.outcome;
  assert.equal(stored.sourceId, "official:other-food");
  assert.equal(stored.methodVersion, 3);
});

test("SKU benchmark retains deflation and is independent of the cost recovery policy", async () => {
  const sql = { run: async (q: string) => ({ id: "fixture", sql: q, columns: [], ms: 0,
    rows: /^SELECT DISTINCT/.test(q) ? [["DE", "food", "Noodles"]] : /p\.sku_category = s\.concept/.test(q)
      ? Array.from({ length: 12 }, (_, i) => ["N-1", "Noodles", "DE", "food", "EUR", 100, "food", "Food", "M", `2025-${String(i + 1).padStart(2, "0")}`, i === 11 ? -2 : -4, "official:food"]) : [],
  }) };
  for (const policy of [0.7, 1]) {
    const agent: any = agentWith(memoryOnly(), new Error("unused"), sql);
    const priced = await agent.priceList({ raw: "DE food -3%", countries: ["DE"], concept: "food", proposedChangePct: -3 }, new Map(), [], policy, async () => ({ view: "v_food" }), []);
    assert.equal(priced.skus[0].rangeLow, -3.8);
    assert.equal(priced.skus[0].rangeHigh, -2);
    assert.equal(priced.skus[0].low, 96.2);
    assert.equal(priced.skus[0].verdict, "within the market benchmark");
  }
});

test("an invalid explicit policy keeps market facts but cannot reuse, store or narrate a cost target", async () => {
  const memory = memoryOnly();
  const validPolicyId = memory.rememberPolicy(0.7, "pass on 70%");
  for (const concept of ["food", "all_items"]) memory.rememberMapping({ country: "DE", concept, agency: "eurostat", dataset: "fixture", code: concept, label: "Food", view: `v_${concept}`, frequency: "M" });
  let narrativePayload: any;
  const agent = new PriceSignalAgent({ memory, hedgeMs: Infinity,
    sql: { run: async (q: string) => ({ id: "fixture", sql: q, columns: [], ms: 0, rows:
      /^SELECT COUNT/.test(q) ? [[12, "2026-09"]]
      : /^SELECT country, concept/.test(q) ? Array.from({ length: 12 }, (_, i) => ["DE", "food", "Food", "M", `2025-${String(i + 1).padStart(2, "0")}`, 2, "official:food"]) : [],
    }) },
    llm: async (messages: any[]) => {
      if (messages[0].content.startsWith("You write short")) {
        narrativePayload = JSON.parse(messages.at(-1).content.split("Facts: ")[1].split("\nReply")[0]);
        return { text: '{"headline":"Historical market comparison.","markets":{}}', model: "fixture", provider: "fixture", ms: 0 };
      }
      assert.match(messages[0].content, /^Extract/);
      return { text: '{"countries":["DE"],"concept":"food"}', model: "fixture", provider: "fixture", ms: 0 };
    },
  });
  const brief = await agent.run("DE food, costs rose 8%, cost share 80%, pass on 150%, price +4%");
  assert.equal(brief.facts[0].suggested!.high, 2);
  assert.equal(brief.facts[0].costNeed, undefined);
  assert.equal(brief.request.invalidPassThrough, true);
  assert.match(brief.notes.join(" "), /Cost pass-through must be between/);
  assert.equal(memory.latestPolicy()!.id, validPolicyId);
  assert.equal(memory.lastOutcome("DE", "food")!.outcome.policy, undefined);
  assert.equal(narrativePayload.cost_pass_through_pct, null);
  assert.equal(narrativePayload.facts[0].cost_need_pct, undefined);
  assert.doesNotMatch(brief.markdown!, /recover 100%|pass.through 100%/);
});
