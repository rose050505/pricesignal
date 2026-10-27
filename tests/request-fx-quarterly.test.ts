// An exporter mentions exchange rates and quarterly increases. An exchange-rate move must not be read as a second
// price proposal (it used to discard the proposal), and both are acknowledged without new numbers
// (independent Impact review, 27 Oct 13:18).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";

process.env.PSIG_VERBOSE = "0";
async function parse(q: string, model: unknown | "down" = "down") {
  const agent = new PriceSignalAgent({
    llm: async () => { if (model === "down") throw new Error("model down"); return { text: JSON.stringify(model), model: "f", provider: "f", ms: 1 }; },
    sql: { run: async () => ({ id: "Q", sql: "", columns: [], rows: [], ms: 0 }) }, memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-fx-"))), hedgeMs: Infinity,
  } as any);
  return (agent as any).parse(q);
}

test("an exchange-rate move is not a second proposal; it is acknowledged as not used", async () => {
  for (const q of ["DE CA AU food +5%? our costs rose 8% and the euro weakened 4%", "DE CA AU food +5%? costs rose 8%; exchange rate moved 3%", "독일 캐나다 호주 식품 5% 인상 괜찮을까? 원가 8% 올랐고 환율은 3% 올랐어"]) {
    for (const model of ["down", { countries: ["DE", "CA", "AU"], concept: "food", proposed_change_pct: 5, cost_increase_pct: 8 }]) {
      const r = await parse(q, model);
      assert.equal(r.proposedChangePct, 5, q);
      assert.equal(r.costIncreasePct, 8, q);
      assert.ok((r.inputIssues ?? []).some((i: string) => /exchange-rate change was mentioned; exchange rates are not used in this comparison/.test(i)), q);
      assert.ok(!(r.inputIssues ?? []).some((i: string) => /Multiple different proposed/.test(i)), q);
    }
  }
  // A currency code alone is still a price: "raise our EUR prices by 5%".
  const eur = await parse("DE food: can we raise our EUR prices by 5%?");
  assert.equal(eur.proposedChangePct, 5);
  assert.ok(!(eur.inputIssues ?? []).some((i: string) => /exchange-rate/.test(i)));
});

test("a repeated quarterly increase is flagged against the year-on-year benchmark; a start quarter is not", async () => {
  const q = await parse("canada & australia food: +2% every quarter, ok? we pass on 70%");
  assert.equal(q.proposedChangePct, 2);
  assert.ok((q.inputIssues ?? []).some((i: string) => /repeated quarterly increases add up over a year/.test(i)), (q.inputIssues ?? []).join(" | "));
  const start = await parse("DE food: thinking +5% for Q1, too much?");
  assert.ok(!(start.inputIssues ?? []).some((i: string) => /quarterly/.test(i)));
});

test("the result card states the one-off vs one-year premise and that exchange rates are not included", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /It compares a one-off change with about a year of consumer prices; exchange rates are not included\./);
  assert.doesNotMatch(html, /is \+2% enough this quarter\?/);
});

test("an exchange-rate mention or a price phrase in Korean does not turn the proposal into something else (review 27 Oct 14:12)", async () => {
  for (const q of ["환율 때문에 독일 가격 5% 올려도 될까?", "독일 식품, 환율 고려하면 5% 인상 괜찮을까?"]) {
    const r = await parse(q);
    assert.equal(r.proposedChangePct, 5, q);
  }
  for (const q of ["독일 식품 5%를 가격에 반영해도 될까?", "독일 식품 가격 5% 정도 반영할까?"]) {
    const r = await parse(q);
    assert.equal(r.proposedChangePct, 5, q);
    assert.equal(r.passThrough, undefined, q);
  }
  // Still a pass-through when the share of a cost rise is meant.
  const pass = await parse("독일 식품 5% 인상, 원가 상승분의 70%를 가격에 반영해요");
  assert.equal(pass.passThrough, 0.7);
});

test("only a repeated quarterly increase gets the quarterly note, not quarterly CPI or a quarterly review", async () => {
  for (const q of ["australia food: quarterly CPI looks high, is +3% ok?", "australia food: is +3% enough for our quarterly price review?"]) {
    const r = await parse(q);
    assert.ok(!(r.inputIssues ?? []).some((i: string) => /repeated quarterly increase/.test(i)), q);
  }
  const r = await parse("australia food: quarterly increases of +2%, ok?");
  assert.ok((r.inputIssues ?? []).some((i: string) => /repeated quarterly increase/.test(i)));
});
