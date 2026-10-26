/** Decoding changes invalidate remembered views without touching the raw REST tables. */
export function sourceDecoderVersion(agency: string): number {
  return agency === "abs" || agency === "statcan" ? 2 : 1;
}

/** Reused and newly decoded views share the same valid, non-future release window. */
export function hasFreshPeriod(period: unknown, frequency: string, now = new Date()): boolean {
  if (typeof period !== "string") return false;
  const match = frequency === "M" ? period.match(/^(\d{4})-(0[1-9]|1[0-2])$/) : frequency === "Q" ? period.match(/^(\d{4})-Q([1-4])$/) : null;
  if (!match) return false;
  const month = Number(match[1]) * 12 + Number(match[2]) * (frequency === "Q" ? 3 : 1) - 1;
  const age = now.getUTCFullYear() * 12 + now.getUTCMonth() - month;
  return age >= 0 && age <= (frequency === "Q" ? 6 : 3);
}

/** SQL counts may be numeric strings; only finite positive integers are counts. */
export function isUsableObservationCount(count: unknown): boolean {
  if (typeof count !== "number" && (typeof count !== "string" || count.trim() === "")) return false;
  const n = Number(count);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0;
}
