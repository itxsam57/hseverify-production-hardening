import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const NOW = "2026-08-09T21:10:00.000Z";
const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "secure-file-scan-result-semantics",
  sessionSecret: "secure-file-scan-result-session-secret-32-chars",
  authPepper: "secure-file-scan-result-auth-pepper-32-chars",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function hash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

async function seedAccount(database) {
  const accountId = "account_scan_result_worker";
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, 'Scan Result Worker', 'active', $3, $3, $3)`,
    [accountId, "scan-result-worker@example.com", NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    [accountId, NOW]
  );
  return accountId;
}

async function seedPending(database, accountId, marker) {
  const fileRef = `secure_file_${marker.repeat(24)}`;
  const jobId = `job_${marker.repeat(24)}`;
  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, $3, 'worker', NULL, NULL,
       'local_test', $4, 'result.pdf')`,
    [
      fileRef,
      hash(`reservation:${marker}`),
      accountId,
      `secure-files/${hash(`object:${marker}`)}`
    ]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'quarantined',
         file_extension = 'pdf',
         declared_mime = 'application/pdf',
         detected_mime = 'application/pdf',
         byte_size = 128,
         content_sha256 = $2
     WHERE file_id = $1`,
    [fileRef, hash(`content:${marker}`)]
  );
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, 'secure_file.scan', 1, $2, $3::jsonb,
       $4, 'worker', NULL, NULL)`,
    [
      jobId,
      hash(`idempotency:${marker}`),
      JSON.stringify({ fileRef, generation: 1 }),
      accountId
    ]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'scan_pending',
         scan_generation = 1,
         scan_job_id = $2
     WHERE file_id = $1`,
    [fileRef, jobId]
  );
  return { fileRef, jobId };
}

async function fileState(database, fileRef) {
  const result = await database.query(
    `SELECT lifecycle_status, scan_result_code, scan_completed_at,
            available_at, unsafe_at
     FROM platform_secure_files WHERE file_id = $1`,
    [fileRef]
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function finalize(database, fileRef, lifecycleStatus, resultCode) {
  return database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = $2,
         scan_result_code = $3
     WHERE file_id = $1`,
    [fileRef, lifecycleStatus, resultCode]
  );
}

test("database makes clean result semantics inseparable from final scan lifecycle", async () => {
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    const accountId = await seedAccount(database);

    const available = await seedPending(database, accountId, "A");
    await assert.rejects(
      finalize(database, available.fileRef, "available", "eicar_test_signature")
    );
    assert.equal((await fileState(database, available.fileRef)).lifecycle_status, "scan_pending");
    await finalize(database, available.fileRef, "available", "clean");
    const availableState = await fileState(database, available.fileRef);
    assert.equal(availableState.lifecycle_status, "available");
    assert.equal(availableState.scan_result_code, "clean");
    assert.ok(availableState.scan_completed_at);
    assert.ok(availableState.available_at);
    assert.equal(availableState.unsafe_at, null);

    const unsafe = await seedPending(database, accountId, "B");
    await assert.rejects(finalize(database, unsafe.fileRef, "unsafe", "clean"));
    assert.equal((await fileState(database, unsafe.fileRef)).lifecycle_status, "scan_pending");
    await finalize(database, unsafe.fileRef, "unsafe", "eicar_test_signature");
    const unsafeState = await fileState(database, unsafe.fileRef);
    assert.equal(unsafeState.lifecycle_status, "unsafe");
    assert.equal(unsafeState.scan_result_code, "eicar_test_signature");
    assert.ok(unsafeState.scan_completed_at);
    assert.equal(unsafeState.available_at, null);
    assert.ok(unsafeState.unsafe_at);

    const failed = await seedPending(database, accountId, "C");
    await assert.rejects(finalize(database, failed.fileRef, "scan_failed", "clean"));
    assert.equal((await fileState(database, failed.fileRef)).lifecycle_status, "scan_pending");
    await finalize(database, failed.fileRef, "scan_failed", "scanner_terminal_fixture");
    const failedState = await fileState(database, failed.fileRef);
    assert.equal(failedState.lifecycle_status, "scan_failed");
    assert.equal(failedState.scan_result_code, "scanner_terminal_fixture");
    assert.ok(failedState.scan_completed_at);
    assert.equal(failedState.available_at, null);
    assert.equal(failedState.unsafe_at, null);
  } finally {
    await database.close();
  }
});
