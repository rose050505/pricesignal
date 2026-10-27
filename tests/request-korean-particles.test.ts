// Everyday Korean joins markets with 이랑/하고 and states a recovery policy as "70%만 반영해"; a typo market can
// open the sentence. These were silently misread (independent review, 27 Oct 12:00): a market dropped, the
// policy read as a 70% cost rise, or the +5% proposal discarded as a second proposal.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";

process.env.PSIG_VERBOSE = "0";
const sql = { run: async () => ({ id: "Q1", sql: "", columns: [], rows: [], ms: 0 }) };

async function parse(q: string, model: unknown | "down") {
  const agent = new PriceSignalAgent({
    llm: async () => { if (model === "down") throw new Error("model down"); return { text: JSON.stringify(model), model: "nemotron-fake", provider: "f", ms: 1 }; },
    sql, memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-ko-"))), hedgeMs: Infinity,
  } as any);
  return (agent as any).parse(q);
}

test("markets joined by Korean particles are all kept, with or without the model", async () => {
  for (const [q, names, expected] of [
    ["독일이랑 호주 식품 가격 5% 올려도 될까?", ["독일", "호주"], ["DE", "AU"]],
    ["독일하고 캐나다 식품 +3%", ["독일", "캐나다"], ["DE", "CA"]],
    ["캐나다랑 호주 식품 3% 인상 괜찮아?", ["캐나다", "호주"], ["CA", "AU"]],
    ["독일이나 호주 식품 가격 4% 올려도 될까", ["독일", "호주"], ["DE", "AU"]],
  ] as const) {
    for (const model of [{ countries: names, concept: "food" }, "down"] as const) {
      const r = await parse(q, model);
      assert.deepEqual(r.countries, expected, `${q} (${model === "down" ? "model down" : "model"})`);
    }
  }
});

test("a typo market at the start of the sentence is accepted when the model names it", async () => {
  const r = await parse("germny and austrlia food, can we do +3%?", { countries: ["Germany", "Australia"], concept: "food", proposed_change_pct: 3 });
  assert.ok(r.countries.includes("DE") && r.countries.includes("AU"), r.countries.join(","));
  assert.equal(r.proposedChangePct, 3);
});

test("Korean recovery-policy phrasing is the pass-through, not a cost rise or a second proposal", async () => {
  for (const model of [{ countries: ["독일", "캐나다", "호주"], concept: "food", proposed_change_pct: 5, pass_through: 0.7 }, "down"] as const) {
    const a = await parse("독일, 캐나다, 호주 식품 물가 보고 5% 인상 괜찮을까? 원가 상승분의 70%만 반영해", model);
    assert.equal(a.proposedChangePct, 5);
    assert.equal(a.passThrough, 0.7);
    assert.equal(a.costIncreasePct, undefined);
    const b = await parse("독일·캐나다·호주 식품 +5%, 원가는 8% 올랐고 상승분의 70%를 가격에 반영해요", model);
    assert.equal(b.proposedChangePct, 5);
    assert.equal(b.costIncreasePct, 8);
    assert.equal(b.passThrough, 0.7);
    const c = await parse("독일 식품, 원가 상승분의 70%를 가격에 반영해. 5% 올려도 돼?", model);
    assert.equal(c.proposedChangePct, 5);
    assert.equal(c.passThrough, 0.7);
    assert.equal(c.costIncreasePct, undefined);
  }
});
