// Activity log of a UI run, in the same shape the CLI writes: out/ui-<UTC time>/trace.json and brief.md.
import fs from "node:fs";
import path from "node:path";
import type { Brief } from "./brief.ts";

export function saveRunRecord(outDir: string, question: string, brief: Pick<Brief, "markdown" | "trace" | "sqlLog">, now = new Date()): string {
  const dir = path.join(outDir, `ui-${now.toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(dir, { recursive: true });
  const sql = brief.sqlLog.map((q) => ({ id: q.id, sql: q.sql, rows: q.rows.length, ms: q.ms }));
  fs.writeFileSync(path.join(dir, "trace.json"), JSON.stringify({ question, source: "ui", trace: brief.trace, sql }, null, 2));
  fs.writeFileSync(path.join(dir, "brief.md"), brief.markdown ?? "");
  return dir;
}
