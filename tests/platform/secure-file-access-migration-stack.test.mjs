import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import {
  applyPendingMigrations,
  listMigrations,
  migrationStatus,
  rollbackLatestMigration
} from "../../scripts/lib/migrations.mjs";

const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "secure-file-access-migration-stack",
  sessionSecret: "secure-file-access-migration-session-secret-32-chars",
  authPepper: "secure-file-access-migration-auth-pepper-32-chars",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};
const MIGRATION_ID = "0014_secure_file_signed_access_audit";
const FILE_REF = `secure_file_${"R".repeat(24)}`;

async function insertAccessAudit(database, id, action, purpose) {
  await database.query(
    `INSERT INTO platform_audit_events (
       audit_event_id, source_kind, action_key, outcome,
       target_type, target_reference, metadata
     ) VALUES ($1, 'native', $2, 'succeeded',
       'secure_file', $3, $4::jsonb)`,
    [id, action, FILE_REF, JSON.stringify({ purpose })]
  );
}

function findMigration(status, migrationId) {
  const migration = status.find((item) => item.id === migrationId);
  assert.ok(migration, `${migrationId} must remain registered`);
  return migration;
}

test("signed access audit vocabulary rollback is monotonic and reapply-safe", async () => {
  const database = await openScriptDatabase(ENVIRONMENT);
  const previousRollbackAcknowledgement =
    process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";

  try {
    const migrations = await listMigrations();
    const ownIndex = migrations.findIndex((migration) => migration.id === MIGRATION_ID);
    assert.ok(ownIndex >= 0, `${MIGRATION_ID} must remain registered`);

    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    assert.equal(
      findMigration(await migrationStatus(database), MIGRATION_ID).applied,
      true
    );

    await insertAccessAudit(
      database,
      "audit_access_migration_authorized",
      "secure_file.access.authorized",
      "preview"
    );

    // Roll back from the latest applied migration through this migration using
    // the repository's real guarded rollback contract. This remains valid if
    // later migrations are added: each disposable later migration is unwound
    // before the historical 0014 boundary is reached.
    const rollbackCount = migrations.length - ownIndex;
    for (let index = 0; index < rollbackCount; index += 1) {
      const rolledBack = await rollbackLatestMigration(database, ENVIRONMENT);
      assert.ok(rolledBack, "Expected one applied migration to roll back");
    }

    const statusAfterRollback = await migrationStatus(database);
    const ownAfterRollback = findMigration(statusAfterRollback, MIGRATION_ID);
    assert.equal(ownAfterRollback.applied, false);
    assert.equal(ownAfterRollback.checksumMatches, true);

    const preserved = await database.query(
      `SELECT action_key, metadata
       FROM platform_audit_events
       WHERE audit_event_id = 'audit_access_migration_authorized'`
    );
    assert.equal(preserved.rows.length, 1);
    assert.equal(preserved.rows[0].action_key, "secure_file.access.authorized");
    assert.deepEqual(preserved.rows[0].metadata, { purpose: "preview" });

    // The down migration is intentionally monotonic: immutable historical
    // vocabulary remains legal while its migration is logically pending.
    await insertAccessAudit(
      database,
      "audit_access_migration_served",
      "secure_file.access.served",
      "download"
    );

    const reapplied = await applyPendingMigrations(
      database,
      `${ENVIRONMENT.releaseSha}-reapply`
    );
    assert.ok(reapplied.includes(MIGRATION_ID));
    const ownAfterReapply = findMigration(
      await migrationStatus(database),
      MIGRATION_ID
    );
    assert.equal(ownAfterReapply.applied, true);
    assert.equal(ownAfterReapply.checksumMatches, true);
    assert.equal(
      ownAfterReapply.releaseSha,
      `${ENVIRONMENT.releaseSha}-reapply`
    );

    await insertAccessAudit(
      database,
      "audit_access_migration_reapplied",
      "secure_file.access.authorized",
      "download"
    );
    const finalRows = await database.query(
      `SELECT audit_event_id
       FROM platform_audit_events
       WHERE audit_event_id LIKE 'audit_access_migration_%'
       ORDER BY audit_sequence`
    );
    assert.deepEqual(
      finalRows.rows.map((row) => row.audit_event_id),
      [
        "audit_access_migration_authorized",
        "audit_access_migration_served",
        "audit_access_migration_reapplied"
      ]
    );
  } finally {
    if (previousRollbackAcknowledgement === undefined) {
      delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    } else {
      process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK =
        previousRollbackAcknowledgement;
    }
    await database.close();
  }
});
