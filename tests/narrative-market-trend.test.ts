// "Code checks every number, verdict and trend claim": a trend claimed for one market must be that market's computed
// trend (vs six months ago), not only "easing in every market" claims.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { Request } from "../src/agent.ts";
import { allowedNumbers, checkNarrative } from "../src/brief.ts";

const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/demo1-narrative-drafts.json", import.meta.url), "utf8")); // DE, CA easing; AU flat
const req: Request = { raw: fx.question, countries: fx.requestedCountries, concept: fx.concept, conceptWords: [fx.concept], proposedChangePct: fx.proposed, passThrough: fx.passThrough, unknownCountries: [] };
const allowed = allowedNumbers(fx.facts, req, fx.passThrough);
const trendErrors = (n: any) => checkNarrative({ headline: "+5% is above the market benchmark in DE, CA and AU.", markets: {}, ...n }, allowed, fx.facts, req, fx.passThrough).filter((b) => /computed trend is/.test(b));

test("a wrong trend for a named market, or in a market's own paragraph, is rejected", () => {
  assert.deepEqual(trendErrors({ headline: "German food inflation is rising; +5% is above the market benchmark in DE, CA and AU." }), ["headline: says DE is rising, but the computed trend is easing"]);
  assert.deepEqual(trendErrors({ markets: { AU: "Australian food inflation is cooling at 3.0%." } }), ["AU: says AU is easing, but the computed trend is flat"]);
  assert.deepEqual(trendErrors({ headline: "Food inflation is easing in Germany and flat in Canada and Australia; +5% is above the market benchmark in DE, CA and AU." }), ["headline: says CA is flat, but the computed trend is easing"]);
});

test("true trends, each bound to its own markets, pass; so do averages, all-items, negations, exceptions and a 'flat 5%' proposal", () => {
  for (const h of [
    "Food inflation is easing in Germany and Canada and flat in Australia; +5% is above the market benchmark in DE, CA and AU.",
    "Germany is easing and Australia flat; +5% is above the market benchmark in DE, CA and AU.",
    "Food inflation is easing everywhere except Australia; +5% is above the market benchmark in DE, CA and AU.",
    "A flat 5% rise is above the market benchmark in DE, CA and AU.",
    "Australian food inflation is not easing; +5% is above the market benchmark in DE, CA and AU.",
  ]) assert.deepEqual(trendErrors({ headline: h }), [], h);
  assert.deepEqual(trendErrors({ markets: { AU: "Australian food inflation is flat at 3.0% YoY, close to its 12-month average of 3.2%.", CA: "All-items inflation is rising in Canada while food eased to 2.2%." } }), []);
});
