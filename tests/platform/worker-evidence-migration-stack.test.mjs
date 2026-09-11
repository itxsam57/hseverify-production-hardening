import assert from "node:assert/strict";
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

const OWNED_MIGRATION = "0030_worker_evidence_records";
const OWNED_TABLES = Object.freeze([
  "worker_employment_leaving_letters",
  "worker_employment_versions",
  "worker_evidence_attachments",
  "worker_evidence_records",
  "worker_evidence_versions",
  "worker_experience_versions",
  "worker_qualification_versions",
  "worker_skill_versions"
]);
const NOW = "2026-08-17T00:30:00.000Z";

function environment(path, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: path,
    releaseSha,
    sessionSecret: "m1-11-evidence-session-secret-with-more-than-thirty-two-characters",
    authPepper: "m1-11-evidence-auth-pepper-with-more-than-thirty-two-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function ownedTables(database) {
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

async function seedHistory(database, suffix) {
  const workerAccountId = `account_m111_${suffix}`;
  const qualificationRecordId = `evidence_record_qualification_${suffix}`;
  const qualificationVersionId = `evidence_version_qualification_${suffix}`;
  const employmentRecordId = `evidence_record_employment_${suffix}`;
  const employmentVersionId = `evidence_version_employment_${suffix}`;
  const qualificationFileId = `secure_file_qualification_${suffix}`;
  const leavingFileId = `secure_file_leaving_${suffix}`;

  await database.query(
    `INSERT INTO worker_evidence_records (
       record_id, worker_account_id, record_kind, lifecycle_status,
       current_version_id, created_at, updated_at
     ) VALUES ($1,$2,'qualification','active',NULL,$3,$3)`,
    [qualificationRecordId, workerAccountId, NOW]
  );
  await database.query(
    `INSERT INTO worker_evidence_versions (
       version_id, record_id, version_number, version_status,
       supersedes_version_id, created_at, updated_at, submitted_at
     ) VALUES ($1,$2,1,'submitted',NULL,$3,$3,$3)`,
    [qualificationVersionId, qualificationRecordId, NOW]
  );
  await database.query(
    `INSERT INTO worker_qualification_versions (
       version_id, qualification_title, category, issuing_organization,
       learning_provider, certificate_number, issue_date, expiry_date,
       qualification_level, country, verification_url, declaration_accepted
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`,
    [
      qualificationVersionId,
      "NEBOSH International General Certificate",
      "Occupational Health and Safety",
      "NEBOSH",
      "Approved Learning Partner",
      `CERT-${suffix}`,
      "2024-01-10",
      "2029-01-10",
      "Level 3",
      "United Kingdom",
      "https://example.test/verify"
    ]
  );
  await database.query(
    `INSERT INTO worker_evidence_attachments (
       attachment_id, record_id, version_id, attachment_kind,
       secure_file_id, display_filename, created_at, superseded_at
     ) VALUES ($1,$2,$3,'primary_certificate',$4,'certificate.pdf',$5,NULL)`,
    [
      `evidence_attachment_qualification_${suffix}`,
      qualificationRecordId,
      qualificationVersionId,
      qualificationFileId,
      NOW
    ]
  );
  await database.query(
    `UPDATE worker_evidence_records
        SET current_version_id=$2, updated_at=$3
      WHERE record_id=$1`,
    [qualificationRecordId, qualificationVersionId, NOW]
  );

  await database.query(
    `INSERT INTO worker_evidence_records (
       record_id, worker_account_id, record_kind, lifecycle_status,
       current_version_id, created_at, updated_at
     ) VALUES ($1,$2,'employment','ended',NULL,$3,$3)`,
    [employmentRecordId, workerAccountId, NOW]
  );
  await database.query(
    `INSERT INTO worker_evidence_versions (
       version_id, record_id, version_number, version_status,
       supersedes_version_id, created_at, updated_at, submitted_at
     ) VALUES ($1,$2,1,'submitted',NULL,$3,$3,$3)`,
    [employmentVersionId, employmentRecordId, NOW]
  );
  await database.query(
    `INSERT INTO worker_employment_versions (
       version_id, company_name, role_title, duties, country,
       start_date, end_date, employment_status, end_reason
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ended',$8)`,
    [
      employmentVersionId,
      "Migration Safety Company",
      "Safety Officer",
      "Site inspections and permit control",
      "Saudi Arabia",
      "2022-01-01",
      "2024-12-31",
      "Contract completed"
    ]
  );
  await database.query(
    `UPDATE worker_evidence_records
        SET current_version_id=$2, updated_at=$3
      WHERE record_id=$1`,
    [employmentRecordId, employmentVersionId, NOW]
  );
  await database.query(
    `INSERT INTO worker_employment_leaving_letters (
       leaving_letter_id, employment_record_id, employment_version_id,
       secure_file_id, display_filename, status,
       supersedes_leaving_letter_id, created_at, superseded_at
     ) VALUES ($1,$2,$3,$4,'leaving-letter.pdf','active',NULL,$5,NULL)`,
    [
      `leaving_letter_${suffix}`,
      employmentRecordId,
      employmentVersionId,
      leavingFileId,
      NOW
    ]
  );

  return {
    workerAccountId,
    qualificationRecordId,
    qualificationVersionId,
    employmentRecordId,
    employmentVersionId
  };
}

async function assertSeedHistory(database, history) {
  const qualification = await database.query(
    `SELECT records.worker_account_id, records.record_kind,
            versions.version_status, details.qualification_title,
            attachments.attachment_kind, attachments.display_filename
       FROM worker_evidence_records AS records
       JOIN worker_evidence_versions AS versions
         ON versions.version_id=records.current_version_id
       JOIN worker_qualification_versions AS details
         ON details.version_id=versions.version_id
       JOIN worker_evidence_attachments AS attachments
         ON attachments.version_id=versions.version_id
      WHERE records.record_id=$1`,
    [history.qualificationRecordId]
  );
  assert.equal(qualification.rows.length, 1);
  assert.equal(qualification.rows[0].worker_account_id, history.workerAccountId);
  assert.equal(qualification.rows[0].record_kind, "qualification");
  assert.equal(qualification.rows[0].version_status, "submitted");
  assert.equal(qualification.rows[0].attachment_kind, "primary_certificate");
  assert.equal(qualification.rows[0].display_filename, "certificate.pdf");

  const employment = await database.query(
    `SELECT records.lifecycle_status, details.employment_status,
            details.end_date, letters.status, letters.display_filename
       FROM worker_evidence_records AS records
       JOIN worker_evidence_versions AS versions
         ON versions.version_id=records.current_version_id
       JOIN worker_employment_versions AS details
         ON details.version_id=versions.version_id
       JOIN worker_employment_leaving_letters AS letters
         ON letters.employment_record_id=records.record_id
      WHERE records.record_id=$1`,
    [history.employmentRecordId]
  );
  assert.equal(employment.rows.length, 1);
  assert.equal(employment.rows[0].lifecycle_status, "ended");
  assert.equal(employment.rows[0].employment_status, "ended");
  assert.equal(employment.rows[0].status, "active");
  assert.equal(employment.rows[0].display_filename, "leaving-letter.pdf");
}

async function assertNoLowerBrickForeignKeys(database) {
  const result = await database.query(
    `SELECT tc.table_name, ccu.table_name AS foreign_table_name
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_name=tc.constraint_name
        AND ccu.constraint_schema=tc.constraint_schema
      WHERE tc.constraint_schema='public'
        AND tc.constraint_type='FOREIGN KEY'
        AND tc.table_name = ANY($1::text[])
      ORDER BY tc.table_name, ccu.table_name`,
    [[...OWNED_TABLES]]
  );
  for (const row of result.rows) {
    assert.ok(
      OWNED_TABLES.includes(row.foreign_table_name),
      `M1.11 retained table ${row.table_name} must not hard-reference lower brick ${row.foreign_table_name}`
    );
  }
}

async function proveLowerBrickRollback(dataDirectory, releaseSha) {
  const env = environment(dataDirectory, releaseSha);
  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const history = await seedHistory(database, releaseSha.replaceAll(/[^a-z0-9]/gi, "").slice(-12));
    await assertNoLowerBrickForeignKeys(database);

    const migrations = await listMigrations();
    const ownedIndex = migrations.findIndex((migration) => migration.id === OWNED_MIGRATION);
    const authIndex = migrations.findIndex((migration) => migration.id === "0002_authentication_foundation");
    assert.ok(ownedIndex > authIndex && authIndex >= 0);
    const ownedAndLower = migrations.slice(authIndex, ownedIndex + 1).map((migration) => migration.id);

    for (const migrationId of [...ownedAndLower].reverse()) {
      const rolledBack = await rollbackLatestMigration(database, env);
      assert.equal(rolledBack, migrationId);
    }

    assert.deepEqual(await ownedTables(database), [...OWNED_TABLES]);
    const authTable = await database.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema='public' AND table_name='auth_accounts'`
    );
    assert.equal(authTable.rows.length, 0);
    await assertSeedHistory(database, history);

    assert.deepEqual(
      await applyMigrationsThrough(database, `${releaseSha}-reapply`, OWNED_MIGRATION),
      ownedAndLower
    );
    await assertNoLowerBrickForeignKeys(database);
    await assertSeedHistory(database, history);
    const status = await migrationStatus(database);
    const relevant = status.filter((entry) => ownedAndLower.includes(entry.id));
    assert.equal(relevant.every((entry) => entry.applied && entry.checksumMatches), true);
  } finally {
    if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    await database.close();
  }
}

test("M1.11 migration preserves Worker evidence history across restart and monotonic rollback/reapply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-m111-migration-"));
  const databasePath = join(directory, "pglite");
  const env = environment(databasePath, "m1-11-migration-stack");
  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  let database = await openScriptDatabase(env);
  try {
    const applied = await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    assert.equal(applied.at(-1), OWNED_MIGRATION);
    assert.deepEqual(await ownedTables(database), [...OWNED_TABLES]);
    await assertNoLowerBrickForeignKeys(database);
    const history = await seedHistory(database, "restart");
    await assertSeedHistory(database, history);

    await database.close();
    database = await openScriptDatabase({ ...env, releaseSha: "m1-11-restart" });
    await assertSeedHistory(database, history);
    const restartStatus = await migrationStatus(database);
    assert.equal(
      restartStatus.find((entry) => entry.id === OWNED_MIGRATION)?.applied,
      true
    );

    const rolledBack = await rollbackLatestMigration(database, env);
    assert.equal(rolledBack, OWNED_MIGRATION);
    assert.deepEqual(await ownedTables(database), [...OWNED_TABLES]);
    await assertSeedHistory(database, history);

    assert.deepEqual(
      await applyMigrationsThrough(database, "m1-11-reapply", OWNED_MIGRATION),
      [OWNED_MIGRATION]
    );
    await assertNoLowerBrickForeignKeys(database);
    await assertSeedHistory(database, history);
  } finally {
    if (database) await database.close();
    if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("M1.11 filesystem PGlite history never blocks lower-brick rollback and reapply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-m111-lower-rollback-"));
  try {
    await proveLowerBrickRollback(
      join(directory, "pglite"),
      "m1-11-lower-rollback-filesystem"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("M1.11 memory PGlite history never blocks lower-brick rollback and reapply", async () => {
  await proveLowerBrickRollback("memory://", "m1-11-lower-rollback-memory");
});
