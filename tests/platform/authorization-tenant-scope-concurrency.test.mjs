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
  releaseSha: "tenant-scope-concurrency-test",
  sessionSecret: "tenant-scope-concurrency-session-secret-32-characters",
  authPepper: "tenant-scope-concurrency-auth-pepper-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const NOW = "2026-08-05T13:00:00.000Z";

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

async function insertContext(database) {
  const accountId = "account_tenant_scope_concurrency";
  const tenantId = opaqueId("tenant", "Q");
  const membershipId = opaqueId("membership", "Q");
  const sessionId = "session_tenant_scope_concurrency";

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
    [
      accountId,
      "tenant-concurrency@example.com",
      "Tenant Concurrency",
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
     ) VALUES ($1, 'company', 'Tenant Concurrency', 'active', $2, $3, $3, $3)`,
    [tenantId, accountId, NOW]
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
    [
      sessionId,
      accountId,
      "token-concurrency",
      "csrf-concurrency",
      NOW,
      "2099-01-01T00:00:00.000Z"
    ]
  );

  return { accountId, tenantId, membershipId, sessionId };
}

test("concurrent same-tenant creates preserve one scoped unique record", async () => {
  const repositorySource = await readFile(
    resolve("src/lib/authorization/tenant-scope-fixture-repository.ts"),
    "utf8"
  );
  const insertSql = extractSql(
    repositorySource,
    "TENANT_SCOPE_FIXTURE_INSERT_SQL"
  );

  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const context = await insertContext(database);

    const results = await Promise.all([
      database.query(insertSql, [
        opaqueId("tenantfixture", "R"),
        context.tenantId,
        "concurrent_key",
        JSON.stringify({ attempt: 1 }),
        context.membershipId,
        NOW
      ]),
      database.query(insertSql, [
        opaqueId("tenantfixture", "S"),
        context.tenantId,
        "concurrent_key",
        JSON.stringify({ attempt: 2 }),
        context.membershipId,
        NOW
      ])
    ]);

    assert.deepEqual(
      results.map((result) => result.rows.length).sort(),
      [0, 1]
    );
    const stored = await database.query(
      `SELECT fixture_id, tenant_id, record_key
       FROM authorization_tenant_scope_fixtures
       WHERE tenant_id = $1 AND record_key = $2`,
      [context.tenantId, "concurrent_key"]
    );
    assert.equal(stored.rows.length, 1);
  } finally {
    await database.close();
  }
});

test("a previously accepted principal cannot mutate after session revocation", async () => {
  const guardSource = await readFile(
    resolve("src/lib/authorization/tenant-scoped-command-guard.ts"),
    "utf8"
  );
  const guardSql = extractSql(guardSource, "TENANT_COMMAND_SCOPE_SQL");

  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const context = await insertContext(database);
    const parameters = [
      context.membershipId,
      context.tenantId,
      context.accountId,
      context.sessionId,
      NOW,
      "company.settings.manage"
    ];

    const before = await database.query(guardSql, parameters);
    assert.equal(before.rows.length, 1);

    await database.query(
      `UPDATE auth_sessions
       SET revoked_at = $2, revocation_reason = 'concurrency_test'
       WHERE session_id = $1`,
      [context.sessionId, "2026-08-05T13:01:00.000Z"]
    );

    const after = await database.query(guardSql, parameters);
    assert.equal(after.rows.length, 0);
  } finally {
    await database.close();
  }
});
