// Australian Bureau of Statistics CPI (SDMX-JSON). Fragmentation handled here:
// index numbers rather than rates, a new monthly series alongside the
// quarterly one, and finer categories (e.g. "Snacks and confectionery").
import { Candidate, Concept, Country, CONCEPT_WORDS, DiscoverResult, OnboardPlan, getJson, isBroadFoodLabel, labelScore, monthsBack, zetarisName } from "./types.ts";

const BASE = "https://data.api.abs.gov.au/rest";
export const ABS_DB = "PSIG_ABS";
const DATA_ACCEPT = "application/vnd.sdmx.data+json";

function quartersBackLabel(n: number): string {
  const d = new Date();
  const q = Math.floor(d.getUTCMonth() / 3) + 1 - n;
  const y = d.getUTCFullYear() + Math.floor((q - 1) / 4);
  const qq = ((((q - 1) % 4) + 4) % 4) + 1;
  return `${y}-Q${qq}`;
}

export async function lastPeriod(code: string, freq: "M" | "Q"): Promise<string | undefined> {
  const start = freq === "M" ? monthsBack(8) : quartersBackLabel(4);
  try {
    const j = await getJson(`${BASE}/data/ABS,CPI/1.${code}.10.50.${freq}?startPeriod=${start}&detail=dataonly`, { accept: DATA_ACCEPT });
    const vals: { id: string }[] = j?.data?.structures?.[0]?.dimensions?.observation?.[0]?.values ?? [];
    return vals.map((v) => v.id).sort().at(-1);
  } catch {
    return undefined; // ABS answers 404 / NoRecordsFound for series that do not exist
  }
}

export async function discover(country: Country, concept: Concept, words = CONCEPT_WORDS[concept] ?? [concept]): Promise<DiscoverResult> {
  const notes: string[] = [];
  const cl = await getJson(`${BASE}/codelist/ABS/CL_CPI_INDEX`, { accept: "application/vnd.sdmx.structure+json" });
  const codes: { id: string; name: string }[] = cl?.data?.codelists?.[0]?.codes ?? [];
  const exact = concept === "all_items" ? "10001" : concept === "food" ? "20001" : undefined;
  let ranked: { id: string; name: string }[] = exact
    ? codes.filter((c) => c.id === exact)
    : codes
        .map((c) => ({ ...c, score: labelScore(c.name, words) }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
  const broadFood = concept === "snacks" || concept === "condiments"
    ? codes.find((c) => c.id === "20001" && isBroadFoodLabel(c.name))
    : undefined;
  if (broadFood) ranked = [...ranked.filter((c) => c.id !== broadFood.id), broadFood];
  const candidates: Candidate[] = [];
  for (const c of ranked) {
    const m = await lastPeriod(c.id, "M");
    const q = m ? undefined : await lastPeriod(c.id, "Q");
    const freq: "M" | "Q" = m ? "M" : "Q";
    if (!m && !q) {
      notes.push(`ABS index ${c.id} (${c.name}) has no recent monthly or quarterly data.`);
      continue;
    }
    if (!m) notes.push(`ABS ${c.name} is only published quarterly (latest ${q}).`);
    const start = freq === "M" ? monthsBack(26) : quartersBackLabel(9);
    candidates.push({
      agency: "abs",
      country,
      dataset: "ABS,CPI",
      code: c.id,
      label: c.name,
      frequency: freq,
      measure: "index",
      lastPeriod: m ?? q,
      status: "active",
      ...(broadFood && c.id === broadFood.id ? { isBroadFallback: true } : {}),
      sourceUrl: `${BASE}/data/ABS,CPI/1.${c.id}.10.50.${freq}?startPeriod=${start}&detail=dataonly`,
    });
  }
  if (!candidates.length) notes.push(`No ABS CPI index matched "${words.join(", ")}".`);
  return { country, concept, candidates, notes };
}

export function onboardSql(c: Candidate, concept: Concept): OnboardPlan {
  const table = zetarisName("abs", c.country, "cpi", c.code, c.frequency);
  const view = zetarisName("v", c.country, concept, c.code, c.frequency, "yoyv2");
  const label = c.label.replace(/'/g, "''");
  return {
    table,
    view,
    statements: [
      `CREATE LIGHTNING REST TABLE ${table} FROM ${ABS_DB} REQUEST(
    endpoint "${c.sourceUrl}",
    method "get",
    response_type "json",
    http_encoding "URLENCODED"
) HEADER (
    accept "${DATA_ACCEPT}"
) BODY ()`,
      `CREATE SCHEMASTORE VIEW ${view} WITH CONTAINER psig AS
SELECT '${c.country}' AS country, '${concept}' AS concept, '${c.code}' AS category_code, '${label}' AS category_label,
       '${c.frequency}' AS frequency, period,
       CASE WHEN CAST(SUBSTR(period, 1, 4) AS INT) - CAST(SUBSTR(previous_period, 1, 4) AS INT) = 1
                  AND previous_idx > 0
            THEN ROUND(100.0 * (idx / previous_idx - 1), 2) END AS yoy_pct,
       'abs:CPI:1.${c.code}.10.50.${c.frequency}' AS source_id
FROM (
  SELECT period, idx,
         LAG(idx, 1) OVER (PARTITION BY SUBSTR(period, 6) ORDER BY period) AS previous_idx,
         LAG(period, 1) OVER (PARTITION BY SUBSTR(period, 6) ORDER BY period) AS previous_period
  FROM (
  SELECT period_label.id AS period, CAST(obs_value[0] AS DOUBLE) AS idx
  FROM ${ABS_DB.toLowerCase()}.${table}
  LATERAL VIEW posexplode(data.structures[0].dimensions.observation[0].values) AS obs_position, period_label
  LATERAL VIEW explode(from_json(to_json(data.dataSets[0].series.\`0:0:0:0:0\`.observations), 'map<string,array<double>>')) AS obs_key, obs_value
  WHERE CAST(obs_key AS INT) = obs_position
  ) decoded
) s`,
    ],
  };
}
