import assert from "node:assert/strict";
import { win32 } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { validateScriptEnvironment } from "../../scripts/lib/environment.mjs";
import {
  applyPendingMigrations,
  listMigrations,
  migrationStatus,
  rollbackLatestMigration
} from "../../scripts/lib/migrations.mjs";
import { normalizePgliteDataDirectory } from "../../src/lib/database/pglite-path.mjs";

const TEST_ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "platform-test-release",
  sessionSecret: "platform-test-session-secret-with-at-least-thirty-two-characters",
  authPepper: "platform-test-session-secret-with-at-least-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const COMPLETE_MIGRATION_IDS = (await listMigrations()).map(
  (migration) => migration.id
);

async function tableExists(database, tableName) {
  const result = await database.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return result.rows.length === 1;
}

test("environment validation separates local, sandbox and production rules", () => {
  const local = validateScriptEnvironment({
    NODE_ENV: "test",
    HSE_APP_ENV: "test",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: "memory://",
    HSE_SESSION_SECRET: TEST_ENVIRONMENT.sessionSecret
  });
  assert.equal(local.databaseDriver, "pglite");
  assert.equal(local.authPepper, TEST_ENVIRONMENT.sessionSecret);
  assert.equal(local.authSandboxEnabled, false);

  const sandbox = validateScriptEnvironment({
    NODE_ENV: "test",
    HSE_APP_ENV: "test",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: "memory://",
    HSE_SESSION_SECRET: TEST_ENVIRONMENT.sessionSecret,
    HSE_ENABLE_AUTH_SANDBOX: "true",
    HSE_AUTH_SANDBOX_ACCESS_KEY: "registration-sandbox-key"
  });
  assert.equal(sandbox.authSandboxEnabled, true);

  assert.throws(
    () =>
      validateScriptEnvironment({
        NODE_ENV: "production",
        HSE_APP_ENV: "production",
        HSE_DATABASE_DRIVER: "pglite",
        HSE_SESSION_SECRET: TEST_ENVIRONMENT.sessionSecret,
        HSE_ENABLE_WORKER_DEMO_AUTH: "true",
        HSE_ENABLE_AUTH_SANDBOX: "true",
        HSE_AUTH_SANDBOX_ACCESS_KEY: "registration-sandbox-key"
      }),
    /PGlite is restricted|demo|sandbox|HSE_AUTH_PEPPER/i
  );
});

test("PGlite path normalization returns a native Windows string", () => {
  const normalized = normalizePgliteDataDirectory(
    ".data\\postgres-owner-test",
    {
      cwd: "C:\\work\\hseverify",
      pathApi: win32
    }
  );

  assert.equal(
    normalized,
    "C:\\work\\hseverify\\.data\\postgres-owner-test"
  );
  assert.equal(typeof normalized, "string");
  assert.equal(normalizePgliteDataDirectory("memory://"), "memory://");
  assert.throws(
    () =>
      normalizePgliteDataDirectory(
        new URL("file:///C:/work/hseverify/.data/postgres")
      ),
    /must be a string/
  );
});

test("migrations are deterministic and idempotent", async () => {
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    const first = await applyPendingMigrations(
      database,
      TEST_ENVIRONMENT.releaseSha
    );
    assert.deepEqual(first, COMPLETE_MIGRATION_IDS);
    const second = await applyPendingMigrations(
      database,
      TEST_ENVIRONMENT.releaseSha
    );
    assert.deepEqual(second, []);
    const status = await migrationStatus(database);
    assert.equal(status.length, COMPLETE_MIGRATION_IDS.length);
    for (const entry of status) {
      assert.equal(entry.applied, true);
      assert.equal(entry.checksumMatches, true);
    }
  } finally {
    await database.close();
  }
});

test("worker profile writes reject stale versions at the SQL boundary", async () => {
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const document = JSON.stringify({
      schemaVersion: 1,
      workerSub: "worker-test-sub",
      workerId: "HSE-WRK-TEST-DB",
      version: 1,
      status: "draft",
      personal: {},
      contact: {},
      professional: {},
      audit: []
    });
    const inserted = await database.query(
      `INSERT INTO worker_profiles (
         worker_sub, worker_id, schema_version, version, status,
         profile_document, created_at, updated_at, submitted_at
       ) VALUES ($1, $2, 1, 1, 'draft', $3::jsonb, $4, $4, NULL)
       RETURNING version`,
      [
        "worker-test-sub",
        "HSE-WRK-TEST-DB",
        document,
        new Date().toISOString()
      ]
    );
    assert.equal(inserted.rows.length, 1);

    const updated = await database.query(
      `UPDATE worker_profiles
       SET version = 2
       WHERE worker_sub = $1 AND version = 1
       RETURNING version`,
      ["worker-test-sub"]
    );
    assert.equal(updated.rows[0].version, 2);

    const stale = await database.query(
      `UPDATE worker_profiles
       SET version = 3
       WHERE worker_sub = $1 AND version = 1
       RETURNING version`,
      ["worker-test-sub"]
    );
    assert.equal(stale.rows.length, 0);
  } finally {
    await database.close();
  }
});

test("local rollback removes only the current latest brick and is reversible", async () => {
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  const original = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    assert.equal(await tableExists(database, "platform_outbox_jobs"), true);

    const latestMigrationId = COMPLETE_MIGRATION_IDS.at(-1);
    assert.ok(latestMigrationId, "at least one migration must exist");
    const rolledBack = await rollbackLatestMigration(
      database,
      TEST_ENVIRONMENT
    );
    assert.equal(rolledBack, latestMigrationId);

    const status = await migrationStatus(database);
    for (const id of COMPLETE_MIGRATION_IDS.slice(0, -1)) {
      const entry = status.find((item) => item.id === id);
      assert.equal(entry?.applied, true, `${id} must remain applied`);
      assert.equal(entry?.checksumMatches, true, `${id} checksum changed`);
    }
    const latest = status.find((entry) => entry.id === latestMigrationId);
    assert.equal(latest?.applied, false);
    assert.equal(latest?.checksumMatches, true);

    const reapplied = await applyPendingMigrations(
      database,
      TEST_ENVIRONMENT.releaseSha
    );
    assert.deepEqual(reapplied, [latestMigrationId]);
    const finalStatus = await migrationStatus(database);
    assert.equal(finalStatus.every((entry) => entry.applied), true);
    assert.equal(finalStatus.every((entry) => entry.checksumMatches), true);
  } finally {
    if (original === undefined) {
      delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    } else {
      process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = original;
    }
    await database.close();
  }
});