import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const NOW = "2026-08-18T09:45:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-05-rollback-runtime",
  sessionSecret: "m2-05-rollback-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m2-05-rollback-auth-pepper-with-more-than-thirty-two-characters",
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

async function seedImmutableExposure(db) {
  const blueprintId = oid("assessment_blueprint", "z");
  const blueprintVersionId = oid("blueprint_version", "z");
  const questionId = oid("assessment_question", "z");
  const questionVersionId = oid("question_version", "z");
  const formId = oid("assessment_form", "z");
  const workerAccountId = "worker_account_rollback_history";
  const fingerprint = "a".repeat(64);

  await db.query(
    `INSERT INTO assessment_blueprints(
       blueprint_id,blueprint_reference,blueprint_status,current_version_id,
       created_by_account_id,created_at,updated_at
     ) VALUES($1,'ROLLBACK-BP','INACTIVE',NULL,'account_rollback_seed',$2,$2)`,
    [blueprintId, NOW]
  );
  await db.query(
    `INSERT INTO assessment_blueprint_versions(
       blueprint_version_id,blueprint_id,version_no,framework_id,title,
       selectors_json,created_by_account_id,created_at
     ) VALUES($1,$2,1,$3,'Rollback Blueprint','[{"count":1}]'::jsonb,'account_rollback_seed',$4)`,
    [blueprintVersionId, blueprintId, oid("framework", "z"), NOW]
  );
  await db.query(
    `UPDATE assessment_blueprints
     SET current_version_id=$2,blueprint_status='ACTIVE',updated_at=$3
     WHERE blueprint_id=$1`,
    [blueprintId, blueprintVersionId, NOW]
  );

  await db.query(
    `INSERT INTO assessment_question_versions(
       question_version_id,question_id,version_no,question_type,prompt,options_json,
       answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,
       content_fingerprint,created_by_account_id,created_at
     ) VALUES($1,$2,1,'MULTIPLE_CHOICE',$3,'["Stop","Continue"]'::jsonb,
              '"Stop"'::jsonb,NULL,$4,'Rollback','MEDIUM','[]'::jsonb,$5,
              'account_rollback_seed',$6)`,
    [
      questionVersionId,
      questionId,
      "Which action safely stops the rollback test hazard?",
      oid("framework", "z"),
      fingerprint,
      NOW
    ]
  );
  await db.query(
    `INSERT INTO assessment_questions(
       question_id,question_reference,question_status,current_version_id,
       current_content_fingerprint,created_by_account_id,created_at,updated_at
     ) VALUES($1,'ROLLBACK-Q','ACTIVE',$2,$3,'account_rollback_seed',$4,$4)`,
    [questionId, questionVersionId, fingerprint, NOW]
  );

  await db.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO generated_assessment_forms(
         form_id,case_id,worker_account_id,blueprint_version_id,
         generation_nonce_hex,question_count,generated_at
       ) VALUES($1,$2,$3,$4,$5,1,$6)`,
      [
        formId,
        oid("assurance_case", "z"),
        workerAccountId,
        blueprintVersionId,
        "b".repeat(64),
        NOW
      ]
    );
    await transaction.query(
      `INSERT INTO generated_assessment_form_items(
         form_item_id,form_id,position,question_id,question_version_id,created_at
       ) VALUES($1,$2,1,$3,$4,$5)`,
      [oid("assessment_form_item", "z"), formId, questionId, questionVersionId, NOW]
    );
  });

  return { blueprintVersionId, questionId, questionVersionId, formId, workerAccountId };
}

test("M2.05 down/reapply retains immutable form history and Worker question exclusion", async () => {
  const db = await database();
  try {
    const seeded = await seedImmutableExposure(db);
    const down = await readFile(
      resolve("database/migrations/0039_randomized_assessment_forms.down.sql"),
      "utf8"
    );
    const up = await readFile(
      resolve("database/migrations/0039_randomized_assessment_forms.up.sql"),
      "utf8"
    );

    await db.execute(down);
    const afterDown = await db.query(
      `SELECT f.form_id,i.question_id,i.worker_account_id
       FROM generated_assessment_forms f
       JOIN generated_assessment_form_items i ON i.form_id=f.form_id
       WHERE f.form_id=$1`,
      [seeded.formId]
    );
    assert.equal(afterDown.rows.length, 1);
    assert.equal(afterDown.rows[0].question_id, seeded.questionId);
    assert.equal(afterDown.rows[0].worker_account_id, seeded.workerAccountId);

    await db.execute(up);
    const afterReapply = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM generated_assessment_form_items
       WHERE worker_account_id=$1 AND question_id=$2`,
      [seeded.workerAccountId, seeded.questionId]
    );
    assert.equal(afterReapply.rows[0].count, 1);

    await assert.rejects(
      db.transaction(async (transaction) => {
        const secondFormId = oid("assessment_form", "y");
        await transaction.query(
          `INSERT INTO generated_assessment_forms(
             form_id,case_id,worker_account_id,blueprint_version_id,
             generation_nonce_hex,question_count,generated_at
           ) VALUES($1,$2,$3,$4,$5,1,$6)`,
          [
            secondFormId,
            oid("assurance_case", "y"),
            seeded.workerAccountId,
            seeded.blueprintVersionId,
            "c".repeat(64),
            NOW
          ]
        );
        await transaction.query(
          `INSERT INTO generated_assessment_form_items(
             form_item_id,form_id,position,question_id,question_version_id,created_at
           ) VALUES($1,$2,1,$3,$4,$5)`,
          [
            oid("assessment_form_item", "y"),
            secondFormId,
            seeded.questionId,
            seeded.questionVersionId,
            NOW
          ]
        );
      }),
      /duplicate|unique|worker|question/i
    );
  } finally {
    await db.close();
  }
});
