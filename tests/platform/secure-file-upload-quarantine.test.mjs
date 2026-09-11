import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations, listMigrations } from "../../scripts/lib/migrations.mjs";

const NOW = "2026-08-09T18:20:00.000Z";
const EXPIRES = "2099-01-01T00:00:00.000Z";
const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "secure-file-upload-quarantine-test",
  sessionSecret: "secure-file-upload-quarantine-session-secret-32-chars",
  authPepper: "secure-file-upload-quarantine-auth-pepper-32-chars",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function hash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
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
    resolve("src/lib/secure-files/secure-file-upload-repository.ts"),
    "utf8"
  );
  return {
    sessionGuard: extractSql(source, "SECURE_FILE_UPLOAD_SESSION_GUARD_SQL"),
    companyGuard: extractSql(source, "SECURE_FILE_UPLOAD_COMPANY_SCOPE_GUARD_SQL"),
    lock: extractSql(source, "SECURE_FILE_UPLOAD_LOCK_SQL"),
    quarantine: extractSql(source, "SECURE_FILE_QUARANTINE_SQL")
  };
}

async function seedWorker(database, suffix) {
  const accountId = `account_upload_worker_${suffix}`;
  const sessionId = `session_upload_worker_${suffix}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, `upload-worker-${suffix}@example.com`, `Upload Worker ${suffix}`, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'worker', $3, $4, $5, $5, $6)`,
    [sessionId, accountId, hash(`token:${suffix}`), hash(`csrf:${suffix}`), NOW, EXPIRES]
  );
  return { accountId, sessionId };
}

async function seedCompany(database, suffix, marker) {
  const accountId = `account_upload_company_${suffix}`;
  const sessionId = `session_upload_company_${suffix}`;
  const tenantId = `tenant_${marker.repeat(24)}`;
  const membershipId = `membership_${marker.repeat(24)}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, `upload-company-${suffix}@example.com`, `Upload Company ${suffix}`, NOW]
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
    [tenantId, `Upload Tenant ${suffix}`, accountId, NOW]
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
    [sessionId, accountId, hash(`company-token:${suffix}`), hash(`company-csrf:${suffix}`), NOW, EXPIRES]
  );
  return { accountId, sessionId, tenantId, membershipId };
}

async function reserve(database, input) {
  const fileId = `secure_file_${input.marker.repeat(24)}`;
  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, $3, $4, $5, $6, 'local_test', $7, $8)`,
    [
      fileId,
      hash(`reservation:${input.marker}`),
      input.accountId,
      input.role,
      input.tenantId ?? null,
      input.membershipId ?? null,
      `secure-files/${hash(`object:${input.marker}`)}`,
      input.filename ?? "evidence.pdf"
    ]
  );
  return fileId;
}

async function quarantine(database, sql, input) {
  return database.query(sql, [
    input.fileId,
    input.accountId,
    input.role,
    input.tenantId ?? null,
    input.membershipId ?? null,
    input.extension ?? "pdf",
    input.declaredMime ?? "application/pdf",
    input.detectedMime ?? "application/pdf",
    input.byteSize ?? 128,
    input.contentHash ?? hash(`content:${input.fileId}`)
  ]);
}

test("quarantine finalization is exact-scope, immutable and material-auditable", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    const migrations = (await listMigrations()).map((migration) => migration.id);
    const ownedIndex = migrations.indexOf("0012_secure_file_upload_quarantine");
    assert.ok(ownedIndex > 0, "Subunit 2 migration must be registered");
    assert.equal(migrations[ownedIndex - 1], "0011_secure_file_foundation");
    assert.deepEqual(await applyPendingMigrations(database, ENVIRONMENT.releaseSha), migrations);

    const workerA = await seedWorker(database, "a");
    const workerB = await seedWorker(database, "b");
    const companyA = await seedCompany(database, "a", "C");
    const companyB = await seedCompany(database, "b", "D");
    const workerFileA = await reserve(database, {
      marker: "E", accountId: workerA.accountId, role: "worker"
    });
    const workerFileB = await reserve(database, {
      marker: "F", accountId: workerB.accountId, role: "worker"
    });
    const companyFileA = await reserve(database, {
      marker: "G", accountId: companyA.accountId, role: "company",
      tenantId: companyA.tenantId, membershipId: companyA.membershipId
    });
    const companyFileB = await reserve(database, {
      marker: "H", accountId: companyB.accountId, role: "company",
      tenantId: companyB.tenantId, membershipId: companyB.membershipId
    });

    assert.equal(
      (await database.query(sql.sessionGuard, [workerA.sessionId, workerA.accountId, "worker"])).rows.length,
      1
    );
    assert.equal(
      (await database.query(sql.lock, [workerFileB, workerA.accountId, "worker", null, null])).rows.length,
      0
    );
    assert.equal(
      (await database.query(sql.lock, [companyFileB, companyA.accountId, "company", companyA.tenantId, companyA.membershipId])).rows.length,
      0
    );
    assert.equal(
      (await database.query(sql.companyGuard, [companyA.membershipId, companyA.tenantId, companyA.accountId])).rows.length,
      1
    );

    const acceptedHash = hash("accepted-worker-a");
    const result = await quarantine(database, sql.quarantine, {
      fileId: workerFileA,
      accountId: workerA.accountId,
      role: "worker",
      byteSize: 456,
      contentHash: acceptedHash
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].lifecycle_status, "quarantined");
    assert.equal(result.rows[0].byte_size, 456);
    assert.equal(result.rows[0].content_sha256, acceptedHash);
    assert.ok(result.rows[0].quarantined_at);
    assert.equal(result.rows[0].available_at, null);

    const replay = await quarantine(database, sql.quarantine, {
      fileId: workerFileA,
      accountId: workerA.accountId,
      role: "worker",
      byteSize: 456,
      contentHash: acceptedHash
    });
    assert.equal(replay.rows.length, 0, "database transition itself must remain one-way");

    await database.query(
      `INSERT INTO platform_audit_events (
         audit_event_id, source_kind, actor_account_id, actor_role,
         action_key, outcome, target_type, target_reference, metadata
       ) VALUES ($1, 'native', $2, 'worker',
         'secure_file.quarantined', 'succeeded', 'secure_file', $3,
         $4::jsonb)`,
      [
        `audit_${"Q".repeat(24)}`,
        workerA.accountId,
        workerFileA,
        JSON.stringify({
          policyKey: "platform.evidence.default",
          fileExtension: "pdf",
          declaredMime: "application/pdf",
          detectedMime: "application/pdf",
          byteSize: 456
        })
      ]
    );
    const audit = await database.query(
      `SELECT action_key, target_type, target_reference
       FROM platform_audit_events
       WHERE target_reference = $1 AND action_key = 'secure_file.quarantined'`,
      [workerFileA]
    );
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].target_type, "secure_file");

    await assert.rejects(
      database.query(
        `UPDATE platform_secure_files
         SET content_sha256 = $2
         WHERE file_id = $1`,
        [workerFileA, hash("tampered")]
      )
    );
    const afterTamper = await database.query(
      `SELECT lifecycle_status, content_sha256, byte_size
       FROM platform_secure_files WHERE file_id = $1`,
      [workerFileA]
    );
    assert.equal(afterTamper.rows.length, 1);
    assert.equal(afterTamper.rows[0].lifecycle_status, "quarantined");
    assert.equal(afterTamper.rows[0].content_sha256, acceptedHash);
    assert.equal(Number(afterTamper.rows[0].byte_size), 456);

    assert.equal(
      Number((await database.query("SELECT COUNT(*) AS count FROM platform_outbox_jobs")).rows[0].count),
      0,
      "Subunit 2 must not enqueue a scanner job"
    );

    await database.query(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP, revocation_reason = 'upload_test'
       WHERE session_id = $1`,
      [workerA.sessionId]
    );
    assert.equal(
      (await database.query(sql.sessionGuard, [workerA.sessionId, workerA.accountId, "worker"])).rows.length,
      0
    );

    const continuityAccountId = "account_upload_company_a_continuity";
    const continuityMembershipId = `membership_${"R".repeat(24)}`;
    await database.query(
      `INSERT INTO auth_accounts (
         account_id, email_normalized, display_name, account_status,
         email_verified_at, created_at, updated_at
       ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
      [continuityAccountId, "upload-company-a-continuity@example.com", "Upload Company a continuity owner", NOW]
    );
    await database.query(
      `INSERT INTO auth_account_roles (account_id, role, created_at)
       VALUES ($1, 'company', $2)`,
      [continuityAccountId, NOW]
    );
    await database.query(
      `INSERT INTO auth_tenant_memberships (
         membership_id, tenant_id, account_id, portal_role,
         membership_role, membership_status, created_by_account_id,
         created_at, updated_at, activated_at
       ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $4, $5, $5, $5)`,
      [continuityMembershipId, companyA.tenantId, continuityAccountId, companyA.accountId, NOW]
    );

    await database.query(
      `UPDATE auth_tenant_memberships
       SET membership_status = 'revoked', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE membership_id = $1`,
      [companyA.membershipId]
    );
    assert.equal(
      (await database.query(sql.companyGuard, [companyA.membershipId, companyA.tenantId, companyA.accountId])).rows.length,
      0
    );

    const untouchedWorker = await database.query(
      "SELECT lifecycle_status FROM platform_secure_files WHERE file_id = $1",
      [workerFileB]
    );
    const untouchedCompanyA = await database.query(
      "SELECT lifecycle_status FROM platform_secure_files WHERE file_id = $1",
      [companyFileA]
    );
    const untouchedCompanyB = await database.query(
      "SELECT lifecycle_status FROM platform_secure_files WHERE file_id = $1",
      [companyFileB]
    );
    assert.equal(untouchedWorker.rows[0].lifecycle_status, "reserved");
    assert.equal(untouchedCompanyA.rows[0].lifecycle_status, "reserved");
    assert.equal(untouchedCompanyB.rows[0].lifecycle_status, "reserved");
  } finally {
    await database.close();
  }
});