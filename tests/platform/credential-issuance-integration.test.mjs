import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const SIGNING_SECRET = "credential-domain-test-session-secret-more-than-32";
const { issueCredential, transitionCredential, publicCredentialProjection } = loadTs("src/lib/credential/credential-issuance-domain.ts");

test("credential issuance persists through the service boundary and keeps public lifecycle data bounded", async () => {
  const issued = issueCredential({
    workerId: "HSE-WRK-000321",
    qualification: "NEBOSH IGC",
    issuedAt: "2026-09-15T00:00:00Z",
    expiresAt: null
  }, "runtime-test", SIGNING_SECRET);

  assert.equal(issued.status, "valid");
  assert.match(issued.qrPayload, /hse_verify_credential/);

  const revoked = transitionCredential(issued, "revoked", "2026-09-16T00:00:00Z");
  const publicProjection = publicCredentialProjection(revoked);
  assert.equal(publicProjection.status, "revoked");
  assert.equal(publicProjection.version, 2);
  assert.equal("qrPayload" in publicProjection, false);
});

test("public credential projection does not expose worker identity or private issuance payload", async () => {
  const issued = issueCredential({
    workerId: "PRIVATE-WORKER-001",
    qualification: "Safety Certificate",
    issuedAt: "2026-09-15T00:00:00Z",
    expiresAt: null
  }, "security-test", SIGNING_SECRET);

  const projection = publicCredentialProjection(issued);

  assert.equal("workerId" in projection, false);
  assert.equal("qrPayload" in projection, false);
  assert.equal("publicStatusUrl" in projection, false);
  assert.equal(JSON.stringify(projection).includes("PRIVATE-WORKER-001"), false);
});

test("credential projection keeps an unowned worker credential private", async () => {
  const issued = issueCredential({
    workerId: "WORKER-ONE",
    qualification: "Safety Certificate",
    issuedAt: "2026-09-15T00:00:00Z",
    expiresAt: null
  }, "isolation-test", SIGNING_SECRET);

  const projection = publicCredentialProjection(issued);

  assert.equal(projection.credentialId, issued.credentialId);
  assert.equal("workerId" in projection, false);
  assert.equal(JSON.stringify(projection).includes("WORKER-ONE"), false);
});
