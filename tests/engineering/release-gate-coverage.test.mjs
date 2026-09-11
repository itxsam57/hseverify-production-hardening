import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("full release gate executes catalogue eligibility and answer recovery regressions", () => {
  const gate = readFileSync("scripts/run-engineering-gate.mjs", "utf8");
  assert.match(gate, /args: \["--test", "tests\/engineering\/assessment-attempt-runner-isolation\.test\.mjs"\]/);
  assert.match(gate, /args: \["scripts\/run-assessment-catalogue-eligibility-tests\.mjs"\]/);
  assert.match(gate, /args: \["scripts\/run-assessment-attempt-tests\.mjs", "--m2-08"\]/);
});
