// What the narrative model is given. A run without a cost change must not invite a cost scenario, and
// product-level SKU notes must not read as missing market data (both were seen in 10/10 real replays).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent, type Request } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { allowedNumbers, buildFacts, checkNarrative } from "../src/brief.ts";

const rows = [["DE", 0.6, 0.4], ["CA", 2.6, 2.2], ["AU", 3.1, 3.0]].flatMap(([country, prior, latest]) => [
  { country, concept: "food", category_label: "Food", frequency: "M", period: "2026-08", yoy_pct: prior, source_id: `${country}:food` },
  { country, concept: "food", category_label: "Food", frequency: "M", period: "2026-09", yoy_pct: latest, source_id: `${country}:food` },
]);
const NOTES = [
  "DE: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.",
  "CA food: no usable official series was found.",
  "AU condiments: Food and non-alcoholic beverages is used as a broader category proxy (coarser) for these products; a product-specific selection was unavailable or unusable.",
  "CA snacks: the selected series and Food fallback are unavailable; these SKU prices are omitted.",
];

async function narrativeRequest(req: Request) {
  const facts = buildFacts(rows, req, "Q1", 0.7, new Date("2026-10-27"));
  const seen: any[][] = [];
  const agent = new PriceSignalAgent({
    llm: (async (m: any[]) => { seen.push(m); return { text: '{"headline":"Historical market comparison","markets":{},"watch":"Re-check next month."}', model: "f", provider: "f", ms: 1 }; }) as any,
    sql: { run: async () => { throw new Error("no SQL"); } } as any,
    memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-narr-payload-"))),
    hedgeMs: Infinity,
  });
  await (agent as any).narrate(req, facts, NOTES, 0.7);
  const [system, user] = seen[0];
  return { system: system.content as string, payload: JSON.parse((user.content as string).replace(/^Facts: /, "").split("\nReply with JSON only")[0]) };
}

const base: Request = { raw: "DE CA AU food: +5%? we pass on ~70% of cost increases", countries: ["DE", "CA", "AU"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, passThrough: 0.7, unknownCountries: [] };

test("without a cost change the model is told there is no cost scenario", async () => {
  const { system, payload } = await narrativeRequest(base);
  assert.equal(payload.cost_scenario, "none");
  assert.equal(payload.cost_share_basis, null);
  assert.match(system, /cost_scenario is "none"/);
});

test("with a cost change the cost scenario and its basis are still supplied", async () => {
  const { payload } = await narrativeRequest({ ...base, costIncreasePct: 8, costSharePct: 60 });
  assert.equal(payload.cost_scenario, "computed");
  assert.match(String(payload.cost_share_basis), /unit cost/);
});

test("SKU-level product notes are separated from market caveats", async () => {
  const { system, payload } = await narrativeRequest(base);
  assert.deepEqual(payload.caveats, [NOTES[0], NOTES[1]]);
  assert.deepEqual(payload.sku_price_notes, [NOTES[2], NOTES[3]]);
  assert.match(system, /sku_price_notes/);
});

test("'Aussie' is read as Australia when numbers are attributed to countries", () => {
  const facts = buildFacts(rows, base, "Q1", 0.7, new Date("2026-10-27"));
  const n = { headline: "Canadian food inflation is 2.2% YoY and Aussie food inflation is 3% YoY.", markets: {} };
  assert.deepEqual(checkNarrative(n, allowedNumbers(facts, base, 0.7), facts, base, 0.7), []);
});

test("a comma-and clause boundary keeps a later country's rate out of an earlier country's clause", () => {
  const facts = buildFacts(rows, base, "Q1", 0.7, new Date("2026-10-27"));
  const check = (watch: string) => checkNarrative({ headline: "Historical market comparison", markets: {}, watch }, allowedNumbers(facts, base, 0.7), facts, base, 0.7);
  // Seen in 10/10 real replays on 27 Oct: AU's 3.0% was charged to Canada.
  assert.deepEqual(check("Re-check Canada's October 2026 food CPI print to confirm series availability, and re-check Australia's September 2026 food CPI to verify the 3.0% YoY pace persists."), []);
  assert.deepEqual(check("Watch Canada's next release; Australia's food inflation is 3% YoY."), []);
  // Still one shared claim, so each named country must fit it.
  assert.ok(check("Canada and Australia food inflation is 3% YoY.").length);
  assert.ok(check("Re-check Canada's next release, and Canada's food inflation of 3% YoY.").length);
});

test("prose cannot say a market's data is missing when its requested series is in the facts", () => {
  const facts = buildFacts(rows, base, "Q1", 0.7, new Date("2026-10-27"));
  const check = (n: any) => checkNarrative({ headline: "Historical market comparison", markets: {}, ...n }, allowedNumbers(facts, base, 0.7), facts, base, 0.7);
  // Real rewrite on 27 Oct, after SKU notes about Canadian snacks were read as missing market data.
  assert.ok(check({ markets: { CA: "Canadian food CPI data is unavailable; Statistics Canada failed to respond for both food and all-items series. No benchmark or verdict can be assigned." } }).length);
  assert.ok(check({ headline: "Euro food CPI cools; Canadian data absent; Aussie flat at 3.0%" }).length);
  assert.ok(check({ markets: { CA: "There is no Canadian food data this month." } }).length);
  // Product-level omissions are true and stay allowed.
  assert.deepEqual(check({ markets: { CA: "Canadian food inflation is 2.2% YoY. Snack SKU prices for Canada are omitted because the selected series is unavailable." } }), []);
  // A market whose requested series really is missing may say so.
  const caMissing = facts.map((f) => f.country === "CA" ? { ...f, category: undefined, suggested: undefined, verdict: undefined } : f);
  assert.deepEqual(checkNarrative({ headline: "Historical market comparison", markets: { CA: "Canadian food data is unavailable this run." } }, allowedNumbers(caMissing as any, base, 0.7), caMissing as any, base, 0.7), []);
});

test("a data-missing phrase is checked only against the market it is about", () => {
  // Real headline on 27 Oct 10:16 when StatCan's food series really was missing; it was wrongly charged to DE and AU.
  const facts = buildFacts(rows, base, "Q1", 0.7, new Date("2026-10-27"));
  const caMissing = facts.map((f) => f.country === "CA" ? { ...f, category: undefined, suggested: undefined, verdict: undefined } : f) as any;
  const check = (n: any) => checkNarrative({ headline: "Historical market comparison", markets: {}, ...n }, allowedNumbers(caMissing, base, 0.7), caMissing, base, 0.7);
  assert.deepEqual(check({ headline: "Proposed +5% Q1 change: above DE & AU food benchmarks, CA data unavailable" }).filter((p) => /missing/.test(p)), []);
  assert.deepEqual(check({ markets: { DE: "German food CPI was 0.4% YoY in September 2026. Canadian food data is unavailable this run." } }).filter((p) => /missing/.test(p)), []);
  // Still caught when the market named is the one whose data is present.
  assert.ok(check({ headline: "German data absent; Aussie flat." }).some((p) => /DE: data claimed missing/.test(p)));
});
