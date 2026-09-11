import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORM_PERMISSIONS,
  TENANT_MEMBERSHIP_ROLES,
  TENANT_PERMISSIONS,
  TENANT_STATUSES,
  canAssignTenantRole,
  canGrantTenantRole,
  canSetTenantPermissionOverride,
  createTenantId,
  createTenantMembershipId,
  evaluatePlatformPermission,
  evaluateTenantPermission,
  isPlatformPermission,
  isTenantMembershipRole,
  isTenantPermission,
  isTenantStatus,
  platformPermissionsForRole,
  resolveTenantPermissions,
  roleHasPlatformPermission,
  tenantPermissionsForRole,
  tenantRoleHasPermission
} from "../../.authorization-test-dist/authorization/authorization-domain.js";

const EXPECTED_PLATFORM_GRANTS = {
  worker: ["worker.self.read", "worker.self.manage", "worker.assessments.read"],
  company: ["company.portal.access"],
  assessor: ["interview.assigned.read", "interview.assigned.manage"],
  verifier: ["verification.assigned.read", "verification.assigned.decide"],
  admin: [
    "platform.staff.read",
    "platform.staff.manage",
    "platform.tenants.read",
    "platform.tenants.manage",
    "platform.operations.read",
    "platform.operations.manage",
    "platform.security.read"
  ],
  root: [
    "platform.staff.read",
    "platform.staff.manage",
    "platform.security.read",
    "platform.security.manage",
    "platform.emergency.recover"
  ]
};

const EXPECTED_TENANT_GRANTS = {
  viewer: [
    "company.tenant.read",
    "company.workforce.read",
    "company.orders.read",
    "company.reports.read"
  ],
  manager: [
    "company.tenant.read",
    "company.workforce.read",
    "company.workforce.manage",
    "company.orders.read",
    "company.orders.manage",
    "company.reports.read",
    "company.reports.export"
  ],
  admin: [
    "company.tenant.read",
    "company.settings.manage",
    "company.members.read",
    "company.members.manage",
    "company.workforce.read",
    "company.workforce.manage",
    "company.orders.read",
    "company.orders.manage",
    "company.billing.read",
    "company.billing.manage",
    "company.reports.read",
    "company.reports.export",
    "company.audit.read"
  ],
  owner: [...TENANT_PERMISSIONS]
};

test("permission registries are explicit, unique and wildcard-free", () => {
  assert.equal(new Set(PLATFORM_PERMISSIONS).size, PLATFORM_PERMISSIONS.length);
  assert.equal(new Set(TENANT_PERMISSIONS).size, TENANT_PERMISSIONS.length);
  for (const permission of [...PLATFORM_PERMISSIONS, ...TENANT_PERMISSIONS]) {
    assert.equal(permission.includes("*"), false);
  }
  assert.equal(isPlatformPermission("platform.staff.manage"), true);
  assert.equal(isPlatformPermission("platform.*"), false);
  assert.equal(isTenantPermission("company.workforce.read"), true);
  assert.equal(isTenantPermission("company.*"), false);
});

test("tenant identifiers are opaque, non-sequential and context-prefixed", () => {
  const firstTenant = createTenantId();
  const secondTenant = createTenantId();
  const membership = createTenantMembershipId();
  assert.match(firstTenant, /^tenant_[A-Za-z0-9_-]{24}$/);
  assert.match(secondTenant, /^tenant_[A-Za-z0-9_-]{24}$/);
  assert.match(membership, /^membership_[A-Za-z0-9_-]{24}$/);
  assert.notEqual(firstTenant, secondTenant);
  assert.notEqual(firstTenant, membership);
});

test("tenant lifecycle vocabulary is explicit", () => {
  assert.deepEqual(TENANT_STATUSES, [
    "pending",
    "active",
    "suspended",
    "archived"
  ]);
  for (const status of TENANT_STATUSES) {
    assert.equal(isTenantStatus(status), true);
  }
  assert.equal(isTenantStatus("verified"), false);
});

test("every platform role and permission combination matches the least-privilege matrix", () => {
  for (const [role, expected] of Object.entries(EXPECTED_PLATFORM_GRANTS)) {
    assert.deepEqual(platformPermissionsForRole(role), expected);
    for (const permission of PLATFORM_PERMISSIONS) {
      assert.equal(
        roleHasPlatformPermission(role, permission),
        expected.includes(permission),
        `${role} / ${permission}`
      );
      assert.deepEqual(
        evaluatePlatformPermission({ role, permission }),
        expected.includes(permission)
          ? { allowed: true }
          : { allowed: false, reason: "role_permission_denied" },
        `${role} / ${permission}`
      );
    }
  }
  assert.equal(
    roleHasPlatformPermission("root", "platform.tenants.manage"),
    false
  );
  assert.equal(
    roleHasPlatformPermission("root", "platform.emergency.recover"),
    true
  );
});

test("every tenant role and permission combination matches its explicit ceiling", () => {
  assert.deepEqual(TENANT_MEMBERSHIP_ROLES, [
    "owner",
    "admin",
    "manager",
    "viewer"
  ]);
  for (const role of TENANT_MEMBERSHIP_ROLES) {
    assert.equal(isTenantMembershipRole(role), true);
    const expected = EXPECTED_TENANT_GRANTS[role];
    assert.deepEqual(tenantPermissionsForRole(role), expected);
    for (const permission of TENANT_PERMISSIONS) {
      assert.equal(
        tenantRoleHasPermission(role, permission),
        expected.includes(permission),
        `${role} / ${permission}`
      );
    }
  }
  assert.equal(isTenantMembershipRole("superuser"), false);
  assert.equal(
    tenantRoleHasPermission("admin", "company.members.grant_owner"),
    false
  );
});

test("tenant permission overrides can only narrow or remain inside the role ceiling", () => {
  const narrowed = resolveTenantPermissions("manager", [
    { permission: "company.orders.manage", effect: "deny" }
  ]);
  assert.equal(narrowed.has("company.orders.read"), true);
  assert.equal(narrowed.has("company.orders.manage"), false);

  assert.throws(
    () =>
      resolveTenantPermissions("viewer", [
        { permission: "company.billing.manage", effect: "grant" }
      ]),
    /exceeds the membership role/i
  );
  assert.throws(
    () =>
      resolveTenantPermissions("manager", [
        { permission: "company.orders.read", effect: "deny" },
        { permission: "company.orders.read", effect: "grant" }
      ]),
    /duplicate/i
  );
});

test("tenant authorization rejects role, context, tenant and membership mismatches", () => {
  const baseContext = {
    accountId: "acct_company_member",
    sessionId: "session_company_member",
    activeRole: "company",
    tenantMembership: null
  };

  assert.deepEqual(
    evaluateTenantPermission({
      context: baseContext,
      resourceTenantId: "tenant_alpha",
      permission: "company.tenant.read"
    }),
    { allowed: false, reason: "tenant_context_missing" }
  );

  const activeContext = {
    ...baseContext,
    tenantMembership: {
      tenantId: "tenant_alpha",
      tenantStatus: "active",
      membershipId: "membership_alpha",
      role: "manager",
      status: "active",
      overrides: []
    }
  };

  assert.deepEqual(
    evaluateTenantPermission({
      context: activeContext,
      resourceTenantId: "tenant_beta",
      permission: "company.workforce.read"
    }),
    { allowed: false, reason: "tenant_mismatch" }
  );

  assert.deepEqual(
    evaluateTenantPermission({
      context: {
        ...activeContext,
        tenantMembership: {
          ...activeContext.tenantMembership,
          tenantStatus: "suspended"
        }
      },
      resourceTenantId: "tenant_alpha",
      permission: "company.workforce.read"
    }),
    { allowed: false, reason: "tenant_inactive" }
  );

  assert.deepEqual(
    evaluateTenantPermission({
      context: {
        ...activeContext,
        tenantMembership: {
          ...activeContext.tenantMembership,
          status: "suspended"
        }
      },
      resourceTenantId: "tenant_alpha",
      permission: "company.workforce.read"
    }),
    { allowed: false, reason: "membership_inactive" }
  );

  assert.deepEqual(
    evaluateTenantPermission({
      context: activeContext,
      resourceTenantId: "tenant_alpha",
      permission: "company.billing.manage"
    }),
    { allowed: false, reason: "tenant_permission_denied" }
  );
});

test("membership grants reject self-grant and grant-above-authority", () => {
  assert.equal(canGrantTenantRole("owner", "owner"), true);
  assert.equal(canGrantTenantRole("admin", "owner"), false);
  assert.equal(canGrantTenantRole("admin", "manager"), true);
  assert.equal(canGrantTenantRole("manager", "viewer"), false);
  assert.equal(
    canAssignTenantRole({
      actorMembershipId: "membership_same",
      actorRole: "owner",
      targetMembershipId: "membership_same",
      targetRole: "admin"
    }),
    false
  );
  assert.equal(
    canSetTenantPermissionOverride({
      actorMembershipId: "membership_owner",
      actorRole: "owner",
      targetMembershipId: "membership_viewer",
      targetRole: "viewer",
      permission: "company.billing.manage",
      effect: "grant"
    }),
    false
  );
});
