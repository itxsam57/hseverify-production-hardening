import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations, listMigrations, rollbackLatestMigration } from "../../scripts/lib/migrations.mjs";

test("isolated PostgreSQL applies migrations atomically and refuses a checksum mismatch and production rollback", { timeout: 90000 }, async () => {
  const path = await realpath(process.env.HSE_SOFTWARE_STAGE_CONFIG);
  const config = JSON.parse(await readFile(path, "utf8"));
  assert.equal(config.syntheticOnly, true);
  assert.equal(dirname(path), config.privateRoot);
  assert.ok(config.privateRoot.startsWith(resolve(config.projectRoot, "..") + "/hse-https-stage."));
  const url = new URL(config.applicationEnvironment.DATABASE_URL);
  assert.equal(url.hostname, "127.0.0.1");

  const name = "migration_drill_" + randomBytes(8).toString("hex");
  const admin = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl: url.href });
  let database;
  let created = false;
  const oldAcknowledgement = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  try {
    await admin.execute('CREATE DATABASE "' + name + '"');
    created = true;
    url.pathname = "/" + name;
    database = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl: url.href });
    const migrations = await listMigrations();
    const readHistory = async () => (await database.query("SELECT * FROM hse_schema_migrations ORDER BY migration_id")).rows;
    let appliedSchemaInsideFailedTransaction = false;
    const interrupted = {
      execute: (...args) => database.execute(...args),
      query: (...args) => database.query(...args),
      transaction: operation => database.transaction(tx => operation({
        execute: (...args) => tx.execute(...args),
        query: async (sql, params) => {
          if (sql.includes("INSERT INTO hse_schema_migrations")) {
            appliedSchemaInsideFailedTransaction = Boolean((await tx.query("SELECT to_regclass('public.worker_profiles') AS present")).rows[0].present);
            throw new Error("Injected interruption before migration history write");
          }
          return tx.query(sql, params);
        },
      })),
    };
    await assert.rejects(applyPendingMigrations(interrupted, config.candidateSha), /Injected interruption/);
    assert.equal(appliedSchemaInsideFailedTransaction, true);
    assert.deepEqual(await readHistory(), []);
    assert.equal((await database.query("SELECT to_regclass('public.worker_profiles') AS present")).rows[0].present, null);

    assert.deepEqual(await applyPendingMigrations(database, config.candidateSha), migrations.map(item => item.id));
    const history = await readHistory();
    assert.deepEqual(history.map(row => [row.migration_id, row.checksum, row.release_sha]),
      migrations.map(item => [item.id, item.checksum, config.candidateSha]));
    const constraint = (await database.query(`
      SELECT convalidated, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.assurance_action_items'::regclass
        AND conname = 'assurance_action_items_deep_link_check'
    `)).rows[0];
    assert.equal(constraint?.convalidated, true);
    for (const destination of ["/worker/assurance-cases", "/admin/operations/scoring-assignments", "/assessor/interviews"]) {
      assert.ok(constraint.definition.includes(destination));
    }
    assert.deepEqual(await applyPendingMigrations(database, config.candidateSha), []);
    assert.deepEqual(await readHistory(), history);

    process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
    await assert.rejects(rollbackLatestMigration(database, { appEnvironment: "production" }), /rollback is prohibited/i);
    assert.deepEqual(await readHistory(), history);
    await database.query("UPDATE hse_schema_migrations SET checksum=$1 WHERE migration_id=$2",
      ["0".repeat(64), history[0].migration_id]);
    const mismatchedHistory = await readHistory();
    await assert.rejects(applyPendingMigrations(database, config.candidateSha), /checksum mismatch/i);
    assert.deepEqual(await readHistory(), mismatchedHistory);
    console.log("POSTGRES_MIGRATION_SAFETY_PASS", migrations.length, "migrations", config.candidateSha);
  } finally {
    if (oldAcknowledgement === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = oldAcknowledgement;
    await database?.close();
    if (created) await admin.execute('DROP DATABASE "' + name + '"');
    await admin.close();
  }
});
