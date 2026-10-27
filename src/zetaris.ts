// Zetaris REST client: every fact the agent reports comes back through here.
// POST {ZETARIS_REST_URL}/sql-editor/sqls/run with Bearer key, X-Org-ID and a
// fresh UUID X-Request-ID; one statement per call (Lightning SQL rule).
import { randomUUID } from "node:crypto";
import { env } from "./env.ts";

export interface SqlResult { id: string; sql: string; columns: string[]; rows: unknown[][]; ms: number }

export interface SqlRunner { run(sql: string, opts?: { limit?: number }): Promise<SqlResult> }

/** Hitting the requested cap does not prove that the response contains every row. */
export class IncompleteResultError extends Error {
  constructor(readonly rowCount: number, readonly limit: number) {
    super(`Zetaris returned ${rowCount} rows at or above the requested limit of ${limit}. The result may be incomplete and is not used for calculations.`);
    this.name = "IncompleteResultError";
  }
}

/** The name check also recognizes this error across class or serialization boundaries. */
export function isIncompleteResultError(error: unknown): error is IncompleteResultError {
  return error instanceof IncompleteResultError ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "IncompleteResultError");
}

// Statement ids for direct callers (smoke, probe); the agent numbers its own statements per run.
let counter = 0;
export function nextCiteId(): string {
  counter += 1;
  return `Q${counter}`;
}

function metadataColumns(j: any): string[] | undefined {
  const cand = j.columns ?? j.header ?? j.headers ?? j.schema ?? j.metadata?.columns ?? j.columnNames;
  if (Array.isArray(cand)) {
    return cand.map((c: any) => (typeof c === "string" ? c : c?.name ?? c?.columnName ?? c?.label ?? String(c)));
  }
  return undefined;
}

function extractColumns(j: any, width: number): string[] {
  const names = metadataColumns(j);
  if (names?.length === width) return names;
  return Array.from({ length: width }, (_, i) => `c${i}`);
}

export class ZetarisClient implements SqlRunner {
  constructor(
    private baseUrl = env("ZETARIS_REST_URL", "http://localhost:8888/api/v1.0").replace(/\/+$/, ""),
    private apiKey = env("ZETARIS_API_KEY"),
    private orgId = env("ZETARIS_ORG_ID", "1"),
  ) {}

  async run(sql: string, opts: { limit?: number } = {}): Promise<SqlResult> {
    const statement = sql.trim().replace(/;\s*$/, "");
    const limit = opts.limit ?? 1000;
    const t0 = Date.now();
    const r = await fetch(`${this.baseUrl}/sql-editor/sqls/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "X-Org-ID": this.orgId,
        "X-Request-ID": randomUUID(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ queryId: randomUUID(), sql: statement, source: "SqlEditor", limit }),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Zetaris HTTP ${r.status}: ${text.slice(0, 400)}`);
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error(`Zetaris returned non-JSON: ${text.slice(0, 200)}`);
    }
    if (j.error || j.status === "FAILED" || j.success === false) throw new Error(`Zetaris error: ${JSON.stringify(j.error ?? j.message ?? j).slice(0, 400)}`);
    const data: unknown[] = Array.isArray(j.data) ? j.data : Array.isArray(j.rows) ? j.rows : [];
    // No verified pagination or truncation marker is available. Even an exactly-full
    // result is rejected conservatively rather than presenting a partial history as complete.
    if (data.length >= limit) throw new IncompleteResultError(data.length, limit);
    if (data[0] && typeof data[0] === "object" && !Array.isArray(data[0])) {
      const declared = metadataColumns(j);
      const columns = declared?.length ? declared : Object.keys(data[0]);
      const rows = data.map((row) => columns.map((column) =>
        row && typeof row === "object" ? (row as Record<string, unknown>)[column] : undefined));
      return { id: nextCiteId(), sql: statement, columns, rows, ms: Date.now() - t0 };
    }
    const rows = data.map((row) => (Array.isArray(row) ? row : row && typeof row === "object" ? Object.values(row as object) : [row]));
    const width = rows[0]?.length ?? 0;
    const columns = extractColumns(j, width);
    return { id: nextCiteId(), sql: statement, columns, rows, ms: Date.now() - t0 };
  }
}

/** Run a DDL statement; "already exists" counts as success (idempotent onboarding). */
export async function runDdl(z: SqlRunner, sql: string): Promise<{ ok: boolean; existed: boolean; error?: string }> {
  try {
    await z.run(sql);
    return { ok: true, existed: false };
  } catch (e) {
    const msg = String(e);
    if (/already exists|AlreadyExists|duplicate/i.test(msg)) return { ok: true, existed: true };
    return { ok: false, existed: false, error: msg.slice(0, 400) };
  }
}

/** Zetaris REST returns rows without column names; name them from our own SELECT list. */
export function rowsAsObjects(res: SqlResult, names?: string[]): Record<string, unknown>[] {
  const placeholder = res.columns.every((c, i) => c === `c${i}`);
  const cols = names && (placeholder || !res.columns.length) ? names : res.columns;
  return res.rows.map((r) => Object.fromEntries(cols.map((c, i) => [c.toLowerCase(), r[i]])));
}
