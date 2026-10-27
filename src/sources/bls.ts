// U.S. Bureau of Labor Statistics CPI (public API v1, no key). Fragmentation handled here: BLS publishes index
// levels (1982-84=100) as "year" + "M01".."M12" pairs nested under Results.series[].data[], with an annual "M13"
// in some series; the keyless API answers 25 requests per day per address and returns the last three years.
// So discovery reads a vetted series list (no API call), and Zetaris caches each series after registering it.
import { Candidate, Concept, Country, DiscoverResult, OnboardPlan, zetarisName } from "./types.ts";

const BASE = "https://api.bls.gov/publicAPI/v1/timeseries/data";
export const BLS_DB = "PSIG_BLS";

// CPI for All Urban Consumers (CPI-U), U.S. city average, not seasonally adjusted. BLS "Food" includes food away
// from home (restaurant meals), like StatCan's Food and ABS's Food and non-alcoholic beverages.
export const CATALOG: Record<string, { series: string; label: string }> = {
  all_items: { series: "CUUR0000SA0", label: "All items" },
  food: { series: "CUUR0000SAF1", label: "Food" },
};

export const seriesUrl = (series: string) => `${BASE}/${series}`;

export async function discover(country: Country, concept: Concept): Promise<DiscoverResult> {
  const notes: string[] = [];
  let key = concept in CATALOG ? concept : undefined;
  if (!key && /snack|confection|condiment|sauce|grocer|food|gochujang|noodle|ramen|kimchi/i.test(concept)) {
    key = "food";
    notes.push(`For the US this agent maps only the BLS CPI-U "Food" and "All items" series, so "${concept}" is compared at the Food level (coarser than the other markets).`);
  }
  if (!key) return { country, concept, candidates: [], notes: [`No BLS CPI series mapped for "${concept}".`] };
  const entry = CATALOG[key];
  const candidates: Candidate[] = [
    {
      agency: "bls",
      country,
      dataset: "CU",
      code: entry.series,
      label: entry.label,
      frequency: "M",
      measure: "index",
      // Not asked here: the keyless API allows 25 requests a day, so the registered copy is verified instead.
      status: "unknown",
      ...(key === "food" && concept !== "food" ? { isBroadFallback: true } : {}),
      sourceUrl: seriesUrl(entry.series),
    },
  ];
  return { country, concept, candidates, notes };
}

export function onboardSql(c: Candidate, concept: Concept): OnboardPlan {
  const table = zetarisName("bls", c.country, c.code);
  const view = zetarisName("v", c.country, concept, c.code, "yoyv2");
  const label = c.label.replace(/'/g, "''");
  return {
    table,
    view,
    statements: [
      `CREATE LIGHTNING REST TABLE ${table} FROM ${BLS_DB} REQUEST(
    endpoint "${c.sourceUrl}",
    method "get",
    response_type "json",
    http_encoding "URLENCODED"
) HEADER (
) BODY ()`,
      // YoY only against the same month one year earlier with a positive index, as for StatCan and ABS.
      `CREATE SCHEMASTORE VIEW ${view} WITH CONTAINER psig AS
SELECT '${c.country}' AS country, '${concept}' AS concept, '${c.code}' AS category_code, '${label}' AS category_label,
       'M' AS frequency, period,
       CASE WHEN CAST(SUBSTR(period, 1, 4) AS INT) - CAST(SUBSTR(previous_period, 1, 4) AS INT) = 1
                  AND previous_idx > 0
            THEN ROUND(100.0 * (idx / previous_idx - 1), 2) END AS yoy_pct,
       'bls:CU:${c.code}' AS source_id
FROM (
  SELECT period, idx,
         LAG(idx, 1) OVER (PARTITION BY SUBSTR(period, 6) ORDER BY period) AS previous_idx,
         LAG(period, 1) OVER (PARTITION BY SUBSTR(period, 6) ORDER BY period) AS previous_period
  FROM (
  SELECT CONCAT(d.year, '-', SUBSTR(d.period, 2, 2)) AS period, CAST(d.value AS DOUBLE) AS idx
  FROM ${BLS_DB.toLowerCase()}.${table}
  LATERAL VIEW explode(Results.series) AS s
  LATERAL VIEW explode(s.data) AS d
  WHERE d.period LIKE 'M%' AND d.period <> 'M13'
  ) decoded
) b`,
    ],
  };
}
