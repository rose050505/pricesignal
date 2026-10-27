// Zetaris CACHE TABLE on the raw Lightning REST tables: later queries read the cached response instead of calling
// the agency again (measured live: 0 endpoint calls after caching), and a market survives an agency outage.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { ensureCached, onboard, rawTableRef, resetCacheRegistry, type Candidate } from "../src/sources/index.ts";
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
