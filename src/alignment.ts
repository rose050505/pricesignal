import type { Request } from "./agent.ts";
import type { MarketFacts, SeriesFacts } from "./brief.ts";
import type { Country } from "./sources/types.ts";

interface AlignmentBase {
  concept: string;
  requestedCountries: Country[];
  cite: string;
}

export type PeriodAlignment = (AlignmentBase & {
  status: "aligned";
  period: string;
  frequency: "M" | "Q";
  monthsOld: number;
  rows: {
    country: Country;
    label: string;
    sourceId: string;
    /** The raw observed rate; renderers round for display. */
    yoy: number;
    latestPeriod: string;
    latestYoy: number;
  }[];
  note: string;
}) | (AlignmentBase & {
  status: "unavailable";
  reason: string;
});

function periodMonth(period: unknown, frequency: "M" | "Q"): number | undefined {
  if (typeof period !== "string") return undefined;
  const match = frequency === "M" ? period.match(/^(\d{4})-(0[1-9]|1[0-2])$/) : period.match(/^(\d{4})-Q([1-4])$/);
  if (!match) return undefined;
  return Number(match[1]) * 12 + Number(match[2]) * (frequency === "Q" ? 3 : 1) - 1;
}

/** Align dates within the observed query result, without changing latest-release facts. */
export function buildAlignment(rows: Record<string, unknown>[], req: Request, facts: MarketFacts[], cite: string, now = new Date()): PeriodAlignment {
  const requestedCountries = [...new Set(req.countries)];
  const base: AlignmentBase = { concept: req.concept, requestedCountries, cite };
  const unavailable = (reason: string): PeriodAlignment => ({ ...base, status: "unavailable", reason });
  if (requestedCountries.length < 2) return unavailable("At least two distinct requested markets are needed for a common-period comparison.");

  const selected: { country: Country; series: SeriesFacts; observations: Map<string, number> }[] = [];
  for (const country of requestedCountries) {
    const countryFacts = facts.filter(f => f.country === country);
    if (countryFacts.length > 1) return unavailable(`Conflicting market facts for ${country}; a single official source must be identified.`);
    const market = countryFacts[0];
    const series = market?.category ?? market?.allItems;
    if (!series || series.concept !== req.concept) return unavailable(`Missing ${req.concept} series for ${country}; a different category cannot fill this comparison.`);
    if (!series.sourceId?.trim()) return unavailable(`Missing source identity for ${country} ${req.concept}.`);
    if (series.frequency !== "M" && series.frequency !== "Q") return unavailable(`Unsupported source frequency for ${country} ${req.concept}.`);
    selected.push({ country, series, observations: new Map() });
  }

  const frequency = selected[0].series.frequency as "M" | "Q";
  if (selected.some(s => s.series.frequency !== frequency)) return unavailable("Mixed monthly and quarterly sources cannot be aligned without changing their measurement periods.");
  const nowMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  if (!Number.isFinite(nowMonth)) return unavailable("The current date is invalid, so future observations cannot be excluded reliably.");

  for (const item of selected) {
    for (const row of rows) {
      if (row.country !== item.country || row.concept !== req.concept || row.source_id !== item.series.sourceId || row.frequency !== frequency) continue;
      const month = periodMonth(row.period, frequency);
      if (month === undefined || month > nowMonth) continue;
      const rawRate = row.yoy_pct;
      if (typeof rawRate !== "number" && (typeof rawRate !== "string" || rawRate.trim() === "")) continue;
      const rate = Number(rawRate);
      if (!Number.isFinite(rate)) continue;
      const period = row.period as string;
      if (item.observations.has(period) && item.observations.get(period) !== rate) return unavailable(`Conflicting observations for ${item.country} in ${period}; a common-period comparison would be ambiguous.`);
      item.observations.set(period, rate);
    }
    if (!item.observations.size) return unavailable(`No valid observed ${req.concept} periods for ${item.country} from the selected source.`);
  }

  const commonPeriods = [...selected[0].observations.keys()].filter(period => selected.every(s => s.observations.has(period)));
  if (!commonPeriods.length) return unavailable("No common observed period exists across all requested markets in this query result.");
  commonPeriods.sort((a, b) => periodMonth(b, frequency)! - periodMonth(a, frequency)!);
  const period = commonPeriods[0];
  return {
    ...base,
    status: "aligned",
    period,
    frequency,
    monthsOld: nowMonth - periodMonth(period, frequency)!,
    rows: selected.map(({ country, series, observations }) => ({
      country,
      label: series.label,
      sourceId: series.sourceId,
      yoy: observations.get(period)!,
      latestPeriod: series.latestPeriod,
      latestYoy: series.latestYoy,
    })),
    note: "Only observation dates are aligned. National baskets and category coverage can still differ, so equal dates do not make these series identical measures.",
  };
}
