import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const NOW = "2026-08-18T08:20:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-05-question-current-version-integrity",
  sessionSecret: "m2-05-question-current-version-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-05-question-current-version-auth-pepper-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, "0039_randomized_assessment_forms");
  return db;
}

async function seedQuestion(db, c) {
  const questionId = oid("assessment_question", c);
  const versionId = oid("question_version", c);
  const fingerprint = "a".repeat(63) + c;
  await db.query(
    `INSERT INTO assessment_question_versions(
       question_version_id,question_id,version_no,question_type,prompt,options_json,
       answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,
       content_fingerprint,created_by_account_id,created_at
     ) VALUES($1,$2,1,'MULTIPLE_CHOICE',$3,'["Stop","Continue"]'::jsonb,
              '"Stop"'::jsonb,NULL,$4,'Integrity','MEDIUM','[]'::jsonb,$5,$6,$7)`,
    [
      versionId,
      questionId,
      `Question current-version integrity ${c}`,
      oid("framework", "q"),
      fingerprint,
      `account_question_integrity_${c}`,
      NOW
    ]
  );
  await db.query(
    `INSERT INTO assessment_questions(
       question_id,question_reference,question_status,current_version_id,
       current_content_fingerprint,created_by_account_id,created_at,updated_at
     ) VALUES($1,$2,'ACTIVE',$3,$4,$5,$6,$6)`,
    [
      questionId,
      `QUESTION-INTEGRITY-${c.toUpperCase()}`,
      versionId,
      fingerprint,
      `account_question_integrity_${c}`,
      NOW
    ]
  );
  return { questionId, versionId };
}

test("M2.05 hardening prevents a stable Question Bank record from pointing at another question's version", async () => {
  const db = await database();
  try {
    const first = await seedQuestion(db, "a");
    const second = await seedQuestion(db, "b");
    await assert.rejects(
      db.query(
        `UPDATE assessment_questions
         SET current_version_id=$2
         WHERE question_id=$1`,
        [first.questionId, second.versionId]
      ),
      /foreign key|constraint|question/i
    );
  } finally {
    await db.close();
  }
});
