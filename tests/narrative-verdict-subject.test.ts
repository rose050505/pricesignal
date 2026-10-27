// A verdict is about the proposed change. Replays on 27 Oct 23:50 produced headlines such as "Food inflation is above
// the market benchmark in all three markets" and "France, Italy and Spain food inflation all above the market benchmark":
// every verdict word matched, so the checks passed, but the sentence says inflation exceeds its own benchmark.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { Request } from "../src/agent.ts";
import { allowedNumbers, checkNarrative } from "../src/brief.ts";

const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/demo1-narrative-drafts.json", import.meta.url), "utf8"));
const req: Request = { raw: fx.question, countries: fx.requestedCountries, concept: fx.concept, conceptWords: [fx.concept], proposedChangePct: fx.proposed, passThrough: fx.passThrough, unknownCountries: [] };
const allowed = allowedNumbers(fx.facts, req, fx.passThrough);
const check = (headline: string) => checkNarrative({ headline, markets: {} }, allowed, fx.facts, req, fx.passThrough);

test("inflation as the subject of a verdict is rejected", () => {
  for (const h of ["Food inflation is above the market benchmark in all three markets", "Germany, Canada and Australia food inflation all above the market benchmark.", "Food inflation sits above its benchmark everywhere; +5% is too much."]) {
    assert.ok(check(h).some((b) => /headline: says inflation itself is above the market benchmark; the verdict is about the proposed change/.test(b)), h);
  }
});

test("the proposal as the subject, or inflation with its own figure, passes", () => {
  for (const h of ["+5% is above the market benchmark in DE, CA and AU.", "Food inflation is easing in Germany and Canada and flat in Australia; the proposed +5% rise is above the market benchmark everywhere.", "With food inflation easing, a +5% price increase sits above the market benchmark in all three markets."]) {
    assert.deepEqual(check(h).filter((b) => /inflation itself/.test(b)), [], h);
  }
});

test("countries in a trend clause are not read as part of a later verdict (replay, 27 Oct 23:59)", () => {
  // The repaired 02 headline was true but rejected: DE and CA in "easing in DE and CA" were given the "above" verdict.
  const mixed = fx.facts.map((f: any) => ({ ...f, verdict: f.country === "DE" ? "above the market benchmark" : "within the market benchmark" }));
  const r3 = { ...req, proposedChangePct: 3 };
  const run = (h: string) => checkNarrative({ headline: h, markets: {} }, allowedNumbers(mixed, r3, fx.passThrough), mixed, r3, fx.passThrough).filter((b) => /headline "/.test(b));
  assert.deepEqual(run("Inflation easing in DE and CA; flat in AU; +3% above in DE, within in CA and AU"), []);
  assert.ok(run("Inflation easing in DE and CA; +3% is above the market benchmark in DE and CA").some((b) => /for CA/.test(b)));
  assert.ok(run("In DE, CA and AU, +3% is above the market benchmark").some((b) => /for CA/.test(b)), "a clause without a trend still takes the later verdict");
});

test("a verdict with no market of its own still has to hold, even when every country is named in a trend clause (review, 28 Oct 00:00)", () => {
  // Every market is above: these headlines were checked against nothing after the trend-clause change.
  assert.ok(check("Food inflation is easing in DE and CA and flat in AU; +5% is within the market benchmark.").some((b) => /headline "within" for every market/.test(b)));
  const mixed = fx.facts.map((f: any) => ({ ...f, verdict: f.country === "DE" ? "above the market benchmark" : "within the market benchmark" }));
  const r3 = { ...req, proposedChangePct: 3 };
  const run = (h: string) => checkNarrative({ headline: h, markets: {} }, allowedNumbers(mixed, r3, fx.passThrough), mixed, r3, fx.passThrough).filter((b) => /headline "/.test(b));
  assert.ok(run("Inflation is easing in DE, CA and AU; +3% is within the market benchmark").some((b) => /for every market \(computed: DE above/.test(b)));
  assert.deepEqual(check("Food inflation easing in DE and CA; flat in AU; +5% is above the market benchmark in all three markets"), []);
});

test("the proposal or the plan as the subject passes; inflation with only verbs or markets before the verdict does not (review, 28 Oct 00:00)", () => {
  for (const h of ["Easing inflation leaves the proposed move above the market benchmark in DE, CA and AU.", "Easing inflation leaves the plan above the market benchmark in DE, CA and AU."]) {
    assert.deepEqual(check(h).filter((b) => /inflation itself/.test(b)), [], h);
  }
  const watch = checkNarrative({ headline: "+5% is above the market benchmark in DE, CA and AU.", markets: {}, watch: "Re-check next month's inflation to see whether the plan is still above the market benchmark." }, allowed, fx.facts, req, fx.passThrough);
  assert.deepEqual(watch.filter((b) => /inflation itself/.test(b)), []);
  for (const h of ["Inflation in DE, CA and AU is now above the market benchmark.", "Food inflation exceeds the market benchmark in DE, CA and AU."]) {
    assert.ok(check(h).some((b) => /inflation itself/.test(b)), h);
  }
});
