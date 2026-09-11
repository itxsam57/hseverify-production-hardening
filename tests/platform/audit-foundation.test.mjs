import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "audit-foundation-test",
  sessionSecret: "audit-foundation-session-secret-32-characters",
  authPepper: "audit-foundation-auth-pepper-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};
const NOW = "2026-08-06T08:00:00.000Z";
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

async function contracts() {
  const source = await readFile(
    resolve("src/lib/audit/audit-repository.ts"),
    "utf8"
  );
  return {
    append: extractSql(source, "AUDIT_APPEND_SQL"),
    platformList: extractSql(source, "AUDIT_PLATFORM_LIST_SQL"),
    platformFind: extractSql(source, "AUDIT_PLATFORM_FIND_SQL"),
    tenantList: extractSql(source, "AUDIT_TENANT_LIST_SQL"),
    tenantFind: extractSql(source, "AUDIT_TENANT_FIND_SQL")
  };
}

async function insertCompany(database, character) {
  const accountId = `account_audit_${character}`;
  const tenantId = opaqueId("tenant", character);
  const membershipId = opaqueId("membership", character);
  const sessionId = `session_audit_${character}`;

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
    [
      accountId,
      `audit-${character.toLowerCase()}@example.com`,
      `Audit ${character}`,
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
    [tenantId, `Audit Tenant ${character}`, accountId, NOW]
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

test("legacy authentication events mirror transactionally into the immutable audit store", async () => {
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    const tenant = await insertCompany(database, "A");
    const eventId = `event_${"A".repeat(24)}`;

    await database.query(
      `INSERT INTO auth_security_events (
         event_id, account_id, event_type, active_role,
         request_fingerprint_hash, metadata, occurred_at
       ) VALUES ($1, $2, 'access_denied', 'company', $3, $4::jsonb, $5)`,
      [
        eventId,
        tenant.accountId,
        "fingerprint-hash",
        JSON.stringify({
          reason: "tenant_mismatch",
          sessionId: tenant.sessionId,
          token: "must-not-be-copied",
          safeContext: "copied"
        }),
        NOW
      ]
    );

    const result = await database.query(
      `SELECT source_kind, source_event_id, actor_account_id, actor_role,
              actor_tenant_id, actor_membership_id, action_key, outcome,
              reason_key, target_type, target_reference, metadata, occurred_at
       FROM platform_audit_events
       WHERE source_kind = 'auth_security_event' AND source_event_id = $1`,
      [eventId]
    );
    assert.equal(result.rows.length, 1);
    const row = result.rows[0];
    assert.equal(row.actor_tenant_id, tenant.tenantId);
    assert.equal(row.actor_membership_id, tenant.membershipId);
    assert.equal(row.action_key, "authorization.access.denied");
    assert.equal(row.outcome, "denied");
    assert.equal(row.reason_key, "tenant_mismatch");
    assert.equal(row.target_type, "portal");
    assert.equal(row.target_reference, tenant.sessionId);
    assert.equal(row.metadata.safeContext, "copied");
    assert.equal("token" in row.metadata, false);

    const duplicate = await database.query(
      `SELECT COUNT(*)::int AS count
       FROM platform_audit_events
       WHERE source_kind = 'auth_security_event' AND source_event_id = $1`,
      [eventId]
    );
    assert.equal(Number(duplicate.rows[0].count), 1);
  } finally {
    await database.close();
  }
});

test("native append uses database timestamps and every update/delete is rejected", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    const tenant = await insertCompany(database, "B");
    const eventId = opaqueId("audit", "B");

    const inserted = await database.query(sql.append, [
      eventId,
      tenant.accountId,
      "company",
      tenant.tenantId,
      tenant.membershipId,
      "authorization.access.denied",
      "denied",
      "permission_denied",
      "resource",
      "resource_B",
      null,
      JSON.stringify({ safe: true })
    ]);
    assert.equal(inserted.rows.length, 1);
    assert.equal(inserted.rows[0].audit_event_id, eventId);
    assert.ok(inserted.rows[0].occurred_at);
    assert.ok(inserted.rows[0].recorded_at);

    await assert.rejects(
      database.query(
        "UPDATE platform_audit_events SET reason_key = 'changed' WHERE audit_event_id = $1",
        [eventId]
      ),
      /append-only/
    );
    await assert.rejects(
      database.query(
        "DELETE FROM platform_audit_events WHERE audit_event_id = $1",
        [eventId]
      ),
      /append-only/
    );

    const retained = await database.query(
      "SELECT reason_key FROM platform_audit_events WHERE audit_event_id = $1",
      [eventId]
    );
    assert.equal(retained.rows[0].reason_key, "permission_denied");
  } finally {
    await database.close();
  }
});

test("tenant SQL scopes in the database and cross-tenant find is non-enumerating", async () => {
  const sql = await contracts();
  assert.match(sql.tenantList, /WHERE actor_tenant_id = \$1/);
  assert.match(
    sql.tenantFind,
    /WHERE actor_tenant_id = \$1[\s\S]*audit_event_id = \$2/
  );
  assert.doesNotMatch(sql.tenantList, /SELECT \* FROM platform_audit_events/);

  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    const tenantA = await insertCompany(database, "C");
    const tenantB = await insertCompany(database, "D");
    const eventA = opaqueId("audit", "C");
    const eventB = opaqueId("audit", "D");

    for (const [eventId, tenant] of [
      [eventA, tenantA],
      [eventB, tenantB]
    ]) {
      await database.query(sql.append, [
        eventId,
        tenant.accountId,
        "company",
        tenant.tenantId,
        tenant.membershipId,
        "authorization.access.denied",
        "denied",
        "tenant_mismatch",
        "resource",
        `resource_${tenant.tenantId.slice(-1)}`,
        null,
        JSON.stringify({})
      ]);
    }

    const listA = await database.query(sql.tenantList, [
      tenantA.tenantId,
      null,
      100
    ]);
    const listB = await database.query(sql.tenantList, [
      tenantB.tenantId,
      null,
      100
    ]);
    assert.equal(listA.rows.length, 1);
    assert.equal(listB.rows.length, 1);
    assert.equal(listA.rows[0].audit_event_id, eventA);
    assert.equal(listB.rows[0].audit_event_id, eventB);

    const own = await database.query(sql.tenantFind, [
      tenantA.tenantId,
      eventA
    ]);
    const cross = await database.query(sql.tenantFind, [
      tenantB.tenantId,
      eventA
    ]);
    const missing = await database.query(sql.tenantFind, [
      tenantB.tenantId,
      opaqueId("audit", "Z")
    ]);
    assert.equal(own.rows.length, 1);
    assert.deepEqual(cross.rows, missing.rows);
    assert.equal(cross.rows.length, 0);

    const platform = await database.query(sql.platformList, [null, 1]);
    assert.equal(platform.rows.length, 1);
  } finally {
    await database.close();
  }
});
