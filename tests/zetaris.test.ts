import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as zetaris from "../src/zetaris.ts";
import { skuRatesSql, SKU_RATE_COLUMNS } from "../src/sources/pricelist.ts";

function client(): zetaris.ZetarisClient {
  // Explicit fixture credentials avoid loading any environment file.
  return new zetaris.ZetarisClient("https://zetaris.fixture.invalid/api", "fixture-token", "fixture-org");
}

function mockResponse(t: TestContext, response: unknown | ((body: any) => unknown)) {
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    return new Response(JSON.stringify(typeof response === "function" ? response(body) : response), { status: 200 });
  });
  return requests;
}

test("object rows use the first row's column names even when later keys have another order", async (t) => {
  mockResponse(t, { data: [{ country: "DE", yoy_pct: 2 }, { yoy_pct: 3, country: "CA" }] });
  const result = await client().run("SELECT country, yoy_pct FROM fixture");
  assert.deepEqual(result.columns, ["country", "yoy_pct"]);
  assert.deepEqual(zetaris.rowsAsObjects(result), [{ country: "DE", yoy_pct: 2 }, { country: "CA", yoy_pct: 3 }]);
});

test("object rows prefer declared metadata columns over object insertion order", async (t) => {
  for (const header of [
    { columns: ["country", "yoy_pct"] },
    { metadata: { columns: [{ name: "country" }, { name: "yoy_pct" }] } },
  ]) await t.test(JSON.stringify(header), async (st) => {
    mockResponse(st, { ...header, data: [{ yoy_pct: 2, country: "DE" }, { country: "CA", yoy_pct: 3 }] });
    const result = await client().run("SELECT country, yoy_pct FROM fixture");
    assert.deepEqual(result.columns, ["country", "yoy_pct"]);
    assert.deepEqual(result.rows, [["DE", 2], ["CA", 3]]);
  });
});

test("missing object fields keep their own positions and explicit null stays null", async (t) => {
  mockResponse(t, { columns: ["country", "yoy_pct", "period"], data: [
    { country: "DE", yoy_pct: 2 },
    { period: "2026-09", country: "CA" },
    { yoy_pct: null, period: "2026-08", country: "AU" },
  ] });
  const result = await client().run("SELECT country, yoy_pct, period FROM fixture");
  assert.deepEqual(result.columns, ["country", "yoy_pct", "period"]);
  assert.deepEqual(result.rows, [["DE", 2, undefined], ["CA", undefined, "2026-09"], ["AU", null, "2026-08"]]);
});

test("a missing field without metadata cannot shift a later field into its place", async (t) => {
  mockResponse(t, { rows: [{ country: "DE", yoy_pct: 2 }, { yoy_pct: 3 }] });
  const result = await client().run("SELECT country, yoy_pct FROM fixture");
  assert.deepEqual(result.rows, [["DE", 2], [undefined, 3]]);
});

test("array responses retain metadata and positional fallback behavior", async (t) => {
  for (const named of [true, false]) await t.test(named ? "named" : "positional", async (st) => {
    mockResponse(st, { ...(named ? { columns: [{ name: "country" }, { name: "yoy_pct" }] } : {}), rows: [["DE", 2], ["CA", null]] });
    const result = await client().run("SELECT country, yoy_pct FROM fixture");
    assert.deepEqual(result.columns, named ? ["country", "yoy_pct"] : ["c0", "c1"]);
    assert.deepEqual(zetaris.rowsAsObjects(result, ["country", "yoy_pct"]), [{ country: "DE", yoy_pct: 2 }, { country: "CA", yoy_pct: null }]);
  });
});

test("999 rows below the default cap remain usable", async (t) => {
  const requests = mockResponse(t, { columns: ["n"], data: Array.from({ length: 999 }, (_, i) => [i]) });
  const result = await client().run("SELECT n FROM fixture");
  assert.equal(requests[0].limit, 1000);
  assert.equal(result.rows.length, 999);
});

test("exactly 1000 rows are conservatively rejected without exposing query or credentials", async (t) => {
  const requests = mockResponse(t, { columns: ["n"], data: Array.from({ length: 1000 }, (_, i) => [i]) });
  await assert.rejects(client().run("SELECT private_query_marker FROM fixture"), (error: unknown) => {
    assert.ok(error instanceof zetaris.IncompleteResultError);
    assert.equal(error.name, "IncompleteResultError");
    assert.equal(error.rowCount, 1000);
    assert.equal(error.limit, 1000);
    assert.match(error.message, /1000/);
    assert.match(error.message, /incomplete/i);
    assert.match(error.message, /not used|not using|cannot be used/i);
    assert.ok(!error.message.includes(requests[0].queryId));
    assert.doesNotMatch(error.message, /fixture-token|fixture-org|private_query_marker|https?:/);
    return true;
  });
});

test("the requested custom limit, including an overshoot, controls completeness checks", async (t) => {
  let count = 2;
  const requests = mockResponse(t, () => ({ columns: ["n"], data: Array.from({ length: count }, (_, i) => [i]) }));
  assert.equal((await client().run("SELECT n FROM fixture", { limit: 3 })).rows.length, 2);
  for (count of [3, 4]) await assert.rejects(client().run("SELECT n FROM fixture", { limit: 3 }), { name: "IncompleteResultError" });
  assert.deepEqual(requests.map(r => r.limit), [3, 3, 3]);
});

test("70 SKUs with 15 months cannot silently become 67 SKUs with an incomplete last history", async (t) => {
  const all: unknown[][] = [];
  for (let sku = 0; sku < 70; sku++) for (let month = 0; month < 15; month++) {
    const period = new Date(Date.UTC(2025, 6 + month, 1)).toISOString().slice(0, 7);
    all.push([`SKU${String(sku).padStart(3, "0")}`, `Product ${sku}`, "DE", "food", "EUR", 10, "food", "Food", "M", period, 2, "fixture:food"]);
  }
  assert.equal(all.length, 1050);
  const truncated = all.slice(0, 1000);
  assert.equal(new Set(truncated.map(row => row[0])).size, 67);
  assert.equal(truncated.at(-1)![0], "SKU066");
  assert.equal(truncated.at(-1)![9], "2026-04");
  const requests = mockResponse(t, (body: { limit: number }) => ({ columns: SKU_RATE_COLUMNS, data: all.slice(0, body.limit) }));
  await assert.rejects(client().run(skuRatesSql(["fixture_food"], ["DE"], "2025-07")), { name: "IncompleteResultError" });
  assert.equal(requests[0].limit, 1000);
});

test("a successful zero-row DDL response is preserved", async (t) => {
  mockResponse(t, { success: true, data: [] });
  const result = await client().run("CREATE SCHEMASTORE CONTAINER fixture");
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.columns, []);
});

test("incomplete results can be recognized across error class boundaries", () => {
  const local = new zetaris.IncompleteResultError(1000, 1000);
  assert.equal(zetaris.isIncompleteResultError(local), true);
  assert.equal(zetaris.isIncompleteResultError({ name: "IncompleteResultError" }), true);
  assert.equal(zetaris.isIncompleteResultError(new Error("ordinary failure")), false);
  assert.equal(zetaris.isIncompleteResultError(null), false);
  assert.equal(zetaris.isIncompleteResultError("IncompleteResultError"), false);
});
