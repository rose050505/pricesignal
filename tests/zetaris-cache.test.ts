// Zetaris CACHE TABLE on the raw Lightning REST tables: later queries read the cached response instead of calling
// the agency again (measured live: 0 endpoint calls after caching), and a market survives an agency outage.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { ensureCached, onboard, rawTableRef, resetCacheRegistry, sourceAnswers, type Candidate } from "../src/sources/index.ts";
import { discover as statcanDiscover } from "../src/sources/statcan.ts";
import type { SqlResult, SqlRunner } from "../src/zetaris.ts";

process.env.PSIG_VERBOSE = "0";

function recorder(fail: (sql: string) => boolean = () => false) {
  const sqls: string[] = [];
  const z: SqlRunner = {
    async run(sql: string): Promise<SqlResult> {
      sqls.push(sql);
      if (fail(sql)) throw new Error("Zetaris HTTP 400: REST source returned HTML");
      if (/^SELECT COUNT/.test(sql)) return { id: "x", sql, columns: ["n", "latest"], rows: [[14, "2026-09"]], ms: 1 };
      return { id: "x", sql, columns: [], rows: [], ms: 1 };
    },
  };
  return { z, sqls };
}
const statcanFood: Candidate = { agency: "statcan", country: "CA", dataset: "18100004", code: "v41690974", label: "Food", frequency: "M", measure: "index", status: "active", sourceUrl: "https://statcan.test/food" };

test("the agent's SQL allowlist accepts CACHE and UNCACHE TABLE, still one statement at a time", async () => {
  const { z } = recorder();
  const agent = new PriceSignalAgent({ sql: z, memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-cache-"))), llm: (async () => ({ text: "{}", model: "f", provider: "f", ms: 1 })) as any });
  const run = (sql: string) => (agent as any).sql.run(sql);
  for (const ok of ["CACHE TABLE psig_statcan.statcan_ca_v41690974_live", "CACHE LAZY TABLE psig_abs.t", "UNCACHE TABLE IF EXISTS psig_abs.t", "uncache table psig_abs.t"]) await run(ok);
  for (const bad of ["CACHE TABLE psig_abs.t; DROP TABLE psig_abs.t", "CLEAR CACHE", "REFRESH TABLE psig_abs.t"]) await assert.rejects(run(bad), /allowlist/, bad);
});

test("onboarding caches the raw REST table before verifying the view, so verification reads the cache", async () => {
  resetCacheRegistry();
  const { z, sqls } = recorder();
  const r = await onboard(z, statcanFood, "food", new Date("2026-10-27"));
  assert.equal(r.ok, true);
  assert.equal(r.cached, true);
  const raw = rawTableRef(statcanFood, "food");
  assert.match(raw, /^psig_statcan\.statcan_ca_v41690974_live/);
  const at = (re: RegExp) => sqls.findIndex((s) => re.test(s));
  assert.ok(at(/^CREATE LIGHTNING REST TABLE/) < at(/^CREATE SCHEMASTORE VIEW/));
  assert.ok(at(/^CREATE SCHEMASTORE VIEW/) < sqls.indexOf(`CACHE TABLE ${raw}`));
  assert.ok(sqls.indexOf(`CACHE TABLE ${raw}`) < at(/^SELECT COUNT/));
});

test("a cache older than its time-to-live is refreshed only when the agency answers; otherwise the cached copy is kept", async () => {
  resetCacheRegistry();
  const ref = "psig_statcan.t";
  const { z, sqls } = recorder();
  const t0 = Date.parse("2026-10-27T00:00:00Z");
  assert.equal((await ensureCached(z, ref, { now: t0 })).action, "cached");
  assert.equal((await ensureCached(z, ref, { now: t0 + 60_000, reachable: async () => true })).action, "kept");
  sqls.length = 0;
  const down = await ensureCached(z, ref, { now: t0 + 7 * 3_600_000, reachable: async () => false });
  assert.equal(down.action, "kept-stale");
  assert.ok(!sqls.some((s) => /^UNCACHE/.test(s)), "never drop the only copy while the agency is down");
  const up = await ensureCached(z, ref, { now: t0 + 8 * 3_600_000, reachable: async () => true });
  assert.equal(up.action, "refreshed");
  assert.deepEqual(sqls.slice(-2), [`UNCACHE TABLE IF EXISTS ${ref}`, `CACHE TABLE ${ref}`]);
});

test("a remembered series is cached before its freshness probe", async () => {
  resetCacheRegistry();
  const { z, sqls } = recorder();
  const memory = new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-cache-mem-")));
  for (const [c, k] of [["CA", "food"], ["CA", "all_items"]] as const)
    memory.rememberMapping({ country: c, concept: k, agency: "statcan", dataset: "18100004", code: k === "food" ? "v41690974" : "v41690973", label: k, view: `v_ca_${k}`, frequency: "M", decoderVersion: 2 } as any);
  const agent = new PriceSignalAgent({ sql: z, memory, hedgeMs: Infinity, llm: (async () => ({ text: "{}", model: "f", provider: "f", ms: 1 })) as any });
  await (agent as any).execute({ action: "use_memory_mapping", args: { country: "CA", concept: "food" } }, { countries: ["CA"], concept: "food", conceptWords: ["food"], unknownCountries: [], raw: "" }, { views: new Map(), candidates: new Map(), notes: [], key: (a: string, b: string) => `${a}:${b}`, pairs: [{ country: "CA", concept: "food" }], getCompared: () => undefined, setCompared: () => {} });
  const cache = sqls.findIndex((s) => /^CACHE TABLE psig_statcan\.statcan_ca_v41690974_live/.test(s));
  const probe = sqls.findIndex((s) => /^SELECT COUNT\(\*\) AS n, MAX\(period\) AS latest FROM psig\.v_ca_food/.test(s));
  assert.ok(cache >= 0 && probe > cache, sqls.join("\n"));
});

test("when StatCan's API is down during discovery, its catalogued vector is still offered so a cached Zetaris copy can be verified", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response("<!DOCTYPE html><html><head><title>Statistics Canada - We're sorry! The website is currently unavailable</title></head></html>", { status: 200 })) as any;
  try {
    const d = await statcanDiscover("CA", "food");
    assert.equal(d.candidates.length, 1);
    assert.equal(d.candidates[0].code, "v41690974");
    assert.equal(d.candidates[0].status, "unknown");
    assert.ok(d.notes.some((n) => /did not answer during discovery/.test(n) && /Zetaris/.test(n)), d.notes.join(" | "));
  } finally {
    globalThis.fetch = real;
  }
  // With no cached copy, verification still fails as before: the gate is the verified rows, not the catalogue.
  resetCacheRegistry();
  const { z } = recorder((sql) => /^CACHE TABLE|^SELECT COUNT/.test(sql));
  const r = await onboard(z, { ...statcanFood, status: "unknown" }, "food", new Date("2026-10-27"));
  assert.equal(r.ok, false);
});

test("a transient failure while caching or verifying a new source is retried once", async () => {
  process.env.PSIG_ONBOARD_RETRY_MS = "0";
  resetCacheRegistry();
  let failures = 2; // the first CACHE TABLE and the first verification fail, as StatCan did on 27 Oct 10:15
  const { z, sqls } = recorder((sql) => /^CACHE TABLE|^SELECT COUNT/.test(sql) && failures-- > 0);
  const r = await onboard(z, statcanFood, "food", new Date("2026-10-27"));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.cached, true);
  assert.equal(sqls.filter((s) => /^SELECT COUNT/.test(s)).length, 2);
  // A source that keeps failing still fails after the one retry.
  resetCacheRegistry();
  const down = recorder((sql) => /^CACHE TABLE|^SELECT COUNT/.test(sql));
  assert.equal((await onboard(down.z, statcanFood, "food", new Date("2026-10-27"))).ok, false);
  assert.equal(down.sqls.filter((s) => /^SELECT COUNT/.test(s)).length, 2);
});

test("a refresh whose CACHE fails right after UNCACHE tries CACHE once more instead of leaving the table uncached", async () => {
  resetCacheRegistry();
  const ref = "psig_abs.t";
  let failures = 0;
  const { z, sqls } = recorder((sql) => sql === `CACHE TABLE ${ref}` && sqls.some((s) => /^UNCACHE/.test(s)) && failures++ < 1);
  const t0 = Date.parse("2026-10-27T00:00:00Z");
  await ensureCached(z, ref, { now: t0 });
  const r = await ensureCached(z, ref, { now: t0 + 7 * 3_600_000, reachable: async () => true });
  assert.equal(r.action, "refreshed", r.error);
  assert.deepEqual(sqls.slice(-3), [`UNCACHE TABLE IF EXISTS ${ref}`, `CACHE TABLE ${ref}`, `CACHE TABLE ${ref}`]);
});

test("the reachability check before a refresh sends the agency's own request headers (ABS needs its SDMX JSON accept header)", async () => {
  const real = globalThis.fetch;
  const seen: Record<string, string>[] = [];
  globalThis.fetch = (async (_url: string, init: any) => { seen.push(init.headers); return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); }) as any;
  try {
    assert.equal(await sourceAnswers("https://data.api.abs.gov.au/rest/data/ABS,CPI/1.20001.10.50.M", "abs"), true);
    assert.equal(seen[0].accept, "application/vnd.sdmx.data+json");
  } finally {
    globalThis.fetch = real;
  }
});

test("a Zetaris cache that holds an agency's maintenance page is dropped and reloaded, not kept with a no-op CACHE", async () => {
  // Measured 27 Oct 11:45: CA Food failed through Zetaris all morning (IllegalArgumentException on the StatCan HTML
  // page) while StatCan answered curl with JSON; UNCACHE TABLE then SELECT read it live and succeeded.
  process.env.PSIG_ONBOARD_RETRY_MS = "0";
  resetCacheRegistry();
  const raw = rawTableRef(statcanFood, "food");
  let poisoned = true;
  const sqls: string[] = [];
  const z: SqlRunner = {
    async run(sql: string): Promise<SqlResult> {
      sqls.push(sql);
      if (sql === `UNCACHE TABLE IF EXISTS ${raw}`) poisoned = false;
      if (/^SELECT COUNT/.test(sql)) {
        if (poisoned) throw new Error("Zetaris HTTP 400: SparkException: Job aborted: java.lang.IllegalArgumentException: The value (<!--Last modified Dec 16, 2021 --> <!DOCTYPE html>");
        return { id: "x", sql, columns: ["n", "latest"], rows: [[14, "2026-09"]], ms: 1 };
      }
      return { id: "x", sql, columns: [], rows: [], ms: 1 };
    },
  };
  const r = await onboard(z, statcanFood, "food", new Date("2026-10-27"));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.cached, true);
  assert.equal(r.reloaded, true);
  const uncache = sqls.indexOf(`UNCACHE TABLE IF EXISTS ${raw}`);
  assert.ok(uncache > 0 && sqls.indexOf(`CACHE TABLE ${raw}`, uncache) > uncache, sqls.join("\n"));
});

test("a verification failure that is not a bad cached response leaves the cache alone", async () => {
  process.env.PSIG_ONBOARD_RETRY_MS = "0";
  resetCacheRegistry();
  const { z, sqls } = recorder((sql) => /^SELECT COUNT/.test(sql));
  const r = await onboard(z, statcanFood, "food", new Date("2026-10-27"));
  assert.equal(r.ok, false);
  assert.ok(!sqls.some((s) => /^UNCACHE/.test(s)), "an outage does not drop the only copy");
});

test("the company's price list cache is refreshed after its time-to-live like the agency tables, so edited prices show up", async () => {
  // Independent Impact review, 27 Oct 13:18: ensurePriceList cached without a reachability check, so it never refreshed.
  const { ensurePriceList } = await import("../src/sources/pricelist.ts");
  resetCacheRegistry();
  const { z, sqls } = recorder();
  const t0 = Date.parse("2026-10-27T00:00:00Z");
  const first = await ensurePriceList(z, { now: t0, reachable: async () => true });
  assert.equal(first.ok, true);
  sqls.length = 0;
  await ensurePriceList(z, { now: t0 + 7 * 3_600_000, reachable: async () => true });
  assert.deepEqual(sqls.filter((s) => /CACHE/.test(s)), [`UNCACHE TABLE IF EXISTS ${first.rawTable}`, `CACHE TABLE ${first.rawTable}`]);
  // When the price-list endpoint does not answer, the cached copy is kept.
  sqls.length = 0;
  await ensurePriceList(z, { now: t0 + 20 * 3_600_000, reachable: async () => false });
  assert.ok(!sqls.some((s) => /^UNCACHE/.test(s)));
});
