// Does Zetaris CACHE TABLE stop a Lightning REST table from calling its source again, and how does caching change
// the agent's two federated queries? No model calls and no secrets; it needs Zetaris (from .env) and, for part 2,
// the agency APIs.
//
//   npx tsx scripts/17_cache_check.mts                    part 1: count source calls with a local test endpoint
//   PSIG_ZETARIS_NS=<suffix> npx tsx scripts/17_cache_check.mts timing
//                                                          part 2: time the comparison and price-list join over the
//                                                          DE/CA/AU tables registered with that suffix, uncached vs cached
//
// Part 1 serves a small JSON document on the Docker bridge address (PSIG_CACHE_CHECK_HOST, default 172.17.0.1) so the
// Zetaris container can reach it, registers a REST table on it and counts the requests per statement. Zetaris does not
// support DROP TABLE for these tables, so each run leaves one small test table named zz_cachecheck_<time>.
import http from "node:http";
import { loadEnv } from "../src/env.ts";
import { ZetarisClient } from "../src/zetaris.ts";
import { compareSql, monthsBack } from "../src/sources/index.ts";
import { skuRatesSql } from "../src/sources/pricelist.ts";

loadEnv();
const z = new ZetarisClient();

async function countCalls(): Promise<boolean> {
  const host = process.env.PSIG_CACHE_CHECK_HOST || "172.17.0.1";
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([{ k: 1, v: "a" }, { k: 2, v: "b" }, { k: 3, v: "c" }]));
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const port = (server.address() as { port: number }).port;
  const table = `psig_internal.zz_cachecheck_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  const rows: { step: string; calls: number; expect?: number; ms: number }[] = [];
  const step = async (name: string, sql: string, expect?: number) => {
    const before = hits;
    const t0 = Date.now();
    try {
      await z.run(sql);
    } catch (e) {
      console.log(`${name}: error ${String(e).slice(0, 160)}`);
    }
    rows.push({ step: name, calls: hits - before, expect, ms: Date.now() - t0 });
  };
  await step("CREATE LIGHTNING REST TABLE", `CREATE LIGHTNING REST TABLE ${table.split(".")[1]} FROM PSIG_INTERNAL REQUEST(
    endpoint "http://${host}:${port}/data",
    method "get",
    response_type "json",
    http_encoding "URLENCODED"
) HEADER (
) BODY ()`);
  await step("SELECT, not cached", `SELECT COUNT(*) FROM ${table}`, 1);
  await step("SELECT, not cached (again)", `SELECT COUNT(*) FROM ${table}`, 1);
  await step("CACHE TABLE", `CACHE TABLE ${table}`, 1);
  await step("SELECT, cached", `SELECT COUNT(*) FROM ${table}`, 0);
  await step("SELECT, cached (other columns)", `SELECT k, v FROM ${table}`, 0);
  await step("CACHE TABLE again", `CACHE TABLE ${table}`, 0);
  await step("REFRESH TABLE", `REFRESH TABLE ${table}`);
  await step("SELECT after REFRESH", `SELECT COUNT(*) FROM ${table}`);
  await step("UNCACHE TABLE", `UNCACHE TABLE IF EXISTS ${table}`);
  await step("SELECT, uncached", `SELECT COUNT(*) FROM ${table}`, 1);
  await step("CACHE TABLE (refresh path)", `CACHE TABLE ${table}`, 1);
  await step("SELECT, cached", `SELECT COUNT(*) FROM ${table}`, 0);
  server.close();
  console.log(`Part 1 - source calls per statement (test endpoint behind ${table}):`);
  for (const r of rows) console.log(`  ${r.step.padEnd(32)} ${String(r.calls).padStart(2)} call(s)  ${String(r.ms).padStart(5)} ms${r.expect !== undefined && r.calls !== r.expect ? `  UNEXPECTED (expected ${r.expect})` : ""}`);
  const ok = rows.every((r) => r.expect === undefined || r.calls === r.expect);
  console.log(ok ? "PASS: a cached table answers without calling its source; UNCACHE then CACHE reloads it." : "FAIL: see UNEXPECTED rows.");
  return ok;
}

async function timing(): Promise<boolean> {
  const ns = process.env.PSIG_ZETARIS_NS;
  if (!ns) throw new Error("set PSIG_ZETARIS_NS to the suffix of a run that registered DE, CA and AU (for example a recorded example's namespace)");
  const raws = [`psig_eurostat.eurostat_de_prc_hicp_minr_cp01_${ns}`, `psig_eurostat.eurostat_de_prc_hicp_minr_total_${ns}`, `psig_statcan.statcan_ca_v41690974_live_${ns}`, `psig_statcan.statcan_ca_v41690973_live_${ns}`, `psig_abs.abs_au_cpi_20001_m_${ns}`, `psig_abs.abs_au_cpi_10001_m_${ns}`, `psig_internal.internal_price_list_${ns}`];
  const views = [`v_de_food_prc_hicp_minr_cp01_${ns}`, `v_de_all_items_prc_hicp_minr_total_${ns}`, `v_ca_food_v41690974_live_yoyv2_${ns}`, `v_ca_all_items_v41690973_live_yoyv2_${ns}`, `v_au_food_20001_m_yoyv2_${ns}`, `v_au_all_items_10001_m_yoyv2_${ns}`];
  const time = async (sql: string, limit?: number) => {
    const t0 = Date.now();
    try {
      const r = await z.run(sql, limit ? { limit } : {});
      return { ms: Date.now() - t0, rows: r.rows.length };
    } catch (e) {
      console.log(`  error: ${String(e).slice(0, 160)}`);
      return { ms: NaN, rows: 0 };
    }
  };
  const compare = compareSql(views, monthsBack(15));
  const price = skuRatesSql(views.filter((v) => v.includes("_food_")), ["DE", "CA", "AU"], monthsBack(15));
  for (const r of raws) await time(`UNCACHE TABLE IF EXISTS ${r}`);
  const runs = async () => [await time(compare), await time(compare), await time(price, 20_000), await time(price, 20_000)];
  const before = await runs();
  for (const r of raws) await time(`CACHE TABLE ${r}`);
  const after = await runs();
  const fmt = (x: { ms: number; rows: number }[]) => `comparison ${x[0].ms} / ${x[1].ms} ms (${x[0].rows} rows), price-list join ${x[2].ms} / ${x[3].ms} ms (${x[2].rows} rows)`;
  console.log(`Part 2 - federated queries over the DE/CA/AU tables with suffix ${ns} (two runs each):`);
  console.log(`  uncached: ${fmt(before)}`);
  console.log(`  cached:   ${fmt(after)}`);
  return before.concat(after).every((x) => Number.isFinite(x.ms) && x.rows > 0);
}

const ok = process.argv[2] === "timing" ? await timing() : await countCalls();
process.exit(ok ? 0 : 1);
