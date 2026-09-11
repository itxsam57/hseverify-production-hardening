import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { migrationStatus, rollbackLatestMigration } from "../../scripts/lib/migrations.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const OWNED_MIGRATION = "0031_public_verification_foundation";
const OWNED_TABLES = Object.freeze([
  "public_verification_concerns",
  "public_verification_rate_limits"
]);
const NOW = "2026-08-17T13:20:00.000Z";

function environment(path, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: path,
    releaseSha,
    sessionSecret: "m1-12-public-verification-session-secret-with-more-than-thirty-two-characters",
    authPepper: "m1-12-public-verification-auth-pepper-with-more-than-thirty-two-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function tableNames(database) {
  const result = await database.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema='public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name`,
    [[...OWNED_TABLES]]
  );
  return result.rows.map((row) => row.table_name);
}

async function constraintDefinition(database, tableName, constraintName) {
  const result = await database.query(
    `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint AS c
       JOIN pg_class AS relation ON relation.oid=c.conrelid
      WHERE relation.relname=$1 AND c.conname=$2`,
    [tableName, constraintName]
  );
  assert.equal(result.rows.length, 1, `${constraintName} must exist`);
  return result.rows[0].definition;
}

async function seedConcern(database, suffix = "migration") {
  const concernId = `public_concern_${suffix.padEnd(24, "x").slice(0, 24)}`;
  const idempotencyKey = "a".repeat(64);
  const subjectReferenceHash = "b".repeat(64);
  await database.query(
    `INSERT INTO public_verification_concerns (
       concern_id, subject_reference_hash, category, description,
       contact_name, contact_email, contact_phone,
       intake_status, idempotency_key, created_at, updated_at
     ) VALUES ($1,$2,'suspected_fraud',$3,$4,$5,NULL,'received',$6,$7,$7)`,
    [
      concernId,
      subjectReferenceHash,
      "The public verification result appears to have been copied or altered.",
      "Concern Reporter",
      "reporter@example.com",
      idempotencyKey,
      NOW
    ]
  );
  return { concernId, idempotencyKey, subjectReferenceHash };
}

async function assertConcern(database, concern) {
  const result = await database.query(
    `SELECT concern_id, subject_reference_hash, category, description,
            contact_name, contact_email, contact_phone,
            intake_status, idempotency_key
       FROM public_verification_concerns
      WHERE concern_id=$1`,
    [concern.concernId]
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].subject_reference_hash, concern.subjectReferenceHash);
  assert.equal(result.rows[0].category, "suspected_fraud");
  assert.equal(result.rows[0].intake_status, "received");
  assert.equal(result.rows[0].idempotency_key, concern.idempotencyKey);
}

test("M1.12 migration creates bounded public verification abuse and concern intake tables", async () => {
  const database = await openScriptDatabase(environment("memory://", "m1-12-migration-shape"));
  try {
    const applied = await applyMigrationsThrough(
      database,
      "m1-12-migration-shape",
      OWNED_MIGRATION
    );
    assert.equal(applied.at(-1), OWNED_MIGRATION);
    assert.deepEqual(await tableNames(database), [...OWNED_TABLES]);

    const rateAction = await constraintDefinition(
      database,
      "public_verification_rate_limits",
      "public_verification_rate_limits_action_check"
    );
    for (const action of ["lookup", "result", "concern", "concern_upload"]) {
      assert.match(rateAction, new RegExp(`'${action}'`));
    }

    const concernCategory = await constraintDefinition(
      database,
      "public_verification_concerns",
      "public_verification_concerns_category_check"
    );
    for (const category of [
      "identity_mismatch",
      "suspected_fraud",
      "status_dispute",
      "document_concern",
      "other"
    ]) {
      assert.match(concernCategory, new RegExp(`'${category}'`));
    }

    const contactShape = await constraintDefinition(
      database,
      "public_verification_concerns",
      "public_verification_concerns_contact_check"
    );
    assert.match(contactShape, /contact_email/i);
    assert.match(contactShape, /contact_phone/i);

    const keyColumns = await database.query(
      `SELECT a.attname AS column_name
         FROM pg_index i
         JOIN pg_class t ON t.oid=i.indrelid
         JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(i.indkey)
        WHERE t.relname='public_verification_rate_limits'
          AND i.indisprimary
        ORDER BY array_position(i.indkey, a.attnum)`
    );
    assert.deepEqual(
      keyColumns.rows.map((row) => row.column_name),
      ["action", "bucket_key"]
    );

    const concern = await seedConcern(database, "shape");
    await assert.rejects(
      () => database.query(
        `UPDATE public_verification_concerns
            SET description='mutated finalized concern'
          WHERE concern_id=$1`,
        [concern.concernId]
      ),
      /immutable|cannot be modified|concern/i
    );
  } finally {
    await database.close();
  }
});

test("M1.12 concern history survives restart and monotonic rollback/reapply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-m112-migration-"));
  const databasePath = join(directory, "pglite");
  const env = environment(databasePath, "m1-12-restart");
  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  let database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const concern = await seedConcern(database, "restart");
    await assertConcern(database, concern);

    await database.close();
    database = await openScriptDatabase({ ...env, releaseSha: "m1-12-reopened" });
    await assertConcern(database, concern);

    const rolledBack = await rollbackLatestMigration(database, env);
    assert.equal(rolledBack, OWNED_MIGRATION);
    assert.deepEqual(await tableNames(database), [...OWNED_TABLES]);
    await assertConcern(database, concern);

    assert.deepEqual(
      await applyMigrationsThrough(database, "m1-12-reapply", OWNED_MIGRATION),
      [OWNED_MIGRATION]
    );
    await assertConcern(database, concern);

    const status = await migrationStatus(database);
    const owned = status.find((entry) => entry.id === OWNED_MIGRATION);
    assert.equal(owned?.applied, true);
    assert.equal(owned?.checksumMatches, true);
  } finally {
    if (database) await database.close();
    if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    await rm(directory, { recursive: true, force: true });
  }
});