import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const requiredTests = [
  "assessment-attempt-draft-contract.test.mjs",
  "assessment-attempt-draft-rollback.test.mjs",
  "assessment-attempt-draft-runtime.test.mjs",
  "assessment-attempt-draft-concurrency-runtime.test.mjs",
  "assessment-attempt-draft-service-runtime.test.mjs",
  "assessment-attempt-draft-view-runtime.test.mjs",
  "assessment-attempt-draft-commit-runtime.test.mjs",
  "assessment-attempt-draft-action-boundary.test.mjs",
  "assessment-attempt-draft-ui-contract.test.mjs",
  "assessment-attempt-resume-runtime.test.mjs",
  "assessment-attempt-resume-ui-contract.test.mjs",
  "assessment-attempt-browser-contract.test.mjs",
  "assessment-attempt-ui-contract.test.mjs",
  "assessment-attempt-action-boundary.test.mjs"
];

function read(path) {
  assert.ok(existsSync(path), `Required M2.08 gate file is missing: ${path}`);
  return readFileSync(path, "utf8");
}

test("M2.08 has permanent executable check and test commands", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts?.["check:m2-08"], "node scripts/check-assessment-attempt-drafts.mjs");
  assert.equal(pkg.scripts?.["test:m2-08"], "node scripts/run-assessment-attempt-tests.mjs --m2-08");
  read("scripts/check-assessment-attempt-drafts.mjs");
});

test("test:m2-08 executes every current M2.08 contract, runtime, UI and shared-boundary test", () => {
  const runner = read("scripts/run-assessment-attempt-tests.mjs");
  assert.match(runner, /requested\.has\(["']--m2-08["']\)/);
  for (const file of requiredTests) {
    assert.ok(runner.includes(file), `test:m2-08 must execute ${file}`);
  }
  assert.doesNotMatch(runner, /m2-08-tdd\.yml/);
});
