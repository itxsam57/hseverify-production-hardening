import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const { submitCredentialAppeal, transitionCredentialAppeal } = loadTs("src/lib/credential/credential-appeals-domain.ts");

test("M3.07 rejects invalid appeal completion changes and preserves version boundaries", () => {
  const appeal = submitCredentialAppeal({
    credentialId: "credential_1",
    workerId: "worker_1",
    reason: "decision evidence correction",
    createdAt: "2026-09-15T00:00:00Z"
  }, "security");

  const accepted = transitionCredentialAppeal(appeal, "accepted");
  assert.equal(accepted.version, 2);
  assert.throws(() => transitionCredentialAppeal(accepted, "under_review"));
});
