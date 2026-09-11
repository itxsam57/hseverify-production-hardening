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
  releaseSha: "authorization-session-context-test",
  sessionSecret:
    "authorization-session-context-secret-with-at-least-thirty-two-characters",
  authPepper:
    "authorization-session-context-pepper-with-at-least-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function opaqueId(prefix, character) {
  return `${prefix}_${character.repeat(24)}`;
}

async function authorizationContextSql() {
  const source = await readFile(
    resolve("src/lib/authorization/authorization-context-repository.ts"),
    "utf8"
  );
  const match = source.match(
    /export const AUTHORIZATION_CONTEXT_SQL = `([\s\S]*?)`;/
  );
  assert.ok(match, "authorization context SQL constant must be extractable");
  return { source, sql: match[1] };
}

async function insertAccount(database, input) {
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

async function insertSession(database, input) {
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at, revoked_at, revocation_reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9)`,
    [
      input.sessionId,
      input.accountId,
      input.role,
      input.tokenHash,
      `${input.tokenHash}-csrf`,
      input.createdAt,
      input.expiresAt,
      input.revokedAt ?? null,
      input.revokedAt ? "test_revoked" : null
    ]
  );
}

function normalizedJson(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

test("exact repository SQL derives Worker context only from the session token", async () => {
  const { source, sql } = await authorizationContextSql();
  assert.match(source, /BUILD-PIN AUTHZ-SESSION-CONTEXT-QUERY/);
  assert.match(sql, /WHERE sessions\.token_hash = \$1/);
  assert.doesNotMatch(
    sql,
    /\$2|\b(request|header|cookie|form_data|search_params)\b/i
  );
  assert.doesNotMatch(sql, /tenant_id = \$|membership_id = \$/i);

  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const createdAt = "2026-08-05T03:00:00.000Z";
    await insertAccount(database, {
      accountId: "account_context_worker",
      email: "context-worker@example.com",
      displayName: "Context Worker",
      role: "worker",
      now: createdAt
    });
    await insertSession(database, {
      sessionId: "session_context_worker",
      accountId: "account_context_worker",
      role: "worker",
      tokenHash: "token-hash-worker-context",
      createdAt,
      expiresAt: "2026-08-05T11:00:00.000Z"
    });

    const result = await database.query(sql, ["token-hash-worker-context"]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].account_id, "account_context_worker");
    assert.equal(result.rows[0].active_role, "worker");
    assert.equal(result.rows[0].role_assigned, true);
    assert.equal(result.rows[0].membership_id, null);
    assert.equal(result.rows[0].tenant_id, null);
    assert.deepEqual(normalizedJson(result.rows[0].permission_overrides), []);
  } finally {
    await database.close();
  }
});

test("exact repository SQL derives the one current Company membership and overrides", async () => {
  const { sql } = await authorizationContextSql();
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const createdAt = "2026-08-05T03:00:00.000Z";
    const accountId = "account_context_company";
    const tenantId = opaqueId("tenant", "C");
    const membershipId = opaqueId("membership", "C");

    await insertAccount(database, {
      accountId,
      email: "context-company@example.com",
      displayName: "Context Company",
      role: "company",
      now: createdAt
    });
    await database.query(
      `INSERT INTO platform_tenants (
         tenant_id, tenant_type, display_name, tenant_status,
         created_at, updated_at, activated_at
       ) VALUES ($1, 'company', 'Context Company Tenant', 'active', $2, $2, $2)`,
      [tenantId, createdAt]
    );
    await database.query(
      `INSERT INTO auth_tenant_memberships (
         membership_id, tenant_id, account_id, portal_role,
         membership_role, membership_status,
         created_at, updated_at, activated_at
       ) VALUES ($1, $2, $3, 'company', 'manager', 'active', $4, $4, $4)`,
      [membershipId, tenantId, accountId, createdAt]
    );
    await database.query(
      `INSERT INTO auth_tenant_permission_overrides (
         membership_id, membership_role, permission_key,
         effect, reason, created_at
       ) VALUES ($1, 'manager', 'company.orders.manage', 'deny', $2, $3)`,
      [membershipId, "Restricted order management", createdAt]
    );
    await insertSession(database, {
      sessionId: "session_context_company",
      accountId,
      role: "company",
      tokenHash: "token-hash-company-context",
      createdAt,
      expiresAt: "2026-08-05T11:00:00.000Z"
    });

    const result = await database.query(sql, ["token-hash-company-context"]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].tenant_id, tenantId);
    assert.equal(result.rows[0].tenant_status, "active");
    assert.equal(result.rows[0].membership_id, membershipId);
    assert.equal(result.rows[0].membership_role, "manager");
    assert.equal(result.rows[0].membership_status, "active");
    assert.deepEqual(normalizedJson(result.rows[0].permission_overrides), [
      { permission: "company.orders.manage", effect: "deny" }
    ]);
  } finally {
    await database.close();
  }
});

test("repository SQL preserves revoked, expired and inactive state for central denial", async () => {
  const { sql } = await authorizationContextSql();
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const createdAt = "2026-08-05T01:00:00.000Z";

    await insertAccount(database, {
      accountId: "account_context_revoked",
      email: "context-revoked@example.com",
      displayName: "Context Revoked",
      role: "worker",
      now: createdAt
    });
    await insertSession(database, {
      sessionId: "session_context_revoked",
      accountId: "account_context_revoked",
      role: "worker",
      tokenHash: "token-hash-revoked-context",
      createdAt,
      expiresAt: "2026-08-05T10:00:00.000Z",
      revokedAt: "2026-08-05T02:00:00.000Z"
    });

    await insertAccount(database, {
      accountId: "account_context_expired",
      email: "context-expired@example.com",
      displayName: "Context Expired",
      role: "worker",
      now: createdAt
    });
    await insertSession(database, {
      sessionId: "session_context_expired",
      accountId: "account_context_expired",
      role: "worker",
      tokenHash: "token-hash-expired-context",
      createdAt,
      expiresAt: "2026-08-05T02:00:00.000Z"
    });

    await insertAccount(database, {
      accountId: "account_context_disabled",
      email: "context-disabled@example.com",
      displayName: "Context Disabled",
      role: "worker",
      now: createdAt
    });
    await insertSession(database, {
      sessionId: "session_context_disabled",
      accountId: "account_context_disabled",
      role: "worker",
      tokenHash: "token-hash-disabled-context",
      createdAt,
      expiresAt: "2026-08-05T10:00:00.000Z"
    });
    await database.query(
      `UPDATE auth_accounts
       SET account_status = 'disabled', updated_at = $2
       WHERE account_id = $1`,
      ["account_context_disabled", "2026-08-05T02:30:00.000Z"]
    );

    const revoked = await database.query(sql, ["token-hash-revoked-context"]);
    const expired = await database.query(sql, ["token-hash-expired-context"]);
    const disabled = await database.query(sql, ["token-hash-disabled-context"]);

    assert.equal(revoked.rows.length, 1);
    assert.ok(revoked.rows[0].session_revoked_at);
    assert.equal(expired.rows.length, 1);
    assert.equal(
      new Date(expired.rows[0].session_expires_at).toISOString(),
      "2026-08-05T02:00:00.000Z"
    );
    assert.equal(disabled.rows.length, 1);
    assert.equal(disabled.rows[0].account_status, "disabled");
  } finally {
    await database.close();
  }
});

test("authorization integration has one server guard and no client tenant selector", async () => {
  const [service, repository, sessionService] = await Promise.all([
    readFile(resolve("src/lib/authorization/authorization-service.ts"), "utf8"),
    readFile(
      resolve("src/lib/authorization/authorization-context-repository.ts"),
      "utf8"
    ),
    readFile(resolve("src/lib/auth/auth-session-service.ts"), "utf8")
  ]);

  assert.match(service, /BUILD-PIN AUTHZ-SESSION-CENTRAL-GUARD/);
  assert.match(service, /requirePortalAuthorization/);
  assert.match(service, /requirePlatformPermission/);
  assert.match(service, /requireCurrentTenantPermission/);
  assert.match(service, /PORTAL_ENTRY_PERMISSIONS\[expectedRole\]/);
  assert.match(service, /eventType: "access_denied"/);
  assert.doesNotMatch(service, /request\.headers|searchParams|FormData|tenantId:/);

  assert.match(repository, /sessions\.token_hash = \$1/);
  assert.match(repository, /sessions\.active_role = 'company'/);
  assert.match(repository, /memberships\.account_id = sessions\.account_id/);
  assert.doesNotMatch(repository, /tenant_id = \$[0-9]/);

  assert.match(sessionService, /readServerAuthorizationContext/);
  assert.match(sessionService, /requirePortalAuthorization\(expectedRole\)/);
  assert.doesNotMatch(sessionService, /session\.role !== expectedRole/);
  assert.doesNotMatch(sessionService, /portal_role_mismatch/);
});
