import assert from "node:assert/strict";
import test from "node:test";

import {
  PORTAL_ENTRY_PERMISSIONS,
  authorizeCurrentTenantPermission,
  authorizePlatformPermission,
  authorizePortalEntry,
  resolveSessionAuthorizationContext
} from "../../.authorization-test-dist/authorization/authorization-context-domain.js";

const NOW = "2026-08-05T04:00:00.000Z";

function snapshot(overrides = {}) {
  return {
    sessionId: "session_authorization_context",
    accountId: "account_authorization_context",
    activeRole: "worker",
    accountStatus: "active",
    email: "authorization@example.com",
    displayName: "Authorization Context",
    roleAssigned: true,
    createdAt: "2026-08-05T03:00:00.000Z",
    lastSeenAt: "2026-08-05T03:55:00.000Z",
    expiresAt: "2026-08-05T11:00:00.000Z",
    revokedAt: null,
    tenantMembership: null,
    ...overrides
  };
}

function resolve(overrides = {}) {
  return resolveSessionAuthorizationContext({
    snapshot: snapshot(overrides),
    now: NOW
  });
}

function activeMembership(overrides = {}) {
  return {
    tenantId: "tenant_AAAAAAAAAAAAAAAAAAAAAAAA",
    tenantStatus: "active",
    membershipId: "membership_AAAAAAAAAAAAAAAAAAAAAAAA",
    role: "manager",
    status: "active",
    overrides: [],
    ...overrides
  };
}

test("session context fails closed in deterministic lifecycle order", () => {
  assert.deepEqual(
    resolveSessionAuthorizationContext({ snapshot: null, now: NOW }),
    { allowed: false, reason: "unauthenticated", auditContext: null }
  );

  assert.equal(
    resolve({ revokedAt: "2026-08-05T03:59:00.000Z" }).reason,
    "session_revoked"
  );
  assert.equal(resolve({ expiresAt: "not-a-time" }).reason, "session_stale");
  assert.equal(
    resolve({ expiresAt: "2026-08-05T03:59:59.000Z" }).reason,
    "session_expired"
  );
  assert.equal(resolve({ roleAssigned: false }).reason, "session_stale");
  assert.equal(resolve({ accountStatus: "locked" }).reason, "account_inactive");
  assert.equal(
    resolve({
      activeRole: "worker",
      tenantMembership: activeMembership()
    }).reason,
    "session_stale"
  );
  assert.equal(
    resolve({
      activeRole: "company",
      tenantMembership: activeMembership({
        role: "viewer",
        overrides: [
          { permission: "company.billing.manage", effect: "grant" }
        ]
      })
    }).reason,
    "session_stale"
  );
});

test("session timestamps reject impossible ordering and excessive future skew", () => {
  assert.equal(
    resolve({
      createdAt: "2026-08-05T03:30:00.000Z",
      lastSeenAt: "2026-08-05T03:20:00.000Z"
    }).reason,
    "session_stale"
  );
  assert.equal(
    resolve({
      lastSeenAt: "2026-08-05T11:01:00.000Z",
      expiresAt: "2026-08-05T11:00:00.000Z"
    }).reason,
    "session_stale"
  );
  assert.equal(
    resolve({
      createdAt: "2026-08-05T04:06:00.000Z",
      lastSeenAt: "2026-08-05T04:06:00.000Z"
    }).reason,
    "session_stale"
  );
  assert.equal(
    resolve({
      createdAt: "2026-08-05T04:04:00.000Z",
      lastSeenAt: "2026-08-05T04:04:00.000Z"
    }).allowed,
    true
  );
});

test("every fixed portal role uses one canonical allowed entry permission", () => {
  assert.deepEqual(PORTAL_ENTRY_PERMISSIONS, {
    worker: "worker.self.read",
    company: "company.portal.access",
    assessor: "interview.assigned.read",
    verifier: "verification.assigned.read",
    admin: "platform.operations.read",
    root: "platform.security.read"
  });

  for (const [role, permission] of Object.entries(PORTAL_ENTRY_PERMISSIONS)) {
    const resolution = resolve({ activeRole: role });
    assert.equal(resolution.allowed, true, role);
    assert.equal(
      authorizePortalEntry({ resolution, expectedRole: role }).allowed,
      true,
      `${role} / ${permission}`
    );
  }
});

test("platform guards distinguish role mismatch from missing permission", () => {
  const worker = resolve();
  const wrongPortal = authorizePortalEntry({
    resolution: worker,
    expectedRole: "company"
  });
  assert.deepEqual(wrongPortal, {
    allowed: false,
    reason: "role_mismatch",
    auditContext: {
      sessionId: "session_authorization_context",
      accountId: "account_authorization_context",
      activeRole: "worker"
    }
  });

  const missingPermission = authorizePlatformPermission({
    resolution: worker,
    expectedRole: "worker",
    permission: "platform.staff.read"
  });
  assert.equal(missingPermission.allowed, false);
  assert.equal(missingPermission.reason, "permission_denied");
});

test("Company tenant authorization uses only the resolved current membership", () => {
  const missing = authorizeCurrentTenantPermission({
    resolution: resolve({ activeRole: "company" }),
    permission: "company.tenant.read"
  });
  assert.equal(missing.allowed, false);
  assert.equal(missing.reason, "tenant_context_missing");

  const invited = authorizeCurrentTenantPermission({
    resolution: resolve({
      activeRole: "company",
      tenantMembership: activeMembership({ status: "invited" })
    }),
    permission: "company.tenant.read"
  });
  assert.equal(invited.allowed, false);
  assert.equal(invited.reason, "membership_inactive");

  const suspendedTenant = authorizeCurrentTenantPermission({
    resolution: resolve({
      activeRole: "company",
      tenantMembership: activeMembership({ tenantStatus: "suspended" })
    }),
    permission: "company.tenant.read"
  });
  assert.equal(suspendedTenant.allowed, false);
  assert.equal(suspendedTenant.reason, "tenant_inactive");

  const allowed = authorizeCurrentTenantPermission({
    resolution: resolve({
      activeRole: "company",
      tenantMembership: activeMembership()
    }),
    permission: "company.orders.manage"
  });
  assert.equal(allowed.allowed, true);
  assert.equal(
    allowed.principal.tenantMembership.tenantId,
    "tenant_AAAAAAAAAAAAAAAAAAAAAAAA"
  );

  const deniedOverride = authorizeCurrentTenantPermission({
    resolution: resolve({
      activeRole: "company",
      tenantMembership: activeMembership({
        overrides: [
          { permission: "company.orders.manage", effect: "deny" }
        ]
      })
    }),
    permission: "company.orders.manage"
  });
  assert.equal(deniedOverride.allowed, false);
  assert.equal(deniedOverride.reason, "permission_denied");
});

test("non-Company roles cannot acquire tenant authority", () => {
  for (const role of ["worker", "assessor", "verifier", "admin", "root"]) {
    const decision = authorizeCurrentTenantPermission({
      resolution: resolve({ activeRole: role }),
      permission: "company.tenant.read"
    });
    assert.equal(decision.allowed, false, role);
    assert.equal(decision.reason, "tenant_context_missing", role);
  }
});
