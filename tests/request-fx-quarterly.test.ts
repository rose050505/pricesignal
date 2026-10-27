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
