// The facts give each series' observation count (averageCount, e.g. "12 of 12 monthly observations"), and Nemotron
// repeats it. Example 06 on 27 Oct 18:56 lost two true sentences ("... a 12-month average of 2.1% and 12
// observations.") because the count was not an allowed number. A wrong rate of the same value is still rejected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedNumbers, buildFacts, checkNarrative } from "../src/brief.ts";
import type { Request } from "../src/agent.ts";

const req: Request = { raw: "italy food +3%", countries: ["IT"], concept: "food", conceptWords: ["food"], proposedChangePct: 3, passThrough: 0.7, unknownCountries: [] };
const rows = Array.from({ length: 12 }, (_, i) => ({ country: "IT", concept: "food", category_label: "Food and non-alcoholic beverages", frequency: "M", period: `2025-${String(i + 10 > 12 ? i - 2 : i + 10).padStart(2, "0")}`.replace(/^2025-(0[1-9])$/, "2026-$1"), yoy_pct: i === 11 ? 1.7 : 2.13, source_id: "eurostat:x" }));
const facts = buildFacts(rows, req, "Q1", 0.7, new Date("2026-10-27"));
const check = (text: string) => checkNarrative({ headline: "Historical market comparison", markets: { IT: text } }, allowedNumbers(facts, req, 0.7), facts, req, 0.7);

test("a series' observation count may be repeated; a rate with that value may not", () => {
  const s = facts[0].category!;
  assert.equal(s.averageCount, 12);
  assert.deepEqual(check(`Italian food inflation is ${s.latestYoy}% YoY in ${s.latestPeriod}, with a 12-month average of ${s.avg12}% and 12 observations.`), []);
  assert.ok(check(`Italian food inflation is 12% YoY in ${s.latestPeriod}.`).length);
});

test("a stated observation count must be the series' count", () => {
  // Example 06 (27 Oct 18:56): "French food inflation is 1.5% YoY ..., with a 12-month average of 1.5% and 1 observation."
  // passed the check although the series had 12 of 12 observations.
  const s = facts[0].category!;
  const bad = check(`Italian food inflation is ${s.latestYoy}% YoY in ${s.latestPeriod}, with a 12-month average of ${s.avg12}% and 1 observation.`);
  assert.ok(bad.some((b) => /1 observation.*12/.test(b)), bad.join(" | "));
  assert.deepEqual(check(`Italian food inflation is ${s.latestYoy}% YoY, based on 12 of 12 monthly observations.`), []);
});

test("allowing the observation count does not let the same number through as a rate or a gap (review, 27 Oct 19:10)", () => {
  for (const t of ["A 12% price rise would be above the market benchmark.", "Italian food inflation has eased by 12 points."]) assert.ok(check(t).length, t);
});
