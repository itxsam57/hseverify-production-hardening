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

const NOW_DATE = new Date("2026-08-18T09:35:00.000Z");
const NOW = NOW_DATE.toISOString();
const FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-05-cross-case-race-runtime",
  sessionSecret: "m2-05-cross-case-race-session-secret-with-thirty-two-characters",
  authPepper: "m2-05-cross-case-race-auth-pepper-with-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;
const fingerprint = (value) => createHash("sha256").update(value).digest("hex");

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, "0039_randomized_assessment_forms");
  return db;
}

async function seedAdmin(db) {
  const accountId = "account_m205_cross_case_admin";
  const sessionId = "session_m205_cross_case_admin";
  await db.query(
    `INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,
       email_verified_at,password_set_at,created_at,updated_at)
     VALUES($1,'cross-case-admin@example.com','Cross Case Admin','active',$2,$3,$3,$3,$3)`,
    [accountId, "scrypt$16384$8$1$salt$hash", NOW]
  );
  await db.query(
    `INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)`,
    [accountId, NOW]
  );
  await db.query(
    `INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,
       created_at,last_seen_at,expires_at)
     VALUES($1,$2,'admin','cross-case-token','cross-case-csrf',$3,$3,$4)`,
    [sessionId, accountId, NOW, FUTURE]
  );
  return Object.freeze({
    accountId,
    sessionId,
    activeRole: "admin",
    accountStatus: "active",
    email: "cross-case-admin@example.com",
    displayName: "Cross Case Admin",
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FUTURE,
    tenantMembership: null,
    authorizedPlatformPermission: "platform.operations.manage"
  });
}

async function seedFrameworkAndBlueprint(db, admin) {
  const frameworkId = oid("framework", "r");
  await db.query(
    `INSERT INTO assurance_frameworks(framework_id,framework_reference,title,framework_status,
       created_by_account_id,created_at,updated_at)
     VALUES($1,'GEN-FRAME-RACE','Race Framework','ACTIVE',$2,$3,$3)`,
    [frameworkId, admin.accountId, NOW]
  );
  const blueprint = await new AssessmentBlueprintService(db).createBlueprint(
    admin,
    {
      blueprintReference: "BP-CROSS-CASE-RACE",
      version: {
        title: "Cross case race assessment",
        frameworkReference: "GEN-FRAME-RACE",
        selectors: [
          {
            count: 1,
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
  return { frameworkId, blueprintVersionId: blueprint.version.blueprintVersionId };
}

async function seedSingleQuestion(db, frameworkId) {
  const questionId = oid("assessment_question", "r");
  const versionId = oid("question_version", "r");
  const hash = fingerprint("m205-cross-case-race-question");
  await db.query(
    `INSERT INTO assessment_questions(
       question_id,question_reference,question_status,created_by_account_id,created_at,updated_at
     ) VALUES($1,'GEN-Q-RACE','INACTIVE','account_cross_case_seed',$2,$2)`,
    [questionId, NOW]
  );
  await db.query(
    `INSERT INTO assessment_question_versions(
       question_version_id,question_id,version_no,question_type,prompt,options_json,
       answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,
       content_fingerprint,created_by_account_id,created_at
     ) VALUES($1,$2,1,'MULTIPLE_CHOICE',$3,$4::jsonb,$5::jsonb,NULL,$6,
              'General Safety','MEDIUM',$7::jsonb,$8,'account_cross_case_seed',$9)`,
    [
      versionId,
      questionId,
      "What is the safe response when a serious uncontrolled hazard is identified?",
      JSON.stringify(["Stop work", "Continue", "Ignore"]),
      JSON.stringify("Stop work"),
      frameworkId,
      JSON.stringify(["core"]),
      hash,
      NOW
    ]
  );
  await db.query(
    `UPDATE assessment_questions
     SET current_version_id=$2,current_content_fingerprint=$3,question_status='ACTIVE',updated_at=$4
     WHERE question_id=$1`,
    [questionId, versionId, hash, NOW]
  );
  return questionId;
}

async function seedCase(db, c, workerAccountId, frameworkId) {
  const tenantId = oid("tenant", c);
  const orderId = oid("assurance_order", c);
  const targetId = oid("assurance_target", c);
  const caseId = oid("assurance_case", c);
  await db.query(
    `INSERT INTO assurance_orders(
       order_id,tenant_id,created_by_membership_id,order_name,order_reference,
       requested_identity_checks,requested_evidence_checks,assessment_framework_references,
       interview_required,order_status,validation_errors,scope_version,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,FALSE,'DRAFT','[]'::jsonb,1,$6,$6)`,
    [orderId, tenantId, `membership_${c.repeat(16)}`, `Race Order ${c}`, `RACE-${c}`, NOW]
  );
  await db.query(
    `INSERT INTO assurance_order_workers(
       target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,
       target_status,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,'company','eligible',$6,$6)`,
    [targetId, orderId, tenantId, `worker_link_${c.repeat(16)}`, workerAccountId, NOW]
  );
  await db.query(
    `INSERT INTO assurance_cases(
       case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,
       case_status,owner_kind,next_action,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,'Assessment pending','worker','Start assessment',$7,$7)`,
    [caseId, orderId, targetId, tenantId, `worker_link_${c.repeat(16)}`, workerAccountId, NOW]
  );
  await db.query(
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
  return caseId;
}

test("M2.05 cross-case same-Worker generation race leaves one exposure and returns a safe loser error", async () => {
  const db = await database();
  try {
    const admin = await seedAdmin(db);
    const { frameworkId, blueprintVersionId } = await seedFrameworkAndBlueprint(db, admin);
    const questionId = await seedSingleQuestion(db, frameworkId);
    const workerAccountId = "worker_account_cross_case_race";
    const firstCaseId = await seedCase(db, "u", workerAccountId, frameworkId);
    const secondCaseId = await seedCase(db, "v", workerAccountId, frameworkId);
    const service = new AssessmentFormGenerationService(db);

    const outcomes = await Promise.allSettled([
      service.generateForCase(admin, { caseId: firstCaseId, blueprintVersionId }, NOW_DATE),
      service.generateForCase(admin, { caseId: secondCaseId, blueprintVersionId }, NOW_DATE)
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof AssessmentFormGenerationError);
    assert.equal(String(rejected[0].reason.message).toLowerCase().includes("sql"), false);
    assert.equal(String(rejected[0].reason.message).toLowerCase().includes("constraint"), false);

    const exposure = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM generated_assessment_form_items
       WHERE worker_account_id=$1 AND question_id=$2`,
      [workerAccountId, questionId]
    );
    assert.equal(exposure.rows[0].count, 1);

    const forms = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM generated_assessment_forms
       WHERE worker_account_id=$1`,
      [workerAccountId]
    );
    assert.equal(forms.rows[0].count, 1);
  } finally {
    await db.close();
  }
});

test("M2.05 unmatched database uniqueness races are translated to a safe domain error", async () => {
  const principal = Object.freeze({
    accountId: "account_m205_unique_fault",
    sessionId: "session_m205_unique_fault",
    activeRole: "admin",
    accountStatus: "active",
    email: "unique-fault@example.com",
    displayName: "Unique Fault Admin",
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FUTURE,
    tenantMembership: null,
    authorizedPlatformPermission: "platform.operations.manage"
  });
  const uniqueError = Object.assign(
    new Error("duplicate key value violates unique constraint generated_assessment_form_items_worker_question"),
    { code: "23505" }
  );
  const fakeDatabase = {
    async query() {
      return { rows: [] };
    },
    async transaction() {
      throw uniqueError;
    }
  };
  const service = new AssessmentFormGenerationService(fakeDatabase);

  await assert.rejects(
    service.generateForCase(
      principal,
      {
        caseId: oid("assurance_case", "x"),
        blueprintVersionId: oid("blueprint_version", "x")
      },
      NOW_DATE
    ),
    (error) => {
      assert.ok(error instanceof AssessmentFormGenerationError);
      assert.equal(error.message.includes("duplicate key"), false);
      assert.equal(error.message.toLowerCase().includes("constraint"), false);
      return true;
    }
  );
});
