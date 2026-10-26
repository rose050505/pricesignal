import test from "node:test";
import assert from "node:assert/strict";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { HMEM } from "../src/hmem_impl.ts";

function memoryOnly() {
  const memory = Object.create(AgentMemory.prototype) as AgentMemory;
  (memory as any).hmem = new HMEM();
  return memory;
}
async function parse(raw: string, reply: object | Error = new Error("offline fixture"), memory = memoryOnly()) {
  return new PriceSignalAgent({ memory, hedgeMs: Infinity,
    llm: async () => { if (reply instanceof Error) throw reply; return { text: JSON.stringify(reply), model: "fake", provider: "fake", ms: 0 }; },
    sql: { run: async () => { throw new Error("Parser must not call SQL"); } },
  }).parse(raw);
}
const models = (value: number) => [{ countries: ["Germany"], proposed_change_pct: value }, { proposed_change_pct: null }, new Error("offline")];

test("fractional percentages preserve their entire number and explicit sign", async () => {
  for (const [literal, expected] of [["+.5", .5], ["-.5", -.5], ["+0,5", .5], ["−0,5", -.5], ["+2,5", 2.5]] as const)
    for (const model of models(expected)) assert.equal((await parse(`Germany food: thinking ${literal}%?`, model)).proposedChangePct, expected, literal);
  const r = await parse("DE food. Costs rose 8,5%. Unit costs are 60,5% of selling price. Pass on 70,5%. Price -.5%.");
  assert.equal(r.costIncreasePct, 8.5); assert.equal(r.costSharePct, 60.5); assert.equal(r.passThrough, .705); assert.equal(r.proposedChangePct, -.5);
});

test("past price changes cannot replace the new proposal even when the model fails", async () => {
  for (const model of models(3)) {
    for (const raw of ["Canada food: last year we raised prices +8%. Thinking +3% now?", "Canada food: thinking +3% now; last year prices rose +8%."])
      assert.equal((await parse(raw, model)).proposedChangePct, 3, raw);
  }
});

test("tax, VAT, margin and observed inflation percentages are not proposed price changes", async () => {
  for (const raw of ["Canada food: VAT is 20%. Thinking +3%?", "Canada food: target margin 30%, tax 5%; thinking +3%?", "Canada food: inflation is 2%. Thinking +3%?"])
    assert.equal((await parse(raw, { proposed_change_pct: 20 })).proposedChangePct, 3, raw);
  assert.equal((await parse("Canada food: our margin is 30%, VAT 20%.")).proposedChangePct, undefined);
});

test("a market topic cannot swallow an explicit price proposal and Korean signs need no separating space", async () => {
  for (const raw of ["Germany food inflation: can we raise prices +3%?", "Germany CPI: thinking +3%?", "독일 식품 물가, 가격은−2%로", "독일 식품 가격은+.5%?"]) {
    const expected = raw.includes("−2") ? -2 : raw.includes(".5") ? .5 : 3;
    assert.equal((await parse(raw)).proposedChangePct, expected, raw);
  }
});

test("ambiguous competing proposals are omitted instead of choosing or recalling one", async () => {
  const memory = memoryOnly();
  memory.rememberRequest({ countries: ["CA"], concept: "food", conceptWords: [], proposedChangePct: 4, raw: "earlier" });
  for (const model of models(3)) {
    const r = await parse("same as last time: +3% or +5%?", model, memory);
    assert.equal(r.proposedChangePct, undefined);
    assert.match(r.inputIssues?.join(" ") ?? "", /multiple|ambiguous|one.*proposal/i);
  }
});

test("explicit countries survive wrong model countries including Korean particles and aliases", async () => {
  for (const [raw, expected] of [["Canada food +3%", ["CA"]], ["deutschland & aus food +3%", ["DE", "AU"]], ["독일과 캐나다에서 식품 가격 +3%", ["DE", "CA"]]] as const) {
    const r = await parse(raw, { countries: ["France"], proposed_change_pct: 3 });
    assert.deepEqual(r.countries, [...expected]); assert.deepEqual(r.unknownCountries, []);
  }
  const mixed = await parse("Canada and Japan food +3%", { countries: ["Germany", "Japan", "Brazil"] });
  assert.deepEqual(mixed.countries, ["CA"]); assert.deepEqual(mixed.unknownCountries, ["Japan"]);
  const typo = await parse("canda food +3%", { countries: ["canda"] });
  assert.deepEqual(typo.countries, ["CA"]);
  assert.deepEqual((await parse("cannada food +3%", { countries: ["Canada"] })).countries, ["CA"]);
  assert.deepEqual((await parse("Germany and cannada food +3%", { countries: ["Canada"] })).countries, ["DE", "CA"]);
  const ordinary = await parse("inland freight is a pain; food prices +3%", { countries: ["Finland", "Spain"] });
  assert.deepEqual(ordinary.countries, ["DE", "CA", "AU"]);
  assert.deepEqual((await parse("Canada and Japan food +3%", { countries: ["France"] })).unknownCountries, ["Japan"]);
  const korean = await parse("독일과 일본 식품 가격 +3%", { countries: ["France", "Japan"] });
  assert.deepEqual(korean.countries, ["DE"]); assert.deepEqual(korean.unknownCountries, ["Japan"]);
});

test("invalid explicit changes cannot produce negative prices or resurrect remembered values", async () => {
  const memory = memoryOnly();
  memory.rememberRequest({ countries: ["DE"], concept: "food", conceptWords: [], proposedChangePct: 4, costIncreasePct: 8, costSharePct: 60, raw: "earlier" });
  for (const value of ["-101", "-150", "Infinity", "1e309", "9".repeat(400)]) {
    const r = await parse(`same as last time. Price ${value}%. Costs changed ${value}%.`, {}, memory);
    assert.equal(r.proposedChangePct, undefined, value); assert.equal(r.costIncreasePct, undefined, value);
    assert.equal(r.costRemembered, undefined); assert.match(r.inputIssues?.join(" ") ?? "", /finite|-100|invalid/i);
  }
  for (const value of [-100, 0, 200]) {
    const r = await parse(`DE food. Price ${value}%. Costs changed ${value}%.`);
    assert.equal(r.proposedChangePct, value); assert.equal(r.costIncreasePct, value);
  }
});

test("cost-share timing comes from explicit text, never a model-only basis", async () => {
  const cases: [string, string][] = [
    ["Costs rose 8%. Before the increase, unit costs were 60% of selling price.", "before_change"],
    ["Costs rose 8%. After the increase, unit costs are 60% of selling price.", "after_change"],
    ["Costs rose 8%. Current unit costs are 60% of selling price.", "after_change"],
    ["Costs will rise 8%. Current unit costs are 60% of selling price.", "before_change"],
    ["Costs rose 8%, we will raise prices 3% next quarter. Current unit costs are 60% of selling price.", "after_change"],
    ["원가가 8% 올랐습니다. 현재 원가 비중은 판매가의 60%입니다.", "after_change"],
    ["원가가 8% 오를 예정입니다. 현재 원가 비중은 판매가의 60%입니다.", "before_change"],
  ];
  for (const [raw, basis] of cases) assert.equal((await parse(`DE food. ${raw} Price +3%.`) as any).costShareBasis, basis, raw);
  const ambiguous: any = await parse("DE food. Cost share 60%. Costs +8%. Price +3%.", { cost_share_basis: "after_change" });
  assert.equal(ambiguous.costShareBasis, undefined);
  assert.match(ambiguous.inputIssues?.join(" ") ?? "", /assum.*before|before.*assum/i);
});

test("same-as-last recalls share timing but a new share does not inherit the old basis", async () => {
  const memory = memoryOnly();
  const first = await parse("DE food. Costs rose 8%. After the increase, unit costs are 60% of selling price. Price +3%.");
  memory.rememberRequest(first);
  const repeat: any = await parse("same as last time, but +4%", {}, memory);
  assert.equal(repeat.costSharePct, 60); assert.equal(repeat.costShareBasis, "after_change");
  const changed: any = await parse("same as last time, but cost share 70%", {}, memory);
  assert.equal(changed.costSharePct, 70); assert.equal(changed.costShareBasis, undefined);
  assert.match(changed.inputIssues?.join(" ") ?? "", /assum/i);
  const basisOnly: any = await parse("same as last time, but the cost share is before the increase", {}, memory);
  assert.equal(basisOnly.costSharePct, 60); assert.equal(basisOnly.costShareBasis, "before_change");
  const legacy = memoryOnly();
  legacy.rememberRequest({ countries: ["DE"], concept: "food", conceptWords: [], costSharePct: 60, raw: "legacy" });
  assert.equal((await parse("same as last time, +3%", {}, legacy) as any).costShareBasis, undefined);
  const next: any = await parse("same as last time, but costs will rise 5% next quarter", {}, memory);
  assert.equal(next.costSharePct, 60); assert.equal(next.costShareBasis, "before_change");
  assert.match(next.inputIssues?.join(" ") ?? "", /new future cost change/i);
});

test("a same-as-last-quarter instruction does not turn the new proposal into a historical observation", async () => {
  const memory=memoryOnly();
  memory.rememberRequest({countries:["DE"],concept:"food",conceptWords:[],proposedChangePct:5,raw:"earlier"});
  for(const raw of ["지난 분기와 같은 조건으로 가격은 +4% 검토합니다", "same as last quarter thinking +4%"]){
    for(const model of [{proposed_change_pct:4},new Error("offline")]) assert.equal((await parse(raw,model,memory)).proposedChangePct,4,raw);
  }
});

test("post-change explicitly changes the remembered cost basis or defines a new one", async () => {
  const memory=memoryOnly();
  memory.rememberRequest({countries:["DE"],concept:"food",conceptWords:[],costIncreasePct:8,costSharePct:60,costShareBasis:"before_change",raw:"earlier"});
  const corrected=await parse("same as last time, but cost share is post-change",{},memory);
  assert.equal(corrected.costShareBasis,"after_change");
  const fresh=await parse("DE food. Costs rose 8%. Post-change cost share 60%. Price +4%.");
  assert.equal(fresh.costShareBasis,"after_change");
});
