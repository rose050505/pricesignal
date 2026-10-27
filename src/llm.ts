// LLM provider layer. Primary provider: Meterless Runtime (Nightshift), per the
// Meterless provider contract: OpenAI-compatible /v1, Bearer runtime token,
// `meterless-app` on every request, `meterless-scope: user` on chat,
// GET /v1/models decides online/unauthorized/offline (15 s). Chat calls default to a
// 90 s limit; the agent sets 20-75 s per call. Optional thinking-off, reasoning-effort and
// throughput hints are sent and dropped automatically if the runtime rejects them.
// `nvidia` (build.nvidia.com) and `openrouter` exist only as development fallbacks.
import { env } from "./env.ts";

export type Role = "system" | "user" | "assistant";
export interface ChatMessage { role: Role; content: string }
export interface ChatResult { text: string; model: string; provider: string; ms: number; usage?: unknown; finishReason?: string }

const APP_ID = "pricesignal";
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 90_000);
// Nemotron reasons before it answers; through OpenRouter that can be 1-4k hidden tokens per call.
// Ask for low effort on every provider (OpenAI-style and OpenRouter-style fields). If a runtime
// rejects the extra fields, drop them once and keep going.
let sendReasoningHint = (process.env.PSIG_REASONING_EFFORT ?? "low") !== "off";
// Nemotron's chat template switch. Through Nightshift it is the field that takes effect: measured 27 Oct, the
// parse request fell from 4-7 s and 1.2-1.8k output tokens (with /no_think and effort hints only) to 0.7-1.3 s
// and about 50 tokens. Dropped once if a runtime rejects the field.
let sendThinkingSwitch = true;
/** Whether calls go out with Nemotron's reasoning pass switched off (then token limits fit the reply alone). */
export const thinkingOff = () => (process.env.PSIG_NO_THINK ?? "1") !== "0" && sendThinkingSwitch;

/** Whether a rejected request blamed the optional reasoning fields (only then is it worth resending without them). */
export function rejectsReasoningHint(status: number, body: string): boolean {
  return (status === 400 || status === 422) && /reasoning|\bprovider\b/i.test(body) && /unrecogni[sz]ed|unknown|unsupported|not (?:permitted|allowed|supported)|extra|invalid|unexpected/i.test(body);
}

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

/** Fetch and read the body under one time limit (a proxy may send headers long before the body); `signal` cancels from outside. */
async function fetchText(url: string, init: RequestInit, ms = TIMEOUT_MS, signal?: AbortSignal): Promise<{ status: number; ok: boolean; text: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  const onAbort = () => ctl.abort(signal!.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    return { status: r.status, ok: r.ok, text: await r.text() };
  } finally {
    clearTimeout(t);
    signal?.removeEventListener("abort", onAbort);
  }
}

export type ProviderStatus = { state: "online" | "unauthorized" | "offline"; models: string[]; detail?: string };

export async function providerStatus(cfg = providerConfig()): Promise<ProviderStatus> {
  try {
    const r = await fetchText(`${cfg.baseUrl}/models`, { headers: { Authorization: `Bearer ${cfg.token}`, ...cfg.headers } }, 15_000);
    if (r.status === 401 || r.status === 403) return { state: "unauthorized", models: [] };
    if (r.status !== 200) return { state: "offline", models: [], detail: `HTTP ${r.status}` };
    const j: any = JSON.parse(r.text);
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

export async function chat(messages: ChatMessage[], opts: { lane?: "fast" | "deep"; temperature?: number; maxTokens?: number; attempts?: number; timeoutMs?: number; signal?: AbortSignal; /** send without the thinking switch (and keep room for reasoning) */ thinking?: boolean } = {}): Promise<ChatResult> {
  const cfg = providerConfig();
  const model = opts.lane === "deep" ? cfg.deep : cfg.fast;
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${cfg.token}`, ...cfg.headers };
  if (cfg.provider === "meterless") headers["meterless-scope"] = "user";
  const t0 = Date.now();
  let lastErr: unknown;
  // Nemotron models accept "/no_think" in the system prompt to skip the hidden reasoning pass,
  // which otherwise costs 1-4k tokens (30-60 s on slower upstreams) per call.
  const noThink = !opts.thinking && (process.env.PSIG_NO_THINK ?? "1") !== "0";
  if (noThink) {
    messages = messages[0]?.role === "system"
      ? [{ ...messages[0], content: `/no_think\n${messages[0].content}` }, ...messages.slice(1)]
      : [{ role: "system", content: "/no_think" }, ...messages];
  }
  const attempts = opts.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (process.env.PSIG_VERBOSE !== "0") process.stderr.write(`    … ${cfg.provider} ${model} (attempt ${attempt + 1})\n`);
      const r = await fetchText(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        // With reasoning on, thinking tokens count against max_tokens, so keep a generous floor. With it off, the
        // caller's limit stands: a large max_tokens alone slowed the NVIDIA lane (245 tokens: 3.5 s at 1024, 25 s at 8000).
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.2,
          max_tokens: Math.max(opts.maxTokens ?? 2048, noThink && sendThinkingSwitch ? 0 : Number(process.env.PSIG_MIN_MAX_TOKENS || 6000)),
          ...(sendReasoningHint ? { reasoning: { effort: process.env.PSIG_REASONING_EFFORT || "low", exclude: true }, reasoning_effort: process.env.PSIG_REASONING_EFFORT || "low", provider: { sort: "throughput" } } : {}),
          ...(noThink && sendThinkingSwitch ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        }),
      }, opts.timeoutMs, opts.signal);
      if (r.status === 429 || r.status >= 500) {
        lastErr = new Error(`HTTP ${r.status}: ${r.text.slice(0, 200)}`);
        if (attempt + 1 < attempts) await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
        continue;
      }
      if (noThink && sendThinkingSwitch && (r.status === 400 || r.status === 422) && /chat_template_kwargs|enable_thinking/i.test(r.text)) {
        sendThinkingSwitch = false;
        process.stderr.write(`    … runtime rejected the thinking switch (HTTP ${r.status}); retrying without it\n`);
        attempt--;
        continue;
      }
      if (sendReasoningHint && rejectsReasoningHint(r.status, r.text)) {
        sendReasoningHint = false;
        process.stderr.write(`    … runtime rejected the reasoning hint (HTTP ${r.status}); retrying without it\n`);
        attempt--;
        continue;
      }
      if (!r.ok) throw new Error(`LLM HTTP ${r.status}: ${r.text.slice(0, 300)}`);
      const j: any = JSON.parse(r.text);
      const msg = j.choices?.[0]?.message ?? {};
      const text = stripThinking(String(msg.content ?? ""));
      if (!text) {
        lastErr = new Error(`empty completion (finish_reason=${j.choices?.[0]?.finish_reason ?? "?"}, reasoning ${String(msg.reasoning ?? msg.reasoning_content ?? "").length} chars)`);
        continue;
      }
      return { text, model: String(j.model ?? model), provider: cfg.provider, ms: Date.now() - t0, usage: j.usage, finishReason: j.choices?.[0]?.finish_reason };
    } catch (e) {
      lastErr = e;
      process.stderr.write(`    … failed: ${String(e).slice(0, 160)}\n`);
      if (String(e).includes("LLM HTTP 4") || opts.signal?.aborted) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
