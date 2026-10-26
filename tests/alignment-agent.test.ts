import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { COMPARE_COLUMNS, type Candidate } from "../src/sources/index.ts";
import { renderBrief, type Brief } from "../src/brief.ts";

test("messy request and remembered follow-up expose the common period without replacing latest evidence", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psig-alignment-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memory = new AgentMemory(dir);
  const rows = ([
    ["DE", "2026-08", 0.2], ["DE", "2026-09", 0.4],
    ["CA", "2026-08", 2.85], ["CA", "2026-09", 2.2], ["AU", "2026-08", 2.98],
  ] as const).flatMap(([c, p, n]) => ["food", "all_items"].map((concept) => [c, concept, "Food", "M", p, n, `${c}:${concept}`]));
  let discoveries = 0, sqlCalls = 0;
  const deps = {
    memory,
    sql: { async run(sql: string) {
      const base = { id: `Q${++sqlCalls}`, sql, ms: 0 };
      if (/^SELECT COUNT/.test(sql)) return { ...base, columns: ["n", "latest"], rows: [[2, "2026-09"]] };
      if (/^SELECT country/.test(sql)) return { ...base, columns: COMPARE_COLUMNS, rows };
      return { ...base, columns: [], rows: [] };
    } },
    llm: async (messages: any[]) => {
      const prompt = messages.at(-1).content as string;
      const followup = prompt.includes("same as last time");
      const text = prompt.startsWith("Extract")
        ? JSON.stringify({ countries: followup ? [] : ["DE", "CA", "AU"], concept: followup ? null : "food", proposed_change_pct: followup ? -2 : 5, cost_increase_pct: followup ? null : 8, cost_share_pct: followup ? null : 60, pass_through: followup ? null : 0.7 })
        : messages[0].content.startsWith("You write short") ? '{"headline":"Check the historical evidence.","markets":{}}' : "{}";
      return { text, model: "offline", provider: "offline", ms: 0 };
    },
    discoverFn: async (country: any, concept: string) => {
      discoveries++;
      return { country, concept, notes: [], candidates: [{ country, agency: country === "DE" ? "eurostat" : country === "CA" ? "statcan" : "abs", dataset: "fixture", code: concept, label: "Food", frequency: "M", measure: "index", status: "active", sourceUrl: "https://example.test" } as Candidate] };
    },
    onboardFn: async (_z: any, c: Candidate, concept: string) => ({ view: `v_${c.country}_${concept}`, table: "t", ok: true, existed: false, rows: 2, latest: "2026-09", sql: [] }),
  };
  const first = new PriceSignalAgent(deps);
  const partials: Brief[] = [];
  first.on("partial", (b) => partials.push(b));
  const b = await first.run("our gochujang & snacks: is food inflation in deutschland, canada & aus still hot? costs rose 8%, costs are 60% of our selling price; pass on 70%; thinking +5%?");
  assert.equal(b.startedAt, "2026-10-27T00:00:00.000Z");
  assert.ok(partials.every((p) => p.startedAt === b.startedAt));
  assert.equal(b.alignment?.status, "aligned");
  assert.equal(b.alignment?.status === "aligned" && b.alignment.period, "2026-08");
  assert.deepEqual(b.facts.map((f) => f.category?.latestPeriod), ["2026-09", "2026-09", "2026-08"]);
  assert.deepEqual(b.facts.map((f) => f.costNeed), [3.4, 3.4, 3.4]);
  assert.ok(partials.every((p) => p.alignment?.status === "aligned"), "both partial stages expose the same source alignment");
  assert.match(b.markdown!, /Same-period comparison/);
  assert.match(b.markdown!, /2026-08/);
  const before = discoveries;
  const followup = await new PriceSignalAgent(deps).run("same as last time, but what if we go -2%?");
  assert.equal(followup.request.proposedChangePct, -2);
  assert.equal(followup.alignment?.status, "aligned");
  assert.equal(discoveries, before, "alignment adds no discovery or model request");
  assert.deepEqual(followup.facts.map((f) => f.category?.latestYoy), [0.4, 2.2, 3]);
  assert.ok(followup.sinceLast?.every((line) => line.includes("no new official release")));
});

test("Markdown separates aligned observations from latest benchmarks and preserves unavailable reasons", () => {
  const b: any = {
    request: { raw: "compare food", countries: ["CA", "AU"], concept: "food", unknownCountries: [] },
    passThrough: 1, notes: [], facts: [{ country: "CA", agency: "StatCan", cite: "Q1" }, { country: "AU", agency: "ABS", cite: "Q1" }],
    compared: { id: "Q1" }, sqlLog: [], views: [],
    alignment: { status: "aligned", concept: "food", requestedCountries: ["CA", "AU"], period: "2026-08", frequency: "M", monthsOld: 2, cite: "Q1", note: "Dates are aligned; baskets and category coverage still differ.", rows: [
      { country: "CA", label: "Food", sourceId: "ca:food", yoy: 2.85, latestPeriod: "2026-09", latestYoy: 2.2 },
      { country: "AU", label: "Food and non-alcoholic beverages", sourceId: "au:food", yoy: 2.98, latestPeriod: "2026-08", latestYoy: 3 },
    ] },
  };
  const md = renderBrief(b);
  assert.match(md, /Same-period comparison/);
  assert.match(md, /2026-08.*monthly/);
  assert.match(md, /CA.*Food.*2\.9%.*2026-09/);
  assert.match(md, /baskets and category coverage still differ/);
  assert.match(md, /ca:food/);
  b.alignment = { status: "unavailable", concept: "food", requestedCountries: ["CA", "AU"], cite: "Q1", reason: "Monthly and quarterly observations cannot be aligned." };
  assert.match(renderBrief(b), /Monthly and quarterly observations cannot be aligned/);
  b.alignment.requestedCountries = ["CA"];
  assert.doesNotMatch(renderBrief(b), /Same-period comparison/);
});
