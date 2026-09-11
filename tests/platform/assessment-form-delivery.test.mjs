import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_ASSESSMENT_FORM_DELIVERY_RUNTIME_DIST;
assert.ok(runtime, "HSE_ASSESSMENT_FORM_DELIVERY_RUNTIME_DIST is required");
const deliveryModule = await import(
  pathToFileURL(join(runtime, "assessment-generation", "assessment-form-delivery-service.js")).href
);
const { AssessmentFormDeliveryService } = deliveryModule;

const NOW = "2026-08-18T07:40:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-05-form-delivery-runtime",
  sessionSecret: "m2-05-delivery-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m2-05-delivery-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

async function db() {
  const database = await openScriptDatabase(ENV);
  await applyMigrationsThrough(database, ENV.releaseSha, "0039_randomized_assessment_forms");
  return database;
}

async function seedForm(database) {
  const frameworkId = oid("framework", "d");
  const blueprintId = oid("assessment_blueprint", "d");
  const blueprintVersionId = oid("blueprint_version", "d");
  const formId = oid("assessment_form", "d");
  const caseId = oid("assurance_case", "d");

  await database.query(
    `INSERT INTO assurance_frameworks(
       framework_id,framework_reference,title,framework_status,
       created_by_account_id,created_at,updated_at
     ) VALUES($1,'DELIVERY-FRAME','Delivery Framework','ACTIVE',$2,$3,$3)`,
    [frameworkId, "account_delivery_seed", NOW]
  );
  await database.query(
    `INSERT INTO assessment_blueprints(
       blueprint_id,blueprint_reference,blueprint_status,current_version_id,
       created_by_account_id,created_at,updated_at
     ) VALUES($1,'BP-DELIVERY','INACTIVE',NULL,$2,$3,$3)`,
    [blueprintId, "account_delivery_seed", NOW]
  );
  await database.query(
    `INSERT INTO assessment_blueprint_versions(
       blueprint_version_id,blueprint_id,version_no,framework_id,title,
       selectors_json,created_by_account_id,created_at
     ) VALUES($1,$2,1,$3,'Delivery Blueprint','[{"count":2}]'::jsonb,$4,$5)`,
    [blueprintVersionId, blueprintId, frameworkId, "account_delivery_seed", NOW]
  );
  await database.query(
    `UPDATE assessment_blueprints
     SET current_version_id=$2,blueprint_status='ACTIVE',updated_at=$3
     WHERE blueprint_id=$1`,
    [blueprintId, blueprintVersionId, NOW]
  );

  const mcqQuestionId = oid("assessment_question", "m");
  const mcqV1 = oid("question_version", "m");
  const mcqV2 = oid("question_version", "n");
  const mcqHashV1 = hash("delivery-mcq-v1");
  const mcqHashV2 = hash("delivery-mcq-v2");
  await database.query(
    `INSERT INTO assessment_questions(
       question_id,question_reference,question_status,
       created_by_account_id,created_at,updated_at
     ) VALUES($1,'DELIVERY-MCQ','INACTIVE',$2,$3,$3)`,
    [mcqQuestionId, "account_delivery_seed", NOW]
  );
  await database.query(
    `INSERT INTO assessment_question_versions(
       question_version_id,question_id,version_no,question_type,prompt,options_json,
       answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,
       content_fingerprint,created_by_account_id,created_at
     ) VALUES($1,$2,1,'MULTIPLE_CHOICE',$3,$4::jsonb,$5::jsonb,NULL,$6,
              'Hazard Control','MEDIUM',$7::jsonb,$8,$9,$10)`,
    [
      mcqV1,
      mcqQuestionId,
      "Which control should be applied first to an uncontrolled hazard?",
      JSON.stringify(["Stop work", "Ignore it", "Continue normally"]),
      JSON.stringify("Stop work"),
      frameworkId,
      JSON.stringify(["core", "hazard"]),
      mcqHashV1,
      "account_delivery_seed",
      NOW
    ]
  );

  await database.query(
    `UPDATE assessment_questions
     SET current_version_id=$2,current_content_fingerprint=$3,
         question_status='ACTIVE',updated_at=$4
     WHERE question_id=$1`,
    [mcqQuestionId, mcqV1, mcqHashV1, NOW]
  );

  const writtenQuestionId = oid("assessment_question", "w");
  const writtenV1 = oid("question_version", "w");
  const writtenHash = hash("delivery-written-v1");
  const rubric = {
    maxScore: 10,
    criteria: [
      { description: "Identifies the hazard", points: 4 },
      { description: "Explains controls", points: 6 }
    ]
  };
  await database.query(
    `INSERT INTO assessment_questions(
       question_id,question_reference,question_status,
       created_by_account_id,created_at,updated_at
     ) VALUES($1,'DELIVERY-WRITTEN','INACTIVE',$2,$3,$3)`,
    [writtenQuestionId, "account_delivery_seed", NOW]
  );
  await database.query(
    `INSERT INTO assessment_question_versions(
       question_version_id,question_id,version_no,question_type,prompt,options_json,
       answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,
       content_fingerprint,created_by_account_id,created_at
     ) VALUES($1,$2,1,'LONG_TEXT',$3,NULL,NULL,$4::jsonb,$5,
              'Risk Assessment','HARD',$6::jsonb,$7,$8,$9)`,
    [
      writtenV1,
      writtenQuestionId,
      "Explain how you would control the identified hazard before work resumes.",
      JSON.stringify(rubric),
      frameworkId,
      JSON.stringify(["written", "controls"]),
      writtenHash,
      "account_delivery_seed",
      NOW
    ]
  );

  await database.query(
    `UPDATE assessment_questions
     SET current_version_id=$2,current_content_fingerprint=$3,
         question_status='ACTIVE',updated_at=$4
     WHERE question_id=$1`,
    [writtenQuestionId, writtenV1, writtenHash, NOW]
  );

  await database.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO generated_assessment_forms(
         form_id,case_id,worker_account_id,blueprint_version_id,
         generation_nonce_hex,question_count,generated_at
       ) VALUES($1,$2,$3,$4,$5,2,$6)`,
      [formId, caseId, "worker_account_delivery_test", blueprintVersionId, "a".repeat(64), NOW]
    );
    await transaction.query(
      `INSERT INTO generated_assessment_form_items(
         form_item_id,form_id,position,question_id,question_version_id,created_at
       ) VALUES
         ($1,$2,1,$3,$4,$5),
         ($6,$2,2,$7,$8,$5)`,
      [
        oid("assessment_form_item", "m"),
        formId,
        mcqQuestionId,
        mcqV1,
        NOW,
        oid("assessment_form_item", "w"),
        writtenQuestionId,
        writtenV1
      ]
    );
  });

  await database.query(
    `INSERT INTO assessment_question_versions(
       question_version_id,question_id,version_no,question_type,prompt,options_json,
       answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,
       content_fingerprint,created_by_account_id,created_at
     ) VALUES($1,$2,2,'MULTIPLE_CHOICE',$3,$4::jsonb,$5::jsonb,NULL,$6,
              'Hazard Control','MEDIUM',$7::jsonb,$8,$9,$10)`,
    [
      mcqV2,
      mcqQuestionId,
      "Revised prompt must not replace the version already pinned into the form.",
      JSON.stringify(["Stop work", "Ignore it", "Continue normally"]),
      JSON.stringify("Stop work"),
      frameworkId,
      JSON.stringify(["core", "hazard"]),
      mcqHashV2,
      "account_delivery_seed",
      NOW
    ]
  );
  await database.query(
    `UPDATE assessment_questions
     SET current_version_id=$2,current_content_fingerprint=$3,updated_at=$4
     WHERE question_id=$1`,
    [mcqQuestionId, mcqV2, mcqHashV2, NOW]
  );

  return {
    formId,
    caseId,
    blueprintVersionId,
    mcqQuestionId,
    mcqV1,
    mcqV2,
    writtenQuestionId,
    writtenV1
  };
}

test("M2.05 form delivery returns exact pinned question versions and no hidden scoring material", async () => {
  const database = await db();
  try {
    const seeded = await seedForm(database);
    const service = new AssessmentFormDeliveryService(database);
    const form = await service.getForm(seeded.formId);
    assert.ok(form);
    assert.equal(form.formId, seeded.formId);
    assert.equal(form.caseId, seeded.caseId);
    assert.equal(form.blueprintVersionId, seeded.blueprintVersionId);
    assert.equal(form.items.length, 2);
    assert.deepEqual(form.items.map((item) => item.position), [1, 2]);

    assert.equal(form.items[0].questionId, seeded.mcqQuestionId);
    assert.equal(form.items[0].questionVersionId, seeded.mcqV1);
    assert.notEqual(form.items[0].questionVersionId, seeded.mcqV2);
    assert.equal(form.items[0].questionType, "MULTIPLE_CHOICE");
    assert.equal(form.items[0].prompt, "Which control should be applied first to an uncontrolled hazard?");
    assert.deepEqual(form.items[0].options, ["Stop work", "Ignore it", "Continue normally"]);
    assert.equal(form.items[0].domainReference, "Hazard Control");
    assert.equal(form.items[0].difficulty, "MEDIUM");
    assert.deepEqual(form.items[0].tags, ["core", "hazard"]);

    assert.equal(form.items[1].questionId, seeded.writtenQuestionId);
    assert.equal(form.items[1].questionVersionId, seeded.writtenV1);
    assert.equal(form.items[1].questionType, "LONG_TEXT");
    assert.equal(form.items[1].options, null);

    const serialized = JSON.stringify(form).toLowerCase();
    for (const forbidden of [
      "answerkey",
      "answer_key_json",
      "rubric",
      "rubric_json",
      "contentfingerprint",
      "content_fingerprint",
      "nonce",
      "createdbyaccountid",
      "created_by_account_id"
    ]) {
      assert.equal(serialized.includes(forbidden), false, `delivery leaked ${forbidden}`);
    }
  } finally {
    await database.close();
  }
});

test("M2.05 form delivery rejects malformed or unknown form ids without enumeration details", async () => {
  const database = await db();
  try {
    const service = new AssessmentFormDeliveryService(database);
    assert.equal(await service.getForm("not-a-form-id"), null);
    assert.equal(await service.getForm(oid("assessment_form", "z")), null);
  } finally {
    await database.close();
  }
});
