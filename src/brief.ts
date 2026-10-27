// Every number in the brief is computed here from rows Zetaris returned.
// The model only writes prose around them, and checkNarrative() rejects prose
// that introduces numbers not present in the facts.
import type { Request, TraceEvent } from "./agent.ts";
import type { SqlResult } from "./zetaris.ts";
import { AGENCY_FOR, CONCEPT_WORDS, Country, normalizeCountry } from "./sources/index.ts";
import { priceView } from "./sources/pricelist.ts";
import type { PeriodAlignment } from "./alignment.ts";
import { costPolicyErrors } from "./narrative-policy.ts";

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

export interface Narrative {
  headline: string; markets: Record<string, string>; watch?: string;
  /** Sentences the fact check removed from the model's draft, with the reasons. */
  removed?: RemovedSentence[];
  /** The draft's headline was removed, so the brief shows the headline computed in code. */
  headlineByCode?: boolean;
  /** The reply was cut off mid-JSON; only its complete fields are shown (after the same fact check). */
  cutOff?: boolean;
  /** The model id the runtime reported for the reply this narrative came from. */
  model?: string;
}
export interface RemovedSentence { field: string; sentence: string; problems: string[] }

/** Why a brief has no model-written prose. */
export type NarrativeIssue = "grounding" | "unusable" | "provider" | "budget";
const NARRATIVE_ISSUE: Record<NarrativeIssue, string> = {
  grounding: "the model's text did not match the computed numbers and verdicts",
  unusable: "the model's reply was not usable JSON",
  provider: "the model provider returned an error or timed out",
  budget: "the narrative time budget ran out",
};

export interface RunMetrics {
  /** Agent model calls, including hedges; internal provider HTTP retries are not counted. */
  modelCalls: number;
  plannerCalls: number;
  discoveries: number;
  reusedViews: number;
  /** Raw agency REST tables served from the Zetaris cache (CACHE TABLE) in this run. */
  cachedTables?: number;
  numbersMs?: number;
}

export interface Brief {
  request: Request;
  /** The Zetaris semantic view the market comparison read (absent when the direct UNION ALL query was used). */
  semanticView?: { name: string; sql: string; members: string[] };
  /** UTC start of this run, kept stable across partial and final snapshots. */
  startedAt?: string;
  /** UTC calculation time shared by facts, alignment, and offline evidence replay. */
  calculatedAt?: string;
  metrics?: RunMetrics;
  partialStage?: "markets" | "pricing";
  facts: MarketFacts[];
  /** Same-date context, separate from each market's latest benchmark. */
  alignment?: PeriodAlignment;
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
/** A market benchmark as text: "0.4–1.4%", or one value when both ends round to the same figure. */
export const benchmarkText = (r: { low: number; high: number }) => (r.low.toFixed(1) === r.high.toFixed(1) ? `${r.low.toFixed(1)}% (single value)` : `${r.low.toFixed(1)}–${r.high.toFixed(1)}%`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

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

function calculateCostScenario(req: Request, passThrough: number): { value?: number; issue?: string } {
  const share = req.costSharePct, change = req.costIncreasePct;
  if (req.invalidPassThrough || !Number.isFinite(passThrough) || passThrough < 0 || passThrough > 1) return { issue: "Provide a valid cost pass-through percentage from 0% to 100%." };
  if (change === undefined || !Number.isFinite(change) || change < -100) return { issue: "Provide a finite unit-cost change of at least -100%; costs cannot fall by more than their full value." };
  if (req.costShareBasis === "after_change" && change === -100) return { issue: "Provide unit cost before the stated cost change as a percentage of the unchanged selling price; a 100% decrease cannot be reversed from the post-change cost share." };
  if (share === undefined || !Number.isFinite(share) || share < 0 || share > 100) return { issue: "Provide unit cost as a percentage of the unchanged selling price, and state whether that cost is before or after the stated cost change." };
  const denominator = req.costShareBasis === "after_change" ? 1 + change / 100 : 1;
  const raw = (share / 100) * (change / denominator) * passThrough;
  // A mathematically exact -100% can be a few ulps lower after the division (25%, -80%, 100%).
  const zeroPriceTolerance = 8 * Number.EPSILON * 100;
  if (raw < -100 - zeroPriceTolerance) return { issue: "This cost-recovery scenario would imply a negative selling price because the passed-on cost reduction exceeds the selling price. Revise the policy or cost-share basis." };
  const value = r1(raw);
  if (!Number.isFinite(value)) return { issue: "The cost-recovery calculation is not finite; revise the cost change or cost-share inputs." };
  return { value };
}

/** The cost share always uses the same selling price before the proposed price change. */
export function costScenario(req: Request, passThrough: number): number | undefined {
  return calculateCostScenario(req, passThrough).value;
}

export function costInputNeeded(req: Request, passThrough: number): string | undefined {
  return calculateCostScenario(req, passThrough).issue;
}

export function costShareBasisDescription(req: Request): string {
  return `unit cost ${req.costShareBasis === "after_change" ? "after" : "before"} the stated cost change / unchanged selling price${req.costShareBasis === undefined ? " (before-change basis assumed because timing was not specified)" : ""}`;
}

export function buildFacts(rows: Record<string, unknown>[], req: Request, cite: string, passThrough: number, now = new Date()): MarketFacts[] {
  return buildFactsForMethod(rows, req, cite, passThrough, now, false);
}

/** Replay method-2 packets exactly: their missing-category fallback is historical behavior, not a current recommendation. */
export function buildFactsLegacyV2(rows: Record<string, unknown>[], req: Request, cite: string, passThrough: number, now = new Date()): MarketFacts[] {
  return buildFactsForMethod(rows, req, cite, passThrough, now, true);
}

function buildFactsForMethod(rows: Record<string, unknown>[], req: Request, cite: string, passThrough: number, now: Date, legacyFallback: boolean): MarketFacts[] {
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  return req.countries.map((country) => {
    const mine = rows.filter((r) => r.country === country);
    const category = req.concept === "all_items" ? undefined : seriesFacts(mine.filter((r) => r.concept === req.concept));
    const allItems = seriesFacts(mine.filter((r) => r.concept === "all_items"));
    const main = legacyFallback ? category ?? allItems : req.concept === "all_items" ? allItems : category;
    const f: MarketFacts = { country, agency: AGENCY_FOR[country].name, category, allItems, cite };
    // Cost recovery is an independent calculation from the supplied cost inputs.
    // Method 2 only exposed it when some market series existed.
    if (!legacyFallback || main) f.costNeed = costScenario(req, passThrough);
    if (main) {
      f.monthsStale = nowIdx - periodIndex(main.latestPeriod);
      const { low: lo, high: hi } = marketBenchmark(main);
      f.suggested = { low: lo, high: hi, basis: `${main.label} historical market benchmark: latest ${main.latestYoy}% and average ${main.avg12}% (${main.averageLabel})` };
      if (req.proposedChangePct !== undefined) {
        const p = req.proposedChangePct;
        f.verdict = p > hi ? "above the market benchmark" : p < lo ? "below the market benchmark" : "within the market benchmark";
      }
      if (f.costNeed !== undefined) {
        f.costVsMarket = f.costNeed > hi ? "above the market benchmark" : f.costNeed < lo ? "below the market benchmark" : "within the market benchmark";
      }
    }
    return f;
  });
}

function requestedSeries(f: MarketFacts, req: Request): SeriesFacts | undefined {
  return req.concept === "all_items" ? f.allItems : f.category;
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
// "12 observations" / "12 of 12 monthly observations" is a count, checked against the series by observationCountErrors.
const stripWindows = (t: string) => t.replace(/\b(?:6|12)[- ]?(?:months?|periods?)\b|\b4[- ]?quarters?\b|\b\d{1,2}\s+(?:of\s+(?:the\s+)?\d{1,2}\s+)?(?:monthly\s+|quarterly\s+)?(?:observations?|readings?|data points?)\b/gi, " ");
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
function observedRateErrors(text: string, f: MarketFacts, req?: Request): string[] {
  const bad: string[] = [];
  for (const sentence of text.split(/(?<=[.!?;])\s+/)) {
    for (const m of sentence.matchAll(/(?<![\w.])([+−-]?\d+(?:\.\d+)?)\s*%/g)) {
      const before = sentence.slice(0, m.index);
      const after = sentence.slice(m.index! + m[0].length);
      const clause = before.split(/[,;]|\b(?:and|while|whereas|but)\b/i).at(-1)!;
      // User proposals and cost assumptions are not observations of consumer prices.
      if (/propos|cost|pass[ -]?through|recover|target|scenario/i.test(clause)) continue;
      const movement = clause.match(/\b(?:prices?\s+(?:have\s+|has\s+)?|prices?\s+(?:are|were)\s+)(rose|risen|increased|grew|up|fell|fallen|declined|decreased|dropped|down)(?:\s+by)?\s*$/i);
      const followsRate = /^\s*(?:YoY\b|year[ -]on[ -]year\b)/i.test(after);
      const precedesRate = /\b(?:inflation|YoY|year[ -]on[ -]year)(?:\s+(?:is|was|at|of|rate|stood|stands))*\s*$/i.test(clause);
      if (!movement && !followsRate && !precedesRate) continue;
      const allItemsMentioned = /all[ -]items|headline inflation/i.test(clause);
      const s = allItemsMentioned ? f.allItems : req ? requestedSeries(f, req) : f.category ?? f.allItems;
      if (!s) {
        if (req) bad.push(`observed rate unavailable for ${allItemsMentioned ? "all-items" : `requested category ${req.concept}`}: ${m[0]}`);
        continue;
      }
      const literal = Number(m[1].replace("−", "-"));
      const down = movement && /fell|fallen|declined|decreased|dropped|down/i.test(movement[1]);
      const stated = movement ? (down ? -Math.abs(literal) : Math.abs(literal)) : literal;
      const observed = /average|mean/i.test(clause) ? [s.avg12] : /\b(?:from|previous|earlier|ago)\b/i.test(clause) ? [s.latestYoy, s.avg12, s.yoy6Back].filter((x): x is number => x !== undefined) : [s.latestYoy];
      if (!observed.some((x) => near(x, stated))) bad.push(`observed rate contradicts the series: ${m[0]}`);
    }
  }
  return bad;
}

/** Narrow English claim checks for an absent requested series; this is not general semantic verification. */
function unavailableCategoryErrors(text: string, f: MarketFacts, req: Request): string[] {
  if (requestedSeries(f, req)) return [];
  const bad: string[] = [];
  for (const clause of text.split(/(?<=[.!?;])\s+|[,;]|\b(?:and|while|whereas|but)\b/i)) {
    for (const m of clause.matchAll(/\b(?:within|inside|above|exceeds?|exceeding|below|under|outside)\b[^.;!?%]{0,45}\b(?:benchmark|evidence|range)\b/gi)) {
      bad.push(`requested category ${req.concept} comparison unavailable: ${m[0]}`);
    }
    // Common numeric shorthand is still an observation/benchmark claim: e.g.
    // "Food CPI is 4%" or "Food inflation: 4%". Explicit all-items context is separate.
    if (!/all[ -]items|headline inflation/i.test(clause) && /\b(?:inflation|CPI|HICP|benchmark)\b\s*(?:(?:is|was|at|of|rate|stood|stands|remains?)\s+)*[:=]?\s*[+−-]?\d+(?:\.\d+)?\s*%/i.test(clause)) {
      bad.push(`requested category ${req.concept} numeric observation or benchmark unavailable: ${clause.trim()}`);
    }
    if (!/all[ -]items|headline inflation/i.test(clause) && /\b(?:inflation|prices?)\b\s+(?:(?:is|are|was|were|remains?|still|running)\s+)*(?:hot|high|low|rising|falling|easing|accelerating|elevated)\b/i.test(clause)) {
      bad.push(`requested category ${req.concept} observation unavailable: ${clause.trim()}`);
    }
  }
  return bad;
}

/** "Canadian data absent" for a market whose requested series is in the facts is false; product-level SKU omissions are not market data. */
function availableDataDenialErrors(text: string, f: MarketFacts, req: Request, facts: MarketFacts[] = [f]): string[] {
  const bad: string[] = [];
  for (const sentence of text.split(/(?<=[.!?;])\s+/)) {
    if (/\b(?:SKUs?|products?|price list)\b/i.test(sentence)) continue;
    // "CA data unavailable" next to DE and AU is about CA: a sentence naming another market is not this market's claim.
    if (countryMentions(sentence, facts).some((m) => m.country !== f.country)) continue;
    if (!/\b(?:data|CPI|HICP|inflation|series|benchmark|verdict|figures?|statistics|release)\b/i.test(sentence)) continue;
    // Where the requested series really is missing, a "no series" sentence is about it, even when it mentions all-items.
    if (!requestedSeries(f, req)) continue;
    const series = /all[ -]items|headline inflation/i.test(sentence) ? f.allItems : requestedSeries(f, req);
    if (!series) continue;
    const m = sentence.match(/\b(?:unavailable|not (?:yet )?available|absent|missing|failed to respond|did not respond|no\s+(?:[\w-]+\s+){0,2}(?:data|figures?|series|benchmark|verdict|release))\b/i);
    if (!m) continue;
    // "no separate condiments series", "a snacks-level series" and "no October 2026 data yet" / "no newer release"
    // are about a narrower category or a later period, not about this series.
    const claim = sentence.slice(0, m.index! + m[0].length);
    if (narrowerCategory(claim, req) || /\b(?:newer|later|next|more recent|upcoming)\b/i.test(claim) || laterPeriodNamed(claim, series.latestPeriod)) continue;
    bad.push(`data claimed missing although it is in the facts: ${m[0]}`);
  }
  return bad;
}

function narrowerCategory(text: string, req: Request): boolean {
  if (/\b(?:separate|specific|dedicated|narrower|detailed|sub-?categor\w*|[a-z]+-level)\b/i.test(text)) return true;
  const other = Object.entries(CONCEPT_WORDS).filter(([k]) => k !== req.concept && k !== "food" && k !== "all_items").flatMap(([, w]) => w);
  return other.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(text));
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Whether the text names a month or quarter after the series' latest observation ("October 2026", "2026-Q4"). */
function laterPeriodNamed(text: string, latest: string): boolean {
  const last = periodIndex(latest);
  if (Number.isNaN(last)) return false;
  const named = [
    ...[...text.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/gi)].map((m) => Number(m[2]) * 12 + MONTHS.indexOf(m[1].toLowerCase())),
    ...[...text.matchAll(/\b(\d{4})-(\d{2}|Q[1-4])\b/g)].map((m) => periodIndex(`${m[1]}-${m[2]}`)),
    ...[...text.matchAll(/\bQ([1-4])\s+(\d{4})\b/g)].map((m) => periodIndex(`${m[2]}-Q${m[1]}`)),
  ];
  return named.some((i) => i > last);
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

/** "Recovering costs requires a 3.4% price increase": the required change must be the computed cost target. */
function costTargetErrors(text: string, costNeeds: number[]): string[] {
  const bad: string[] = [];
  for (const sentence of text.split(/(?<=[.!?;])\s+/)) {
    if (!/\b(?:recover\w*|cover(?:s|ing)?\s+(?:\w+\s+){0,2}costs?|cost[ -]recovery)\b/i.test(sentence)) continue;
    for (const m of sentence.matchAll(/\b(?:requires?|needs?|needed|calls?\s+for|would\s+take)\s+(?:an?\s+)?(?:price\s+(?:increase|rise|change)\s+of\s+)?(?:about\s+|roughly\s+|around\s+|approximately\s+)?([+−-]?\d+(?:\.\d+)?)\s*%/gi)) {
      const stated = Number(m[1].replace("−", "-"));
      if (!costNeeds.some((x) => near(x, stated))) bad.push(costNeeds.length ? `cost target contradicts the computed ${costNeeds.map((x) => `${x}%`).join(" / ")}: ${m[0]}` : `cost target unavailable: ${m[0]}`);
    }
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
const EVERY_MARKET = /\b(?:all|every|each)\s+(?:(?:two|three|four|five|six|\d+)\s+)?(?:markets?|countries)\b|\bacross\s+(?:the\s+)?(?:(?:two|three|four|five|six|\d+)\s+)?(?:markets|countries)\b|\beverywhere\b/i;
// Trend verbs only: "a 5% price rise" or "increase" is the proposal, not a claim about inflation's direction.
const TREND_CLAIMS: [SeriesFacts["trend"], RegExp][] = [
  ["easing", /\b(?:eas(?:es|ed|ing)|cool(?:s|ed|ing)|slow(?:s|ed|ing)|decelerat\w*|soften(?:s|ed|ing))\b/i],
  ["rising", /\b(?:rising|accelerat\w*|heat(?:s|ed|ing)\s+up|pick(?:s|ed|ing)\s+up|climb(?:s|ed|ing))\b/i],
];

/** "Food inflation is easing in all three markets": a trend claimed for every market must be each market's computed trend. */
function universalTrendErrors(text: string, facts: MarketFacts[], req: Request, field: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?;])\s+|\n+/)) {
    // Negated, excepted or conditional sentences do not claim the trend for every market.
    if (/\b(?:not|never|except|apart from|other than|whether|if)\b|n't\b/i.test(sentence)) continue;
    // Per clause: "+5% is above the benchmark in all three markets, with inflation easing in Germany and Canada" is true.
    for (const clause of sentence.split(/[,;:—]|\b(?:but|while|whereas|so|despite|with)\b/i)) {
    if (!EVERY_MARKET.test(clause) || countryMentions(clause, facts).length) continue;
    for (const [trend, re] of TREND_CLAIMS) {
      if (!re.test(clause)) continue;
      if (trend === "rising" && /\b(?:costs?|prices?)\b/i.test(clause) && !/\binflation\b/i.test(clause)) continue; // prices rising = positive inflation
      const off = facts.flatMap((f) => { const s = requestedSeries(f, req); return s && s.trend !== trend ? [`${f.country} is ${s.trend}`] : []; });
      if (off.length) out.push(`${field}: says ${trend} in every market, but ${off.join(", ")}`);
    }
    }
  }
  return out;
}

/**
 * "Food inflation is above the market benchmark": a verdict is about the proposed change, never about inflation itself.
 * Only verbs, adverbs and market names may stand between "inflation" and the verdict ("Inflation in DE, CA and AU is
 * now above …"); "inflation leaves the proposed move above …" or "inflation of 2.2% is within …" are not this slip.
 */
const INFLATION_VERDICT = /\b[Ii]nflation\b((?:,?\s+(?:rates?|levels?|is|are|has|have|been|remains?|stays?|sits?|sitting|runs?|running|looks?|now|still|all|also|in|and|[A-Z]{2}|[A-Z][a-z]+))*)\s+(?:(above|within|inside|below)|(exceeds?|exceeding|tops))\s+(?:its\s+|the\s+|their\s+)?(?:market\s+)?benchmarks?\b/;
function verdictSubjectErrors(text: string, field: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/(?<=[.!?;])\s+|\n+|[;:—]/)) {
    const m = part.match(INFLATION_VERDICT);
    if (m) out.push(`${field}: says inflation itself is ${(m[2] ?? m[3]).toLowerCase()} the market benchmark; the verdict is about the proposed change`);
  }
  return out;
}

/** "… and 1 observation" about a series with 12: a stated observation count must be one of the market's series counts. */
function observationCountErrors(text: string, f: MarketFacts): string[] {
  const counts = [f.category?.averageCount, f.allItems?.averageCount].filter((n): n is number => n !== undefined);
  const out: string[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})\s+(?:of\s+(?:the\s+)?\d{1,2}\s+)?(?:monthly\s+|quarterly\s+)?(?:observations?|readings?|data points?)\b/gi)) {
    if (!counts.includes(Number(m[1]))) out.push(`${f.country}: says ${m[0]}, but the series ${counts.length === 1 ? "has" : "have"} ${counts.join(" and ") || "no"} observations`);
  }
  return out;
}

/** "a blanket +5% Q1 increase" when nobody said Q1: a quarter must come from the request or a quarterly period. */
function quarterErrors(text: string, facts: MarketFacts[], req: Request, field: string): string[] {
  if (/same as (?:last time|before)|지난번|저번/i.test(req.raw)) return []; // a follow-up may carry the earlier quarter
  const allowed = new Set([...req.raw.matchAll(/\bq([1-4])\b|([1-4])\s*분기/gi)].map((m) => m[1] ?? m[2]));
  for (const f of facts) for (const s of [f.category, f.allItems]) for (const p of [s?.latestPeriod, ...(s?.points ?? []).map((x) => x.period)]) {
    const q = String(p ?? "").match(/-Q([1-4])$/);
    if (q) allowed.add(q[1]);
  }
  const named = [...new Set([...text.matchAll(/\bQ([1-4])\b/g)].filter((m) => !allowed.has(m[1])).map((m) => m[0]))];
  return named.length ? [`${field}: mentions ${named.join(", ")}, which neither the request nor the data names`] : [];
}

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
      else if (universalClaim(text, c.at)) {
        // "in all three markets", "everywhere", "in each market": every market must have that verdict.
        const off = vf.filter((f) => { const v = c.subject === "cost" ? f.costVsMarket : f.verdict; return v && !c.verdicts.has(v); });
        if (off.length) bad.push(`${field} "${c.words.join(" or ")}" for every market (computed: ${off.map((f) => `${f.country} ${c.subject === "cost" ? f.costVsMarket : f.verdict}`).join(", ")})`);
      }
    }
    return bad;
  }
  // Clauses split at , ; : and contrast words: "DE above, CA and AU within" gives CA and AU the verdict after them
  // in their own clause; "above in DE and within in CA" keeps the verdict before each country.
  const cuts = [0, ...[...text.matchAll(/[,;:]|\b(?:but|while|whereas)\b/gi)].map((c) => c.index! + c[0].length), text.length];
  const clauseOf = (at: number) => { let i = 0; while (i < cuts.length - 2 && cuts[i + 1] <= at) i++; return [cuts[i], cuts[i + 1]] as const; };
  const verdictOf = (country: Country, c: (typeof claims)[number]) => { const f = vf.find((x) => x.country === country)!; return c.subject === "cost" ? f.costVsMarket : f.verdict; };
  const excepted = new Map<(typeof claims)[number], Set<Country>>();
  const bound = new Set<(typeof claims)[number]>();
  for (const m of mentions) {
    const [cs, ce] = clauseOf(m.at);
    const clause = text.slice(cs, ce);
    const inClause = claims.filter((c) => c.at >= cs && c.at < ce);
    // "Inflation easing in DE and CA; flat in AU; +3% above in DE …": a country in a trend clause with no verdict of
    // its own is described by that trend (checked separately), not by a verdict in a later clause.
    // The trend part runs to the next ";" or sentence end, so "easing in DE, CA and AU" covers all three.
    const segStart = Math.max(-1, ...[...text.slice(0, m.at).matchAll(/[;.!?](?=\s|$)/g)].map((x) => x.index!)) + 1;
    const segEnd = text.slice(m.at).search(/[;.!?](?=\s|$)/);
    const seg = text.slice(segStart, segEnd < 0 ? text.length : m.at + segEnd);
    const segHasClaim = claims.some((c) => c.at >= segStart && c.at < segStart + seg.length);
    if (!segHasClaim && !/:\s*$/.test(clause) && (TREND_CLAIMS.some(([, re]) => re.test(seg)) || /\b(?:flat|stable|steady)\b/i.test(seg))) continue;
    // "Canada and Australia: within" takes the verdict after the colon; "fits Canada and Australia but exceeds
    // Germany's" says these countries do NOT have the verdict after the contrast word.
    const next = claims.find((c) => c.at >= ce);
    let owner = inClause.length
      ? [...inClause].reverse().find((c) => c.at < m.at) ?? inClause[0]
      : /:\s*$/.test(clause) && next ? next : [...claims].reverse().find((c) => c.at < m.at) ?? claims[0];
    let negated = !inClause.length && !!next && /\b(?:but|while|whereas)\s*$/i.test(clause);
    if (negated) owner = next!;
    // "within in all markets except Germany": the excepted country does not have that verdict.
    if (owner.at < m.at && /\b(?:except|other than|apart from|besides|excluding)\b/i.test(text.slice(Math.max(cs, owner.end), m.at))) {
      negated = true;
      excepted.set(owner, (excepted.get(owner) ?? new Set()).add(m.country));
    }
    bound.add(owner);
    const verdict = verdictOf(m.country, owner);
    const ok = negated ? !!verdict && !owner.verdicts.has(verdict) : !!verdict && owner.verdicts.has(verdict);
    if (!ok) bad.push(`${field} "${owner.words.join(" or ")}"${negated ? " excludes" : " for"} ${m.country} (computed: ${verdict})`);
  }
  // A verdict in a part of the headline that names no market ("…; flat in AU; +5% is within the market benchmark")
  // speaks for every market.
  const segmentOf = (at: number) => {
    const start = Math.max(-1, ...[...text.slice(0, at).matchAll(/[;.!?](?=\s|$)/g)].map((x) => x.index!)) + 1;
    const end = text.slice(at).search(/[;.!?](?=\s|$)/);
    return [start, end < 0 ? text.length : at + end] as const;
  };
  for (const c of claims.filter((x) => !bound.has(x))) {
    const [ss, se] = segmentOf(c.at);
    if (mentions.some((m) => m.at >= ss && m.at < se)) continue;
    const off = vf.filter((f) => { const v = verdictOf(f.country, c); return v && !c.verdicts.has(v); });
    if (off.length) bad.push(`${field} "${c.words.join(" or ")}" for every market (computed: ${off.map((f) => `${f.country} ${verdictOf(f.country, c)}`).join(", ")})`);
  }
  // "... in all markets except Germany": every other market must have that verdict.
  for (const [c, out] of excepted) {
    if (!universalClaim(text, c.at)) continue;
    const off = vf.filter((f) => !out.has(f.country) && !c.verdicts.has(verdictOf(f.country, c) ?? ""));
    if (off.length) bad.push(`${field} "${c.words.join(" or ")}" for every other market (computed: ${off.map((f) => `${f.country} ${verdictOf(f.country, c)}`).join(", ")})`);
  }
  return [...new Set(bad)];
}

/** Whether the sentence holding a verdict word quantifies over every market ("all three", "both", "everywhere", "each", "across"). */
function universalClaim(text: string, at: number): boolean {
  // A decimal point ("3.4%") does not end a sentence.
  const bounds = [...text.matchAll(/[.!?;](?=\s|$)/g)].map((m) => m.index!);
  const start = (bounds.filter((i) => i < at).at(-1) ?? -1) + 1;
  const sentence = text.slice(start, bounds.find((i) => i >= at) ?? text.length);
  return /\b(?:all(?![ -](?:items|groups))|both|every(?:where)?|each|across)\b/i.test(sentence);
}

/** A bare number from the check ("3.4", "CA: 3.0") reads as a reason. */
function plainProblem(p: string): string {
  const m = p.match(/^(?:([A-Z]{2}): )?([+−-]?\d+(?:\.\d+)?)$/);
  return m ? `${m[1] ? `${m[1]}: ` : ""}${m[2]} is not among the computed figures${m[1] ? ` for ${m[1]}` : ""}` : p;
}

/**
 * Keep the sentences of a failed draft that pass the same checks on their own, when the remainder also passes
 * as a whole. A failed headline is dropped whole (the brief then shows the code headline). Returns undefined
 * when no market paragraph survives, so the brief falls back to the computed summary.
 */
export function salvageNarrative(n: Narrative, allowed: number[], facts: MarketFacts[], req: Request, policy?: number, extra: number[] = []): Narrative | undefined {
  const placeholder = "Historical market comparison";
  const check = (part: Partial<Narrative>) => checkNarrative({ headline: placeholder, markets: {}, ...part }, allowed, facts, req, policy, extra);
  const removed: RemovedSentence[] = [];
  const keep = (field: string, text: string, wrap: (t: string) => Partial<Narrative>) =>
    text.split(/(?<=[.!?])\s+/).filter((sentence) => {
      if (!sentence.trim()) return false;
      const problems = check(wrap(sentence));
      if (problems.length) removed.push({ field, sentence, problems: problems.map(plainProblem) });
      return !problems.length;
    }).join(" ");
  let headline = typeof n.headline === "string" && n.headline.trim() ? n.headline : undefined;
  if (headline !== undefined) {
    const problems = check({ headline });
    if (problems.length) {
      removed.push({ field: "headline", sentence: headline, problems: problems.map(plainProblem) });
      headline = undefined;
    }
  }
  const markets: Record<string, string> = {};
  for (const [code, text] of Object.entries(n.markets ?? {})) {
    if (typeof text !== "string") continue;
    const kept = keep(code, text, (t) => ({ markets: { [code]: t } }));
    if (kept) markets[code] = kept;
  }
  const watch = typeof n.watch === "string" ? keep("watch", n.watch, (t) => ({ watch: t })) : "";
  if (!Object.keys(markets).length) return undefined;
  const out: Narrative = { headline: headline ?? placeholder, markets, ...(watch ? { watch } : {}) };
  if (checkNarrative(out, allowed, facts, req, policy, extra).length) return undefined;
  return { ...out, headline: headline ?? "", ...(headline === undefined ? { headlineByCode: true } : {}), removed, ...(n.model ? { model: n.model } : {}) };
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
  german: "DE", australian: "AU", aussie: "AU", canadian: "CA", french: "FR", italian: "IT", spanish: "ES", belgian: "BE",
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
      // "Re-check Canada's release, and re-check Australia's 3.0% pace": a comma or semicolon followed by a
      // new clause also separates the claims, so the later rate is not charged to the earlier country.
      // "whether Germany's easing continues and whether Australia's 3% trend breaks" is two clauses as well.
      const separate = hasNumber(between) || /(?:,\s*(?:and|but|while|whereas)\b|;|\b(?:and|or)\s+(?:whether|if)\b)/i.test(between) || (hasNumber(sentence.slice(cuts.at(-1), previous.at)) && hasNumber(sentence.slice(next.end)));
      if (!separate) continue;
      const boundary = [...between.matchAll(/[,;]|\b(?:and|or)\s+(?:whether|if)\b|\b(?:and|but|while|whereas|compared\s+with)\b/gi)].at(-1);
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
          ...observedRateErrors(clause, f, req),
          ...unavailableCategoryErrors(clause, f, req),
          ...availableDataDenialErrors(clause, f, req, facts),
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
  const keys = /(?<![\p{L}\p{N}])(?:benchmark_range_pct|suggested_range_pct|benchmark_basis|proposed_change_pct|pass_through_pct|pass_through_needed_pct|cost_need_pct|cost_vs_market|cost_share_pct|cost_share_basis|cost_increase_pct|cost_pass_through_pct|cost_input_needed|cost_scenario|sku_price_notes|requested_category_available|requested_category|all_items_context_only|coverage_note|latestPeriod|latestYoy|avg12|yoy6Back|monthsStale|averageCount|averageExpected|averageLabel|allItems)(?![\p{L}\p{N}])/giu;
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
      bad.push(...costPolicyErrors(text, f?.costNeed !== undefined));
      bad.push(...costTargetErrors(text, f?.costNeed !== undefined ? [f.costNeed] : []));
      bad.push(...namedCountryErrors(text, facts, req, policy, extra));
      if (f) bad.push(...rangeErrors(text, f), ...verdictErrors(text, f), ...observedRateErrors(text, f, req), ...unavailableCategoryErrors(text, f, req), ...availableDataDenialErrors(text, f, req, facts), ...observationCountErrors(text, f));
    }
    if (typeof n.headline !== "string" || (n.watch !== undefined && typeof n.watch !== "string")) bad.push("headline or watch: not text");
    const general = [n.headline, n.watch ?? ""].join(" ");
    const coverage = checkCoverage(general, facts);
    bad.push(...coverage.errors, ...unknownNumbers(coverage.text, allowed));
    bad.push(...explicitSignErrors(general, facts.flatMap((f) => marketNumbers(f, req, policy, true))));
    bad.push(...unsupportedClaims(general));
    for (const text of [n.headline, n.watch]) if (typeof text === "string") bad.push(...costPolicyErrors(text, facts.some(f => f.costNeed !== undefined)));
    for (const text of [n.headline, n.watch]) if (typeof text === "string") bad.push(...costTargetErrors(text, [...new Set(facts.flatMap((f) => f.costNeed !== undefined ? [f.costNeed] : []))]));
    for (const text of [n.headline, n.watch]) if (typeof text === "string") bad.push(...namedCountryErrors(text, facts, req, policy, extra));
    if (facts.length === 1) bad.push(...rangeErrors(general, facts[0]), ...verdictErrors(general, facts[0]), ...observedRateErrors(general, facts[0], req));
    // A countryless statement cannot borrow another market's coverage. Explicit
    // country clauses are checked above against only the market they name.
    for (const sentence of general.split(/(?<=[.!?;])\s+|\n+/)) {
      if (countryMentions(sentence, facts).length) continue;
      for (const f of facts.filter(f => !requestedSeries(f, req))) bad.push(...observedRateErrors(sentence, f, req), ...unavailableCategoryErrors(sentence, f, req));
    }
    bad.push(...headlineVerdictErrors(String(n.headline ?? ""), facts));
    if (typeof n.watch === "string") bad.push(...headlineVerdictErrors(n.watch, facts, "watch"));
    for (const [field, text] of [["headline", n.headline], ["watch", n.watch], ...Object.entries(n.markets ?? {})] as [string, unknown][]) {
      if (typeof text === "string") bad.push(...universalTrendErrors(text, facts, req, field), ...quarterErrors(text, facts, req, field), ...verdictSubjectErrors(text, field));
    }
  } else {
    bad.push(...unknownNumbers([n.headline, ...Object.values(n.markets ?? {}), n.watch ?? ""].join(" "), allowed));
  }
  return [...new Set(bad)];
}

/** What the narrative model sees: the facts without the monthly history, so it cannot pick a stray number. */
/** What every market benchmark means; sent once with the narrative facts rather than per market. */
export const BENCHMARK_BASIS = "latest YoY and available-observation mean in the year ending at the latest observation; historical reference only, not a forecast, confidence interval or evidence of customer acceptance";

/**
 * What the headline must agree with, grouped the way a headline says it: "+5% is above the market benchmark in DE, CA
 * and AU. Inflation trend: easing in DE and CA; flat in AU." Nemotron's rejected headlines on 27 Oct merged differing
 * verdicts ("within or below everywhere") or trends ("easing in all three markets"), or made inflation the subject of
 * the verdict; this line states both with the proposal as the subject.
 */
export function headlineFacts(facts: MarketFacts[], req: Request): string | undefined {
  const verdicts = new Map<string, string[]>();
  const trends = new Map<string, string[]>();
  for (const f of facts) {
    const s = requestedSeries(f, req);
    if (!s) continue;
    if (f.verdict) verdicts.set(f.verdict, [...(verdicts.get(f.verdict) ?? []), f.country]);
    trends.set(s.trend, [...(trends.get(s.trend) ?? []), f.country]);
  }
  const list = (c: string[]) => (c.length > 1 ? `${c.slice(0, -1).join(", ")} and ${c.at(-1)}` : c[0]);
  const parts: string[] = [];
  if (req.proposedChangePct !== undefined && verdicts.size) parts.push(`${signedPct(req.proposedChangePct)} is ${[...verdicts].map(([v, c]) => `${v} in ${list(c)}`).join("; ")}.`);
  if (trends.size) parts.push(`Inflation trend: ${[...trends].map(([t, c]) => `${t} in ${list(c)}`).join("; ")}.`);
  return parts.length ? parts.join(" ") : undefined;
}

export function factsForNarrative(facts: MarketFacts[], req?: Request, policy?: number): unknown[] {
  const slim = (s?: SeriesFacts) => (s ? { label: s.label, frequency: s.frequency, latestPeriod: s.latestPeriod, latestYoy: s.latestYoy, avg12: s.avg12, averageCount: s.averageCount, averageExpected: s.averageExpected, averageLabel: s.averageLabel, yoy6Back: s.yoy6Back, trend: s.trend } : undefined);
  return facts.map((f) => ({
    country: f.country, agency: f.agency, category: slim(f.category), allItems: slim(f.allItems), monthsStale: f.monthsStale,
    ...(req ? { requested_category: req.concept, requested_category_available: !!requestedSeries(f, req), all_items_context_only: req.concept !== "all_items" && !!f.allItems } : {}),
    benchmark_range_pct: f.suggested ? { low: f.suggested.low, high: f.suggested.high } : undefined,
    ...(!req || requestedSeries(f, req) ? {} : { coverage_note: "The requested category is unavailable. Do not state its inflation, benchmark or proposal/cost verdict. Any all-items observations are context only; cost recovery can still be calculated independently." }),
    verdict: f.verdict,
    ...(f.costNeed !== undefined && !req?.invalidPassThrough ? {
      cost_need_pct: f.costNeed, cost_vs_market: f.costVsMarket,
      cost_share_pct: req?.costSharePct, cost_share_basis: req ? costShareBasisDescription(req) : undefined,
      cost_increase_pct: req?.costIncreasePct, cost_pass_through_pct: policy === undefined ? undefined : Math.round(policy * 100),
    } : {}),
    ...(req?.costIncreasePct !== undefined && f.costNeed === undefined ? {
      cost_input_needed: costInputNeeded(req, policy ?? 1),
    } : {}),
  }));
}

/** One line per market for the same caveat about different categories ("condiments" and "snacks" at the Food level). */
export function mergeNotes(notes: string[]): string[] {
  const out: string[] = [];
  const groups = new Map<string, string[]>();
  // A market-level caveat ("DE: … discontinued …") is not repeated inside that market's category notes
  // ("DE snacks: … discontinued … proxy …"); category-specific sentences stay.
  const sentences = (body: string) => body.split(/(?<=\.)\s+(?=[A-Z])/).map((x) => x.trim());
  const marketLevel = new Map<string, Set<string>>();
  for (const n of new Set(notes)) {
    const m = n.match(/^([A-Z]{2}): (.*)$/s);
    if (m) for (const x of sentences(m[2])) (marketLevel.get(m[1]) ?? marketLevel.set(m[1], new Set()).get(m[1])!).add(x);
  }
  const unique = [...new Set(notes)].flatMap((n) => {
    const m = n.match(/^([A-Z]{2}) ([a-z_]+): (.*)$/s);
    if (!m) return [n];
    const kept = sentences(m[3]).filter((x) => !marketLevel.get(m[1])?.has(x));
    return kept.length ? [`${m[1]} ${m[2]}: ${kept.join(" ")}`] : [];
  });
  for (const n of unique) {
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
  const missing = b.facts.filter(f => !requestedSeries(f, b.request));
  const unavailable = missing.length ? `${missing.map(f => f.country).join(", ")}: requested category (${b.request.concept}) unavailable.${missing.some(f => f.allItems) ? " All-items observations are context only." : " No market benchmark is available."}` : "";
  if (p !== undefined && withVerdict.length) {
    const groups = new Map<string, string[]>();
    for (const f of withVerdict) groups.set(f.verdict!, [...(groups.get(f.verdict!) ?? []), f.country]);
    return `${signedPct(p)} is ${[...groups.entries()].map(([v, cs]) => `${v} in ${cs.length > 1 ? `${cs.slice(0, -1).join(", ")} and ${cs.at(-1)}` : cs[0]}`).join("; ")}.${unavailable ? ` ${unavailable}` : ""}`;
  }
  const parts = b.facts.flatMap(f => { const s = requestedSeries(f, b.request); return s ? [`${f.country} ${fmt(s.latestYoy)}`] : []; });
  return [parts.length ? `Latest year-on-year rates: ${parts.join(", ")}.` : "", unavailable].filter(Boolean).join(" ") || undefined;
}

/** How far the proposal sits from each market's benchmark, and from the cost-recovery scenario: computed from the same facts. */
export function gapSummary(b: Brief): string | undefined {
  const p = b.request.proposedChangePct;
  if (p === undefined) return undefined;
  const pp = (x: number) => (Math.abs(x) < 0.05 ? "<0.1" : Math.abs(r1(x)).toFixed(1));
  const parts: string[] = [];
  for (const f of b.facts) {
    if (!f.suggested || !f.verdict || !requestedSeries(f, b.request)) continue;
    const { low, high } = f.suggested;
    const first = !parts.length;
    const name = first ? `the ${f.country} benchmark` : f.country;
    if (f.verdict === "above the market benchmark") parts.push(`${pp(p - high)} pp above ${name}${first ? " top" : ""} (${high.toFixed(1)}%)`);
    else if (f.verdict === "below the market benchmark") parts.push(`${pp(low - p)} pp below ${name}${first ? " bottom" : ""} (${low.toFixed(1)}%)`);
    else parts.push(`within ${name} (${benchmarkText({ low, high })})`);
  }
  if (!parts.length) return undefined;
  const need = b.facts.find((f) => f.costNeed !== undefined)?.costNeed;
  const cost = need === undefined ? "" : ` Your cost-recovery scenario is ${signedPct(need)}: ${signedPct(p)} ${Math.abs(p - need) < 0.05 ? "matches it" : `is ${pp(p - need)} pp ${p > need ? "more" : "less"}`}.`;
  return `How far: ${signedPct(p)} is ${parts.join(", ")}.${cost}`;
}

// Official food indices that count restaurant and take-away meals (StatCan Food includes "Food purchased from
// restaurants"; ABS Food and non-alcoholic beverages includes "Meals out and take away foods") and the one that does
// not (Eurostat COICOP 01; restaurants sit in division 11).
const FOOD_BASKETS: { re: RegExp; label: string; restaurants: boolean }[] = [
  { re: /^statcan:18100004:v41690974$/, label: "StatCan Food", restaurants: true },
  { re: /^abs:CPI:1\.20001\./, label: "ABS Food and non-alcoholic beverages", restaurants: true },
  { re: /^eurostat:prc_hicp_\w+:CP01:/, label: "Eurostat Food and non-alcoholic beverages", restaurants: false },
];

/** Says which food series include restaurant meals when one comparison mixes the two kinds; otherwise undefined. */
export function basketNote(facts: MarketFacts[], req: Request): string | undefined {
  if (req.concept === "all_items") return undefined;
  const groups = new Map<string, { restaurants: boolean; countries: string[] }>();
  for (const f of facts) {
    const id = requestedSeries(f, req)?.sourceId;
    const kind = id ? FOOD_BASKETS.find((k) => k.re.test(id)) : undefined;
    if (!kind) continue;
    const g = groups.get(kind.label) ?? { restaurants: kind.restaurants, countries: [] };
    g.countries.push(f.country);
    groups.set(kind.label, g);
  }
  const side = (restaurants: boolean) => [...groups].filter(([, g]) => g.restaurants === restaurants);
  const [inc, exc] = [side(true), side(false)];
  if (!inc.length || !exc.length) return undefined;
  const names = (xs: typeof inc) => xs.map(([label, g]) => `${g.countries.join(" and ")} (${label})`).join(" and ");
  const count = (xs: typeof inc) => xs.reduce((n, [, g]) => n + g.countries.length, 0);
  return `Basket note: the ${names(inc)} series ${count(inc) > 1 ? "include" : "includes"} restaurant and take-away meals; the ${names(exc)} series ${count(exc) > 1 ? "do" : "does"} not (HICP counts restaurants separately).`;
}

/**
 * Which change would sit inside every market benchmark: the common range, or, when the benchmarks do not overlap,
 * the two markets that disagree and each market's top. It restates benchmark ends; it is not a recommended price.
 */
export function fitSummary(b: Brief): string | undefined {
  const items = b.facts.filter((f) => f.suggested && requestedSeries(f, b.request));
  if (items.length < 2 || items.length < b.request.countries.length) return undefined;
  const pct = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}%`;
  const top = items.reduce((a, f) => (f.suggested!.high < a.suggested!.high ? f : a));
  const bottom = items.reduce((a, f) => (f.suggested!.low > a.suggested!.low ? f : a));
  const lo = bottom.suggested!.low, hi = top.suggested!.high;
  if (lo <= hi) return `Within every market benchmark: ${lo === hi ? pct(lo) : `${pct(lo)} to ${pct(hi)}`}.`;
  return `No single change is within every market benchmark: the ${top.country} top (${hi.toFixed(1)}%) is below the ${bottom.country} bottom (${lo.toFixed(1)}%). Highest change within each: ${items.map((f) => `${f.country} ${pct(f.suggested!.high)}`).join(", ")}.`;
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
  // The answer comes first, computed from the verdicts; the model's headline is quoted under it.
  const modelHeadline = b.narrative?.headlineByCode ? undefined : b.narrative?.headline;
  const headline = fallbackHeadline(b) ?? modelHeadline;
  if (headline) L.push(`**${headline}**`, "");
  const gap = gapSummary(b);
  if (gap) L.push(gap, "");
  const fit = b.facts.length ? fitSummary(b) : undefined;
  if (fit) L.push(fit, "");
  if (modelHeadline && modelHeadline !== headline) L.push(`> Nemotron: ${modelHeadline}`, "");
  L.push(`${req.invalidPassThrough ? "Cost policy unavailable: provide a valid pass-through percentage from 0% to 100%" : `Cost policy: recover ${Math.round(b.passThrough * 100)}% of incremental unit cost${b.policySource ? ` (${b.policySource})` : ""}`}${req.proposedChangePct !== undefined ? ` · proposed change: ${signedPct(req.proposedChangePct)}` : ""}. ${req.costIncreasePct === undefined && !req.invalidPassThrough ? "Add your cost change and unit-cost share (for example “costs rose 8%, unit costs are 60% of our selling price”) to turn this policy into a cost-recovery target." : "This policy does not scale the market benchmark."}`, "");
  if (req.costIncreasePct !== undefined) {
    const need = costScenario(req, b.passThrough);
    L.push(`Your unit costs: ${signedPct(req.costIncreasePct)} (${req.costRemembered ? "remembered from your last request" : "stated in this request"}). ${need === undefined ? `Cost-recovery price scenario unavailable. ${costInputNeeded(req, b.passThrough)}` : `Cost share is ${req.costSharePct}%: ${costShareBasisDescription(req)}${req.costShareRemembered ? " (remembered)" : ""}; recovering ${Math.round(b.passThrough * 100)}% of the incremental cost gives a ${signedPct(need)} selling-price scenario.`}`, "");
  }
  L.push(`The historical market benchmark spans the latest YoY rate and the mean of available observations in the year ending at the latest observation. It is not a forecast, a confidence interval or evidence that customers will accept a price change. A single value is a reference point, not a recommended price. It compares a one-off price change with about a year of consumer-price growth; if your last increase was longer ago, the comparable growth is larger. Exchange-rate moves are not included.`, "");
  const basket = basketNote(b.facts, req);
  if (basket) L.push(basket, "");
  L.push(`| Market | Official category | Latest period | YoY | Available-year average | Trend vs. 6 months ago | All-items YoY | Market benchmark | Proposed change |`);
  L.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const f of b.facts) {
    const s = requestedSeries(f, req);
    const context = f.allItems && req.concept !== "all_items" ? `${fmt(f.allItems.latestYoy)} (All-items context only; ${f.allItems.latestPeriod})` : fmt(f.allItems?.latestYoy);
    L.push(
      `| ${f.country} (${f.agency}) | ${s?.label ?? `${req.concept} unavailable`} | ${s?.latestPeriod ?? "-"}${f.monthsStale !== undefined && f.monthsStale > 2 ? ` ⚠ ${f.monthsStale} mo old` : ""} | ${fmt(s?.latestYoy)} | ${fmt(s?.avg12)}${s ? ` (${s.averageLabel ?? "available observations"})` : ""} | ${s?.trend ?? "-"} | ${context} | ${f.suggested ? benchmarkText(f.suggested) : "-"} | ${f.verdict ?? "-"} |`,
    );
  }
  L.push("", `Every rate above comes from Zetaris query **${b.compared.id}** (one federated SQL over the onboarded sources); market benchmarks and comparisons are computed in code from those rates.`, "");
  if (b.alignment && b.alignment.requestedCountries.length >= 2) {
    const a = b.alignment;
    L.push("## Same-period comparison", "");
    if (a.status === "unavailable") L.push(a.reason, "");
    else {
      const cell = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/`/g, "\\`");
      L.push(`Latest common observation: **${a.period}** (${a.frequency === "Q" ? "quarterly" : "monthly"}; ${plural(a.monthsOld, "month")} before this brief). ${a.note}`, "");
      L.push("| Market | Selected official category | Common-period YoY | Latest observation | Source |", "|---|---|---|---|---|");
      for (const row of a.rows) L.push(`| ${row.country} | ${cell(row.label)} | ${fmt(r1(row.yoy))} | ${row.latestPeriod}: ${fmt(row.latestYoy)} | ${cell(row.sourceId)} · ${a.cite} |`);
      L.push("", "The latest-period market benchmarks and SKU price scenarios remain unchanged. This table aligns observation dates only.", "");
    }
  }
  if (b.skus?.length) {
    const money = (x: number | undefined, c: string) => (x === undefined ? "-" : `${x.toFixed(2)} ${c}`);
    L.push(`## Your price list`);
    const perSku = b.skus.some((s) => s.rateLabel);
    L.push(perSku
      ? `Internal SKUs (Zetaris view \`psig.${priceView()}\`) joined in query **${b.pricingQuery?.id}** with official category series for the products in each market; broader proxies are marked. Each SKU's benchmark price scenario applies its selected series' historical rates to its current price, computed in code.`
      : `Internal SKUs (Zetaris view \`psig.${priceView()}\`) joined with the latest official category rate in query **${b.pricingQuery?.id}**.`, "");
    L.push(`| SKU | Product | Market | Current price | Benchmark price scenario | At ${req.proposedChangePct !== undefined ? signedPct(req.proposedChangePct) : "-"} | Rate used |`);
    L.push(`|---|---|---|---|---|---|---|`);
    for (const s of b.skus) L.push(`| ${s.sku} | ${s.product} | ${s.country} | ${money(s.currentPrice, s.currency)} | ${s.low !== undefined ? `${s.low.toFixed(2)}–${money(s.high, s.currency)}${s.rangeLow !== undefined ? ` (${s.rangeLow > 0 ? "+" : ""}${s.rangeLow.toFixed(1)}–${s.rangeHigh!.toFixed(1)}%)` : ""}` : "-"} | ${money(s.atProposed, s.currency)}${s.verdict ? ` (${s.verdict})` : ""} | ${fmt(s.yoy)} ${s.period}${s.rateLabel ? ` · ${s.rateLabel}${s.selectionSource ? ` (${s.selectionFit === "broader" ? "broader proxy" : "product match"}; ${s.selectionSource === "fallback" && /only candidate/.test(s.selectionReason ?? "") ? "only official option" : { model: "model-selected", memory: "remembered match", fallback: "unconfirmed match" }[s.selectionSource]})` : s.coarser ? " (coarser)" : ""}` : ""} |`);
    L.push("");
  }
  L.push(`## By market`);
  for (const f of b.facts) {
    const s = requestedSeries(f, req);
    const prose = b.narrative?.markets?.[f.country];
    L.push(`### ${f.country} — ${f.agency}`);
    L.push(prose ?? (s ? `${s.label}: ${fmt(s.latestYoy)} year on year in ${s.latestPeriod} (${s.trend} vs. six months ago; average ${fmt(s.avg12)}, ${s.averageLabel ?? "available observations"}). Historical market benchmark ${f.suggested ? benchmarkText(f.suggested) : "unavailable"}.` : `Requested category (${req.concept}) unavailable; no market benchmark or proposal/cost comparison is available.`));
    if (s) L.push(`<sub>source: \`${s.sourceId}\` · ${s.frequency === "Q" ? "quarterly" : "monthly"} · cite ${f.cite}</sub>`);
    else if (f.allItems) {
      const context = f.allItems;
      L.push(`All-items context only: ${context.label}, ${fmt(context.latestYoy)} year on year in ${context.latestPeriod}; it does not supply the requested ${req.concept} benchmark.`);
      L.push(`<sub>context source: \`${context.sourceId}\` · ${context.frequency === "Q" ? "quarterly" : "monthly"} · cite ${f.cite}</sub>`);
    }
    L.push("");
  }
  const costed = b.facts.filter((f) => f.costVsMarket && f.suggested);
  if (costed.length) {
    L.push(`## Costs vs. the market`);
    L.push(`Compare the cost-recovery price scenario with the historical movement of consumer prices. Neither establishes demand, competitor responses or a profit-maximizing price.`, "");
    for (const f of costed) {
      const s = (f.category ?? f.allItems)!;
      const range = benchmarkText(f.suggested!);
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
  const removed = b.narrative?.removed ?? [];
  if (removed.length) {
    L.push(`## Fact check`, `Fact check removed ${removed.length} sentence${removed.length === 1 ? "" : "s"} from Nemotron's draft because ${removed.length === 1 ? "it" : "they"} contradicted the computed facts${b.narrative?.headlineByCode ? "; the headline above is computed in code" : ""}. The remaining sentences passed the same checks.`, "");
    for (const r of removed) L.push(`- ${r.field}: ~~${r.sentence.replace(/~/g, "")}~~ — ${r.problems.slice(0, 2).join("; ")}`);
    L.push("");
  }
  L.push(`## Evidence`);
  L.push(`Views: ${b.views.map((v) => `\`psig.${v.view}\` (${v.via})`).join(", ")}`, "");
  for (const q of b.sqlLog.filter((q) => q.id === b.compared.id || q.id === b.pricingQuery?.id || /^SELECT COUNT/.test(q.sql))) {
    L.push(`<details><summary>${q.id} · ${plural(q.rows.length, "row")} · ${q.ms} ms</summary>\n\n\`\`\`sql\n${q.sql}\n\`\`\`\n</details>`);
  }
  if (!b.narrative) L.push("", `_Narrative omitted: ${b.narrativeIssue ? NARRATIVE_ISSUE[b.narrativeIssue] : "the model's text was not available"}, so only computed facts are shown._`);
  return L.join("\n");
}
