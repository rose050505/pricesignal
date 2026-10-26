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
import { allowedNumbers, buildFacts, checkNarrative, renderBrief } from "../src/brief.ts";

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
    if (/SELECT DISTINCT country, sku_category/.test(sql)) return { id, sql, columns: ["country", "sku_category"], rows: [["CA", "condiments"], ["DE", "condiments"]], ms: 1 };
    if (/p\.sku_category = s\.concept/.test(sql)) {
      const rows: unknown[][] = [];
      for (const [c, cur, price, base] of [["DE", "EUR", 4.99, 1.0], ["CA", "CAD", 7.49, 3.0]] as const) for (let m = 1; m <= 9; m++) rows.push(["GCJ-500", "Gochujang 500 g", c, "condiments", cur, price, "condiments", "Salt, condiments and sauces", "M", `2026-0${m}`, base + m * 0.1, `${c}:condiments`]);
      return { id, sql, columns: [], rows, ms: 2 };
    }
    if (/FROM psig\.v_price_list/.test(sql)) return { id, sql, columns: [], rows: [["GCJ-500", "Gochujang 500 g", "DE", "condiments", "EUR", 4.99, "2026-09", 2.45, "DE:food"], ["GCJ-500", "Gochujang 500 g", "CA", "condiments", "CAD", 7.49, "2026-09", 3.85, "CA:food"]], ms: 2 };
    if (/^SELECT COUNT/.test(sql)) return { id, sql, columns: ["n", "latest"], rows: [[9, "2026-09"]], ms: 1 };
    if (/UNION ALL|FROM psig\.v_/.test(sql) && /^SELECT country/.test(sql)) return { id, sql, columns: ["country", "concept", "category_label", "frequency", "period", "yoy_pct", "source_id"], rows: fakeRows(), ms: 2 };
    return { id, sql, columns: [], rows: [], ms: 1 };
  }
}

const cand = (country: any, concept: string): Candidate => ({ agency: country === "DE" ? "eurostat" : country === "CA" ? "statcan" : "abs", country, dataset: "d", code: concept, label: concept, frequency: "M", measure: "index", status: "active", sourceUrl: "https://x" });

function scriptedLlm(): any {
  return async (messages: any[]) => {
    const last = messages.at(-1).content as string;
    if (last.startsWith("Extract the pricing request") && last.includes("same as last time")) return { text: '{"countries":[],"concept":null,"concept_words":[],"proposed_change_pct":3,"pass_through":null}', model: "fake", provider: "fake", ms: 1 };
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

test("narrative grounding is per market and checks the stated range", () => {
  const s = (latestYoy: number, avg12: number) => ({ concept: "snacks", label: "x", frequency: "M", sourceId: "x", latestPeriod: "2026-09", latestYoy, avg12, trend: "easing" as const, points: [{ period: "2026-03", yoy: 0.3 }] });
  const facts: any[] = [
    { country: "DE", agency: "Eurostat", category: s(1.4, 6.1), suggested: { low: 1.0, high: 4.3, basis: "" }, verdict: "above the evidence", cite: "Q8" },
    { country: "CA", agency: "StatCan", category: s(2.2, 4.1), suggested: { low: 1.5, high: 2.9, basis: "" }, verdict: "above the evidence", cite: "Q8" },
  ];
  const req: any = { raw: "", countries: ["DE", "CA"], concept: "snacks", conceptWords: [], proposedChangePct: 5, unknownCountries: [] };
  // Run 01 on 26 Oct: the DE paragraph claimed "0.3% to 1%" while the computed range was 1.0-4.3%.
  const wrong = checkNarrative({ headline: "+5% is above the evidence", markets: { DE: "Snacks 1.4% YoY; a 70% pass-through supports roughly 0.3% to 1%, so +5% is above.", CA: "Food 2.2% YoY, down from 4.1%." } }, [], facts, req, 0.7);
  assert.ok(wrong.includes("0.3") || wrong.includes("0.3–1%"), JSON.stringify(wrong));
  // A number from another market is not allowed in this market's paragraph.
  assert.ok(checkNarrative({ headline: "ok", markets: { DE: "DE is at 2.2%." } }, [], facts, req, 0.7).includes("2.2"));
  const right = checkNarrative({ headline: "+5% is above the evidence in DE and CA", markets: { DE: "Snacks 1.4% YoY (12-month average 6.1%); 70% pass-through supports 1.0% to 4.3%.", CA: "Food eased from 4.1% to 2.2%; the range is 1.5–2.9%." } }, allowedNumbers(facts, req, 0.7), facts, req, 0.7);
  assert.deepEqual(right, []);
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
  assert.equal(discovers, 8, "6 market series + condiments for the 2 markets that sell gochujang");

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
  assert.equal(discovers, 8, "second run did not discover again");
  assert.ok(b2.views.every((v) => v.via === "memory"));
  assert.equal(b2.passThrough, 0.7, "policy recalled from H-MEM");
  assert.match(b2.markdown!, /Narrative omitted/);
});

test("a finish over a stale comparison is not accepted; empty-memory reuse falls through to discovery", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psig-"));
  let turn = 0;
  const z = new FakeZ();
  const agent = new PriceSignalAgent({
    llm: async (m: any[]) => {
      const last = m.at(-1).content as string;
      if (last.startsWith("Extract")) return { text: '{"countries":["DE","CA"],"concept":"food","proposed_change_pct":5,"pass_through":0.7}', model: "f", provider: "f", ms: 1 };
      if (m[0].content.startsWith("You write short")) return { text: '{"headline":"ok","markets":{},"watch":"x"}', model: "f", provider: "f", ms: 1 };
      turn++;
      // Turn 1 (as seen live on 26 Oct): reuse from an empty memory for food, onboard all-items, and compare too early.
      if (turn === 1) return { text: JSON.stringify({ actions: [{ action: "use_memory_mapping", args: { country: "DE", concept: "food" } }, { action: "discover_and_onboard", args: { country: "DE", concept: "all_items" } }, { action: "discover_and_onboard", args: { country: "CA", concept: "all_items" } }, { action: "compare", args: {} }] }), model: "f", provider: "f", ms: 1 };
      return { text: '{"actions":[{"action":"finish","args":{}}]}', model: "f", provider: "f", ms: 1 };
    },
    sql: z,
    memory: new AgentMemory(dir),
    discoverFn: async (country: any, concept: string) => ({ country, concept, candidates: [cand(country, concept)], notes: [] }),
    onboardFn: async (_z: any, c: Candidate, concept: string) => ({ view: `v_${c.country.toLowerCase()}_${concept}`, table: "t", ok: true, existed: false, rows: 9, latest: "2026-09", sql: [] }),
  });
  agent.on("event", (e: any) => process.env.DBG && console.log("TRACE", e.kind, e.title));
  const b = await agent.run("food DE CA +5% we pass on 70%");
  assert.ok(b.views.some((v) => v.key === "DE:food"), "DE food was discovered although the planner asked memory for it");
  const lastCompare = z.sqls.filter((q) => /^SELECT country, concept/.test(q)).at(-1)!;
  assert.match(lastCompare, /v_ca_food/, "the comparison the brief uses covers every onboarded series");
  assert.equal(b.compared.sql, lastCompare);
});

test("internal price list is joined, and 'same as last time' recalls the last request", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psig-"));
  const memory = new AgentMemory(dir);
  const deps = () => ({
    llm: scriptedLlm(),
    sql: new FakeZ(),
    memory,
    discoverFn: async (country: any, concept: string) => ({ country, concept, candidates: [cand(country, concept)], notes: [] }),
    onboardFn: async (_z: any, c: Candidate, concept: string) => ({ view: `v_${c.country.toLowerCase()}_${concept}`, table: "t", ok: true, existed: false, rows: 9, latest: "2026-09", sql: [] }),
  });
  const b1 = await new PriceSignalAgent(deps()).run("is food inflation in deutschland, canada & aus still hot? thinking +5%, we pass on 70%");
  assert.equal(b1.skus?.length, 2, "SKUs come back from the price-list join");
  const de = b1.skus!.find((s) => s.country === "DE")!;
  const f = b1.facts.find((x) => x.country === "DE")!;
  // Gochujang is priced on the condiments series (its own category), not on the requested food series.
  assert.equal(de.rateLabel, "Salt, condiments and sauces");
  assert.equal(de.yoy, 1.9);
  assert.notEqual(de.yoy, f.category!.latestYoy);
  assert.equal(de.rangeLow, Math.round(0.7 * Math.min(de.yoy, de.avg12!) * 10 + 1e-9) / 10);
  assert.equal(de.low, Math.round(4.99 * (1 + de.rangeLow! / 100) * 100) / 100);
  assert.ok(b1.views.some((v) => v.key === "DE:condiments"), "the condiments series was onboarded for pricing");
  assert.equal(de.atProposed, Math.round(4.99 * 1.05 * 100) / 100);
  assert.match(b1.markdown!, /Your price list/);
  assert.match(b1.policySource!, /stated/);
  const b2 = await new PriceSignalAgent(deps()).run("same as last time, but what if we only go +3%?");
  assert.deepEqual(b2.request.countries, ["DE", "CA", "AU"]);
  assert.equal(b2.request.concept, "food");
  assert.equal(b2.request.proposedChangePct, 3);
  // H-MEM remembered the first brief's outcome per market, so the second brief says what changed.
  assert.ok(b2.sinceLast?.length, "since-last-brief section present");
  assert.match(b2.sinceLast![0], /no new official release/);
  assert.match(b2.sinceLast![0], /last time \+5% was above the evidence; now \+3% is/);
  assert.match(b2.markdown!, /Since your last brief/);
  assert.match(b2.policySource!, /remembered/);
});

test("onboarding says whether Zetaris objects were created or already there, and PSIG_ZETARIS_NS gives fresh names", async () => {
  const { onboardPlan } = await import("../src/sources/index.ts");
  const { priceView } = await import("../src/sources/pricelist.ts");
  const c: Candidate = { ...cand("DE", "food"), dataset: "prc_hicp_minr", code: "CP01" };
  assert.equal(onboardPlan(c, "food").view, "v_de_food_prc_hicp_minr_cp01");
  process.env.PSIG_ZETARIS_NS = "n1027";
  try {
    assert.equal(onboardPlan(c, "food").view, "v_de_food_prc_hicp_minr_cp01_n1027");
    assert.equal(priceView(), "v_price_list_n1027");
  } finally {
    delete process.env.PSIG_ZETARIS_NS;
  }
  // A Zetaris that already has every object (as in the 26 Oct example runs): the trace must say so.
  class ExistingZ extends FakeZ {
    async run(sql: string): Promise<SqlResult> {
      if (/^CREATE/.test(sql)) throw new Error("Zetaris error: table already exists");
      return super.run(sql);
    }
  }
  const agent = new PriceSignalAgent({
    llm: async (m: any[]) => {
      const last = m.at(-1).content as string;
      if (last.startsWith("Extract")) return { text: '{"countries":["DE"],"concept":"food","proposed_change_pct":5}', model: "f", provider: "f", ms: 1 };
      if (m[0].content.startsWith("You write short")) return { text: '{"headline":"ok","markets":{},"watch":"x"}', model: "f", provider: "f", ms: 1 };
      return { text: '{"actions":[{"action":"discover_and_onboard","args":{"country":"DE","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"DE","concept":"all_items"}}]}', model: "f", provider: "f", ms: 1 };
    },
    sql: new ExistingZ(),
    memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-"))),
    discoverFn: async (country: any, concept: string) => ({ country, concept, candidates: [{ ...cand(country, concept), dataset: "prc_hicp_minr", code: concept === "food" ? "CP01" : "TOTAL" }], notes: [] }),
  });
  const b = await agent.run("DE food +5%");
  const titles = b.trace.map((e) => e.title);
  assert.ok(titles.some((t) => /^already in Zetaris \(not created again\): CREATE LIGHTNING REST TABLE/.test(t)), titles.join("\n"));
  assert.ok(titles.some((t) => /onboarded eurostat CP01 .*Zetaris already had it - reused and verified/.test(t)), titles.join("\n"));
  assert.ok(!titles.some((t) => /created REST table/.test(t)));
});

test("a narrative lost to a provider error is not reported as a grounding failure", async () => {
  // examples/02 on 26 Oct: HTTP 502 empty_response, then a timeout - the brief said "did not pass the number-grounding check".
  const agent = new PriceSignalAgent({
    llm: async (m: any[]) => {
      const last = m.at(-1).content as string;
      if (last.startsWith("Extract")) return { text: '{"countries":["DE"],"concept":"food","proposed_change_pct":5}', model: "f", provider: "f", ms: 1 };
      if (m[0].content.startsWith("You write short")) throw new Error('HTTP 502: {"error":{"message":"/nvidia/nemotron-3.5-lightning_empty_response"}}');
      return { text: '{"actions":[{"action":"discover_and_onboard","args":{"country":"DE","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"DE","concept":"all_items"}}]}', model: "f", provider: "f", ms: 1 };
    },
    sql: new FakeZ(),
    memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-"))),
    discoverFn: async (country: any, concept: string) => ({ country, concept, candidates: [cand(country, concept)], notes: [] }),
    onboardFn: async (_z: any, c: Candidate, concept: string) => ({ view: `v_${c.country.toLowerCase()}_${concept}`, table: "t", ok: true, existed: false, rows: 9, latest: "2026-09", sql: [] }),
  });
  const b = await agent.run("DE food +5%");
  assert.equal(b.narrative, undefined);
  assert.doesNotMatch(b.markdown!, /number-grounding/);
  assert.match(b.markdown!, /Narrative omitted: the model provider returned an error or timed out/);
});

test("'same as last time' keeps the remembered proposal when the only new percentage is the pass-through", async () => {
  const memory = new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-")));
  memory.rememberRequest({ countries: ["DE", "CA", "AU"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, raw: "first" });
  const parseWith = (reply: string | Error) => new PriceSignalAgent({ llm: async () => { if (reply instanceof Error) throw reply; return { text: reply, model: "f", provider: "f", ms: 1 }; }, sql: new FakeZ(), memory });
  const a = await parseWith('{"countries":[],"concept":null,"proposed_change_pct":null,"pass_through":0.8}').parse("same as last time, but we pass on 80% now");
  assert.equal(a.proposedChangePct, 5, "80% is the pass-through, not a +80% price change");
  assert.equal(a.passThrough, 0.8);
  // Model unavailable: the rules still tell a pass-through share from a proposed change.
  const b = await parseWith(new Error("HTTP 502")).parse("same as last time but we pass thru like 60pct");
  assert.equal(b.proposedChangePct, 5);
  const c = await parseWith(new Error("HTTP 502")).parse("지난번이랑 같은 조건인데 3프로만 올리면?");
  assert.equal(c.proposedChangePct, 3);
  assert.deepEqual(c.countries, ["DE", "CA", "AU"]);
  const d = await parseWith('{"countries":[],"proposed_change_pct":3}').parse("same as last time, but what if we only go +3%?");
  assert.equal(d.proposedChangePct, 3);
});

test("a concept from the model cannot break the SQL literal it lands in; the trace names the runtime", async () => {
  const agent = new PriceSignalAgent({ llm: async () => ({ text: `{"countries":["DE"],"concept":"Children's Snacks'; --","proposed_change_pct":4}`, model: "openrouter/nvidia/nemotron-3.5-lightning", provider: "meterless", ms: 1 }), sql: new FakeZ(), memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-"))) });
  const r = await agent.parse("children's snacks in germany +4%");
  assert.equal(r.concept, "childrens snacks --");
  assert.ok(agent.trace.some((e) => e.title === "parsed request (openrouter/nvidia/nemotron-3.5-lightning, 1 ms via Meterless Nightshift)"), agent.trace.map((e) => e.title).join("\n"));
});

test("a slow model call is hedged: a second identical request is sent and the first good reply wins", async () => {
  // 26 Oct 22:51-23:05: the same narrative call took 2 s at one minute and failed after 40 s (502 empty_response) at another.
  let narrativeCalls = 0;
  const agent = new PriceSignalAgent({
    hedgeMs: 40,
    llm: async (m: any[]) => {
      const last = m.at(-1).content as string;
      if (last.startsWith("Extract")) return { text: '{"countries":["DE"],"concept":"food","proposed_change_pct":5}', model: "f", provider: "f", ms: 1 };
      if (m[0].content.startsWith("You write short")) {
        if (++narrativeCalls === 1) {
          await new Promise((r) => setTimeout(r, 300));
          throw new Error("AbortError: This operation was aborted"); // the time budget ran out waiting for this one reply
        }
        return { text: '{"headline":"+5% is above the evidence in DE.","markets":{"DE":"Food is easing."},"watch":"Re-check next month."}', model: "f", provider: "f", ms: 1 };
      }
      return { text: '{"actions":[{"action":"discover_and_onboard","args":{"country":"DE","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"DE","concept":"all_items"}}]}', model: "f", provider: "f", ms: 1 };
    },
    sql: new FakeZ(),
    memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-"))),
    discoverFn: async (country: any, concept: string) => ({ country, concept, candidates: [cand(country, concept)], notes: [] }),
    onboardFn: async (_z: any, c: Candidate, concept: string) => ({ view: `v_${c.country.toLowerCase()}_${concept}`, table: "t", ok: true, existed: false, rows: 9, latest: "2026-09", sql: [] }),
  });
  const b = await agent.run("DE food +5%");
  assert.equal(b.narrative?.headline, "+5% is above the evidence in DE.");
  assert.equal(narrativeCalls, 2);
  assert.ok(b.trace.some((e) => /^narrative: no reply after .* - sent the same request again/.test(e.title)), b.trace.map((e) => e.title).join("\n"));
});

test("hedging gives up only when both requests fail, and can be switched off", async () => {
  const mk = (hedgeMs: number, replies: (() => Promise<any>)[]) => {
    let i = 0;
    const a = new PriceSignalAgent({ hedgeMs, llm: () => replies[i++](), sql: new FakeZ(), memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-"))) });
    return { a, calls: () => i };
  };
  const fail = (ms: number) => () => new Promise((_, rej) => setTimeout(() => rej(new Error("HTTP 502")), ms));
  const ok = (ms: number) => () => new Promise((res) => setTimeout(() => res({ text: '{"countries":["DE"],"concept":"food","proposed_change_pct":2}', model: "f", provider: "f", ms }), ms));
  // first fails fast -> second goes out at once and answers
  const x = mk(10_000, [fail(5), ok(5)]);
  assert.equal((await x.a.parse("DE food +2%")).proposedChangePct, 2);
  assert.equal(x.calls(), 2);
  // both fail -> the rules take over (parse never throws)
  const y = mk(10, [fail(30), fail(40)]);
  const ry = await y.a.parse("germany food +2%");
  assert.equal(y.calls(), 2);
  assert.deepEqual(ry.countries, ["DE"]);
  assert.ok(y.a.trace.some((e) => /LLM parse failed/.test(e.title)));
  // the first reply wins even when the second request is already out
  const z = mk(10, [ok(40), ok(400)]);
  const t0 = Date.now();
  await z.a.parse("DE food +2%");
  assert.ok(Date.now() - t0 < 300, "did not wait for the slower second request");
  // switched off: exactly one request
  const w = mk(Infinity, [fail(5), ok(5)]);
  await w.a.parse("germany food +2%");
  assert.equal(w.calls(), 1);
});

test("market parsing: no stray words as 'not covered' markets, no silent substitution of unasked markets", async () => {
  const memory = new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-")));
  const reply = (j: string) => new PriceSignalAgent({ llm: async () => ({ text: j, model: "f", provider: "f", ms: 1 }), sql: new FakeZ(), memory });
  // "same as last time": the model rightly names no market, and no word of the question becomes a market.
  memory.rememberRequest({ countries: ["DE", "CA", "AU"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, raw: "first" });
  const a = await reply('{"countries":[],"concept":null,"proposed_change_pct":3}').parse("same as last time, but what if we only go +3%?");
  assert.deepEqual(a.countries, ["DE", "CA", "AU"]);
  assert.deepEqual(a.unknownCountries, []);
  // No market named at all: the default markets are used, and the brief says so.
  const fresh = new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-")));
  const agentB = new PriceSignalAgent({ llm: async (m: any[]) => (m.at(-1).content.startsWith("Extract") ? { text: '{"countries":[],"concept":"food","proposed_change_pct":5}', model: "f", provider: "f", ms: 1 } : scriptedLlm()(m)), sql: new FakeZ(), memory: fresh, discoverFn: async (country: any, concept: string) => ({ country, concept, candidates: [cand(country, concept)], notes: [] }), onboardFn: async (_z: any, c: Candidate, concept: string) => ({ view: `v_${c.country.toLowerCase()}_${concept}`, table: "t", ok: true, existed: false, rows: 9, latest: "2026-09", sql: [] }) });
  const bb = await agentB.run("is food inflation still hot? thinking +5%");
  assert.deepEqual(bb.request.countries, ["DE", "CA", "AU"]);
  assert.deepEqual(bb.request.unknownCountries, []);
  assert.ok(bb.notes.some((n) => /No market was named/.test(n)), bb.notes.join("\n"));
  // Only unsupported markets: say so, do not answer for markets nobody asked about.
  const agentC = new PriceSignalAgent({ llm: async () => ({ text: '{"countries":["japan"],"concept":"food","proposed_change_pct":5}', model: "f", provider: "f", ms: 1 }), sql: new FakeZ(), memory: fresh });
  const c = await agentC.run("japan food prices, ok to raise 5%?");
  assert.deepEqual(c.facts, []);
  assert.deepEqual(c.request.countries, []);
  assert.match(c.markdown!, /japan: not covered yet/);
  assert.doesNotMatch(c.markdown!, /\| DE /);
});

test("the losing hedged request is cancelled and leaves no warning in the trace", async () => {
  let cancelled = false;
  let n = 0;
  const agent = new PriceSignalAgent({
    hedgeMs: 20,
    llm: (_m: any, opts: any = {}) => {
      if (++n === 1) {
        // the slow first request: fails later unless it is cancelled first
        return new Promise((_, rej) => {
          const t = setTimeout(() => rej(new Error("AbortError: This operation was aborted")), 200);
          opts.signal?.addEventListener("abort", () => { cancelled = true; clearTimeout(t); rej(opts.signal.reason); });
        });
      }
      return Promise.resolve({ text: '{"countries":["DE"],"concept":"food","proposed_change_pct":2}', model: "f", provider: "f", ms: 1 });
    },
    sql: new FakeZ(),
    memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-"))),
  });
  await agent.parse("DE food +2%");
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(cancelled, "the slower request was cancelled");
  assert.ok(!agent.trace.some((e) => /provider is slow/.test(e.title)), agent.trace.map((e) => e.title).join("\n"));
  assert.ok(agent.trace.some((e) => /the second request answered first/.test(e.title)));
});

test("ordinary words in the question are not read as markets ('inland' is not Finland, 'pain' is not Spain)", async () => {
  const memory = new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-")));
  memory.rememberRequest({ countries: ["FR", "IT", "ES"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, raw: "first" });
  const parseWith = (j: string, q: string) => new PriceSignalAgent({ llm: async () => ({ text: j, model: "f", provider: "f", ms: 1 }), sql: new FakeZ(), memory }).parse(q);
  const q = "same as last time, but inland freight is a pain - can we do +4%?";
  assert.deepEqual((await parseWith('{"countries":[],"proposed_change_pct":4}', q)).countries, ["FR", "IT", "ES"]);
  // The model guessed markets the user never wrote (seen in examples/02): the remembered ones still win.
  assert.deepEqual((await parseWith('{"countries":["DE","CA","AU"],"proposed_change_pct":4}', q)).countries, ["FR", "IT", "ES"]);
  const c = await parseWith('{"countries":[],"proposed_change_pct":4}', "same as last time - our constructor client wants +4%");
  assert.ok(c.countries.every((x) => typeof x === "string"), "no prototype property became a market");
  // A typo in the model's own list is still resolved.
  assert.deepEqual((await parseWith('{"countries":["canda"],"proposed_change_pct":4}', "canda snacks +4%")).countries, ["CA"]);
});

test("'same as last time': a cost increase in the question is not taken as the proposed change", async () => {
  const memory = new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-")));
  memory.rememberRequest({ countries: ["DE", "CA", "AU"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, raw: "first" });
  const parseWith = (j: string | Error, q: string) => new PriceSignalAgent({ llm: async () => { if (j instanceof Error) throw j; return { text: j, model: "f", provider: "f", ms: 1 }; }, sql: new FakeZ(), memory }).parse(q);
  assert.equal((await parseWith('{"countries":[],"proposed_change_pct":4}', "same as last time, but our costs rose 8% - is +4% ok?")).proposedChangePct, 4);
  assert.equal((await parseWith('{"countries":[],"proposed_change_pct":4}', "지난번이랑 같은 조건, 원가가 8% 올랐는데 4프로 올려도 돼?")).proposedChangePct, 4);
  // without the model, a signed "+N%" is the proposal
  assert.equal((await parseWith(new Error("HTTP 502"), "same as last time, but our costs rose 8% - is +4% ok?")).proposedChangePct, 4);
});

test("an agency that does not answer is tried once, reported, and the other markets still get a brief", async () => {
  const calls: Record<string, number> = {};
  const agent = new PriceSignalAgent({
    llm: async (m: any[]) => {
      const last = m.at(-1).content as string;
      if (last.startsWith("Extract")) return { text: '{"countries":["DE","AU"],"concept":"food","proposed_change_pct":5}', model: "f", provider: "f", ms: 1 };
      if (m[0].content.startsWith("You write short")) return { text: '{"headline":"ok","markets":{},"watch":"x"}', model: "f", provider: "f", ms: 1 };
      return { text: '{"actions":[{"action":"discover_and_onboard","args":{"country":"DE","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"DE","concept":"all_items"}},{"action":"discover_and_onboard","args":{"country":"AU","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"AU","concept":"all_items"}},{"action":"finish","args":{}}]}', model: "f", provider: "f", ms: 1 };
    },
    sql: new FakeZ(),
    memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-"))),
    discoverFn: async (country: any, concept: string) => {
      const k = `${country} ${concept}`;
      calls[k] = (calls[k] ?? 0) + 1;
      if (k === "AU food") throw new Error("fetch failed: ABS timed out");
      return { country, concept, candidates: [cand(country, concept)], notes: [] };
    },
    onboardFn: async (_z: any, c: Candidate, concept: string) => ({ view: `v_${c.country.toLowerCase()}_${concept}`, table: "t", ok: true, existed: false, rows: 9, latest: "2026-09", sql: [] }),
  });
  const b = await agent.run("DE and AU food +5%");
  assert.ok(calls["AU food"] <= 2, JSON.stringify(calls));
  assert.ok(b.facts.find((f) => f.country === "DE")?.category, "DE still answered");
  assert.ok(b.notes.some((n) => /AU: Australian Bureau of Statistics \(CPI\) did not answer/.test(n)), b.notes.join("\n"));
});

test("each agent numbers its own Zetaris statements, does not rewire a shared runner, and blocks stacked statements", async () => {
  const z = new FakeZ();
  const mk = () => new PriceSignalAgent({ sql: z, memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-"))), llm: async () => ({ text: "{}", model: "f", provider: "f", ms: 1 }) });
  const a1 = mk();
  const a2 = mk();
  const run = (a: any, sql: string) => a.sql.run(sql);
  const q1 = await run(a1, "SELECT country, concept FROM psig.v_x");
  const q2 = await run(a2, "SELECT country, concept FROM psig.v_y");
  assert.equal(q1.id, "Q1");
  assert.equal(q2.id, "Q1", "two concurrent runs do not share one counter");
  assert.equal(a1.sqlLog.length, 1, "the second agent's query is not logged by the first");
  await assert.rejects(run(a1, "SELECT 1; DROP VIEW psig.v_de_food"), /allowlist/);
  await assert.rejects(run(a1, "select * from t /* */; insert into x values (1)"), /allowlist/);
  // a semicolon inside a quoted label is fine
  await run(a1, "SELECT 'Food; beverages' AS category_label FROM psig.v_x");
});

test("grounding also checks verdict words, stray 6/12, 'supports X to Y' ranges, non-text prose and market names", () => {
  const s = (latestYoy: number, avg12: number) => ({ concept: "snacks", label: "x", frequency: "M", sourceId: "x", latestPeriod: "2026-09", latestYoy, avg12, yoy6Back: undefined, trend: "easing" as const, points: [] });
  const facts: any[] = [
    { country: "DE", agency: "Eurostat", category: s(1.4, 6.1), suggested: { low: 1.0, high: 4.3, basis: "" }, verdict: "above the evidence", cite: "Q8", monthsStale: 1 },
    { country: "CA", agency: "StatCan", category: s(2.2, 4.1), suggested: { low: 1.5, high: 2.9, basis: "" }, verdict: "above the evidence", cite: "Q8", monthsStale: 1 },
  ];
  const req: any = { raw: "", countries: ["DE", "CA"], concept: "snacks", conceptWords: [], proposedChangePct: 5, unknownCountries: [] };
  const allowed = allowedNumbers(facts, req, 0.7);
  const chk = (n: any) => checkNarrative(n, allowed, facts, req, 0.7);
  // found by the 26 Oct review (all passed before)
  assert.ok(chk({ headline: "+5% is within the evidence in DE and CA - go ahead.", markets: { DE: "+5% is within the evidence." } }).length, "verdict flipped");
  assert.ok(chk({ headline: "ok", markets: { DE: "German snack prices are up 12% and climbing 6% a quarter." } }).length, "invented 12% / 6%");
  assert.ok(chk({ headline: "ok", markets: { DE: "A 70% pass-through supports 1.4% to 6.1%, so +5% is above the evidence." } }).length, "latest/average pair called the supported range");
  assert.ok(chk({ headline: "ok", markets: { DE: { text: "Snacks up 99.9%" } } }).length, "prose that is not text");
  assert.ok(chk({ headline: "ok", markets: { Germany: "Range is 2.2% to 4.1%." } }).length, "market keyed by name is checked as that market");
  // what real briefs say keeps passing
  assert.deepEqual(chk({ headline: "+5% Q1 increase exceeds food inflation evidence across DE and CA.", markets: {
    DE: "German food inflation for Sugar, confectionery and desserts was 1.4% YoY in September 2026, with a 12-month average of 6.1%. The proposed +5% increase falls above the evidence range of 1.0% to 4.3%, placing it above the evidence.",
    CA: "Canadian food inflation was 2.2% YoY, down from a 12-month average of 4.1%; it eased from 4.1% to 2.2% over 6 months. The proposed +5% exceeds the evidence range of 1.5% to 2.9%, so it is above the evidence.",
  }, watch: "Re-check the 12-period averages next month." }), []);
});

test("cost side: a stated cost increase becomes a cost-based need, compared with each market's range", async () => {
  const parseWith = (j: string | Error, q: string, memory = new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-")))) =>
    new PriceSignalAgent({ llm: async () => { if (j instanceof Error) throw j; return { text: j, model: "f", provider: "f", ms: 1 }; }, sql: new FakeZ(), memory }).parse(q);
  const q = "DE and CA food: our costs rose 8% - is +4% ok? we pass on 70%";
  const a = await parseWith('{"countries":["DE","CA"],"concept":"food","proposed_change_pct":4,"pass_through":0.7,"cost_increase_pct":8}', q);
  assert.equal(a.costIncreasePct, 8);
  assert.equal(a.proposedChangePct, 4);
  // without the model, the rules still tell the cost increase from the proposal
  const b = await parseWith(new Error("HTTP 502"), q);
  assert.equal(b.costIncreasePct, 8);
  assert.equal(b.proposedChangePct, 4);
  const k = await parseWith(new Error("HTTP 502"), "독일 캐나다 식품, 원가가 8% 올랐는데 4프로 올려도 돼?");
  assert.equal(k.costIncreasePct, 8);
  assert.equal(k.proposedChangePct, 4);

  // computed in code: 70% of +8% = +5.6%, then compared with each market's range
  const rows: Record<string, unknown>[] = [];
  for (const [c, base] of [["DE", 1.0], ["CA", 6.0]] as const) for (let m = 1; m <= 9; m++) rows.push({ country: c, concept: "food", category_label: "Food", frequency: "M", period: `2026-0${m}`, yoy_pct: base, source_id: "x" });
  const facts = buildFacts(rows, { ...a, countries: ["DE", "CA"] }, "Q1", 0.7, new Date("2026-10-15"));
  const de = facts.find((f) => f.country === "DE")!;
  const ca = facts.find((f) => f.country === "CA")!;
  assert.equal(de.costNeed, 5.6);
  assert.equal(de.costVsMarket, "ahead of the market");
  assert.equal(ca.suggested!.high, 4.2);
  assert.equal(ca.costVsMarket, "ahead of the market");
  const md = renderBrief({ request: a, facts, notes: [], passThrough: 0.7, compared: { id: "Q1", sql: "", columns: [], rows: [], ms: 0 }, sqlLog: [], views: [], ms: 1, trace: [] } as any);
  assert.match(md, /Your costs: \+8% .* at 70% pass-through that is a \+5\.6% price rise/);
  assert.match(md, /## Costs vs\. the market/);
  // the prose may talk about the cost need without tripping the proposal-verdict check
  const allowed = allowedNumbers(facts, a, 0.7);
  assert.deepEqual(checkNarrative({ headline: "+4% is above the evidence in DE and below it in CA.", markets: { DE: "Food is 1.0% YoY; the range is 0.7% to 0.7%, so +4% is above the evidence. Your cost need of 5.6% is above the range too." } }, allowed, facts, a, 0.7), []);
});

test("an 'above' verdict says what pass-through the proposal would need", () => {
  const rows: Record<string, unknown>[] = [];
  for (let m = 1; m <= 12; m++) rows.push({ country: "CA", concept: "food", category_label: "Food", frequency: "M", period: `2025-${String(m).padStart(2, "0")}`, yoy_pct: m === 12 ? 2.2 : 4.27, source_id: "x" });
  const req: any = { raw: "", countries: ["CA"], concept: "food", conceptWords: [], proposedChangePct: 5, unknownCountries: [] };
  const [ca] = buildFacts(rows, req, "Q1", 0.7, new Date("2026-01-15"));
  assert.equal(ca.category!.avg12, 4.1);
  assert.equal(ca.verdict, "above the evidence");
  assert.equal(ca.passThroughNeeded, 122, "5 / max(2.2, 4.1) = 122%");
  assert.match(renderBrief({ request: req, facts: [ca], notes: [], passThrough: 0.7, compared: { id: "Q1", sql: "", columns: [], rows: [], ms: 0 }, sqlLog: [], views: [], ms: 1, trace: [] } as any), /above the evidence \(needs 122% pass-through\)/);
  const [within] = buildFacts(rows, { ...req, proposedChangePct: 2 }, "Q1", 0.7, new Date("2026-01-15"));
  assert.equal(within.passThroughNeeded, undefined);
});

test("headline verdicts are checked market by market, also when the markets differ", () => {
  const s = (latestYoy: number, avg12: number) => ({ concept: "food", label: "Food", frequency: "M", sourceId: "x", latestPeriod: "2026-09", latestYoy, avg12, yoy6Back: undefined, trend: "easing" as const, points: [] });
  const f = (country: string, lo: number, hi: number, verdict: string, yoy: number, avg: number): any => ({ country, agency: "a", category: s(yoy, avg), suggested: { low: lo, high: hi, basis: "" }, verdict, cite: "Q1" });
  const facts = [f("DE", 1.0, 4.3, "within the evidence", 1.4, 6.1), f("CA", 1.5, 2.9, "above the evidence", 2.2, 4.1), f("AU", 0.4, 3.4, "within the evidence", 0.6, 4.9)];
  const req: any = { raw: "", countries: ["DE", "CA", "AU"], concept: "food", conceptWords: [], proposedChangePct: 3, unknownCountries: [] };
  const chk = (headline: string, fs = facts) => checkNarrative({ headline, markets: {} }, allowedNumbers(fs, req, 0.7), fs, req, 0.7);
  // headlines Nemotron (or the code) actually wrote on 26 Oct
  assert.deepEqual(chk("+3% is within the evidence in DE and AU; above the evidence in CA."), []);
  assert.deepEqual(chk("+3% increase: within or above evidence across DE, CA, and AU"), []);
  const two = [f("CA", 1.5, 2.9, "within the evidence", 2.2, 4.1), f("AU", 2.1, 2.2, "below the evidence", 3.0, 3.2)];
  assert.deepEqual(chk("Proposed 2% increase: within evidence in CA, below in AU", two), []);
  // wrong attributions are caught
  assert.ok(chk("+3% is above the evidence in DE, CA and AU.").length);
  assert.ok(chk("+3% is within the evidence in CA; above in DE and AU").length);
});
