// Reading JSON out of a model reply: fenced, wrapped in reasoning, cut off at the token limit, or with common slips.

/**
 * The first JSON object in a model reply. Reasoning before a closing </think> is skipped, stray braces in
 * prose are passed over, and a trailing comma (a common slip) is tolerated.
 */
export function extractJson(text: string): any | null {
  const closed = text.lastIndexOf("</think>");
  const t = (closed >= 0 ? text.slice(closed + "</think>".length) : text).replace(/```(?:json)?/g, "").trim();
  for (let start = t.indexOf("{"); start >= 0; start = t.indexOf("{", start + 1)) {
    const end = objectEnd(t, start);
    if (end < 0) continue;
    const body = t.slice(start, end + 1);
    for (const candidate of [body, withoutTrailingCommas(body), escapedControls(withoutTrailingCommas(body))]) {
      try {
        const j = JSON.parse(candidate);
        if (j && typeof j === "object" && !Array.isArray(j)) return j;
      } catch {
        // try the lenient form, then the next brace
      }
    }
  }
  return null;
}

/**
 * The complete fields of a JSON object reply that was cut off: everything up to the last finished value, closed.
 * Returns the object only when it has a string headline; an unfinished value is dropped, never completed.
 */
export function completedFields(text: string): any | null {
  const closed = text.lastIndexOf("</think>");
  const t = (closed >= 0 ? text.slice(closed + "</think>".length) : text).replace(/```(?:json)?/g, "").trim();
  const start = t.indexOf("{");
  if (start < 0) return null;
  const cuts: { at: number; depth: number }[] = [];
  let depth = 0, inStr = false, esc = false, value = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') { inStr = false; if (value) cuts.push({ at: i + 1, depth }); value = false; }
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === ":") value = true;
    else if (ch === ",") value = false;
    else if (ch === "{") { depth++; value = false; }
    else if (ch === "}") {
      if (--depth === 0) {
        const whole = extractJson(t.slice(start, i + 1));
        if (whole) return whole;
        break; // closed but malformed (e.g. an unescaped quote): keep the fields finished before the break
      }
      cuts.push({ at: i + 1, depth });
    }
  }
  for (const c of cuts.reverse()) {
    // A real end of value is followed by "," or "}" (or the end of a cut-off reply); a stray quote inside a
    // sentence is not, so "Australian "food" CPI" never becomes the paragraph "Australian ".
    const next = t.slice(c.at).trimStart()[0];
    if (next !== undefined && next !== "," && next !== "}") continue;
    try {
      const j = JSON.parse(escapedControls(t.slice(start, c.at)) + "}".repeat(c.depth));
      if (j && typeof j.headline === "string") return j;
    } catch {
      // an earlier cut may still close cleanly
    }
  }
  return null;
}

/** Raw line breaks and tabs inside JSON strings, escaped (JSON forbids them; models sometimes write them). */
function escapedControls(json: string): string {
  let out = "", inStr = false, esc = false;
  for (const ch of json) {
    if (inStr && !esc && (ch === "\n" || ch === "\r" || ch === "\t")) { out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t"; continue; }
    out += ch;
    if (esc) esc = false;
    else if (inStr && ch === "\\") esc = true;
    else if (ch === '"') inStr = !inStr;
  }
  return out;
}

/** Index of the brace closing the object that opens at `start`, ignoring braces inside strings; -1 if none. */
function objectEnd(t: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Drop commas directly before a closing brace or bracket, outside strings. */
function withoutTrailingCommas(t: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    if (ch === "," && /^\s*[}\]]/.test(t.slice(i + 1))) continue;
    out += ch;
  }
  return out;
}
