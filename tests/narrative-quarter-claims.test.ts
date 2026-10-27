// Nemotron (thinking off) wrote "a blanket +5% Q1 increase" for "japan + canada food prices, ok to raise 5%?"
// (example 04, 27 Oct 18:56): the question names no quarter. A quarter in the prose must come from the request or
// from a quarterly observation period; follow-ups such as "same as last time" may carry the earlier quarter.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { Request } from "../src/agent.ts";
import { allowedNumbers, checkNarrative } from "../src/brief.ts";

const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/demo1-narrative-drafts.json", import.meta.url), "utf8"));
const base: Request = { raw: "germany, canada and australia food prices, ok to raise 5%?", countries: fx.requestedCountries, concept: fx.concept, conceptWords: [fx.concept], proposedChangePct: fx.proposed, passThrough: fx.passThrough, unknownCountries: [] };
const check = (headline: string, req: Request = base, facts = fx.facts) => checkNarrative({ headline, markets: {} }, allowedNumbers(facts, req, fx.passThrough), facts, req, fx.passThrough);
const H = "+5% is above the market benchmark in DE, CA and AU";

test("a quarter the request did not name is rejected", () => {
  assert.ok(check(`A blanket +5% Q1 increase looks above the evidence; ${H}.`).some((b) => /mentions Q1/.test(b)));
});

test("a quarter from the request, a Korean quarter, a quarterly period or a follow-up passes", () => {
  assert.deepEqual(check(`A +5% Q1 increase: ${H}.`, { ...base, raw: base.raw + " thinking +5% for Q1" }), []);
  assert.deepEqual(check(`A +5% Q1 increase: ${H}.`, { ...base, raw: "독일 캐나다 호주 식품, 내년 1분기에 5% 올려도 될까" }), []);
  assert.deepEqual(check(`A +5% Q1 increase: ${H}.`, { ...base, raw: "same as last time, but what about +5%?" }), []);
  const quarterly = fx.facts.map((f: any) => (f.country === "AU" ? { ...f, category: { ...f.category, frequency: "Q", latestPeriod: "2026-Q3" } } : f));
  assert.deepEqual(check(`Australia's Q3 reading: ${H}.`, base, quarterly), []);
});
