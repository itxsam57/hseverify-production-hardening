import assert from "node:assert/strict";
import test from "node:test";

import {
  TENANT_SCOPE_FIXTURE_READ_PERMISSION,
  TENANT_SCOPE_FIXTURE_WRITE_PERMISSION,
  bindTenantPermissionPrincipal,
  createTenantScopeFixtureId,
  deriveTrustedTenantScope,
  normalizeTenantScopeFixtureKey,
  normalizeTenantScopeFixturePayload
} from "../../.authorization-test-dist/authorization/tenant-scoped-resource-domain.js";

function principal(overrides = {}) {
  return {
    sessionId: "session_tenant_scope",
    accountId: "account_tenant_scope",
    activeRole: "company",
    accountStatus: "active",
    email: "tenant-scope@example.com",
    displayName: "Tenant Scope",
    createdAt: "2026-08-05T10:00:00.000Z",
    lastSeenAt: "2026-08-05T10:05:00.000Z",
    expiresAt: "2026-08-05T18:00:00.000Z",
    tenantMembership: {
      tenantId: `tenant_${"T".repeat(24)}`,
      tenantStatus: "active",
      membershipId: `membership_${"M".repeat(24)}`,
      role: "owner",
      status: "active",
      overrides: []
    },
    ...overrides
  };
}

test("accepted permission is bound to the trusted Company tenant principal", () => {
  const bound = bindTenantPermissionPrincipal(
    principal(),
    TENANT_SCOPE_FIXTURE_READ_PERMISSION
  );
  assert.equal(
    bound.authorizedTenantPermission,
    TENANT_SCOPE_FIXTURE_READ_PERMISSION
  );
  assert.deepEqual(deriveTrustedTenantScope(bound), {
    tenantId: `tenant_${"T".repeat(24)}`,
    membershipId: `membership_${"M".repeat(24)}`,
    accountId: "account_tenant_scope",
    sessionId: "session_tenant_scope"
  });
});

test("trusted scope rejects non-Company and inactive tenant state", () => {
  const wrongRole = bindTenantPermissionPrincipal(
    principal({ activeRole: "worker" }),
    TENANT_SCOPE_FIXTURE_READ_PERMISSION
  );
  assert.throws(() => deriveTrustedTenantScope(wrongRole), {
    name: "TenantScopeContractError"
  });

  const suspendedTenant = bindTenantPermissionPrincipal(
    principal({
      tenantMembership: {
        ...principal().tenantMembership,
        tenantStatus: "suspended"
      }
    }),
    TENANT_SCOPE_FIXTURE_WRITE_PERMISSION
  );
  assert.throws(() => deriveTrustedTenantScope(suspendedTenant), {
    name: "TenantScopeContractError"
  });
});

test("fixture identifiers, keys and payloads are deterministic at the boundary", () => {
  assert.match(
    createTenantScopeFixtureId(),
    /^tenantfixture_[A-Za-z0-9_-]{24}$/
  );
  assert.equal(normalizeTenantScopeFixtureKey("  Safety_Record-1  "), "safety_record-1");
  assert.deepEqual(normalizeTenantScopeFixturePayload({ value: 1 }), {
    value: 1
  });
  assert.throws(() => normalizeTenantScopeFixtureKey("bad key"));
  assert.throws(() => normalizeTenantScopeFixturePayload([]));
});
