import test from "node:test";
import assert from "node:assert/strict";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { HMEM } from "../src/hmem_impl.ts";

const liveQuestion = "our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot?? our costs rose 8%, unit costs are 60% of our selling price. we pass on ~70% of cost increases. thinking +5% for Q1, too much?";

async function parse(raw: string, reply: Record<string, unknown> | Error = new Error("offline fixture")) {
  const memory = Object.create(AgentMemory.prototype);
  memory.hmem = new HMEM();
  return new PriceSignalAgent({
    memory, hedgeMs: Infinity,
    llm: async () => {
      if (reply instanceof Error) throw reply;
      return { text: JSON.stringify(reply), model: "fixture", provider: "fixture", ms: 0 };
    },
    sql: { run: async () => { throw new Error("Unexpected SQL in parser test"); } },
  }).parse(raw);
}

const models = {
  correct: { countries: ["DE", "CA", "AU"], concept: "food", proposed_change_pct: 5, cost_increase_pct: 8, cost_share_pct: 60, pass_through: 0.7 },
  null: { countries: ["DE", "CA", "AU"], concept: "food", proposed_change_pct: null, cost_increase_pct: null, cost_share_pct: null, pass_through: null },
  failure: new Error("offline model failure"),
};

for (const [mode, model] of Object.entries(models)) {
  test(`the live period-separated question retains its 5% proposal with a ${mode} model reply`, async () => {
    const request = await parse(liveQuestion, model);
    assert.equal(request.proposedChangePct, 5);
    assert.equal(request.costIncreasePct, 8);
    assert.equal(request.costSharePct, 60);
    assert.equal(request.passThrough, 0.7);
    assert.equal(request.concept, "food");
    assert.deepEqual(request.countries, ["DE", "CA", "AU"]);
  });
}

test("a later price proposal cannot replace the cost increase when the model provides no trustworthy cost", async () => {
  for (const model of [models.null, models.failure, { ...models.correct, proposed_change_pct: null, cost_increase_pct: 5 }]) {
    const request = await parse(liveQuestion, model);
    assert.equal(request.costIncreasePct, 8, "the final +5% belongs to prices, never costs");
    assert.equal(request.proposedChangePct, 5);
  }
});

test("decimal points in both surrounding context and percentages are preserved across sentences", async () => {
  const request = await parse("DE food. Our costs for recipe 8.5 rose 8.5%. Unit costs are 60.5% of our selling price. We pass on 70.5% of cost increases. Thinking +5.5% for Q1?");
  assert.equal(request.costIncreasePct, 8.5);
  assert.equal(request.costSharePct, 60.5);
  assert.equal(request.passThrough, 0.705);
  assert.equal(request.proposedChangePct, 5.5);
});

test("explicit plus and minus signs survive sentence boundaries without reversing cost changes", async () => {
  for (const [proposal, expected] of [["+2.25", 2.25], ["-2.25", -2.25], ["−2.25", -2.25], ["＋2.25", 2.25]] as const) {
    const request = await parse(`DE food. Costs rose 8.5%. Unit costs are 60% of selling price. We pass on 70% of cost increases. Prices ${proposal}% next quarter.`, { ...models.correct, proposed_change_pct: 2.25 });
    assert.equal(request.costIncreasePct, 8.5);
    assert.equal(request.costSharePct, 60);
    assert.equal(request.passThrough, 0.7);
    assert.equal(request.proposedChangePct, expected);
  }
});

test("Korean sentence endings separate cost recovery from the proposed price change", async () => {
  for (const model of [models.null, models.failure]) {
    const request = await parse("독일 식품 물가. 원가가 8.5% 올랐습니다. 원가 비중은 판매가의 60%입니다. 원가 증가분은 70% 반영합니다. 가격은 −2.25% 내릴까요?", model);
    assert.equal(request.costIncreasePct, 8.5);
    assert.equal(request.costSharePct, 60);
    assert.equal(request.passThrough, 0.7);
    assert.equal(request.proposedChangePct, -2.25);
  }
});

test("common approximation abbreviations do not erase the percentage's cost or denominator context", async () => {
  for (const abbreviation of ["approx.", "e.g.", "i.e."]) {
    const request = await parse(`DE food. Costs rose ${abbreviation} 8.5%. Unit costs are ${abbreviation} 60% of selling price. We pass on 70% of cost increases. Price +5%.`);
    assert.equal(request.costIncreasePct, 8.5, abbreviation);
    assert.equal(request.costSharePct, 60, abbreviation);
    assert.equal(request.passThrough, 0.7, abbreviation);
    assert.equal(request.proposedChangePct, 5, abbreviation);
  }
});
