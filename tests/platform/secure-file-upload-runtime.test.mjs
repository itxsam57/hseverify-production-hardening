import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const require = createRequire(import.meta.url);
const runtimeDist = process.env.HSE_SECURE_UPLOAD_RUNTIME_DIST;
assert.ok(runtimeDist, "HSE_SECURE_UPLOAD_RUNTIME_DIST must be configured");

const auditDomain = require(resolve(runtimeDist, "audit", "audit-domain.js"));
const secureFiles = require(resolve(runtimeDist, "secure-files", "secure-file-domain.js"));
const uploads = require(resolve(runtimeDist, "secure-files", "secure-file-upload-domain.js"));
const { DatabaseSecureFileUploadRepository } = require(
  resolve(runtimeDist, "secure-files", "secure-file-upload-repository.js")
);

const BASE_ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "secure-file-upload-runtime",
  sessionSecret: "secure-file-upload-runtime-session-secret-32-chars",
  authPepper: "secure-file-upload-runtime-auth-pepper-32-chars",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function environment(releaseSha) {
  return { ...BASE_ENVIRONMENT, releaseSha };
}

function hash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function pdfBytes(label) {
  return new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj\n<< /Label (${label}) >>\nendobj\ntrailer\n<<>>\n%%EOF\n`
  );
}

async function seedWorker(database, suffix) {
  const now = "2026-08-09T19:20:00.000Z";
  const accountId = `account_upload_runtime_${suffix}`;
  const sessionId = `session_upload_runtime_${suffix}`;
  const email = `upload-runtime-${suffix}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, email, `Upload Runtime ${suffix}`, now]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    [accountId, now]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'worker', $3, $4, $5, $5, '2099-01-01T00:00:00.000Z')`,
    [sessionId, accountId, hash(`token:${suffix}`), hash(`csrf:${suffix}`), now]
  );
  return {
    accountId,
    sessionId,
    principal: {
      sessionId,
      accountId,
      activeRole: "worker",
      accountStatus: "active",
      email,
      displayName: `Upload Runtime ${suffix}`,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: "2099-01-01T00:00:00.000Z",
      tenantMembership: null
    }
  };
}

async function reserve(database, worker, marker, filename = "evidence.pdf") {
  const fileId = `secure_file_${marker.repeat(24)}`;
  const objectKey = secureFiles.deriveSecureFileObjectKey(fileId);
  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, $3, 'worker', NULL, NULL,
       'local_test', $4, $5)`,
    [fileId, hash(`reservation:${marker}`), worker.accountId, objectKey, filename]
  );
  return { fileId, objectKey, filename };
}

function storedUpload(reservation, bytes) {
  const validated = uploads.validateSecureFileUpload({
    policy: uploads.createDefaultSecureFileUploadPolicy(),
    fileId: reservation.fileId,
    objectKey: reservation.objectKey,
    reservedDisplayFilename: reservation.filename,
    originalFilename: reservation.filename,
    declaredMime: "application/pdf",
    bytes
  });
  return uploads.confirmStoredSecureFileUpload(validated, {
    byteSize: validated.byteSize,
    sha256: validated.contentSha256
  });
}

async function quarantineAudits(database, fileId) {
  const result = await database.query(
    `SELECT action_key, target_type, target_reference, metadata
     FROM platform_audit_events
     WHERE action_key = 'secure_file.quarantined'
       AND target_type = 'secure_file'
       AND target_reference = $1
     ORDER BY audit_sequence`,
    [fileId]
  );
  return result.rows;
}

test("real quarantine repository commits metadata and one audit fact and replays idempotently", async () => {
  const env = environment("secure-upload-runtime-success");
  const database = await openScriptDatabase(env);
  try {
    await applyPendingMigrations(database, env.releaseSha);
    const worker = await seedWorker(database, "success");
    const reservation = await reserve(database, worker, "A");
    const owner = secureFiles.bindTrustedSecureFileOwner(worker.principal);
    const actor = auditDomain.bindTrustedAuditActor(worker.principal);
    const upload = storedUpload(reservation, pdfBytes("accepted"));
    const repository = new DatabaseSecureFileUploadRepository(Promise.resolve(database));

    const first = await repository.finalizeQuarantine(owner, actor, upload);
    assert.equal(first.created, true);
    assert.equal(first.file.lifecycleStatus, "quarantined");
    assert.equal(first.file.contentSha256, upload.contentSha256);
    assert.ok(first.file.quarantinedAt);
    assert.equal(first.file.availableAt, null);

    const auditAfterFirst = await quarantineAudits(database, reservation.fileId);
    assert.equal(auditAfterFirst.length, 1);
    assert.equal(auditAfterFirst[0].target_reference, reservation.fileId);
    assert.equal(auditAfterFirst[0].metadata.policyKey, "platform.evidence.default");
    assert.equal(auditAfterFirst[0].metadata.byteSize, upload.byteSize);

    const replay = await repository.finalizeQuarantine(owner, actor, upload);
    assert.equal(replay.created, false);
    assert.equal(replay.file.contentSha256, upload.contentSha256);
    assert.equal((await quarantineAudits(database, reservation.fileId)).length, 1);

    const conflicting = storedUpload(reservation, pdfBytes("different"));
    await assert.rejects(
      repository.finalizeQuarantine(owner, actor, conflicting),
      secureFiles.SecureFileReservationConflictError
    );
    const afterConflict = await database.query(
      `SELECT lifecycle_status, content_sha256, byte_size
       FROM platform_secure_files WHERE file_id = $1`,
      [reservation.fileId]
    );
    assert.equal(afterConflict.rows[0].lifecycle_status, "quarantined");
    assert.equal(afterConflict.rows[0].content_sha256, upload.contentSha256);
    assert.equal(Number(afterConflict.rows[0].byte_size), upload.byteSize);
    assert.equal((await quarantineAudits(database, reservation.fileId)).length, 1);
  } finally {
    await database.close();
  }
});

test("audit persistence failure rolls the quarantine transition back atomically", async () => {
  const env = environment("secure-upload-runtime-audit-rollback");
  const database = await openScriptDatabase(env);
  try {
    await applyPendingMigrations(database, env.releaseSha);
    const worker = await seedWorker(database, "auditrollback");
    const reservation = await reserve(database, worker, "B");
    const owner = secureFiles.bindTrustedSecureFileOwner(worker.principal);
    const actor = auditDomain.bindTrustedAuditActor(worker.principal);
    const upload = storedUpload(reservation, pdfBytes("rollback"));
    const repository = new DatabaseSecureFileUploadRepository(Promise.resolve(database));

    await database.query(`
      CREATE OR REPLACE FUNCTION reject_secure_file_quarantine_audit()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.action_key = 'secure_file.quarantined' THEN
          RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'runtime audit rejection';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await database.query(`
      CREATE TRIGGER reject_secure_file_quarantine_audit
      BEFORE INSERT ON platform_audit_events
      FOR EACH ROW
      EXECUTE FUNCTION reject_secure_file_quarantine_audit()
    `);

    await assert.rejects(
      repository.finalizeQuarantine(owner, actor, upload),
      /runtime audit rejection/
    );
    const file = await database.query(
      `SELECT lifecycle_status, file_extension, declared_mime, detected_mime,
              byte_size, content_sha256, quarantined_at
       FROM platform_secure_files WHERE file_id = $1`,
      [reservation.fileId]
    );
    assert.equal(file.rows.length, 1);
    assert.equal(file.rows[0].lifecycle_status, "reserved");
    assert.equal(file.rows[0].file_extension, null);
    assert.equal(file.rows[0].declared_mime, null);
    assert.equal(file.rows[0].detected_mime, null);
    assert.equal(file.rows[0].byte_size, null);
    assert.equal(file.rows[0].content_sha256, null);
    assert.equal(file.rows[0].quarantined_at, null);
    assert.equal((await quarantineAudits(database, reservation.fileId)).length, 0);
  } finally {
    await database.close();
  }
});

test("copied file ids and revoked trusted sessions fail before quarantine mutation", async () => {
  const env = environment("secure-upload-runtime-denial");
  const database = await openScriptDatabase(env);
  try {
    await applyPendingMigrations(database, env.releaseSha);
    const ownerWorker = await seedWorker(database, "owner");
    const attacker = await seedWorker(database, "attacker");
    const reservation = await reserve(database, ownerWorker, "C");
    const upload = storedUpload(reservation, pdfBytes("owner"));
    const repository = new DatabaseSecureFileUploadRepository(Promise.resolve(database));

    const attackerOwner = secureFiles.bindTrustedSecureFileOwner(attacker.principal);
    const attackerActor = auditDomain.bindTrustedAuditActor(attacker.principal);
    await assert.rejects(
      repository.finalizeQuarantine(attackerOwner, attackerActor, upload),
      secureFiles.SecureFileAccessDeniedError
    );

    const owner = secureFiles.bindTrustedSecureFileOwner(ownerWorker.principal);
    const actor = auditDomain.bindTrustedAuditActor(ownerWorker.principal);
    await database.query(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP, revocation_reason = 'runtime_test'
       WHERE session_id = $1`,
      [ownerWorker.sessionId]
    );
    await assert.rejects(
      repository.finalizeQuarantine(owner, actor, upload),
      secureFiles.SecureFileAccessDeniedError
    );

    const file = await database.query(
      `SELECT lifecycle_status, content_sha256
       FROM platform_secure_files WHERE file_id = $1`,
      [reservation.fileId]
    );
    assert.equal(file.rows[0].lifecycle_status, "reserved");
    assert.equal(file.rows[0].content_sha256, null);
    assert.equal((await quarantineAudits(database, reservation.fileId)).length, 0);
  } finally {
    await database.close();
  }
});
