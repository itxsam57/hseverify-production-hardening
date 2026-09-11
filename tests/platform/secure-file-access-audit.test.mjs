import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const require = createRequire(import.meta.url);
const runtimeDist = process.env.HSE_SECURE_ACCESS_RUNTIME_DIST;
assert.ok(runtimeDist, "HSE_SECURE_ACCESS_RUNTIME_DIST must be configured");

const { DatabaseAuditRepository } = require(
  resolve(runtimeDist, "audit", "audit-repository.js")
);
const { appendSecureFileAccessAudit } = require(
  resolve(runtimeDist, "secure-files", "secure-file-access-audit.js")
);

const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "secure-file-access-audit",
  sessionSecret: "secure-file-access-audit-session-secret-32-chars",
  authPepper: "secure-file-access-audit-auth-pepper-32-chars",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};
const FILE_REF = `secure_file_${"Q".repeat(24)}`;

function workerPrincipal() {
  return {
    sessionId: "session_access_audit_worker",
    accountId: "account_access_audit_worker",
    activeRole: "worker",
    accountStatus: "active",
    email: "access-audit-worker@example.com",
    displayName: "Access Audit Worker",
    createdAt: "2026-08-10T00:00:00.000Z",
    lastSeenAt: "2026-08-10T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    tenantMembership: null
  };
}

function companyPrincipal() {
  return {
    sessionId: "session_access_audit_company",
    accountId: "account_access_audit_company",
    activeRole: "company",
    accountStatus: "active",
    email: "access-audit-company@example.com",
    displayName: "Access Audit Company",
    createdAt: "2026-08-10T00:00:00.000Z",
    lastSeenAt: "2026-08-10T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    tenantMembership: {
      tenantId: `tenant_${"T".repeat(24)}`,
      tenantStatus: "active",
      membershipId: `membership_${"M".repeat(24)}`,
      role: "owner",
      status: "active",
      overrides: []
    }
  };
}

test("signed access authorization and serve use immutable bounded audit facts", async () => {
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    const audit = new DatabaseAuditRepository(Promise.resolve(database));

    await appendSecureFileAccessAudit({
      principal: workerPrincipal(),
      action: "secure_file.access.authorized",
      fileRef: FILE_REF,
      purpose: "preview",
      expiresAt: "2026-08-10T00:02:00.000Z",
      repository: audit
    });
    await appendSecureFileAccessAudit({
      principal: companyPrincipal(),
      action: "secure_file.access.served",
      fileRef: FILE_REF,
      purpose: "download",
      byteSize: 512,
      repository: audit
    });

    const rows = await database.query(
      `SELECT action_key, outcome, actor_account_id, actor_role,
              actor_tenant_id, actor_membership_id,
              target_type, target_reference, metadata
       FROM platform_audit_events
       WHERE action_key IN (
         'secure_file.access.authorized',
         'secure_file.access.served'
       )
       ORDER BY audit_sequence`
    );
    assert.equal(rows.rows.length, 2);
    assert.deepEqual(rows.rows[0].metadata, {
      expiresAt: "2026-08-10T00:02:00.000Z",
      purpose: "preview"
    });
    assert.equal(rows.rows[0].actor_role, "worker");
    assert.equal(rows.rows[0].actor_tenant_id, null);
    assert.equal(rows.rows[0].actor_membership_id, null);
    assert.equal(rows.rows[1].actor_role, "company");
    assert.equal(rows.rows[1].actor_tenant_id, companyPrincipal().tenantMembership.tenantId);
    assert.equal(rows.rows[1].actor_membership_id, companyPrincipal().tenantMembership.membershipId);
    assert.deepEqual(rows.rows[1].metadata, {
      byteSize: 512,
      purpose: "download"
    });
    for (const row of rows.rows) {
      assert.equal(row.outcome, "succeeded");
      assert.equal(row.target_type, "secure_file");
      assert.equal(row.target_reference, FILE_REF);
      const serialized = JSON.stringify(row.metadata);
      for (const forbidden of [
        "token",
        "accessUrl",
        "objectKey",
        "contentSha256",
        "sessionSecret",
        "secure-files/"
      ]) {
        assert.equal(serialized.includes(forbidden), false);
      }
    }

    await assert.rejects(
      database.query(
        `UPDATE platform_audit_events
         SET metadata = '{"purpose":"tampered"}'::jsonb
         WHERE action_key = 'secure_file.access.authorized'`
      ),
      /append-only/i
    );
    await assert.rejects(
      database.query(
        `DELETE FROM platform_audit_events
         WHERE action_key = 'secure_file.access.served'`
      ),
      /append-only/i
    );
  } finally {
    await database.close();
  }
});
