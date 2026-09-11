import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import {
  applyPendingMigrations,
  listMigrations,
  migrationStatus,
  rollbackLatestMigration
} from "../../scripts/lib/migrations.mjs";

const TEST_ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "authorization-tenant-foundation-test",
  sessionSecret:
    "authorization-tenant-session-secret-with-at-least-thirty-two-characters",
  authPepper:
    "authorization-tenant-auth-pepper-with-at-least-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function opaqueId(prefix, character) {
  return `${prefix}_${character.repeat(24)}`;
}

async function openMigratedDatabase() {
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
  return database;
}

async function insertActiveAccount(database, input) {
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
    [
      input.accountId,
      input.email,
      input.displayName,
      "scrypt$16384$8$1$salt$hash",
      input.now
    ]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, $2, $3)`,
    [input.accountId, input.role, input.now]
  );
}

test("authorization migration creates tenant and membership security boundaries", async () => {
  const database = await openMigratedDatabase();
  try {
    const tables = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'platform_tenants',
           'auth_tenant_role_permission_ceiling',
           'auth_tenant_memberships',
           'auth_tenant_permission_overrides'
         )
       ORDER BY table_name`
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      [
        "auth_tenant_memberships",
        "auth_tenant_permission_overrides",
        "auth_tenant_role_permission_ceiling",
        "platform_tenants"
      ]
    );

    const ceilingCount = await database.query(
      `SELECT COUNT(*)::integer AS count
       FROM auth_tenant_role_permission_ceiling`
    );
    assert.equal(ceilingCount.rows[0].count, 38);

    const status = await migrationStatus(database);
    const expectedMigrationIds = (await listMigrations()).map(
      (migration) => migration.id
    );
    assert.deepEqual(status.map((entry) => entry.id), expectedMigrationIds);
    assert.equal(status.every((entry) => entry.applied), true);
    assert.equal(status.every((entry) => entry.checksumMatches), true);
  } finally {
    await database.close();
  }
});

test("tenant and membership identifiers reject predictable or malformed values", async () => {
  const database = await openMigratedDatabase();
  try {
    const now = new Date("2026-08-04T12:00:00.000Z").toISOString();
    await insertActiveAccount(database, {
      accountId: "acct_company_identifiers",
      email: "company-identifiers@example.com",
      displayName: "Company Identifiers",
      role: "company",
      now
    });

    await assert.rejects(
      database.query(
        `INSERT INTO platform_tenants (
           tenant_id, tenant_type, display_name, tenant_status,
           created_at, updated_at
         ) VALUES ('tenant_1', 'company', $1, 'pending', $2, $2)`,
        ["Predictable Tenant", now]
      ),
      /platform_tenants_tenant_id_check|check constraint|violates/i
    );

    const tenantId = opaqueId("tenant", "I");
    await database.query(
      `INSERT INTO platform_tenants (
         tenant_id, tenant_type, display_name, tenant_status,
         created_at, updated_at
       ) VALUES ($1, 'company', $2, 'pending', $3, $3)`,
      [tenantId, "Opaque Tenant", now]
    );

    await assert.rejects(
      database.query(
        `INSERT INTO auth_tenant_memberships (
           membership_id, tenant_id, account_id, portal_role,
           membership_role, membership_status, created_at, updated_at
         ) VALUES ('membership_1', $1, $2, 'company', 'viewer', 'invited', $3, $3)`,
        [tenantId, "acct_company_identifiers", now]
      ),
      /auth_tenant_memberships_membership_id_check|check constraint|violates/i
    );
  } finally {
    await database.close();
  }
});

test("only assigned Company accounts can hold current tenant membership", async () => {
  const database = await openMigratedDatabase();
  try {
    const now = new Date("2026-08-04T12:00:00.000Z").toISOString();
    const tenantId = opaqueId("tenant", "A");
    await insertActiveAccount(database, {
      accountId: "acct_company_member",
      email: "company-member@example.com",
      displayName: "Company Member",
      role: "company",
      now
    });
    await insertActiveAccount(database, {
      accountId: "acct_worker_member",
      email: "worker-member@example.com",
      displayName: "Worker Member",
      role: "worker",
      now
    });

    await database.query(
      `INSERT INTO platform_tenants (
         tenant_id, tenant_type, display_name, tenant_status,
         created_by_account_id, created_at, updated_at, activated_at
       ) VALUES ($1, 'company', $2, 'active', $3, $4, $4, $4)`,
      [tenantId, "Company Alpha", "acct_company_member", now]
    );

    await assert.rejects(
      database.query(
        `INSERT INTO auth_tenant_memberships (
           membership_id, tenant_id, account_id, portal_role,
           membership_role, membership_status, created_at, updated_at, activated_at
         ) VALUES ($1, $2, $3, 'company', 'viewer', 'active', $4, $4, $4)`,
        [
          opaqueId("membership", "W"),
          tenantId,
          "acct_worker_member",
          now
        ]
      ),
      /auth_tenant_membership_company_role_fk|foreign key|violates/i
    );

    await database.query(
      `INSERT INTO auth_tenant_memberships (
         membership_id, tenant_id, account_id, portal_role,
         membership_role, membership_status, created_at, updated_at, activated_at
       ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $4, $4, $4)`,
      [
        opaqueId("membership", "O"),
        tenantId,
        "acct_company_member",
        now
      ]
    );

    await assert.rejects(
      database.query(
        `INSERT INTO auth_tenant_memberships (
           membership_id, tenant_id, account_id, portal_role,
           membership_role, membership_status, created_at, updated_at, activated_at
         ) VALUES ($1, $2, $3, 'company', 'viewer', 'active', $4, $4, $4)`,
        [
          opaqueId("membership", "D"),
          tenantId,
          "acct_company_member",
          now
        ]
      ),
      /auth_current_tenant_membership_idx|unique|duplicate/i
    );
  } finally {
    await database.close();
  }
});

test("tenant and membership lifecycle constraints reject contradictory state", async () => {
  const database = await openMigratedDatabase();
  try {
    const now = new Date("2026-08-04T12:00:00.000Z").toISOString();
    await insertActiveAccount(database, {
      accountId: "acct_company_lifecycle",
      email: "company-lifecycle@example.com",
      displayName: "Company Lifecycle",
      role: "company",
      now
    });

    await assert.rejects(
      database.query(
        `INSERT INTO platform_tenants (
           tenant_id, tenant_type, display_name, tenant_status,
           created_at, updated_at
         ) VALUES ($1, 'company', $2, 'active', $3, $3)`,
        [opaqueId("tenant", "X"), "Invalid Active", now]
      ),
      /platform_tenants_state_check|check constraint|violates/i
    );

    const pendingTenantId = opaqueId("tenant", "P");
    await database.query(
      `INSERT INTO platform_tenants (
         tenant_id, tenant_type, display_name, tenant_status,
         created_at, updated_at
       ) VALUES ($1, 'company', $2, 'pending', $3, $3)`,
      [pendingTenantId, "Pending Company", now]
    );

    await assert.rejects(
      database.query(
        `INSERT INTO auth_tenant_memberships (
           membership_id, tenant_id, account_id, portal_role,
           membership_role, membership_status, created_at, updated_at
         ) VALUES ($1, $2, $3, 'company', 'admin', 'active', $4, $4)`,
        [
          opaqueId("membership", "L"),
          pendingTenantId,
          "acct_company_lifecycle",
          now
        ]
      ),
      /auth_tenant_membership_state_check|check constraint|violates/i
    );
  } finally {
    await database.close();
  }
});

test("permission overrides reject wildcard, role mismatch, grant-above-ceiling and duplicates", async () => {
  const database = await openMigratedDatabase();
  try {
    const now = new Date("2026-08-04T12:00:00.000Z").toISOString();
    const tenantId = opaqueId("tenant", "R");
    const membershipId = opaqueId("membership", "R");
    await insertActiveAccount(database, {
      accountId: "acct_company_override",
      email: "company-override@example.com",
      displayName: "Company Override",
      role: "company",
      now
    });
    await database.query(
      `INSERT INTO platform_tenants (
         tenant_id, tenant_type, display_name, tenant_status,
         created_at, updated_at, activated_at
       ) VALUES ($1, 'company', $2, 'active', $3, $3, $3)`,
      [tenantId, "Override Company", now]
    );
    await database.query(
      `INSERT INTO auth_tenant_memberships (
         membership_id, tenant_id, account_id, portal_role,
         membership_role, membership_status, created_at, updated_at, activated_at
       ) VALUES ($1, $2, $3, 'company', 'manager', 'active', $4, $4, $4)`,
      [membershipId, tenantId, "acct_company_override", now]
    );

    await assert.rejects(
      database.query(
        `INSERT INTO auth_tenant_permission_overrides (
           membership_id, membership_role, permission_key,
           effect, reason, created_at
         ) VALUES ($1, 'manager', $2, 'grant', $3, $4)`,
        [membershipId, "company.*", "No wildcard permission", now]
      ),
      /auth_tenant_permission_overrides_permission_key_check|check constraint|violates/i
    );

    await assert.rejects(
      database.query(
        `INSERT INTO auth_tenant_permission_overrides (
           membership_id, membership_role, permission_key,
           effect, reason, created_at
         ) VALUES ($1, 'viewer', 'company.orders.read', 'deny', $2, $3)`,
        [membershipId, "Wrong membership role", now]
      ),
      /auth_tenant_permission_membership_role_fk|foreign key|violates/i
    );

    await assert.rejects(
      database.query(
        `INSERT INTO auth_tenant_permission_overrides (
           membership_id, membership_role, permission_key,
           effect, reason, created_at
         ) VALUES ($1, 'manager', 'company.billing.manage', 'grant', $2, $3)`,
        [membershipId, "Grant above manager ceiling", now]
      ),
      /auth_tenant_permission_role_ceiling_fk|foreign key|violates/i
    );

    await database.query(
      `INSERT INTO auth_tenant_permission_overrides (
         membership_id, membership_role, permission_key,
         effect, reason, created_at
       ) VALUES ($1, 'manager', 'company.orders.manage', 'deny', $2, $3)`,
      [membershipId, "Restricted order authority", now]
    );

    await assert.rejects(
      database.query(
        `INSERT INTO auth_tenant_permission_overrides (
           membership_id, membership_role, permission_key,
           effect, reason, created_at
         ) VALUES ($1, 'manager', 'company.orders.manage', 'grant', $2, $3)`,
        [membershipId, "Conflicting duplicate override", now]
      ),
      /auth_tenant_permission_overrides_pkey|unique|duplicate/i
    );
  } finally {
    await database.close();
  }
});

test("authorization migration rolls back independently and reapplies cleanly", async () => {
  const database = await openMigratedDatabase();
  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  try {
    const migrationIds = (await listMigrations()).map(
      (migration) => migration.id
    );
    const notificationIndex = migrationIds.indexOf(
      "0009_persisted_notifications"
    );
    assert.ok(notificationIndex >= 0);
    for (const newerMigration of migrationIds
      .slice(notificationIndex + 1)
      .reverse()) {
      const newerRollback = await rollbackLatestMigration(
        database,
        TEST_ENVIRONMENT
      );
      assert.equal(newerRollback, newerMigration);
    }

    const notificationRollback = await rollbackLatestMigration(
      database,
      TEST_ENVIRONMENT
    );
    assert.equal(notificationRollback, "0009_persisted_notifications");

    const tenantAfterNotificationRollback = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'platform_tenants'`
    );
    const outboxAfterNotificationRollback = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'platform_outbox_jobs'`
    );
    const notificationTableRemoved = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'platform_notifications'`
    );
    assert.equal(tenantAfterNotificationRollback.rows.length, 1);
    assert.equal(outboxAfterNotificationRollback.rows.length, 1);
    assert.equal(notificationTableRemoved.rows.length, 0);

    const outboxRollback = await rollbackLatestMigration(
      database,
      TEST_ENVIRONMENT
    );
    assert.equal(outboxRollback, "0008_transactional_outbox_jobs");

    const tenantAfterOutboxRollback = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'platform_tenants'`
    );
    const outboxTableRemoved = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'platform_outbox_jobs'`
    );
    assert.equal(tenantAfterOutboxRollback.rows.length, 1);
    assert.equal(outboxTableRemoved.rows.length, 0);

    const auditRollback = await rollbackLatestMigration(
      database,
      TEST_ENVIRONMENT
    );
    assert.equal(auditRollback, "0007_platform_audit_foundation");

    const tenantAfterAuditRollback = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'platform_tenants'`
    );
    const auditTableRemoved = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'platform_audit_events'`
    );
    assert.equal(tenantAfterAuditRollback.rows.length, 1);
    assert.equal(auditTableRemoved.rows.length, 0);

    const tenantScopeRollback = await rollbackLatestMigration(
      database,
      TEST_ENVIRONMENT
    );
    assert.equal(tenantScopeRollback, "0006_authorization_tenant_scope_fixture");

    const tenantTableStillPresent = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'platform_tenants'`
    );
    const fixtureTableRemoved = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'authorization_tenant_scope_fixtures'`
    );
    assert.equal(tenantTableStillPresent.rows.length, 1);
    assert.equal(fixtureTableRemoved.rows.length, 0);

    const authorizationRollback = await rollbackLatestMigration(
      database,
      TEST_ENVIRONMENT
    );
    assert.equal(authorizationRollback, "0005_authorization_tenant_isolation");

    const tenantTable = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'platform_tenants'`
    );
    const ceilingTable = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'auth_tenant_role_permission_ceiling'`
    );
    const authTable = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'auth_accounts'`
    );
    assert.equal(tenantTable.rows.length, 0);
    assert.equal(ceilingTable.rows.length, 0);
    assert.equal(authTable.rows.length, 1);

    const reapplied = await applyPendingMigrations(
      database,
      TEST_ENVIRONMENT.releaseSha
    );
    const authorizationIndex = migrationIds.indexOf(
      "0005_authorization_tenant_isolation"
    );
    assert.ok(authorizationIndex >= 0);
    assert.deepEqual(reapplied, migrationIds.slice(authorizationIndex));
  } finally {
    if (previous === undefined) {
      delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    } else {
      process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    }
    await database.close();
  }
});

test("authorization source keeps permission and tenant boundaries explicit", async () => {
  const [domain, migration] = await Promise.all([
    readFile(
      resolve("src/lib/authorization/authorization-domain.ts"),
      "utf8"
    ),
    readFile(
      resolve("database/migrations/0005_authorization_tenant_isolation.up.sql"),
      "utf8"
    )
  ]);

  for (const marker of [
    "PLATFORM_PERMISSIONS",
    "TENANT_PERMISSIONS",
    "ROLE_PLATFORM_PERMISSION_GRANTS",
    "TENANT_ROLE_PERMISSION_GRANTS",
    "createTenantId",
    "createTenantMembershipId",
    "evaluatePlatformPermission",
    "evaluateTenantPermission",
    "canGrantTenantRole",
    "canSetTenantPermissionOverride"
  ]) {
    assert.match(domain, new RegExp(marker));
  }
  assert.doesNotMatch(
    domain,
    /["'`]\*\.[^"'`]*["'`]|["'`][^"'`]*\.\*["'`]/
  );

  for (const marker of [
    "platform_tenants",
    "auth_tenant_role_permission_ceiling",
    "auth_tenant_memberships",
    "auth_tenant_permission_overrides",
    "auth_tenant_membership_company_role_fk",
    "auth_current_tenant_membership_idx",
    "auth_tenant_permission_membership_role_fk",
    "auth_tenant_permission_role_ceiling_fk",
    "permission_key NOT LIKE '%*%'",
    "^tenant_[A-Za-z0-9_-]{24}$",
    "^membership_[A-Za-z0-9_-]{24}$"
  ]) {
    assert.match(
      migration,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  }
});
