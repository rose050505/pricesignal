// A trend claimed for every market must hold in each one. Live on 27 Oct 18:28, Nemotron (thinking off) headlined
// "Food inflation is easing in all three markets" while code computed AU as flat (3.1% -> 3.0%), and the fact check,
// which checks numbers and verdicts, let it through. Claims about named markets are not judged by this rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { Request } from "../src/agent.ts";
import { allowedNumbers, checkNarrative, salvageNarrative } from "../src/brief.ts";

const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/demo1-narrative-drafts.json", import.meta.url), "utf8"));
const req: Request = { raw: fx.question, countries: fx.requestedCountries, concept: fx.concept, conceptWords: [fx.concept], proposedChangePct: fx.proposed, passThrough: fx.passThrough, unknownCountries: [] };
const allowed = allowedNumbers(fx.facts, req, fx.passThrough);
const check = (headline: string, watch?: string) => checkNarrative({ headline, markets: {}, ...(watch ? { watch } : {}) }, allowed, fx.facts, req, fx.passThrough);
const allEasing = fx.facts.map((f: any) => ({ ...f, category: { ...f.category, trend: "easing" } }));

test("'easing in all three markets' is rejected when one market is flat", () => {
  const bad = check("Food inflation is easing in all three markets; a blanket +5% Q1 increase looks above the evidence everywhere.");
  assert.ok(bad.some((b) => /easing in every market, but AU is flat/.test(b)), bad.join(" | "));
  assert.ok(check("+5% is above the market benchmark in DE, CA and AU.", "Watch whether food inflation keeps cooling across all markets.").some((b) => /AU is flat/.test(b)));
  assert.ok(check("Food inflation is rising everywhere; +5% is above the market benchmark in DE, CA and AU.").some((b) => /rising in every market/.test(b)));
});

test("the same claim passes when it is true, and claims about named markets or the price rise are left alone", () => {
  const h = "Food inflation is easing in all three markets; +5% is above the market benchmark in DE, CA and AU.";
  assert.deepEqual(checkNarrative({ headline: h, markets: {} }, allowed, allEasing, req, fx.passThrough), []);
  assert.deepEqual(check("A 5% price rise is above the market benchmark in all three markets."), []);
  assert.deepEqual(check("+5% is above the market benchmark everywhere."), []);
});

test("salvage replaces the false headline with the code headline and keeps the market paragraphs", () => {
  const draft = { ...fx.drafts.headlineOnly, headline: "Food inflation is easing in all three markets; +5% is above the benchmark everywhere." };
  const s = salvageNarrative(draft, allowed, fx.facts, req, fx.passThrough)!;
  assert.ok(s, "salvaged");
  assert.equal(s.headlineByCode, true);
  assert.deepEqual(Object.keys(s.markets).sort(), ["AU", "CA", "DE"]);
});
