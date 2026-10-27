// The market comparison reads one business-facing Zetaris schemastore view over the agency views of this run
// (Zetaris's semantic layer is built from such views); if it cannot be created, the direct UNION ALL query is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { marketSemanticView, semanticCompareSql } from "../src/sources/index.ts";
import type { SqlResult, SqlRunner } from "../src/zetaris.ts";

process.env.PSIG_VERBOSE = "0";

function fakeRows(): unknown[][] {
  const rows: unknown[][] = [];
  for (const [c, k, l, base] of [["DE", "food", "Food", 2.0], ["DE", "all_items", "Total", 2.2], ["AU", "food", "Food", 3.0], ["AU", "all_items", "All groups CPI", 2.9]] as const)
    for (let m = 1; m <= 9; m++) rows.push([c, k, l, "M", `2026-0${m}`, Math.round((base + m * 0.05) * 100) / 100, `${c}:${k}`]);
  return rows;
}
class FakeZ implements SqlRunner {
  sqls: string[] = [];
  constructor(private failSemantic = false) {}
  async run(sql: string): Promise<SqlResult> {
    this.sqls.push(sql);
    if (this.failSemantic && /^CREATE OR REPLACE SCHEMASTORE VIEW/.test(sql)) throw new Error("Zetaris HTTP 400: not permitted");
    if (/^SELECT COUNT/.test(sql)) return { id: "x", sql, columns: ["n", "latest"], rows: [[9, "2026-09"]], ms: 1 };
    if (/^SELECT country/.test(sql)) return { id: "x", sql, columns: ["country", "concept", "category_label", "frequency", "period", "yoy_pct", "source_id"], rows: fakeRows(), ms: 2 };
    return { id: "x", sql, columns: [], rows: [], ms: 1 };
  }
}
const cand = (country: any, concept: string) => ({ agency: country === "DE" ? "eurostat" : "abs", country, dataset: "d", code: concept, label: concept, frequency: "M", measure: "index", status: "active", sourceUrl: "https://example.test" });
const ok = (text: string) => ({ text, model: "f", provider: "f", ms: 1 });
function agentWith(z: FakeZ) {
  return new PriceSignalAgent({
    llm: (async (m: any[]) => {
      const last = m.at(-1).content as string;
      if (last.startsWith("Extract")) return ok('{"countries":["DE","AU"],"concept":"food","concept_words":["food"],"proposed_change_pct":5}');
      if (m[0].content.startsWith("You write short")) return ok('{"headline":"Historical market comparison","markets":{},"watch":"Re-check next month."}');
      return ok('{"actions":[{"action":"discover_and_onboard","args":{"country":"DE","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"DE","concept":"all_items"}},{"action":"discover_and_onboard","args":{"country":"AU","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"AU","concept":"all_items"}}]}');
    }) as any,
    sql: z, memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-semantic-"))), hedgeMs: Infinity, compareRetryMs: 0,
    discoverFn: async (country: any, concept: string) => ({ country, concept, candidates: [cand(country, concept)], notes: [] }),
    onboardFn: async (_z: any, c: any, concept: string) => ({ view: `v_${c.country.toLowerCase()}_${concept}`, table: "t", ok: true, existed: false, rows: 9, latest: "2026-09", sql: [] }),
  } as any);
}

test("the semantic view name depends only on the set of member views, and its query reads that view", () => {
  const a = marketSemanticView(["v_de_food", "v_au_food"]);
  assert.equal(a.name, marketSemanticView(["v_au_food", "v_de_food"]).name);
  assert.notEqual(a.name, marketSemanticView(["v_de_food"]).name);
  assert.match(a.name, /^v_market_inflation_[0-9a-f]{8}/);
  assert.match(a.sql, /^CREATE OR REPLACE SCHEMASTORE VIEW v_market_inflation_[0-9a-f]{8}\S* WITH CONTAINER psig AS\n/);
  assert.match(a.sql, /FROM psig\.v_au_food WHERE yoy_pct IS NOT NULL\nUNION ALL\n/);
  assert.equal(semanticCompareSql(a.name, "2025-07"), `SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.${a.name} WHERE period >= '2025-07'\nORDER BY country, concept, period`);
});

test("the federated comparison reads the semantic view built from this run's agency views", async () => {
  const z = new FakeZ();
  const agent = agentWith(z);
  const brief = await agent.run("DE and AU food +5%");
  const ddl = z.sqls.find((s) => /^CREATE OR REPLACE SCHEMASTORE VIEW v_market_inflation_/.test(s))!;
  assert.ok(ddl, z.sqls.join("\n"));
  for (const v of ["v_de_food", "v_de_all_items", "v_au_food", "v_au_all_items"]) assert.match(ddl, new RegExp(`FROM psig\\.${v} WHERE`));
  assert.match(brief.compared.sql, /^SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig\.v_market_inflation_/);
  assert.equal(brief.semanticView?.members.length, 4);
  assert.equal(brief.facts.length, 2);
  assert.ok(agent.trace.some((e) => /semantic view psig\.v_market_inflation_/.test(e.title)));
});

test("if the semantic view cannot be created the comparison falls back to the direct UNION ALL query", async () => {
  const z = new FakeZ(true);
  const agent = agentWith(z);
  const brief = await agent.run("DE and AU food +5%");
  assert.match(brief.compared.sql, /UNION ALL/);
  assert.equal(brief.semanticView, undefined);
  assert.equal(brief.facts.length, 2);
  assert.ok(agent.trace.some((e) => e.kind === "warn" && /semantic view/.test(e.title)));
});

test("the SQL allowlist accepts OR REPLACE only for schemastore views", async () => {
  const agent = agentWith(new FakeZ());
  const run = (sql: string) => (agent as any).sql.run(sql);
  await run("CREATE OR REPLACE SCHEMASTORE VIEW v_market_inflation_ab12cd34 WITH CONTAINER psig AS\nSELECT 1");
  await assert.rejects(run("CREATE OR REPLACE LIGHTNING DATABASE X DESCRIBE BY \"y\""), /allowlist/);
  await assert.rejects(run("CREATE OR REPLACE TABLE x AS SELECT 1"), /allowlist/);
});

test("the federated-query card names the semantic view and shows its definition", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  class El { innerHTML = ""; textContent = ""; className = ""; value = ""; disabled = false; scrollTop = 0; scrollHeight = 0; clientHeight = 0; children: El[] = []; appendChild(c: El) { this.children.push(c); } scrollIntoView() {} setAttribute() {} }
  const nodes = new Map<string, El>();
  const node = (q: string) => { if (!nodes.has(q)) nodes.set(q, new El()); return nodes.get(q)!; };
  const context = vm.createContext({ document: { querySelector: node, createElement: () => new El() }, fetch: async () => ({ json: async () => ({}) }), EventSource: class { addEventListener() {} close() {} }, setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} });
  for (const file of ["scenario.js", "preview-panel.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8"), context);
  vm.runInContext(script, context);
  const sem = marketSemanticView(["v_de_food", "v_au_food"]);
  (context as any).sample = { facts: [], notes: [], views: [], sql: [{ id: "Q9", ms: 900 }], skus: [], passThrough: 1, ms: 1000, markdown: "", concept: "food", requestedCountries: ["DE", "AU"],
    compared: { id: "Q9", sql: semanticCompareSql(sem.name, "2025-07"), columns: ["country", "concept", "category_label", "frequency", "period", "yoy_pct", "source_id"], rows: [["DE", "food", "Food", "M", "2026-09", 0.4, "eurostat:x"], ["AU", "food", "Food", "M", "2026-08", 3.0, "abs:y"]] },
    semanticView: { name: sem.name, sql: sem.sql, members: ["v_de_food", "v_au_food"] } };
  vm.runInContext('render(sample,"q")', context);
  const out = node("#out").innerHTML;
  assert.match(out, new RegExp(`reads the Zetaris semantic view <code>psig\\.${sem.name}</code> over 2 agency views`));
  assert.match(out, /<details><summary>Semantic view definition<\/summary><pre>CREATE OR REPLACE SCHEMASTORE VIEW/);
});
