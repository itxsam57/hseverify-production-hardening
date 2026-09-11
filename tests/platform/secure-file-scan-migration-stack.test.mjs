import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import {
  applyPendingMigrations,
  listMigrations,
  migrationStatus,
  rollbackLatestMigration
} from "../../scripts/lib/migrations.mjs";

const OWNED_MIGRATION = "0013_secure_file_malware_scan";
const PREVIOUS_MIGRATION = "0012_secure_file_upload_quarantine";
const NOW = "2026-08-09T21:00:00.000Z";

function hash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function environment(pgliteDataDir, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir,
    releaseSha,
    sessionSecret: "secure-scan-stack-session-secret-with-32-characters",
    authPepper: "secure-scan-stack-auth-pepper-with-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function tableColumns(database, tableName) {
  const result = await database.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return result.rows.map((row) => row.column_name);
}

async function seedPendingScan(database, suffix, marker) {
  const accountId = `account_scan_stack_${suffix}`;
  const fileRef = `secure_file_${marker.repeat(24)}`;
  const jobId = `job_${marker.repeat(24)}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, `scan-stack-${suffix}@example.com`, `Scan Stack ${suffix}`, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, $3, 'worker', NULL, NULL,
       'local_test', $4, 'scan.pdf')`,
    [fileRef, hash(`reservation:${suffix}`), accountId, `secure-files/${hash(`object:${suffix}`)}`]
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
    [fileRef, hash(`content:${suffix}`)]
  );
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, 'secure_file.scan', 1, $2, $3::jsonb,
       $4, 'worker', NULL, NULL)`,
    [jobId, hash(`idempotency:${suffix}`), JSON.stringify({ fileRef, generation: 1 }), accountId]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'scan_pending',
         scan_generation = 1,
         scan_job_id = $2
     WHERE file_id = $1`,
    [fileRef, jobId]
  );
  await database.query(
    `INSERT INTO platform_audit_events (
       audit_event_id, source_kind, actor_account_id, actor_role,
       action_key, outcome, target_type, target_reference, metadata
     ) VALUES ($1, 'native', $2, 'worker',
       'secure_file.scan.queued', 'succeeded', 'secure_file', $3, $4::jsonb)`,
    [
      `audit_scan_stack_${marker.repeat(24)}`,
      accountId,
      fileRef,
      JSON.stringify({ sourceJobId: jobId, generation: 1 })
    ]
  );
  return { accountId, fileRef, jobId };
}

async function rollbackThrough(database, env, targetId) {
  const rolledBack = [];
  while (true) {
    const id = await rollbackLatestMigration(database, env);
    assert.ok(id, `expected to reach ${targetId}`);
    rolledBack.push(id);
    if (id === targetId) return rolledBack;
  }
}

async function exercise(database, env, suffix, marker) {
  const manifest = (await listMigrations()).map((migration) => migration.id);
  const ownedIndex = manifest.indexOf(OWNED_MIGRATION);
  assert.ok(ownedIndex > 0, "secure scan migration must be registered");
  assert.equal(manifest[ownedIndex - 1], PREVIOUS_MIGRATION);
  assert.deepEqual(await applyPendingMigrations(database, env.releaseSha), manifest);
  assert.deepEqual(await applyPendingMigrations(database, `${env.releaseSha}-noop`), []);

  const columns = await tableColumns(database, "platform_secure_files");
  for (const column of ["scan_generation", "scan_job_id", "scan_result_code", "scan_completed_at"]) {
    assert.equal(columns.includes(column), true, `${column} must exist`);
  }

  const seeded = await seedPendingScan(database, suffix, marker);
  const before = await database.query(
    `SELECT lifecycle_status, scan_generation, scan_job_id
     FROM platform_secure_files WHERE file_id = $1`,
    [seeded.fileRef]
  );
  assert.equal(before.rows[0].lifecycle_status, "scan_pending");
  assert.equal(Number(before.rows[0].scan_generation), 1);
  assert.equal(before.rows[0].scan_job_id, seeded.jobId);

  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  try {
    const rolledBack = await rollbackThrough(database, env, OWNED_MIGRATION);
    assert.equal(rolledBack.at(-1), OWNED_MIGRATION);

    const preserved = await database.query(
      `SELECT lifecycle_status, scan_generation, scan_job_id
       FROM platform_secure_files WHERE file_id = $1`,
      [seeded.fileRef]
    );
    assert.equal(preserved.rows.length, 1);
    assert.equal(preserved.rows[0].lifecycle_status, "scan_pending");
    assert.equal(Number(preserved.rows[0].scan_generation), 1);
    assert.equal(preserved.rows[0].scan_job_id, seeded.jobId);
    assert.equal(
      Number((await database.query(
        `SELECT COUNT(*) AS count FROM platform_outbox_jobs WHERE job_id = $1`,
        [seeded.jobId]
      )).rows[0].count),
      1
    );
    assert.equal(
      Number((await database.query(
        `SELECT COUNT(*) AS count FROM platform_audit_events
         WHERE target_reference = $1 AND action_key = 'secure_file.scan.queued'`,
        [seeded.fileRef]
      )).rows[0].count),
      1
    );

    const statusAfterRollback = await migrationStatus(database);
    const owned = statusAfterRollback.find((entry) => entry.id === OWNED_MIGRATION);
    assert.equal(owned.applied, false);
    assert.equal(statusAfterRollback.every((entry) => entry.checksumMatches), true);

    assert.deepEqual(
      await applyPendingMigrations(database, `${env.releaseSha}-reapply`),
      [...rolledBack].reverse()
    );
    const finalStatus = await migrationStatus(database);
    assert.equal(finalStatus.every((entry) => entry.applied && entry.checksumMatches), true);
    assert.deepEqual(await applyPendingMigrations(database, `${env.releaseSha}-reapply-noop`), []);
    return seeded;
  } finally {
    if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
  }
}

test("secure scan migration is forward-stack compatible and monotonic rollback preserves durable scan history", async () => {
  const env = environment("memory://", "secure-scan-stack-memory");
  const database = await openScriptDatabase(env);
  try {
    await exercise(database, env, "memory", "M");
  } finally {
    await database.close();
  }
});

test("secure scan job/file/audit binding survives PGlite close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-secure-scan-stack-"));
  const env = environment(directory, "secure-scan-stack-persistent");
  let database = await openScriptDatabase(env);
  try {
    const seeded = await exercise(database, env, "persistent", "P");
    await database.close();
    database = null;

    const reopened = await openScriptDatabase(env);
    try {
      const file = await reopened.query(
        `SELECT lifecycle_status, scan_generation, scan_job_id
         FROM platform_secure_files WHERE file_id = $1`,
        [seeded.fileRef]
      );
      assert.equal(file.rows.length, 1);
      assert.equal(file.rows[0].lifecycle_status, "scan_pending");
      assert.equal(Number(file.rows[0].scan_generation), 1);
      assert.equal(file.rows[0].scan_job_id, seeded.jobId);
      const job = await reopened.query(
        `SELECT status, payload FROM platform_outbox_jobs WHERE job_id = $1`,
        [seeded.jobId]
      );
      assert.equal(job.rows.length, 1);
      assert.equal(job.rows[0].status, "pending");
      assert.deepEqual(job.rows[0].payload, { fileRef: seeded.fileRef, generation: 1 });
      const status = await migrationStatus(reopened);
      assert.equal(status.every((entry) => entry.applied && entry.checksumMatches), true);
    } finally {
      await reopened.close();
    }
  } finally {
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
