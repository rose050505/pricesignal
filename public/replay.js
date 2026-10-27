// Replay mode (`npm run demo`, or the static demo site): the same page, fed by runs recorded with
// `scripts/15_examples.sh` instead of the live server. No model, Zetaris or agency call is made.
// replay/catalog.js (written by src/demo.ts) sets window.PSIG_REPLAY before this file loads.
(function () {
  const R = window.PSIG_REPLAY;
  if (!R) return;
  const MAX_GAP_MS = 700; // longer waits in the recording are shortened to this
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const load = async (path) => {
    const r = await realFetch(path);
    if (!r.ok) throw new Error(`could not load ${path} (HTTP ${r.status})`);
    return r.json();
  };

  window.fetch = async (url, opts) => {
    if (url === "/api/status") return json({ replay: true, state: "replay", provider: "replay", fast: R.model, zetaris: "recorded", memoryRecords: null });
    if (url === "/api/ask") {
      const q = norm(JSON.parse((opts && opts.body) || "{}").question);
      const hit = R.examples.find((e) => norm(e.question) === q);
      if (!hit) return json({ error: "This page replays recorded runs only: pick one of the recorded questions above. To ask your own question, run PriceSignal locally (README, \"Run it\")." });
      return json({ id: hit.name });
    }
    if (url === "/api/memory") return json([]);
    return realFetch(url, opts);
  };

  class ReplayEventSource {
    constructor(url) {
      this.name = String(url).split("/").pop();
      this.listeners = {};
      this.timers = [];
      this.closed = false;
      setTimeout(() => this.start().catch((e) => this.emit("failure", { error: String(e) })), 0);
    }
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    close() { this.closed = true; this.timers.forEach(clearTimeout); }
    emit(name, data) {
      if (this.closed) return;
      const m = { data: JSON.stringify(data) };
      if (name === "message" && this.onmessage) this.onmessage(m);
      (this.listeners[name] || []).forEach((f) => f(m));
    }
    async start() {
      const [trace, result] = await Promise.all([load(`replay/${this.name}/trace.json`), load(`replay/${this.name}/result.json`)]);
      if (this.closed) return;
      if (this.onopen) this.onopen();
      // Trace events and the early (partial) results in recorded order, with the recorded gaps capped.
      const steps = [
        ...trace.trace.map((e) => ({ t: e.t, name: "message", data: e })),
        ...(result.partials || []).map((p) => ({ t: p.t, name: "partial", data: p.result })),
      ].sort((a, b) => a.t - b.t);
      let at = 0;
      let prev = steps.length ? steps[0].t : 0;
      for (const s of steps) {
        at += Math.min(Math.max(s.t - prev, 0), MAX_GAP_MS);
        prev = s.t;
        this.timers.push(setTimeout(() => this.emit(s.name, s.data), at));
      }
      this.timers.push(setTimeout(() => this.emit("result", result.final), at + 300));
    }
  }
  window.EventSource = ReplayEventSource;

  const banner = () => {
    const d = document.createElement("div");
    d.className = "replay-banner";
    d.setAttribute("role", "note");
    d.innerHTML = `<b>Replay of recorded runs.</b> ${R.examples.length} ${R.examples.length === 1 ? "question" : "questions"} recorded in one session starting ${R.recordedAt}, with Zetaris, Meterless Nightshift (${R.model}) and the agency APIs. This page makes no live calls: it plays back each run's trace and the results the UI received, with waits over ${MAX_GAP_MS / 1000} s shortened to that; times in the results are the recorded ones. "Try another price change" recalculates in your browser. To ask your own question, run PriceSignal locally (<a href="${R.repo}#run-it">README, "Run it"</a>).`;
    document.body.insertBefore(d, document.querySelector("main"));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", banner);
  else banner();
})();
