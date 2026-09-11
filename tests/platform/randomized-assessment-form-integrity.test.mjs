import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const NOW = "2026-08-18T08:10:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-05-integrity-runtime",
  sessionSecret: "m2-05-integrity-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m2-05-integrity-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;

async function db() {
  const database = await openScriptDatabase(ENV);
  await applyMigrationsThrough(database, ENV.releaseSha, "0039_randomized_assessment_forms");
  return database;
}

async function seedBlueprint(database, c) {
  const blueprintId = oid("assessment_blueprint", c);
  const versionId = oid("blueprint_version", c);
  await database.query(
    `INSERT INTO assessment_blueprints(
       blueprint_id,blueprint_reference,blueprint_status,current_version_id,
       created_by_account_id,created_at,updated_at
     ) VALUES($1,$2,'INACTIVE',NULL,$3,$4,$4)`,
    [blueprintId, `INTEGRITY-BP-${c.toUpperCase()}`, `account_integrity_${c}`, NOW]
  );
  await database.query(
    `INSERT INTO assessment_blueprint_versions(
       blueprint_version_id,blueprint_id,version_no,framework_id,title,
       selectors_json,created_by_account_id,created_at
     ) VALUES($1,$2,1,$3,$4,'[{"count":1}]'::jsonb,$5,$6)`,
    [
      versionId,
      blueprintId,
      oid("framework", c),
      `Integrity Blueprint ${c}`,
      `account_integrity_${c}`,
      NOW
    ]
  );
  await database.query(
    `UPDATE assessment_blueprints
     SET current_version_id=$2,blueprint_status='ACTIVE',updated_at=$3
     WHERE blueprint_id=$1`,
    [blueprintId, versionId, NOW]
  );
  return { blueprintId, versionId };
}

async function seedQuestion(database, c) {
  const questionId = oid("assessment_question", c);
  const versionId = oid("question_version", c);
  const fingerprint = c.repeat(64).slice(0, 64).replace(/[^a-f0-9]/g, "a");
  await database.query(
    `INSERT INTO assessment_question_versions(
       question_version_id,question_id,version_no,question_type,prompt,options_json,
       answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,
       content_fingerprint,created_by_account_id,created_at
     ) VALUES($1,$2,1,'MULTIPLE_CHOICE',$3,'["Stop","Continue"]'::jsonb,
              '"Stop"'::jsonb,NULL,$4,'Integrity','MEDIUM','[]'::jsonb,$5,$6,$7)`,
    [
      versionId,
      questionId,
      `Integrity question ${c} requires a safe answer.`,
      oid("framework", "i"),
      fingerprint,
      `account_integrity_${c}`,
      NOW
    ]
  );
  await database.query(
    `INSERT INTO assessment_questions(
       question_id,question_reference,question_status,current_version_id,
       current_content_fingerprint,created_by_account_id,created_at,updated_at
     ) VALUES($1,$2,'ACTIVE',$3,$4,$5,$6,$6)`,
    [questionId, `INTEGRITY-Q-${c.toUpperCase()}`, versionId, fingerprint, `account_integrity_${c}`, NOW]
  );
  return { questionId, versionId };
}

async function insertCompleteOneItemForm(database, blueprintVersionId, question, c) {
  const formId = oid("assessment_form", c);
  await database.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO generated_assessment_forms(
         form_id,case_id,worker_account_id,blueprint_version_id,
         generation_nonce_hex,question_count,generated_at
       ) VALUES($1,$2,$3,$4,$5,1,$6)`,
      [
        formId,
        oid("assurance_case", c),
        `worker_account_integrity_${c}`,
        blueprintVersionId,
        "a".repeat(64),
        NOW
      ]
    );
    await transaction.query(
      `INSERT INTO generated_assessment_form_items(
         form_item_id,form_id,position,question_id,question_version_id,created_at
       ) VALUES($1,$2,1,$3,$4,$5)`,
      [oid("assessment_form_item", c), formId, question.questionId, question.versionId, NOW]
    );
  });
  return formId;
}

test("M2.05 database prevents a blueprint from pointing at another blueprint's version", async () => {
  const database = await db();
  try {
    const first = await seedBlueprint(database, "a");
    const second = await seedBlueprint(database, "b");
    await assert.rejects(
      database.query(
        `UPDATE assessment_blueprints SET current_version_id=$2 WHERE blueprint_id=$1`,
        [first.blueprintId, second.versionId]
      ),
      /foreign key|constraint|blueprint/i
    );
  } finally {
    await database.close();
  }
});

test("M2.05 database rejects a form item whose exact version belongs to another stable question", async () => {
  const database = await db();
  try {
    const blueprint = await seedBlueprint(database, "c");
    const first = await seedQuestion(database, "a");
    const second = await seedQuestion(database, "b");
    await assert.rejects(
      database.transaction(async (transaction) => {
        const formId = oid("assessment_form", "c");
        await transaction.query(
          `INSERT INTO generated_assessment_forms(
             form_id,case_id,worker_account_id,blueprint_version_id,
             generation_nonce_hex,question_count,generated_at
           ) VALUES($1,$2,$3,$4,$5,1,$6)`,
          [formId, oid("assurance_case", "c"), "worker_account_integrity_pair", blueprint.versionId, "b".repeat(64), NOW]
        );
        await transaction.query(
          `INSERT INTO generated_assessment_form_items(
             form_item_id,form_id,position,question_id,question_version_id,created_at
           ) VALUES($1,$2,1,$3,$4,$5)`,
          [oid("assessment_form_item", "d"), formId, first.questionId, second.versionId, NOW]
        );
      }),
      /foreign key|constraint|question/i
    );
  } finally {
    await database.close();
  }
});

test("M2.05 database prevents appending an item after an immutable form reaches question_count", async () => {
  const database = await db();
  try {
    const blueprint = await seedBlueprint(database, "d");
    const first = await seedQuestion(database, "c");
    const second = await seedQuestion(database, "d");
    const formId = await insertCompleteOneItemForm(database, blueprint.versionId, first, "e");
    await assert.rejects(
      database.query(
        `INSERT INTO generated_assessment_form_items(
           form_item_id,form_id,position,question_id,question_version_id,created_at
         ) VALUES($1,$2,2,$3,$4,$5)`,
        [oid("assessment_form_item", "f"), formId, second.questionId, second.versionId, NOW]
      ),
      /question count|immutable|position|generated assessment form/i
    );
  } finally {
    await database.close();
  }
});

test("M2.05 database rejects noncontiguous item positions and partial forms at transaction commit", async () => {
  const database = await db();
  try {
    const blueprint = await seedBlueprint(database, "e");
    const first = await seedQuestion(database, "e");
    const second = await seedQuestion(database, "f");

    await assert.rejects(
      database.transaction(async (transaction) => {
        const formId = oid("assessment_form", "g");
        await transaction.query(
          `INSERT INTO generated_assessment_forms(
             form_id,case_id,worker_account_id,blueprint_version_id,
             generation_nonce_hex,question_count,generated_at
           ) VALUES($1,$2,$3,$4,$5,2,$6)`,
          [formId, oid("assurance_case", "g"), "worker_account_integrity_gap", blueprint.versionId, "c".repeat(64), NOW]
        );
        await transaction.query(
          `INSERT INTO generated_assessment_form_items(
             form_item_id,form_id,position,question_id,question_version_id,created_at
           ) VALUES($1,$2,2,$3,$4,$5)`,
          [oid("assessment_form_item", "g"), formId, first.questionId, first.versionId, NOW]
        );
        await transaction.query(
          `INSERT INTO generated_assessment_form_items(
             form_item_id,form_id,position,question_id,question_version_id,created_at
           ) VALUES($1,$2,1,$3,$4,$5)`,
          [oid("assessment_form_item", "h"), formId, second.questionId, second.versionId, NOW]
        );
      }),
      /position|order|generated assessment form/i
    );

    await assert.rejects(
      database.transaction(async (transaction) => {
        const formId = oid("assessment_form", "h");
        await transaction.query(
          `INSERT INTO generated_assessment_forms(
             form_id,case_id,worker_account_id,blueprint_version_id,
             generation_nonce_hex,question_count,generated_at
           ) VALUES($1,$2,$3,$4,$5,2,$6)`,
          [formId, oid("assurance_case", "h"), "worker_account_integrity_partial", blueprint.versionId, "d".repeat(64), NOW]
        );
        await transaction.query(
          `INSERT INTO generated_assessment_form_items(
             form_item_id,form_id,position,question_id,question_version_id,created_at
           ) VALUES($1,$2,1,$3,$4,$5)`,
          [oid("assessment_form_item", "i"), formId, first.questionId, first.versionId, NOW]
        );
      }),
      /question count|incomplete|generated assessment form/i
    );
  } finally {
    await database.close();
  }
});

test("M2.05 database forbids repeating a stable question for the same Worker across different forms", async () => {
  const database = await db();
  try {
    const blueprint = await seedBlueprint(database, "i");
    const question = await seedQuestion(database, "i");
    const workerAccountId = "worker_account_integrity_nonrepeat";

    await database.transaction(async (transaction) => {
      const formId = oid("assessment_form", "j");
      await transaction.query(
        `INSERT INTO generated_assessment_forms(
           form_id,case_id,worker_account_id,blueprint_version_id,
           generation_nonce_hex,question_count,generated_at
         ) VALUES($1,$2,$3,$4,$5,1,$6)`,
        [formId, oid("assurance_case", "j"), workerAccountId, blueprint.versionId, "e".repeat(64), NOW]
      );
      await transaction.query(
        `INSERT INTO generated_assessment_form_items(
           form_item_id,form_id,position,question_id,question_version_id,created_at
         ) VALUES($1,$2,1,$3,$4,$5)`,
        [oid("assessment_form_item", "j"), formId, question.questionId, question.versionId, NOW]
      );
    });

    await assert.rejects(
      database.transaction(async (transaction) => {
        const formId = oid("assessment_form", "k");
        await transaction.query(
          `INSERT INTO generated_assessment_forms(
             form_id,case_id,worker_account_id,blueprint_version_id,
             generation_nonce_hex,question_count,generated_at
           ) VALUES($1,$2,$3,$4,$5,1,$6)`,
          [formId, oid("assurance_case", "k"), workerAccountId, blueprint.versionId, "f".repeat(64), NOW]
        );
        await transaction.query(
          `INSERT INTO generated_assessment_form_items(
             form_item_id,form_id,position,question_id,question_version_id,created_at
           ) VALUES($1,$2,1,$3,$4,$5)`,
          [oid("assessment_form_item", "k"), formId, question.questionId, question.versionId, NOW]
        );
      }),
      /duplicate|unique|worker|question/i
    );
  } finally {
    await database.close();
  }
});
