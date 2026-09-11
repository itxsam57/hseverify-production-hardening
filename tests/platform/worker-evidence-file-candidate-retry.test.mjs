import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const OWNED_MIGRATION = "0030_worker_evidence_records";
const NOW = "2026-08-17T08:20:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m1-11-file-candidate-retry",
  sessionSecret: "m1-11-file-candidate-retry-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m1-11-file-candidate-retry-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function seedQualificationDraft(database) {
  await database.query(
    `INSERT INTO worker_evidence_records (
       record_id, worker_account_id, record_kind, lifecycle_status,
       current_version_id, created_at, updated_at
     ) VALUES ('evidence_record_retry','account_m111_retry','qualification','active',NULL,$1,$1)`,
    [NOW]
  );
  await database.query(
    `INSERT INTO worker_evidence_versions (
       version_id, record_id, version_number, revision, version_status,
       supersedes_version_id, created_at, updated_at, submitted_at
     ) VALUES ('evidence_version_retry','evidence_record_retry',1,1,'draft',NULL,$1,$1,NULL)`,
    [NOW]
  );
  await database.query(
    `INSERT INTO worker_qualification_versions (version_id, declaration_accepted)
     VALUES ('evidence_version_retry',false)`
  );
  await database.query(
    `UPDATE worker_evidence_records
        SET current_version_id='evidence_version_retry'
      WHERE record_id='evidence_record_retry'`
  );
}

function insertCandidate(database, candidateId, secureFileId, reservationCharacter) {
  return database.query(
    `INSERT INTO worker_evidence_file_candidates (
       candidate_id, record_id, version_id, binding_kind,
       secure_file_id, reservation_key, display_filename,
       expected_active_binding_id, candidate_status, created_at, finalized_at
     ) VALUES ($1,'evidence_record_retry','evidence_version_retry','primary_certificate',$2,$3,$4,NULL,'pending',$5,NULL)`,
    [candidateId, secureFileId, reservationCharacter.repeat(64), `${candidateId}.pdf`, NOW]
  );
}

test("M1.11 terminal or stalled scan candidates cannot lock an evidence slot against a later clean retry", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, OWNED_MIGRATION);
    await seedQualificationDraft(database);

    await insertCandidate(
      database,
      "evidence_file_candidate_failed_attempt",
      "secure_file_failed_attempt",
      "a"
    );
    await insertCandidate(
      database,
      "evidence_file_candidate_clean_retry",
      "secure_file_clean_retry",
      "b"
    );

    const candidates = await database.query(
      `SELECT candidate_id, candidate_status
         FROM worker_evidence_file_candidates
        WHERE record_id='evidence_record_retry'
          AND version_id='evidence_version_retry'
          AND binding_kind='primary_certificate'
        ORDER BY candidate_id`
    );
    assert.deepEqual(
      candidates.rows.map((row) => [row.candidate_id, row.candidate_status]),
      [
        ["evidence_file_candidate_clean_retry", "pending"],
        ["evidence_file_candidate_failed_attempt", "pending"]
      ],
      "pre-binding scan attempts may coexist; only finalization decides which clean file becomes accepted evidence"
    );
  } finally {
    await database.close();
  }
});