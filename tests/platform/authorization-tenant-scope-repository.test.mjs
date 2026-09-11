import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const TEST_ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "tenant-scope-repository-test",
  sessionSecret: "tenant-scope-repository-session-secret-32-characters",
  authPepper: "tenant-scope-repository-auth-pepper-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const NOW = "2026-08-05T12:00:00.000Z";
const EXPIRES = "2099-01-01T00:00:00.000Z";

function opaqueId(prefix, character) {
  return `${prefix}_${character.repeat(24)}`;
}

function extractSql(source, name) {
  const prefix = `export const ${name} = \``;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `${name} must be extractable`);
  const contentStart = start + prefix.length;
  const end = source.indexOf("`;", contentStart);
  assert.notEqual(end, -1, `${name} SQL terminator must be extractable`);
  return source.slice(contentStart, end);
}

async function sqlContracts() {
  const repositorySource = await readFile(
    resolve("src/lib/authorization/tenant-scope-fixture-repository.ts"),
    "utf8"
  );
  const guardSource = await readFile(
    resolve("src/lib/authorization/tenant-scoped-command-guard.ts"),
    "utf8"
  );
  return {
    guard: extractSql(guardSource, "TENANT_COMMAND_SCOPE_SQL"),
    list: extractSql(repositorySource, "TENANT_SCOPE_FIXTURE_LIST_SQL"),
    find: extractSql(repositorySource, "TENANT_SCOPE_FIXTURE_FIND_SQL"),
    insert: extractSql(repositorySource, "TENANT_SCOPE_FIXTURE_INSERT_SQL"),
    update: extractSql(repositorySource, "TENANT_SCOPE_FIXTURE_UPDATE_SQL"),
    delete: extractSql(repositorySource, "TENANT_SCOPE_FIXTURE_DELETE_SQL")
  };
}

async function insertCompanyContext(database, character) {
  const accountId = `account_tenant_scope_${character}`;
  const tenantId = opaqueId("tenant", character);
  const membershipId = opaqueId("membership", character);
  const sessionId = `session_tenant_scope_${character}`;

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
    [
      accountId,
      `tenant-${character.toLowerCase()}@example.com`,
      `Tenant ${character}`,
      "scrypt$16384$8$1$salt$hash",
      NOW
    ]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'company', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO platform_tenants (
       tenant_id, tenant_type, display_name, tenant_status,
       created_by_account_id, created_at, updated_at, activated_at
     ) VALUES ($1, 'company', $2, 'active', $3, $4, $4, $4)`,
    [tenantId, `Tenant Scope ${character}`, accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $3, $4, $4, $4)`,
    [membershipId, tenantId, accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'company', $3, $4, $5, $5, $6)`,
    [sessionId, accountId, `token-${character}`, `csrf-${character}`, NOW, EXPIRES]
  );

  return { accountId, tenantId, membershipId, sessionId };
}

async function insertCompanionOwner(database, context, character) {
  const accountId = `account_tenant_scope_companion_${character}`;
  const membershipId = opaqueId("membership", character);
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
    [
      accountId,
      `tenant-companion-${character.toLowerCase()}@example.com`,
      `Tenant Companion ${character}`,
      "scrypt$16384$8$1$salt$hash",
      NOW
    ]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'company', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $4, $5, $5, $5)`,
    [membershipId, context.tenantId, accountId, context.accountId, NOW]
  );
}

async function guard(database, sql, context, permission) {
  return database.query(sql, [
    context.membershipId,
    context.tenantId,
    context.accountId,
    context.sessionId,
    NOW,
    permission
  ]);
}

test("tenant repository SQL scopes every read and write and returns non-enumerating misses", async () => {
  const sql = await sqlContracts();
  assert.match(sql.list, /WHERE tenant_id = \$1/);
  assert.match(sql.find, /WHERE tenant_id = \$1 AND fixture_id = \$2/);
  assert.match(sql.update, /WHERE tenant_id = \$1[\s\S]*fixture_id = \$2/);
  assert.match(sql.delete, /WHERE tenant_id = \$1 AND fixture_id = \$2/);
  assert.match(sql.insert, /ON CONFLICT \(tenant_id, record_key\) DO NOTHING/);

  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const tenantA = await insertCompanyContext(database, "A");
    const tenantB = await insertCompanyContext(database, "B");

    const allowed = await guard(
      database,
      sql.guard,
      tenantA,
      "company.settings.manage"
    );
    assert.equal(allowed.rows.length, 1);

    const fixtureA = opaqueId("tenantfixture", "A");
    const insertedA = await database.query(sql.insert, [
      fixtureA,
      tenantA.tenantId,
      "shared_key",
      JSON.stringify({ owner: "A" }),
      tenantA.membershipId,
      NOW
    ]);
    assert.equal(insertedA.rows.length, 1);

    const ownFind = await database.query(sql.find, [tenantA.tenantId, fixtureA]);
    const crossTenantFind = await database.query(sql.find, [
      tenantB.tenantId,
      fixtureA
    ]);
    const missingFind = await database.query(sql.find, [
      tenantB.tenantId,
      opaqueId("tenantfixture", "Z")
    ]);
    assert.equal(ownFind.rows.length, 1);
    assert.equal(crossTenantFind.rows.length, 0);
    assert.equal(missingFind.rows.length, 0);
    assert.deepEqual(crossTenantFind.rows, missingFind.rows);

    const listA = await database.query(sql.list, [tenantA.tenantId]);
    const listB = await database.query(sql.list, [tenantB.tenantId]);
    assert.equal(listA.rows.length, 1);
    assert.equal(listB.rows.length, 0);

    const duplicateA = await database.query(sql.insert, [
      opaqueId("tenantfixture", "C"),
      tenantA.tenantId,
      "shared_key",
      JSON.stringify({ duplicate: true }),
      tenantA.membershipId,
      NOW
    ]);
    assert.equal(duplicateA.rows.length, 0);

    const insertedB = await database.query(sql.insert, [
      opaqueId("tenantfixture", "B"),
      tenantB.tenantId,
      "shared_key",
      JSON.stringify({ owner: "B" }),
      tenantB.membershipId,
      NOW
    ]);
    assert.equal(insertedB.rows.length, 1);

    const crossTenantUpdate = await database.query(sql.update, [
      tenantB.tenantId,
      fixtureA,
      "changed_key",
      JSON.stringify({ owner: "B" }),
      1,
      NOW
    ]);
    const crossTenantDelete = await database.query(sql.delete, [
      tenantB.tenantId,
      fixtureA
    ]);
    assert.equal(crossTenantUpdate.rows.length, 0);
    assert.equal(crossTenantDelete.rows.length, 0);

    const ownUpdate = await database.query(sql.update, [
      tenantA.tenantId,
      fixtureA,
      "changed_key",
      JSON.stringify({ owner: "A", updated: true }),
      1,
      "2026-08-05T12:05:00.000Z"
    ]);
    assert.equal(ownUpdate.rows.length, 1);
    assert.equal(ownUpdate.rows[0].version, 2);

    const ownDelete = await database.query(sql.delete, [
      tenantA.tenantId,
      fixtureA
    ]);
    assert.equal(ownDelete.rows.length, 1);
  } finally {
    await database.close();
  }
});

test("transactional command scope revalidates lifecycle and permission after context was issued", async () => {
  const sql = await sqlContracts();
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const context = await insertCompanyContext(database, "D");
    await insertCompanionOwner(database, context, "E");

    assert.equal(
      (await guard(database, sql.guard, context, "company.settings.manage")).rows
        .length,
      1
    );

    await database.query(
      `UPDATE auth_tenant_memberships
       SET membership_status = 'suspended', suspended_at = $2, updated_at = $2
       WHERE membership_id = $1`,
      [context.membershipId, "2026-08-05T12:01:00.000Z"]
    );
    assert.equal(
      (await guard(database, sql.guard, context, "company.settings.manage")).rows
        .length,
      0
    );

    await database.query(
      `UPDATE auth_tenant_memberships
       SET membership_status = 'active', suspended_at = NULL, updated_at = $2
       WHERE membership_id = $1`,
      [context.membershipId, "2026-08-05T12:02:00.000Z"]
    );
    await database.query(
      `INSERT INTO auth_tenant_permission_overrides (
         membership_id, membership_role, permission_key, effect,
         created_by_account_id, reason, created_at
       ) VALUES ($1, 'owner', 'company.settings.manage', 'deny', $2, $3, $4)`,
      [
        context.membershipId,
        context.accountId,
        "Temporary test denial",
        "2026-08-05T12:03:00.000Z"
      ]
    );
    assert.equal(
      (await guard(database, sql.guard, context, "company.settings.manage")).rows
        .length,
      0
    );
  } finally {
    await database.close();
  }
});

test("tenant scope fixture migration is independently reversible", async () => {
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const down = await readFile(
      resolve("database/migrations/0006_authorization_tenant_scope_fixture.down.sql"),
      "utf8"
    );
    const up = await readFile(
      resolve("database/migrations/0006_authorization_tenant_scope_fixture.up.sql"),
      "utf8"
    );

    await database.execute(down);
    const removed = await database.query(
      "SELECT to_regclass('authorization_tenant_scope_fixtures') AS table_name"
    );
    assert.equal(removed.rows[0].table_name, null);

    await database.execute(up);
    const restored = await database.query(
      "SELECT to_regclass('authorization_tenant_scope_fixtures') AS table_name"
    );
    assert.equal(
      restored.rows[0].table_name,
      "authorization_tenant_scope_fixtures"
    );
  } finally {
    await database.close();
  }
});