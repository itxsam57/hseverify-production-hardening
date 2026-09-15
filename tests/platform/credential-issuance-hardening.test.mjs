import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const { credentialQrPayload, issueCredential } = loadTs("src/lib/credential/credential-issuance-domain.ts");

test("credential QR payload is deterministic and only contains issuance lookup data", () => {
  const payload = JSON.parse(credentialQrPayload("credential_id_test", "/verify/result/credential_id_test"));
  assert.deepEqual(payload, {
    type: "hse_verify_credential",
    credentialId: "credential_id_test",
    url: "/verify/result/credential_id_test"
  });
});

test("credential issuance keeps lifecycle versioning bounded", () => {
  const credential = issueCredential({
    workerId: "private-worker",
    qualification: "Safety",
    issuedAt: "2026-09-15T00:00:00Z",
    expiresAt: null
  }, "bounded-test");
  assert.equal(credential.version, 1);
  assert.equal(credential.status, "valid");
});
