import test from "node:test";
import assert from "node:assert/strict";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { HMEM } from "../src/hmem_impl.ts";
import type { Request } from "../src/agent.ts";

const req: Request = { raw: "DE food +3%", countries: ["DE"], concept: "food", conceptWords: ["food"], proposedChangePct: 3, unknownCountries: [] };
const incomplete = () => Object.assign(new Error("Result reached the 1000-row limit; completeness is unconfirmed."), { name: "IncompleteResultError" });

async function priceFixture(withProduct: boolean, failCategories = false, error = incomplete()) {
  const memory = Object.create(AgentMemory.prototype); memory.hmem = new HMEM();
  const agent = new PriceSignalAgent({ memory, hedgeMs: Infinity,
    llm: async () => { throw new Error("No model call expected"); },
    sql: { run: async sql => {
      if (sql.startsWith("SELECT DISTINCT")) {
        if (failCategories) throw error;
        return { id: "fixture", sql, rows: [["DE", "food", ...(withProduct ? ["Ramen"] : [])]], columns: [], ms: 0 };
      }
      if (sql.includes("p.sku_category = s.concept")) throw error;
      return { id: "fixture", sql, rows: [], columns: [], ms: 0 };
    } },
  });
  let flatCalls = 0;
  (agent as any).priceListFlat = async () => { flatCalls++; return { skus: [{ sku: "unverified" }], query: {} }; };
  const notes: string[] = [];
  const priced = await (agent as any).priceList(req, new Map(), [], 0.7, async () => ({ view: "food" }), notes);
  return { priced, flatCalls, notes };
}

test("an incomplete SKU history never falls through to legacy requested-category pricing", async () => {
  const result = await priceFixture(false);
  assert.equal(result.flatCalls, 0);
  assert.equal(result.priced, undefined);
  assert.match(result.notes.join(" "), /incomplete|limit|completeness/i);
});

test("an incomplete product-category list or product history omits SKU prices", async () => {
  for (const failCategories of [true, false]) {
    const result = await priceFixture(true, failCategories);
    assert.equal(result.priced, undefined);
    assert.equal(result.flatCalls, 0);
  }
});

test("legacy pricing remains available for an ordinary error unrelated to row completeness", async () => {
  const result = await priceFixture(false, false, new Error("legacy join fixture unavailable"));
  assert.equal(result.flatCalls, 1);
  assert.ok(result.priced);
});

test("incomplete-result errors crossing a runner boundary still block legacy fallback", async () => {
  const result = await priceFixture(false, false, { name: "IncompleteResultError", message: "Reached the row limit" } as Error);
  assert.equal(result.flatCalls, 0);
  assert.equal(result.priced, undefined);
});
