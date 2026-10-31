import {seedPublishedQuestion,revisePublishedFixtureQuestion} from "../helpers/question-publication-fixture.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import { ensureAssessmentGenerationRuntime } from "../helpers/assessment-generation-runtime.mjs";

const runtime = ensureAssessmentGenerationRuntime();
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
  await applyMigrationsThrough(database, ENV.releaseSha, "0124_question_exposure_families");
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

async function seedQuestion(database,frameworkId,c) {
 return seedPublishedQuestion(database,{questionId:oid("assessment_question",c),versionId:oid("question_version",c),reference:`GEN-Q-${c}`,questionType:"MULTIPLE_CHOICE",prompt:`What is the safe response for generated question ${c}?`,options:["Stop work","Continue","Ignore"],answerKey:"Stop work",frameworkId,domainReference:"General Safety",difficulty:"MEDIUM",tags:["core"],fingerprint:fingerprint(`question-${c}-v1`),now:NOW});
}
async function reviseQuestion(database,question,frameworkId,c) {
 const framework=(await database.query("SELECT framework_reference FROM assurance_frameworks WHERE framework_id=$1",[frameworkId])).rows[0].framework_reference;
 return revisePublishedFixtureQuestion(database,question,{questionType:"MULTIPLE_CHOICE",prompt:`Revised safe response prompt ${c} keeps the same stable question identity`,options:["Stop work","Continue","Ignore"],answerKey:"Stop work",frameworkReference:framework,domainReference:"General Safety",difficulty:"MEDIUM",tags:["core"]},NOW);
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

test("M2.05.01 M2.05.02 M2.05.04 canonical MCQ-only written-only mixed real generation, permanent exposure and exhaustion", async () => {
  const database=await db();
  try {
    const admin=await seedAdmin(database,"t");
    const framework=await seedFramework(database,"t");
    const questionInputs=[
      ["t","MULTIPLE_CHOICE"],
      ["u","MULTIPLE_CHOICE"],
      ["v","LONG_TEXT"],
      ["w","SHORT_TEXT"]
    ];
    for(const [key,type] of questionInputs){
      await seedPublishedQuestion(database,{
        questionId:oid("assessment_question",key),
        versionId:oid("question_version",key),
        reference:"M205-MATRIX-"+key.toUpperCase(),
        questionType:type,
        prompt:`What actions control the specific workplace hazard in scenario ${key}?`,
        options:type==="MULTIPLE_CHOICE"?["Stop and assess","Proceed without checking","Ignore"]:null,
        answerKey:type==="MULTIPLE_CHOICE"?"Stop and assess":null,
        rubric:type!=="MULTIPLE_CHOICE"?{maxScore:10,criteria:[{description:"Names the hazard and a suitable control",points:10}]}:null,
        frameworkId:framework.frameworkId,
        domainReference:"General Safety",
        difficulty:"MEDIUM",
        tags:["core"],
        fingerprint:fingerprint("m205-matrix-"+key),now:NOW
      });
    }
    const cases=[
      {name:"MCQ only",tag:"m",selectors:[{count:2,questionType:"MULTIPLE_CHOICE",tagsAll:["core"]}],expected:["MULTIPLE_CHOICE","MULTIPLE_CHOICE"]},
      {name:"written only",tag:"n",selectors:[{count:1,questionType:"LONG_TEXT",tagsAll:["core"]},{count:1,questionType:"SHORT_TEXT",tagsAll:["core"]}],expected:["LONG_TEXT","SHORT_TEXT"]},
      {name:"mixed",tag:"o",selectors:[{count:1,questionType:"MULTIPLE_CHOICE",tagsAll:["core"]},{count:1,questionType:"LONG_TEXT",tagsAll:["core"]}],expected:["MULTIPLE_CHOICE","LONG_TEXT"]}
    ];
    const service=new AssessmentFormGenerationService(database);
    const blueprintService=new AssessmentBlueprintService(database);
    const allQuestions=new Map((await database.query("SELECT question_id,question_type FROM assessment_question_versions")).rows.map(row=>[row.question_id,row.question_type]));
    for(const scenario of cases){
      const blueprint=await blueprintService.createBlueprint(admin,{
        blueprintReference:"M205-MATRIX-"+scenario.name.replace(/ /g,"-").toUpperCase(),
        version:{title:"Canonical "+scenario.name+" assessment",frameworkReference:framework.frameworkReference,selectors:scenario.selectors}
      },NOW_DATE);
      const worker="worker_m205_matrix_"+scenario.tag;
      const firstCase=await seedCase(database,scenario.tag,worker,framework.frameworkId);
      const first=await service.generateForCase(admin,{caseId:firstCase.caseId,blueprintVersionId:blueprint.version.blueprintVersionId},NOW_DATE);
      assert.equal(first.items.length,2,scenario.name);
      assert.deepEqual(first.items.map(item=>allQuestions.get(item.questionId)),scenario.expected,scenario.name);
      assert.equal(new Set(first.items.map(item=>item.questionId)).size,2);
      const reserved=await database.query("SELECT COUNT(*)::int AS count FROM generated_assessment_form_items WHERE worker_account_id=$1",[worker]);
      assert.equal(reserved.rows[0].count,2,scenario.name+" complete form reserved atomically before display");
      const itemSnapshot=first.items.map(item=>({id:item.questionId,version:item.questionVersionId,position:item.position}));
      const reloaded=await service.generateForCase(admin,{caseId:firstCase.caseId,blueprintVersionId:blueprint.version.blueprintVersionId},NOW_DATE);
      assert.equal(reloaded.formId,first.formId,"Retry must be idempotent");
      assert.deepEqual(reloaded.items.map(item=>({id:item.questionId,version:item.questionVersionId,position:item.position})),itemSnapshot);
      const secondCase=await seedCase(database,String.fromCharCode(scenario.tag.charCodeAt(0)+10),worker,framework.frameworkId);
      await assert.rejects(
        service.generateForCase(admin,{caseId:secondCase.caseId,blueprintVersionId:blueprint.version.blueprintVersionId},NOW_DATE),
        error=>error instanceof AssessmentFormGenerationError && /insufficient unseen/i.test(error.message),
        "The second tenant/case for the same permanent Worker must not repeat the reserved questions"
      );
      const after=await database.query("SELECT COUNT(*)::int AS count FROM generated_assessment_forms WHERE case_id=$1",[secondCase.caseId]);
      assert.equal(after.rows[0].count,0,"No partial form on capacity exhaustion");
      const caseAfter=await database.query("SELECT case_status,owner_kind FROM assurance_cases WHERE case_id=$1",[secondCase.caseId]);
      assert.equal(caseAfter.rows[0].case_status,"Assessment pending");
      assert.equal(caseAfter.rows[0].owner_kind,"worker");
      const reservationsAfter=await database.query("SELECT COUNT(*)::int AS count FROM generated_assessment_form_items WHERE worker_account_id=$1",[worker]);
      assert.equal(reservationsAfter.rows[0].count,2,"No duplicate/reserved exposure after failed retake");
      console.log("NATIVE_M205_MATRIX_"+scenario.name.replace(/ /g,"_").toUpperCase()+" complete reserved form, original idempotent, second tenant/case fails closed");
    }
  } finally {await database.close();}
});

test("M2.05.03 equivalent variants are excluded both within form and across worker retakes", async () => {
  const database=await db();
  try {
    const admin=await seedAdmin(database,"y");
    const framework=await seedFramework(database,"y");
    const shared="EQUIVALENT-FAMILY-Y";
    const questions=[];
    for(const [c,family] of [["y",shared],["z",shared],["j","INDEPENDENT-FAMILY-J"]]){
      const questionId=oid("assessment_question",c);
      await seedPublishedQuestion(database,{
        questionId,versionId:oid("question_version",c),
        reference:"M205-FAMILY-"+c.toUpperCase(),exposureFamilyReference:family,
        questionType:"MULTIPLE_CHOICE",
        prompt:`What specific safe step is needed for related hazard variant ${c}?`,
        options:["Stop work","Continue work","Ignore the hazard"],
        answerKey:"Stop work",frameworkId:framework.frameworkId,
        domainReference:"General Safety",difficulty:"MEDIUM",
        tags:c==="j"?["core"]:["core","family"],
        fingerprint:fingerprint("m205-exposure-family-"+c),now:NOW
      });
      questions.push({questionId,family});
    }
    const original=await database.query("SELECT question_id,exposure_family_reference FROM assessment_questions WHERE question_id=$1",[questions[0].questionId]);
    assert.equal(original.rows[0].exposure_family_reference,shared);
    await assert.rejects(
      database.query("UPDATE assessment_questions SET exposure_family_reference='FORGED-FAMILY' WHERE question_id=$1",[questions[0].questionId]),
      error=>error.code==="55000","Family assignment must not be changed after Worker exposure"
    );
    const oneVersion=await new AssessmentBlueprintService(database).createBlueprint(admin,{
      blueprintReference:"M205-SHARED-ONE",version:{
        title:"Single variant exposure evaluation",frameworkReference:framework.frameworkReference,
        selectors:[{count:1,questionType:"MULTIPLE_CHOICE",tagsAll:["family"]}]
      }
    },NOW_DATE);
    const twoVersion=await new AssessmentBlueprintService(database).createBlueprint(admin,{
      blueprintReference:"M205-SHARED-TWO",version:{
        title:"Two independent families evaluation",frameworkReference:framework.frameworkReference,
        selectors:[{count:2,questionType:"MULTIPLE_CHOICE",tagsAll:["core"]}]
      }
    },NOW_DATE);
    const service=new AssessmentFormGenerationService(database);
    const worker="worker_m205_exposure_family_permanent";
    const firstCase=await seedCase(database,"x",worker,framework.frameworkId);
    const first=await service.generateForCase(admin,{
      caseId:firstCase.caseId,blueprintVersionId:oneVersion.version.blueprintVersionId
    },NOW_DATE);
    assert.equal(first.items.length,1);
    assert.ok(questions.slice(0,2).some(q=>q.questionId===first.items[0].questionId));
    const secondCase=await seedCase(database,"f",worker,framework.frameworkId);
    await assert.rejects(service.generateForCase(admin,{
      caseId:secondCase.caseId,blueprintVersionId:oneVersion.version.blueprintVersionId
    },NOW_DATE),error=>error instanceof AssessmentFormGenerationError && /insufficient unseen/i.test(error.message));
    assert.equal((await database.query("SELECT COUNT(*)::int n FROM generated_assessment_forms WHERE case_id=$1",[secondCase.caseId])).rows[0].n,0);
    const thirdCase=await seedCase(database,"b","worker_m205_family_fresh_person",framework.frameworkId);
    const two=await service.generateForCase(admin,{
      caseId:thirdCase.caseId,blueprintVersionId:twoVersion.version.blueprintVersionId
    },NOW_DATE);
    assert.equal(two.items.length,2);
    const familyRows=await database.query("SELECT exposure_family_reference FROM generated_assessment_form_items WHERE form_id=$1",[two.formId]);
    assert.equal(new Set(familyRows.rows.map(row=>row.exposure_family_reference)).size,2,
      "A single complete assessment must not select two equivalent variants");
    const reservations=await database.query("SELECT exposure_family_reference,worker_account_id FROM generated_assessment_form_items WHERE worker_account_id=$1",[worker]);
    assert.deepEqual(reservations.rows,[{exposure_family_reference:shared,worker_account_id:worker}]);
    const forgedFormId=oid("assessment_form","u");
    const existingQuestion=questions.find(q=>q.questionId!==first.items[0].questionId&&q.family===shared);
    await assert.rejects(database.transaction(async tx=>{
      await tx.query("INSERT INTO generated_assessment_forms(form_id,case_id,worker_account_id,blueprint_version_id,generation_nonce_hex,question_count,generated_at) VALUES($1,$2,$3,$4,$5,1,$6)",
        [forgedFormId,secondCase.caseId,worker,oneVersion.version.blueprintVersionId,"b".repeat(64),NOW]);
      const version=(await tx.query("SELECT current_version_id FROM assessment_questions WHERE question_id=$1",[existingQuestion.questionId])).rows[0].current_version_id;
      await tx.query("INSERT INTO generated_assessment_form_items(form_item_id,form_id,position,question_id,question_version_id,created_at) VALUES($1,$2,1,$3,$4,$5)",
        [oid("assessment_form_item","u"),forgedFormId,existingQuestion.questionId,version,NOW]);
    }),error=>error.code==="23505","Database must reject cross-case exposure of an equivalent question variant");
    assert.equal((await database.query("SELECT COUNT(*)::int n FROM generated_assessment_forms WHERE form_id=$1",[forgedFormId])).rows[0].n,0);
    await assert.rejects(
      database.execute(readFileSync("database/migrations/0124_question_exposure_families.down.sql","utf8")),
      error=>error.code==="55000",
      "Rollback must refuse to drop permanent exposure-family history on a populated database"
    );
    console.log("ACTUAL_M20503_FAMILY_SQL same-form distinct families, same Worker retake excludes equivalent stable ID, direct DB bypass rejected, exact history immutable, unsafe rollback refused");
  } finally {await database.close();}
});
