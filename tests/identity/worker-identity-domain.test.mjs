import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtime = process.env.HSE_WORKER_IDENTITY_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_IDENTITY_RUNTIME_DIST is required");

const domain = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-domain.js")).href
);

function principal(overrides = {}) {
  return {
    accountId: "account_worker_identity_domain",
    sessionId: "session_worker_identity_domain",
    activeRole: "worker",
    tenantMembership: null,
    accountStatus: "active",
    email: "identity-domain@example.com",
    displayName: "Identity Domain Worker",
    createdAt: "2026-08-10T00:00:00.000Z",
    lastSeenAt: "2026-08-10T00:00:00.000Z",
    expiresAt: "2026-08-11T00:00:00.000Z",
    ...overrides
  };
}

test("canonical Worker identity lifecycle permits only frozen transitions", () => {
  const allowed = new Set([
    "draft->submitted",
    "submitted->automated_checks",
    "submitted->withdrawn",
    "automated_checks->manual_review",
    "automated_checks->more_info",
    "automated_checks->rejected",
    "manual_review->verified",
    "manual_review->more_info",
    "manual_review->rejected",
    "manual_review->escalated",
    "more_info->manual_review",
    "verified->correction_pending",
    "verified->expired_document",
    "verified->suspended",
    "correction_pending->verified",
    "suspended->verified",
    "suspended->reinstated",
    "suspended->closed"
  ]);

  for (const from of domain.WORKER_IDENTITY_STATUSES) {
    for (const to of domain.WORKER_IDENTITY_STATUSES) {
      assert.equal(
        domain.isWorkerIdentityTransitionAllowed(from, to),
        allowed.has(`${from}->${to}`),
        `${from}->${to}`
      );
    }
  }
});

test("Worker self authority is narrower than the complete lifecycle graph", () => {
  assert.doesNotThrow(() => domain.assertWorkerSelfTransition("draft", "submitted"));
  assert.doesNotThrow(() => domain.assertWorkerSelfTransition("submitted", "withdrawn"));
  assert.throws(
    () => domain.assertWorkerSelfTransition("submitted", "automated_checks"),
    (error) => error?.name === "WorkerIdentityTransitionError"
  );
  assert.throws(
    () => domain.assertWorkerSelfTransition("manual_review", "verified"),
    (error) => error?.name === "WorkerIdentityTransitionError"
  );
});

test("identity authority accepts only active non-tenant Worker principals", () => {
  assert.equal(domain.assertWorkerIdentityPrincipal(principal()).activeRole, "worker");
  for (const invalid of [
    principal({ activeRole: "company" }),
    principal({ accountStatus: "locked" }),
    principal({ tenantMembership: { tenantId: "tenant", membershipId: "membership" } }),
    principal({ accountId: "" }),
    principal({ sessionId: "" })
  ]) {
    assert.throws(
      () => domain.assertWorkerIdentityPrincipal(invalid),
      (error) => error?.name === "WorkerIdentityAccessDeniedError"
    );
  }
});

test("identity and version references are opaque server-generated values", () => {
  const identityId = domain.createWorkerIdentityId();
  const versionId = domain.createWorkerIdentityVersionId();
  assert.match(identityId, /^worker_identity_[A-Za-z0-9_-]{24}$/);
  assert.match(versionId, /^identity_version_[A-Za-z0-9_-]{24}$/);
  assert.equal(domain.normalizeWorkerIdentityReference(identityId), identityId);
  assert.equal(domain.normalizeWorkerIdentityVersionReference(versionId), versionId);
  assert.throws(() => domain.normalizeWorkerIdentityReference("worker_identity_user-chosen"));
  assert.throws(() => domain.normalizeWorkerIdentityVersionReference("../../identity"));
  assert.throws(() => domain.normalizeWorkerIdentityLockVersion(0));
  assert.throws(() => domain.normalizeWorkerIdentityVersionNumber(10001));
});
