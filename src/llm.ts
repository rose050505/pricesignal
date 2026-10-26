// LLM provider layer. Primary provider: Meterless Runtime (Nightshift), per the
// Meterless provider contract: OpenAI-compatible /v1, Bearer runtime token,
// `meterless-app` on every request, `meterless-scope: user` on chat,
// GET /v1/models decides online/unauthorized/offline, 180 s timeout.
// `nvidia` (build.nvidia.com) and `openrouter` exist only as development fallbacks.
import { env } from "./env.ts";

export type Role = "system" | "user" | "assistant";
export interface ChatMessage { role: Role; content: string }
export interface ChatResult { text: string; model: string; provider: string; ms: number; usage?: unknown }

const APP_ID = "pricesignal";
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 90_000);

export function normalizeBaseUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  u = u.replace(/(\/v1)+$/, "");
  return `${u}/v1`;
}

export interface ProviderConfig { provider: string; baseUrl: string; token: string; fast: string; deep: string; headers: Record<string, string> }

export function providerConfig(): ProviderConfig {
  const provider = env("LLM_PROVIDER", "meterless");
  if (provider === "meterless") {
    const token = env("METERLESS_RUNTIME_TOKEN");
    if (token === "rt-local") throw new Error("METERLESS_RUNTIME_TOKEN is the placeholder 'rt-local'; copy the real token from the Nightshift Console");
    return {
      provider,
      baseUrl: normalizeBaseUrl(env("METERLESS_BASE_URL", "http://127.0.0.1:8088/v1")),
      token,
      fast: env("METERLESS_MODEL_FAST", "meterless/fast"),
      deep: env("METERLESS_MODEL_DEEP", "meterless/deep"),
      headers: { "meterless-app": APP_ID },
    };
  }
  if (provider === "nvidia") {
    const model = env("NVIDIA_MODEL", "nvidia/nemotron-3-super-120b-a12b");
    return { provider, baseUrl: normalizeBaseUrl(env("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")), token: env("NVIDIA_API_KEY"), fast: model, deep: model, headers: {} };
  }
  if (provider === "openrouter") {
    // Development fallback while Nightshift is not reachable: free Nemotron on OpenRouter.
    const model = env("OPENROUTER_MODEL", "nvidia/nemotron-3.5-super-vl:free");
    return { provider, baseUrl: "https://openrouter.ai/api/v1", token: env("OPENROUTER_API_KEY"), fast: model, deep: model, headers: { "X-Title": "PriceSignal" } };
  }
  throw new Error(`unknown LLM_PROVIDER ${provider}`);
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = TIMEOUT_MS): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

export type ProviderStatus = { state: "online" | "unauthorized" | "offline"; models: string[]; detail?: string };

export async function providerStatus(cfg = providerConfig()): Promise<ProviderStatus> {
  try {
    const r = await fetchWithTimeout(`${cfg.baseUrl}/models`, { headers: { Authorization: `Bearer ${cfg.token}`, ...cfg.headers } }, 15_000);
    if (r.status === 401 || r.status === 403) return { state: "unauthorized", models: [] };
    if (r.status !== 200) return { state: "offline", models: [], detail: `HTTP ${r.status}` };
    const j: any = await r.json();
    const models: string[] = (j.data ?? []).map((m: any) => String(m.id));
    if (cfg.provider === "meterless" && !models.some((m) => m.startsWith("meterless/"))) return { state: "offline", models, detail: "no meterless/* routes" };
    return { state: "online", models };
  } catch (e) {
    return { state: "offline", models: [], detail: String(e) };
  }
}

export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function chat(messages: ChatMessage[], opts: { lane?: "fast" | "deep"; temperature?: number; maxTokens?: number } = {}): Promise<ChatResult> {
  const cfg = providerConfig();
  const model = opts.lane === "deep" ? cfg.deep : cfg.fast;
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${cfg.token}`, ...cfg.headers };
  if (cfg.provider === "meterless") headers["meterless-scope"] = "user";
  const t0 = Date.now();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (process.env.PSIG_VERBOSE !== "0") process.stderr.write(`    … ${cfg.provider} ${model} (attempt ${attempt + 1})\n`);
      const r = await fetchWithTimeout(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        // Nemotron is a reasoning model: thinking tokens count against max_tokens, so keep a generous floor.
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.2,
          max_tokens: Math.max(opts.maxTokens ?? 2048, 1500),
          ...(cfg.provider === "openrouter" ? { reasoning: { effort: "low", exclude: true } } : {}),
        }),
      });
      if (r.status === 429 || r.status >= 500) {
        lastErr = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
        continue;
      }
      if (!r.ok) throw new Error(`LLM HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const j: any = await r.json();
      const msg = j.choices?.[0]?.message ?? {};
      const text = stripThinking(String(msg.content ?? ""));
      if (!text) {
        lastErr = new Error(`empty completion (finish_reason=${j.choices?.[0]?.finish_reason ?? "?"}, reasoning ${String(msg.reasoning ?? msg.reasoning_content ?? "").length} chars)`);
        continue;
      }
      return { text, model: String(j.model ?? model), provider: cfg.provider, ms: Date.now() - t0, usage: j.usage };
    } catch (e) {
      lastErr = e;
      process.stderr.write(`    … failed: ${String(e).slice(0, 160)}\n`);
      if (String(e).includes("LLM HTTP 4")) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
