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
  releaseSha: "audit-concurrency-test",
  sessionSecret: "audit-concurrency-session-secret-32-characters",
  authPepper: "audit-concurrency-auth-pepper-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};
const NOW = "2026-08-06T09:30:00.000Z";

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

async function insertCompany(database) {
  const accountId = "account_audit_concurrency";
  const tenantId = opaqueId("tenant", "Q");
  const membershipId = opaqueId("membership", "Q");

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
    [
      accountId,
      "audit-concurrency@example.com",
      "Audit Concurrency",
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
    [tenantId, "Audit Concurrency Tenant", accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $3, $4, $4, $4)`,
    [membershipId, tenantId, accountId, NOW]
  );
  return { accountId, tenantId, membershipId };
}

test("concurrent native audit appends lose no facts and preserve unique ordering", async () => {
  const repositorySource = await readFile(
    resolve("src/lib/audit/audit-repository.ts"),
    "utf8"
  );
  const appendSql = extractSql(repositorySource, "AUDIT_APPEND_SQL");
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    const company = await insertCompany(database);
    const characters = [..."ABCDEFGHIJKLMNOP"];

    const writes = await Promise.all(
      characters.map((character, index) =>
        database.query(appendSql, [
          opaqueId("audit", character),
          company.accountId,
          "company",
          company.tenantId,
          company.membershipId,
          "authorization.access.denied",
          "denied",
          "concurrent_append_test",
          "resource",
          `resource_concurrent_${index}`,
          null,
          JSON.stringify({ index })
        ])
      )
    );

    assert.equal(writes.length, characters.length);
    assert.equal(writes.every((result) => result.rows.length === 1), true);

    const stored = await database.query(
      `SELECT audit_sequence, audit_event_id, target_reference, metadata
       FROM platform_audit_events
       WHERE actor_tenant_id = $1 AND reason_key = 'concurrent_append_test'
       ORDER BY audit_sequence DESC`,
      [company.tenantId]
    );
    assert.equal(stored.rows.length, characters.length);
    assert.equal(
      new Set(stored.rows.map((row) => row.audit_event_id)).size,
      characters.length
    );
    assert.equal(
      new Set(stored.rows.map((row) => Number(row.audit_sequence))).size,
      characters.length
    );
    for (let index = 1; index < stored.rows.length; index += 1) {
      assert.ok(
        Number(stored.rows[index - 1].audit_sequence) >
          Number(stored.rows[index].audit_sequence)
      );
    }
    assert.deepEqual(
      new Set(stored.rows.map((row) => Number(row.metadata.index))),
      new Set(characters.map((_, index) => index))
    );
  } finally {
    await database.close();
  }
});

test("authentication compatibility mirror removes sensitive keys at every metadata depth", async () => {
  const database = await openScriptDatabase({
    ...ENVIRONMENT,
    releaseSha: "audit-recursive-redaction-test"
  });
  try {
    await applyPendingMigrations(database, "audit-recursive-redaction-test");
    const eventId = "event_nested_secret_redaction";
    await database.query(
      `INSERT INTO auth_security_events (
         event_id, account_id, event_type, active_role, metadata, occurred_at
       ) VALUES ($1, NULL, 'access_denied', 'worker', $2::jsonb, $3)`,
      [
        eventId,
        JSON.stringify({
          reason: "permission_denied",
          safe: "kept",
          nested: {
            sessionToken: "must-not-survive",
            safe: "nested-kept"
          },
          list: [
            {
              otp: "must-not-survive",
              safe: "array-kept"
            }
          ],
          CredentialBundle: "must-not-survive"
        }),
        NOW
      ]
    );

    const mirrored = await database.query(
      `SELECT metadata
       FROM platform_audit_events
       WHERE source_kind = 'auth_security_event' AND source_event_id = $1`,
      [eventId]
    );
    assert.equal(mirrored.rows.length, 1);
    const metadata = mirrored.rows[0].metadata;
    assert.equal(metadata.safe, "kept");
    assert.equal(metadata.nested.safe, "nested-kept");
    assert.equal("sessionToken" in metadata.nested, false);
    assert.equal(metadata.list[0].safe, "array-kept");
    assert.equal("otp" in metadata.list[0], false);
    assert.equal("CredentialBundle" in metadata, false);
  } finally {
    await database.close();
  }
});
