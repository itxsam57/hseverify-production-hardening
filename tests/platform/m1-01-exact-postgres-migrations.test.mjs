import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import {
  applyPendingMigrations,
  listMigrations,
  migrationStatus,
  rollbackLatestMigration
} from "../../scripts/lib/migrations.mjs";

const url = process.env.HSE_POSTGRES_TEST_DATABASE_URL;
if (!url || !new URL(url).hostname.match(/^(127\.0\.0\.1|localhost)$/)) {
  throw new Error("M1.01.02 requires an explicitly isolated loopback PostgreSQL database.");
}
const SHA = process.env.HSE_RELEASE_SHA;
if (!SHA || !/^[a-f0-9]{40}$/.test(SHA)) throw new Error("Exact test SHA is required.");
const environment = {
  appEnvironment: "test",
  databaseDriver: "postgres",
  databaseUrl: url,
  releaseSha: SHA
};
const INJECTED_ID = "9999_unrecognized_migration_ledger_probe";
let database;

test("M1.01.02 real PostgreSQL applies 134 migrations once, preserves history, and safely refuses an unknown applied migration", { timeout: 180_000 }, async () => {
  database = await openScriptDatabase(environment);
  try {
    const files = await listMigrations();
    assert.equal(files.length, 134, "Exact release's migration inventory changed");
    const applied = await applyPendingMigrations(database, SHA);
    assert.deepEqual(applied, files.map(row => row.id));
    assert.deepEqual(await applyPendingMigrations(database, SHA), [], "Repeat must be idempotent");
    const first = await database.query(
      "SELECT migration_id, checksum, release_sha, applied_at FROM hse_schema_migrations ORDER BY migration_id"
    );
    assert.equal(first.rows.length, 134);
    assert(first.rows.every(row => row.release_sha === SHA));
    const status = await migrationStatus(database);
    assert(status.every(row => row.applied && row.checksumMatches));

    await database.query(
      "INSERT INTO hse_schema_migrations (migration_id, checksum, release_sha) VALUES ($1,$2,$3)",
      [INJECTED_ID, "0".repeat(64), "injected-unrecognized-for-test-only"]
    );
    try {
      await assert.rejects(() => migrationStatus(database), /Unknown applied migration/i);
      await assert.rejects(() => applyPendingMigrations(database, SHA), /Unknown applied migration/i);
      const cliEnvironment = {
        ...process.env,
        NODE_ENV: "test", HSE_APP_ENV: "test", HSE_DATABASE_DRIVER: "postgres",
        DATABASE_URL: url, HSE_RELEASE_SHA: SHA,
        HSE_SESSION_SECRET: "m10102-disposable-PG16-session-key-test-only-32",
        HSE_AUTH_PEPPER: "m10102-disposable-PG16-pepper-test-only-32",
        HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK: "true",
        HSE_ENABLE_WORKER_DEMO_AUTH: "false", HSE_USE_WORKER_DEMO_DATA: "false",
        HSE_ENABLE_AUTH_SANDBOX: "false"
      };
      for (const command of ["db-status.mjs", "db-migrate.mjs", "db-rollback.mjs"]) {
        const execution = spawnSync(process.execPath, ["scripts/" + command], {
          encoding: "utf8", env: cliEnvironment, timeout: 30_000
        });
        assert.notEqual(execution.status, 0, command + " silently accepted rogue applied migration");
        assert.match(execution.stdout + execution.stderr, /Unknown applied migration/i, command);
      }
      const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
      process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
      try {
        await assert.rejects(
          () => rollbackLatestMigration(database, environment),
          /Unknown applied migration/i
        );
      } finally {
        if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
        else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
      }
    } finally {
      await database.query("DELETE FROM hse_schema_migrations WHERE migration_id = $1", [INJECTED_ID]);
    }
    const after = await database.query(
      "SELECT migration_id, checksum, release_sha, applied_at FROM hse_schema_migrations ORDER BY migration_id"
    );
    assert.deepEqual(after.rows, first.rows, "Rejected unknown migration must not rewrite historical records");
  } finally {
    await database.close();
  }
});

test("M1.01.02 production and preview forbid destructive rollback, and corrupted checksums deny apply", { timeout: 180_000 }, async () => {
  database = await openScriptDatabase(environment);
  try {
    const checks = await database.query("SELECT checksum FROM hse_schema_migrations WHERE migration_id = $1", ["0012_secure_file_upload_quarantine"]);
    assert.equal(checks.rows.length, 1);
    const checksum = checks.rows[0].checksum;
    const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
    try {
      for (const appEnvironment of ["production", "preview"]) {
        await assert.rejects(
          () => rollbackLatestMigration(database, { ...environment, appEnvironment }),
          /prohibited in preview and production/
        );
      }
      await database.query(
        "UPDATE hse_schema_migrations SET checksum = $1 WHERE migration_id = $2",
        ["0".repeat(64), "0012_secure_file_upload_quarantine"]
      );
      try {
        await assert.rejects(
          () => applyPendingMigrations(database, SHA),
          /Applied migration checksum mismatch: 0012_secure_file_upload_quarantine/
        );
        await assert.rejects(
          () => rollbackLatestMigration(database, environment),
          /Applied migration checksum mismatch: 0012_secure_file_upload_quarantine/
        );
      } finally {
        await database.query(
          "UPDATE hse_schema_migrations SET checksum = $1 WHERE migration_id = $2",
          [checksum, "0012_secure_file_upload_quarantine"]
        );
      }
    } finally {
      if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
      else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    }
  } finally {
    await database.close();
  }
});

test("M1.01.02 explicitly acknowledged test rollback preserves preceding history and reapply restores all 134", { timeout: 180_000 }, async () => {
  database = await openScriptDatabase(environment);
  try {
    await database.execute("CREATE TABLE IF NOT EXISTS m10102_local_data_sentinel (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    await database.query("INSERT INTO m10102_local_data_sentinel (id,value) VALUES ($1,$2)", ["m10102", "retain-me"]);
    const history = await database.query(
      "SELECT migration_id, checksum, release_sha, applied_at FROM hse_schema_migrations ORDER BY migration_id"
    );
    const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    try {
      delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
      await assert.rejects(() => rollbackLatestMigration(database, environment), /HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=true/);
      process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
      const rolledBack = await rollbackLatestMigration(database, environment);
      assert.equal(rolledBack, "0129_assurance_role_action_destinations");
      const partial = await database.query("SELECT migration_id FROM hse_schema_migrations ORDER BY migration_id");
      assert.equal(partial.rows.length, 133);
      assert.equal(partial.rows.some(row => row.migration_id === rolledBack), false);
      assert.deepEqual(await applyPendingMigrations(database, SHA), [rolledBack]);
      assert.deepEqual(await applyPendingMigrations(database, SHA), []);
      const final = await database.query(
        "SELECT migration_id, checksum, release_sha, applied_at FROM hse_schema_migrations ORDER BY migration_id"
      );
      assert.deepEqual(final.rows.slice(0, -1), history.rows.slice(0, -1), "Unrelated migration history must survive rollback/reapply");
      assert.equal(final.rows.length, 134);
      assert.equal((await database.query("SELECT value FROM m10102_local_data_sentinel WHERE id=$1", ["m10102"])).rows[0].value, "retain-me");
    } finally {
      if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
      else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    }
  } finally {
    await database.close();
  }
});


test("M1.01.02 all 134 reverse down migrations are executable in disposable PG16 and completely reapply", { timeout: 240_000 }, async () => {
  database = await openScriptDatabase(environment);
  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  try {
    const migrations = await listMigrations();
    const expected = migrations.map(row => row.id).reverse();
    const rolled = [];
    for (const id of expected) {
      const actual = await rollbackLatestMigration(database, environment);
      assert.equal(actual, id, `Expected reverse rollback of ${id}`);
      rolled.push(actual);
    }
    assert.equal(rolled.length, 134);
    assert.equal(await rollbackLatestMigration(database, environment), null);
    const pending = await migrationStatus(database);
    assert.equal(pending.filter(row => row.applied).length, 0);
    assert.deepEqual(await applyPendingMigrations(database, SHA), migrations.map(row => row.id));
    assert.deepEqual(await applyPendingMigrations(database, SHA), []);
    const full = await migrationStatus(database);
    assert.equal(full.length, 134);
    assert(full.every(row => row.applied && row.checksumMatches));
  } finally {
    if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    await database.close();
  }
});
