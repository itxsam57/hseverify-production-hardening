import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function read(path) {
  return readFile(resolve(path), "utf8");
}

test("M2.07 is wired into permanent package and Engineering gates", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const engineeringGate = await read("scripts/run-engineering-gate.mjs");
  const checkScript = await read("scripts/check-assessment-attempt-window.mjs");

  assert.equal(
    packageJson.scripts?.["check:m2-07"],
    "node scripts/check-assessment-attempt-window.mjs"
  );
  assert.equal(
    packageJson.scripts?.["test:m2-07"],
    "node scripts/run-assessment-attempt-tests.mjs"
  );

  assert.match(engineeringGate, /M2\.07 candidate assessment window contract/);
  assert.match(engineeringGate, /scripts\/check-assessment-attempt-window\.mjs/);
  assert.match(engineeringGate, /M2\.07 candidate assessment runtime tests/);
  assert.match(engineeringGate, /scripts\/run-assessment-attempt-tests\.mjs/);

  for (const requiredContract of [
    "assessment-attempt-contract.test.mjs",
    "assessment-attempt-rollback.test.mjs",
    "assessment-attempt-ui-contract.test.mjs",
    "assessment-attempt-action-boundary.test.mjs",
    "assessment-attempt-browser-contract.test.mjs",
    "assessment-attempt-audit-contract.test.mjs"
  ]) {
    assert.match(
      checkScript,
      new RegExp(requiredContract.replaceAll(".", "\\.")),
      `permanent M2.07 check must enforce ${requiredContract}`
    );
  }
});
