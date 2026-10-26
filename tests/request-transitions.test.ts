import test from "node:test";
import assert from "node:assert/strict";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { HMEM } from "../src/hmem_impl.ts";
import { costScenario } from "../src/brief.ts";

function fixtureMemory() {
  const memory = Object.create(AgentMemory.prototype) as AgentMemory;
  (memory as any).hmem = new HMEM();
  memory.rememberRequest({ countries: ["DE"], concept: "food", conceptWords: ["food"],
    proposedChangePct: 5, costIncreasePct: 8, costSharePct: 60, costShareBasis: "before_change", raw: "fixture" });
  memory.rememberPolicy(.7, "recover 70% of the monetary cost increase");
  return memory;
}
async function parse(raw: string, reply: object | Error, memory = fixtureMemory()) {
  return new PriceSignalAgent({ memory, hedgeMs: Infinity,
    llm: async () => { if (reply instanceof Error) throw reply; return { text: JSON.stringify(reply), model: "fixture", provider: "fixture", ms: 0 }; },
    sql: { run: async () => { throw new Error("Parsing must not run SQL"); } },
  }).parse(raw);
}
const replies = (reply: object) => [reply, new Error("offline model")];

test("English and Korean policy transitions keep the new policy separate from the price proposal", async () => {
  for (const raw of ["same as last time, change pass-through from 70% to 50%", "지난번과 같은 조건에서 원가 반영률을 70%에서 50%로 바꿔 주세요"])
    for (const suffix of ["", "; price +3%"])
      for (const reply of replies({ pass_through: .5, proposed_change_pct: suffix ? 3 : null })) {
        const req = await parse(raw + suffix, reply);
        assert.equal(req.passThrough, .5, raw + suffix);
        assert.equal(req.proposedChangePct, suffix ? 3 : 5);
        assert.equal(req.costSharePct, 60); assert.equal(req.costIncreasePct, 8);
        assert.equal(costScenario(req, req.passThrough!), 2.4);
        assert.ok(!req.inputIssues?.some(issue => /multiple.*proposed/i.test(issue)));
      }
});

test("cost-share transitions change the denominator and retain the existing unspecified-timing assumption", async () => {
  for (const raw of ["same as last time, cost share changes from 60% to 50%", "지난번과 같은 조건, 원가 비중을 60%에서 50%로 변경해 주세요"])
    for (const suffix of ["", "; price +3%"])
      for (const reply of replies({ cost_share_pct: 50, proposed_change_pct: suffix ? 3 : null })) {
        const req = await parse(raw + suffix, reply);
        assert.equal(req.costSharePct, 50, raw + suffix);
        assert.equal(req.costShareRemembered, undefined);
        assert.equal(req.costShareBasis, undefined);
        assert.match(req.inputIssues?.join(" ") ?? "", /before.*assum|assum.*before/i);
        assert.equal(req.proposedChangePct, suffix ? 3 : 5);
        assert.equal(req.passThrough, undefined);
        assert.equal(costScenario(req, .7), 2.8);
      }
});

test("cost-change transitions retain their cost role, including signed reductions and separate proposals", async () => {
  for (const [raw, change] of [
    ["same as last time, change cost increase from 8% to 5%", 5],
    ["지난번과 같은 조건, 원가 상승률을 8%에서 5%로 바꿔 주세요", 5],
    ["same as last time, change costs from +8% to -2%", -2],
    ["지난번과 같은 조건, 원가 변동률을 +8%에서 -2%로 변경해 주세요", -2],
  ] as const) for (const suffix of ["", "; price +3%"])
    for (const reply of replies({ cost_increase_pct: change, proposed_change_pct: suffix ? 3 : null })) {
      const req = await parse(raw + suffix, reply);
      assert.equal(req.costIncreasePct, change, raw + suffix);
      assert.equal(req.costRemembered, undefined);
      assert.equal(req.proposedChangePct, suffix ? 3 : 5);
      assert.equal(req.costSharePct, 60);
      assert.equal(req.passThrough, undefined);
    }
});

test("a price-proposal transition uses its destination instead of reporting two competing proposals", async () => {
  for (const [raw, price] of [
    ["same as last time, change the price proposal from +5% to +3%", 3],
    ["지난번과 같은 조건, 가격 인상률을 +5%에서 +3%로 바꿔 주세요", 3],
    ["same as last time, change the proposal from +5% to -.5%", -.5],
    ["지난번과 같은 조건, 가격 제안을 +5%에서 -0,5%로 변경해 주세요", -.5],
  ] as const) for (const reply of replies({ proposed_change_pct: price })) {
    const req = await parse(raw, reply);
    assert.equal(req.proposedChangePct, price, raw);
    assert.equal(req.costIncreasePct, 8); assert.equal(req.costSharePct, 60);
    assert.equal(req.passThrough, undefined);
    assert.ok(!req.inputIssues?.some(issue => /multiple.*proposed/i.test(issue)));
  }
});

test("the explicit new value outranks a model returning the old value", async () => {
  const req = await parse("same as last time, change pass-through from 70% to 50%; price +3%", { pass_through: .7, proposed_change_pct: 50 });
  assert.equal(req.passThrough, .5); assert.equal(req.proposedChangePct, 3);
});

test("an unsigned transition destination preserves a named price or cost reduction", async () => {
  for (const [raw, expectedPrice, expectedCost] of [
    ["same as last time, change the proposed price reduction from 5% to 3%", -3, 8],
    ["지난번과 같은 조건, 가격 인하율을 5%에서 3%로 변경해 주세요", -3, 8],
    ["same as last time, change the cost reduction from 8% to 5%; price +3%", 3, -5],
    ["지난번과 같은 조건, 원가 하락률을 8%에서 5%로 변경; price +3%", 3, -5],
  ] as const) for (const reply of replies({ proposed_change_pct: expectedPrice, cost_increase_pct: expectedCost })) {
    const req = await parse(raw, reply);
    assert.equal(req.proposedChangePct, expectedPrice, raw);
    assert.equal(req.costIncreasePct, expectedCost, raw);
  }
});

test("lowering a rate does not itself make that rate negative and explicit signs still win", async () => {
  for (const raw of [
    "same as last time, lower the proposal from 5% to 3%",
    "same as last time, reduce the price increase from 5% to 3%",
    "지난번과 같은 조건, 가격 인상률을 5%에서 3%로 내려 주세요",
    "same as last time, change the proposed price reduction from 5% to +3%",
  ]) assert.equal((await parse(raw, {})).proposedChangePct, 3, raw);
  const cost = await parse("same as last time, reduce the cost increase from 8% to 5%; price +3%", {});
  assert.equal(cost.costIncreasePct, 5); assert.equal(cost.proposedChangePct, 3);
});

test("transition destinations are validated and invalid destinations never restore old values", async () => {
  const good = await parse("same as last time, change pass-through from 150% to 50%", {});
  assert.equal(good.passThrough, .5); assert.equal(good.invalidPassThrough, undefined);
  for (const [role, old, bad, key] of [
    ["pass-through", 70, -5, "passThrough"], ["cost share", 60, 120, "costSharePct"],
    ["cost increase", 8, -101, "costIncreasePct"], ["price proposal", 5, -101, "proposedChangePct"],
  ] as const) {
    const req = await parse(`same as last time, change ${role} from ${old}% to ${bad}%`, {});
    assert.equal(req[key], undefined, role);
    assert.match(req.inputIssues?.join(" ") ?? "", /invalid|finite|between/i);
    if (role === "pass-through") assert.equal(req.invalidPassThrough, true);
    if (role !== "price proposal") assert.equal(req.proposedChangePct, 5);
  }
});

test("a connector cannot carry a percentage role into a separately named field", async () => {
  for (const raw of [
    "same as last time, cost share 60%, pass through 50%; price +3%",
    "same as last time, cost share from 60% to price +3%",
  ]) {
    const req = await parse(raw, {});
    assert.equal(req.costSharePct, 60); assert.equal(req.proposedChangePct, 3);
    assert.equal(req.passThrough, raw.includes("pass through") ? .5 : undefined);
  }
});

test("real alternatives remain ambiguous instead of being treated as a transition", async () => {
  for (const raw of ["same as last time: +3% or +5%?", "same as last time, price between 3% and 5%", "지난번과 같은 조건, 가격은 +3% 또는 +5%로 검토해요"])
    for (const reply of replies({ proposed_change_pct: 3 })) {
      const req = await parse(raw, reply);
      assert.equal(req.proposedChangePct, undefined, raw);
      assert.match(req.inputIssues?.join(" ") ?? "", /multiple|ambiguous/i);
    }
});

test("a from-to range remains ambiguous rather than becoming a change to its upper endpoint", async () => {
  for (const raw of [
    "DE food: considering a price increase ranging from 3% to 5%",
    "same as last time, considering a price increase anywhere from 3% to 5%",
    "same as last time, considering a price increase in the range from 3% to 5%",
  ]) for (const reply of replies({ proposed_change_pct: 5 })) {
    const req = await parse(raw, reply);
    assert.equal(req.proposedChangePct, undefined, raw);
    assert.match(req.inputIssues?.join(" ") ?? "", /multiple|ambiguous/i);
  }
});

test("the new policy is remembered without replacing the unchanged proposal", async () => {
  const memory = fixtureMemory();
  const previousPolicy = memory.latestPolicy()!.id;
  // An unsupported-only request exercises the real run's memory writes without a data call.
  const agent = new PriceSignalAgent({ memory, hedgeMs: Infinity,
    llm: async () => ({ text: '{"countries":["Japan"],"pass_through":0.5}', model: "fixture", provider: "fixture", ms: 0 }),
    sql: { run: async () => { throw new Error("No SQL is permitted in this fixture"); } },
    discoverFn: async () => { throw new Error("No discovery is permitted in this fixture"); },
  });
  const brief = await agent.run("same as last time, Japan only, change pass-through from 70% to 50%");
  assert.deepEqual(brief.facts, []);
  assert.equal(brief.passThrough, .5);
  assert.equal(memory.latestPolicy()!.policy, .5);
  assert.notEqual(memory.latestPolicy()!.id, previousPolicy);
  assert.equal(memory.lastRequest()!.request.proposedChangePct, 5);
  const repeated = await parse("same as last time", {}, memory);
  assert.equal(repeated.proposedChangePct, 5);
  assert.equal(repeated.costSharePct, 60);
  assert.equal(repeated.costShareBasis, "before_change");
});
