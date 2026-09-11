import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const OWNED_MIGRATION = "0030_worker_evidence_records";
const NOW = "2026-08-17T06:55:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m1-11-file-candidate-guards",
  sessionSecret: "m1-11-file-candidate-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m1-11-file-candidate-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function record(database, recordId, kind, versionId) {
  await database.query(
    `INSERT INTO worker_evidence_records (
       record_id, worker_account_id, record_kind, lifecycle_status,
       current_version_id, created_at, updated_at
     ) VALUES ($1,'account_m111_candidate_guard',$2,'active',NULL,$3,$3)`,
    [recordId, kind, NOW]
  );
  await database.query(
    `INSERT INTO worker_evidence_versions (
       version_id, record_id, version_number, revision, version_status,
       supersedes_version_id, created_at, updated_at, submitted_at
     ) VALUES ($1,$2,1,1,'draft',NULL,$3,$3,NULL)`,
    [versionId, recordId, NOW]
  );
  await database.query(
    `UPDATE worker_evidence_records
        SET current_version_id=$2
      WHERE record_id=$1`,
    [recordId, versionId]
  );
}

function insertCandidate(database, input) {
  return database.query(
    `INSERT INTO worker_evidence_file_candidates (
       candidate_id, record_id, version_id, binding_kind,
       secure_file_id, reservation_key, display_filename,
       expected_active_binding_id, candidate_status, created_at, finalized_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,'pending',$8,NULL)`,
    [
      input.candidateId,
      input.recordId,
      input.versionId,
      input.bindingKind,
      input.secureFileId,
      "a".repeat(64),
      input.filename,
      NOW
    ]
  );
}

test("M1.11 pending file candidates stay on the exact record/version and matching evidence kind", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, OWNED_MIGRATION);
    await record(
      database,
      "evidence_record_candidate_qualification",
      "qualification",
      "evidence_version_candidate_qualification"
    );
    await record(
      database,
      "evidence_record_candidate_skill",
      "skill",
      "evidence_version_candidate_skill"
    );

    await assert.rejects(
      insertCandidate(database, {
        candidateId: "evidence_file_candidate_cross_record",
        recordId: "evidence_record_candidate_qualification",
        versionId: "evidence_version_candidate_skill",
        bindingKind: "primary_certificate",
        secureFileId: "secure_file_candidate_cross_record",
        filename: "cross-record.pdf"
      }),
      /candidate record and version must match/i
    );

    await assert.rejects(
      insertCandidate(database, {
        candidateId: "evidence_file_candidate_wrong_kind",
        recordId: "evidence_record_candidate_qualification",
        versionId: "evidence_version_candidate_qualification",
        bindingKind: "skill_evidence",
        secureFileId: "secure_file_candidate_wrong_kind",
        filename: "wrong-kind.pdf"
      }),
      /candidate file type does not belong to this record/i
    );
  } finally {
    await database.close();
  }
});

test("M1.11 file-candidate identity is immutable and only pending to finalized is allowed", async () => {
  const database = await openScriptDatabase({ ...ENV, releaseSha: "m1-11-file-candidate-history" });
  try {
    await applyMigrationsThrough(database, "m1-11-file-candidate-history", OWNED_MIGRATION);
    await record(
      database,
      "evidence_record_candidate_history",
      "qualification",
      "evidence_version_candidate_history"
    );
    await insertCandidate(database, {
      candidateId: "evidence_file_candidate_history",
      recordId: "evidence_record_candidate_history",
      versionId: "evidence_version_candidate_history",
      bindingKind: "primary_certificate",
      secureFileId: "secure_file_candidate_history",
      filename: "history.pdf"
    });

    await assert.rejects(
      database.query(
        `UPDATE worker_evidence_file_candidates
            SET secure_file_id='secure_file_candidate_tampered'
          WHERE candidate_id='evidence_file_candidate_history'`
      ),
      /candidate identity is immutable/i
    );

    await database.query(
      `UPDATE worker_evidence_file_candidates
          SET candidate_status='finalized', finalized_at=$2
        WHERE candidate_id=$1`,
      ["evidence_file_candidate_history", NOW]
    );

    await assert.rejects(
      database.query(
        `UPDATE worker_evidence_file_candidates
            SET candidate_status='pending', finalized_at=NULL
          WHERE candidate_id='evidence_file_candidate_history'`
      ),
      /finalized file candidate is immutable/i
    );

    await assert.rejects(
      database.query(
        `DELETE FROM worker_evidence_file_candidates
          WHERE candidate_id='evidence_file_candidate_history'`
      ),
      /file candidate history is immutable/i
    );
  } finally {
    await database.close();
  }
});
