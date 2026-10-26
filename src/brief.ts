// Every number in the brief is computed here from rows Zetaris returned.
// The model only writes prose around them, and checkNarrative() rejects prose
// that introduces numbers not present in the facts.
import type { Request, TraceEvent } from "./agent.ts";
import type { SqlResult } from "./zetaris.ts";
import { AGENCY_FOR, Country, normalizeCountry } from "./sources/index.ts";
import { priceView } from "./sources/pricelist.ts";

export interface SeriesFacts {
  concept: string;
  label: string;
  frequency: string;
  sourceId: string;
  latestPeriod: string;
  latestYoy: number;
  avg12: number;
  averageCount: number;
  averageExpected: 12 | 4;
  averageLabel: string;
  yoy6Back?: number;
  trend: "rising" | "easing" | "flat" | "insufficient history";
  points: { period: string; yoy: number }[];
}

export interface MarketFacts {
  country: Country;
  agency: string;
  category?: SeriesFacts;
  allItems?: SeriesFacts;
  monthsStale?: number;
  suggested?: { low: number; high: number; basis: string };
  verdict?: "above the market benchmark" | "within the market benchmark" | "below the market benchmark";
  /** Incremental unit cost recovered, expressed as a percentage of current selling price. */
  costNeed?: number;
  /** Legacy result compatibility only; new results do not infer a cost policy from CPI. */
  passThroughNeeded?: number;
  costVsMarket?: MarketFacts["verdict"];
  cite: string;
}

export interface SkuLine {
  sku: string; product: string; country: string; skuCategory: string; currency: string; currentPrice: number;
  period: string; yoy: number; sourceId: string; low?: number; high?: number; atProposed?: number; verdict?: string; cite: string;
  /** the official series this SKU was priced on (its own category where the agency publishes it) */
  rateLabel?: string; avg12?: number; rangeLow?: number; rangeHigh?: number; coarser?: boolean;
  /** Product-scope series selection, separate from the requested market category. */
  selectionReason?: string;
  selectionSource?: "model" | "memory" | "fallback";
  selectionFit?: "specific" | "broader";
}

export interface Narrative { headline: string; markets: Record<string, string>; watch?: string }

/** Why a brief has no model-written prose. */
export type NarrativeIssue = "grounding" | "unusable" | "provider" | "budget";
const NARRATIVE_ISSUE: Record<NarrativeIssue, string> = {
  grounding: "the model's text did not match the computed numbers and verdicts",
  unusable: "the model's reply was not usable JSON",
  provider: "the model provider returned an error or timed out",
  budget: "the narrative time budget ran out",
};

export interface RunMetrics {
  /** Actual model requests, including hedges and retries. */
  modelCalls: number;
  plannerCalls: number;
  discoveries: number;
  reusedViews: number;
  numbersMs?: number;
}

export interface Brief {
  request: Request;
  metrics?: RunMetrics;
  partialStage?: "markets" | "pricing";
  facts: MarketFacts[];
  notes: string[];
  narrative?: Narrative;
  narrativeIssue?: NarrativeIssue;
  passThrough: number;
  policySource?: string;
  skus?: SkuLine[];
  pricingQuery?: SqlResult;
  /** what changed since the last brief H-MEM remembers for each market */
  sinceLast?: string[];
  compared: SqlResult;
  sqlLog: SqlResult[];
  views: { key: string; view: string; label: string; via: string; note?: string }[];
  ms: number;
  trace: TraceEvent[];
  markdown?: string;
}

const r1 = (x: number) => Math.round(x * 10 + (x >= 0 ? 1e-9 : -1e-9)) / 10;
/** A proposed change as the user would write it: "+5%", "-2%". */
export const signedPct = (x: number) => `${x > 0 ? "+" : ""}${x}%`;

function periodIndex(p: string): number {
  const m = p.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
  const q = p.match(/^(\d{4})-Q([1-4])$/);
  if (q) return Number(q[1]) * 12 + Number(q[2]) * 3 - 1;
  return NaN;
}

export function seriesFacts(rows: Record<string, unknown>[]): SeriesFacts | undefined {
  const valid = rows.filter((r) =>
    (typeof r.yoy_pct === "number" || (typeof r.yoy_pct === "string" && r.yoy_pct.trim() !== "")) &&
    Number.isFinite(Number(r.yoy_pct)) && Number.isFinite(periodIndex(String(r.period))));
  if (!valid.length) return undefined;
  const latestRow = [...valid].sort((a, b) => periodIndex(String(a.period)) - periodIndex(String(b.period))).at(-1)!;
  const freq = String(latestRow.period).includes("-Q") ? "Q" : "M";
  // Count each period once. A duplicated join row must not change the average's weight.
  const byPeriod = new Map<string, { period: string; yoy: number }>();
  for (const r of valid) {
    const period = String(r.period);
    if (period.includes("-Q") !== (freq === "Q")) continue;
    byPeriod.set(period, { period, yoy: Number(r.yoy_pct) });
  }
  const pts = [...byPeriod.values()].sort((a, b) => periodIndex(a.period) - periodIndex(b.period));
  const last = pts.at(-1)!;
  const averageExpected = freq === "Q" ? 4 : 12;
  const recent = pts.filter((p) => periodIndex(p.period) > periodIndex(last.period) - 12);
  const prior = pts.find((p) => periodIndex(p.period) === periodIndex(last.period) - 6);
  const delta = prior ? last.yoy - prior.yoy : undefined;
  return {
    concept: String(latestRow.concept),
    label: String(latestRow.category_label),
    frequency: freq,
    sourceId: String(latestRow.source_id),
    latestPeriod: last.period,
    latestYoy: r1(last.yoy),
    avg12: r1(recent.reduce((s, p) => s + p.yoy, 0) / recent.length),
    averageCount: recent.length,
    averageExpected,
    averageLabel: `${recent.length} of ${averageExpected} ${freq === "Q" ? "quarterly" : "monthly"} observations`,
    yoy6Back: prior ? r1(prior.yoy) : undefined,
    trend: delta === undefined ? "insufficient history" : Math.abs(delta) < 0.3 ? "flat" : delta > 0 ? "rising" : "easing",
    points: pts.map((p) => ({ period: p.period, yoy: r1(p.yoy) })),
  };
}

/** Historical CPI reference endpoints, not a forecast, confidence interval or price recommendation. */
export function marketBenchmark(series: Pick<SeriesFacts, "latestYoy" | "avg12">): { low: number; high: number } {
  return { low: r1(Math.min(series.latestYoy, series.avg12)), high: r1(Math.max(series.latestYoy, series.avg12)) };
}

function costScenario(req: Request, passThrough: number): number | undefined {
  const share = req.costSharePct;
  if (req.invalidPassThrough || !Number.isFinite(passThrough) || passThrough < 0 || passThrough > 1 || req.costIncreasePct === undefined || !Number.isFinite(req.costIncreasePct) || share === undefined || !Number.isFinite(share) || share < 0 || share > 100) return undefined;
  return r1((share / 100) * req.costIncreasePct * passThrough);
}

export function buildFacts(rows: Record<string, unknown>[], req: Request, cite: string, passThrough: number, now = new Date()): MarketFacts[] {
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  return req.countries.map((country) => {
    const mine = rows.filter((r) => r.country === country);
    const category = req.concept === "all_items" ? undefined : seriesFacts(mine.filter((r) => r.concept === req.concept));
    const allItems = seriesFacts(mine.filter((r) => r.concept === "all_items"));
    const main = category ?? allItems;
    const f: MarketFacts = { country, agency: AGENCY_FOR[country].name, category, allItems, cite };
    if (main) {
      f.monthsStale = nowIdx - periodIndex(main.latestPeriod);
      const { low: lo, high: hi } = marketBenchmark(main);
      f.suggested = { low: lo, high: hi, basis: `${main.label} historical market benchmark: latest ${main.latestYoy}% and average ${main.avg12}% (${main.averageLabel})` };
      if (req.proposedChangePct !== undefined) {
        const p = req.proposedChangePct;
        f.verdict = p > hi ? "above the market benchmark" : p < lo ? "below the market benchmark" : "within the market benchmark";
      }
      f.costNeed = costScenario(req, passThrough);
      if (f.costNeed !== undefined) {
        f.costVsMarket = f.costNeed > hi ? "above the market benchmark" : f.costNeed < lo ? "below the market benchmark" : "within the market benchmark";
      }
    }
    return f;
  });
}

/** Numbers one market's prose may use: that market's own facts, the request and the policy - not the whole history. */
export function marketNumbers(f: MarketFacts | undefined, req: Request, policy?: number, preserveSigns = false): number[] {
  const out = new Set<number>();
  const add = (x?: number) => {
    if (x === undefined || !Number.isFinite(x)) return;
    out.add(r1(x));
    if (!preserveSigns) out.add(r1(Math.abs(x)));
  };
  if (f) {
    for (const s of [f.category, f.allItems]) {
      if (!s) continue;
      add(s.latestYoy);
      add(s.avg12);
      add(s.yoy6Back);
      if (s.yoy6Back !== undefined) add(s.latestYoy - s.yoy6Back);
    }
    add(f.suggested?.low);
    add(f.suggested?.high);
    if (!preserveSigns) add(f.monthsStale);
    if (f.suggested && req.proposedChangePct !== undefined) {
      add(req.proposedChangePct - f.suggested.high);
      add(req.proposedChangePct - f.suggested.low);
    }
    add(f.costNeed);
    if (f.costNeed !== undefined && f.suggested) add(f.costNeed - f.suggested.high);
  }
  add(req.costIncreasePct);
  add(req.costSharePct);
  add(req.proposedChangePct);
  if (!req.invalidPassThrough) {
    if (req.passThrough !== undefined) add(req.passThrough * 100);
    if (policy !== undefined) add(policy * 100);
  }
  return [...out];
}

export function allowedNumbers(facts: MarketFacts[], req: Request, policy?: number): number[] {
  const out = new Set<number>([facts.length]);
  for (const f of facts) for (const x of marketNumbers(f, req, policy)) out.add(x);
  if (!facts.length) for (const x of marketNumbers(undefined, req, policy)) out.add(x);
  return [...out];
}

const stripYears = (t: string) => t.replace(/\b(19|20)\d{2}(-(Q[1-4]|\d{2}))?\b/g, " ");
// "12-month average", "over 6 months", "4-quarter average" describe the window, not a rate; a bare 6 or 12 is checked like any number.
const stripWindows = (t: string) => t.replace(/\b(?:6|12)[- ]?(?:months?|periods?)\b|\b4[- ]?quarters?\b/gi, " ");
const near = (a: number, b: number) => Math.abs(a - b) < 0.051;

function unknownNumbers(text: string, allowed: number[]): string[] {
  const bad: string[] = [];
  for (const m of stripWindows(stripYears(text)).matchAll(/(?<![\w.])\d+(?:\.\d+)?/g)) {
    const x = Number(m[0]);
    if (!allowed.some((a) => near(a, x))) bad.push(m[0]);
  }
  return bad;
}

function explicitSignErrors(text: string, signedFacts: number[]): string[] {
  return [...stripYears(text).matchAll(/(?<![\w.%])([+−-]\d+(?:\.\d+)?)\s*%/g)]
    .filter((m) => !signedFacts.some((x) => near(x, Number(m[1].replace("−", "-")))))
    .map((m) => `unsupported signed rate: ${m[0]}`);
}

/** Check explicit descriptions of observed YoY levels or price movements, preserving fall magnitudes. */
function observedRateErrors(text: string, f: MarketFacts): string[] {
  const bad: string[] = [];
  for (const sentence of text.split(/(?<=[.!?;])\s+/)) {
    for (const m of sentence.matchAll(/(?<![\w.])([+−-]?\d+(?:\.\d+)?)\s*%/g)) {
      const before = sentence.slice(0, m.index);
      const after = sentence.slice(m.index! + m[0].length);
      const clause = before.split(/[,;]|\b(?:while|whereas|but)\b/i).at(-1)!;
      // User proposals and cost assumptions are not observations of consumer prices.
      if (/propos|cost|pass[ -]?through|recover|target|scenario/i.test(clause)) continue;
      const movement = clause.match(/\b(?:prices?\s+(?:have\s+|has\s+)?|prices?\s+(?:are|were)\s+)(rose|risen|increased|grew|up|fell|fallen|declined|decreased|dropped|down)(?:\s+by)?\s*$/i);
      const followsRate = /^\s*(?:YoY\b|year[ -]on[ -]year\b)/i.test(after);
      const precedesRate = /\b(?:inflation|YoY|year[ -]on[ -]year)(?:\s+(?:is|was|at|of|rate|stood|stands))*\s*$/i.test(clause);
      if (!movement && !followsRate && !precedesRate) continue;
      const allItemsMentioned = /all[ -]items|headline inflation/i.test(before);
      const s = allItemsMentioned ? f.allItems ?? f.category : f.category ?? f.allItems;
      if (!s) continue;
      const literal = Number(m[1].replace("−", "-"));
      const down = movement && /fell|fallen|declined|decreased|dropped|down/i.test(movement[1]);
      const stated = movement ? (down ? -Math.abs(literal) : Math.abs(literal)) : literal;
      const observed = /average|mean/i.test(clause) ? [s.avg12] : /\b(?:from|previous|earlier|ago)\b/i.test(clause) ? [s.latestYoy, s.avg12, s.yoy6Back].filter((x): x is number => x !== undefined) : [s.latestYoy];
      if (!observed.some((x) => near(x, stated))) bad.push(`observed rate contradicts the series: ${m[0]}`);
    }
  }
  return bad;
}

function checkCoverage(text: string, facts: MarketFacts[]): { text: string; errors: string[] } {
  const series = facts.flatMap((f) => [f.category, f.allItems]).filter((s): s is SeriesFacts => !!s);
  const errors: string[] = [];
  const stripped = text.replace(/\b(\d+)(?: of (\d+))? (monthly|quarterly) observations\b/gi, (claim, count, expected, frequency) => {
    const matches = series.some((s) => s.averageCount === Number(count) && (expected === undefined || s.averageExpected === Number(expected)) && (s.frequency === "Q" ? "quarterly" : "monthly") === frequency.toLowerCase());
    if (!matches) errors.push(`unsupported observation coverage: ${claim}`);
    return " ";
  });
  return { text: stripped, errors };
}

/**
 * A stated range must match the historical benchmark, with its signs preserved.
 * A latest/average pair may also describe a change in the observed data.
 */
function rangeErrors(text: string, f: MarketFacts): string[] {
  const bad: string[] = [];
  const data: number[] = [];
  for (const s of [f.category, f.allItems]) if (s) data.push(s.latestYoy, s.avg12, ...(s.yoy6Back !== undefined ? [s.yoy6Back] : []));
  const isData = (x: number) => data.some((d) => near(d, x));
  const t = stripYears(text);
  for (const m of t.matchAll(/([+−-]?\d+(?:\.\d+)?)\s*%?\s*(?:to|–|—|-|and)\s*([+−-]?\d+(?:\.\d+)?)\s*%/g)) {
    const a = Number(m[1].replace("−", "-"));
    const b = Number(m[2].replace("−", "-"));
    const isRange = !!f.suggested && near(Math.min(a, b), f.suggested.low) && near(Math.max(a, b), f.suggested.high);
    const sentence = t.slice(Math.max(0, m.index! - 60), m.index).split(/[.;!?]\s/).pop() ?? "";
    const presentedAsRange = /support|suggest|justif|range|room|evidence|band|benchmark/i.test(sentence);
    if (!isRange && (presentedAsRange || !(isData(a) && isData(b)))) bad.push(`${m[1]}–${m[2]}%`);
  }
  return bad;
}

function comparisonSubject(text: string, at: number): "cost" | "proposal" {
  const prefix = text.slice(0, at).split(/(?<=[.!?;])\s+/).at(-1)!;
  const last = (pattern: RegExp) => [...prefix.matchAll(pattern)].at(-1)?.index ?? -1;
  return last(/\bcost\w*\b|원가/gi) > last(/\bpropos\w*\b/gi) ? "cost" : "proposal";
}

/** Proposal and cost-scenario comparisons each use their own computed verdict. */
function verdictErrors(text: string, f: MarketFacts): string[] {
  const bad: string[] = [];
  for (const m of text.matchAll(/\b(within|inside|above|exceeds?|exceeding|below|under|outside)\s+(?:the\s+)?(?:historical\s+|suggested\s+|computed\s+)?(?:market\s+)?(?:benchmark|evidence|range)\b/gi)) {
    const subject = comparisonSubject(text, m.index!);
    const verdict = subject === "cost" ? f.costVsMarket : f.verdict;
    if (!verdict) {
      if (subject === "cost") bad.push(`cost comparison unavailable: ${m[0]}`);
      continue;
    }
    const w = m[1].toLowerCase();
    const ok = w === "outside" ? verdict !== "within the market benchmark" : verdict === (/within|inside/.test(w) ? "within the market benchmark" : /below|under/.test(w) ? "below the market benchmark" : "above the market benchmark");
    if (!ok) bad.push(`"${m[0]}" (computed: ${verdict})`);
  }
  return bad;
}

/**
 * Verdict words in the headline ("within evidence in CA, below in AU"), market by market: each market named
 * after a verdict word (or before the first one) must have that verdict; "within or above" allows either.
 * With no market named, the word must be a verdict some market has (all of them, when they agree).
 */
function headlineVerdictErrors(headline: string, facts: MarketFacts[], field = "headline"): string[] {
  const vf = facts.filter((f) => f.verdict || f.costVsMarket);
  if (!vf.length) return [];
  const text = headline;
  const toVerdict = (w: string) => (/within|inside/i.test(w) ? "within the market benchmark" : /below/i.test(w) ? "below the market benchmark" : "above the market benchmark");
  const claims: { at: number; end: number; words: string[]; verdicts: Set<string>; subject: "cost" | "proposal" }[] = [];
  for (const m of text.matchAll(/\b(within|inside|above|exceeds?|exceeding|below)\b/gi)) {
    const prev = claims.at(-1);
    if (prev && /^\s*(or|\/)\s*$/i.test(text.slice(prev.end, m.index))) {
      prev.verdicts.add(toVerdict(m[1]));
      prev.words.push(m[1]);
      prev.end = m.index! + m[0].length;
    } else claims.push({ at: m.index!, end: m.index! + m[0].length, words: [m[1]], verdicts: new Set([toVerdict(m[1])]), subject: comparisonSubject(text, m.index!) });
  }
  if (!claims.length) return [];
  const mentions = countryMentions(text, vf);
  const bad: string[] = [];
  if (!mentions.length) {
    for (const c of claims) {
      const present = new Set(vf.map((f) => c.subject === "cost" ? f.costVsMarket : f.verdict));
      if (![...c.verdicts].some((v) => present.has(v as MarketFacts["verdict"]))) bad.push(`${field} "${c.words.join(" or ")}" (computed: ${[...present].join(", ")})`);
    }
    return bad;
  }
  for (const m of mentions) {
    const owner = [...claims].reverse().find((c) => c.at < m.at) ?? claims[0];
    const f = vf.find((x) => x.country === m.country)!;
    const verdict = owner.subject === "cost" ? f.costVsMarket : f.verdict;
    if (!verdict || !owner.verdicts.has(verdict)) bad.push(`${field} "${owner.words.join(" or ")}" for ${m.country} (computed: ${verdict})`);
  }
  return [...new Set(bad)];
}

/** The market a prose key refers to ("DE", "de", "Germany"). */
export function marketKey(code: string): string {
  return normalizeCountry(code) ?? code.toUpperCase();
}

/** CPI observations cannot establish demand acceptance or a future price path. This is a narrow claim guard, not semantic verification. */
function unsupportedClaims(text: string): string[] {
  const bad: string[] = [];
  for (const sentence of text.split(/(?<=[.!?;])\s+/)) {
    const claimsDemand = /\b(?:customers?|consumers?|buyers?|demand)\b.{0,60}\b(?:accept|support|absorb|tolerate|justify|pay|willing)\b/i.test(sentence);
    const claimsSupport = /\b(?:supports?|justifies?|warrants?)\s+(?:(?:a|the|your|proposed)\s+)*(?:[+−-]?\d+(?:\.\d+)?%\s+)?(?:price\s+)?(?:increase|rise|hike|change)\b/i.test(sentence);
    const claimsForecast = /\b(?:will|expected to|forecast(?:ed)? to|predicted to)\s+(?:rise|fall|increase|decrease|ease|accelerate|remain|reach)\b/i.test(sentence);
    if (!(claimsDemand || claimsSupport || claimsForecast)) continue;
    // Keep an explicit limitation, while rejecting the corresponding positive claim.
    if (/\b(?:cannot|does not|do not|not a|no evidence|not enough evidence)\b/i.test(sentence)) continue;
    bad.push(`unsupported demand or forecast claim: ${sentence}`);
  }
  return bad;
}

// Narrative adjectives supplement the request parser's names and ISO codes.
const NARRATIVE_COUNTRY_ADJECTIVES: Record<string, Country> = {
  german: "DE", australian: "AU", french: "FR", italian: "IT", spanish: "ES", belgian: "BE",
  austrian: "AT", irish: "IE", portuguese: "PT", finnish: "FI", swedish: "SE", danish: "DK", polish: "PL",
};

function countryMentions(text: string, facts: MarketFacts[]): { at: number; end: number; country: Country }[] {
  return [...text.matchAll(/\p{L}+/gu)].flatMap((m) => {
    const country = normalizeCountry(m[0], false) ?? NARRATIVE_COUNTRY_ADJECTIVES[m[0].toLowerCase()];
    return country && facts.some((f) => f.country === country) ? [{ at: m.index!, end: m.index! + m[0].length, country }] : [];
  });
}

/** Scope explicit country claims only. Countryless aggregate prose keeps the existing checks. */
function namedCountryErrors(text: string, facts: MarketFacts[], req: Request, policy?: number, extra: number[] = []): string[] {
  const bad: string[] = [];
  const hasNumber = (part: string) => /\d/.test(stripWindows(stripYears(part)));
  for (const sentence of text.split(/(?<=[.!?;])\s+|\n+/)) {
    const mentions = countryMentions(sentence, facts);
    const cuts = [0];
    for (let i = 1; i < mentions.length; i++) {
      const previous = mentions[i - 1], next = mentions[i];
      const between = sentence.slice(previous.end, next.at);
      // "Germany and Canada: 2.2%" is one shared claim; "Germany: 1.4%, Canada: 2.2%"
      // and "1.4% in Germany and 2.2% in Canada" contain separate numeric clauses.
      const separate = hasNumber(between) || (hasNumber(sentence.slice(cuts.at(-1), previous.at)) && hasNumber(sentence.slice(next.end)));
      if (!separate) continue;
      const boundary = [...between.matchAll(/[,;]|\b(?:and|but|while|whereas|compared\s+with)\b/gi)].at(-1);
      cuts.push(boundary ? previous.end + boundary.index! + boundary[0].length : next.at);
    }
    cuts.push(sentence.length);
    for (let i = 0; i < cuts.length - 1; i++) {
      const clause = sentence.slice(cuts[i], cuts[i + 1]);
      const countries = new Set(countryMentions(clause, facts).map((m) => m.country));
      for (const country of countries) {
        const f = facts.find((x) => x.country === country)!;
        const coverage = checkCoverage(clause, [f]);
        const errors = [
          ...coverage.errors,
          ...unknownNumbers(coverage.text, [...marketNumbers(f, req, policy), ...extra]),
          ...explicitSignErrors(clause, [...marketNumbers(f, req, policy, true), ...extra]),
          ...observedRateErrors(clause, f),
          ...rangeErrors(clause, f),
        ];
        bad.push(...errors.map((error) => `${country}: ${error}`));
      }
    }
  }
  return bad;
}

function internalPayloadErrors(text: string): string[] {
  // Markdown underscores are formatting boundaries even though JavaScript's \b treats them as word characters.
  const keys = /(?<![\p{L}\p{N}])(?:benchmark_range_pct|suggested_range_pct|benchmark_basis|proposed_change_pct|pass_through_pct|pass_through_needed_pct|cost_need_pct|cost_vs_market|cost_share_pct|cost_share_basis|cost_increase_pct|cost_pass_through_pct|cost_input_needed|latestPeriod|latestYoy|avg12|yoy6Back|monthsStale|averageCount|averageExpected|averageLabel|allItems)(?![\p{L}\p{N}])/giu;
  return [...text.matchAll(keys)].map((m) => `internal payload key in prose: ${m[0]}`);
}

/**
 * Numbers in the prose that are not facts (years and period labels are ignored).
 * With facts, each market's paragraph is checked against that market's own numbers and its stated range;
 * without facts (unit tests), the flat allowed list is used.
 */
export function checkNarrative(n: Narrative, allowed: number[], facts?: MarketFacts[], req?: Request, policy?: number, extra: number[] = []): string[] {
  const bad = [n.headline, n.watch, ...Object.values(n.markets ?? {})]
    .filter((text): text is string => typeof text === "string")
    .flatMap(internalPayloadErrors);
  if (facts && req) {
    for (const [code, text] of Object.entries(n.markets ?? {})) {
      if (typeof text !== "string") {
        bad.push(`${code}: not text`);
        continue;
      }
      const f = facts.find((x) => x.country === marketKey(code));
      const coverage = checkCoverage(text, f ? [f] : []);
      bad.push(...coverage.errors, ...unknownNumbers(coverage.text, f ? [...marketNumbers(f, req, policy), ...extra] : allowed));
      bad.push(...explicitSignErrors(text, [...marketNumbers(f, req, policy, true), ...extra]));
      bad.push(...unsupportedClaims(text));
      bad.push(...namedCountryErrors(text, facts, req, policy, extra));
      if (f) bad.push(...rangeErrors(text, f), ...verdictErrors(text, f), ...observedRateErrors(text, f));
    }
    if (typeof n.headline !== "string" || (n.watch !== undefined && typeof n.watch !== "string")) bad.push("headline or watch: not text");
    const general = [n.headline, n.watch ?? ""].join(" ");
    const coverage = checkCoverage(general, facts);
    bad.push(...coverage.errors, ...unknownNumbers(coverage.text, allowed));
    bad.push(...explicitSignErrors(general, facts.flatMap((f) => marketNumbers(f, req, policy, true))));
    bad.push(...unsupportedClaims(general));
    for (const text of [n.headline, n.watch]) if (typeof text === "string") bad.push(...namedCountryErrors(text, facts, req, policy, extra));
    if (facts.length === 1) bad.push(...rangeErrors(general, facts[0]), ...verdictErrors(general, facts[0]), ...observedRateErrors(general, facts[0]));
    bad.push(...headlineVerdictErrors(String(n.headline ?? ""), facts));
    if (typeof n.watch === "string") bad.push(...headlineVerdictErrors(n.watch, facts, "watch"));
  } else {
    bad.push(...unknownNumbers([n.headline, ...Object.values(n.markets ?? {}), n.watch ?? ""].join(" "), allowed));
  }
  return [...new Set(bad)];
}

/** What the narrative model sees: the facts without the monthly history, so it cannot pick a stray number. */
export function factsForNarrative(facts: MarketFacts[], req?: Request, policy?: number): unknown[] {
  const slim = (s?: SeriesFacts) => (s ? { label: s.label, frequency: s.frequency, latestPeriod: s.latestPeriod, latestYoy: s.latestYoy, avg12: s.avg12, averageCount: s.averageCount, averageExpected: s.averageExpected, averageLabel: s.averageLabel, yoy6Back: s.yoy6Back, trend: s.trend } : undefined);
  return facts.map((f) => ({
    country: f.country, agency: f.agency, category: slim(f.category), allItems: slim(f.allItems), monthsStale: f.monthsStale,
    benchmark_range_pct: f.suggested ? { low: f.suggested.low, high: f.suggested.high } : undefined,
    benchmark_basis: "latest YoY and available-observation mean in the year ending at the latest observation; historical reference only, not a forecast, confidence interval or evidence of customer acceptance",
    verdict: f.verdict,
    ...(f.costNeed !== undefined && !req?.invalidPassThrough ? {
      cost_need_pct: f.costNeed, cost_vs_market: f.costVsMarket,
      cost_share_pct: req?.costSharePct, cost_share_basis: "current unit cost / current selling price",
      cost_increase_pct: req?.costIncreasePct, cost_pass_through_pct: policy === undefined ? undefined : Math.round(policy * 100),
    } : {}),
    ...(req?.costIncreasePct !== undefined && f.costNeed === undefined ? {
      cost_input_needed: req.invalidPassThrough ? "valid cost pass-through from 0% to 100%" : "current unit cost as a percentage of current selling price",
    } : {}),
  }));
}

/** One line per market for the same caveat about different categories ("condiments" and "snacks" at the Food level). */
export function mergeNotes(notes: string[]): string[] {
  const out: string[] = [];
  const groups = new Map<string, string[]>();
  for (const n of [...new Set(notes)]) {
    const m = n.match(/^(.*?so )"([^"]+)"( is compared at .*)$/);
    if (!m) { out.push(n); continue; }
    const k = m[1] + "\u0000" + m[3];
    if (!groups.has(k)) { groups.set(k, []); out.push(k); }
    groups.get(k)!.push(m[2]);
  }
  return out.map((n) => {
    const g = groups.get(n);
    if (!g) return n;
    const [a, b] = n.split("\u0000");
    const names = g.map((x) => `"${x}"`);
    return `${a}${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}${names.length > 1 ? b.replace(" is compared", " are compared") : b}`;
  });
}

const fmt = (x?: number, suffix = "%") => (x === undefined ? "n/a" : `${x > 0 ? "+" : ""}${x.toFixed(1)}${suffix}`);

/** Headline built from the computed verdicts, used when the model's prose is unavailable. */
export function fallbackHeadline(b: Brief): string | undefined {
  const p = b.request.proposedChangePct;
  const withVerdict = b.facts.filter((f) => f.verdict);
  if (p !== undefined && withVerdict.length) {
    const groups = new Map<string, string[]>();
    for (const f of withVerdict) groups.set(f.verdict!, [...(groups.get(f.verdict!) ?? []), f.country]);
    return `${signedPct(p)} is ${[...groups.entries()].map(([v, cs]) => `${v} in ${cs.length > 1 ? `${cs.slice(0, -1).join(", ")} and ${cs.at(-1)}` : cs[0]}`).join("; ")}.`;
  }
  const parts = b.facts.map((f) => (f.category ?? f.allItems) && `${f.country} ${fmt((f.category ?? f.allItems)!.latestYoy)}`).filter(Boolean);
  return parts.length ? `Latest year-on-year rates: ${parts.join(", ")}.` : undefined;
}

export function renderBrief(b: Brief): string {
  const L: string[] = [];
  const req = b.request;
  L.push(`# PriceSignal brief`);
  L.push(`> ${req.raw.replace(/\n/g, " ")}`);
  L.push("");
  if (!b.facts.length) {
    L.push(`**None of the markets in this question is covered yet.**`, "", `## Fragmentation the agent found`, ...mergeNotes(b.notes).map((n) => `- ${n}`));
    return L.join("\n");
  }
  const headline = b.narrative?.headline ?? fallbackHeadline(b);
  if (headline) L.push(`**${headline}**`, "");
  L.push(`${req.invalidPassThrough ? "Cost policy unavailable: provide a valid pass-through percentage from 0% to 100%" : `Cost policy: recover ${Math.round(b.passThrough * 100)}% of incremental unit cost${b.policySource ? ` (${b.policySource})` : ""}`}${req.proposedChangePct !== undefined ? ` · proposed change: ${signedPct(req.proposedChangePct)}` : ""}. This policy does not scale the market benchmark.`, "");
  if (req.costIncreasePct !== undefined) {
    const need = costScenario(req, b.passThrough);
    L.push(`Your unit costs: ${signedPct(req.costIncreasePct)} (${req.costRemembered ? "remembered from your last request" : "stated in this request"}). ${req.invalidPassThrough ? "The cost-recovery price scenario is unavailable until the cost policy is valid." : need === undefined ? "To calculate a cost-recovery price scenario, provide current unit cost as a percentage of current selling price." : `Current unit cost is ${req.costSharePct}% of current selling price${req.costShareRemembered ? " (remembered)" : ""}; recovering ${Math.round(b.passThrough * 100)}% of the incremental cost gives a ${signedPct(need)} selling-price scenario.`}`, "");
  }
  L.push(`The historical market benchmark spans the latest YoY rate and the mean of available observations in the year ending at the latest observation. It is not a forecast, a confidence interval or evidence that customers will accept a price change. A single value is a reference point, not a recommended price.`, "");
  L.push(`| Market | Official category | Latest period | YoY | Available-year average | Trend vs. 6 months ago | All-items YoY | Market benchmark | Proposed change |`);
  L.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const f of b.facts) {
    const s = f.category ?? f.allItems;
    L.push(
      `| ${f.country} (${f.agency}) | ${s?.label ?? "not found"} | ${s?.latestPeriod ?? "-"}${f.monthsStale !== undefined && f.monthsStale > 2 ? ` ⚠ ${f.monthsStale} mo old` : ""} | ${fmt(s?.latestYoy)} | ${fmt(s?.avg12)}${s ? ` (${s.averageLabel ?? "available observations"})` : ""} | ${s?.trend ?? "-"} | ${fmt(f.allItems?.latestYoy)} | ${f.suggested ? `${f.suggested.low.toFixed(1)}–${f.suggested.high.toFixed(1)}%` : "-"} | ${f.verdict ?? "-"} |`,
    );
  }
  L.push("", `Every rate above comes from Zetaris query **${b.compared.id}** (one federated SQL over the onboarded sources); market benchmarks and comparisons are computed in code from those rates.`, "");
  if (b.skus?.length) {
    const money = (x: number | undefined, c: string) => (x === undefined ? "-" : `${x.toFixed(2)} ${c}`);
    L.push(`## Your price list`);
    const perSku = b.skus.some((s) => s.rateLabel);
    L.push(perSku
      ? `Internal SKUs (Zetaris view \`psig.${priceView()}\`) joined in query **${b.pricingQuery?.id}** with official category series for the products in each market; broader proxies are marked. Each SKU's benchmark price scenario applies its selected series' historical rates to its current price, computed in code.`
      : `Internal SKUs (Zetaris view \`psig.${priceView()}\`) joined with the latest official category rate in query **${b.pricingQuery?.id}**.`, "");
    L.push(`| SKU | Product | Market | Current price | Benchmark price scenario | At ${req.proposedChangePct !== undefined ? signedPct(req.proposedChangePct) : "-"} | Rate used |`);
    L.push(`|---|---|---|---|---|---|---|`);
    for (const s of b.skus) L.push(`| ${s.sku} | ${s.product} | ${s.country} | ${money(s.currentPrice, s.currency)} | ${s.low !== undefined ? `${s.low.toFixed(2)}–${money(s.high, s.currency)}${s.rangeLow !== undefined ? ` (${s.rangeLow > 0 ? "+" : ""}${s.rangeLow.toFixed(1)}–${s.rangeHigh!.toFixed(1)}%)` : ""}` : "-"} | ${money(s.atProposed, s.currency)}${s.verdict ? ` (${s.verdict})` : ""} | ${fmt(s.yoy)} ${s.period}${s.rateLabel ? ` · ${s.rateLabel}${s.selectionSource ? ` (${s.selectionFit === "broader" ? "broader proxy" : "product match"}; ${{ model: "model-selected", memory: "remembered match", fallback: "unconfirmed match" }[s.selectionSource]})` : s.coarser ? " (coarser)" : ""}` : ""} |`);
    L.push("");
  }
  L.push(`## By market`);
  for (const f of b.facts) {
    const s = f.category ?? f.allItems;
    const prose = b.narrative?.markets?.[f.country];
    L.push(`### ${f.country} — ${f.agency}`);
    L.push(prose ?? (s ? `${s.label}: ${fmt(s.latestYoy)} year on year in ${s.latestPeriod} (${s.trend} vs. six months ago; average ${fmt(s.avg12)}, ${s.averageLabel ?? "available observations"}). Historical market benchmark ${f.suggested?.low.toFixed(1)}–${f.suggested?.high.toFixed(1)}%.` : "No usable series."));
    if (s) L.push(`<sub>source: \`${s.sourceId}\` · ${s.frequency === "Q" ? "quarterly" : "monthly"} · cite ${f.cite}</sub>`);
    L.push("");
  }
  const costed = b.facts.filter((f) => f.costVsMarket && f.suggested);
  if (costed.length) {
    L.push(`## Costs vs. the market`);
    L.push(`Compare the cost-recovery price scenario with the historical movement of consumer prices. Neither establishes demand, competitor responses or a profit-maximizing price.`, "");
    for (const f of costed) {
      const s = (f.category ?? f.allItems)!;
      const range = `${f.suggested!.low.toFixed(1)}–${f.suggested!.high.toFixed(1)}%`;
      const need = signedPct(f.costNeed!);
      L.push(`- ${f.country}: the ${need} cost-recovery price scenario is ${f.costVsMarket} (${s.label}: ${range}).`);
    }
    L.push("");
  }
  if (b.sinceLast?.length) {
    L.push(`## Since your last brief (remembered in H-MEM)`);
    for (const c of b.sinceLast) L.push(`- ${c}`);
    L.push("");
  }
  if (b.notes.length) {
    L.push(`## Fragmentation the agent found`);
    for (const n of mergeNotes(b.notes)) L.push(`- ${n}`);
    L.push("");
  }
  if (b.narrative?.watch) L.push(`**Watch:** ${b.narrative.watch}`, "");
  L.push(`## Evidence`);
  L.push(`Views: ${b.views.map((v) => `\`psig.${v.view}\` (${v.via})`).join(", ")}`, "");
  for (const q of b.sqlLog.filter((q) => q.id === b.compared.id || q.id === b.pricingQuery?.id || /^SELECT COUNT/.test(q.sql))) {
    L.push(`<details><summary>${q.id} · ${q.rows.length} rows · ${q.ms} ms</summary>\n\n\`\`\`sql\n${q.sql}\n\`\`\`\n</details>`);
  }
  if (!b.narrative) L.push("", `_Narrative omitted: ${b.narrativeIssue ? NARRATIVE_ISSUE[b.narrativeIssue] : "the model's text was not available"}, so only computed facts are shown._`);
  return L.join("\n");
}
