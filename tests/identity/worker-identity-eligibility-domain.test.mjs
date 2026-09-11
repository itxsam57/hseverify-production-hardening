import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtime = process.env.HSE_WORKER_IDENTITY_ELIGIBILITY_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_IDENTITY_ELIGIBILITY_RUNTIME_DIST is required");
const domain = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-eligibility-domain.js")).href
);

function facts(overrides = {}) {
  return Object.freeze({
    identityId: "worker_identity_abcdefghijklmnopqrstuvwx",
    identityVersionId: "identity_version_abcdefghijklmnopqrstuvwx",
    verifiedEmailNormalized: "worker.one@example.com",
    verifiedPhoneE164: "+923001234567",
    legalFirstName: "Hassan",
    legalLastName: "Rasheed",
    dateOfBirth: "1995-04-12",
    documentType: "passport",
    documentNumber: "AB-123 456",
    ...overrides
  });
}

test("S5 eligibility authority is server-created and cannot be forged by object shape", () => {
  const authority = domain.createTrustedWorkerIdentityEligibilityAuthority();
  assert.equal(authority.component, "identity-assurance");
  assert.equal(domain.assertTrustedWorkerIdentityEligibilityAuthority(authority), authority);
  assert.throws(
    () => domain.assertTrustedWorkerIdentityEligibilityAuthority({ component: "identity-assurance" }),
    (error) => error?.name === "WorkerIdentityEligibilityAuthorityError"
  );
});

test("S5 duplicate signals are deterministic, bounded and contain no compared personal values", () => {
  const target = facts();
  const candidates = [
    facts({
      identityId: "worker_identity_bcdefghijklmnopqrstuvwxy",
      identityVersionId: "identity_version_bcdefghijklmnopqrstuvwxy",
      verifiedEmailNormalized: "WORKER.ONE@example.com",
      verifiedPhoneE164: "+923001234567",
      documentNumber: "AB123456",
      legalFirstName: "  HASSAN  ",
      legalLastName: "Rasheed"
    }),
    facts({
      identityId: "worker_identity_cdefghijklmnopqrstuvwxyz",
      identityVersionId: "identity_version_cdefghijklmnopqrstuvwxyz",
      verifiedEmailNormalized: "different@example.com",
      verifiedPhoneE164: "+923009999999",
      documentNumber: "OTHER-999",
      legalFirstName: "Different",
      legalLastName: "Person",
      dateOfBirth: "1990-01-01"
    })
  ];

  const first = domain.evaluateWorkerIdentityDuplicateSignals(target, candidates);
  const second = domain.evaluateWorkerIdentityDuplicateSignals(target, [...candidates].reverse());
  assert.deepEqual(second, first);
  assert.deepEqual(
    first.map((signal) => [signal.signalType, signal.strength]),
    [
      ["verified_email_exact", "high"],
      ["verified_phone_exact", "high"],
      ["identity_document_exact", "high"],
      ["legal_name_dob_exact", "medium"]
    ]
  );
  assert.equal(domain.duplicateCheckStatusFromSignals(first), "review_required");
  const serialized = JSON.stringify(first);
  for (const privateValue of [
    target.verifiedEmailNormalized,
    target.verifiedPhoneE164,
    target.documentNumber,
    target.legalFirstName,
    target.legalLastName,
    target.dateOfBirth
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("S5 duplicate normalization handles only bounded deterministic equivalence", () => {
  assert.equal(domain.normalizeIdentityDocumentNumber(" AB-12 34 "), "AB1234");
  assert.equal(domain.normalizeIdentityLegalName("  HaSSan   Rasheed "), "hassan rasheed");
  assert.throws(() => domain.normalizeIdentityDocumentNumber("a"), /document number is invalid/i);
  assert.throws(() => domain.normalizeIdentityLegalName("\u0000name"), /legal name is invalid/i);

  const target = facts();
  const candidate = facts({
    identityId: "worker_identity_bcdefghijklmnopqrstuvwxy",
    identityVersionId: "identity_version_bcdefghijklmnopqrstuvwxy",
    verifiedEmailNormalized: "other@example.com",
    verifiedPhoneE164: "+923009999999",
    documentType: "national_id"
  });
  const signals = domain.evaluateWorkerIdentityDuplicateSignals(target, [candidate]);
  assert.equal(signals.some((signal) => signal.signalType === "identity_document_exact"), false);
});

test("S5 permanent Worker-ID eligibility is fail-closed for unresolved duplicate dispositions", () => {
  assert.equal(domain.dispositionAllowsPermanentWorkerId("clear", null), true);
  assert.equal(domain.dispositionAllowsPermanentWorkerId("review_required", "continue"), true);
  for (const disposition of [
    null,
    "recover_existing_account",
    "duplicate_review",
    "block_worker_id"
  ]) {
    assert.equal(
      domain.dispositionAllowsPermanentWorkerId("review_required", disposition),
      false
    );
  }
});

test("S5 identifiers and reason codes are opaque and constrained", () => {
  assert.match(domain.createWorkerIdentityDuplicateCheckId(), /^identity_duplicate_check_[A-Za-z0-9_-]{24}$/);
  assert.match(domain.createWorkerIdentityDuplicateSignalId(), /^identity_duplicate_signal_[A-Za-z0-9_-]{24}$/);
  assert.match(domain.createWorkerIdentityDuplicateDispositionId(), /^identity_duplicate_disposition_[A-Za-z0-9_-]{24}$/);
  assert.match(domain.createPermanentWorkerId(), /^worker_id_[A-Za-z0-9_-]{24}$/);
  assert.equal(domain.normalizeWorkerIdentityDuplicateReasonCode(" Duplicate.Cleared "), "duplicate.cleared");
  assert.throws(
    () => domain.normalizeWorkerIdentityDuplicateReasonCode("contains private note"),
    /reason code is invalid/i
  );
});
