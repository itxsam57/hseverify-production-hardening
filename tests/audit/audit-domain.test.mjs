import assert from "node:assert/strict";
import test from "node:test";

const audit = await import(
  "../../.audit-test-dist/audit/audit-domain.js"
);

function principal(role, tenantMembership = null) {
  return {
    sessionId: `session_${role}`,
    accountId: `account_${role}`,
    activeRole: role,
    accountStatus: "active",
    email: `${role}@example.com`,
    displayName: role,
    createdAt: "2026-08-06T00:00:00.000Z",
    lastSeenAt: "2026-08-06T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    tenantMembership
  };
}

function companyMembership(overrides = []) {
  return {
    tenantId: "tenant_AAAAAAAAAAAAAAAAAAAAAAAA",
    tenantStatus: "active",
    membershipId: "membership_AAAAAAAAAAAAAAAAAAAAAAAA",
    role: "owner",
    status: "active",
    overrides
  };
}

test("audit vocabulary is explicit, wildcard-free and unique", () => {
  assert.equal(new Set(audit.AUDIT_ACTIONS).size, audit.AUDIT_ACTIONS.length);
  assert.equal(new Set(audit.AUDIT_TARGET_TYPES).size, audit.AUDIT_TARGET_TYPES.length);
  for (const action of audit.AUDIT_ACTIONS) {
    assert.doesNotMatch(action, /\*/);
    assert.equal(audit.isAuditAction(action), true);
  }
  assert.deepEqual(audit.AUDIT_OUTCOMES, ["succeeded", "denied", "failed"]);
});

test("trusted actor binding derives authority only from an accepted principal", () => {
  const worker = audit.bindTrustedAuditActor(principal("worker"));
  assert.equal(worker.activeRole, "worker");
  assert.equal(worker.tenantId, null);

  const company = audit.bindTrustedAuditActor(
    principal("company", companyMembership())
  );
  assert.equal(company.tenantId, "tenant_AAAAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(company.membershipId, "membership_AAAAAAAAAAAAAAAAAAAAAAAA");

  assert.throws(
    () => audit.bindTrustedAuditActor(principal("company")),
    audit.AuditContractError
  );
  assert.throws(
    () => audit.bindTrustedAuditActor(
      principal("worker", companyMembership())
    ),
    audit.AuditContractError
  );
  assert.throws(
    () => audit.assertTrustedAuditActor({
      accountId: "forged",
      sessionId: "forged",
      activeRole: "root",
      tenantId: null,
      membershipId: null
    }),
    audit.AuditContractError
  );
});

test("platform audit read binding permits only security-reading fixed roles", () => {
  const admin = audit.bindPlatformAuditReadPrincipal(principal("admin"));
  const root = audit.bindPlatformAuditReadPrincipal(principal("root"));
  assert.equal(audit.derivePlatformAuditReadScope(admin).activeRole, "admin");
  assert.equal(audit.derivePlatformAuditReadScope(root).activeRole, "root");

  for (const role of ["worker", "company", "assessor", "verifier"]) {
    assert.throws(
      () => audit.bindPlatformAuditReadPrincipal(
        role === "company"
          ? principal(role, companyMembership())
          : principal(role)
      ),
      audit.AuditReadDeniedError
    );
  }
});

test("tenant audit read contract respects active permission and explicit deny", () => {
  const allowed = principal("company", companyMembership());
  assert.doesNotThrow(() => audit.assertTenantAuditReadPrincipal(allowed));

  const denied = principal(
    "company",
    companyMembership([
      { permission: "company.audit.read", effect: "deny" }
    ])
  );
  assert.throws(
    () => audit.assertTenantAuditReadPrincipal(denied),
    audit.AuditReadDeniedError
  );
});

test("metadata is bounded, deterministic and rejects credentials recursively", () => {
  const normalized = audit.normalizeAuditMetadata({
    z: 1,
    nested: { safe: true },
    a: ["ok"]
  });
  assert.deepEqual(Object.keys(normalized), ["a", "nested", "z"]);
  assert.equal(Object.isFrozen(normalized), true);

  for (const value of [
    { password: "x" },
    { nested: { sessionToken: "x" } },
    { otpCode: "123456" },
    { authorizationHeader: "Bearer x" }
  ]) {
    assert.throws(
      () => audit.normalizeAuditMetadata(value),
      audit.AuditContractError
    );
  }

  assert.throws(
    () => audit.normalizeAuditMetadata({ safe: "x".repeat(9_000) }),
    audit.AuditContractError
  );
  assert.throws(
    () => audit.normalizeAuditMetadata(["not", "an", "object"]),
    audit.AuditContractError
  );
});

test("reason, target, pagination and identifiers are normalized safely", () => {
  assert.equal(audit.normalizeAuditReason(" ROLE_MISMATCH "), "role_mismatch");
  assert.equal(audit.normalizeAuditReason(null), null);
  assert.throws(() => audit.normalizeAuditReason("raw reason with spaces"));
  assert.deepEqual(
    audit.normalizeAuditTarget({
      type: "portal",
      reference: "/worker/profile"
    }),
    { type: "portal", reference: "/worker/profile" }
  );
  assert.throws(() => audit.normalizeAuditTarget({
    type: "portal",
    reference: "<script>"
  }));
  assert.equal(audit.normalizeAuditLimit(undefined), 50);
  assert.equal(audit.normalizeAuditLimit(100), 100);
  assert.throws(() => audit.normalizeAuditLimit(101));
  assert.equal(audit.normalizeAuditCursor(null), null);
  assert.equal(audit.normalizeAuditCursor(10), 10);
  assert.throws(() => audit.normalizeAuditCursor(0));
  assert.match(audit.createAuditEventId(), /^audit_[A-Za-z0-9_-]{24}$/);
});
