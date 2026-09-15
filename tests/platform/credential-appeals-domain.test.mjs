import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const { submitCredentialAppeal, transitionCredentialAppeal, applyCredentialOutcomeToLivingRecord } = loadTs("src/lib/credential/credential-appeals-domain.ts");

test("credential appeal preserves evidence and review transitions", () => {
  const appeal = submitCredentialAppeal({ credentialId: "credential_1", workerId: "worker_1", reason: "expiry correction", evidence: ["file_1"], createdAt: "2026-09-15T00:00:00Z" }, "test");
  const accepted = transitionCredentialAppeal(appeal, "accepted");
  assert.equal(accepted.version, 2);
  assert.equal(applyCredentialOutcomeToLivingRecord(accepted.status), "review_required");
});

test("credential appeal validates ownership inputs and protects completed reviews", () => {
  assert.throws(() => submitCredentialAppeal({ credentialId: "", workerId: "w", reason: "x", createdAt: "2026-09-15T00:00:00Z" }, "x"));
  const appeal = submitCredentialAppeal({ credentialId: "c", workerId: "w", reason: "x", createdAt: "2026-09-15T00:00:00Z" }, "x");
  assert.throws(() => transitionCredentialAppeal(transitionCredentialAppeal(appeal, "rejected"), "submitted"));
});
