// npm run ui  -> http://localhost:5177
// Tiny dependency-free server: one page, a run endpoint, and a Server-Sent
// Events stream of the agent's trace so the user can watch it work.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ROOT, loadEnv, env } from "./env.ts";
import { PriceSignalAgent, TraceEvent } from "./agent.ts";
import { AgentMemory } from "./memory.ts";
import { ZetarisClient } from "./zetaris.ts";
import { providerConfig, providerStatus } from "./llm.ts";
import { COMPARE_COLUMNS } from "./sources/index.ts";

loadEnv();
const PORT = Number(env("PSIG_PORT", "5177"));
const memory = new AgentMemory();
interface Run { events: TraceEvent[]; listeners: Set<http.ServerResponse>; done: boolean; result?: unknown; error?: string }
const runs = new Map<string, Run>();

function send(res: http.ServerResponse, code: number, body: unknown, type = "application/json"): void {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function push(run: Run, data: unknown, event = "message"): void {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const l of run.listeners) l.write(line);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf-8"), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/api/status") {
      const cfg = providerConfig();
      const st = await providerStatus(cfg);
      return send(res, 200, { provider: cfg.provider, baseUrl: cfg.baseUrl.replace(/\/\/[^/]*@/, "//"), fast: cfg.fast, deep: cfg.deep, state: st.state, models: st.models.slice(0, 20), memoryRecords: memory.hmem.store.all().length });
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
        push(run, e);
      });
      agent
        .run(question)
        .then((b) => {
          run.result = { markdown: b.markdown, facts: b.facts, notes: [...new Set(b.notes)], views: b.views, ms: b.ms, passThrough: b.passThrough, compared: { id: b.compared.id, sql: b.compared.sql, columns: COMPARE_COLUMNS, rows: b.compared.rows }, sql: b.sqlLog.map((q) => ({ id: q.id, sql: q.sql, rows: q.rows.length, ms: q.ms })) };
          run.done = true;
          push(run, run.result, "result");
        })
        .catch((e) => {
          run.error = String(e);
          run.done = true;
          push(run, { error: run.error }, "failure");
        });
      return send(res, 200, { id });
    }
    const m = url.pathname.match(/^\/api\/stream\/([\w-]+)$/);
    if (req.method === "GET" && m) {
      const run = runs.get(m[1]);
      if (!run) return send(res, 404, { error: "unknown run" });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      for (const e of run.events) res.write(`event: message\ndata: ${JSON.stringify(e)}\n\n`);
      if (run.done) res.write(run.error ? `event: failure\ndata: ${JSON.stringify({ error: run.error })}\n\n` : `event: result\ndata: ${JSON.stringify(run.result)}\n\n`);
      run.listeners.add(res);
      req.on("close", () => run.listeners.delete(res));
      return;
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => console.log(`[pricesignal] UI on http://localhost:${PORT}`));
