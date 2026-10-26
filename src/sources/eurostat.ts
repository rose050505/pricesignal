// Eurostat HICP (JSON-stat 2.0). Real-world fragmentation handled here:
// the long-used dataset prc_hicp_manr was discontinued after 2025-12 and
// replaced by prc_hicp_minr (ECOICOP v2, dimension `coicop18`).
import { Candidate, Concept, Country, CONCEPT_WORDS, DiscoverResult, OnboardPlan, getJson, labelScore, monthsBack, zetarisName } from "./types.ts";

const BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const LEGACY = "prc_hicp_manr";
export const EUROSTAT_DB = "PSIG_EUROSTAT";

function lastLabel(j: any): string | undefined {
  const idx = j?.dimension?.time?.category?.index ?? {};
  const entries = Object.entries(idx) as [string, number][];
  if (!entries.length) return undefined;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

// Eurostat's own notice (dataset description, 2026): prc_hicp_manr "is discontinued and
// replaced by dataset prc_hicp_minr". The notice is not present in every response, so
// staleness of the dataset-wide latest period is checked as well.
const KNOWN_SUCCESSOR: Record<string, string> = { prc_hicp_manr: "prc_hicp_minr", prc_hicp_midx: "prc_hicp_minr", prc_hicp_mmor: "prc_hicp_minr" };

function monthsSince(period: string, now = new Date()): number {
  const m = period.match(/^(\d{4})-(\d{2})/);
  if (!m) return 0;
  return now.getUTCFullYear() * 12 + now.getUTCMonth() - (Number(m[1]) * 12 + Number(m[2]) - 1);
}

export function parseReplacement(j: any, dataset = LEGACY): { discontinued: boolean; replacedBy?: string; reason?: string } {
  const desc: string = j?.extension?.description ?? "";
  const label: string = j?.label ?? "";
  const ann: any[] = j?.extension?.annotation ?? [];
  const latest: string = ann.find((a) => a.type === "OBS_PERIOD_OVERALL_LATEST")?.title ?? lastLabel(j) ?? "";
  const m = desc.match(/replaced by(?: dataset)?[\s\S]{0,300}?(prc_[a-z0-9_]+)/i);
  const stale = latest ? monthsSince(latest) : 0;
  const closedRange = label.match(/\((\d{4})-(\d{4})\)\s*$/);
  const reasons: string[] = [];
  if (/discontinued/i.test(desc)) reasons.push("Eurostat marks it discontinued");
  if (closedRange) reasons.push(`its title ends at ${closedRange[2]}`);
  if (stale > 5) reasons.push(`no data after ${latest} (${stale} months ago)`);
  return { discontinued: reasons.length > 0, replacedBy: m?.[1] ?? KNOWN_SUCCESSOR[dataset], reason: reasons.join("; ") };
}

export function categoryCandidates(j: any, dimId: string, words: string[]): { code: string; label: string; score: number }[] {
  const labels: Record<string, string> = j?.dimension?.[dimId]?.category?.label ?? {};
  return Object.entries(labels)
    .map(([code, label]) => ({ code, label, score: labelScore(label, words) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.code.length - b.code.length)
    .slice(0, 5);
}

export async function discover(country: Country, concept: Concept, words = CONCEPT_WORDS[concept] ?? [concept]): Promise<DiscoverResult> {
  const notes: string[] = [];
  const candidates: Candidate[] = [];
  // 1) Probe the dataset most guides still point to.
  let dataset = LEGACY;
  try {
    const legacy = await getJson(`${BASE}/${LEGACY}?format=JSON&geo=${country}&coicop=CP00&lastTimePeriod=1&lang=EN`);
    const rep = parseReplacement(legacy);
    const last = lastLabel(legacy);
    if (rep.discontinued) {
      notes.push(`Eurostat ${LEGACY} looks discontinued (${rep.reason}; last period ${last ?? "?"})${rep.replacedBy ? `; switched to its successor ${rep.replacedBy}` : ""}.`);
      dataset = rep.replacedBy ?? "prc_hicp_minr";
    }
  } catch (e) {
    notes.push(`Probe of ${LEGACY} failed (${String(e).slice(0, 80)}); trying prc_hicp_minr.`);
    dataset = "prc_hicp_minr";
  }
  // 2) Read the live dataset's category labels and latest period.
  const dimId = dataset === LEGACY ? "coicop" : "coicop18";
  const meta = await getJson(`${BASE}/${dataset}?format=JSON&geo=${country}&unit=RCH_A&lastTimePeriod=1&lang=EN`);
  const last = lastLabel(meta);
  const exact = concept === "all_items" ? ["TOTAL", "CP00"] : concept === "food" ? ["CP01"] : [];
  const labels: Record<string, string> = meta?.dimension?.[dimId]?.category?.label ?? {};
  const picks = exact.filter((c) => labels[c]).map((code) => ({ code, label: labels[code], score: 999 }));
  for (const c of picks.length ? picks : categoryCandidates(meta, dimId, words)) {
    candidates.push({
      agency: "eurostat",
      country,
      dataset,
      code: c.code,
      label: c.label,
      frequency: "M",
      measure: "yoy_pct",
      lastPeriod: last,
      status: "active",
      sourceUrl: `${BASE}/${dataset}?format=JSON&geo=${country}&${dimId}=${c.code}&unit=RCH_A&sinceTimePeriod=${monthsBack(26)}&lang=EN`,
    });
  }
  if (!candidates.length) notes.push(`No ${dataset} category matched "${words.join(", ")}".`);
  return { country, concept, candidates, notes };
}

export function onboardSql(c: Candidate, concept: Concept): OnboardPlan {
  const table = zetarisName("eurostat", c.country, c.dataset, c.code);
  const view = zetarisName("v", c.country, concept, c.dataset, c.code);
  const label = c.label.replace(/'/g, "''");
  return {
    table,
    view,
    statements: [
      `CREATE LIGHTNING REST TABLE ${table} FROM ${EUROSTAT_DB} REQUEST(
    endpoint "${c.sourceUrl}",
    method "get",
    response_type "json",
    http_encoding "URLENCODED"
) HEADER (
) BODY ()`,
      `CREATE SCHEMASTORE VIEW ${view} WITH CONTAINER psig AS
SELECT '${c.country}' AS country, '${concept}' AS concept, '${c.code}' AS category_code, '${label}' AS category_label,
       'M' AS frequency, time_label AS period, CAST(v AS DOUBLE) AS yoy_pct,
       'eurostat:${c.dataset}:${c.code}:RCH_A' AS source_id
FROM ${EUROSTAT_DB.toLowerCase()}.${table}
LATERAL VIEW explode(from_json(to_json(value), 'map<string,double>')) AS k, v
LATERAL VIEW explode(from_json(to_json(dimension.time.category.index), 'map<string,bigint>')) AS time_label, idx
WHERE CAST(k AS INT) = idx`,
    ],
  };
}
