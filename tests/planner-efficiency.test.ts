// Example 03 on 27 Oct 23:24 spent 7 planner turns and 52 s before its numbers: Nemotron planned onboard_series for a pair
// it had not discovered (one wasted turn each time), and slow replies kept the loop going.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import type { SqlResult, SqlRunner } from "../src/zetaris.ts";
import type { Candidate } from "../src/sources/types.ts";

class FakeZ implements SqlRunner {
  n = 0;
  async run(sql: string): Promise<SqlResult> {
    const id = `Q${++this.n}`;
    if (/^SELECT COUNT/.test(sql)) return { id, sql, columns: ["n", "latest"], rows: [[12, "2026-09"]], ms: 1 };
    if (/^SELECT country/.test(sql)) {
      const rows: unknown[][] = [];
      for (const k of ["food", "all_items"]) for (let m = 1; m <= 9; m++) rows.push(["CA", k, k, "M", `2026-0${m}`, 2 + m / 10, `CA:${k}`]);
      return { id, sql, columns: ["country", "concept", "category_label", "frequency", "period", "yoy_pct", "source_id"], rows, ms: 1 };
    }
    return { id, sql, columns: [], rows: [], ms: 1 };
  }
}
const cand = (country: any, concept: string): Candidate => ({ agency: "statcan", country, dataset: "18100004", code: concept, label: concept === "all_items" ? "All-items" : "Food", frequency: "M", measure: "index", status: "active", sourceUrl: "https://x" });

function agent(planner: (turn: number) => Promise<string>, extra: Record<string, unknown> = {}) {
  let turns = 0;
  const llm = async (messages: any[]) => {
    const last = messages.at(-1).content as string;
    if (last.startsWith("Extract the pricing request")) return { text: '{"countries":["canada"],"concept":"food","proposed_change_pct":4}', model: "fake", provider: "fake", ms: 1 };
    if (messages[0].content.startsWith("You write short")) return { text: "not json", model: "fake", provider: "fake", ms: 1 };
    return { text: await planner(++turns), model: "fake", provider: "fake", ms: 1 };
  };
  const a = new PriceSignalAgent({ llm: llm as any, sql: new FakeZ(), memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-plan-"))), hedgeMs: Infinity,
    discoverFn: async (country: any, concept: string) => ({ country, concept, candidates: [cand(country, concept)], notes: [] }) as any,
    onboardFn: async (_z: any, c: Candidate, concept: string) => ({ view: `v_${c.country.toLowerCase()}_${concept}`, table: "t", ok: true, existed: false, rows: 12, latest: "2026-09", sql: [] }) as any,
    ...extra });
  return { a, turns: () => turns };
}

test("onboarding planned before discovery is discovered and onboarded in the same turn", async () => {
  const { a, turns } = agent(async (turn) => turn === 1
    ? '{"actions":[{"action":"discover_series","args":{"country":"CA","concept":"food"}},{"action":"onboard_series","args":{"country":"CA","concept":"all_items","candidate":0}}]}'
    : '{"actions":[{"action":"onboard_series","args":{"country":"CA","concept":"food","candidate":0}}]}');
  const b = await a.run("canada food prices, ok to raise 4%?");
  assert.ok(a.trace.some((e) => /CA all_items: onboarding was planned before discovery - discovering and onboarding it now/.test(e.title)));
  assert.ok(b.views.some((v) => /all_items/.test(v.view)), "all-items onboarded without another planner turn");
  assert.equal(turns(), 2, "one turn to discover food and (now) onboard all-items, one to onboard food; compare and finish need no turn");
});

test("slow planner replies stop asking the planner once their total passes the budget", async () => {
  // Each reply takes 40 ms and discovers one thing only; with a 60 ms budget the rest is completed in code.
  const { a, turns } = agent(async () => { await new Promise((r) => setTimeout(r, 40)); return '{"actions":[{"action":"recall_memory","args":{"query":"CA food"}}]}'; }, { planBudgetMs: 60 });
  const b = await a.run("canada food prices, ok to raise 4%?");
  assert.ok(a.trace.some((e) => /planner replies took \d+ s in total - completing the remaining series deterministically/.test(e.title)));
  assert.equal(turns(), 2);
  assert.equal(b.facts.length, 1);
  assert.ok(b.facts[0].category, "the market is still answered");
});

test("a pair named twice in one batch is onboarded once and not reported as reused from memory", async () => {
  const { a } = agent(async () => '{"actions":[{"action":"discover_and_onboard","args":{"country":"CA","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"CA","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"CA","concept":"all_items"}}]}');
  const b = await a.run("canada food prices, ok to raise 4%?");
  assert.ok(a.trace.some((e) => /CA food already has a view in this run - skipped the repeated discover_and_onboard/.test(e.title)));
  assert.ok(b.views.every((v) => v.via === "onboarded"), JSON.stringify(b.views));
  assert.equal(b.metrics?.reusedViews, 0);
});

test("a planner that wants to compare before anything is onboarded gets its series onboarded instead (example 01, 27 Oct)", async () => {
  const { a, turns } = agent(async (turn) => turn === 1 ? '{"thought":"All pairs are already onboarded from prior turns","actions":[{"action":"compare","args":{}}]}' : '{"actions":[{"action":"finish","args":{}}]}');
  const b = await a.run("canada food prices, ok to raise 4%?");
  assert.ok(a.trace.some((e) => /planner proposed compare while 2 needed series were not onboarded yet - onboarding them first, without another planner turn/.test(e.title)));
  assert.equal(b.views.length, 2);
  assert.equal(turns(), 1, "the comparison and finish need no second planner turn");
});
