// What a viewer reads when a source fails: one plain line, not a Spark stack (the raw text stays in the trace data).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { humanError } from "../src/sources/index.ts";
import { mergeNotes } from "../src/brief.ts";

test("Zetaris/Spark failures read as one plain line", () => {
  const html = 'Error: Zetaris HTTP 400: {"msg":"org.apache.hive.service.cli.HiveSQLException: Error running query: org.apache.spark.SparkException: Job aborted due to stage failure: Task 0 in stage 7171.0 failed 1 times, most recent failure: Lost task 0.0 in stage 7171.0 (TID 6257) (f8623fda6bbf executor driver): java.lang.IllegalArgumentException: The value (<!--Last modified Dec 16, 2021 by Hasan Skaiky-->\\r\\n<!DOCTYPE html>';
  assert.equal(humanError(html), "the agency returned a web page instead of data (likely maintenance), so Zetaris could not read the series");
  assert.equal(humanError('Error: Zetaris HTTP 400: {"msg":"org.apache.spark.SparkException: Job aborted due to stage failure: Lost task 0.0: java.net.SocketException: Connection reset"}'), "the connection to the agency dropped while Zetaris was reading the series");
  assert.equal(humanError('Error: Zetaris HTTP 400: {"msg":"org.apache.hive.service.cli.HiveSQLException: Error running query: org.apache.spark.SparkException: Job aborted"}'), "Zetaris could not read the agency's response");
  assert.equal(humanError("Error: GET www150.statcan.gc.ca failed: fetch failed (cause: ECONNRESET socket hang up)"), "the connection to the agency dropped");
  assert.equal(humanError("Error: www150.statcan.gc.ca -> HTTP 503: busy"), "the agency returned HTTP 503");
  assert.equal(humanError("AbortError: The operation was aborted due to timeout"), "the request timed out");
  assert.equal(humanError("view has no fresh M observation period (latest 2025-12)"), "view has no fresh M observation period (latest 2025-12)");
});

test("the same caveat sentence is not repeated across notes", () => {
  const disc = "Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.";
  const proxy = "Food and non-alcoholic beverages is used as a broader category proxy (coarser) for these products; a product-specific selection was unavailable or unusable.";
  const out = mergeNotes([`DE: ${disc}`, `DE condiments: ${disc} ${proxy}`, `DE snacks: ${disc} ${proxy}`, `AU snacks: ${proxy}`]);
  assert.equal(out.filter((n) => n.includes("looks discontinued")).length, 1);
  assert.ok(out.includes(`DE condiments: ${proxy}`), JSON.stringify(out));
  assert.ok(out.includes(`AU snacks: ${proxy}`));
});

test("the guardrail line says the planner skipped a remembered series, not that it was not requested", () => {
  const src = fs.readFileSync(new URL("../src/agent.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /is in memory but was not requested/);
  assert.match(src, /the planner skipped \$\{p\.country\} \$\{p\.concept\}, which is remembered/);
});

test("onboarding failures in the trace use the plain line and keep the raw error in the trace data", () => {
  const src = fs.readFileSync(new URL("../src/agent.ts", import.meta.url), "utf8");
  assert.match(src, /\$\{r\.ok \? `[^`]*` : `: \$\{humanError\(r\.error\)\}`\}/);
  assert.match(src, /\$\{result\.ok \? `[^`]*` : `: \$\{humanError\(result\.error\)\}`\}/);
});
