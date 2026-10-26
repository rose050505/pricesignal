import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

type Script = "07_ask.sh" | "10_messy.sh" | "14_eu_probe.sh";

/** Copy only the wrapper; fake npx never loads the application, credentials or memory. */
function runFixture(script: Script, codes: number[], teeFails: boolean | number = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "psig-run-script-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"));
    fs.mkdirSync(path.join(root, "bin"));
    fs.copyFileSync(new URL(`../scripts/${script}`, import.meta.url), path.join(root, "scripts", script));
    const callsFile = path.join(root, "calls.txt");
    fs.writeFileSync(callsFile, "");
    fs.writeFileSync(path.join(root, "bin", "npx"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_CALLS"
index=$(wc -l < "$FAKE_CALLS")
codes=($FAKE_EXIT_CODES)
code="\${codes[index-1]:-0}"
printf '# Fixture result %s\\n' "$index"
printf '[fixture] exit %s\\n' "$code" >&2
exit "$code"
`, { mode: 0o755 });
    // The time limit itself is irrelevant to this exit-status test.
    fs.writeFileSync(path.join(root, "bin", "timeout"), '#!/bin/sh\nshift\nexec "$@"\n', { mode: 0o755 });
    const teeCalls = path.join(root, "tee-calls.txt");
    fs.writeFileSync(teeCalls, "");
    const realTee = spawnSync("bash", ["-c", "command -v tee"], { encoding: "utf8" }).stdout.trim();
    if (teeFails) fs.writeFileSync(path.join(root, "bin", "tee"), `#!/bin/sh
printf 'call\\n' >> "$FAKE_TEE_CALLS"
index=$(wc -l < "$FAKE_TEE_CALLS")
if [ "$FAKE_TEE_FAILURE" = 0 ] || [ "$FAKE_TEE_FAILURE" = "$index" ]; then cat; exit 9; fi
exec "$FAKE_REAL_TEE" "$@"
`, { mode: 0o755 });
    const result = spawnSync("bash", [path.join(root, "scripts", script), ...(script === "07_ask.sh" ? ["offline fixture question"] : [])], {
      cwd: root, encoding: "utf8", timeout: 5_000,
      env: { ...process.env, PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH ?? ""}`, FAKE_CALLS: callsFile, FAKE_EXIT_CODES: codes.join(" "), FAKE_TEE_CALLS: teeCalls, FAKE_TEE_FAILURE: String(teeFails === true ? 0 : teeFails), FAKE_REAL_TEE: realTee },
    });
    assert.equal(result.error, undefined);
    const calls = fs.readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean);
    const logs = fs.existsSync(path.join(root, "logs")) ? fs.readdirSync(path.join(root, "logs")).map(name => ({ name, text: fs.readFileSync(path.join(root, "logs", name), "utf8") })) : [];
    return { status: result.status, calls, output: result.stdout + result.stderr, logs };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const script of ["07_ask.sh", "14_eu_probe.sh"] as const) {
  test(`${script} preserves a failed application exit through tee`, () => {
    const result = runFixture(script, [7]);
    assert.equal(result.status, 7);
    assert.equal(result.calls.length, 1);
    assert.match(result.output, /\[fixture\] exit 7/);
    assert.ok(result.logs.some(log => log.text.includes("[fixture] exit 7")));
  });
  test(`${script} reports successful application and log output`, () => {
    const result = runFixture(script, [0]);
    assert.equal(result.status, 0);
    assert.equal(result.calls.length, 1);
    assert.ok(result.logs.some(log => log.text.includes("# Fixture result 1")));
  });
  test(`${script} fails if tee cannot save a successful application's output`, () => {
    const result = runFixture(script, [0], true);
    assert.equal(result.status, 9);
    assert.equal(result.calls.length, 1);
  });
}

test("10_messy.sh succeeds only after all six application runs succeed", () => {
  const result = runFixture("10_messy.sh", [0, 0, 0, 0, 0, 0]);
  assert.equal(result.status, 0);
  assert.equal(result.calls.length, 6);
  assert.equal(result.logs.filter(log => /_q\d+\.log$/.test(log.name)).length, 6);
  const summary = result.logs.find(log => /_summary\.txt$/.test(log.name))!.text;
  assert.equal((summary.match(/exit=0/g) ?? []).length, 6);
});

test("10_messy.sh finishes and summarizes every question but fails if any application run fails", () => {
  for (let failed = 0; failed < 6; failed++) {
    const codes = Array.from({ length: 6 }, (_, index) => index === failed ? 7 : 0);
    const result = runFixture("10_messy.sh", codes);
    assert.notEqual(result.status, 0, `failure at question ${failed + 1}`);
    assert.equal(result.calls.length, 6);
    const summary = result.logs.find(log => /_summary\.txt$/.test(log.name))!.text;
    assert.equal((summary.match(/exit=/g) ?? []).length, 6);
    assert.equal((summary.match(/exit=7/g) ?? []).length, 1);
    assert.match(summary, /Q6:/);
  }
});

test("10_messy.sh does not turn the CLI's incomplete-result status into success", () => {
  const result = runFixture("10_messy.sh", [0, 3, 0, 0, 0, 0]);
  assert.notEqual(result.status, 0);
  assert.equal(result.calls.length, 6);
  assert.ok(result.logs.find(log => /_summary\.txt$/.test(log.name))!.text.includes("exit=3"));
});

test("10_messy.sh remembers an earlier summary write failure even when its final summary succeeds", () => {
  const result = runFixture("10_messy.sh", [0, 0, 0, 0, 0, 0], 4);
  assert.notEqual(result.status, 0);
  assert.equal(result.calls.length, 6);
  assert.match(result.logs.find(log => /_summary\.txt$/.test(log.name))!.text, /Q6:/);
});
