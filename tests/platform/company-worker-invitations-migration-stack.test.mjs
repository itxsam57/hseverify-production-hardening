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
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const OWNED_MIGRATION = "0029_company_worker_invitations_cross_brick_hardening";
const OWNED_TABLES = Object.freeze([
  "company_registration_codes",
  "company_worker_invitations",
  "company_worker_links"
]);

function environment(path, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: path,
    releaseSha,
    sessionSecret: "m1-10-migration-session-secret-with-more-than-thirty-two-characters",
    authPepper: "m1-10-migration-auth-pepper-with-more-than-thirty-two-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function ownedTables(database) {
  const tables = await database.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [[...OWNED_TABLES]]
  );
  return tables.rows.map((row) => row.table_name);
}

function statusThroughOwned(status) {
  const ownedIndex = status.findIndex((entry) => entry.id === OWNED_MIGRATION);
  assert.ok(ownedIndex >= 0, `migration status must contain ${OWNED_MIGRATION}`);
  return status.slice(0, ownedIndex + 1);
}

async function proveLowerBrickRollback({ dataDirectory, releaseSha }) {
  const env = environment(dataDirectory, releaseSha);
  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  const database = await openScriptDatabase(env);
  try {
    await applyPendingMigrations(database, env.releaseSha);
    const migrationIds = (await listMigrations()).map((migration) => migration.id);
    const authenticationIndex = migrationIds.indexOf("0002_authentication_foundation");
    assert.ok(authenticationIndex >= 0);

    for (const migrationId of migrationIds.slice(authenticationIndex).reverse()) {
      const rolledBack = await rollbackLatestMigration(database, env);
      assert.equal(rolledBack, migrationId);
    }

    assert.deepEqual(
      await ownedTables(database),
      [...OWNED_TABLES],
      "retained M1.10 history tables must not own hard dependencies on rolled-back lower bricks"
    );
    const authTable = await database.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name='auth_accounts'`
    );
    assert.equal(authTable.rows.length, 0);

    const expectedReapply = migrationIds.slice(authenticationIndex);
    assert.deepEqual(
      await applyPendingMigrations(database, `${releaseSha}-reapply`),
      expectedReapply
    );
    assert.deepEqual(await ownedTables(database), [...OWNED_TABLES]);
    const finalStatus = await migrationStatus(database);
    assert.equal(finalStatus.every((entry) => entry.applied && entry.checksumMatches), true);

    await assert.rejects(
      database.query(
        `INSERT INTO company_worker_invitations (
           invitation_id, tenant_id, email_normalized, token_hash,
           invited_by_membership_id, resend_available_at, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          `worker_invitation_${"Z".repeat(24)}`,
          `tenant_${"Z".repeat(24)}`,
          "orphan@example.com",
          "orphan-token-hash",
          `membership_${"Z".repeat(24)}`,
          "2026-08-16T13:00:00.000Z",
          "2026-08-17T12:00:00.000Z"
        ]
      ),
      /Company workforce tenant is unavailable/i,
      "reapplied M1.10 database guards must still reject orphaned lower-layer authority"
    );
  } finally {
    if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    await database.close();
  }
}

test("M1.10 migration is monotonic, restart-safe and rollback/reapply-safe", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-m110-migration-"));
  const databasePath = join(directory, "pglite");
  const env = environment(databasePath, "m1-10-red-green-migration");
  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  let database = await openScriptDatabase(env);
  try {
    const applied = await applyMigrationsThrough(
      database,
      env.releaseSha,
      OWNED_MIGRATION
    );
    assert.equal(applied.at(-1), OWNED_MIGRATION);
    assert.deepEqual(await ownedTables(database), [...OWNED_TABLES]);

    await database.close();
    database = await openScriptDatabase({ ...env, releaseSha: "m1-10-restart" });
    const statusAfterRestart = statusThroughOwned(await migrationStatus(database));
    assert.equal(statusAfterRestart.every((entry) => entry.applied && entry.checksumMatches), true);

    const rolledBack = await rollbackLatestMigration(database, env);
    assert.equal(rolledBack, OWNED_MIGRATION);
    const afterRollback = await migrationStatus(database);
    assert.equal(afterRollback.find((entry) => entry.id === OWNED_MIGRATION)?.applied, false);
    assert.deepEqual(
      await ownedTables(database),
      [...OWNED_TABLES],
      "ledger rollback must not remove accepted M1.10 workforce/security history tables"
    );

    assert.deepEqual(
      await applyMigrationsThrough(database, "m1-10-reapply", OWNED_MIGRATION),
      [OWNED_MIGRATION]
    );
    assert.deepEqual(await ownedTables(database), [...OWNED_TABLES]);
    const finalStatus = statusThroughOwned(await migrationStatus(database));
    assert.equal(finalStatus.every((entry) => entry.applied && entry.checksumMatches), true);
  } finally {
    if (database) await database.close();
    if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("M1.10 filesystem PGlite history never blocks lower-brick rollback and reapply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-m110-lower-rollback-"));
  try {
    await proveLowerBrickRollback({
      dataDirectory: join(directory, "pglite"),
      releaseSha: "m1-10-lower-rollback-filesystem"
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("M1.10 memory PGlite history never blocks lower-brick rollback and reapply", async () => {
  await proveLowerBrickRollback({
    dataDirectory: "memory://",
    releaseSha: "m1-10-lower-rollback-memory"
  });
});