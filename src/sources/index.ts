// Source registry: which agency serves which market, plus Zetaris onboarding.
import * as eurostat from "./eurostat.ts";
import * as abs from "./abs.ts";
import * as statcan from "./statcan.ts";
import { Candidate, Concept, Country, DiscoverResult, OnboardPlan } from "./types.ts";
import { SqlRunner, runDdl } from "../zetaris.ts";

export * from "./types.ts";

export const AGENCY_FOR: Record<Country, { agency: Candidate["agency"]; name: string; measure: string }> = {
  DE: { agency: "eurostat", name: "Eurostat (HICP)", measure: "HICP annual rate of change" },
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

export interface OnboardResult { view: string; table: string; ok: boolean; existed: boolean; rows: number; latest?: string; error?: string; sql: string[] }

/** Register the series as a Zetaris REST table + decoding view, then prove it returns rows. */
export async function onboard(z: SqlRunner, c: Candidate, concept: Concept): Promise<OnboardResult> {
  await bootstrap(z);
  const plan = onboardPlan(c, concept);
  let existed = false;
  for (const s of plan.statements) {
    const r = await runDdl(z, s);
    if (!r.ok) return { view: plan.view, table: plan.table, ok: false, existed, rows: 0, error: r.error, sql: plan.statements };
    existed = existed || r.existed;
  }
  try {
    const check = await z.run(`SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.${plan.view} WHERE yoy_pct IS NOT NULL`);
    const n = Number(check.rows[0]?.[0] ?? 0);
    const latest = check.rows[0]?.[1] as string | undefined;
    return { view: plan.view, table: plan.table, ok: n > 0, existed, rows: n, latest, error: n > 0 ? undefined : "view returned no rows", sql: plan.statements };
  } catch (e) {
    return { view: plan.view, table: plan.table, ok: false, existed, rows: 0, error: String(e).slice(0, 300), sql: plan.statements };
  }
}

export const COMPARE_COLUMNS = ["country", "concept", "category_label", "frequency", "period", "yoy_pct", "source_id"];

/** One federated query across every onboarded market: the fragmented sources answered as one table. */
export function compareSql(views: string[], sincePeriod: string): string {
  return views
    .map((v) => `SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.${v} WHERE yoy_pct IS NOT NULL AND period >= '${sincePeriod}'`)
    .join("\nUNION ALL\n") + "\nORDER BY country, concept, period";
}
