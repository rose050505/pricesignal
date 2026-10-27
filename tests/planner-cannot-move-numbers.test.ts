// The planner proposes discovery actions; code validates and completes them. Whatever the planner replies (a good
// batch, prose, an early finish, an invented market) or if the model is down, the markets, figures and verdicts are
// the same, because every number comes from the Zetaris rows (independent review, 27 Oct 12:00).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";

process.env.PSIG_VERBOSE = "0";

function rows(): unknown[][] {
  const out: unknown[][] = [];
  for (const [c, k, l, base] of [["DE", "food", "Food and non-alcoholic beverages", 2.0], ["DE", "all_items", "Total", 2.2], ["CA", "food", "Food", 3.4], ["CA", "all_items", "All-items", 2.4], ["AU", "food", "Food and non-alcoholic beverages", 3.0], ["AU", "all_items", "All groups CPI", 2.9]] as const)
    for (let m = 1; m <= 9; m++) out.push([c, k, l, "M", `2026-0${m}`, Math.round((base + m * 0.05) * 100) / 100, `${c}:${k}`]);
  return out;
}
const z = {
  async run(sql: string) {
    if (/SELECT DISTINCT country, sku_category/.test(sql)) return { id: "Q", sql, columns: ["country", "sku_category", "product"], rows: [], ms: 1 };
    if (/^SELECT COUNT/.test(sql)) return { id: "Q", sql, columns: ["n", "latest"], rows: [[9, "2026-09"]], ms: 1 };
    if (/^SELECT country/.test(sql)) return { id: "Q", sql, columns: ["country", "concept", "category_label", "frequency", "period", "yoy_pct", "source_id"], rows: rows(), ms: 1 };
    return { id: "Q", sql, columns: [], rows: [], ms: 1 };
  },
};
const ok = (text: string) => ({ text, model: "nvidia/nemotron-fake", provider: "fake", ms: 1 });
const QUESTION = "is food inflation in deutschland, canada & aus still running hot? we pass on ~70% of cost increases. thinking +5%, too much?";
const PARSE = '{"countries":["deutschland","canada","aus"],"concept":"food","concept_words":["food"],"proposed_change_pct":5,"pass_through":0.7}';

const planners: Record<string, ((last: string) => ReturnType<typeof ok>) | "down"> = {
  "a good batch": (last) => {
    const task = last.startsWith("Task: ") ? JSON.parse(last.slice(6)) : null;
    return ok(task ? JSON.stringify({ actions: task.needed.map((p: unknown) => ({ action: "discover_and_onboard", args: p })) }) : '{"actions":[{"action":"finish","args":{}}]}');
  },
  "prose instead of JSON": () => ok("Sure! A 5% increase sounds reasonable for Germany."),
  "an immediate finish": () => ok('{"actions":[{"action":"finish","args":{}}]}'),
  "an invented market": () => ok('{"actions":[{"action":"discover_and_onboard","args":{"country":"JP","concept":"food"}},{"action":"compare","args":{}},{"action":"finish","args":{}}]}'),
  "the model down": "down",
};

async function outcome(planner: ((last: string) => ReturnType<typeof ok>) | "down") {
  const llm = async (messages: any[]) => {
    const last = messages.at(-1).content as string;
    if (last.startsWith("Extract the pricing request")) return planner === "down" ? Promise.reject(new Error("HTTP 502")) : ok(PARSE);
    if (planner === "down") throw new Error("HTTP 502: provider down");
    if (messages[0].content.startsWith("You are PriceSignal")) return planner(last);
    return ok("not json");
  };
  const agent = new PriceSignalAgent({
    llm, sql: z as any, memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-planner-"))), hedgeMs: Infinity, compareRetryMs: 0,
    discoverFn: async (country: any, concept: string) => ({ country, concept, candidates: [{ agency: country === "DE" ? "eurostat" : country === "CA" ? "statcan" : "abs", country, dataset: "d", code: concept, label: concept === "food" ? "Food" : "All-items", frequency: "M", measure: "index", status: "active", sourceUrl: "https://x" }], notes: [] }),
    onboardFn: async (_z: any, c: any, concept: string) => ({ view: `v_${c.country.toLowerCase()}_${concept}`, table: "t", ok: true, existed: false, rows: 9, latest: "2026-09", sql: [] }),
  } as any);
  const b = await agent.run(QUESTION);
  return {
    views: b.views.map((v: any) => v.view).sort(),
    facts: b.facts.map((f: any) => [f.country, f.category?.latestYoy, f.suggested?.low, f.suggested?.high, f.verdict]),
  };
}

test("the planner's reply cannot change the markets, the figures or the verdicts", async () => {
  const reference = await outcome(planners["a good batch"]);
  assert.equal(reference.facts.length, 3);
  assert.equal(reference.views.length, 6);
  for (const [name, planner] of Object.entries(planners)) assert.deepEqual(await outcome(planner), reference, name);
});
