// Source registry: which agency serves which market, plus Zetaris onboarding.
import { createHash } from "node:crypto";
import * as eurostat from "./eurostat.ts";
import * as abs from "./abs.ts";
import * as statcan from "./statcan.ts";
import { Candidate, Concept, Country, DiscoverResult, EU_CODES, OnboardPlan, getJson, zetarisName } from "./types.ts";
import { SqlRunner, runDdl } from "../zetaris.ts";
import { hasFreshPeriod, isUsableObservationCount } from "./validation.ts";

export * from "./types.ts";
export * from "./validation.ts";

export const AGENCY_FOR: Record<Country, { agency: Candidate["agency"]; name: string; measure: string }> = {
  ...(Object.fromEntries(EU_CODES.map((c) => [c, { agency: "eurostat", name: "Eurostat (HICP)", measure: "HICP annual rate of change" }])) as Record<(typeof EU_CODES)[number], { agency: Candidate["agency"]; name: string; measure: string }>),
  CA: { agency: "statcan", name: "Statistics Canada (CPI)", measure: "CPI index, 2002=100" },
  AU: { agency: "abs", name: "Australian Bureau of Statistics (CPI)", measure: "CPI index" },
};

export async function discover(country: Country, concept: Concept, words?: string[]): Promise<DiscoverResult> {
  switch (AGENCY_FOR[country].agency) {
    case "eurostat":
      return eurostat.discover(country, concept, words);
    case "abs":
      return abs.discover(country, concept, words);
    case "statcan":
      return statcan.discover(country, concept);
  }
}

export function onboardPlan(c: Candidate, concept: Concept): OnboardPlan {
  if (c.agency === "eurostat") return eurostat.onboardSql(c, concept);
  if (c.agency === "abs") return abs.onboardSql(c, concept);
  return statcan.onboardSql(c, concept);
}

const DB_FOR: Record<Candidate["agency"], string> = { eurostat: eurostat.EUROSTAT_DB, abs: abs.ABS_DB, statcan: statcan.STATCAN_DB };

/** The raw Lightning REST table a series view reads; CACHE TABLE goes on this table, not on the view. */
export function rawTableRef(c: Candidate, concept: Concept): string {
  return `${DB_FOR[c.agency].toLowerCase()}.${onboardPlan(c, concept).table}`;
}

/**
 * Zetaris CACHE TABLE keeps a REST table's response, so later queries read the cache instead of calling the agency
 * (measured: 0 endpoint calls after caching; CACHE TABLE on a cached table is a no-op). The cache is refreshed with
 * UNCACHE + CACHE after PSIG_CACHE_TTL_HOURS (default 6), but only when the agency answers - the cached copy is
 * never dropped during an outage (a CACHE that fails right after UNCACHE is tried once more, then reported as failed).
 * Cache times are tracked per process.
 */
const cachedAt = new Map<string, number>();
export function resetCacheRegistry(): void {
  cachedAt.clear();
}
export function cacheTimes(): Map<string, number> {
  return new Map(cachedAt);
}
export type CacheAction = "cached" | "kept" | "kept-stale" | "refreshed" | "failed";
export async function ensureCached(z: SqlRunner, ref: string, opts: { now?: number; reachable?: () => Promise<boolean> } = {}): Promise<{ ok: boolean; action: CacheAction; cachedAt?: number; error?: string }> {
  const now = opts.now ?? Date.now();
  const at = cachedAt.get(ref);
  const ttl = Number(process.env.PSIG_CACHE_TTL_HOURS || 6) * 3_600_000;
  try {
    if (at !== undefined && now - at > ttl && opts.reachable) {
      if (!(await opts.reachable())) {
        await z.run(`CACHE TABLE ${ref}`); // a no-op that keeps (or restores) the cached copy
        return { ok: true, action: "kept-stale", cachedAt: at };
      }
      await z.run(`UNCACHE TABLE IF EXISTS ${ref}`);
      // Once uncached, a failed CACHE would leave no copy at all: try it once more before reporting the failure.
      await z.run(`CACHE TABLE ${ref}`).catch(() => z.run(`CACHE TABLE ${ref}`));
      cachedAt.set(ref, now);
      return { ok: true, action: "refreshed", cachedAt: now };
    }
    // Issued every time: after a Zetaris restart the cache is gone, and on a cached table this costs no agency call.
    await z.run(`CACHE TABLE ${ref}`);
    if (at === undefined) cachedAt.set(ref, now);
    return { ok: true, action: at === undefined ? "cached" : "kept", cachedAt: cachedAt.get(ref) };
  } catch (e) {
    return { ok: false, action: "failed", cachedAt: at, error: String(e).slice(0, 200) };
  }
}

/** Whether an agency endpoint answers with JSON right now (used before refreshing a cached copy), asked as its REST table asks. */
export async function sourceAnswers(url: string, agency?: string): Promise<boolean> {
  try {
    await getJson(url, agency === "abs" ? abs.REQUEST_HEADERS : {}, 500);
    return true;
  } catch {
    return false;
  }
}

const BOOTSTRAP = [
  `CREATE LIGHTNING DATABASE ${eurostat.EUROSTAT_DB} DESCRIBE BY "PriceSignal-Eurostat-HICP"`,
  `CREATE LIGHTNING DATABASE ${abs.ABS_DB} DESCRIBE BY "PriceSignal-ABS-CPI"`,
  `CREATE LIGHTNING DATABASE ${statcan.STATCAN_DB} DESCRIBE BY "PriceSignal-StatCan-CPI"`,
  `CREATE SCHEMASTORE CONTAINER psig`,
];

// Shared by parallel onboarding: agencies onboard concurrently and must not each resend the bootstrap DDL.
let bootstrapping: Promise<string[]> | undefined;
export async function bootstrap(z: SqlRunner): Promise<string[]> {
  if (bootstrapping) return bootstrapping.then(() => []);
  const run = (async () => {
    const log: string[] = [];
    for (const s of BOOTSTRAP) {
      const r = await runDdl(z, s);
      log.push(`${r.ok ? (r.existed ? "exists" : "created") : "FAILED"}: ${s.split(" ").slice(0, 4).join(" ")}${r.error ? ` (${r.error})` : ""}`);
    }
    // A failed bootstrap is tried again by the next onboarding.
    if (log.some((l) => l.startsWith("FAILED"))) bootstrapping = undefined;
    return log;
  })();
  bootstrapping = run;
  run.catch(() => { if (bootstrapping === run) bootstrapping = undefined; });
  return run;
}

export interface OnboardResult {
  view: string; table: string; ok: boolean; existed: boolean; rows: number; latest?: string; error?: string; sql: string[];
  /** The raw REST table is cached in Zetaris (CACHE TABLE), so verification and later queries read the cache. */
  cached?: boolean; rawTable?: string;
  /** The cache held an agency error page; it was dropped and the source read again. */
  reloaded?: boolean;
  /** Series REST table/view counts, excluding shared database/schema bootstrap objects. */
  createdObjects?: number; existingObjects?: number;
}

/** Register the series, then verify actual decoded observations and their release period. */
export async function onboard(z: SqlRunner, c: Candidate, concept: Concept, now = new Date()): Promise<OnboardResult> {
  await bootstrap(z);
  const plan = onboardPlan(c, concept);
  let existed = false;
  let createdObjects = 0, existingObjects = 0;
  for (const s of plan.statements) {
    const r = await runDdl(z, s);
    if (!r.ok) return { view: plan.view, table: plan.table, ok: false, existed, createdObjects, existingObjects, rows: 0, error: r.error, sql: plan.statements };
    existed = existed || r.existed;
    if (r.existed) existingObjects++;
    else createdObjects++;
  }
  const rawTable = rawTableRef(c, concept);
  let cached = false;
  let reloaded = false;
  let lastError = "";
  // One retry after a short pause: an agency read through Zetaris can fail for a single request (StatCan did on 27 Oct).
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((res) => setTimeout(res, Number(process.env.PSIG_ONBOARD_RETRY_MS ?? 1500)));
    cached = (await ensureCached(z, rawTable, { reachable: () => sourceAnswers(c.sourceUrl, c.agency) })).ok;
    try {
      const check = await z.run(`SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.${plan.view} WHERE yoy_pct IS NOT NULL`);
      const count = check.rows[0]?.[0];
      const observedPeriod = check.rows[0]?.[1];
      const hasRows = isUsableObservationCount(count);
      const fresh = hasFreshPeriod(observedPeriod, c.frequency, now);
      const latest = typeof observedPeriod === "string" ? observedPeriod : undefined;
      const error = !hasRows ? "view returned no rows or an invalid observation count" : !fresh ? `view has no fresh ${c.frequency} observation period (latest ${String(observedPeriod ?? "missing")})` : undefined;
      return { view: plan.view, table: plan.table, ok: hasRows && fresh, existed, createdObjects, existingObjects, rows: hasRows ? Number(count) : 0, latest, error, sql: plan.statements, cached, rawTable, ...(reloaded ? { reloaded } : {}) };
    } catch (e) {
      lastError = String(e).slice(0, 300);
      // A cache filled while the agency served a maintenance page keeps failing, and CACHE TABLE on it is a no-op:
      // drop it so the retry reads the agency again (on 27 Oct this kept CA Food out all morning).
      if (!attempt && BAD_CACHED_RESPONSE.test(String(e))) {
        try {
          await z.run(`UNCACHE TABLE IF EXISTS ${rawTable}`);
          cachedAt.delete(rawTable);
          reloaded = true;
        } catch { /* the retry still runs */ }
      }
    }
  }
  return { view: plan.view, table: plan.table, ok: false, existed, createdObjects, existingObjects, rows: 0, error: lastError, sql: plan.statements, cached, rawTable };
}

/** Zetaris errors that mean the stored agency response is not data (an HTML page), as opposed to an agency that is down. */
const BAD_CACHED_RESPONSE = /IllegalArgumentException: The value \(<|<!--|<!doctype html|<html|JsonParseException|Unexpected character \('<'/i;

export const COMPARE_COLUMNS = ["country", "concept", "category_label", "frequency", "period", "yoy_pct", "source_id"];

/**
 * Zetaris's semantic layer is built from schemastore views: one business-facing view, in the common schema, over the
 * agency views of a run. Its name depends only on the set of member views, so the same markets reuse the same view.
 */
export function marketSemanticView(views: string[]): { name: string; sql: string; members: string[] } {
  const members = [...new Set(views)].sort();
  const name = zetarisName("v", "market", "inflation", createHash("sha256").update(members.join(",")).digest("hex").slice(0, 8));
  const body = members.map((v) => `SELECT ${COMPARE_COLUMNS.join(", ")} FROM psig.${v} WHERE yoy_pct IS NOT NULL`).join("\nUNION ALL\n");
  return { name, sql: `CREATE OR REPLACE SCHEMASTORE VIEW ${name} WITH CONTAINER psig AS\n${body}`, members };
}

/** The federated comparison read through the semantic view. */
export function semanticCompareSql(view: string, sincePeriod: string): string {
  return `SELECT ${COMPARE_COLUMNS.join(", ")} FROM psig.${view} WHERE period >= '${sincePeriod}'\nORDER BY country, concept, period`;
}

/** One federated query across every onboarded market: the fragmented sources answered as one table. */
export function compareSql(views: string[], sincePeriod: string): string {
  return views
    .map((v) => `SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.${v} WHERE yoy_pct IS NOT NULL AND period >= '${sincePeriod}'`)
    .join("\nUNION ALL\n") + "\nORDER BY country, concept, period";
}
