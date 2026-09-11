import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const TEST_ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "authorization-membership-context-test",
  sessionSecret:
    "authorization-membership-session-secret-with-at-least-thirty-two-characters",
  authPepper:
    "authorization-membership-auth-pepper-with-at-least-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function opaqueId(prefix, character) {
  return `${prefix}_${character.repeat(24)}`;
}

test("one Company account has one unambiguous current tenant context", async () => {
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const now = new Date("2026-08-04T12:00:00.000Z").toISOString();
    const accountId = "acct_company_single_context";
    const firstTenantId = opaqueId("tenant", "C");
    const secondTenantId = opaqueId("tenant", "D");
    const firstMembershipId = opaqueId("membership", "C");
    const secondMembershipId = opaqueId("membership", "D");

    await database.query(
      `INSERT INTO auth_accounts (
         account_id, email_normalized, display_name, account_status,
         password_hash, email_verified_at, password_set_at,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
      [
        accountId,
        "single-context@example.com",
        "Single Context",
        "scrypt$16384$8$1$salt$hash",
        now
      ]
    );
    await database.query(
      `INSERT INTO auth_account_roles (account_id, role, created_at)
       VALUES ($1, 'company', $2)`,
      [accountId, now]
    );
    await database.query(
      `INSERT INTO platform_tenants (
         tenant_id, tenant_type, display_name, tenant_status,
         created_at, updated_at, activated_at
       ) VALUES
         ($1, 'company', 'Company Context One', 'active', $3, $3, $3),
         ($2, 'company', 'Company Context Two', 'active', $3, $3, $3)`,
      [firstTenantId, secondTenantId, now]
    );
    await database.query(
      `INSERT INTO auth_tenant_memberships (
         membership_id, tenant_id, account_id, portal_role,
         membership_role, membership_status,
         created_at, updated_at, activated_at
       ) VALUES ($1, $2, $3, 'company', 'admin', 'active', $4, $4, $4)`,
      [firstMembershipId, firstTenantId, accountId, now]
    );

    await assert.rejects(
      database.query(
        `INSERT INTO auth_tenant_memberships (
           membership_id, tenant_id, account_id, portal_role,
           membership_role, membership_status,
           created_at, updated_at
         ) VALUES ($1, $2, $3, 'company', 'viewer', 'invited', $4, $4)`,
        [secondMembershipId, secondTenantId, accountId, now]
      ),
      /auth_current_company_membership_account_idx|unique|duplicate/i
    );

    await database.query(
      `UPDATE auth_tenant_memberships
       SET membership_status = 'revoked',
           revoked_at = $2,
           updated_at = $2
       WHERE membership_id = $1`,
      [firstMembershipId, now]
    );
    await database.query(
      `INSERT INTO auth_tenant_memberships (
         membership_id, tenant_id, account_id, portal_role,
         membership_role, membership_status,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 'company', 'viewer', 'invited', $4, $4)`,
      [secondMembershipId, secondTenantId, accountId, now]
    );

    const current = await database.query(
      `SELECT tenant_id, membership_status
       FROM auth_tenant_memberships
       WHERE account_id = $1
         AND membership_status IN ('invited', 'active', 'suspended')`,
      [accountId]
    );
    assert.deepEqual(current.rows, [
      { tenant_id: secondTenantId, membership_status: "invited" }
    ]);
  } finally {
    await database.close();
  }
});
