// A proposal 0.1 pp outside a narrow historical benchmark (US 2.5-2.9% at +3%, 28 Oct) is above it, but the verdict
// should not read like a hard threshold: the How far line names close calls.
import test from "node:test";
import assert from "node:assert/strict";
import { gapSummary } from "../src/brief.ts";

const fact = (country: string, low: number, high: number, verdict: string) => ({ country, category: { concept: "food", label: "Food", frequency: "M", sourceId: `x:${country}`, latestPeriod: "2026-09", latestYoy: low, avg12: high, trend: "flat", points: [] }, suggested: { low, high }, verdict });
const brief = (p: number, facts: any[]): any => ({ request: { raw: "", countries: facts.map((f) => f.country), concept: "food", conceptWords: [], proposedChangePct: p, unknownCountries: [] }, facts });

test("0.2 pp or less outside a benchmark is named as a close call", () => {
  assert.equal(gapSummary(brief(3, [fact("US", 2.5, 2.9, "above the market benchmark"), fact("CA", 2.2, 4.1, "within the market benchmark")])),
    "How far: +3% is 0.1 pp above the US benchmark top (2.9%), within CA (2.2–4.1%). US is a close call (0.2 pp or less outside the benchmark).");
  assert.match(String(gapSummary(brief(1.2, [fact("CA", 1.4, 2.0, "below the market benchmark"), fact("AU", 1.3, 1.5, "below the market benchmark")]))), /CA and AU are a close call/);
});

test("clearly outside or within is not called close", () => {
  const s = String(gapSummary(brief(5, [fact("DE", 0.4, 1.4, "above the market benchmark"), fact("CA", 2.2, 4.1, "above the market benchmark")])));
  assert.doesNotMatch(s, /close call/);
  assert.doesNotMatch(String(gapSummary(brief(3, [fact("CA", 2.2, 4.1, "within the market benchmark")]))), /close call/);
});
