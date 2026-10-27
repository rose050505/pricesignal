// A proposal written as a range ("3-4%") or in words ("four percent") used to vanish without a word
// (independent judge review, 27 Oct 14:00). A range is reported, like several proposals; a number word is used
// only when Nemotron read the same number from the request.
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
    llm: async () => { if (model === "down") throw new Error("model down"); return { text: JSON.stringify(model), model: "nvidia/nemotron-fake", provider: "f", ms: 1 }; },
    sql: { run: async () => ({ id: "Q", sql: "", columns: [], rows: [], ms: 0 }) }, memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-range-"))), hedgeMs: Infinity,
  } as any);
  const r = await (agent as any).parse(q);
  return { r, trace: agent.trace };
}

test("a proposed range is reported instead of silently dropped or narrowed to one end", async () => {
  for (const q of ["Can we raise prices by 3-4% in Australia?", "Can we raise prices by 3 to 4% in Australia?", "raise australia prices 3–4%?"]) {
    const { r } = await parse(q, { countries: ["AU"], concept: "food", proposed_change_pct: 4 });
    assert.equal(r.proposedChangePct, undefined, q);
    assert.ok((r.inputIssues ?? []).some((i: string) => /A range of proposed changes was given/.test(i)), q);
  }
  // A cost or pass-through range is not a proposal range.
  const { r } = await parse("australia food +5%? our costs rose 3-4%");
  assert.equal(r.proposedChangePct, 5);
  assert.ok(!(r.inputIssues ?? []).some((i: string) => /range of proposed/.test(i)));
});

test("a proposal in words is used only when Nemotron read the same number, and the trace says so", async () => {
  const { r, trace } = await parse("australia food, thinking of four percent", { countries: ["AU"], concept: "food", proposed_change_pct: 4 });
  assert.equal(r.proposedChangePct, 4);
  assert.ok(trace.some((e: any) => /proposal read by Nemotron from words: "four percent" -> \+4%/.test(e.title)));
  const disagree = await parse("australia food, thinking of four percent", { countries: ["AU"], concept: "food", proposed_change_pct: 6 });
  assert.equal(disagree.r.proposedChangePct, undefined);
  const down = await parse("australia food, thinking of four percent");
  assert.equal(down.r.proposedChangePct, undefined);
});

test("an observed or cost range is not a proposal range, wherever the cost word stands (review 27 Oct 14:12)", async () => {
  for (const [q, prop] of [
    ["german food prices rose 3-4% last year. can we raise prices +5%?", 5],
    ["DE food: HICP is running 3-4%, thinking +5% for Q1", 5],
    ["australia food: our 8-10% cost increase, we pass on 70%. thinking +5%", 5],
    ["canada food +4%? 60-70% pass-through", 4],
  ] as const) {
    const { r } = await parse(q, { countries: ["DE"], concept: "food", proposed_change_pct: prop });
    assert.equal(r.proposedChangePct, prop, q);
    assert.ok(!(r.inputIssues ?? []).some((i: string) => /range of proposed/.test(i)), q);
  }
});
