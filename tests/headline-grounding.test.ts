import test from "node:test";
import assert from "node:assert/strict";
import { allowedNumbers, buildFacts, checkNarrative, type Narrative } from "../src/brief.ts";
import type { Request } from "../src/agent.ts";

const req: Request = { raw: "DE CA food +5%", countries: ["DE", "CA"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, costIncreasePct: 8, costSharePct: 60, unknownCountries: [] };
const rows = [["DE", 2.2, 1.4], ["CA", 3, 2.2]].flatMap(([country, prior, latest]) => [
  { country, concept: "food", category_label: "Food", frequency: "M", period: "2026-08", yoy_pct: prior, source_id: `${country}:food` },
  { country, concept: "food", category_label: "Food", frequency: "M", period: "2026-09", yoy_pct: latest, source_id: `${country}:food` },
]);
const facts = buildFacts(rows, req, "Q1", 0.7, new Date("2026-10-27"));
const check = (n: Partial<Narrative>) => checkNarrative({ headline: "Historical market comparison", markets: {}, ...n }, allowedNumbers(facts, req, 0.7), facts, req, 0.7);

test("a named country's headline and watch cannot borrow another market's rate", () => {
  for (const name of ["Germany", "German", "DE", "de", "Deutschland"]) {
    const text = `${name} food inflation is 2.2% YoY.`;
    assert.ok(check({ headline: text }).length, `headline: ${text}`);
    assert.ok(check({ watch: text }).length, `watch: ${text}`);
  }
  assert.ok(check({ headline: "Canadian food inflation is 1.4% YoY." }).length);
  assert.ok(check({ watch: "The historical benchmark in DE is 2.2% to 2.6%." }).length);
});

test("a single rate attributed to multiple countries must fit every named country", () => {
  for (const text of [
    "Germany and Canada food inflation is 2.2% YoY.",
    "Food inflation is 2.2% YoY in Germany and Canada.",
    "DE, CA: food inflation is 2.2% YoY.",
  ]) assert.ok(check({ headline: text }).length, text);
});

test("separate country clauses retain their own legal rates and benchmark ranges", () => {
  for (const text of [
    "Germany food inflation is 1.4% YoY; Canada food inflation is 2.2% YoY.",
    "DE: 1.4% YoY, CA: 2.2% YoY.",
    "German food inflation is 1.4% YoY while Canadian food inflation is 2.2% YoY.",
    "German food inflation is 1.4% YoY and Canadian food inflation is 2.2% YoY.",
    "Food inflation is 1.4% YoY in Germany and 2.2% YoY in Canada.",
    "Food inflation in Germany is 1.4% and Canada is 2.2%.",
    "In DE, food inflation is 1.4% YoY; in CA, food inflation is 2.2% YoY.",
    "Germany has 1.4% YoY inflation, with an average of 1.8%, while Canada has 2.2% YoY inflation.",
    "Germany's benchmark is 1.4% to 1.8%; Canada's benchmark is 2.2% to 2.6%.",
  ]) {
    assert.deepEqual(check({ headline: text }), [], text);
    assert.deepEqual(check({ watch: text }), [], `watch: ${text}`);
  }
  assert.ok(check({ headline: "DE: 2.2% YoY, CA: 1.4% YoY." }).length);
});

test("country clauses may share the user's proposal, cost inputs and cost scenario", () => {
  for (const text of [
    "The proposed +5% is above the market benchmark in DE and CA.",
    "Germany and Canada share the 3.4% cost recovery target from an 8% cost rise and 60% cost share.",
    "The cost recovery target of 3.4% is above the market benchmark in Germany and Canada.",
    "Germany has 1.4% YoY inflation; the proposed +5% is above the market benchmark in Canada.",
  ]) assert.deepEqual(check({ headline: text }), [], text);
});

test("countryless aggregate prose keeps existing checks without inventing country assignments", () => {
  assert.deepEqual(check({ headline: "Food rates are 1.4% and 2.2%." }), []);
  assert.deepEqual(check({ headline: "Compare the historical benchmark with the cost recovery scenario." }), []);
});

test("a shared request number cannot disguise an incorrect country observation", () => {
  const request = { ...req, proposedChangePct: 2.2, costIncreasePct: 2.2 };
  const checkForRequest = (headline: string) => checkNarrative({ headline, markets: {} }, allowedNumbers(facts, request, 0.7), facts, request, 0.7);
  assert.ok(checkForRequest("Germany food inflation is 2.2% YoY.").length);
  assert.deepEqual(checkForRequest("Germany has a proposed 2.2% price change and a 2.2% cost rise."), []);
});

test("known internal payload keys are rejected in all user-facing narrative fields", () => {
  for (const key of ["cost_vs_market", "cost_need_pct", "benchmark_range_pct", "suggested_range_pct", "cost_share_pct", "latestYoy", "averageCount", "pass_through_needed_pct"]) {
    const text = `Check ${key} before deciding.`;
    for (const n of [{ headline: text }, { watch: text }, { markets: { DE: text } }]) assert.ok(check(n).length, `${key}: ${JSON.stringify(n)}`);
  }
  assert.deepEqual(check({ headline: "Cost versus market comparison", watch: "Re-check the cost share and the historical market benchmark." }), []);
});

test("a market paragraph cannot attribute its own rate to another named country", () => {
  assert.ok(check({ markets: { DE: "Canada food inflation is 1.4% YoY." } }).length);
  assert.ok(check({ markets: { CA: "German food inflation is 2.2% YoY." } }).length);
  assert.deepEqual(check({ markets: { DE: "German food inflation is 1.4% YoY.", CA: "Canada food inflation is 2.2% YoY." } }), []);
});

test("Watch comparisons must agree with each named country's computed verdict", () => {
  assert.ok(check({ watch: "Germany and Canada: the proposed 5% is below the market benchmark." }).length);
  assert.deepEqual(check({ watch: "Germany and Canada: the proposed 5% is above the market benchmark." }), []);
  assert.deepEqual(check({ watch: "Germany has 1.4% YoY inflation; the proposed +5% is above the market benchmark in Canada." }), []);
});

test("compared-with clauses retain the rate belonging to each named country", () => {
  const valid = "In Germany, inflation is 1.4% YoY compared with 2.2% in Canada.";
  assert.deepEqual(check({ headline: valid }), []);
  assert.deepEqual(check({ watch: valid }), []);
  assert.ok(check({ headline: "In Germany, inflation is 2.2% YoY compared with 1.4% in Canada." }).length);
});

test("Markdown emphasis cannot hide an internal payload key", () => {
  for (const text of ["Check __cost_vs_market__ before deciding.", "Check _cost_need_pct_ before deciding.", "Check **benchmark_range_pct** before deciding."]) {
    for (const n of [{ headline: text }, { watch: text }, { markets: { DE: text } }]) assert.ok(check(n).length, JSON.stringify(n));
  }
});

test("country adjectives keep proposal verdicts attached to the named market", () => {
  const request = { ...req, proposedChangePct: 2.2 };
  const mixed = buildFacts(rows, request, "Q1", 0.7, new Date("2026-10-27"));
  const checkMixed = (n: Partial<Narrative>) => checkNarrative({ headline: "Historical comparison", markets: {}, ...n }, allowedNumbers(mixed, request, 0.7), mixed, request, 0.7);
  for (const field of ["headline", "watch"]) {
    assert.ok(checkMixed({ [field]: "The proposed 2.2% is within the market benchmark in the German market." }).length);
    assert.deepEqual(checkMixed({ [field]: "The proposed 2.2% is above the market benchmark in the German market." }), []);
  }
});
