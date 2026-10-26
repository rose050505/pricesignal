import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const source = fs.readFileSync(new URL("../scripts/03_app_setup.sh", import.meta.url), "utf8");
const steps = ["install --no-audit --no-fund", "run setup", "run setup:conformance", "run conformance", "test"];

function fixture(failStep?: string, failureCode = 17) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "psig-setup-script-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"));
    fs.mkdirSync(path.join(root, "bin"));
    fs.writeFileSync(path.join(root, "scripts", "03_app_setup.sh"), source);
    fs.writeFileSync(path.join(root, "bin", "npm"), `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_NPM_CALLS"
if [ "$*" = "$FAKE_NPM_FAIL_STEP" ]; then
  echo "fixture failure: $*"
  exit "$FAKE_NPM_FAIL_CODE"
fi
echo "fixture success: $*"
`, { mode: 0o755 });
    const callsFile = path.join(root, "calls.txt");
    const result = spawnSync("bash", [path.join(root, "scripts", "03_app_setup.sh")], {
      cwd: root,
      encoding: "utf8",
      timeout: 5_000,
      env: { ...process.env, PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH ?? ""}`, FAKE_NPM_CALLS: callsFile, FAKE_NPM_FAIL_STEP: failStep ?? "", FAKE_NPM_FAIL_CODE: String(failureCode) },
    });
    assert.equal(result.error, undefined);
    const calls = fs.readFileSync(callsFile, "utf8").trim().split("\n");
    const log = fs.readFileSync(path.join(root, "logs", "03_app.log"), "utf8");
    return { status: result.status, output: result.stdout + result.stderr, calls, log };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const [index, step] of steps.entries()) {
  test(`setup helper preserves ${step} failure and stops later steps`, () => {
    const code = 17 + index;
    const result = fixture(step, code);
    assert.equal(result.status, code);
    assert.deepEqual(result.calls, steps.slice(0, index + 1));
    assert.match(result.output, /fixture failure:/);
    assert.ok(result.log.includes(`fixture failure: ${step}`));
  });
}

test("setup helper succeeds only after all fake install, conformance and test steps succeed", () => {
  const result = fixture();
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls, steps);
  assert.match(result.log, /CONFORMANCE_EXIT=0/);
  assert.match(result.log, /TEST_EXIT=0/);
});
