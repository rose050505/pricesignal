// Minimal .env loader (no dependency). Values already in process.env win.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dns from "node:dns";
import net from "node:net";

// IPv6 does not route on the laptop's network (curl -6 fails, -4 works), and Node's
// happy-eyeballs gives each address only 250 ms - too short for Europe from Korea.
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily(false);
net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export function env(name: string, fallback?: string): string {
  loadEnv();
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is missing (set it in .env)`);
}
