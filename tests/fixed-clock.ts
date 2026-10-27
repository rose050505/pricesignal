// Loaded before every test file (npm test): the clock starts at 27 Oct 2026, 12:00 KST and then runs normally.
// Freshness rules ("a monthly series older than three months is stale") are relative to today, and the fixtures hold
// 2026 observations; without this, the suite would start failing on 1 Jan 2027.
const START = Date.parse(process.env.PSIG_TEST_NOW ?? "2026-10-27T03:00:00.000Z");
const RealDate = Date;
const offset = RealDate.now() - START;
class TestDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() - offset);
    else super(...(args as [string | number | Date]));
  }
  static now(): number {
    return RealDate.now() - offset;
  }
}
globalThis.Date = TestDate as DateConstructor;
