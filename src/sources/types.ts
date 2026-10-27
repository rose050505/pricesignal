// Shared shapes for the statistics agencies. Each adapter answers two
// questions the agent cannot answer from memory alone: "which series matches
// this concept here, and is it still alive?" (discover) and "how do I make it a
// governed Zetaris table?" (onboardSql).

// Eurostat publishes HICP for every EU member with the same API, so any of these
// markets goes through the same discover/onboard path as Germany.
export const EU_CODES = ["DE", "FR", "IT", "ES", "NL", "BE", "AT", "IE", "PT", "FI", "SE", "DK", "PL", "CZ"] as const;
export type EuCountry = (typeof EU_CODES)[number];
export type Country = EuCountry | "CA" | "AU" | "US";
export const SUPPORTED_COUNTRIES: Country[] = [...EU_CODES, "CA", "AU", "US"];
export type Concept = "all_items" | "food" | string;

export interface Candidate {
  agency: "eurostat" | "statcan" | "abs" | "bls";
  country: Country;
  dataset: string; // agency dataset / product id
  code: string; // category code (COICOP, ABS index, StatCan vector)
  label: string; // human-readable category label from the agency
  frequency: "M" | "Q";
  measure: "yoy_pct" | "index"; // what the raw series holds
  lastPeriod?: string;
  status: "active" | "discontinued" | "unknown";
  isBroadFallback?: boolean; // a verified Food aggregate offered for a narrower food category
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
  // Not lower-case "us" (an ordinary word); upper-case "US" is read as the ISO code.
  usa: "US", "u.s.": "US", "u.s.a.": "US", "united states": "US", america: "US", american: "US", "미국": "US",
  france: "FR", frankreich: "FR", "프랑스": "FR",
  italy: "IT", italia: "IT", "이탈리아": "IT",
  spain: "ES", espana: "ES", "españa": "ES", "스페인": "ES",
  netherlands: "NL", holland: "NL", nederland: "NL", dutch: "NL", "네덜란드": "NL",
  belgium: "BE", belgique: "BE", "벨기에": "BE",
  austria: "AT", "österreich": "AT", oesterreich: "AT", "오스트리아": "AT",
  ireland: "IE", "아일랜드": "IE",
  portugal: "PT", "포르투갈": "PT",
  finland: "FI", suomi: "FI", "핀란드": "FI",
  sweden: "SE", sverige: "SE", "스웨덴": "SE",
  denmark: "DK", danmark: "DK", "덴마크": "DK",
  poland: "PL", polska: "PL", "폴란드": "PL",
  czechia: "CZ", czech: "CZ", "체코": "CZ",
};

/** `fuzzy` (one typo in names of 5+ letters) is for country names the model extracted; words scanned from the question itself must match exactly ("inland" is not Finland). */
export function normalizeCountry(raw: string, fuzzy = true): Country | null {
  const t = raw.trim();
  // Upper-case ISO codes ("FR", "IT") only; lower-case "it", "be", "at" are ordinary words.
  if (/^[A-Z]{2}$/.test(t) && (SUPPORTED_COUNTRIES as string[]).includes(t)) return t as Country;
  const k = t.toLowerCase();
  if (Object.hasOwn(COUNTRY_ALIASES, k)) return COUNTRY_ALIASES[k];
  // Tolerate one typo in names of 5+ letters ("canda", "austrlia", "germny").
  if (fuzzy && k.length >= 4) {
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

/** Name of a Zetaris table or view. PSIG_ZETARIS_NS (optional) suffixes every name, so a run can register a fresh set of objects (a true cold start). */
export function zetarisName(...parts: string[]): string {
  return safeIdent(...parts, process.env.PSIG_ZETARIS_NS ?? "");
}

export function monthsBack(n: number, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const USER_AGENT = () => process.env.PSIG_HTTP_USER_AGENT || "PriceSignal/0.1 (Open Agent Hackathon 2026)";

/** One plain line for a source failure; the raw error (often a Spark stack) stays in the trace data. */
export function humanError(raw: unknown): string {
  const s = String(raw ?? "");
  if (/<!doctype html|<html|returned a web page/i.test(s)) return /Spark|Hive|Zetaris/i.test(s) ? "the agency returned a web page instead of data (likely maintenance), so Zetaris could not read the series" : "the agency returned a web page instead of data (likely maintenance)";
  if (/ECONNRESET|Connection reset|socket hang up|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(s)) return /Spark|Hive|Zetaris/i.test(s) ? "the connection to the agency dropped while Zetaris was reading the series" : "the connection to the agency dropped";
  if (/timed? ?out|TimeoutError|AbortError/i.test(s)) return "the request timed out";
  const http = s.match(/-> HTTP (\d{3})/);
  if (http) return `the agency returned HTTP ${http[1]}`;
  if (/SparkException|HiveSQLException/.test(s)) return "Zetaris could not read the agency's response";
  return s.replace(/^Error: /, "").slice(0, 140);
}

/** An agency outage during discovery is true only for that run: it is shown then, never stored with a remembered mapping. */
const TRANSIENT_NOTE = /\bdid not answer during discovery\b|\bcould not be checked\b/i;
export function durableNotes(note: string | undefined): string | undefined {
  return note?.split(/(?<=[.!?])\s+/).filter((s) => !TRANSIENT_NOTE.test(s)).join(" ") || undefined;
}

/** One retry after a dropped connection, a 5xx or a 429 (agencies blip); a timeout already waited a minute and is not retried. */
export async function getJson(url: string, headers: Record<string, string> = {}, retryDelayMs = 1000): Promise<any> {
  let r: Response | undefined;
  let text = "";
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= 1;
    try {
      r = await fetch(url, { headers: { "User-Agent": USER_AGENT(), ...headers }, signal: AbortSignal.timeout(60_000) });
    } catch (e: any) {
      const c = e?.cause;
      if (!last && e?.name !== "TimeoutError" && e?.name !== "AbortError") {
        await new Promise((res) => setTimeout(res, retryDelayMs));
        continue;
      }
      throw new Error(`GET ${new URL(url).host} failed: ${e?.message}${c ? ` (cause: ${c.code ?? ""} ${c.message ?? c})` : ""}`);
    }
    text = await r.text();
    if (!last && (r.status >= 500 || r.status === 429)) {
      await new Promise((res) => setTimeout(res, retryDelayMs));
      continue;
    }
    break;
  }
  // The host and the reason come first: notes shorten these messages.
  const host = new URL(url).host;
  if (!r.ok) throw new Error(`${host} -> HTTP ${r.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    if (/<html|<!doctype/i.test(text)) {
      const title = text.match(/<title>([\s\S]*?)<\/title>/i)?.[1].replace(/\s+/g, " ").trim();
      throw new Error(`${host} returned a web page instead of data (the service may be down for maintenance)${title ? `: "${title.slice(0, 90)}"` : ""}`);
    }
    throw new Error(`${host} -> not JSON: ${text.slice(0, 120)}`);
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

/** Broad Food is usable only when the official catalog actually calls it Food. */
export function isBroadFoodLabel(label: unknown): label is string {
  return typeof label === "string" && /^food(?: and non[- ]alcoholic beverages)?$/i.test(label.trim().replace(/\s+/g, " "));
}

/** Remove the chocolate-chip phrase, not other chips or crisps in a mixed product. */
export function hasSavouryChipContext(product: unknown): boolean {
  if (typeof product !== "string") return false;
  const otherWords = product.replace(/\bchocolate[\s-]+chips?\b/gi, " ");
  return /\b(?:chips?|crisps?)\b/i.test(otherWords);
}

/** Product names can refine SKU lookup without changing a market-level concept. */
export function skuSearchWords(concept: Concept, products: readonly string[]): string[] {
  const words = [...(CONCEPT_WORDS[concept] ?? [concept])];
  if (concept === "snacks" && products.some(hasSavouryChipContext)) {
    words.push("potato", "crisp", "chip");
  }
  return [...new Set(words)];
}
