// True sentences the fact check used to strike out (independent review, 27 Oct 11:30): category-level and
// next-release remarks are not "this market's data is missing", and a verdict word belongs to the countries
// its clause names ("Canada and Australia: within", "fits CA and AU but exceeds Germany's", "except Germany").
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allowedNumbers, buildFacts, checkNarrative } from "../src/brief.ts";

const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/demo1-narrative-drafts.json", import.meta.url), "utf8"));
const demo1: any = { raw: fx.question, countries: fx.requestedCountries, concept: fx.concept, conceptWords: [fx.concept], proposedChangePct: fx.proposed, passThrough: fx.passThrough, unknownCountries: [] };

function marketCheck(code: string, text: string, facts = fx.facts, req = demo1): string[] {
  return checkNarrative({ headline: "Historical market comparison", markets: { [code]: text } }, allowedNumbers(facts, req, req.passThrough), facts, req, req.passThrough);
}

test("a missing narrower category or a not-yet-published month is not missing market data", () => {
  // CA Food is in the facts (latest 2026-09); DE latest 2026-09.
  for (const [c, t] of [
    ["CA", "Statistics Canada publishes no separate condiments series, so Food is the comparison."],
    ["CA", "A snacks-level series is not available for Canada, so the Food series is used."],
    ["CA", "Canadian food CPI was 2.2% YoY in September 2026; no newer release is available yet."],
    ["DE", "No October 2026 data is out yet, so re-check next month."],
    ["AU", "Monthly data for September 2026 is not yet available; the latest is August 2026."],
  ]) assert.deepEqual(marketCheck(c, t).filter((p) => /missing/.test(p)), [], `${c}: ${t}`);
});

test("denying the requested series of a market that has it is still caught", () => {
  for (const [c, t] of [
    ["CA", "Canadian food CPI data is unavailable."],
    ["CA", "There is no Canadian food data this month."],
    ["CA", "Food inflation data for Canada is not yet available."],
    ["DE", "No September 2026 data is available for Germany."],
  ]) assert.ok(marketCheck(c, t).some((p) => /missing/.test(p)), `${c}: ${t}`);
});

// Scene 2 (+3%): DE above, CA within, AU within the market benchmark.
const scene2: any = { raw: "same as last time, but what if we only go +3%?", countries: ["DE", "CA", "AU"], concept: "food", conceptWords: ["food"], proposedChangePct: 3, passThrough: 0.7, unknownCountries: [] };
const rows: any[] = [];
for (const [c, latest, avg] of [["DE", 0.4, 1.4], ["CA", 2.2, 4.1], ["AU", 3.0, 3.2]] as const) {
  const earlier = (12 * avg - latest) / 11;
  for (let m = 0; m < 12; m++) {
    const d = new Date(Date.UTC(2025, 9 + m, 1));
    rows.push({ country: c, concept: "food", category_label: "Food", frequency: "M", period: d.toISOString().slice(0, 7), yoy_pct: m === 11 ? latest : Math.round(earlier * 1000) / 1000, source_id: `${c}:food` });
  }
}
const facts2 = buildFacts(rows, scene2, "Q1", 0.7, new Date("2026-10-27"));
const headline = (h: string) => checkNarrative({ headline: h, markets: {} }, allowedNumbers(facts2, scene2, 0.7), facts2, scene2, 0.7);

test("scene 2 facts: DE above, CA and AU within", () => {
  assert.deepEqual(facts2.map((f) => [f.country, f.verdict]), [["DE", "above the market benchmark"], ["CA", "within the market benchmark"], ["AU", "within the market benchmark"]]);
});

test("true headlines with the verdict after a colon, before a contrast, or with an exception are kept", () => {
  for (const h of [
    "Germany: above the benchmark; Canada and Australia: within.",
    "+3% fits Canada and Australia but exceeds Germany's benchmark.",
    "+3% is within the benchmark in all markets except Germany, where it is above.",
    // Already accepted before; must stay accepted.
    "+3% is above the benchmark in Germany but within it in Canada and Australia.",
    "Within the benchmark for Canada and Australia; above it for Germany.",
    "+3% exceeds Germany's benchmark and stays within Canada's and Australia's.",
    "Across the three markets, +3% is within the benchmark for Canada and Australia and above for Germany.",
  ]) assert.deepEqual(headline(h), [], h);
});

test("false headlines in the same shapes are still rejected", () => {
  for (const h of [
    "Germany: within the benchmark; Canada and Australia: above.",
    "+3% fits Germany but exceeds Canada's and Australia's benchmark.",
    "+3% is above the benchmark in all markets except Germany, where it is within.",
    "+3% is within the benchmark in all markets except Canada.",
    "+3% is within the benchmark in all three markets.",
    "+3% is within the benchmark everywhere.",
  ]) assert.ok(headline(h).length, h);
});
