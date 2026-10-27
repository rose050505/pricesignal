import test from "node:test";
import assert from "node:assert/strict";
import { COMPARE_COLUMNS } from "../src/sources/index.ts";
import { toResult as realToResult } from "../src/result.ts";
import { basketNote, fallbackHeadline, fitSummary, gapSummary, mergeNotes } from "../src/brief.ts";

const toResult = (b: any): any => realToResult(b);

test("partial and final UI results carry the run time and full requested market scope", () => {
  const b: any = { request: { countries: ["DE", "CA"], unknownCountries: ["Japan"], concept: "food" }, startedAt: "2026-10-26T17:30:00.000Z", facts: [{ country: "DE" }, { country: "CA" }], notes: [], views: [], sqlLog: [], compared: { id: "Q1", sql: "SELECT", rows: [] }, ms: 1000, passThrough: 1 };
  for (const partialStage of ["markets", "pricing", undefined]) {
    const result = toResult({ ...b, partialStage });
    assert.equal(result.startedAt, b.startedAt);
    assert.deepEqual(result.requestedCountries, b.request.countries);
    assert.deepEqual(result.unsupportedCountries, ["Japan"]);
    assert.equal(result.facts.length, 2, "SKU results must not extend the market evidence scope");
  }
});
