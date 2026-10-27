// Runtime failure paths that could stall or mislabel a live run: a planner that makes no progress,
// a federated query that keeps failing, a transient agency error, parallel bootstrap, messy model JSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent, extractJson } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { onboard } from "../src/sources/index.ts";
import { getJson, type Candidate } from "../src/sources/types.ts";
import { rejectsReasoningHint } from "../src/llm.ts";
import type { SqlResult, SqlRunner } from "../src/zetaris.ts";

process.env.PSIG_VERBOSE = "0";

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
    if (/SELECT DISTINCT country, sku_category/.test(sql)) return { id, sql, columns: ["country", "sku_category"], rows: [], ms: 1 };
    if (/^SELECT COUNT/.test(sql)) return { id, sql, columns: ["n", "latest"], rows: [[9, "2026-09"]], ms: 1 };
    if (/UNION ALL|FROM psig\.v_/.test(sql) && /^SELECT country/.test(sql)) return { id, sql, columns: ["country", "concept", "category_label", "frequency", "period", "yoy_pct", "source_id"], rows: fakeRows(), ms: 2 };
    return { id, sql, columns: [], rows: [], ms: 1 };
  }
}

const cand = (country: any, concept: string): Candidate => ({ agency: country === "DE" ? "eurostat" : country === "CA" ? "statcan" : "abs", country, dataset: "d", code: concept, label: concept, frequency: "M", measure: "index", status: "active", sourceUrl: "https://example.test" });
const ok = (text: string) => ({ text, model: "fake", provider: "fake", ms: 1 });
const tmpMemory = () => new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-runtime-")));
const QUESTION = "is food inflation in DE, CA and AU still hot? thinking +5%";

function agentWith(plannerReply: (turn: number) => string, extra: Partial<ConstructorParameters<typeof PriceSignalAgent>[0]> = {}) {
  const calls = { planner: 0, discover: [] as string[] };
  const agent = new PriceSignalAgent({
    llm: (async (m: any[]) => {
      const last = m.at(-1).content as string;
      if (last.startsWith("Extract")) return ok('{"countries":["DE","CA","AU"],"concept":"food","concept_words":["food"],"proposed_change_pct":5}');
      if (m[0].content.startsWith("You write short")) return ok('{"headline":"Historical market comparison","markets":{},"watch":"Re-check next month."}');
      calls.planner++;
      return ok(plannerReply(calls.planner));
    }) as any,
    sql: new FakeZ(),
    memory: tmpMemory(),
    hedgeMs: Infinity,
    compareRetryMs: 0,
    discoverFn: async (country: any, concept: string) => { calls.discover.push(`${country}:${concept}`); return { country, concept, candidates: [cand(country, concept)], notes: [] }; },
    onboardFn: async (_z: any, c: any, concept: string) => ({ view: `v_${c.country.toLowerCase()}_${concept}`, table: "t", ok: true, existed: false, rows: 9, latest: "2026-09", sql: [] }),
    ...extra,
  } as any);
  return { agent, calls };
}

test("a planner that keeps replying valid but useless actions is replaced by the autopilot", async () => {
  for (const reply of [
    () => '{"thought":"check memory","actions":[{"action":"recall_memory","args":{"query":"food"}}]}',
    () => '{"thought":"look","actions":[{"action":"discover_series","args":{"country":"DE","concept":"food"}}]}',
    (t: number) => t % 2 ? '{"actions":[{"action":"discover_series","args":{"country":"DE","concept":"food"}}]}' : '{"actions":[{"action":"onboard_series","args":{"country":"DE","concept":"food","candidate":"first"}}]}',
  ]) {
    const { agent, calls } = agentWith(reply);
    const brief = await agent.run(QUESTION);
    assert.deepEqual(brief.facts.filter((f) => f.category).map((f) => f.country).sort(), ["AU", "CA", "DE"]);
    assert.ok(calls.planner <= 4, `planner calls ${calls.planner}`);
    assert.ok(calls.discover.length <= 8, `agency calls ${calls.discover.length}`);
    assert.ok(agent.trace.some((e) => /no progress/.test(e.title)), "the switch is visible in the trace");
  }
});

test("markets the planner never reached are completed, not reported as having no official series", async () => {
  const { agent } = agentWith((t) => t === 1
    ? '{"actions":[{"action":"discover_and_onboard","args":{"country":"DE","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"DE","concept":"all_items"}}]}'
    : '{"actions":[{"action":"recall_memory","args":{"query":"x"}}]}');
  const brief = await agent.run(QUESTION);
  assert.deepEqual(brief.facts.filter((f) => f.category).map((f) => f.country).sort(), ["AU", "CA", "DE"]);
  assert.ok(!brief.notes.some((n) => /no usable official series was found\.$/.test(n)), brief.notes.join(" | "));
});

test("a federated query that keeps failing stops after a few attempts with an accurate error", async () => {
  class CompareDown extends FakeZ {
    compares = 0;
    async run(sql: string) {
      if (/UNION ALL/.test(sql)) { this.compares++; throw new Error("Zetaris HTTP 500: REST source PSIG_ABS request timed out"); }
      return super.run(sql);
    }
  }
  const z = new CompareDown();
  const memory = tmpMemory();
  for (const [c, k] of [["DE", "food"], ["DE", "all_items"], ["CA", "food"], ["CA", "all_items"], ["AU", "food"], ["AU", "all_items"]] as const)
    memory.rememberMapping({ country: c, concept: k, agency: c === "DE" ? "eurostat" : c === "CA" ? "statcan" : "abs", dataset: "d", code: k, label: k, view: `v_${c.toLowerCase()}_${k}`, frequency: "M", decoderVersion: c === "DE" ? 1 : 2 } as any);
  const { agent } = agentWith(() => '{"actions":[{"action":"finish","args":{}}]}', { sql: z, memory } as any);
  await assert.rejects(agent.run(QUESTION), (e: Error) => {
    assert.match(e.message, /federated comparison/i);
    assert.match(e.message, /6 onboarded views/);
    assert.match(e.message, /PSIG_ABS request timed out/);
    assert.doesNotMatch(e.message, /No market could be onboarded/);
    return true;
  });
  assert.ok(z.compares <= 3, `federated attempts ${z.compares}`);
});

test("an agency that does not answer gets one honest note, not a second 'no usable series' note", async () => {
  const { agent } = agentWith(() => '{"actions":[{"action":"discover_and_onboard","args":{"country":"DE","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"CA","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"AU","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"DE","concept":"all_items"}},{"action":"discover_and_onboard","args":{"country":"CA","concept":"all_items"}},{"action":"discover_and_onboard","args":{"country":"AU","concept":"all_items"}}]}', {
    discoverFn: async (country: any, concept: string) => {
      if (country === "CA" && concept === "food") throw new Error("GET www150.statcan.gc.ca failed: fetch failed (cause: ECONNRESET socket hang up)");
      return { country, concept, candidates: [cand(country, concept)], notes: [] };
    },
  } as any);
  const brief = await agent.run(QUESTION);
  const ca = brief.notes.filter((n) => /^CA[: ]/.test(n) && /food/.test(n));
  assert.equal(ca.filter((n) => /did not answer/.test(n)).length, 1, ca.join(" | "));
  assert.ok(!ca.some((n) => /no usable official series was found/.test(n)), ca.join(" | "));
});

test("agency GETs retry once after a dropped connection or a 5xx, but not after a timeout or a 404", async () => {
  const real = globalThis.fetch;
  const run = async (responses: (() => Response | never)[]) => {
    let calls = 0;
    globalThis.fetch = (async () => { const r = responses[Math.min(calls, responses.length - 1)]; calls++; return r(); }) as any;
    try {
      return { value: await getJson("https://agency.test/x", {}, 0).catch((e: Error) => e), calls };
    } finally {
      globalThis.fetch = real;
    }
  };
  const dropped = () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET", message: "socket hang up" } }); };
  const json = () => new Response('{"ok":1}', { status: 200 });
  assert.deepEqual(await run([dropped, json]), { value: { ok: 1 }, calls: 2 });
  assert.deepEqual(await run([() => new Response("busy", { status: 503 }), json]), { value: { ok: 1 }, calls: 2 });
  assert.deepEqual(await run([() => new Response("slow down", { status: 429 }), json]), { value: { ok: 1 }, calls: 2 });
  const timedOut = await run([() => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }, json]);
  assert.equal(timedOut.calls, 1);
  assert.ok(timedOut.value instanceof Error);
  const missing = await run([() => new Response("nope", { status: 404 }), json]);
  assert.equal(missing.calls, 1);
  assert.match(String(missing.value), /HTTP 404/);
  const twice = await run([dropped, dropped, json]);
  assert.equal(twice.calls, 2);
  assert.match(String(twice.value), /ECONNRESET/);
});

test("parallel onboarding sends the shared bootstrap DDL once", async () => {
  const created = new Set<string>();
  const statements: string[] = [];
  const z: SqlRunner = {
    async run(sql: string) {
      statements.push(sql);
      await new Promise((r) => setTimeout(r, 5));
      if (/^CREATE/.test(sql)) {
        const k = sql.split("\n")[0];
        if (created.has(k)) throw new Error(`Zetaris error: ${k.split(" ").slice(0, 4).join(" ")} already exists`);
        created.add(k);
        return { id: "x", sql, columns: [], rows: [], ms: 1 };
      }
      return { id: "x", sql, columns: ["n", "latest"], rows: [[9, "2026-09"]], ms: 1 };
    },
  };
  const cs: Candidate[] = [
    { ...cand("DE", "food"), dataset: "prc_hicp_minr", code: "CP01" },
    { ...cand("CA", "food"), code: "v41690974" },
    { ...cand("AU", "food"), code: "20001", frequency: "Q" },
  ];
  await Promise.all(cs.map((c) => onboard(z, c, "food", new Date("2026-10-27"))));
  assert.equal(statements.filter((s) => /^CREATE (LIGHTNING DATABASE|SCHEMASTORE CONTAINER)/.test(s)).length, 4);
});

test("extractJson finds the action object after reasoning, stray braces or a trailing comma", () => {
  assert.deepEqual(extractJson('Plan for {DE, CA}: {"actions":[{"action":"compare","args":{}}]}'), { actions: [{ action: "compare", args: {} }] });
  assert.deepEqual(extractJson('draft {"action":"finish","args":{}} wait, compare first.</think>\n{"action":"compare","args":{}}'), { action: "compare", args: {} });
  assert.deepEqual(extractJson('{"action":"compare","args":{},}'), { action: "compare", args: {} });
  assert.deepEqual(extractJson('{"note":"a, }","x":[1,2,]}'), { note: "a, }", x: [1, 2] });
  assert.deepEqual(extractJson('```json\n{"a":{"b":"}"}}\n```'), { a: { b: "}" } });
  assert.equal(extractJson("no json here"), null);
});

test("only a 400/422 that names the reasoning fields turns the reasoning hint off", () => {
  assert.equal(rejectsReasoningHint(400, '{"error":{"message":"Unrecognized request argument supplied: reasoning_effort"}}'), true);
  assert.equal(rejectsReasoningHint(422, '{"detail":[{"loc":["body","reasoning"],"msg":"extra fields not permitted"}]}'), true);
  assert.equal(rejectsReasoningHint(400, '{"error":{"message":"This model\'s maximum context length is 32768 tokens"}}'), false);
  assert.equal(rejectsReasoningHint(400, '{"error":"messages: invalid role"}'), false);
  assert.equal(rejectsReasoningHint(500, "reasoning unavailable"), false);
});

test("price-list queries ask Zetaris for enough rows for a long SKU list", async () => {
  // At the 1000-row default a list of about 66 SKUs x 15 months was rejected as possibly incomplete.
  class Recording extends FakeZ {
    limits = new Map<string, number | undefined>();
    async run(sql: string, opts?: { limit?: number }) {
      if (/SELECT DISTINCT country, sku_category/.test(sql)) { this.limits.set("categories", opts?.limit); return { id: "c", sql, columns: [], rows: [["DE", "food", "Gochujang 500 g"]], ms: 1 }; }
      if (/p\.sku_category = s\.concept/.test(sql)) { this.limits.set("rates", opts?.limit); return { id: "r", sql, columns: [], rows: [], ms: 1 }; }
      return super.run(sql);
    }
  }
  const z = new Recording();
  const { agent } = agentWith((t) => t === 1 ? '{"actions":[{"action":"discover_and_onboard","args":{"country":"DE","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"DE","concept":"all_items"}}]}' : '{"actions":[{"action":"compare","args":{}}]}', { sql: z } as any);
  await agent.run("is food inflation in Germany still hot? thinking +5%");
  assert.ok((z.limits.get("categories") ?? 0) >= 20_000, `categories limit ${z.limits.get("categories")}`);
  assert.ok((z.limits.get("rates") ?? 0) >= 20_000, `rates limit ${z.limits.get("rates")}`);
});

test("when the model cannot read the question, the default-market note does not claim no market was named", async () => {
  const agent = new PriceSignalAgent({
    llm: (async (m: any[]) => {
      if ((m.at(-1).content as string).startsWith("Extract")) throw new Error("LLM HTTP 502: empty_response");
      if (m[0].content.startsWith("You write short")) return ok('{"headline":"Historical market comparison","markets":{},"watch":"Re-check next month."}');
      return ok('{"actions":[{"action":"compare","args":{}}]}');
    }) as any,
    sql: new FakeZ(), memory: tmpMemory(), hedgeMs: Infinity, compareRetryMs: 0,
    discoverFn: async (country: any, concept: string) => ({ country, concept, candidates: [cand(country, concept)], notes: [] }),
    onboardFn: async (_z: any, c: any, concept: string) => ({ view: `v_${c.country.toLowerCase()}_${concept}`, table: "t", ok: true, existed: false, rows: 9, latest: "2026-09", sql: [] }),
  } as any);
  const brief = await agent.run("canda snacks: ok to raise 3%?");
  assert.deepEqual(brief.request.countries, ["DE", "CA", "AU"]);
  assert.ok(!brief.notes.some((n) => /No market was named/.test(n)), brief.notes.join(" | "));
  assert.ok(brief.notes.some((n) => /No supported market was recognised/.test(n) && /could not read/.test(n)), brief.notes.join(" | "));
});

test("a non-text concept from the model never becomes a view name", async () => {
  const { agent } = agentWith(() => '{"actions":[{"action":"compare","args":{}}]}', {
    llm: (async (m: any[]) => {
      if ((m.at(-1).content as string).startsWith("Extract")) return ok('{"countries":["DE"],"concept":{"name":"food"},"concept_words":[{"w":"food"}],"proposed_change_pct":5}');
      if (m[0].content.startsWith("You write short")) return ok('{"headline":"Historical market comparison","markets":{},"watch":"Re-check next month."}');
      return ok('{"actions":[{"action":"compare","args":{}}]}');
    }) as any,
  } as any);
  const req = await (agent as any).parse("German prices: ok to raise 5%?");
  assert.doesNotMatch(String(req.concept), /object/);
  assert.ok(req.conceptWords.every((w: unknown) => typeof w === "string" && !/object/.test(w)), JSON.stringify(req.conceptWords));
});

test("the SQL allowlist reads quotes and comments in one pass, so neither can hide a second statement", async () => {
  const agent = new PriceSignalAgent({ sql: new FakeZ(), memory: tmpMemory(), llm: (async () => ok("{}")) as any });
  const run = (sql: string) => (agent as any).sql.run(sql);
  for (const stacked of [
    `SELECT "it's" AS x; DROP TABLE psig.v; SELECT 'y'`,
    "SELECT 1 -- it's\n; DROP TABLE psig.v; SELECT 'y'",
    "SELECT 1 /* it's */; DROP TABLE psig.v",
    "SELECT 'a''; DROP' AS x; DROP TABLE psig.v",
    "SELECT `it's` AS x; DROP TABLE psig.v",
  ]) await assert.rejects(run(stacked), /allowlist/, stacked);
  for (const fine of [
    "SELECT 'Food; beverages' AS category_label FROM psig.v_x",
    `SELECT "a;b", 'it''s; fine' AS x FROM psig.v_x`,
    "SELECT 1;",
    `CREATE LIGHTNING REST TABLE t FROM db REQUEST(\n    endpoint "https://example.test/a;b?x=1--2",\n    method "get"\n)`,
  ]) await run(fine);
});

test("a rejected narrative draft and the reasons are kept in the trace for later re-grading", async () => {
  let narratives = 0;
  const { agent } = agentWith((t) => t === 1 ? '{"actions":[{"action":"discover_and_onboard","args":{"country":"DE","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"DE","concept":"all_items"}}]}' : '{"actions":[{"action":"compare","args":{}}]}', {
    llm: (async (m: any[]) => {
      const last = m.at(-1).content as string;
      if (last.startsWith("Extract")) return ok('{"countries":["DE"],"concept":"food","concept_words":["food"],"proposed_change_pct":5}');
      if (m[0].content.startsWith("You write short")) return ok(++narratives === 1 ? '{"headline":"German food inflation is 9.9%.","markets":{},"watch":"Re-check next month."}' : '{"headline":"Historical market comparison","markets":{},"watch":"Re-check next month."}');
      return ok('{"actions":[{"action":"discover_and_onboard","args":{"country":"DE","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"DE","concept":"all_items"}}]}');
    }) as any,
  } as any);
  await agent.run("is food inflation in Germany still hot? thinking +5%");
  const rejected = agent.trace.find((e) => /does not match the facts/.test(e.title));
  assert.ok(rejected, "a rejected attempt is in the trace");
  const detail = rejected!.detail as { draft?: { headline?: string }; problems?: string[] };
  assert.equal(detail.draft?.headline, "German food inflation is 9.9%.");
  assert.ok(detail.problems?.some((p) => /9\.9/.test(p)), JSON.stringify(detail.problems));
});
