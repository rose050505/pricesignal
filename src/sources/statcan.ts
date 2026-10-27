// Statistics Canada CPI (WDS). Fragmentation handled here: the data methods
// Zetaris's recipes tried are POST-only, so we use the GET method
// getDataFromVectorByReferencePeriodRange; vectors are index numbers (2002=100)
// and this adapter maps Canada to the Food and All-items vectors only.
import { Candidate, Concept, Country, DiscoverResult, OnboardPlan, getJson, humanError, monthsBack, zetarisName } from "./types.ts";

const BASE = "https://www150.statcan.gc.ca/t1/wds/rest";
export const STATCAN_DB = "PSIG_STATCAN";

// Table 18-10-0004-01, Consumer Price Index, monthly, not seasonally adjusted (Canada).
// Vector ids verified against the live WDS response (productId 18100004, coordinates 2.2 / 2.3).
export const CATALOG: Record<string, { vector: string; label: string; coordinate: string }> = {
  all_items: { vector: "41690973", label: "All-items", coordinate: "2.2.0.0.0.0.0.0.0.0" },
  food: { vector: "41690974", label: "Food", coordinate: "2.3.0.0.0.0.0.0.0.0" },
};

export function rangeUrl(vector: string, startYm: string, endYm: string): string {
  return `${BASE}/getDataFromVectorByReferencePeriodRange?vectorIds=%22${vector}%22&startRefPeriod=${startYm}-01&endReferencePeriod=${endYm}-01`;
}

export async function discover(country: Country, concept: Concept): Promise<DiscoverResult> {
  const notes: string[] = [];
  let key = concept in CATALOG ? concept : undefined;
  if (!key && /snack|confection|condiment|sauce|grocer|food|gochujang|noodle|ramen|kimchi/i.test(concept)) {
    key = "food";
    notes.push(`For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "${concept}" is compared at the Food level (coarser than the other markets).`);
  }
  if (!key) return { country, concept, candidates: [], notes: [`No StatCan CPI vector mapped for "${concept}".`] };
  const entry = CATALOG[key];
  const now = monthsBack(0);
  let j: any;
  try {
    j = await getJson(rangeUrl(entry.vector, monthsBack(8), now));
  } catch (e) {
    // The vector is catalogued, so it is still offered: a copy already registered and cached in Zetaris can pass
    // the same row and freshness verification; without one, onboarding fails as before.
    notes.push(`StatCan's API did not answer during discovery (${humanError(e)}); the catalogued ${entry.label} vector is checked against its registered Zetaris copy instead.`);
  }
  const obj = Array.isArray(j) ? j[0]?.object : j?.object;
  const pts: { refPer: string }[] = obj?.vectorDataPoint ?? [];
  const last = pts.map((p) => p.refPer.slice(0, 7)).sort().at(-1);
  if (obj?.coordinate && obj.coordinate !== entry.coordinate) notes.push(`StatCan vector ${entry.vector} coordinate is ${obj.coordinate}, expected ${entry.coordinate}.`);
  const candidates: Candidate[] = [
    {
      agency: "statcan",
      country,
      dataset: "18100004",
      code: `v${entry.vector}`,
      label: entry.label,
      frequency: "M",
      measure: "index",
      lastPeriod: last,
      status: last ? "active" : "unknown",
      ...(key === "food" && concept !== "food" ? { isBroadFallback: true } : {}),
      // Open-ended range: a view onboarded today keeps picking up new releases next quarter.
      sourceUrl: rangeUrl(entry.vector, monthsBack(26), "2035-12"),
    },
  ];
  return { country, concept, candidates, notes };
}

export function onboardSql(c: Candidate, concept: Concept): OnboardPlan {
  const table = zetarisName("statcan", c.country, c.code, "live");
  const view = zetarisName("v", c.country, concept, c.code, "live", "yoyv2");
  const label = c.label.replace(/'/g, "''");
  return {
    table,
    view,
    statements: [
      `CREATE LIGHTNING REST TABLE ${table} FROM ${STATCAN_DB} REQUEST(
    endpoint "${c.sourceUrl}",
    method "get",
    response_type "json",
    http_encoding "URLENCODED"
) HEADER (
) BODY ()`,
      `CREATE SCHEMASTORE VIEW ${view} WITH CONTAINER psig AS
SELECT '${c.country}' AS country, '${concept}' AS concept, '${c.code}' AS category_code, '${label}' AS category_label,
       'M' AS frequency, period,
       CASE WHEN CAST(SUBSTR(period, 1, 4) AS INT) - CAST(SUBSTR(previous_period, 1, 4) AS INT) = 1
                  AND previous_idx > 0
            THEN ROUND(100.0 * (idx / previous_idx - 1), 2) END AS yoy_pct,
       'statcan:18100004:${c.code}' AS source_id
FROM (
  SELECT period, idx,
         LAG(idx, 1) OVER (PARTITION BY SUBSTR(period, 6) ORDER BY period) AS previous_idx,
         LAG(period, 1) OVER (PARTITION BY SUBSTR(period, 6) ORDER BY period) AS previous_period
  FROM (
  SELECT SUBSTR(dp.refPer, 1, 7) AS period, CAST(dp.value AS DOUBLE) AS idx
  FROM ${STATCAN_DB.toLowerCase()}.${table}
  LATERAL VIEW explode(object.vectorDataPoint) AS dp
  ) decoded
) s`,
    ],
  };
}
