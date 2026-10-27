// Activity log of a UI run, in the same shape the CLI writes: out/ui-<UTC time>/trace.json and brief.md.
import fs from "node:fs";
import path from "node:path";
import type { Brief } from "./brief.ts";
import { exportEvidence, verifyEvidence } from "./evidence.ts";

export function saveRunRecord(outDir: string, question: string, brief: Pick<Brief, "markdown" | "trace" | "sqlLog">, now = new Date()): string {
  const dir = path.join(outDir, `ui-${now.toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(dir, { recursive: true });
  const sql = brief.sqlLog.map((q) => ({ id: q.id, sql: q.sql, rows: q.rows.length, ms: q.ms }));
  fs.writeFileSync(path.join(dir, "trace.json"), JSON.stringify({ question, source: "ui", trace: brief.trace, sql }, null, 2));
  fs.writeFileSync(path.join(dir, "brief.md"), brief.markdown ?? "");
  return dir;
}

/** The run's replayable evidence packet (as the CLI saves it), checked offline right away; the result is shown in the UI. */
export function saveEvidence(dir: string, brief: Brief): { ok: boolean; checks: number; path: string; errors: string[] } {
  const evidence = exportEvidence(brief);
  const verification = verifyEvidence(evidence);
  const file = path.join(dir, "evidence.json");
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + "\n");
  return { ok: verification.ok, checks: verification.checks, path: file, errors: verification.errors.slice(0, 3) };
}
