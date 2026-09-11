import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import {
  listMigrations,
  migrationStatus,
  rollbackLatestMigration
} from "../../scripts/lib/migrations.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const OWNED_MIGRATION = "0032_public_verification_concern_evidence";
const SECURE_FILE_FOUNDATION = "0011_secure_file_foundation";
const SYSTEM_ACCOUNT_ID = "account_public_concern_intake_system";

function sha(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function environment(path, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: path,
    releaseSha,
    sessionSecret: "m1-12-concern-evidence-rollback-secret-with-more-than-thirty-two-characters",
    authPepper: "m1-12-concern-evidence-rollback-pepper-with-more-than-thirty-two-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function seedHistory(database) {
  const concernId = `public_concern_${"R".repeat(24)}`;
  const fileId = `secure_file_${"R".repeat(24)}`;
  const candidateId = `public_concern_evidence_${"R".repeat(24)}`;
  await database.query(
    `INSERT INTO public_verification_concerns (
       concern_id, subject_reference_hash, category, description,
       contact_email, idempotency_key, created_at, updated_at
     ) VALUES ($1,$2,'document_concern',$3,$4,$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [
      concernId,
      sha("rollback-subject"),
      "The public credential evidence requires a retained rollback history fixture.",
      "rollback-evidence@example.com",
      sha("rollback-idempotency")
    ]
  );
  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key, owner_account_id, owner_role,
       storage_adapter_key, object_key, display_filename, lifecycle_status
     ) VALUES ($1,1,$2,$3,'root','local_test',$4,'rollback-evidence.pdf','reserved')`,
    [
      fileId,
      sha("rollback-reservation"),
      SYSTEM_ACCOUNT_ID,
      `secure-files/${sha("rollback-object")}`
    ]
  );
  await database.query(
    `INSERT INTO public_verification_concern_evidence_candidates (
       candidate_id, concern_id, secure_file_id, candidate_status
     ) VALUES ($1,$2,$3,'pending')`,
    [candidateId, concernId, fileId]
  );
  return { concernId, fileId, candidateId };
}

async function assertHistory(database, fixture) {
  const candidate = await database.query(
    `SELECT concern_id, secure_file_id, candidate_status
       FROM public_verification_concern_evidence_candidates
      WHERE candidate_id=$1`,
    [fixture.candidateId]
  );
  assert.equal(candidate.rows.length, 1);
  assert.equal(candidate.rows[0].concern_id, fixture.concernId);
  assert.equal(candidate.rows[0].secure_file_id, fixture.fileId);
  assert.equal(candidate.rows[0].candidate_status, "pending");

  const owner = await database.query(
    `SELECT account_status, password_hash
       FROM auth_accounts
      WHERE account_id=$1`,
    [SYSTEM_ACCOUNT_ID]
  );
  assert.equal(owner.rows[0]?.account_status, "disabled");
  assert.equal(owner.rows[0]?.password_hash, null);
}

test("M1.12 concern evidence history survives restart and monotonic rollback/reapply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-m112-evidence-rollback-"));
  const databasePath = join(directory, "pglite");
  const env = environment(databasePath, "m1-12-evidence-restart");
  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  let database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const fixture = await seedHistory(database);
    await assertHistory(database, fixture);

    await database.close();
    database = await openScriptDatabase({
      ...env,
      releaseSha: "m1-12-evidence-reopened"
    });
    await assertHistory(database, fixture);

    const rolledBack = await rollbackLatestMigration(database, env);
    assert.equal(rolledBack, OWNED_MIGRATION);
    await assertHistory(database, fixture);

    assert.deepEqual(
      await applyMigrationsThrough(database, "m1-12-evidence-reapply", OWNED_MIGRATION),
      [OWNED_MIGRATION]
    );
    await assertHistory(database, fixture);

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

test("M1.12 retained concern evidence cannot block independent M1.06 rollback and reapply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-m112-lower-brick-"));
  const databasePath = join(directory, "pglite");
  const env = environment(databasePath, "m1-12-lower-brick-rollback");
  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  let database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const fixture = await seedHistory(database);
    const migrationIds = (await listMigrations()).map((migration) => migration.id);
    const secureFileIndex = migrationIds.indexOf(SECURE_FILE_FOUNDATION);
    const ownedMigrationIndex = migrationIds.indexOf(OWNED_MIGRATION);
    assert.ok(secureFileIndex >= 0, "M1.06 secure-file foundation migration must exist");
    assert.ok(
      ownedMigrationIndex > secureFileIndex,
      "M1.12 owned migration must remain above the M1.06 secure-file foundation"
    );

    // This is an M1.12 historical test. It intentionally rolls back only the
    // migrations that were applied through the M1.12 ceiling, even when newer
    // repository migrations exist. Binding the loop to repository tip would
    // make an accepted historical test fail every time a later brick is added.
    for (
      const migrationId of migrationIds
        .slice(secureFileIndex + 1, ownedMigrationIndex + 1)
        .reverse()
    ) {
      const rolledBack = await rollbackLatestMigration(database, env);
      assert.equal(rolledBack, migrationId);
    }

    const secureRollback = await rollbackLatestMigration(database, env);
    assert.equal(secureRollback, SECURE_FILE_FOUNDATION);

    const secureTable = await database.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema='public' AND table_name='platform_secure_files'`
    );
    assert.equal(secureTable.rows.length, 0);

    const retainedCandidate = await database.query(
      `SELECT concern_id, secure_file_id, candidate_status
         FROM public_verification_concern_evidence_candidates
        WHERE candidate_id=$1`,
      [fixture.candidateId]
    );
    assert.equal(retainedCandidate.rows.length, 1);
    assert.equal(retainedCandidate.rows[0].concern_id, fixture.concernId);
    assert.equal(retainedCandidate.rows[0].secure_file_id, fixture.fileId);
    assert.equal(retainedCandidate.rows[0].candidate_status, "pending");

    const reapplied = await applyMigrationsThrough(
      database,
      "m1-12-lower-brick-reapply",
      OWNED_MIGRATION
    );
    assert.equal(reapplied.at(-1), OWNED_MIGRATION);
    await assertHistory(database, fixture);
  } finally {
    if (database) await database.close();
    if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
