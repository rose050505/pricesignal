// Small wording slips in the brief and the statement list: "1 months", "1 rows" and a "1.5–1.5%" benchmark.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { benchmarkText, renderBrief } from "../src/brief.ts";
import type { Request } from "../src/agent.ts";

const series = { concept: "food", label: "Food", frequency: "M", sourceId: "eurostat:prc_hicp_minr:CP01:RCH_A", latestPeriod: "2026-09", latestYoy: 1.5, avg12: 1.5, averageCount: 12, averageExpected: 12 as const, averageLabel: "12 of 12 monthly observations", trend: "flat" as const, points: [] };
const req: Request = { raw: "france and italy food +3%?", countries: ["FR", "IT"], concept: "food", conceptWords: ["food"], proposedChangePct: 3, passThrough: 0.7, unknownCountries: [] };
const facts: any[] = [
  { country: "FR", agency: "Eurostat (HICP)", category: series, cite: "Q1", suggested: { low: 1.5, high: 1.5 }, verdict: "above the market benchmark" },
  { country: "IT", agency: "Eurostat (HICP)", category: { ...series, latestYoy: 2.1, avg12: 2.4 }, cite: "Q1", suggested: { low: 2.1, high: 2.4 }, verdict: "above the market benchmark" },
];

test("a benchmark whose ends round to the same figure is written as one value", () => {
  assert.equal(benchmarkText({ low: 1.5, high: 1.5 }), "1.5% (single value)");
  assert.equal(benchmarkText({ low: 1.52, high: 1.46 }), "1.5% (single value)");
  assert.equal(benchmarkText({ low: 2.1, high: 2.4 }), "2.1–2.4%");
});

test("the brief says 1 month and 1 row, and writes a single-value benchmark once", () => {
  const md = renderBrief({ request: req, facts, notes: [], passThrough: 0.7, sqlLog: [{ id: "Q1", sql: "SELECT COUNT(*) AS n", columns: ["n"], rows: [[12]], ms: 5 }], compared: { id: "Q1", sql: "SELECT", columns: [], rows: [], ms: 5 }, views: [], ms: 1, trace: [],
    alignment: { status: "aligned", concept: "food", requestedCountries: ["FR", "IT"], period: "2026-09", frequency: "M", monthsOld: 1, cite: "Q1", note: "Dates only.", rows: [{ country: "FR", label: "Food", yoy: 1.5, latestPeriod: "2026-09", latestYoy: 1.5, sourceId: "eurostat:a" }, { country: "IT", label: "Food", yoy: 2.1, latestPeriod: "2026-09", latestYoy: 2.1, sourceId: "eurostat:b" }] } } as any);
  assert.match(md, /\| 1\.5% \(single value\) \|/);
  assert.doesNotMatch(md, /1\.5–1\.5%/);
  assert.match(md, /\| 2\.1–2\.4% \|/);
  assert.match(md, /monthly; 1 month before this brief/);
  assert.match(md, /Q1 · 1 row · 5 ms/);
});

test("the UI statement list says 1 row", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /\$\{q\.rows\} row\$\{q\.rows===1\?"":"s"\}/);
});
