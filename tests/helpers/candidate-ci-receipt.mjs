import assert from "node:assert/strict";

const fullSha = /^[a-f0-9]{40}$/;
const compliance = "Autopilot Compliance / compliance";
const requiredChecks = [
  compliance,
  compliance,
  ...["M1.11", "M1.12", "M2.01", "M2.02", "M2.03", "M2.04"]
    .map(id => id + " targeted TDD gate / " + id.toLowerCase().replace(".", "-")),
  ...["reassessment-continuation / private-browser", "targeted", "release-readiness", "postgres-json",
    ...[1, 2, 3, 4].map(shard => "connected-browser (" + shard + ")"),
    ...[1, 2, 3, 4].map(shard => "consumer-cohorts (" + shard + ")")]
    .map(job => "Masterplan completion QA / " + job)
].sort();

export function verifyCandidateCiReceipt(receipt, expectedSha, stagingSourceSha = expectedSha) {
  assert.match(expectedSha, fullSha, "Expected candidate SHA must be a full commit ID");
  assert.equal(receipt.headRefOid, expectedSha, "CI receipt belongs to a different candidate");
  assert.equal(stagingSourceSha, expectedSha, "Staging artifact source differs from the checked candidate");
  assert.ok(Array.isArray(receipt.statusCheckRollup), "CI receipt has no check rollup");
  const checks = receipt.statusCheckRollup;
  assert.deepEqual(checks.map(check => check.workflowName + " / " + check.name).sort(), requiredChecks,
    "Candidate check inventory is incomplete or unexpected");
  assert.ok(checks.every(check => check.status === "COMPLETED" && check.conclusion === "SUCCESS"),
    "Candidate checks must all complete successfully");
  return { sourceSha: expectedSha, checks: checks.length };
}
