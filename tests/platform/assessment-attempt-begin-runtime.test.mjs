import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_ASSESSMENT_ATTEMPT_RUNTIME_DIST;
assert.ok(runtime, "HSE_ASSESSMENT_ATTEMPT_RUNTIME_DIST is required");
const attemptModule = await import(
  pathToFileURL(join(runtime, "assessment-attempt", "assessment-attempt-service.js")).href
);
const {
  AssessmentAttemptService,
  AssessmentAttemptAccessError
} = attemptModule;

const NOW_DATE = new Date("2026-08-31T19:20:00.000Z");
const NOW = NOW_DATE.toISOString();
const FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-07-attempt-begin-runtime",
  sessionSecret: "m2-07-attempt-begin-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-07-attempt-begin-auth-pepper-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;
const fingerprint = (value) => createHash("sha256").update(value).digest("hex");

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, "0043_assessment_attempt_drafts");
  return db;
}

async function seedAccount(db, c, role = "worker", { revoked = false } = {}) {
  const accountId = `account_m207_begin_${role}_${c}`;
  const sessionId = `session_m207_begin_${role}_${c}`;
  await db.query(
    `INSERT INTO auth_accounts(
       account_id,email_normalized,display_name,account_status,password_hash,
       email_verified_at,password_set_at,created_at,updated_at
     ) VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [accountId, `${role}-${c}@example.com`, `M2.07 ${role} ${c}`, "scrypt$16384$8$1$salt$hash", NOW]
  );
  await db.query(
    `INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)`,
    [accountId, role, NOW]
  );
  await db.query(
    `INSERT INTO auth_sessions(
       session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,
       expires_at,revoked_at,revocation_reason
     ) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)`,
    [
      sessionId,
      accountId,
      role,
      `token-${role}-${c}`,
      `csrf-${role}-${c}`,
      NOW,
      FUTURE,
      revoked ? NOW : null,
      revoked ? "m207_begin_revoked" : null
    ]
  );
  return Object.freeze({
    accountId,
    sessionId,
    activeRole: role,
    accountStatus: "active",
    email: `${role}-${c}@example.com`,
    displayName: `M2.07 ${role} ${c}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FUTURE,
    tenantMembership: null
  });
}

async function seedOffering(db, c, workerAccountId) {
  const frameworkId = oid("framework", c);
  const blueprintId = oid("assessment_blueprint", c);
  const blueprintVersionId = oid("blueprint_version", c);
  const catalogueEntryId = oid("assessment_catalogue", c);
  const catalogueVersionId = oid("catalogue_version", c);
  const tenantId = oid("tenant", c);
  const orderId = oid("assurance_order", c);
  const targetId = oid("assurance_target", c);
  const caseId = oid("assurance_case", c);

  await db.query(
    `INSERT INTO assurance_frameworks(
       framework_id,framework_reference,title,framework_status,created_by_account_id,created_at,updated_at
     ) VALUES($1,$2,$3,'ACTIVE',$4,$5,$5)`,
    [frameworkId, `M207-FRAME-${c.toUpperCase()}`, `M2.07 Framework ${c}`, `account_seed_${c}`, NOW]
  );

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO assessment_blueprints(
         blueprint_id,blueprint_reference,blueprint_status,current_version_id,
         created_by_account_id,created_at,updated_at
       ) VALUES($1,$2,'INACTIVE',NULL,$3,$4,$4)`,
      [blueprintId, `M207-BP-${c.toUpperCase()}`, `account_seed_${c}`, NOW]
    );
    await tx.query(
      `INSERT INTO assessment_blueprint_versions(
         blueprint_version_id,blueprint_id,version_no,framework_id,title,
         selectors_json,created_by_account_id,created_at
       ) VALUES($1,$2,1,$3,$4,$5::jsonb,$6,$7)`,
      [
        blueprintVersionId,
        blueprintId,
        frameworkId,
        `M2.07 Blueprint ${c}`,
        JSON.stringify([{ count: 2, questionType: "MULTIPLE_CHOICE", domainReference: "Core", difficulty: "MEDIUM", tagsAll: ["core"] }]),
        `account_seed_${c}`,
        NOW
      ]
    );
    await tx.query(
      `UPDATE assessment_blueprints
       SET current_version_id=$2,blueprint_status='ACTIVE',updated_at=$3 WHERE blueprint_id=$1`,
      [blueprintId, blueprintVersionId, NOW]
    );
  });

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO assessment_catalogue_entries(
         catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,
         created_by_account_id,created_at,updated_at
       ) VALUES($1,$2,'INACTIVE',NULL,$3,$4,$4)`,
      [catalogueEntryId, `M207-CAT-${c.toUpperCase()}`, `account_seed_${c}`, NOW]
    );
    await tx.query(
      `INSERT INTO assessment_catalogue_versions(
         catalogue_version_id,catalogue_entry_id,version_no,title,description,framework_id,
         blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at
       ) VALUES($1,$2,1,$3,$4,$5,$6,0,$7,$8)`,
      [
        catalogueVersionId,
        catalogueEntryId,
        `M2.07 Catalogue ${c}`,
        "Eligible M2.07 assessment",
        frameworkId,
        blueprintVersionId,
        `account_seed_${c}`,
        NOW
      ]
    );
    await tx.query(
      `UPDATE assessment_catalogue_entries
       SET current_version_id=$2,catalogue_status='ACTIVE',updated_at=$3 WHERE catalogue_entry_id=$1`,
      [catalogueEntryId, catalogueVersionId, NOW]
    );
  });

  for (const suffix of [`${c}a`, `${c}b`]) {
    const questionId = oid("assessment_question", suffix[1] ?? suffix[0]);
    const versionId = oid("question_version", suffix[1] ?? suffix[0]);
    const prompt = `M2.07 pinned prompt ${suffix} requires a safe choice.`;
    const hash = fingerprint(prompt);
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO assessment_questions(
           question_id,question_reference,question_status,current_version_id,current_content_fingerprint,
           created_by_account_id,created_at,updated_at
         ) VALUES($1,$2,'INACTIVE',NULL,NULL,$3,$4,$4)`,
        [questionId, `M207-Q-${suffix.toUpperCase()}`, `account_seed_${c}`, NOW]
      );
      await tx.query(
        `INSERT INTO assessment_question_versions(
           question_version_id,question_id,version_no,question_type,prompt,options_json,
           answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,
           content_fingerprint,created_by_account_id,created_at
         ) VALUES($1,$2,1,'MULTIPLE_CHOICE',$3,$4::jsonb,$5::jsonb,NULL,$6,
                  'Core','MEDIUM',$7::jsonb,$8,$9,$10)`,
        [
          versionId,
          questionId,
          prompt,
          JSON.stringify(["Stop work", "Continue carefully", "Ignore"]),
          JSON.stringify("Stop work"),
          frameworkId,
          JSON.stringify(["core"]),
          hash,
          `account_seed_${c}`,
          NOW
        ]
      );
      await tx.query(
        `UPDATE assessment_questions
         SET current_version_id=$2,current_content_fingerprint=$3,question_status='ACTIVE',updated_at=$4
         WHERE question_id=$1`,
        [questionId, versionId, hash, NOW]
      );
    });
  }

  await db.query(
    `INSERT INTO assurance_orders(
       order_id,tenant_id,created_by_membership_id,order_name,order_reference,
       requested_identity_checks,requested_evidence_checks,assessment_framework_references,
       interview_required,order_status,validation_errors,scope_version,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,FALSE,'DRAFT','[]'::jsonb,1,$6,$6)`,
    [orderId, tenantId, `membership_${c.repeat(16)}`, `M2.07 Order ${c}`, `M207-ORDER-${c}`, NOW]
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
    [oid("policy_snapshot", c), caseId, tenantId, frameworkId, oid("policy", c), oid("policy_version", c), NOW]
  );

  return { caseId, catalogueVersionId, blueprintVersionId };
}

async function count(db, table, where = "TRUE", params = []) {
  const result = await db.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${where}`, params);
  return result.rows[0].count;
}

test("M2.07 begin atomically creates one owned attempt, transitions the case and projects only question one", async () => {
  const db = await database();
  try {
    const worker = await seedAccount(db, "a");
    const offering = await seedOffering(db, "a", worker.accountId);
    const service = new AssessmentAttemptService(db);

    const view = await service.begin(worker, {
      caseId: offering.caseId,
      catalogueVersionId: offering.catalogueVersionId
    }, NOW_DATE);

    assert.equal(view.attempt.status, "IN_PROGRESS");
    assert.equal(view.attempt.currentPosition, 1);
    assert.equal(view.attempt.questionCount, 2);
    assert.equal(view.submitted, false);
    assert.equal(view.currentQuestion.position, 1);
    assert.equal(view.currentQuestion.questionCount, 2);
    assert.equal(view.currentQuestion.attemptId, view.attempt.attemptId);
    assert.ok(!("answerKey" in view.currentQuestion));
    assert.ok(!("rubric" in view.currentQuestion));
    assert.ok(!("score" in view.currentQuestion));

    const second = await db.query(
      `SELECT v.prompt
       FROM generated_assessment_forms f
       JOIN generated_assessment_form_items i ON i.form_id=f.form_id AND i.position=2
       JOIN assessment_question_versions v ON v.question_version_id=i.question_version_id
       WHERE f.form_id=$1`,
      [view.attempt.formId]
    );
    assert.equal(second.rows.length, 1);
    assert.doesNotMatch(JSON.stringify(view), new RegExp(second.rows[0].prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const caseRow = await db.query(
      `SELECT case_status,owner_kind,next_action FROM assurance_cases WHERE case_id=$1`,
      [offering.caseId]
    );
    assert.equal(caseRow.rows[0].case_status, "Assessment in progress");
    assert.equal(caseRow.rows[0].owner_kind, "worker");
    assert.match(caseRow.rows[0].next_action, /complete.*assessment/i);
    assert.equal(await count(db, "assessment_attempts", "case_id=$1", [offering.caseId]), 1);
    assert.equal(await count(db, "assurance_case_timeline_events", "case_id=$1 AND event_type='assessment_attempt_started'", [offering.caseId]), 1);
    assert.equal(await count(db, "platform_audit_events", "action_key='assessment.attempt.started' AND target_reference=$1", [view.attempt.attemptId]), 1);
  } finally {
    await db.close();
  }
});

test("M2.07 begin is idempotent after the case is in progress and concurrent calls converge", async () => {
  const db = await database();
  try {
    const worker = await seedAccount(db, "c");
    const offering = await seedOffering(db, "c", worker.accountId);
    const service = new AssessmentAttemptService(db);

    const first = await service.begin(worker, { caseId: offering.caseId, catalogueVersionId: offering.catalogueVersionId }, NOW_DATE);
    const second = await service.begin(worker, { caseId: offering.caseId, catalogueVersionId: offering.catalogueVersionId }, NOW_DATE);
    assert.equal(second.attempt.attemptId, first.attempt.attemptId);
    assert.equal(second.attempt.formId, first.attempt.formId);

    const burst = await Promise.all(
      Array.from({ length: 6 }, () => service.begin(worker, {
        caseId: offering.caseId,
        catalogueVersionId: offering.catalogueVersionId
      }, NOW_DATE))
    );
    assert.deepEqual(new Set(burst.map((entry) => entry.attempt.attemptId)).size, 1);
    assert.equal(await count(db, "assessment_attempts", "case_id=$1", [offering.caseId]), 1);
    assert.equal(await count(db, "generated_assessment_forms", "case_id=$1", [offering.caseId]), 1);
    assert.equal(await count(db, "assurance_case_timeline_events", "case_id=$1 AND event_type='assessment_attempt_started'", [offering.caseId]), 1);
  } finally {
    await db.close();
  }
});

test("M2.07 begin fails closed for wrong role, revoked session and another Worker's case", async () => {
  const db = await database();
  try {
    const owner = await seedAccount(db, "e");
    const other = await seedAccount(db, "f");
    const revoked = await seedAccount(db, "g", "worker", { revoked: true });
    const admin = await seedAccount(db, "h", "admin");
    const offering = await seedOffering(db, "e", owner.accountId);
    const service = new AssessmentAttemptService(db);

    for (const principal of [other, revoked, admin]) {
      await assert.rejects(
        service.begin(principal, {
          caseId: offering.caseId,
          catalogueVersionId: offering.catalogueVersionId
        }, NOW_DATE),
        AssessmentAttemptAccessError
      );
    }
    assert.equal(await count(db, "assessment_attempts", "case_id=$1", [offering.caseId]), 0);
    const state = await db.query(`SELECT case_status FROM assurance_cases WHERE case_id=$1`, [offering.caseId]);
    assert.equal(state.rows[0].case_status, "Assessment pending");
  } finally {
    await db.close();
  }
});

test("M2.07 forced failure after form generation rolls back form, attempt, case transition, timeline and audits", async () => {
  const db = await database();
  try {
    const worker = await seedAccount(db, "j");
    const offering = await seedOffering(db, "j", worker.accountId);
    const service = new AssessmentAttemptService(db);

    await db.execute(`
      CREATE OR REPLACE FUNCTION m207_reject_attempt_timeline()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'assessment_attempt_started' THEN
          RAISE EXCEPTION 'forced M2.07 timeline failure';
        END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER m207_reject_attempt_timeline_trigger
      BEFORE INSERT ON assurance_case_timeline_events
      FOR EACH ROW EXECUTE FUNCTION m207_reject_attempt_timeline();
    `);

    await assert.rejects(
      service.begin(worker, {
        caseId: offering.caseId,
        catalogueVersionId: offering.catalogueVersionId
      }, NOW_DATE),
      /forced M2\.07 timeline failure/
    );

    assert.equal(await count(db, "generated_assessment_forms", "case_id=$1", [offering.caseId]), 0);
    assert.equal(await count(db, "assessment_attempts", "case_id=$1", [offering.caseId]), 0);
    assert.equal(await count(db, "assurance_case_timeline_events", "case_id=$1 AND event_type='assessment_attempt_started'", [offering.caseId]), 0);
    assert.equal(await count(db, "platform_audit_events", "action_key IN ('assessment.form.generated','assessment.attempt.started')"), 0);
    const state = await db.query(`SELECT case_status FROM assurance_cases WHERE case_id=$1`, [offering.caseId]);
    assert.equal(state.rows[0].case_status, "Assessment pending");
  } finally {
    await db.close();
  }
});
