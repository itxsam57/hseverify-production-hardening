import assert from "node:assert/strict";
import test from "node:test";

const scans = await import(
  "../../.secure-scan-test-dist/secure-files/secure-file-scan-domain.js"
);
const outbox = await import(
  "../../.secure-scan-test-dist/outbox/outbox-domain.js"
);

const FILE_REF = `secure_file_${"A".repeat(24)}`;
const HASH = "a".repeat(64);

test("secure file scan outbox vocabulary is fixed and payload contains only file reference and generation", () => {
  assert.equal(outbox.OUTBOX_JOB_TYPES.includes("secure_file.scan"), true);
  assert.deepEqual(
    outbox.normalizeOutboxPayload("secure_file.scan", {
      fileRef: FILE_REF,
      generation: 1
    }),
    { fileRef: FILE_REF, generation: 1 }
  );
  for (const payload of [
    { fileRef: FILE_REF },
    { fileRef: FILE_REF, generation: 0 },
    { fileRef: FILE_REF, generation: 1.5 },
    { fileRef: "secure_file_short", generation: 1 },
    { fileRef: FILE_REF, generation: 1, objectKey: "secure-files/abc" },
    { fileRef: FILE_REF, generation: 1, provider: "anything" },
    { fileRef: FILE_REF, generation: 1, contentSha256: HASH }
  ]) {
    assert.throws(
      () => outbox.normalizeOutboxPayload("secure_file.scan", payload),
      outbox.OutboxContractError
    );
  }
});

test("scan business keys are deterministic and separated by content and generation", () => {
  const first = scans.deriveSecureFileScanBusinessKey({
    fileRef: FILE_REF,
    contentSha256: HASH,
    generation: 1
  });
  assert.equal(
    first,
    scans.deriveSecureFileScanBusinessKey({
      fileRef: FILE_REF,
      contentSha256: HASH,
      generation: 1
    })
  );
  assert.notEqual(
    first,
    scans.deriveSecureFileScanBusinessKey({
      fileRef: FILE_REF,
      contentSha256: "b".repeat(64),
      generation: 1
    })
  );
  assert.notEqual(
    first,
    scans.deriveSecureFileScanBusinessKey({
      fileRef: FILE_REF,
      contentSha256: HASH,
      generation: 2
    })
  );
  assert.throws(
    () => scans.deriveSecureFileScanBusinessKey({
      fileRef: FILE_REF,
      contentSha256: HASH,
      generation: 0
    }),
    scans.SecureFileScanContractError
  );
});

test("scanner result vocabulary is bounded and reserves clean exclusively for clean outcomes", () => {
  assert.deepEqual(
    scans.normalizeMalwareScanResult({ kind: "clean", code: "clean" }),
    { kind: "clean", code: "clean" }
  );
  assert.deepEqual(
    scans.normalizeMalwareScanResult({
      kind: "malicious",
      code: " EICAR_TEST_SIGNATURE "
    }),
    { kind: "malicious", code: "eicar_test_signature" }
  );
  for (const value of [
    { kind: "malicious", code: "clean" },
    { kind: "retryable", code: "clean", summary: "Scanner unavailable." },
    { kind: "terminal", code: "clean", summary: "Scanner rejected the object." }
  ]) {
    assert.throws(
      () => scans.normalizeMalwareScanResult(value),
      scans.SecureFileScanContractError
    );
  }
  assert.throws(
    () => scans.normalizeMalwareScanResult({
      kind: "malicious",
      code: "bad code with spaces"
    }),
    scans.SecureFileScanContractError
  );
  assert.throws(
    () => scans.normalizeMalwareScanResult({
      kind: "retryable",
      code: "retry",
      summary: "token secret leaked"
    }),
    scans.SecureFileScanContractError
  );
});

test("scan context bounds generation and outbox attempt number", () => {
  assert.deepEqual(
    scans.normalizeSecureFileScanContext({
      fileRef: FILE_REF,
      generation: 4,
      attemptNumber: 5
    }),
    { fileRef: FILE_REF, generation: 4, attemptNumber: 5 }
  );
  assert.throws(
    () => scans.normalizeSecureFileScanContext({
      fileRef: FILE_REF,
      generation: 1,
      attemptNumber: 6
    }),
    scans.SecureFileScanContractError
  );
});
