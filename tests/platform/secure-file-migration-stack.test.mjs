import assert from "node:assert/strict";
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

const OWNED_MIGRATION = "0011_secure_file_foundation";
const COMPLETE_MIGRATIONS = (await listMigrations()).map((migration) => migration.id);

function environment(pgliteDataDir, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir,
    releaseSha,
    sessionSecret: "secure-file-stack-session-secret-with-32-characters",
    authPepper: "secure-file-stack-auth-pepper-with-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function tableExists(database, tableName) {
  const result = await database.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return result.rows.length === 1;
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

async function seedAcceptedHistory(database, suffix) {
  const now = "2026-08-09T12:00:00.000Z";
  const accountId = `account_secure_stack_${suffix}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, `secure-stack-${suffix}@example.com`, `Secure Stack ${suffix}`, now]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    [accountId, now]
  );
  const auditId = `audit_secure_stack_${suffix}`;
  await database.query(
    `INSERT INTO platform_audit_events (
       audit_event_id, source_kind, actor_account_id, actor_role,
       action_key, outcome, target_type, target_reference, metadata
     ) VALUES ($1, 'native', $2, 'worker',
       'authorization.access.denied', 'denied', 'resource', $3, '{}'::jsonb)`,
    [auditId, accountId, `resource_secure_stack_${suffix}`]
  );
  return { accountId, auditId };
}

async function seedSecureFile(database, accountId, character) {
  const fileId = `secure_file_${character.repeat(24)}`;
  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, $3, 'worker', NULL, NULL,
       'local_test', $4, 'persistent.pdf')`,
    [
      fileId,
      character.toLowerCase().repeat(64),
      accountId,
      `secure-files/${character.toLowerCase().repeat(64)}`
    ]
  );
  return fileId;
}

async function exercise(database, env, suffix) {
  const ownedIndex = COMPLETE_MIGRATIONS.indexOf(OWNED_MIGRATION);
  assert.ok(ownedIndex >= 0, "secure-file migration must remain registered");
  assert.equal(COMPLETE_MIGRATIONS[ownedIndex - 1], "0010_email_delivery_foundation");
  assert.deepEqual(await applyPendingMigrations(database, env.releaseSha), COMPLETE_MIGRATIONS);
  assert.deepEqual(await applyPendingMigrations(database, env.releaseSha), []);
  const accepted = await seedAcceptedHistory(database, suffix);
  await seedSecureFile(database, accepted.accountId, "A");
  assert.equal(await tableExists(database, "platform_secure_files"), true);

  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  try {
    const rolledBack = await rollbackThrough(database, env, OWNED_MIGRATION);
    assert.equal(rolledBack.at(-1), OWNED_MIGRATION);
    assert.equal(await tableExists(database, "platform_secure_files"), false);

    const retainedAccount = await database.query(
      "SELECT account_id FROM auth_accounts WHERE account_id = $1",
      [accepted.accountId]
    );
    const retainedAudit = await database.query(
      "SELECT audit_event_id FROM platform_audit_events WHERE audit_event_id = $1",
      [accepted.auditId]
    );
    assert.equal(retainedAccount.rows.length, 1);
    assert.equal(retainedAudit.rows.length, 1);

    const statusAfterRollback = await migrationStatus(database);
    for (let index = 0; index < statusAfterRollback.length; index += 1) {
      const entry = statusAfterRollback[index];
      assert.equal(entry.checksumMatches, true, `${entry.id} checksum changed`);
      assert.equal(
        entry.applied,
        index < ownedIndex,
        `${entry.id} applied state after secure-file-owned rollback is wrong`
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
    assert.equal(await tableExists(database, "platform_secure_files"), true);
    const persistentFileId = await seedSecureFile(database, accepted.accountId, "B");
    const finalStatus = await migrationStatus(database);
    assert.equal(finalStatus.every((entry) => entry.applied), true);
    assert.equal(finalStatus.every((entry) => entry.checksumMatches), true);
    return { ...accepted, persistentFileId };
  } finally {
    if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
  }
}

test("secure file migration rolls back and reapplies without deleting accepted M1.01-M1.05 history", async () => {
  const env = environment("memory://", "secure-file-stack-memory");
  const database = await openScriptDatabase(env);
  try {
    await exercise(database, env, "memory");
  } finally {
    await database.close();
  }
});

test("secure file metadata and migration checksums survive PGlite close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-secure-file-stack-"));
  const env = environment(directory, "secure-file-stack-persistent");
  let database = await openScriptDatabase(env);
  try {
    const seeded = await exercise(database, env, "persistent");
    await database.close();
    database = null;

    const reopened = await openScriptDatabase(env);
    try {
      const retainedFile = await reopened.query(
        `SELECT file_id, lifecycle_status, object_key
         FROM platform_secure_files WHERE file_id = $1`,
        [seeded.persistentFileId]
      );
      assert.equal(retainedFile.rows.length, 1);
      assert.equal(retainedFile.rows[0].lifecycle_status, "reserved");
      assert.match(retainedFile.rows[0].object_key, /^secure-files\/[a-f0-9]{64}$/);
      const retainedAudit = await reopened.query(
        "SELECT audit_event_id FROM platform_audit_events WHERE audit_event_id = $1",
        [seeded.auditId]
      );
      assert.equal(retainedAudit.rows.length, 1);
      const status = await migrationStatus(reopened);
      assert.equal(status.every((entry) => entry.applied && entry.checksumMatches), true);
      assert.deepEqual(await applyPendingMigrations(reopened, "secure-file-reopened"), []);
    } finally {
      await reopened.close();
    }
  } finally {
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
