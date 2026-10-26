import test from "node:test";
import assert from "node:assert/strict";
import { buildAlignment } from "../src/alignment.ts";
import type { Request } from "../src/agent.ts";
import type { MarketFacts, SeriesFacts } from "../src/brief.ts";
import type { Country } from "../src/sources/types.ts";

const now = new Date("2026-10-27T00:00:00Z");
const req = (countries: Country[] = ["DE", "CA"], concept = "food"): Request => ({ raw: "compare", countries, concept, conceptWords: [concept], unknownCountries: [] });
const source = (country: Country) => `fixture:${country}:food`;
const row = (country: Country, period: unknown, yoy: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ country, concept: "food", category_label: `${country} Food`, source_id: source(country), frequency: "M", period, yoy_pct: yoy, ...extra });
const fact = (country: Country, extra: Partial<SeriesFacts> = {}): MarketFacts => ({ country, agency: "fixture", cite: "Q1", category: { concept: "food", label: `${country} Food`, sourceId: source(country), frequency: "M", latestPeriod: "2026-09", latestYoy: 3.1, avg12: 2.5, averageCount: 12, averageExpected: 12, averageLabel: "12 of 12 monthly observations", trend: "flat", points: [], ...extra } });
const facts = () => [fact("DE"), fact("CA")];

test("uses the latest actual intersection for every requested market, preserving raw precision and latest facts", () => {
  const request = req(["AU", "DE", "CA"]);
  const fs = [fact("DE", { latestPeriod: "2026-10", latestYoy: 4.2 }), fact("CA"), fact("AU")];
  const rows = [row("CA", "2026-09", 2), row("DE", "2026-10", 4.2), row("AU", "2026-08", -1.2345), row("CA", "2026-08", "2.3456"), row("DE", "2026-08", 3.4567), row("AU", "2026-07", 9), row("DE", "2026-07", 9), row("CA", "2026-07", 9)];
  const original = structuredClone({ request, fs, rows });
  const result = buildAlignment(rows, request, fs, "Q17", now);
  assert.equal(result.status, "aligned");
  if (result.status !== "aligned") return;
  assert.equal(result.period, "2026-08");
  assert.equal(result.frequency, "M");
  assert.equal(result.monthsOld, 2);
  assert.equal(result.cite, "Q17");
  assert.deepEqual(result.requestedCountries, ["AU", "DE", "CA"]);
  assert.deepEqual(result.rows.map(r => [r.country, r.yoy]), [["AU", -1.2345], ["DE", 3.4567], ["CA", 2.3456]]);
  assert.deepEqual(result.rows[1], { country: "DE", label: "DE Food", sourceId: source("DE"), yoy: 3.4567, latestPeriod: "2026-10", latestYoy: 4.2 });
  assert.match(result.note, /date|period/i);
  assert.match(result.note, /basket/i);
  assert.match(result.note, /categor/i);
  assert.deepEqual({ request, fs, rows }, original);
});

test("requires at least two distinct requested markets", () => {
  for (const countries of [[], ["DE"], ["DE", "DE"]] as Country[][]) {
    const result = buildAlignment([row("DE", "2026-09", 2)], req(countries), facts(), "Q1", now);
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable") assert.match(result.reason, /at least two|two distinct/i);
  }
});

test("cannot replace a missing requested category with an all-items series", () => {
  const ca = fact("CA");
  const missingCategory: MarketFacts = { country: "CA", agency: "fixture", cite: "Q1", allItems: { ...ca.category!, concept: "all_items" } };
  for (const fs of [[fact("DE")], [fact("DE"), missingCategory]]) {
    const result = buildAlignment([row("DE", "2026-09", 2), row("CA", "2026-09", 3)], req(), fs, "Q1", now);
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable") assert.match(result.reason, /CA.*food|food.*CA/);
  }
});

test("aligns all-items when all-items is the requested concept", () => {
  const fs = facts().map(f => ({ ...f, category: undefined, allItems: { ...f.category!, concept: "all_items" } }));
  const result = buildAlignment([row("DE", "2026-09", 2, { concept: "all_items" }), row("CA", "2026-09", 3, { concept: "all_items" })], req(["DE", "CA"], "all_items"), fs, "Q1", now);
  assert.equal(result.status, "aligned");
  assert.equal(result.concept, "all_items");
});

test("mixed monthly and quarterly sources do not acquire a fabricated common period", () => {
  const result = buildAlignment([row("DE", "2026-09", 2), row("CA", "2026-Q3", 3, { frequency: "Q" })], req(), [fact("DE"), fact("CA", { frequency: "Q", latestPeriod: "2026-Q3" })], "Q1", now);
  assert.equal(result.status, "unavailable");
  if (result.status === "unavailable") assert.match(result.reason, /mixed|monthly.*quarterly/i);
});

test("only exact country, concept, source identity and frequency can contribute observations", () => {
  const de = row("DE", "2026-09", 2);
  const intruders = [{ country: "AU" }, { concept: "all_items" }, { source_id: "fixture:other" }, { frequency: "Q" }, { frequency: undefined }];
  for (const extra of intruders) {
    const result = buildAlignment([de, row("CA", "2026-09", 3, extra)], req(), facts(), "Q1", now);
    assert.equal(result.status, "unavailable", JSON.stringify(extra));
  }
  const result = buildAlignment([de, row("CA", "2026-09", 3), row("CA", "2026-09", 90, { source_id: "fixture:other" })], req(), facts(), "Q1", now);
  assert.equal(result.status, "aligned");
});

test("null, empty, boolean and non-finite rates are excluded instead of becoming zero", () => {
  for (const value of [undefined, null, "", "  ", false, true, NaN, Infinity, -Infinity, "Infinity", "invalid"]) {
    const result = buildAlignment([row("DE", "2026-09", 2), row("CA", "2026-09", value)], req(), facts(), "Q1", now);
    assert.equal(result.status, "unavailable", String(value));
  }
  const result = buildAlignment([row("DE", "2026-09", "0"), row("CA", "2026-09", " -2.345 ")], req(), facts(), "Q1", now);
  assert.equal(result.status, "aligned");
  if (result.status === "aligned") assert.deepEqual(result.rows.map(r => r.yoy), [0, -2.345]);
});

test("invalid or future monthly periods cannot displace a real common period", () => {
  for (const period of [undefined, null, "", "2026-9", "2026-00", "2026-13", "2026-Q3", "2026-11", "2027-01", 202609]) {
    const result = buildAlignment([row("DE", "2026-08", 2), row("CA", "2026-08", 3), row("DE", period, 80), row("CA", period, 90)], req(), facts(), "Q1", now);
    assert.equal(result.status, "aligned", String(period));
    if (result.status === "aligned") assert.equal(result.period, "2026-08", String(period));
  }
});

test("quarterly period age uses the quarter's end month and excludes unfinished future quarters", () => {
  const fs = [fact("DE", { frequency: "Q", latestPeriod: "2026-Q3" }), fact("CA", { frequency: "Q", latestPeriod: "2026-Q3" })];
  const rows = [row("DE", "2026-Q3", 2, { frequency: "Q" }), row("CA", "2026-Q3", 3, { frequency: "Q" }), row("DE", "2026-Q4", 99, { frequency: "Q" }), row("CA", "2026-Q4", 99, { frequency: "Q" }), row("DE", "2026-Q5", 80, { frequency: "Q" }), row("CA", "2026-Q5", 90, { frequency: "Q" })];
  const result = buildAlignment(rows, req(), fs, "Q1", now);
  assert.equal(result.status, "aligned");
  if (result.status === "aligned") {
    assert.equal(result.period, "2026-Q3");
    assert.equal(result.frequency, "Q");
    assert.equal(result.monthsOld, 1);
  }
});

test("an older common period remains dated honestly instead of substituting unmatched latest releases", () => {
  const rows = [row("DE", "2025-12", 1), row("CA", "2025-12", 2), row("DE", "2026-09", 3), row("CA", "2026-08", 4)];
  const result = buildAlignment(rows, req(), facts(), "Q1", now);
  assert.equal(result.status, "aligned");
  if (result.status === "aligned") {
    assert.equal(result.period, "2025-12");
    assert.equal(result.monthsOld, 10);
  }
});

test("non-overlapping histories are unavailable, with no interpolation", () => {
  const result = buildAlignment([row("DE", "2026-09", 2), row("CA", "2026-08", 3)], req(), facts(), "Q1", now);
  assert.equal(result.status, "unavailable");
  if (result.status === "unavailable") assert.match(result.reason, /common|intersection|overlap/i);
});

test("identical duplicate observations are harmless, but conflicting raw values make alignment unavailable", () => {
  const original = [row("DE", "2026-09", 2.21), row("CA", "2026-09", 3)];
  assert.equal(buildAlignment([...original, row("DE", "2026-09", "2.21")], req(), facts(), "Q1", now).status, "aligned");
  const result = buildAlignment([...original, row("DE", "2026-09", 2.24)], req(), facts(), "Q1", now);
  assert.equal(result.status, "unavailable", "values that round to the same display value still conflict");
  if (result.status === "unavailable") assert.match(result.reason, /conflict.*DE.*2026-09/i);
});

test("unsupported source frequency and missing source identity are explicit unavailable states", () => {
  for (const extra of [{ frequency: "A" }, { sourceId: "" }]) {
    const result = buildAlignment([row("DE", "2026-09", 2), row("CA", "2026-09", 3)], req(), [fact("DE"), fact("CA", extra)], "Q1", now);
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable") assert.match(result.reason, /frequency|source identity/i);
  }
});
