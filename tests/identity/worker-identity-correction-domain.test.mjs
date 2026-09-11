import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtime = process.env.HSE_WORKER_IDENTITY_CORRECTION_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_IDENTITY_CORRECTION_RUNTIME_DIST is required");

const domain = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-correction-domain.js")).href
);

const {
  WORKER_IDENTITY_CORRECTION_DECISIONS,
  WorkerIdentityCorrectionConflictError,
  assertTrustedWorkerIdentityCorrectionAuthority,
  createTrustedWorkerIdentityCorrectionAuthority,
  createWorkerIdentityCorrectionDecisionId,
  createWorkerIdentityCorrectionEvidenceOriginId,
  createWorkerIdentityCorrectionRequestId,
  isWorkerIdentityCorrectionDecision,
  normalizeWorkerIdentityCorrectionReason,
  normalizeWorkerIdentityCorrectionReasonCode,
  normalizeWorkerIdentityCorrectionRequestReference
} = domain;

test("S6 correction decision authority is server-created and cannot be forged", () => {
  const authority = createTrustedWorkerIdentityCorrectionAuthority();
  assert.equal(assertTrustedWorkerIdentityCorrectionAuthority(authority), authority);
  assert.throws(
    () =>
      assertTrustedWorkerIdentityCorrectionAuthority({
        component: "identity-assurance"
      }),
    WorkerIdentityCorrectionConflictError
  );
});

test("S6 correction identifiers are opaque and type-separated", () => {
  const request = createWorkerIdentityCorrectionRequestId();
  const decision = createWorkerIdentityCorrectionDecisionId();
  const evidence = createWorkerIdentityCorrectionEvidenceOriginId();
  assert.match(request, /^identity_correction_[A-Za-z0-9_-]{24}$/);
  assert.match(decision, /^correction_decision_[A-Za-z0-9_-]{24}$/);
  assert.match(evidence, /^correction_evidence_[A-Za-z0-9_-]{24}$/);
  assert.equal(normalizeWorkerIdentityCorrectionRequestReference(request), request);
  assert.notEqual(request, createWorkerIdentityCorrectionRequestId());
});

test("S6 correction reason is bounded and strips only harmless surrounding whitespace", () => {
  assert.equal(
    normalizeWorkerIdentityCorrectionReason("  My verified passport number needs correction.  "),
    "My verified passport number needs correction."
  );
  assert.throws(() => normalizeWorkerIdentityCorrectionReason("too short"));
  assert.throws(() => normalizeWorkerIdentityCorrectionReason(`Valid words here but bad\ncontrol`));
  assert.throws(() => normalizeWorkerIdentityCorrectionReason("x".repeat(1001)));
});

test("S6 correction decisions and reason codes are fixed and fail closed", () => {
  assert.deepEqual([...WORKER_IDENTITY_CORRECTION_DECISIONS], ["accepted", "rejected"]);
  assert.equal(isWorkerIdentityCorrectionDecision("accepted"), true);
  assert.equal(isWorkerIdentityCorrectionDecision("rejected"), true);
  assert.equal(isWorkerIdentityCorrectionDecision("approved_by_browser"), false);
  assert.equal(normalizeWorkerIdentityCorrectionReasonCode("  DOCUMENT_CORRECTED  "), "document_corrected");
  assert.throws(() => normalizeWorkerIdentityCorrectionReasonCode("contains secret value"));
});
