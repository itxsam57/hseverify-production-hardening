import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyCandidateCiReceipt } from "../helpers/candidate-ci-receipt.mjs";

const names = [
  ["Autopilot Compliance", ["compliance", "compliance"]],
  ...["M1.11", "M1.12", "M2.01", "M2.02", "M2.03", "M2.04"]
    .map(id => [id + " targeted TDD gate", [id.toLowerCase().replace(".", "-")]]),
  ["Masterplan completion QA", ["reassessment-continuation / private-browser", "targeted",
    "release-readiness", "postgres-json", "connected-browser (1)", "connected-browser (2)",
    "connected-browser (3)", "connected-browser (4)", "consumer-cohorts (1)",
    "consumer-cohorts (2)", "consumer-cohorts (3)", "consumer-cohorts (4)"]]
];
const sha = "a".repeat(40);
const receipt = { headRefOid: sha, statusCheckRollup: names.flatMap(([workflowName, jobs]) =>
  jobs.map(name => ({ workflowName, name, status: "COMPLETED", conclusion: "SUCCESS" }))) };

test("exact candidate receipt remains stable through serialization and replay", () => {
  const saved = JSON.stringify(receipt);
  const expected = { sourceSha: sha, checks: 20 };
  assert.deepEqual(verifyCandidateCiReceipt(receipt, sha), expected);
  assert.deepEqual(verifyCandidateCiReceipt(JSON.parse(saved), sha), expected);
  assert.equal(JSON.stringify(receipt), saved);
});

test("wrong source, incomplete inventory and unsuccessful checks cannot certify", () => {
  assert.throws(() => verifyCandidateCiReceipt(receipt, "b".repeat(40)), /different candidate/);
  assert.throws(() => verifyCandidateCiReceipt(receipt, sha, "b".repeat(40)), /Staging artifact source/);
  const missing = structuredClone(receipt);
  missing.statusCheckRollup.pop();
  assert.throws(() => verifyCandidateCiReceipt(missing, sha), /inventory/);
  for (const state of [{ status: "IN_PROGRESS" }, { conclusion: "FAILURE" }, { conclusion: "CANCELLED" }]) {
    const rejected = structuredClone(receipt);
    Object.assign(rejected.statusCheckRollup[0], state);
    assert.throws(() => verifyCandidateCiReceipt(rejected, sha), /complete successfully/);
  }
});

test("compliance workflow declares only repository read permission", () => {
  const workflow = readFileSync(".github/workflows/autopilot-compliance.yml", "utf8");
  assert.match(workflow, /^permissions:\n  contents: read\n\njobs:/m);
  assert.doesNotMatch(workflow, /^\s+\S+: write\s*$/m);
});
