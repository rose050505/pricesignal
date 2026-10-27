// scripts/16_prewarm.sh registers and caches the demo sources in Zetaris before a recording (admin step).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Copy only the wrapper; a fake npx records its arguments and environment and never loads the application. */
function run(env: Record<string, string>, code = 0, extra = "") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "psig-prewarm-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"));
    fs.mkdirSync(path.join(root, "bin"));
    fs.copyFileSync(new URL("../scripts/16_prewarm.sh", import.meta.url), path.join(root, "scripts", "16_prewarm.sh"));
    fs.writeFileSync(path.join(root, "bin", "npx"), `#!/usr/bin/env bash
printf 'args=%s\\nmemory=%s\\nns=%s\\n' "$*" "$PSIG_MEMORY_DIR" "$PSIG_ZETARIS_NS" > "$FAKE_OUT"
echo "  · [onboard] onboarded eurostat CP01 -> psig.v_de_food (created 2 SQL objects; 0 already existed; source cached in Zetaris; verified: 26 rows, latest 2026-09)"
echo "  · [sql] Q3: CACHE TABLE psig_eurostat.eurostat_de_prc_hicp_minr_cp01_x"
${extra}
exit ${code}
`, { mode: 0o755 });
    const out = path.join(root, "fake.txt");
    const r = spawnSync("bash", [path.join(root, "scripts", "16_prewarm.sh")], { cwd: root, encoding: "utf8", timeout: 5_000, env: { PATH: `${path.join(root, "bin")}:${process.env.PATH}`, HOME: root, FAKE_OUT: out, ...env } });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, fake: fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "" };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("prewarm refuses to run without the recording namespace", () => {
  const r = run({});
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /PSIG_ZETARIS_NS/);
  assert.equal(r.fake, "");
});

test("prewarm runs the demo question in the recording namespace with its own memory folder and reports what it cached", () => {
  const r = run({ PSIG_ZETARIS_NS: "video1027" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.fake, /args=tsx src\/cli\.ts our gochujang & snacks/);
  assert.match(r.fake, /memory=\.pricesignal\/prewarm-video1027/);
  assert.match(r.fake, /ns=video1027/);
  assert.match(r.stdout, /1 raw source table\(s\) cached in Zetaris/);
});

test("a partial prewarm (an agency down) is reported with the CLI's exit status", () => {
  const r = run({ PSIG_ZETARIS_NS: "video1027" }, 3);
  assert.equal(r.status, 3);
  assert.match(r.stdout + r.stderr, /not every market was covered/i);
});

test("a source that failed to register or cache makes the prewarm fail even when the CLI exits 0", () => {
  const r = run({ PSIG_ZETARIS_NS: "video1027" }, 0, 'echo "  · [onboard] FAILED statcan v41690974 -> psig.v_ca_food: Error: Zetaris HTTP 400"');
  assert.equal(r.status, 4);
  assert.match(r.stderr, /1 source\(s\) failed to register or cache/);
  assert.match(r.stderr, /statcan v41690974/);
});

test("a source registered without a cache is reported too", () => {
  const r = run({ PSIG_ZETARIS_NS: "video1027" }, 0, 'echo "  · [onboard] onboarded abs 20001 -> psig.v_au_food (created 2 SQL objects; 0 already existed; verified: 13 rows, latest 2026-08)"');
  assert.equal(r.status, 4);
  assert.match(r.stderr, /registered without a Zetaris cache/);
  assert.match(r.stderr, /abs 20001/);
});
