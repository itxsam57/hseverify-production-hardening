import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtime = process.env.HSE_PUBLIC_VERIFICATION_RUNTIME_DIST;
assert.ok(runtime, "HSE_PUBLIC_VERIFICATION_RUNTIME_DIST is required");

const domain = await import(
  pathToFileURL(
    join(runtime, "public-verification", "public-verification-domain.js")
  ).href
);
const capability = await import(
  pathToFileURL(
    join(runtime, "public-verification", "public-verification-capability.js")
  ).href
);

const WORKER_ID = "worker_id_ABCDEFGHIJKLMNOPQRSTUVWX";
const SECRET = "m1-12-public-verification-test-secret-with-more-than-thirty-two-characters";
const NOW = new Date("2026-08-17T10:00:00.000Z");

function plusMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

function tamper(value) {
  const index = Math.max(1, Math.floor(value.length / 2));
  const replacement = value[index] === "A" ? "B" : "A";
  return `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`;
}

test("M1.12 public status and identifier vocabularies are fixed and bounded", () => {
  assert.deepEqual(domain.PUBLIC_VERIFICATION_STATUSES, [
    "valid",
    "expired",
    "suspended",
    "revoked",
    "not_found_or_invalid",
    "temporarily_unavailable"
  ]);

  assert.deepEqual(
    domain.normalizePublicVerificationIdentifier(`  ${WORKER_ID}  `),
    { kind: "worker", normalizedIdentifier: WORKER_ID }
  );
  assert.equal(domain.normalizePublicVerificationIdentifier("not-an-id"), null);
  assert.equal(domain.normalizePublicVerificationIdentifier("x".repeat(500)), null);

  assert.equal(domain.mapWorkerIdentityStatusToPublicStatus("verified"), "valid");
  assert.equal(domain.mapWorkerIdentityStatusToPublicStatus("reinstated"), "valid");
  assert.equal(domain.mapWorkerIdentityStatusToPublicStatus("expired_document"), "expired");
  assert.equal(domain.mapWorkerIdentityStatusToPublicStatus("suspended"), "suspended");
  for (const privateStatus of [
    "draft",
    "submitted",
    "automated_checks",
    "manual_review",
    "more_info",
    "rejected",
    "escalated",
    "correction_pending",
    "closed",
    "withdrawn",
    "anything_else"
  ]) {
    assert.equal(
      domain.mapWorkerIdentityStatusToPublicStatus(privateStatus),
      "not_found_or_invalid",
      privateStatus
    );
  }
});

test("M1.12 public Worker projection is an allow-list and cannot leak private identity/evidence facts", () => {
  const privateValues = [
    "account_private_1234567890",
    "worker_identity_PRIVATE1234567890AB",
    "identity_version_PRIVATE123456789",
    "1990-01-02",
    "Pakistani",
    "Pakistan",
    "sam.private@example.com",
    "+923001234567",
    "Previous Secret Name",
    "private-employer-name",
    "secure_file_PRIVATE1234567890AB"
  ];

  const projection = domain.projectPublicWorkerVerification(
    {
      permanentWorkerId: WORKER_ID,
      lifecycleStatus: "verified",
      legalFirstName: "Sam",
      legalLastName: "Worker",
      issuedAt: "2026-08-11T09:00:00.000Z",
      workerAccountId: privateValues[0],
      identityId: privateValues[1],
      identityVersionId: privateValues[2],
      dateOfBirth: privateValues[3],
      nationality: privateValues[4],
      countryOfResidence: privateValues[5],
      verifiedEmail: privateValues[6],
      verifiedPhone: privateValues[7],
      previousLegalName: privateValues[8],
      employerName: privateValues[9],
      secureFileId: privateValues[10]
    },
    NOW.toISOString()
  );

  assert.deepEqual(Object.keys(projection).sort(), [
    "competencyTitle",
    "displayName",
    "expiresAt",
    "issuedAt",
    "kind",
    "publicIdentifier",
    "restrictions",
    "status",
    "verifiedAt"
  ]);
  assert.deepEqual(projection, {
    kind: "worker",
    publicIdentifier: WORKER_ID,
    displayName: "Sam Worker",
    status: "valid",
    issuedAt: "2026-08-11T09:00:00.000Z",
    expiresAt: null,
    competencyTitle: null,
    restrictions: [],
    verifiedAt: NOW.toISOString()
  });

  const serialized = JSON.stringify(projection);
  for (const privateValue of privateValues) {
    assert.ok(!serialized.includes(privateValue), privateValue);
  }
});

test("M1.12 public result capability is opaque, purpose-bound, tamper-safe and expires", () => {
  const token = capability.mintPublicVerificationCapability(
    {
      identifierKind: "worker",
      normalizedIdentifier: WORKER_ID
    },
    SECRET,
    NOW
  );

  assert.match(token, /^[A-Za-z0-9_-]{80,900}$/);
  assert.ok(!token.includes(WORKER_ID));
  assert.ok(!token.includes("public-verification-result"));

  assert.deepEqual(
    capability.verifyPublicVerificationCapability(
      token,
      SECRET,
      plusMinutes(NOW, 5)
    ),
    {
      v: 1,
      purpose: "public-verification-result",
      identifierKind: "worker",
      normalizedIdentifier: WORKER_ID,
      issuedAt: NOW.toISOString(),
      expiresAt: plusMinutes(NOW, 10).toISOString()
    }
  );

  assert.equal(
    capability.verifyPublicVerificationCapability(tamper(token), SECRET, NOW),
    null
  );
  assert.equal(
    capability.verifyPublicVerificationCapability(
      token,
      SECRET,
      plusMinutes(NOW, 11)
    ),
    null
  );
  assert.equal(
    capability.verifyPublicVerificationCapability(token, `${SECRET}-wrong`, NOW),
    null
  );
});

test("M1.12 capability input rejects unsupported or oversized authority", () => {
  assert.throws(() =>
    capability.mintPublicVerificationCapability(
      { identifierKind: "worker", normalizedIdentifier: "not-a-worker-id" },
      SECRET,
      NOW
    )
  );
  assert.throws(() =>
    capability.mintPublicVerificationCapability(
      { identifierKind: "worker", normalizedIdentifier: WORKER_ID },
      "short-secret",
      NOW
    )
  );
  assert.equal(
    capability.verifyPublicVerificationCapability("x".repeat(5000), SECRET, NOW),
    null
  );
});