// npm run ask -- "messy pricing question"      (or: npm run ask -- --file tests/inputs/01.txt)
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.ts";
import { PriceSignalAgent } from "./agent.ts";
import { AgentMemory } from "./memory.ts";
import { ZetarisClient } from "./zetaris.ts";
import { providerConfig } from "./llm.ts";
import { exportEvidence, verifyEvidence } from "./evidence.ts";
import { toResult } from "./result.ts";

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  const fi = args.indexOf("--file");
  const question = fi >= 0 ? fs.readFileSync(path.resolve(args[fi + 1]), "utf-8").trim() : args.filter((a) => !a.startsWith("--")).join(" ").trim();
  if (!question) {
    console.error('usage: npm run ask -- "is food inflation in DE, CA and AU still hot? thinking +5%"');
    process.exit(2);
  }
  const cfg = providerConfig();
  console.log(`[pricesignal] LLM provider: ${cfg.provider} @ ${cfg.baseUrl} (fast=${cfg.fast}, deep=${cfg.deep})`);
  const agent = new PriceSignalAgent({ sql: new ZetarisClient(), memory: new AgentMemory() });
  agent.on("event", (e) => console.log(`  · [${e.kind}] ${e.title}`));
  // What the UI would have shown while the run was in progress, for `npm run demo` (same payloads the server streams).
  const partials: { t: number; result: unknown }[] = [];
  agent.on("partial", (b) => partials.push({ t: Date.now(), result: JSON.parse(JSON.stringify({ ...toResult(b), partial: true })) }));
  const brief = await agent.run(question);
  const evidence = exportEvidence(brief);
  const verification = verifyEvidence(evidence);
  if (!verification.ok) throw new Error(`evidence verification failed: ${verification.errors.join("; ")}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(ROOT, "out", stamp);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "brief.md"), brief.markdown ?? "");
  fs.writeFileSync(path.join(dir, "trace.json"), JSON.stringify({ question, trace: brief.trace, sql: brief.sqlLog.map((q) => ({ id: q.id, sql: q.sql, rows: q.rows.length, ms: q.ms })) }, null, 2));
  fs.writeFileSync(path.join(dir, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  const final = { ...toResult(brief), record: path.relative(ROOT, dir), verification: { ok: verification.ok, checks: verification.checks, path: path.relative(ROOT, path.join(dir, "evidence.json")), errors: verification.errors.slice(0, 3) } };
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({ partials, final }) + "\n");
  console.log("\n" + brief.markdown);
  console.log(`\n[pricesignal] saved ${path.relative(ROOT, dir)}/brief.md`);
  console.log(`[pricesignal] saved ${path.relative(ROOT, dir)}/evidence.json (${verification.checks} offline checks)`);
  const covered = brief.facts.filter((f) => f.category ?? f.allItems).length;
  process.exit(covered === brief.facts.length ? 0 : 3);
}

main().catch((e) => {
  console.error("[pricesignal] failed:", e);
  process.exit(1);
});
