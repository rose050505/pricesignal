// No-LLM integration probe: discover + onboard DE/CA/AU (food, all_items) into
// Zetaris, then run the federated comparison. Prints every DDL error verbatim
// so template fixes are quick.
import { loadEnv } from "./env.ts";
import { ZetarisClient, rowsAsObjects } from "./zetaris.ts";
import { COMPARE_COLUMNS, Country, bootstrap, compareSql, discover, monthsBack, onboard, onboardPlan } from "./sources/index.ts";

loadEnv();
const z = new ZetarisClient();
// Usage: npx tsx src/probe.ts            (DE, CA, AU)
//        npx tsx src/probe.ts FR IT ES   (any supported market codes)
const asked = process.argv.slice(2).map((a) => a.toUpperCase());
const markets = (asked.length ? asked : ["DE", "CA", "AU"]) as Country[];
console.log("bootstrap:", (await bootstrap(z)).join(" | "));
const views: string[] = [];
for (const country of markets) {
  for (const concept of ["food", "all_items"]) {
    try {
      const d = await discover(country, concept);
      console.log(`\n== ${country} ${concept}: ${d.candidates.length} candidate(s)`, d.notes);
      const c = d.candidates[0];
      if (!c) continue;
      console.log(`   ${c.dataset} ${c.code} "${c.label}" ${c.frequency} last=${c.lastPeriod}\n   ${c.sourceUrl}`);
      const r = await onboard(z, c, concept);
      console.log(`   onboard ok=${r.ok} existed=${r.existed} rows=${r.rows} latest=${r.latest}${r.error ? `\n   ERROR: ${r.error}` : ""}`);
      if (!r.ok) console.log("   SQL:\n" + onboardPlan(c, concept).statements.join("\n---\n"));
      else views.push(r.view);
    } catch (e) {
      console.log(`   EXCEPTION ${String(e).slice(0, 400)}`);
    }
  }
}
if (views.length) {
  const res = await z.run(compareSql(views, monthsBack(15)));
  const rows = rowsAsObjects(res, COMPARE_COLUMNS);
  console.log(`\n== federated ${res.id}: ${rows.length} rows, columns ${res.columns.join(",")}`);
  const latest: Record<string, unknown> = {};
  for (const r of rows) latest[`${r.country}:${r.concept}`] = `${r.period} ${r.yoy_pct}%`;
  console.log(latest);
}
console.log(`\nPROBE_DONE views=${views.length}/${markets.length * 2}`);
