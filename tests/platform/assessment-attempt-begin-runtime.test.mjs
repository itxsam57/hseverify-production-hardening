import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
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
  await applyMigrationsThrough(db, ENV.releaseSha, "0073_assessment_option_order_snapshot");
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

test("Timed begin snapshots approved allowance and expiry denies writes without losing committed responses", async () => {
  const db = await database();
  try {
    await applyMigrationsThrough(db, ENV.releaseSha, "0084_assessment_timeout_submission");
    const worker = await seedAccount(db, "t");
    const foreign = await seedAccount(db, "u");
    const offering = await seedOffering(db, "t", worker.accountId);
    await db.query("INSERT INTO assessment_blueprint_delivery_settings(blueprint_version_id,progression_mode,timing_config_json) VALUES($1,'CONTROLLED_REVIEW',$2::jsonb)",
      [offering.blueprintVersionId,JSON.stringify({mode:"COMBINED",durationSeconds:60})]);
    await db.query("INSERT INTO accessibility_accommodations(accommodation_id,worker_id,accommodation_type,status,case_id,review_reason,reviewed_by_account_id,reviewed_at,approved_adjustment) VALUES('timed-native-accommodation',$1,'extra_time','APPROVED',$2,'Approved test allowance',$1,$3,'{\"timeMultiplier\":1.5}'::jsonb)",
      [worker.accountId,offering.caseId,NOW]);
    await db.query("INSERT INTO assurance_case_accommodation_overlays(overlay_id,accommodation_id,case_id,worker_id,adjustment,approved_by_account_id,approved_at) VALUES('timed-native-overlay','timed-native-accommodation',$1,$2,'{\"timeMultiplier\":1.5}'::jsonb,$2,$3)",
      [offering.caseId,worker.accountId,NOW]);
    const service = new AssessmentAttemptService(db, requestTime => requestTime);
    const first = await service.begin(worker,{caseId:offering.caseId,catalogueVersionId:offering.catalogueVersionId},NOW_DATE);
    const id=first.attempt.attemptId;
    const at = seconds => new Date(NOW_DATE.getTime()+seconds*1000);
    assert.equal(first.timing.remainingSeconds,90);
    assert.equal(first.timing.deadlineAt,at(90).toISOString());
    await assert.rejects(service.getOwnedView(foreign,id,at(1)),AssessmentAttemptAccessError);
    const before = await service.getOwnedView(worker,id,at(20));
    assert.equal(before.timing.remainingSeconds,70);
    const repeated = await service.begin(worker,{caseId:offering.caseId,catalogueVersionId:offering.catalogueVersionId},at(30));
    assert.equal(repeated.timing.deadlineAt,first.timing.deadlineAt);
    const answer = first.currentQuestion.options[0];
    await service.submitCurrentAnswer(worker,{attemptId:id,position:1,answer},at(40),null);
    const saved = (await db.query("SELECT * FROM assessment_attempt_answers WHERE attempt_id=$1",[id])).rows;
    let releaseLock, signalLock;
    const held = new Promise(resolve => { signalLock = resolve; });
    const released = new Promise(resolve => { releaseLock = resolve; });
    const blocker = db.transaction(async transaction => {
      await transaction.query("SELECT attempt_id FROM assessment_attempts WHERE attempt_id=$1 FOR UPDATE",[id]);
      signalLock();
      await released;
    });
    await held;
    let liveTime = at(80);
    const lateService = new AssessmentAttemptService(db, () => liveTime);
    const lateWrite = lateService.saveCurrentDraft(worker,{attemptId:id,position:2,value:answer,expectedRevision:null,mutationKey:"blocked-before-expiry-native-key"},at(80),null);
    liveTime = at(90);
    releaseLock();
    await blocker;
    await assert.rejects(lateWrite,/time.*expired/i);
    console.log("ACTUAL_TIMING_LOCK_WAIT request enters before expiry; real transaction blocks acquisition; fresh post-lock clock denies crossing-deadline write");

    const expired = await service.getOwnedView(worker,id,at(90));
    assert.equal(expired.submitted,true);
    assert.equal(expired.attempt.status,"AUTO_SUBMITTED");
    assert.equal(expired.timing,null);
    assert.equal(expired.currentQuestion,null);
    const denied=[
      service.submitCurrentAnswer(worker,{attemptId:id,position:2,answer},at(90),null),
      service.saveCurrentDraft(worker,{attemptId:id,position:2,value:answer,expectedRevision:null,mutationKey:"expired-native-mutation-key"},at(90),null),
      service.reviseCommittedAnswer(worker,{attemptId:id,position:1,answer},null,at(90)),
      service.setReviewFlag(worker,{attemptId:id,position:1,flagged:true},null,at(90)),
      service.finalizeAssessment(worker,id,null,at(90))
    ];
    for (const result of await Promise.allSettled(denied)) {
      assert.equal(result.status,"rejected");
      assert.ok(["AssessmentAttemptAccessError","AssessmentAttemptConflictError"].includes(result.reason.name));
    }
    assert.deepEqual((await db.query("SELECT * FROM assessment_attempt_answers WHERE attempt_id=$1",[id])).rows,saved);
    assert.equal(await count(db,"assessment_attempt_drafts","attempt_id=$1",[id]),0);
    await assert.rejects(service.interrupt(worker,id,null,{reason:"technical_issue",detail:"Time expired; submission is final."},at(91)));
    await assert.rejects(service.resume(worker,id,null,at(92)));
    assert.equal((await db.query("SELECT status FROM assessment_attempts WHERE attempt_id=$1",[id])).rows[0].status,"AUTO_SUBMITTED");
    await assert.rejects(db.query("UPDATE assessment_attempt_clocks SET deadline_at=deadline_at+interval '1 minute' WHERE attempt_id=$1",[id]),/append-only/i);
    await assert.rejects(db.query("UPDATE assessment_attempt_time_policies SET time_multiplier=2 WHERE attempt_id=$1",[id]),/append-only/i);
    await assert.rejects(db.query("UPDATE assessment_blueprint_delivery_settings SET timing_config_json='{\"mode\":\"COMBINED\",\"durationSeconds\":999}'::jsonb WHERE blueprint_version_id=$1",[offering.blueprintVersionId]),/append-only/i);
    const downSql = await readFile(new URL("../../database/migrations/0083_assessment_timing.down.sql", import.meta.url), "utf8");
    await assert.rejects(db.transaction(transaction => transaction.execute(downSql)), /Cannot remove accepted assessment timing history/);
    assert.equal(await count(db,"assessment_attempt_clocks","attempt_id=$1",[id]),1);
    assert.equal(await count(db,"assessment_attempt_time_policies","attempt_id=$1",[id]),1);
    console.log("ACTUAL_TIMING_ROLLBACK_GUARD populated immutable timing history blocks destructive rollback and retains both records");
    console.log("ACTUAL_COMBINED_TIMING begin approved1.5 allowance90s; reload/rebegin same deadline; expiry exact boundary creates AUTO_SUBMITTED receipt; five writes rejected; answers retained and recovery cannot reopen");
  } finally { await db.close(); }
});

test("Separate section clock starts only on owned advance and cannot reopen or reset a section", async () => {
  const db = await database();
  try {
    await applyMigrationsThrough(db, ENV.releaseSha, "0084_assessment_timeout_submission");
    const worker = await seedAccount(db, "v");
    const offering = await seedOffering(db, "v",worker.accountId);
    await db.query("INSERT INTO assessment_blueprint_delivery_settings(blueprint_version_id,progression_mode,section_config_json,timing_config_json) VALUES($1,'SECTION_REVIEW',$2::jsonb,'{\"mode\":\"SEPARATE\"}'::jsonb)",
      [offering.blueprintVersionId,JSON.stringify([{title:"First",endPosition:1,durationSeconds:60},{title:"Second",endPosition:2,durationSeconds:90}])]);
    const service = new AssessmentAttemptService(db, requestTime => requestTime);
    const first=await service.begin(worker,{caseId:offering.caseId,catalogueVersionId:offering.catalogueVersionId},NOW_DATE);
    const id=first.attempt.attemptId,at=seconds=>new Date(NOW_DATE.getTime()+seconds*1000);
    assert.equal(first.timing.phaseIndex,1);assert.equal(first.timing.remainingSeconds,60);
    assert.equal(await count(db,"assessment_attempt_clocks","attempt_id=$1",[id]),1);
    await service.submitCurrentAnswer(worker,{attemptId:id,position:1,answer:first.currentQuestion.options[0]},at(10),null);
    const outcomes=await Promise.allSettled([service.advanceSection(worker,id,null,at(20)),service.advanceSection(worker,id,null,at(20))]);
    assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
    const advanced=outcomes.find(x=>x.status==="fulfilled").value;
    assert.equal(advanced.timing.phaseIndex,2);assert.equal(advanced.timing.deadlineAt,at(110).toISOString());
    assert.equal(await count(db,"assessment_attempt_clocks","attempt_id=$1",[id]),2);
    await assert.rejects(service.reviseCommittedAnswer(worker,{attemptId:id,position:1,answer:first.currentQuestion.options[0]},null,at(21)),/section.*no longer open/i);
    await service.interrupt(worker,id,null,{reason:"emergency_exit"},at(30));
    const resumed=await service.resume(worker,id,null,at(40));
    assert.equal(resumed.timing.deadlineAt,at(110).toISOString());
    await assert.rejects(service.submitCurrentAnswer(worker,{attemptId:id,position:2,answer:advanced.currentQuestion.options[0]},at(110),null),/time.*expired/i);
    assert.equal(await count(db,"assessment_section_locks","attempt_id=$1",[id]),1);
    console.log("ACTUAL_SEPARATE_TIMING serialized advance starts exactly one second phase; closed section denied; resume preserves110s deadline and expiry denies answer");
  } finally { await db.close(); }
});

test("Timed begin rolls back form, clock and case state when required clock persistence fails", async () => {
  const db = await database();
  try {
    await applyMigrationsThrough(db,ENV.releaseSha,"0084_assessment_timeout_submission");
    const worker=await seedAccount(db,"w"),offering=await seedOffering(db,"w",worker.accountId);
    await db.query("INSERT INTO assessment_blueprint_delivery_settings(blueprint_version_id,progression_mode,timing_config_json) VALUES($1,'STRICT','{\"mode\":\"COMBINED\",\"durationSeconds\":60}'::jsonb)",[offering.blueprintVersionId]);
    await db.execute("CREATE FUNCTION fail_native_clock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'native clock persistence fault'; END $$; CREATE TRIGGER fail_native_clock BEFORE INSERT ON assessment_attempt_clocks FOR EACH ROW EXECUTE FUNCTION fail_native_clock();");
    const service=new AssessmentAttemptService(db,requestTime=>requestTime);
    await assert.rejects(service.begin(worker,{caseId:offering.caseId,catalogueVersionId:offering.catalogueVersionId},NOW_DATE),/native clock persistence fault/);
    for(const table of ["assessment_attempt_clocks","assessment_attempt_time_policies","assessment_attempts","generated_assessment_forms"]) assert.equal(await count(db,table),0);
    assert.equal((await db.query("SELECT case_status FROM assurance_cases WHERE case_id=$1",[offering.caseId])).rows[0].case_status,"Assessment pending");
    assert.equal(await count(db,"platform_audit_events","action_key='assessment.attempt.started'"),0);
    console.log("ACTUAL_TIMING_BEGIN_ROLLBACK required clock fault retains pending case; no form, attempt, clock, policy or completion audit");
  } finally { await db.close(); }
});


test("Timer normalization rejects invalid modes, durations and unbounded section configurations", async () => {
  const settings = await import(pathToFileURL(join(runtime,"assessment-generation","assessment-delivery-settings.js")).href);
  const normalize=settings.normalizeAssessmentDeliverySettings;
  for(const durationSeconds of [0,-1,1.5,86401,NaN,Infinity,"60",null]) {
    assert.throws(()=>normalize({timing:{mode:"COMBINED",durationSeconds}},2),/combined time/i);
  }
  assert.throws(()=>normalize({timing:{mode:"forged"}},2),/timing mode/i);
  assert.throws(()=>normalize({timing:{mode:"SEPARATE"}},2),/separate timers/i);
  assert.throws(()=>normalize({progressionMode:"SECTION_REVIEW",sections:[{title:"One",endPosition:2}],timing:{mode:"SEPARATE"}},2),/duration/i);
  assert.equal(normalize(undefined,2).timing,null);
});

test("Timed begin schedules durable expiry and the actual worker auto-submits exactly once", async () => {
  const db = await database();
  try {
    await applyMigrationsThrough(db, ENV.releaseSha, "0084_assessment_timeout_submission");
    const worker = await seedAccount(db, "z");
    const offering = await seedOffering(db, "z", worker.accountId);
    await db.query(
      "INSERT INTO assessment_blueprint_delivery_settings(blueprint_version_id,progression_mode,timing_config_json) VALUES($1,'CONTROLLED_REVIEW',$2::jsonb)",
      [offering.blueprintVersionId, JSON.stringify({mode:"COMBINED",durationSeconds:60})]
    );
    const service = new AssessmentAttemptService(db, requestTime => requestTime);
    const first = await service.begin(worker, {
      caseId:offering.caseId,catalogueVersionId:offering.catalogueVersionId
    }, NOW_DATE);
    const jobs = (await db.query(
      "SELECT * FROM platform_outbox_jobs WHERE job_type='assessment.attempt.expiry'"
    )).rows;
    assert.equal(jobs.length, 1, "Timed begin must atomically schedule durable expiry");
    assert.equal(jobs[0].payload.attemptRef, first.attempt.attemptId);
    assert.equal(new Date(jobs[0].next_attempt_at).toISOString(), first.timing.deadlineAt);
    await service.begin(worker, {
      caseId:offering.caseId,catalogueVersionId:offering.catalogueVersionId
    }, NOW_DATE);
    assert.equal(await count(db,"platform_outbox_jobs","job_type='assessment.attempt.expiry'"),1);
    const { processNextOutboxJob } = await import(
      pathToFileURL(join(runtime,"outbox","outbox-worker.js")).href
    );
    const { DatabaseOutboxRepository } = await import(
      pathToFileURL(join(runtime,"outbox","outbox-repository.js")).href
    );
    const result = await processNextOutboxJob({
      database:db,repository:new DatabaseOutboxRepository(Promise.resolve(db))
    });
    assert.equal(result.status,"succeeded");
    const receipt = await service.getOwnedView(worker,first.attempt.attemptId,new Date(NOW_DATE.getTime()+60000));
    assert.equal(receipt.submitted,true);
    assert.equal(receipt.attempt.status,"AUTO_SUBMITTED");
    assert.equal(await count(db,"assessment_attempt_answers","attempt_id=$1",[first.attempt.attemptId]),0);
    assert.equal(await count(db,"platform_audit_events",
      "action_key='assessment.attempt.submitted' AND target_reference=$1",[first.attempt.attemptId]),1);
    const audit = (await db.query(
      "SELECT actor_account_id,actor_role,metadata FROM platform_audit_events WHERE action_key='assessment.attempt.submitted' AND target_reference=$1",
      [first.attempt.attemptId]
    )).rows[0];
    assert.equal(audit.actor_account_id,null);
    assert.equal(audit.actor_role,null);
    assert.equal(audit.metadata.systemComponent,"outbox-worker");
    assert.equal(await processNextOutboxJob({
      database:db,repository:new DatabaseOutboxRepository(Promise.resolve(db))
    }),null);
  } finally { await db.close(); }
});

test("Expiry retries required audit failures and preserves valid saved drafts exactly once", async () => {
  const db = await database();
  try {
    await applyMigrationsThrough(db,ENV.releaseSha,"0084_assessment_timeout_submission");
    const worker = await seedAccount(db,"k");
    const offering = await seedOffering(db,"k",worker.accountId);
    await db.query(
      "INSERT INTO assessment_blueprint_delivery_settings(blueprint_version_id,progression_mode,timing_config_json) VALUES($1,'CONTROLLED_REVIEW',$2::jsonb)",
      [offering.blueprintVersionId,JSON.stringify({mode:"COMBINED",durationSeconds:60})]
    );
    const service = new AssessmentAttemptService(db,requestTime => requestTime);
    const first = await service.begin(worker,{
      caseId:offering.caseId,catalogueVersionId:offering.catalogueVersionId
    },NOW_DATE);
    const draftValue = first.currentQuestion.options[0];
    await service.saveCurrentDraft(worker,{
      attemptId:first.attempt.attemptId,position:1,value:draftValue,
      expectedRevision:null,mutationKey:"timeout-saved-draft-before-deadline"
    },new Date(NOW_DATE.getTime()+20000),null);
    let rejectAudit = true;
    function faultClient(client) {
      return {
        query(statement,parameters) {
          if (rejectAudit && statement.includes("INSERT INTO platform_audit_events") &&
              parameters?.[5] === "assessment.attempt.submitted") {
            throw new Error("Required expiry audit persistence failed.");
          }
          return client.query(statement,parameters);
        },
        execute:statement => client.execute(statement),
        close:() => client.close(),
        transaction:operation => client.transaction(transaction => operation(faultClient(transaction)))
      };
    }
    const {processNextOutboxJob} = await import(pathToFileURL(join(runtime,"outbox","outbox-worker.js")).href);
    const {DatabaseOutboxRepository} = await import(pathToFileURL(join(runtime,"outbox","outbox-repository.js")).href);
    const repository = new DatabaseOutboxRepository(Promise.resolve(db));
    const failed = await processNextOutboxJob({database:faultClient(db),repository});
    assert.equal(failed.status,"retry_wait");
    assert.equal((await db.query("SELECT status FROM assessment_attempts WHERE attempt_id=$1",[first.attempt.attemptId])).rows[0].status,"IN_PROGRESS");
    assert.equal(await count(db,"assessment_attempt_answers","attempt_id=$1",[first.attempt.attemptId]),0);
    assert.equal(await count(db,"assessment_attempt_drafts","attempt_id=$1",[first.attempt.attemptId]),1);
    assert.equal(await count(db,"platform_audit_events","action_key='assessment.attempt.submitted' AND target_reference=$1",[first.attempt.attemptId]),0);
    rejectAudit = false;
    await db.query("UPDATE platform_outbox_jobs SET next_attempt_at=CURRENT_TIMESTAMP-interval '1 second' WHERE job_id=$1",[failed.jobId]);
    const retried = await processNextOutboxJob({database:faultClient(db),repository});
    assert.equal(retried.status,"succeeded");
    assert.equal(retried.attemptCount,2);
    const answers = (await db.query("SELECT position,text_value FROM assessment_attempt_answers WHERE attempt_id=$1",[first.attempt.attemptId])).rows;
    assert.deepEqual(answers,[{position:1,text_value:draftValue}]);
    assert.equal(await count(db,"platform_audit_events","action_key='assessment.attempt.submitted' AND target_reference=$1",[first.attempt.attemptId]),1);
    assert.equal(await processNextOutboxJob({database:db,repository}),null);
  } finally { await db.close(); }
});

for (const late of [false,true]) {
  test(`Separate expiry catches up immutable deadlines without granting fresh time: ${late}`, async () => {
    const db = await database();
    try {
      await applyMigrationsThrough(db,ENV.releaseSha,"0084_assessment_timeout_submission");
      const worker = await seedAccount(db,"j");
      const offering = await seedOffering(db,"j",worker.accountId);
      await db.query(
        "INSERT INTO assessment_blueprint_delivery_settings(blueprint_version_id,progression_mode,section_config_json,timing_config_json) VALUES($1,'SECTION_REVIEW',$2::jsonb,$3::jsonb)",
        [offering.blueprintVersionId,JSON.stringify([
          {title:"First",endPosition:1,durationSeconds:60},
          {title:"Second",endPosition:2,durationSeconds:90}
        ]),JSON.stringify({mode:"SEPARATE"})]
      );
      const service = new AssessmentAttemptService(db,requestTime => requestTime);
      const first = await service.begin(worker,{
        caseId:offering.caseId,catalogueVersionId:offering.catalogueVersionId
      },NOW_DATE);
      assert.equal(await count(db,"platform_outbox_jobs","job_type='assessment.attempt.expiry'"),2);
      const advanced = await service.getOwnedView(worker,first.attempt.attemptId,
        new Date(NOW_DATE.getTime()+(late ? 151 : 60)*1000));
      if (late) assert.equal(advanced.submitted,true);
      else {
        assert.equal(advanced.submitted,false);
        assert.equal(advanced.attempt.currentPosition,2);
        assert.equal(advanced.timing.deadlineAt,new Date(NOW_DATE.getTime()+150000).toISOString());
        assert.equal(advanced.timing.remainingSeconds,90);
        const final = await service.getOwnedView(worker,first.attempt.attemptId,new Date(NOW_DATE.getTime()+150000));
        assert.equal(final.attempt.status,"AUTO_SUBMITTED");
      }
      const clocks = (await db.query(
        "SELECT phase_index,started_at,deadline_at FROM assessment_attempt_clocks WHERE attempt_id=$1 ORDER BY phase_index",
        [first.attempt.attemptId]
      )).rows;
      assert.equal(clocks.length,2);
      assert.equal(new Date(clocks[1].started_at).toISOString(),new Date(NOW_DATE.getTime()+60000).toISOString());
      assert.equal(new Date(clocks[1].deadline_at).toISOString(),new Date(NOW_DATE.getTime()+150000).toISOString());
      assert.equal(await count(db,"assessment_attempt_answers","attempt_id=$1",[first.attempt.attemptId]),0);
      assert.equal(await count(db,"assessment_section_locks","attempt_id=$1",[first.attempt.attemptId]),2);
      assert.equal(await count(db,"platform_audit_events","action_key='assessment.attempt.submitted' AND target_reference=$1",[first.attempt.attemptId]),1);
    } finally { await db.close(); }
  });
}

test("A separate real worker process submits the durable attempt after the producer database closes", async () => {
  const directory = await mkdtemp(join(tmpdir(),"hse-expiry-process-"));
  let db = await openScriptDatabase({...ENV,pgliteDataDir:directory});
  try {
    await applyMigrationsThrough(db,ENV.releaseSha,"0084_assessment_timeout_submission");
    const worker = await seedAccount(db,"p");
    const offering = await seedOffering(db,"p",worker.accountId);
    await db.query(
      "INSERT INTO assessment_blueprint_delivery_settings(blueprint_version_id,progression_mode,timing_config_json) VALUES($1,'CONTROLLED_REVIEW',$2::jsonb)",
      [offering.blueprintVersionId,JSON.stringify({mode:"COMBINED",durationSeconds:60})]
    );
    const first = await new AssessmentAttemptService(db,requestTime => requestTime).begin(worker,{
      caseId:offering.caseId,catalogueVersionId:offering.catalogueVersionId
    },NOW_DATE);
    await db.close(); db = null;
    const build = spawnSync(process.execPath,["scripts/build-outbox-worker.mjs"],{encoding:"utf8",timeout:30000});
    assert.equal(build.status,0,build.stderr);
    const child = spawnSync(process.execPath,["scripts/run-outbox-worker.mjs","--once"],{
      encoding:"utf8",timeout:30000,
      env:{...process.env,HSE_APP_ENV:"test",HSE_DATABASE_DRIVER:"pglite",
        HSE_PGLITE_DATA_DIR:directory,HSE_SESSION_SECRET:ENV.sessionSecret,HSE_AUTH_PEPPER:ENV.authPepper,
        HSE_ENABLE_AUTH_SANDBOX:"false",HSE_ENABLE_WORKER_DEMO_AUTH:"false",
        HSE_USE_WORKER_DEMO_DATA:"false",HSE_RELEASE_SHA:ENV.releaseSha}
    });
    assert.equal(child.status,0,child.stderr);
    assert.deepEqual(JSON.parse(child.stdout.trim()),{processed:1,status:"succeeded"});
    db = await openScriptDatabase({...ENV,pgliteDataDir:directory});
    assert.equal((await db.query("SELECT status FROM assessment_attempts WHERE attempt_id=$1",[first.attempt.attemptId])).rows[0].status,"AUTO_SUBMITTED");
    assert.equal(await count(db,"assessment_attempt_answers","attempt_id=$1",[first.attempt.attemptId]),0);
    assert.equal(await count(db,"platform_audit_events","action_key='assessment.attempt.submitted' AND target_reference=$1",[first.attempt.attemptId]),1);
  } finally { await db?.close(); await rm(directory,{recursive:true,force:true}); }
});

test("Browser interruption cannot bypass the immutable expiry outcome", async () => {
  const db = await database();
  try {
    await applyMigrationsThrough(db,ENV.releaseSha,"0084_assessment_timeout_submission");
    const worker = await seedAccount(db,"q");
    const offering = await seedOffering(db,"q",worker.accountId);
    await db.query(
      "INSERT INTO assessment_blueprint_delivery_settings(blueprint_version_id,progression_mode,timing_config_json) VALUES($1,'CONTROLLED_REVIEW',$2::jsonb)",
      [offering.blueprintVersionId,JSON.stringify({mode:"COMBINED",durationSeconds:60})]
    );
    const service = new AssessmentAttemptService(db,requestTime => requestTime);
    const first = await service.begin(worker,{
      caseId:offering.caseId,catalogueVersionId:offering.catalogueVersionId
    },NOW_DATE);
    await service.interrupt(worker,first.attempt.attemptId,null,{reason:"browser_closed",detail:"Browser closed before the deadline."},new Date(NOW_DATE.getTime()+30000));
    const {processNextOutboxJob} = await import(pathToFileURL(join(runtime,"outbox","outbox-worker.js")).href);
    const {DatabaseOutboxRepository} = await import(pathToFileURL(join(runtime,"outbox","outbox-repository.js")).href);
    const result = await processNextOutboxJob({database:db,repository:new DatabaseOutboxRepository(Promise.resolve(db))});
    assert.equal(result.status,"succeeded");
    assert.equal((await db.query("SELECT status FROM assessment_attempts WHERE attempt_id=$1",[first.attempt.attemptId])).rows[0].status,"AUTO_SUBMITTED");
    assert.equal(await count(db,"assessment_interruption_events","attempt_id=$1",[first.attempt.attemptId]),1);
    assert.equal(await count(db,"assessment_attempt_answers","attempt_id=$1",[first.attempt.attemptId]),0);
  } finally { await db.close(); }
});

test("Forward migration reconciles legacy immutable clocks with truthful system expiry intent", async () => {
  const db = await database();
  try {
    await applyMigrationsThrough(db,ENV.releaseSha,"0083_assessment_timing");
    const worker = await seedAccount(db,"w");
    const offering = await seedOffering(db,"w",worker.accountId);
    // Persisted legacy fixture: form/attempt from real begin, old immutable clock rows.
    const first = await new AssessmentAttemptService(db,requestTime => requestTime).begin(worker,{
      caseId:offering.caseId,catalogueVersionId:offering.catalogueVersionId
    },NOW_DATE);
    await db.query(
      "INSERT INTO assessment_blueprint_delivery_settings(blueprint_version_id,progression_mode,timing_config_json) VALUES($1,'CONTROLLED_REVIEW',$2::jsonb)",
      [offering.blueprintVersionId,JSON.stringify({mode:"COMBINED",durationSeconds:60})]
    );
    await db.query(
      "INSERT INTO assessment_attempt_time_policies(attempt_id,blueprint_version_id,timing_mode,time_multiplier,phase_durations_json,snapshotted_at) VALUES($1,$2,'COMBINED',1,'[60]'::jsonb,$3)",
      [first.attempt.attemptId,offering.blueprintVersionId,NOW]
    );
    const deadline = new Date(NOW_DATE.getTime()+60000).toISOString();
    await db.query("INSERT INTO assessment_attempt_clocks(attempt_id,phase_index,started_at,deadline_at) VALUES($1,0,$2,$3)",[first.attempt.attemptId,NOW,deadline]);
    await applyMigrationsThrough(db,ENV.releaseSha,"0084_assessment_timeout_submission");
    const jobs = (await db.query("SELECT * FROM platform_outbox_jobs WHERE job_type='assessment.attempt.expiry'")).rows;
    assert.equal(jobs.length,1,"Existing timers must receive background expiry work");
    assert.equal(new Date(jobs[0].next_attempt_at).toISOString(),deadline);
    assert.equal(jobs[0].enqueued_by_account_id,null);
    assert.equal(jobs[0].enqueued_by_role,null);
    assert.equal(jobs[0].enqueued_system_component,"outbox-worker");
    const {processNextOutboxJob} = await import(pathToFileURL(join(runtime,"outbox","outbox-worker.js")).href);
    const {DatabaseOutboxRepository} = await import(pathToFileURL(join(runtime,"outbox","outbox-repository.js")).href);
    const result = await processNextOutboxJob({database:db,repository:new DatabaseOutboxRepository(Promise.resolve(db))});
    assert.equal(result.status,"succeeded");
    assert.equal((await db.query("SELECT status FROM assessment_attempts WHERE attempt_id=$1",[first.attempt.attemptId])).rows[0].status,"AUTO_SUBMITTED");
    assert.equal(new Date((await db.query("SELECT deadline_at FROM assessment_attempt_clocks WHERE attempt_id=$1",[first.attempt.attemptId])).rows[0].deadline_at).toISOString(),deadline);
  } finally { await db.close(); }
});

 test("Expiry migration restores empty schemas and rejects missing enqueue origins", async () => {
  const db = await database();
  try {
    await applyMigrationsThrough(db,ENV.releaseSha,"0084_assessment_timeout_submission");
    const constraint = (await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='platform_outbox_enqueue_origin'")).rows[0].definition;
    assert.match(constraint,/enqueued_system_component IS NOT NULL/);
    await assert.rejects(db.query("INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,enqueued_by_account_id,enqueued_by_role) VALUES('job_missing_origin','assessment.attempt.expiry',1,$1,'{}'::jsonb,NULL,NULL)",["a".repeat(64)]),/platform_outbox_enqueue_origin/);

    await db.execute(await readFile("database/migrations/0084_assessment_timeout_submission.down.sql","utf8"));
    assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='platform_outbox_jobs' AND column_name='enqueued_system_component'")).rows.length,0);
    await db.execute(await readFile("database/migrations/0084_assessment_timeout_submission.up.sql","utf8"));
    assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='platform_outbox_jobs' AND column_name='enqueued_system_component'")).rows.length,1);
  } finally { await db.close(); }
});

const {loadWrittenScoringRuntime}=await import("../helpers/written-scoring-runtime-loader.mjs");
const {WrittenScoringService}=await loadWrittenScoringRuntime();
test("Assigned review projects all pinned questions including unanswered items",async()=>{
 const db=await database();
 try {
  await applyMigrationsThrough(db,ENV.releaseSha,"0084_assessment_timeout_submission");
  const worker=await seedAccount(db,"z");const verifier=await seedAccount(db,"z","verifier");
  const offering=await seedOffering(db,"z",worker.accountId);
  await db.query("INSERT INTO assessment_blueprint_delivery_settings(blueprint_version_id,progression_mode,timing_config_json) VALUES($1,'CONTROLLED_REVIEW',$2::jsonb)",[offering.blueprintVersionId,JSON.stringify({mode:"COMBINED",durationSeconds:60})]);
  const service=new AssessmentAttemptService(db,t=>t);
  const first=await service.begin(worker,{caseId:offering.caseId,catalogueVersionId:offering.catalogueVersionId},NOW_DATE);
  await service.saveCurrentDraft(worker,{attemptId:first.attempt.attemptId,position:1,value:first.currentQuestion.options[0],expectedRevision:null,mutationKey:"review-source-draft-before-deadline"},new Date(NOW_DATE.getTime()+10000),null);
  await service.getOwnedView(worker,first.attempt.attemptId,new Date(NOW_DATE.getTime()+60000));
  const reviews=await new WrittenScoringService(db).listReviewQueue({reviewerAccountId:verifier.accountId});
  assert.equal(reviews.length,1,"Real timeout producer must queue assigned review");
  assert.equal(reviews[0].questions.length,2,"Assigned review must include all pinned prompts, retained answers and explicit unanswered items");
  assert.equal(reviews[0].questions[0].answered,true);
  assert.equal(reviews[0].questions[0].response,first.currentQuestion.options[0]);
  assert.equal(reviews[0].questions[1].answered,false);
  assert.equal(reviews[0].questions[1].response,null);
  assert.match(reviews[0].questions[1].prompt,/pinned prompt/);
  assert.deepEqual(await new WrittenScoringService(db).listReviewQueue({reviewerAccountId:"foreign-reviewer"}),[]);
 }finally{await db.close();}
});
