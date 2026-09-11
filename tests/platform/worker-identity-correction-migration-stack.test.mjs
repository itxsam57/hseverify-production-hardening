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

const OWNED_MIGRATION = "0021_worker_identity_corrections";
const PREVIOUS_MIGRATION = "0020_worker_identity_duplicate_worker_id";

function environment(pgliteDataDir, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir,
    releaseSha,
    sessionSecret: "worker-identity-correction-migration-session-secret-32-characters",
    authPepper: "worker-identity-correction-migration-auth-pepper-32-characters",
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

test("S6 correction schema and checksum survive PGlite close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-worker-identity-correction-"));
  const env = environment(directory, "worker-identity-correction-persistent");
  let database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const tables = await database.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'worker_identity_correction_requests',
           'worker_identity_correction_decisions',
           'worker_identity_correction_evidence_origins'
         )
       ORDER BY table_name`
    );
    assert.deepEqual(tables.rows.map((row) => row.table_name), [
      "worker_identity_correction_decisions",
      "worker_identity_correction_evidence_origins",
      "worker_identity_correction_requests"
    ]);
    const before = await statusThrough(database, OWNED_MIGRATION);
    assert.equal(before.every((entry) => entry.applied && entry.checksumMatches), true);
    await database.close();
    database = null;

    const reopened = await openScriptDatabase(env);
    try {
      const after = await statusThrough(reopened, OWNED_MIGRATION);
      assert.equal(after.every((entry) => entry.applied && entry.checksumMatches), true);
      const guard = await reopened.query(
        `SELECT pg_get_functiondef(oid) AS definition
         FROM pg_proc
         WHERE proname = 'worker_identity_guard_update'`
      );
      assert.equal(guard.rows.length, 1);
      const definition = guard.rows[0].definition;
      assert.match(definition, /correction_pending/);
      assert.match(definition, /worker_identity_correction_decisions/);
      assert.match(definition, /correction\.version_status = 'submitted'/);
      assert.match(definition, /decisions\.decision = 'accepted'/);
      assert.match(definition, /decisions\.decision = 'rejected'/);
      assert.match(
        definition,
        /Worker identity correction decision does not authorize verification/
      );
    } finally {
      await reopened.close();
    }
  } finally {
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("S6 rollback is monotonic and deterministic reapply keeps correction schema", async () => {
  const env = environment("memory://", "worker-identity-correction-rollback");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
    try {
      assert.equal(await rollbackLatestMigration(database, env), OWNED_MIGRATION);
    } finally {
      if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
      else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    }

    const retained = await database.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'worker_identity_correction_requests'`
    );
    assert.equal(retained.rows.length, 1, "logical rollback must preserve correction history schema");

    const rolled = await migrationStatus(database);
    assert.equal(rolled.find((entry) => entry.id === OWNED_MIGRATION)?.applied, false);
    assert.equal(rolled.find((entry) => entry.id === PREVIOUS_MIGRATION)?.applied, true);

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

test("S6 correction requests, decisions and evidence origins are append-only", async () => {
  const env = environment("memory://", "worker-identity-correction-immutability");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    for (const table of [
      "worker_identity_correction_requests",
      "worker_identity_correction_decisions",
      "worker_identity_correction_evidence_origins"
    ]) {
      const triggers = await database.query(
        `SELECT event_manipulation
         FROM information_schema.triggers
         WHERE event_object_table = $1
           AND event_manipulation IN ('UPDATE', 'DELETE')`,
        [table]
      );
      assert.deepEqual(
        new Set(triggers.rows.map((row) => row.event_manipulation)),
        new Set(["UPDATE", "DELETE"]),
        `${table} must reject update and delete`
      );
    }
  } finally {
    await database.close();
  }
});
