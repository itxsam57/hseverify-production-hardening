import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_ASSESSMENT_GENERATION_RUNTIME_DIST;
assert.ok(runtime, "HSE_ASSESSMENT_GENERATION_RUNTIME_DIST is required");
const blueprintModule = await import(
  pathToFileURL(join(runtime, "assessment-generation", "assessment-blueprint-service.js")).href
);
const generationModule = await import(
  pathToFileURL(join(runtime, "assessment-generation", "assessment-form-generation-service.js")).href
);
const { AssessmentBlueprintService } = blueprintModule;
const { AssessmentFormGenerationService, AssessmentFormGenerationError } = generationModule;

const NOW_DATE = new Date("2026-08-18T07:30:00.000Z");
const NOW = NOW_DATE.toISOString();
const FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-05-form-generation-runtime",
  sessionSecret: "m2-05-generation-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m2-05-generation-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;
const fingerprint = (value) => createHash("sha256").update(value).digest("hex");

async function db() {
  const database = await openScriptDatabase(ENV);
  await applyMigrationsThrough(database, ENV.releaseSha, "0039_randomized_assessment_forms");
  return database;
}

async function seedAdmin(database, c) {
  const accountId = `account_m205_generation_admin_${c}`;
  const sessionId = `session_m205_generation_admin_${c}`;
  const email = `generation-admin-${c.toLowerCase()}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,
       email_verified_at,password_set_at,created_at,updated_at)
     VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [accountId, email, `Generation Admin ${c}`, "scrypt$16384$8$1$salt$hash", NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,
       created_at,last_seen_at,expires_at)
     VALUES($1,$2,'admin',$3,$4,$5,$5,$6)`,
    [sessionId, accountId, `token-${c}`, `csrf-${c}`, NOW, FUTURE]
  );
  return Object.freeze({
    accountId,
    sessionId,
    activeRole: "admin",
    accountStatus: "active",
    email,
    displayName: `Generation Admin ${c}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FUTURE,
    tenantMembership: null,
    authorizedPlatformPermission: "platform.operations.manage"
  });
}

async function seedFramework(database, c) {
  const frameworkId = oid("framework", c);
  const frameworkReference = `GEN-FRAME-${c.toUpperCase()}`;
  await database.query(
    `INSERT INTO assurance_frameworks(framework_id,framework_reference,title,framework_status,
       created_by_account_id,created_at,updated_at)
     VALUES($1,$2,$3,'ACTIVE',$4,$5,$5)`,
    [frameworkId, frameworkReference, `Generation Framework ${c}`, `account_seed_${c}`, NOW]
  );
  return { frameworkId, frameworkReference };
}

async function makeBlueprint(database, admin, frameworkReference, reference, count = 1) {
  const service = new AssessmentBlueprintService(database);
  return service.createBlueprint(
    admin,
    {
      blueprintReference: reference,
      version: {
        title: `${reference} assessment`,
        frameworkReference,
        selectors: [
          {
            count,
            questionType: "MULTIPLE_CHOICE",
            domainReference: "General Safety",
            difficulty: "MEDIUM",
            tagsAll: ["core"]
          }
        ]
      }
    },
    NOW_DATE
  );
}

async function seedQuestion(database, frameworkId, c) {
  const questionId = oid("assessment_question", c);
  const questionVersionId = oid("question_version", c);
  const hash = fingerprint(`question-${c}-v1`);
  await database.query(
    `INSERT INTO assessment_questions(
       question_id,question_reference,question_status,
       created_by_account_id,created_at,updated_at
     ) VALUES($1,$2,'INACTIVE',$3,$4,$4)`,
    [questionId, `GEN-Q-${c}`, `account_seed_${c}`, NOW]
  );
  await database.query(
    `INSERT INTO assessment_question_versions(
       question_version_id,question_id,version_no,question_type,prompt,options_json,
       answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,
       content_fingerprint,created_by_account_id,created_at
     ) VALUES($1,$2,1,'MULTIPLE_CHOICE',$3,$4::jsonb,$5::jsonb,NULL,$6,
              'General Safety','MEDIUM',$7::jsonb,$8,$9,$10)`,
    [
      questionVersionId,
      questionId,
      `What is the safe response for generated question ${c}?`,
      JSON.stringify(["Stop work", "Continue", "Ignore"]),
      JSON.stringify("Stop work"),
      frameworkId,
      JSON.stringify(["core"]),
      hash,
      `account_seed_${c}`,
      NOW
    ]
  );
  await database.query(
    `UPDATE assessment_questions
     SET current_version_id=$2,current_content_fingerprint=$3,
         question_status='ACTIVE',updated_at=$4
     WHERE question_id=$1`,
    [questionId, questionVersionId, hash, NOW]
  );
  return { questionId, questionVersionId };
}

async function reviseQuestion(database, question, frameworkId, c) {
  const nextVersionId = oid("question_version", c);
  const hash = fingerprint(`question-${question.questionId}-${c}`);
  await database.query(
    `INSERT INTO assessment_question_versions(
       question_version_id,question_id,version_no,question_type,prompt,options_json,
       answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,
       content_fingerprint,created_by_account_id,created_at
     ) VALUES($1,$2,2,'MULTIPLE_CHOICE',$3,$4::jsonb,$5::jsonb,NULL,$6,
              'General Safety','MEDIUM',$7::jsonb,$8,$9,$10)`,
    [
      nextVersionId,
      question.questionId,
      `Revised safe response prompt ${c} keeps the same stable question identity`,
      JSON.stringify(["Stop work", "Continue", "Ignore"]),
      JSON.stringify("Stop work"),
      frameworkId,
      JSON.stringify(["core"]),
      hash,
      `account_seed_${c}`,
      NOW
    ]
  );
  await database.query(
    `UPDATE assessment_questions
     SET current_version_id=$2,current_content_fingerprint=$3,updated_at=$4
     WHERE question_id=$1`,
    [question.questionId, nextVersionId, hash, NOW]
  );
  return nextVersionId;
}

async function seedCase(database, c, workerAccountId, frameworkId, { snapshot = true } = {}) {
  const tenantId = oid("tenant", c);
  const orderId = oid("assurance_order", c);
  const targetId = oid("assurance_target", c);
  const caseId = oid("assurance_case", c);
  await database.query(
    `INSERT INTO assurance_orders(
       order_id,tenant_id,created_by_membership_id,order_name,order_reference,
       requested_identity_checks,requested_evidence_checks,assessment_framework_references,
       interview_required,order_status,validation_errors,scope_version,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,FALSE,'DRAFT','[]'::jsonb,1,$6,$6)`,
    [orderId, tenantId, `membership_${c.repeat(16)}`, `Order ${c}`, `ORDER-${c}`, NOW]
  );
  await database.query(
    `INSERT INTO assurance_order_workers(
       target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,
       target_status,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,'company','eligible',$6,$6)`,
    [targetId, orderId, tenantId, `worker_link_${c.repeat(16)}`, workerAccountId, NOW]
  );
  await database.query(
    `INSERT INTO assurance_cases(
       case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,
       case_status,owner_kind,next_action,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,'Assessment pending','worker','Start assessment',$7,$7)`,
    [caseId, orderId, targetId, tenantId, `worker_link_${c.repeat(16)}`, workerAccountId, NOW]
  );
  if (snapshot) {
    await database.query(
      `INSERT INTO assurance_case_policy_snapshots(
         snapshot_id,case_id,tenant_id,framework_id,policy_id,global_policy_version_id,
         tenant_override_id,policy_source,effective_value_json,reference_time,resolved_at,
         created_by_account_id
       ) VALUES($1,$2,$3,$4,$5,$6,NULL,'GLOBAL','{}'::jsonb,$7,$7,NULL)`,
      [
        oid("policy_snapshot", c),
        caseId,
        tenantId,
        frameworkId,
        oid("policy", c),
        oid("policy_version", c),
        NOW
      ]
    );
  }
  return { caseId, tenantId, workerAccountId };
}

function itemIds(form) {
  return form.items.map((item) => item.questionId);
}

test("M2.05 never repeats a stable question for the same Worker, even after question revision", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "a");
    const framework = await seedFramework(database, "a");
    const blueprint = await makeBlueprint(database, admin, framework.frameworkReference, "BP-NOREPEAT");
    const q1 = await seedQuestion(database, framework.frameworkId, "a");
    const q2 = await seedQuestion(database, framework.frameworkId, "b");
    const worker = "worker_account_same_person_01";
    const firstCase = await seedCase(database, "c", worker, framework.frameworkId);
    const service = new AssessmentFormGenerationService(database);
    const first = await service.generateForCase(
      admin,
      { caseId: firstCase.caseId, blueprintVersionId: blueprint.version.blueprintVersionId },
      NOW_DATE
    );
    assert.equal(first.items.length, 1);
    const selected = first.items[0];
    const selectedQuestion = selected.questionId === q1.questionId ? q1 : q2;
    const revisedVersionId = await reviseQuestion(database, selectedQuestion, framework.frameworkId, "d");

    const secondCase = await seedCase(database, "e", worker, framework.frameworkId);
    const second = await service.generateForCase(
      admin,
      { caseId: secondCase.caseId, blueprintVersionId: blueprint.version.blueprintVersionId },
      NOW_DATE
    );
    assert.equal(second.items.length, 1);
    assert.notEqual(second.items[0].questionId, selected.questionId);
    assert.notEqual(second.items[0].questionVersionId, revisedVersionId);

    const overlap = itemIds(first).filter((id) => itemIds(second).includes(id));
    assert.deepEqual(overlap, []);
  } finally {
    await database.close();
  }
});

test("M2.05 permits different Workers to receive the same stable question", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "f");
    const framework = await seedFramework(database, "f");
    const blueprint = await makeBlueprint(database, admin, framework.frameworkReference, "BP-SHARED");
    const only = await seedQuestion(database, framework.frameworkId, "f");
    const caseOne = await seedCase(database, "g", "worker_account_shared_one", framework.frameworkId);
    const caseTwo = await seedCase(database, "h", "worker_account_shared_two", framework.frameworkId);
    const service = new AssessmentFormGenerationService(database);
    const first = await service.generateForCase(admin, {
      caseId: caseOne.caseId,
      blueprintVersionId: blueprint.version.blueprintVersionId
    }, NOW_DATE);
    const second = await service.generateForCase(admin, {
      caseId: caseTwo.caseId,
      blueprintVersionId: blueprint.version.blueprintVersionId
    }, NOW_DATE);
    assert.equal(first.items[0].questionId, only.questionId);
    assert.equal(second.items[0].questionId, only.questionId);
  } finally {
    await database.close();
  }
});

test("M2.05 insufficient unseen pool fails closed with no partial form", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "i");
    const framework = await seedFramework(database, "i");
    const blueprint = await makeBlueprint(database, admin, framework.frameworkReference, "BP-CAPACITY");
    await seedQuestion(database, framework.frameworkId, "i");
    const worker = "worker_account_capacity_same";
    const firstCase = await seedCase(database, "j", worker, framework.frameworkId);
    const secondCase = await seedCase(database, "k", worker, framework.frameworkId);
    const service = new AssessmentFormGenerationService(database);
    await service.generateForCase(admin, {
      caseId: firstCase.caseId,
      blueprintVersionId: blueprint.version.blueprintVersionId
    }, NOW_DATE);
    await assert.rejects(
      service.generateForCase(admin, {
        caseId: secondCase.caseId,
        blueprintVersionId: blueprint.version.blueprintVersionId
      }, NOW_DATE),
      AssessmentFormGenerationError
    );
    const secondRows = await database.query(
      `SELECT COUNT(*)::int AS count FROM generated_assessment_forms WHERE case_id=$1`,
      [secondCase.caseId]
    );
    assert.equal(secondRows.rows[0].count, 0);
  } finally {
    await database.close();
  }
});

test("M2.05 requires a locked policy snapshot with the same framework", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "l");
    const framework = await seedFramework(database, "l");
    const otherFramework = await seedFramework(database, "m");
    const blueprint = await makeBlueprint(database, admin, framework.frameworkReference, "BP-FRAMEWORK");
    await seedQuestion(database, framework.frameworkId, "l");
    const missing = await seedCase(database, "n", "worker_account_missing_snapshot", framework.frameworkId, { snapshot: false });
    const mismatch = await seedCase(database, "o", "worker_account_wrong_framework", otherFramework.frameworkId);
    const service = new AssessmentFormGenerationService(database);
    await assert.rejects(
      service.generateForCase(admin, { caseId: missing.caseId, blueprintVersionId: blueprint.version.blueprintVersionId }, NOW_DATE),
      AssessmentFormGenerationError
    );
    await assert.rejects(
      service.generateForCase(admin, { caseId: mismatch.caseId, blueprintVersionId: blueprint.version.blueprintVersionId }, NOW_DATE),
      AssessmentFormGenerationError
    );
  } finally {
    await database.close();
  }
});

test("M2.05 concurrent generation converges to one immutable form and item set", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "p");
    const framework = await seedFramework(database, "p");
    const blueprint = await makeBlueprint(database, admin, framework.frameworkReference, "BP-RACE", 2);
    await seedQuestion(database, framework.frameworkId, "p");
    await seedQuestion(database, framework.frameworkId, "q");
    await seedQuestion(database, framework.frameworkId, "r");
    const targetCase = await seedCase(database, "s", "worker_account_generation_race", framework.frameworkId);
    const service = new AssessmentFormGenerationService(database);
    const calls = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.generateForCase(admin, {
          caseId: targetCase.caseId,
          blueprintVersionId: blueprint.version.blueprintVersionId
        }, NOW_DATE)
      )
    );
    assert.equal(new Set(calls.map((form) => form.formId)).size, 1);
    assert.equal(calls[0].items.length, 2);
    assert.deepEqual(calls[0].items.map((item) => item.position), [1, 2]);
    const forms = await database.query(
      `SELECT COUNT(*)::int AS count FROM generated_assessment_forms WHERE case_id=$1`,
      [targetCase.caseId]
    );
    const items = await database.query(
      `SELECT COUNT(*)::int AS count FROM generated_assessment_form_items WHERE form_id=$1`,
      [calls[0].formId]
    );
    assert.equal(forms.rows[0].count, 1);
    assert.equal(items.rows[0].count, 2);

    await assert.rejects(
      database.query(`UPDATE generated_assessment_forms SET question_count=3 WHERE form_id=$1`, [calls[0].formId]),
      /append-only/i
    );
    await assert.rejects(
      database.query(`DELETE FROM generated_assessment_form_items WHERE form_id=$1`, [calls[0].formId]),
      /append-only/i
    );

    const audit = await database.query(
      `SELECT action_key,metadata FROM platform_audit_events WHERE target_reference=$1 ORDER BY audit_sequence`,
      [calls[0].formId]
    );
    assert.deepEqual(audit.rows.map((row) => row.action_key), ["assessment.form.generated"]);
    const serialized = JSON.stringify(audit.rows[0].metadata).toLowerCase();
    assert.equal(serialized.includes("nonce"), false);
    assert.equal(serialized.includes("answer"), false);
    assert.equal(serialized.includes("rubric"), false);
  } finally {
    await database.close();
  }
});
