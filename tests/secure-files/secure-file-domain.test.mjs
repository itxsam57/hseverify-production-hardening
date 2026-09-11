import assert from "node:assert/strict";
import test from "node:test";

const secureFiles = await import(
  "../../.secure-file-test-dist/secure-files/secure-file-domain.js"
);

function principal(overrides = {}) {
  return {
    sessionId: "session_secure_file_worker",
    accountId: "account_secure_file_worker",
    activeRole: "worker",
    accountStatus: "active",
    email: "worker@example.com",
    displayName: "Secure File Worker",
    createdAt: "2026-08-09T00:00:00.000Z",
    lastSeenAt: "2026-08-09T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    tenantMembership: null,
    ...overrides
  };
}

function companyPrincipal(overrides = {}) {
  return principal({
    sessionId: "session_secure_file_company",
    accountId: "account_secure_file_company",
    activeRole: "company",
    tenantMembership: {
      tenantId: `tenant_${"A".repeat(24)}`,
      tenantStatus: "active",
      membershipId: `membership_${"B".repeat(24)}`,
      role: "owner",
      status: "active",
      overrides: []
    },
    ...overrides
  });
}

test("secure file vocabulary is fixed and local-test storage is the only adapter", () => {
  assert.deepEqual(secureFiles.SECURE_FILE_STORAGE_ADAPTER_KEYS, ["local_test"]);
  assert.deepEqual(secureFiles.SECURE_FILE_LIFECYCLE_STATUSES, [
    "reserved",
    "quarantined",
    "scan_pending",
    "available",
    "unsafe",
    "scan_failed"
  ]);
});

test("display filename is bounded metadata and rejects path authority", () => {
  assert.equal(
    secureFiles.normalizeSecureFileDisplayFilename("  certificate.pdf  "),
    "certificate.pdf"
  );
  for (const value of [
    "../certificate.pdf",
    "folder/certificate.pdf",
    "folder\\certificate.pdf",
    ".",
    "..",
    "bad\u0000name.pdf",
    "x".repeat(181)
  ]) {
    assert.throws(
      () => secureFiles.normalizeSecureFileDisplayFilename(value),
      secureFiles.SecureFileContractError
    );
  }
});

test("trusted owner capabilities cannot be forged by copying branded fields", () => {
  const owner = secureFiles.bindTrustedSecureFileOwner(principal());
  assert.equal(secureFiles.assertTrustedSecureFileOwner(owner), owner);
  const forged = { ...owner };
  assert.throws(
    () => secureFiles.assertTrustedSecureFileOwner(forged),
    secureFiles.SecureFileAccessDeniedError
  );
});

test("Company ownership requires active trusted tenant context and non-Company cannot carry it", () => {
  const company = secureFiles.bindTrustedSecureFileOwner(companyPrincipal());
  assert.match(company.tenantId, /^tenant_/);
  assert.throws(
    () => secureFiles.bindTrustedSecureFileOwner(companyPrincipal({
      tenantMembership: {
        ...companyPrincipal().tenantMembership,
        status: "revoked"
      }
    })),
    secureFiles.SecureFileAccessDeniedError
  );
  assert.throws(
    () => secureFiles.bindTrustedSecureFileOwner(principal({
      tenantMembership: companyPrincipal().tenantMembership
    })),
    secureFiles.SecureFileAccessDeniedError
  );
});

test("reservation keys are deterministic but separated by trusted owner scope", () => {
  const worker = secureFiles.bindTrustedSecureFileOwner(principal());
  const workerIntent = secureFiles.createSecureFileReservationIntent({
    owner: worker,
    businessReference: "identity.front.v1",
    displayFilename: "passport.pdf"
  });
  const repeated = secureFiles.createSecureFileReservationIntent({
    owner: worker,
    businessReference: "identity.front.v1",
    displayFilename: "passport.pdf"
  });
  const company = secureFiles.bindTrustedSecureFileOwner(companyPrincipal());
  const companyIntent = secureFiles.createSecureFileReservationIntent({
    owner: company,
    businessReference: "identity.front.v1",
    displayFilename: "passport.pdf"
  });

  assert.equal(workerIntent.reservationKey, repeated.reservationKey);
  assert.notEqual(workerIntent.reservationKey, companyIntent.reservationKey);
  assert.match(workerIntent.reservationKey, /^[a-f0-9]{64}$/);

  const forged = { ...workerIntent };
  assert.throws(
    () => secureFiles.assertTrustedSecureFileReservationIntent(forged),
    secureFiles.SecureFileContractError
  );
});

test("server-generated file ids map to opaque fixed-root object keys", () => {
  const fileId = secureFiles.createSecureFileId();
  const key = secureFiles.deriveSecureFileObjectKey(fileId);
  assert.match(fileId, /^secure_file_[A-Za-z0-9_-]{24}$/);
  assert.match(key, /^secure-files\/[a-f0-9]{64}$/);
  assert.doesNotMatch(key, /passport|identity|worker/i);
  assert.equal(secureFiles.normalizeSecureFileReference(fileId), fileId);
  for (const value of ["../secure_file_bad", "secure-files/abc", "secure_file_short"] ) {
    assert.equal(secureFiles.normalizeSecureFileReference(value), null);
  }
});

test("query cursor and limit are bounded", () => {
  assert.equal(secureFiles.normalizeSecureFileCursor(undefined), null);
  assert.equal(secureFiles.normalizeSecureFileLimit(undefined), 50);
  assert.equal(secureFiles.normalizeSecureFileLimit(100), 100);
  assert.throws(() => secureFiles.normalizeSecureFileCursor(0), secureFiles.SecureFileContractError);
  assert.throws(() => secureFiles.normalizeSecureFileLimit(101), secureFiles.SecureFileContractError);
});
