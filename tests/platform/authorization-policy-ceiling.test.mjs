import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const TEST_ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "authorization-policy-ceiling-test",
  sessionSecret:
    "authorization-policy-session-secret-with-at-least-thirty-two-characters",
  authPepper:
    "authorization-policy-auth-pepper-with-at-least-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
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
  owner: [
    "company.tenant.read",
    "company.settings.manage",
    "company.members.read",
    "company.members.manage",
    "company.members.grant_owner",
    "company.workforce.read",
    "company.workforce.manage",
    "company.orders.read",
    "company.orders.manage",
    "company.billing.read",
    "company.billing.manage",
    "company.reports.read",
    "company.reports.export",
    "company.audit.read"
  ]
};

function expectedRows() {
  return Object.entries(EXPECTED_TENANT_GRANTS)
    .flatMap(([membershipRole, permissions]) =>
      permissions.map((permissionKey) => ({
        membership_role: membershipRole,
        permission_key: permissionKey
      }))
    )
    .sort((left, right) =>
      `${left.membership_role}:${left.permission_key}`.localeCompare(
        `${right.membership_role}:${right.permission_key}`
      )
    );
}

test("SQL tenant permission ceiling exactly matches the accepted role matrix", async () => {
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const result = await database.query(
      `SELECT membership_role, permission_key
       FROM auth_tenant_role_permission_ceiling
       ORDER BY membership_role, permission_key`
    );
    assert.deepEqual(result.rows, expectedRows());
  } finally {
    await database.close();
  }
});
