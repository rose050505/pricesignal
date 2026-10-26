// Source registry: which agency serves which market, plus Zetaris onboarding.
import * as eurostat from "./eurostat.ts";
import * as abs from "./abs.ts";
import * as statcan from "./statcan.ts";
import { Candidate, Concept, Country, DiscoverResult, EU_CODES, OnboardPlan } from "./types.ts";
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

const BOOTSTRAP = [
  `CREATE LIGHTNING DATABASE ${eurostat.EUROSTAT_DB} DESCRIBE BY "PriceSignal-Eurostat-HICP"`,
  `CREATE LIGHTNING DATABASE ${abs.ABS_DB} DESCRIBE BY "PriceSignal-ABS-CPI"`,
  `CREATE LIGHTNING DATABASE ${statcan.STATCAN_DB} DESCRIBE BY "PriceSignal-StatCan-CPI"`,
  `CREATE SCHEMASTORE CONTAINER psig`,
];

let bootstrapped = false;
export async function bootstrap(z: SqlRunner): Promise<string[]> {
  if (bootstrapped) return [];
  const log: string[] = [];
  for (const s of BOOTSTRAP) {
    const r = await runDdl(z, s);
    log.push(`${r.ok ? (r.existed ? "exists" : "created") : "FAILED"}: ${s.split(" ").slice(0, 4).join(" ")}${r.error ? ` (${r.error})` : ""}`);
  }
  bootstrapped = !log.some((l) => l.startsWith("FAILED"));
  return log;
}

export interface OnboardResult {
  view: string; table: string; ok: boolean; existed: boolean; rows: number; latest?: string; error?: string; sql: string[];
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
  try {
    const check = await z.run(`SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.${plan.view} WHERE yoy_pct IS NOT NULL`);
    const count = check.rows[0]?.[0];
    const observedPeriod = check.rows[0]?.[1];
    const hasRows = isUsableObservationCount(count);
    const fresh = hasFreshPeriod(observedPeriod, c.frequency, now);
    const latest = typeof observedPeriod === "string" ? observedPeriod : undefined;
    const error = !hasRows ? "view returned no rows or an invalid observation count" : !fresh ? `view has no fresh ${c.frequency} observation period (latest ${String(observedPeriod ?? "missing")})` : undefined;
    return { view: plan.view, table: plan.table, ok: hasRows && fresh, existed, createdObjects, existingObjects, rows: hasRows ? Number(count) : 0, latest, error, sql: plan.statements };
  } catch (e) {
    return { view: plan.view, table: plan.table, ok: false, existed, createdObjects, existingObjects, rows: 0, error: String(e).slice(0, 300), sql: plan.statements };
  }
}

export const COMPARE_COLUMNS = ["country", "concept", "category_label", "frequency", "period", "yoy_pct", "source_id"];

/** One federated query across every onboarded market: the fragmented sources answered as one table. */
export function compareSql(views: string[], sincePeriod: string): string {
  return views
    .map((v) => `SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.${v} WHERE yoy_pct IS NOT NULL AND period >= '${sincePeriod}'`)
    .join("\nUNION ALL\n") + "\nORDER BY country, concept, period";
}
