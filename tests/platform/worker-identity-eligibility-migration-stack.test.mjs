import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import {
  migrationStatus,
  rollbackLatestMigration
} from "../../scripts/lib/migrations.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const OWNED_MIGRATION = "0020_worker_identity_duplicate_worker_id";
const PREVIOUS_MIGRATION = "0019_worker_identity_automated_checks";

function environment(pgliteDataDir, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir,
    releaseSha,
    sessionSecret: "worker-identity-eligibility-migration-session-secret-32-characters",
    authPepper: "worker-identity-eligibility-migration-auth-pepper-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function statusThrough(database, migrationId) {
  const status = await migrationStatus(database);
  const index = status.findIndex((entry) => entry.id === migrationId);
  assert.ok(index >= 0, `${migrationId} must exist in migration status`);
  return status.slice(0, index + 1);
}

test("S5 duplicate eligibility schema and migration checksum survive PGlite close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-worker-identity-eligibility-"));
  const env = environment(directory, "worker-identity-eligibility-persistent");
  let database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const tables = await database.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'worker_identity_duplicate_checks',
           'worker_identity_duplicate_signals',
           'worker_identity_duplicate_dispositions',
           'worker_identity_worker_ids'
         )
       ORDER BY table_name`
    );
    assert.deepEqual(tables.rows.map((row) => row.table_name), [
      "worker_identity_duplicate_checks",
      "worker_identity_duplicate_dispositions",
      "worker_identity_duplicate_signals",
      "worker_identity_worker_ids"
    ]);
    const before = await statusThrough(database, OWNED_MIGRATION);
    assert.equal(before.every((entry) => entry.applied && entry.checksumMatches), true);
    await database.close();
    database = null;

    const reopened = await openScriptDatabase(env);
    try {
      const after = await statusThrough(reopened, OWNED_MIGRATION);
      assert.equal(after.every((entry) => entry.applied && entry.checksumMatches), true);
      const constraint = await reopened.query(
        `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
         WHERE conname = 'platform_audit_events_action_key_check'`
      );
      assert.equal(constraint.rows.length, 1);
      for (const action of [
        "worker_identity.duplicate.evaluated",
        "worker_identity.duplicate.disposition.recorded",
        "worker_identity.worker_id.issued"
      ]) {
        assert.match(constraint.rows[0].definition, new RegExp(action.replaceAll(".", "\\.")));
      }
    } finally {
      await reopened.close();
    }
  } finally {
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("S5 rollback is monotonic and deterministic reapply preserves accepted lower-layer data", async () => {
  const env = environment("memory://", "worker-identity-eligibility-rollback");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    await database.query(
      `INSERT INTO auth_accounts (
         account_id, email_normalized, display_name, account_status,
         email_verified_at, created_at, updated_at
       ) VALUES (
         'account_s5_rollback_fixture',
         's5-rollback@example.com',
         'S5 Rollback Fixture',
         'pending_phone',
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP
       )`
    );

    const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
    try {
      assert.equal(await rollbackLatestMigration(database, env), OWNED_MIGRATION);
    } finally {
      if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
      else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    }

    const retainedTables = await database.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'worker_identity_worker_ids'`
    );
    assert.equal(retainedTables.rows.length, 1, "logical rollback must preserve permanent-ID schema/history");
    const retainedAccount = await database.query(
      `SELECT account_id FROM auth_accounts WHERE account_id = 'account_s5_rollback_fixture'`
    );
    assert.equal(retainedAccount.rows.length, 1);

    const afterRollback = await migrationStatus(database);
    const owned = afterRollback.find((entry) => entry.id === OWNED_MIGRATION);
    const previousLayer = afterRollback.find((entry) => entry.id === PREVIOUS_MIGRATION);
    assert.equal(owned?.applied, false);
    assert.equal(previousLayer?.applied, true);

    assert.deepEqual(
      await applyMigrationsThrough(database, `${env.releaseSha}-reapply`, OWNED_MIGRATION),
      [OWNED_MIGRATION]
    );
    const finalStatus = await statusThrough(database, OWNED_MIGRATION);
    assert.equal(finalStatus.every((entry) => entry.applied && entry.checksumMatches), true);
  } finally {
    await database.close();
  }
});

test("S5 eligibility tables are append-only and Worker-ID rows reject mutation", async () => {
  const env = environment("memory://", "worker-identity-eligibility-immutability");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    for (const table of [
      "worker_identity_duplicate_checks",
      "worker_identity_duplicate_signals",
      "worker_identity_duplicate_dispositions",
      "worker_identity_worker_ids"
    ]) {
      const triggers = await database.query(
        `SELECT trigger_name
         FROM information_schema.triggers
         WHERE event_object_table = $1
           AND event_manipulation IN ('UPDATE', 'DELETE')`,
        [table]
      );
      assert.equal(
        triggers.rows.length >= 2,
        true,
        `${table} must retain update/delete immutability triggers`
      );
    }
  } finally {
    await database.close();
  }
});
