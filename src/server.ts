// npm run ui  -> http://localhost:5177
// Tiny dependency-free server: one page, a run endpoint, and a Server-Sent
// Events stream of the agent's trace so the user can watch it work.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ROOT, loadEnv, env } from "./env.ts";
import { PriceSignalAgent, TraceEvent } from "./agent.ts";
import { costInputNeeded, gapSummary, type Brief } from "./brief.ts";
import { AgentMemory } from "./memory.ts";
import { ZetarisClient } from "./zetaris.ts";
import { providerConfig, providerStatus } from "./llm.ts";
import { COMPARE_COLUMNS } from "./sources/index.ts";
import { publishRun, subscribeRun, type Run } from "./run-stream.ts";

loadEnv();
const PORT = Number(env("PSIG_PORT", "5177"));
const memory = new AgentMemory();
const runs = new Map<string, Run>();

function send(res: http.ServerResponse, code: number, body: unknown, type = "application/json"): void {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf-8"), "text/html; charset=utf-8");
    if (req.method === "GET" && ["/scenario.js", "/preview-panel.js"].includes(url.pathname)) return send(res, 200, fs.readFileSync(path.join(ROOT, "public", url.pathname.slice(1)), "utf-8"), "application/javascript; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/api/status") {
      const cfg = providerConfig();
      const st = await providerStatus(cfg);
      let zetaris = "offline";
      try {
        const z = await Promise.race([new ZetarisClient().run("SELECT 1 AS ok"), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]);
        zetaris = z.rows.length ? "online" : "offline";
      } catch {
        zetaris = "offline";
      }
      return send(res, 200, { zetaris, provider: cfg.provider, baseUrl: cfg.baseUrl.replace(/\/\/[^/]*@/, "//"), fast: cfg.fast, deep: cfg.deep, state: st.state, models: st.models.slice(0, 20), memoryRecords: memory.hmem.store.all().length });
    }
    if (req.method === "GET" && url.pathname === "/api/memory") {
      return send(res, 200, memory.hmem.store.all().map((r: any) => ({ id: r.id, layer: r.layer, type: r.type, content: r.content, confidence: r.confidence, accessCount: r.accessCount })));
    }
    if (req.method === "POST" && url.pathname === "/api/ask") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const question = String(JSON.parse(body || "{}").question ?? "").trim();
      if (!question) return send(res, 400, { error: "question is required" });
      const id = randomUUID();
      const run: Run = { events: [], listeners: new Set(), done: false };
      runs.set(id, run);
      const agent = new PriceSignalAgent({ sql: new ZetarisClient(), memory });
      agent.on("event", (e: TraceEvent) => {
        run.events.push(e);
        publishRun(run, e);
      });
      agent.on("partial", (b: Brief) => publishRun(run, { ...toResult(b), partial: true }, "partial"));
      agent
        .run(question)
        .then((b) => {
          run.result = toResult(b);
          run.done = true;
          publishRun(run, run.result, "result");
        })
        .catch((e) => {
          run.error = String(e);
          run.done = true;
          publishRun(run, { error: run.error }, "failure");
        });
      return send(res, 200, { id });
    }
    const m = url.pathname.match(/^\/api\/stream\/([\w-]+)$/);
    if (req.method === "GET" && m) {
      const run = runs.get(m[1]);
      if (!run) return send(res, 404, { error: "unknown run" });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      const unsubscribe = subscribeRun(run, res);
      req.on("close", unsubscribe);
      return;
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String(e) });
  }
});

/** What the browser gets for a brief (also sent early, without the prose, as a "partial" event). */
function toResult(b: Brief) {
  return { gap: b.facts.length ? gapSummary(b) ?? null : null, startedAt: b.startedAt ?? null, requestedCountries: b.request.countries, unsupportedCountries: b.request.unknownCountries, markdown: b.markdown ?? "", narrative: b.narrative ?? null, narrativeIssue: b.narrativeIssue ?? null, facts: b.facts, alignment: b.alignment ?? null, notes: [...new Set(b.notes)], views: b.views, ms: b.ms, metrics: b.metrics, partialStage: b.partialStage, passThrough: b.passThrough, invalidPassThrough: !!b.request.invalidPassThrough, policySource: b.policySource, skus: b.skus ?? [], sinceLast: b.sinceLast ?? [], proposed: b.request.proposedChangePct ?? null, concept: b.request.concept, cost: b.request.costIncreasePct ?? null, costRemembered: !!b.request.costRemembered, costShare: b.request.costSharePct ?? null, costShareBasis: b.request.costShareBasis ?? null, costInputNeeded: b.request.costIncreasePct === undefined ? null : costInputNeeded(b.request, b.passThrough) ?? null, costShareRemembered: !!b.request.costShareRemembered, pricing: b.pricingQuery ? { id: b.pricingQuery.id, sql: b.pricingQuery.sql } : null, compared: { id: b.compared.id, sql: b.compared.sql, columns: COMPARE_COLUMNS, rows: b.compared.rows }, sql: b.sqlLog.map((q) => ({ id: q.id, sql: q.sql, rows: q.rows.length, ms: q.ms })) };
}

server.listen(PORT, () => console.log(`[pricesignal] UI on http://localhost:${PORT}`));
