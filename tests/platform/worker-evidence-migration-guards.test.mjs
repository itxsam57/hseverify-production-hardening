import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const OWNED_MIGRATION = "0030_worker_evidence_records";
const NOW = "2026-08-17T00:45:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m1-11-integrity-guards",
  sessionSecret: "m1-11-integrity-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m1-11-integrity-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function insertRecord(database, recordId, kind) {
  await database.query(
    `INSERT INTO worker_evidence_records (
       record_id, worker_account_id, record_kind, lifecycle_status,
       current_version_id, created_at, updated_at
     ) VALUES ($1,$2,$3,'active',NULL,$4,$4)`,
    [recordId, "account_m111_integrity", kind, NOW]
  );
}

async function insertVersion(database, versionId, recordId) {
  await database.query(
    `INSERT INTO worker_evidence_versions (
       version_id, record_id, version_number, version_status,
       supersedes_version_id, created_at, updated_at, submitted_at
     ) VALUES ($1,$2,1,'draft',NULL,$3,$3,NULL)`,
    [versionId, recordId, NOW]
  );
}

test("M1.11 SQL guards keep typed details, current pointers and attachments on the exact record/version", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, OWNED_MIGRATION);

    await insertRecord(database, "evidence_record_skill_guard", "skill");
    await insertVersion(database, "evidence_version_skill_guard", "evidence_record_skill_guard");
    await assert.rejects(
      database.query(
        `INSERT INTO worker_qualification_versions (
           version_id, qualification_title, category, issuing_organization,
           learning_provider, certificate_number, issue_date, expiry_date,
           qualification_level, country, verification_url, declaration_accepted
         ) VALUES ($1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,false)`,
        ["evidence_version_skill_guard"]
      ),
      /qualification detail requires a qualification record/i
    );

    await insertRecord(database, "evidence_record_qualification_guard", "qualification");
    await insertVersion(
      database,
      "evidence_version_qualification_guard",
      "evidence_record_qualification_guard"
    );
    await assert.rejects(
      database.query(
        `UPDATE worker_evidence_records
            SET current_version_id=$2, updated_at=$3
          WHERE record_id=$1`,
        [
          "evidence_record_qualification_guard",
          "evidence_version_skill_guard",
          NOW
        ]
      ),
      /current evidence version must belong to the same record/i
    );

    await assert.rejects(
      database.query(
        `INSERT INTO worker_evidence_attachments (
           attachment_id, record_id, version_id, attachment_kind,
           secure_file_id, display_filename, created_at, superseded_at
         ) VALUES ($1,$2,$3,'skill_evidence',$4,'skill.pdf',$5,NULL)`,
        [
          "evidence_attachment_cross_record_guard",
          "evidence_record_qualification_guard",
          "evidence_version_skill_guard",
          "secure_file_cross_record_guard",
          NOW
        ]
      ),
      /evidence attachment record and version must match/i
    );
  } finally {
    await database.close();
  }
});

test("M1.11 SQL guards bind leaving letters only to the same exact employment record/version", async () => {
  const database = await openScriptDatabase({ ...ENV, releaseSha: "m1-11-leaving-letter-guard" });
  try {
    await applyMigrationsThrough(database, "m1-11-leaving-letter-guard", OWNED_MIGRATION);

    await insertRecord(database, "evidence_record_employment_guard_a", "employment");
    await insertVersion(
      database,
      "evidence_version_employment_guard_a",
      "evidence_record_employment_guard_a"
    );
    await insertRecord(database, "evidence_record_employment_guard_b", "employment");
    await insertVersion(
      database,
      "evidence_version_employment_guard_b",
      "evidence_record_employment_guard_b"
    );
    await insertRecord(database, "evidence_record_experience_guard", "experience");
    await insertVersion(
      database,
      "evidence_version_experience_guard",
      "evidence_record_experience_guard"
    );

    await assert.rejects(
      database.query(
        `INSERT INTO worker_employment_leaving_letters (
           leaving_letter_id, employment_record_id, employment_version_id,
           secure_file_id, display_filename, status,
           supersedes_leaving_letter_id, created_at, superseded_at
         ) VALUES ($1,$2,$3,$4,'wrong-record.pdf','active',NULL,$5,NULL)`,
        [
          "leaving_letter_cross_employment_guard",
          "evidence_record_employment_guard_a",
          "evidence_version_employment_guard_b",
          "secure_file_leaving_cross_guard",
          NOW
        ]
      ),
      /leaving letter record and version must match the same employment/i
    );

    await assert.rejects(
      database.query(
        `INSERT INTO worker_employment_leaving_letters (
           leaving_letter_id, employment_record_id, employment_version_id,
           secure_file_id, display_filename, status,
           supersedes_leaving_letter_id, created_at, superseded_at
         ) VALUES ($1,$2,$3,$4,'experience.pdf','active',NULL,$5,NULL)`,
        [
          "leaving_letter_non_employment_guard",
          "evidence_record_experience_guard",
          "evidence_version_experience_guard",
          "secure_file_leaving_experience_guard",
          NOW
        ]
      ),
      /leaving letter requires an employment record/i
    );
  } finally {
    await database.close();
  }
});
