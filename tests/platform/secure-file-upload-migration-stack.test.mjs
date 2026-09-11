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

const OWNED_MIGRATION = "0012_secure_file_upload_quarantine";
const COMPLETE_MIGRATIONS = (await listMigrations()).map((migration) => migration.id);

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
    sessionSecret: "secure-file-upload-stack-session-secret-32-chars",
    authPepper: "secure-file-upload-stack-auth-pepper-32-chars",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function rollbackThrough(database, env, targetId) {
  const rolledBack = [];
  while (true) {
    const id = await rollbackLatestMigration(database, env);
    assert.ok(id, `expected rollback to reach ${targetId}`);
    rolledBack.push(id);
    if (id === targetId) return rolledBack;
  }
}

async function seedAcceptedQuarantine(database, marker) {
  const now = "2026-08-09T18:40:00.000Z";
  const accountId = `account_upload_stack_${marker}`;
  const fileId = `secure_file_${marker.repeat(24)}`;
  const auditId = `audit_${marker.repeat(24)}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, `upload-stack-${marker}@example.com`, `Upload Stack ${marker}`, now]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    [accountId, now]
  );
  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, $3, 'worker', NULL, NULL,
       'local_test', $4, 'stack.pdf')`,
    [fileId, hash(`reservation:${marker}`), accountId, `secure-files/${hash(`object:${marker}`)}`]
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
    [fileId, hash(`content:${marker}`)]
  );
  await database.query(
    `INSERT INTO platform_audit_events (
       audit_event_id, source_kind, actor_account_id, actor_role,
       action_key, outcome, target_type, target_reference, metadata
     ) VALUES ($1, 'native', $2, 'worker',
       'secure_file.quarantined', 'succeeded', 'secure_file', $3,
       '{"policyKey":"platform.evidence.default"}'::jsonb)`,
    [auditId, accountId, fileId]
  );
  return { accountId, fileId, auditId };
}

async function exercise(database, env, marker) {
  const ownedIndex = COMPLETE_MIGRATIONS.indexOf(OWNED_MIGRATION);
  assert.ok(ownedIndex > 0, "Subunit 2 migration must remain registered");
  assert.equal(COMPLETE_MIGRATIONS[ownedIndex - 1], "0011_secure_file_foundation");
  assert.deepEqual(await applyPendingMigrations(database, env.releaseSha), COMPLETE_MIGRATIONS);
  assert.deepEqual(await applyPendingMigrations(database, env.releaseSha), []);

  const accepted = await seedAcceptedQuarantine(database, marker);
  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  try {
    const rolledBack = await rollbackThrough(database, env, OWNED_MIGRATION);
    assert.equal(rolledBack.at(-1), OWNED_MIGRATION);

    const retainedFile = await database.query(
      `SELECT lifecycle_status, content_sha256
       FROM platform_secure_files WHERE file_id = $1`,
      [accepted.fileId]
    );
    const retainedAudit = await database.query(
      `SELECT action_key, target_type
       FROM platform_audit_events WHERE audit_event_id = $1`,
      [accepted.auditId]
    );
    assert.equal(retainedFile.rows.length, 1);
    assert.equal(retainedFile.rows[0].lifecycle_status, "quarantined");
    assert.equal(retainedAudit.rows.length, 1);
    assert.equal(retainedAudit.rows[0].action_key, "secure_file.quarantined");
    assert.equal(retainedAudit.rows[0].target_type, "secure_file");

    const secondAuditId = `audit_${marker.toLowerCase().repeat(24)}`;
    await database.query(
      `INSERT INTO platform_audit_events (
         audit_event_id, source_kind, actor_account_id, actor_role,
         action_key, outcome, target_type, target_reference, metadata
       ) VALUES ($1, 'native', $2, 'worker',
         'secure_file.quarantined', 'succeeded', 'secure_file', $3, '{}'::jsonb)`,
      [secondAuditId, accepted.accountId, accepted.fileId]
    );

    const afterRollback = await migrationStatus(database);
    const currentOwnedIndex = afterRollback.findIndex((entry) => entry.id === OWNED_MIGRATION);
    assert.ok(currentOwnedIndex >= 0);
    assert.equal(afterRollback.every((entry) => entry.checksumMatches), true);
    for (let index = 0; index < afterRollback.length; index += 1) {
      assert.equal(
        afterRollback[index].applied,
        index < currentOwnedIndex,
        `${afterRollback[index].id} applied state is wrong after owned rollback`
      );
    }

    const expectedReapply = [...rolledBack].reverse();
    assert.deepEqual(
      await applyPendingMigrations(database, `${env.releaseSha}-reapply`),
      expectedReapply
    );
    assert.deepEqual(
      await applyPendingMigrations(database, `${env.releaseSha}-reapply`),
      []
    );
    const finalStatus = await migrationStatus(database);
    assert.equal(finalStatus.every((entry) => entry.applied && entry.checksumMatches), true);
    return accepted;
  } finally {
    if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
  }
}

test("Subunit 2 rollback preserves quarantined file and immutable audit history", async () => {
  const env = environment("memory://", "secure-file-upload-stack-memory");
  const database = await openScriptDatabase(env);
  try {
    await exercise(database, env, "V");
  } finally {
    await database.close();
  }
});

test("quarantined provenance and audit facts survive PGlite close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-secure-upload-stack-"));
  const env = environment(directory, "secure-file-upload-stack-persistent");
  let database = await openScriptDatabase(env);
  try {
    const accepted = await exercise(database, env, "W");
    await database.close();
    database = null;

    const reopened = await openScriptDatabase(env);
    try {
      const file = await reopened.query(
        `SELECT lifecycle_status, file_extension, declared_mime, detected_mime,
                byte_size, content_sha256, quarantined_at, available_at
         FROM platform_secure_files WHERE file_id = $1`,
        [accepted.fileId]
      );
      assert.equal(file.rows.length, 1);
      assert.equal(file.rows[0].lifecycle_status, "quarantined");
      assert.equal(file.rows[0].file_extension, "pdf");
      assert.equal(file.rows[0].declared_mime, "application/pdf");
      assert.equal(file.rows[0].detected_mime, "application/pdf");
      assert.ok(file.rows[0].quarantined_at);
      assert.equal(file.rows[0].available_at, null);
      assert.match(file.rows[0].content_sha256, /^[a-f0-9]{64}$/);

      const audit = await reopened.query(
        `SELECT action_key, target_type, target_reference
         FROM platform_audit_events WHERE audit_event_id = $1`,
        [accepted.auditId]
      );
      assert.equal(audit.rows.length, 1);
      assert.equal(audit.rows[0].action_key, "secure_file.quarantined");
      assert.equal(audit.rows[0].target_reference, accepted.fileId);
      const status = await migrationStatus(reopened);
      assert.equal(status.every((entry) => entry.applied && entry.checksumMatches), true);
      assert.deepEqual(await applyPendingMigrations(reopened, "secure-upload-reopened"), []);
    } finally {
      await reopened.close();
    }
  } finally {
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});
