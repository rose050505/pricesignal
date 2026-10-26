// Offline test of the agent loop: scripted model, fake Zetaris, fake agencies.
// Proves: messy request -> discover -> onboard -> one federated SQL -> grounded brief,
// and that the second run reuses H-MEM mappings instead of discovering again.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent, extractJson } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import type { SqlResult, SqlRunner } from "../src/zetaris.ts";
import type { Candidate } from "../src/sources/types.ts";
import { checkNarrative } from "../src/brief.ts";

function fakeRows(): unknown[][] {
  const rows: unknown[][] = [];
  const series: [string, string, string, number][] = [["DE", "food", "Food and non-alcoholic beverages", 2.0], ["DE", "all_items", "Total", 2.2], ["CA", "food", "Food", 3.4], ["CA", "all_items", "All-items", 2.4], ["AU", "food", "Food and non-alcoholic beverages", 3.0], ["AU", "all_items", "All groups CPI", 2.9]];
  for (const [c, k, l, base] of series) for (let m = 1; m <= 9; m++) rows.push([c, k, l, "M", `2026-0${m}`, Math.round((base + m * 0.05) * 100) / 100, `${c}:${k}`]);
  return rows;
}

class FakeZ implements SqlRunner {
  n = 0;
  sqls: string[] = [];
  async run(sql: string): Promise<SqlResult> {
    this.sqls.push(sql);
    const id = `Q${++this.n}`;
    if (/^SELECT COUNT/.test(sql)) return { id, sql, columns: ["n", "latest"], rows: [[9, "2026-09"]], ms: 1 };
    if (/UNION ALL|FROM psig\.v_/.test(sql) && /^SELECT country/.test(sql)) return { id, sql, columns: ["country", "concept", "category_label", "frequency", "period", "yoy_pct", "source_id"], rows: fakeRows(), ms: 2 };
    return { id, sql, columns: [], rows: [], ms: 1 };
  }
}

const cand = (country: any, concept: string): Candidate => ({ agency: country === "DE" ? "eurostat" : country === "CA" ? "statcan" : "abs", country, dataset: "d", code: concept, label: concept, frequency: "M", measure: "index", status: "active", sourceUrl: "https://x" });

function scriptedLlm(): any {
  return async (messages: any[]) => {
    const last = messages.at(-1).content as string;
    if (last.startsWith("Extract the pricing request")) return { text: '{"countries":["deutschland","canada","aus"],"concept":"food","concept_words":["food"],"proposed_change_pct":5,"pass_through":0.7,"policy_statement":"we pass on 70%"}', model: "fake", provider: "fake", ms: 1 };
    if (messages[0].content.startsWith("You write short")) return { text: '{"headline":"Food inflation is 2.5-3.9%, so +5% is above the evidence everywhere.","markets":{"DE":"Food 2.5%."},"watch":"Re-check next month."}', model: "fake", provider: "fake", ms: 1 };
    // planner: let the deterministic order emerge from "Still missing"
    const miss = last.match(/Still missing: (\[.*\])/);
    const missing = miss ? JSON.parse(miss[1]) : JSON.parse(last.replace(/^Task: /, "")).needed;
    if (!missing.length) return { text: last.includes('"id":"Q') && last.includes("latest") && !last.includes('"view"') ? '{"action":"finish","args":{}}' : '{"action":"compare","args":{}}', model: "fake", provider: "fake", ms: 1 };
    const p = missing[0];
    if (last.includes('"candidates"')) return { text: JSON.stringify({ action: "onboard_series", args: { ...p, candidate: 0 } }), model: "fake", provider: "fake", ms: 1 };
    return { text: JSON.stringify({ action: "discover_series", args: p }), model: "fake", provider: "fake", ms: 1 };
  };
}

test("extractJson tolerates fences and thinking", () => {
  assert.deepEqual(extractJson('```json\n{"a":{"b":"}"}}\n```'), { a: { b: "}" } });
});

test("narrative grounding rejects invented numbers", () => {
  assert.deepEqual(checkNarrative({ headline: "Food up 2.5% in 2026-09", markets: { DE: "4.7% risk" } }, [2.5]), ["4.7"]);
});

test("end-to-end offline, then memory reuse", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psig-"));
  const memory = new AgentMemory(dir);
  let discovers = 0;
  const deps = () => ({
    llm: scriptedLlm(),
    sql: new FakeZ(),
    memory,
    discoverFn: async (country: any, concept: string) => {
      discovers++;
      return { country, concept, candidates: [cand(country, concept)], notes: country === "DE" ? ["Eurostat prc_hicp_manr is discontinued (last period 2025-12); replaced by prc_hicp_minr."] : [] };
    },
    onboardFn: async (_z: any, c: Candidate, concept: string) => ({ view: `v_${c.country.toLowerCase()}_${concept}`, table: "t", ok: true, existed: false, rows: 9, latest: "2026-09", sql: [] }),
  });
  const a1 = new PriceSignalAgent(deps());
  const b1 = await a1.run("our gochujang & snacks: is food inflation in deutschland, canada & aus still hot? thinking +5% for Q1, we pass on 70%");
  assert.equal(b1.facts.length, 3);
  assert.ok(b1.facts.every((f) => f.category && f.suggested), "every market has computed facts");
  assert.equal(b1.facts[0].verdict, "above the evidence");
  assert.match(b1.markdown!, /discontinued/);
  assert.equal(discovers, 6);

  const a2 = new PriceSignalAgent({ ...deps(), llm: async (m: any[]) => {
    const last = m.at(-1).content as string;
    if (last.startsWith("Extract")) return { text: '{"countries":["DE","CA","AU"],"concept":"food","proposed_change_pct":5}', model: "f", provider: "f", ms: 1 };
    if (m[0].content.startsWith("You write short")) return { text: "not json", model: "f", provider: "f", ms: 1 };
    const miss = last.match(/Still missing: (\[.*\])/);
    const missing = miss ? JSON.parse(miss[1]) : JSON.parse(last.replace(/^Task: /, "")).needed;
    if (!missing.length) return { text: last.includes('"latest":{') ? '{"action":"finish","args":{}}' : '{"action":"compare","args":{}}', model: "f", provider: "f", ms: 1 };
    return { text: JSON.stringify({ action: "use_memory_mapping", args: missing[0] }), model: "f", provider: "f", ms: 1 };
  } });
  const b2 = await a2.run("same question again, DE CA AU food +5%");
  assert.equal(discovers, 6, "second run did not discover again");
  assert.ok(b2.views.every((v) => v.via === "memory"));
  assert.equal(b2.passThrough, 0.7, "policy recalled from H-MEM");
  assert.match(b2.markdown!, /Narrative omitted/);
});
