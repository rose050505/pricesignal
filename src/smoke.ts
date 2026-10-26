// npm run smoke -- [zetaris|llm|sources|memory]   (no argument = all)
// Prints PASS/FAIL per layer; exit code = number of failures.
import { loadEnv } from "./env.ts";
import { ZetarisClient } from "./zetaris.ts";
import { chat, providerConfig, providerStatus } from "./llm.ts";
import { discover } from "./sources/index.ts";
import { AgentMemory } from "./memory.ts";

loadEnv();
const only = process.argv[2];
let fails = 0;
async function check(name: string, fn: () => Promise<string>): Promise<void> {
  if (only && !name.toLowerCase().startsWith(only)) return;
  try {
    console.log(`PASS ${name}: ${await fn()}`);
  } catch (e) {
    fails++;
    console.log(`FAIL ${name}: ${String(e).slice(0, 300)}`);
  }
}

await check("zetaris SELECT 1", async () => {
  const r = await new ZetarisClient().run("SELECT 1 AS one");
  if (String(r.rows[0]?.[0]) !== "1") throw new Error(`unexpected ${JSON.stringify(r.rows).slice(0, 80)}`);
  return `columns=${r.columns.join(",")} ${r.ms} ms`;
});
await check("llm provider status", async () => {
  const cfg = providerConfig();
  const s = await providerStatus(cfg);
  if (s.state !== "online") throw new Error(`${cfg.provider} ${s.state} ${s.detail ?? ""}`);
  return `${cfg.provider} online, models: ${s.models.slice(0, 8).join(", ")}`;
});
await check("llm chat", async () => {
  const r = await chat([{ role: "user", content: "Reply with the single word: ready" }], { lane: "fast", maxTokens: 20 });
  const u: any = r.usage ?? {};
  // A realistic call: the request parser prompt. Output tokens show how much hidden reasoning the model spends.
  const ask = "Extract the pricing request as JSON with keys countries, concept, proposed_change_pct, pass_through. Request: our gochujang & snacks: is food inflation in deutschland, canada & aus still hot?? thinking +5%, we pass on ~70%. Reply with JSON only.";
  const p = await chat([{ role: "user", content: ask }], { lane: "fast", temperature: 0, attempts: 1, timeoutMs: 90_000 });
  const pu: any = p.usage ?? {};
  return `${r.provider} model=${r.model} ${r.ms} ms -> ${r.text.slice(0, 40)} (out ${u.completion_tokens ?? "?"} tok) | parse-size call: ${p.ms} ms, out ${pu.completion_tokens ?? "?"} tok, model=${p.model}`;
});
for (const c of ["DE", "CA", "AU"] as const) {
  await check(`sources ${c}`, async () => {
    const d = await discover(c, "food");
    const k = d.candidates[0];
    if (!k) throw new Error(`no candidate; notes: ${d.notes.join(" | ")}`);
    return `${k.dataset}/${k.code} "${k.label}" ${k.frequency} last=${k.lastPeriod}${d.notes.length ? ` | notes: ${d.notes.join(" | ")}` : ""}`;
  });
}
await check("memory H-MEM", async () => {
  const m = new AgentMemory();
  const n = m.hmem.store.all().length;
  return `engine loaded, ${n} records persisted`;
});
process.exit(fails);
