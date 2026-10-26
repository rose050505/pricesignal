// Shared shapes for the three statistics agencies. Each adapter answers two
// questions the agent cannot answer from memory alone: "which series matches
// this concept here, and is it still alive?" (discover) and "how do I make it a
// governed Zetaris table?" (onboardSql).

export type Country = "DE" | "CA" | "AU";
export type Concept = "all_items" | "food" | string;

export interface Candidate {
  agency: "eurostat" | "statcan" | "abs";
  country: Country;
  dataset: string; // agency dataset / product id
  code: string; // category code (COICOP, ABS index, StatCan vector)
  label: string; // human-readable category label from the agency
  frequency: "M" | "Q";
  measure: "yoy_pct" | "index"; // what the raw series holds
  lastPeriod?: string;
  status: "active" | "discontinued" | "unknown";
  note?: string; // e.g. "replaced by prc_hicp_minr"
  sourceUrl: string; // the GET endpoint Zetaris will read
}

export interface DiscoverResult {
  country: Country;
  concept: Concept;
  candidates: Candidate[];
  notes: string[]; // fragmentation findings worth reporting (discontinuation, granularity, frequency)
}

export interface OnboardPlan {
  table: string; // lightning REST table name (in the agency database)
  view: string; // schemastore view name (in container psig)
  statements: string[]; // executed in order, one statement each
}

export const COUNTRY_ALIASES: Record<string, Country> = {
  de: "DE", ger: "DE", germany: "DE", deutschland: "DE", "독일": "DE",
  ca: "CA", canada: "CA", canadian: "CA", "캐나다": "CA",
  au: "AU", aus: "AU", australia: "AU", oz: "AU", "호주": "AU",
};

export function normalizeCountry(raw: string): Country | null {
  const k = raw.trim().toLowerCase();
  if (COUNTRY_ALIASES[k]) return COUNTRY_ALIASES[k];
  // Tolerate one typo in names of 5+ letters ("canda", "austrlia", "germny").
  if (k.length >= 4) {
    for (const [alias, c] of Object.entries(COUNTRY_ALIASES)) if (alias.length >= 5 && editDistance(k, alias) <= 1) return c;
  }
  return null;
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function safeIdent(...parts: string[]): string {
  return parts.join("_").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

export function monthsBack(n: number, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const USER_AGENT = () => process.env.PSIG_HTTP_USER_AGENT || "PriceSignal/0.1 (Open Agent Hackathon 2026)";

export async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  let r: Response;
  try {
    r = await fetch(url, { headers: { "User-Agent": USER_AGENT(), ...headers }, signal: AbortSignal.timeout(60_000) });
  } catch (e: any) {
    const c = e?.cause;
    throw new Error(`GET ${new URL(url).host} failed: ${e?.message}${c ? ` (cause: ${c.code ?? ""} ${c.message ?? c})` : ""}`);
  }
  const text = await r.text();
  if (!r.ok) throw new Error(`GET ${url} -> HTTP ${r.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GET ${url} -> not JSON: ${text.slice(0, 120)}`);
  }
}

/** Score how well an agency label matches the user's concept words (simple, explainable). */
export function labelScore(label: string, words: string[]): number {
  const l = label.toLowerCase();
  let s = 0;
  for (const w of words) if (w && l.includes(w)) s += w.length;
  return s;
}

export const CONCEPT_WORDS: Record<string, string[]> = {
  all_items: ["all items", "all-items", "all groups", "total"],
  food: ["food and non-alcoholic beverages", "food"],
  snacks: ["snack", "confectionery", "sugar, jam, honey, chocolate"],
  condiments: ["condiment", "sauce", "salt, spices"],
};
