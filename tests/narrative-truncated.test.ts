// A narrative reply that stops mid-JSON (seen live on 27 Oct 12:10: '{"headline":"+5% proposed: above market
// benchmarks in DE, CA, and AU","markets":{"DE":"Germ…') used to be discarded as "no headline". Its complete fields
// are kept and go through the same fact check; an unfinished sentence never reaches the brief.
import { test } from "node:test";
import assert from "node:assert/strict";
import { completedFields, extractJson } from "../src/agent.ts";

test("the complete fields of a cut-off reply are kept, the unfinished one is dropped", () => {
  const cut = '{"headline":"+5% is above the market benchmark in DE, CA and AU","markets":{"DE":"German food CPI was 0.4% YoY in September 2026. +5% is above the benchmark.","CA":"Canadian food CPI was 2.2% Y';
  assert.deepEqual(completedFields(cut), { headline: "+5% is above the market benchmark in DE, CA and AU", markets: { DE: "German food CPI was 0.4% YoY in September 2026. +5% is above the benchmark." } });
  // Cut in the watch line after a complete markets object: the markets are not mistaken for the whole reply.
  const late = '<think>x</think>{"headline":"H","markets":{"DE":"a.","AU":"b."},"watch":"Re-check';
  assert.deepEqual(completedFields(late), { headline: "H", markets: { DE: "a.", AU: "b." } });
  // A cut inside the headline leaves nothing usable.
  assert.equal(completedFields('{"headline":"+5% is ab'), null);
  // A complete reply is returned unchanged.
  assert.deepEqual(completedFields('{"headline":"H","markets":{"DE":"a."},"watch":"w"}'), { headline: "H", markets: { DE: "a." }, watch: "w" });
});

test("a closed reply with a raw line break inside a sentence is read in full", () => {
  // JSON forbids a raw newline inside a string; models write one now and then (independent review, 27 Oct 18:15).
  const raw = '{"headline":"H","markets":{"DE":"German food CPI was 0.4% YoY.\nThat is low.","AU":"b."},"watch":"w"}';
  const want = { headline: "H", markets: { DE: "German food CPI was 0.4% YoY.\nThat is low.", AU: "b." }, watch: "w" };
  assert.deepEqual(extractJson(raw), want);
  assert.deepEqual(completedFields(raw), want);
});

test("a closed reply broken by an unescaped quote keeps the fields before the break", () => {
  const broken = '{"headline":"H","markets":{"DE":"a.","CA":"b.","AU":"Australian "food" CPI is 3%."},"watch":"w"}';
  assert.equal(extractJson(broken), null);
  assert.deepEqual(completedFields(broken), { headline: "H", markets: { DE: "a.", CA: "b." } });
});

test("a cut-off narrative reply is shown with its complete, fact-checked paragraphs", async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const { PriceSignalAgent } = await import("../src/agent.ts");
  const { AgentMemory } = await import("../src/memory.ts");
  const { buildFacts } = await import("../src/brief.ts");
  process.env.PSIG_VERBOSE = "0";
  const rows = [["DE", 0.6, 0.4], ["CA", 2.6, 2.2], ["AU", 3.1, 3.0]].flatMap(([country, prior, latest]) => [
    { country, concept: "food", category_label: "Food", frequency: "M", period: "2026-08", yoy_pct: prior, source_id: `${country}:food` },
    { country, concept: "food", category_label: "Food", frequency: "M", period: "2026-09", yoy_pct: latest, source_id: `${country}:food` },
  ]);
  const req: any = { raw: "DE CA AU food: +5%?", countries: ["DE", "CA", "AU"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, passThrough: 0.7, unknownCountries: [] };
  const facts = buildFacts(rows, req, "Q1", 0.7, new Date("2026-10-27"));
  const agent = new PriceSignalAgent({
    llm: (async () => ({ text: '{"headline":"Historical market comparison","markets":{"DE":"German food CPI was 0.4% YoY in September 2026.","CA":"Canadian food CPI was 2.', model: "f", provider: "f", ms: 1 })) as any,
    sql: { run: async () => { throw new Error("no SQL"); } } as any,
    memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-cut-"))), hedgeMs: Infinity,
  });
  const out = await (agent as any).narrate(req, facts, [], 0.7);
  assert.deepEqual(out.narrative?.markets, { DE: "German food CPI was 0.4% YoY in September 2026." });
  assert.ok(agent.trace.some((e) => /narrative reply was cut off - keeping its complete fields \(1 market paragraph/.test(e.title)));
});

test("a reply cut off inside its first paragraph still shows Nemotron's checked headline, marked as cut off", async () => {
  // The live case of 27 Oct 12:08: '{"headline":"+5% proposed: above market benchmarks in DE, CA, and AU","markets":{"DE":"Germ'
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path"), vm = await import("node:vm");
  const { PriceSignalAgent } = await import("../src/agent.ts");
  const { AgentMemory } = await import("../src/memory.ts");
  const { buildFacts } = await import("../src/brief.ts");
  process.env.PSIG_VERBOSE = "0";
  const rows = [["DE", 0.6, 0.4], ["CA", 2.6, 2.2], ["AU", 3.1, 3.0]].flatMap(([country, prior, latest]) => [
    { country, concept: "food", category_label: "Food", frequency: "M", period: "2026-08", yoy_pct: prior, source_id: `${country}:food` },
    { country, concept: "food", category_label: "Food", frequency: "M", period: "2026-09", yoy_pct: latest, source_id: `${country}:food` },
  ]);
  const req: any = { raw: "DE CA AU food: +5%?", countries: ["DE", "CA", "AU"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, passThrough: 0.7, unknownCountries: [] };
  const facts = buildFacts(rows, req, "Q1", 0.7, new Date("2026-10-27"));
  const agent = new PriceSignalAgent({
    llm: (async () => ({ text: '{"headline":"+5% proposed: above market benchmarks in DE, CA, and AU","markets":{"DE":"Germ', model: "f", provider: "f", ms: 1 })) as any,
    sql: { run: async () => { throw new Error("no SQL"); } } as any,
    memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-cut-h-"))), hedgeMs: Infinity,
  });
  const out = await (agent as any).narrate(req, facts, [], 0.7);
  assert.equal(out.narrative?.headline, "+5% proposed: above market benchmarks in DE, CA, and AU");
  assert.deepEqual(out.narrative?.markets, {});
  assert.equal(out.narrative?.cutOff, true);
  // A false headline in a cut-off reply is still rejected.
  const wrong = new PriceSignalAgent({
    llm: (async () => ({ text: '{"headline":"+5% is within the benchmark in all three markets","markets":{"DE":"Germ', model: "f", provider: "f", ms: 1 })) as any,
    sql: { run: async () => { throw new Error("no SQL"); } } as any,
    memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-cut-w-"))), hedgeMs: Infinity,
  });
  assert.equal((await (wrong as any).narrate(req, facts, [], 0.7)).narrative, undefined);
  // The UI says the reply was cut off instead of claiming a full summary.
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /Nemotron's reply was cut off; its complete part \(the headline\) is shown and was checked against the computed facts\./);
});
