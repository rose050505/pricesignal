// What the Nemotron call settings do through Meterless Nightshift, measured with the agent's own prompts.
// Needs Nightshift from .env (no Zetaris, no agencies); about 10 model calls. Prints no secrets.
//
//   npx tsx scripts/18_nemotron_check.mts
//
// 1. The thinking switch: the request-reading prompt with and without chat_template_kwargs.enable_thinking=false
//    (without it the app sends the 6,000-token floor, as its hedged second request does).
// 2. max_tokens: the first narrative draft for examples/01_cold_start at max_tokens 1,024 and 8,000.
// 3. Wording: the request-reading prompt for "can we go -2%?" and "can we move -2%?", sent as written.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnv, ROOT } from "../src/env.ts";
import { chat, type ChatMessage } from "../src/llm.ts";
import { parsePrompt } from "../src/prompts.ts";
import { forModel } from "../src/request.ts";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";

loadEnv();
const usage = (u: any) => `${u?.completion_tokens ?? "?"} output tokens${u?.completion_tokens_details?.reasoning_tokens ? ` (${u.completion_tokens_details.reasoning_tokens} reasoning)` : ""}`;
async function timed(label: string, messages: ChatMessage[], opts: Parameters<typeof chat>[1]): Promise<void> {
  const t0 = Date.now();
  try {
    const r = await chat(messages, { lane: "fast", temperature: 0, attempts: 1, ...opts });
    console.log(`  ${label.padEnd(44)} ${String(r.ms).padStart(6)} ms  ${usage(r.usage)}  finish=${r.finishReason ?? "?"}  ${r.model}`);
  } catch (e) {
    console.log(`  ${label.padEnd(44)} ${String(Date.now() - t0).padStart(6)} ms  FAILED: ${String(e).replace(/\s+/g, " ").slice(0, 120)}`);
  }
}

const Q1 = "our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot?? our costs rose 8%, unit costs are 60% of our selling price. we pass on ~70% of cost increases. thinking +5% for Q1, too much?";
const parse = (q: string): ChatMessage[] => [{ role: "user", content: parsePrompt(q) }];

console.log(`Nemotron through Meterless Nightshift, ${new Date().toISOString()}`);
console.log("1. Request reading (demo question 1), switch on vs off:");
for (let i = 1; i <= 2; i++) {
  await timed(`switch on, max_tokens 600 (#${i})`, parse(forModel(Q1)), { maxTokens: 600, timeoutMs: 90_000 });
  await timed(`switch off, max_tokens 6000 (#${i})`, parse(forModel(Q1)), { maxTokens: 600, thinking: true, timeoutMs: 90_000 });
}

console.log("2. First narrative draft for examples/01_cold_start, max_tokens 1024 vs 8000:");
const r = JSON.parse(fs.readFileSync(path.join(ROOT, "examples/01_cold_start/result.json"), "utf8")).final;
const question = JSON.parse(fs.readFileSync(path.join(ROOT, "examples/01_cold_start/trace.json"), "utf8")).question;
const req: any = { raw: question, countries: r.requestedCountries, concept: r.concept, conceptWords: [r.concept], proposedChangePct: r.proposed ?? undefined, passThrough: r.passThrough, costIncreasePct: r.cost ?? undefined, costSharePct: r.costShare ?? undefined, costShareBasis: r.costShareBasis ?? undefined, unknownCountries: r.unsupportedCountries ?? [] };
for (const maxTokens of [1024, 8000, 1024, 8000]) {
  let first: ChatMessage[] | undefined;
  // Capture the agent's own narrative request, then time it alone.
  const capture = new PriceSignalAgent({ llm: (async (m: ChatMessage[]) => { first ??= m; throw new Error("captured"); }) as any, sql: { run: async () => { throw new Error("no SQL"); } } as any, memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-m-"))), hedgeMs: Infinity });
  await (capture as any).narrate(req, r.facts, r.notes, r.passThrough);
  await timed(`narrative draft, max_tokens ${maxTokens}`, first!, { maxTokens, timeoutMs: 90_000 });
}

console.log('3. Request reading for "go" vs "move", sent as written (max_tokens 600):');
await timed('"canada food, can we go -2%?"', parse("canada food, can we go -2%?"), { maxTokens: 600, timeoutMs: 40_000 });
await timed('"canada food, can we move -2%?"', parse("canada food, can we move -2%?"), { maxTokens: 600, timeoutMs: 40_000 });
