// When only the headline of a draft is wrong (27 Oct evening, Nemotron with thinking off: 8 of 10 drafts said
// "easing in all three markets" while AU was flat), the rewrite asks for a new headline alone and keeps the checked
// paragraphs. A full rewrite reintroduced other errors in 3 of 4 live replays, leaving only the code headline.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent, type Request } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";

process.env.PSIG_VERBOSE = "0";
const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/demo1-narrative-drafts.json", import.meta.url), "utf8"));
const req: Request = { raw: fx.question, countries: fx.requestedCountries, concept: fx.concept, conceptWords: [fx.concept], proposedChangePct: fx.proposed, passThrough: fx.passThrough, unknownCountries: [] };
const draft = { ...fx.drafts.headlineOnly, headline: "Food inflation is easing in all three markets; +5% is above the benchmark everywhere." };

async function narrate(second: string) {
  const asks: any[][] = [];
  const agent = new PriceSignalAgent({
    llm: (async (m: any[]) => { asks.push(m.map((x) => ({ ...x }))); return { text: asks.length === 1 ? JSON.stringify(draft) : second, model: "nvidia/nemotron-3.5-lightning-30b-a3b", provider: "f", ms: 1 }; }) as any,
    sql: { run: async () => { throw new Error("no SQL"); } } as any,
    memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-hl-"))), hedgeMs: Infinity,
  });
  const res = await (agent as any).narrate(req, fx.facts, fx.notes, fx.passThrough);
  return { res, asks };
}

test("a draft whose only error is the headline gets a headline-only rewrite, merged with its checked paragraphs", async () => {
  const fixed = "Food inflation is easing in Germany and Canada and flat in Australia; +5% is above the market benchmark in DE, CA and AU.";
  const { res, asks } = await narrate(JSON.stringify({ headline: fixed }));
  assert.equal(asks.length, 2);
  assert.match(asks[1].at(-1).content, /Only the headline is wrong/);
  assert.match(asks[1].at(-1).content, /says easing in every market, but AU is flat/);
  assert.equal(res.narrative.headline, fixed);
  assert.equal(res.narrative.headlineByCode, undefined);
  assert.deepEqual(res.narrative.markets, draft.markets);
  assert.equal(res.narrative.model, "nvidia/nemotron-3.5-lightning-30b-a3b");
});

test("if the new headline is still wrong, the checked paragraphs are kept under the code headline", async () => {
  const { res } = await narrate(JSON.stringify({ headline: "Food inflation is easing everywhere." }));
  assert.equal(res.narrative.headlineByCode, true);
  assert.deepEqual(Object.keys(res.narrative.markets).sort(), ["AU", "CA", "DE"]);
});
