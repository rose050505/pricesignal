// Verify a saved run using only its local evidence packet; no credentials or services needed.
import fs from "node:fs";
import { verifyEvidence } from "./evidence.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const files = args.filter(arg => arg !== "--json");
if (files.length !== 1) {
  console.error("usage: npm run verify -- <evidence.json> [--json]");
  process.exitCode = 2;
} else {
  try {
    const report = verifyEvidence(JSON.parse(fs.readFileSync(files[0], "utf8")));
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`${report.ok ? "VERIFIED" : "FAILED"}: saved SQL rows and derived calculations (${report.checks} checks).`);
      for (const error of report.errors) console.error(`  Error: ${error}`);
      for (const warning of report.warnings) console.log(`  Note: ${warning}`);
      console.log(`Coverage: ${JSON.stringify(report.coverage)}`);
      for (const limitation of report.limitations) console.log(`  Scope: ${limitation}`);
    }
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.error(`[pricesignal] cannot verify evidence: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
