import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const { submitCredentialAppeal, transitionCredentialAppeal, applyCredentialReviewAction } = loadTs("src/lib/credential/credential-appeals-domain.ts");

test("M3.07 appeal lifecycle creates reviewable amendments", () => {
  const appeal = submitCredentialAppeal({
    credentialId: "credential_1",
    workerId: "worker_1",
    reason: "qualification evidence correction",
    evidence: ["evidence_1"],
    createdAt: "2026-09-15T00:00:00Z"
  }, "runtime");
  const accepted = transitionCredentialAppeal(appeal, "accepted");
  assert.equal(accepted.version, 2);
  assert.equal(accepted.evidence.length, 1);
});

test("M3.07 renewal suspension and revocation update credential lifecycle safely", () => {
  assert.equal(applyCredentialReviewAction({ action: "renew", currentStatus: "expired", changedAt: "2026-09-15T00:00:00Z" }).status, "valid");
  assert.equal(applyCredentialReviewAction({ action: "suspend", currentStatus: "valid", changedAt: "2026-09-15T00:00:00Z" }).status, "suspended");
  assert.equal(applyCredentialReviewAction({ action: "revoke", currentStatus: "suspended", changedAt: "2026-09-15T00:00:00Z" }).status, "revoked");
  assert.throws(() => applyCredentialReviewAction({ action: "renew", currentStatus: "revoked", changedAt: "2026-09-15T00:00:00Z" }));
});
