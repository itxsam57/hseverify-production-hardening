import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_EVIDENCE_REVIEW_RUNTIME_DIST;
assert.ok(runtime, "HSE_EVIDENCE_REVIEW_RUNTIME_DIST is required");
const domainModule = await import(pathToFileURL(join(runtime, "review", "evidence-review-domain.js")).href);
const serviceModule = await import(pathToFileURL(join(runtime, "review", "evidence-review-service.js")).href);
const { EvidenceReviewAccessError, EvidenceReviewConflictError } = domainModule;
const { EvidenceReviewService } = serviceModule;

const MIGRATION = "0034_evidence_verification_queues";
const NOW_DATE = new Date("2026-08-18T01:00:00.000Z");
const NOW = NOW_DATE.toISOString();
const FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test", databaseDriver: "pglite", databaseUrl: null,
  pgliteDataDir: "memory://", releaseSha: "m2-02-evidence-review-runtime-test",
  sessionSecret: "m2-02-evidence-review-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m2-02-evidence-review-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false, authSandboxAccessKey: null,
  demoAuthEnabled: false, demoDataEnabled: false
};
const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;

async function db() {
  const database = await openScriptDatabase(ENV);
  await applyMigrationsThrough(database, ENV.releaseSha, MIGRATION);
  return database;
}

function companyPrincipal(c) {
  return Object.freeze({
    accountId:`account_m202_company_${c}`,
    sessionId:`session_m202_company_${c}`,
    activeRole:"company",
    accountStatus:"active",
    email:`company-m202-${c.toLowerCase()}@example.com`,
    displayName:`M202 Company ${c}`,
    createdAt:NOW,
    lastSeenAt:NOW,
    expiresAt:FUTURE,
    tenantMembership:{
      tenantId:oid("tenant",c), tenantStatus:"active", membershipId:oid("membership",c),
      role:"owner", status:"active", overrides:[]
    },
    authorizedTenantPermission:"company.orders.manage"
  });
}

async function seedVerifier(database, c) {
  const verifier = {
    accountId:`account_m202_verifier_${c}`,
    sessionId:`session_m202_verifier_${c}`,
    email:`verifier-m202-${c.toLowerCase()}@example.com`,
    displayName:`M202 Verifier ${c}`
  };
  await database.query(`INSERT INTO auth_accounts
    (account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
    VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [verifier.accountId,verifier.email,verifier.displayName,"scrypt$16384$8$1$salt$hash",NOW]);
  await database.query(`INSERT INTO auth_account_roles (account_id,role,created_at) VALUES ($1,'verifier',$2)`,[verifier.accountId,NOW]);
  await database.query(`INSERT INTO auth_sessions
    (session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at)
    VALUES ($1,$2,'verifier',$3,$4,$5,$5,$6)`,
    [verifier.sessionId,verifier.accountId,`m202-token-${c}`,`m202-csrf-${c}`,NOW,FUTURE]);
  return Object.freeze({
    ...verifier, activeRole:"verifier", accountStatus:"active", createdAt:NOW,
    lastSeenAt:NOW, expiresAt:FUTURE, tenantMembership:null
  });
}

async function seedCase(database, c, requestedEvidenceChecks=[]) {
  const company = companyPrincipal(c);
  const orderId=oid("assurance_order",c), targetId=oid("assurance_target",c), caseId=oid("assurance_case",c);
  const workerAccountId=`account_m202_worker_${c}`, workerLinkId=oid("company_worker_link",c);
  await database.query(`INSERT INTO assurance_orders
    (order_id,tenant_id,created_by_membership_id,order_name,order_reference,requested_identity_checks,requested_evidence_checks,
     assessment_framework_references,interview_required,order_status,submitted_at,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,$6::jsonb,'[]'::jsonb,FALSE,'SUBMITTED',$7,$7,$7)`,
    [orderId,company.tenantMembership.tenantId,company.tenantMembership.membershipId,`M202 Order ${c}`,`M202-${c}`,JSON.stringify(requestedEvidenceChecks),NOW]);
  await database.query(`INSERT INTO assurance_order_workers
    (target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,'worker','submitted',$6,$6)`,
    [targetId,orderId,company.tenantMembership.tenantId,workerLinkId,workerAccountId,NOW]);
  await database.query(`INSERT INTO assurance_cases
    (case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,'Evidence pending','worker','Submit required evidence.',$7,$7)`,
    [caseId,orderId,targetId,company.tenantMembership.tenantId,workerLinkId,workerAccountId,NOW]);
  return { company, orderId, targetId, caseId, workerAccountId };
}

async function queueObservation(database, c, text="Supervisor directly observed the worker completing the competency safely and independently.") {
  const seeded=await seedCase(database,c);
  const service=new EvidenceReviewService(database);
  const observationId=await service.addSupervisorObservation(seeded.company,{
    caseId:seeded.caseId,
    competencyReference:`COMP-${c}`,
    observedAt:NOW_DATE,
    observationText:text,
    outcome:"demonstrated"
  },NOW_DATE);
  const queued=await service.queueCaseEvidence(seeded.company,seeded.caseId,NOW_DATE);
  assert.equal(queued,1);
  const rows=await database.query(`SELECT task_id,source_version_id,source_record_id,task_status FROM evidence_review_tasks WHERE case_id=$1`,[seeded.caseId]);
  assert.equal(rows.rows.length,1);
  assert.equal(rows.rows[0].source_version_id,observationId);
  assert.equal(rows.rows[0].source_record_id,observationId);
  assert.equal(rows.rows[0].task_status,"QUEUED");
  return {...seeded,service,observationId,taskId:rows.rows[0].task_id};
}

test("M2.02 runtime queues exactly one immutable evidence-version task and advances case ownership",async()=>{
  const database=await db();
  try {
    const x=await queueObservation(database,"A");
    assert.equal(await x.service.queueCaseEvidence(x.company,x.caseId,NOW_DATE),0,"retry must be idempotent for the same exact version");
    const state=await database.query(`SELECT case_status,owner_kind,next_action FROM assurance_cases WHERE case_id=$1`,[x.caseId]);
    assert.equal(state.rows[0].case_status,"Review pending");
    assert.equal(state.rows[0].owner_kind,"reviewer");
    assert.match(state.rows[0].next_action,/verify/i);
  } finally { await database.close(); }
});

test("M2.02 employment review preserves the current leaving-letter secure file on the exact queued version",async()=>{
  const database=await db();
  try {
    const x=await seedCase(database,"P",["employment"]);
    const recordId=oid("worker_evidence_record","P");
    const versionId=oid("worker_evidence_version","P");
    const leavingLetterId=oid("leaving_letter","P");
    const secureFileId=oid("secure_file","P");

    await database.query(`INSERT INTO worker_evidence_records
      (record_id,worker_account_id,record_kind,lifecycle_status,current_version_id,created_at,updated_at)
      VALUES ($1,$2,'employment','active',NULL,$3,$3)`,[recordId,x.workerAccountId,NOW]);
    await database.query(`INSERT INTO worker_evidence_versions
      (version_id,record_id,version_number,revision,version_status,supersedes_version_id,created_at,updated_at,submitted_at)
      VALUES ($1,$2,1,1,'submitted',NULL,$3,$3,$3)`,[versionId,recordId,NOW]);
    await database.query(`INSERT INTO worker_employment_versions
      (version_id,company_name,role_title,duties,country,start_date,end_date,employment_status,end_reason)
      VALUES ($1,'M202 Employer','Safety Officer','Operational safety assurance.','Saudi Arabia','2024-01-01','2026-08-01','ended','Project completed.')`,[versionId]);
    await database.query(`UPDATE worker_evidence_records
      SET current_version_id=$2,lifecycle_status='ended',updated_at=$3 WHERE record_id=$1`,[recordId,versionId,NOW]);
    await database.query(`INSERT INTO worker_employment_leaving_letters
      (leaving_letter_id,employment_record_id,employment_version_id,secure_file_id,display_filename,status,supersedes_leaving_letter_id,created_at,superseded_at)
      VALUES ($1,$2,$3,$4,'leaving-letter.pdf','active',NULL,$5,NULL)`,[leavingLetterId,recordId,versionId,secureFileId,NOW]);

    const service=new EvidenceReviewService(database);
    assert.equal(await service.queueCaseEvidence(x.company,x.caseId,NOW_DATE),1);
    const task=await database.query(`SELECT evidence_kind,source_record_id,source_version_id,secure_file_id
      FROM evidence_review_tasks WHERE case_id=$1`,[x.caseId]);
    assert.equal(task.rows.length,1);
    assert.equal(task.rows[0].evidence_kind,"employment");
    assert.equal(task.rows[0].source_record_id,recordId);
    assert.equal(task.rows[0].source_version_id,versionId);
    assert.equal(task.rows[0].secure_file_id,secureFileId,"Verifier task must retain the active leaving-letter PDF for the exact employment version");
  } finally { await database.close(); }
});

test("M2.02 runtime claim race has exactly one winner and copied assigned IDs are non-enumerating",async()=>{
  const database=await db();
  try {
    const x=await queueObservation(database,"B");
    const a=await seedVerifier(database,"C"), b=await seedVerifier(database,"D");
    const result=await Promise.allSettled([
      x.service.claim(a,x.taskId,NOW_DATE),
      x.service.claim(b,x.taskId,NOW_DATE),
      x.service.claim(a,x.taskId,NOW_DATE),
      x.service.claim(b,x.taskId,NOW_DATE)
    ]);
    assert.equal(result.filter(item=>item.status==="fulfilled").length,1);
    const winner=result.find(item=>item.status==="fulfilled").value.assignedVerifierAccountId;
    const loser=winner===a.accountId?b:a;
    assert.equal(await x.service.findTask(loser,x.taskId),null);
    await assert.rejects(x.service.decide(loser,x.taskId,"APPROVED","Copied task identifiers confer no review authority.",NOW_DATE),EvidenceReviewAccessError);
    const stored=await database.query(`SELECT task_status,assigned_verifier_account_id FROM evidence_review_tasks WHERE task_id=$1`,[x.taskId]);
    assert.equal(stored.rows[0].task_status,"ASSIGNED");
    assert.equal(stored.rows[0].assigned_verifier_account_id,winner);
  } finally { await database.close(); }
});

test("M2.02 runtime conflict declaration releases an assignment and permanently blocks that verifier",async()=>{
  const database=await db();
  try {
    const x=await queueObservation(database,"E");
    const a=await seedVerifier(database,"F"), b=await seedVerifier(database,"G");
    await x.service.claim(a,x.taskId,NOW_DATE);
    const longConflictReason="Prior supervisory relationship with this worker and direct involvement in the evidence collection. ".repeat(15);
    assert.ok(longConflictReason.length>1000&&longConflictReason.length<4000);
    await x.service.declareConflict(a,x.taskId,longConflictReason,NOW_DATE);
    const released=await database.query(`SELECT task_status,assigned_verifier_account_id FROM evidence_review_tasks WHERE task_id=$1`,[x.taskId]);
    assert.equal(released.rows[0].task_status,"QUEUED");
    assert.equal(released.rows[0].assigned_verifier_account_id,null);
    await assert.rejects(x.service.claim(a,x.taskId,NOW_DATE),EvidenceReviewConflictError);
    await x.service.claim(b,x.taskId,NOW_DATE);
    await x.service.decide(b,x.taskId,"APPROVED","Evidence is current, relevant, attributable and sufficient.",NOW_DATE);
    const conflicts=await database.query(`SELECT COUNT(*)::int AS count FROM evidence_review_conflicts WHERE task_id=$1`,[x.taskId]);
    assert.equal(conflicts.rows[0].count,1);
  } finally { await database.close(); }
});

test("M2.02 runtime denies a decision when the exact reviewed source version becomes stale",async()=>{
  const database=await db();
  try {
    const x=await queueObservation(database,"H");
    const verifier=await seedVerifier(database,"I");
    await x.service.claim(verifier,x.taskId,NOW_DATE);
    await database.query(`UPDATE supervisor_observations SET observation_status='superseded',superseded_at=$2 WHERE observation_id=$1`,[x.observationId,NOW]);
    await assert.rejects(x.service.decide(verifier,x.taskId,"APPROVED","This stale version must never be accepted.",NOW_DATE),EvidenceReviewConflictError);
    const decisions=await database.query(`SELECT COUNT(*)::int AS count FROM evidence_review_decisions WHERE task_id=$1`,[x.taskId]);
    assert.equal(decisions.rows[0].count,0);
  } finally { await database.close(); }
});

test("M2.02 runtime allows exactly one terminal decision under concurrency and keeps decision history append-only",async()=>{
  const database=await db();
  try {
    const x=await queueObservation(database,"J");
    const verifier=await seedVerifier(database,"K");
    await x.service.claim(verifier,x.taskId,NOW_DATE);
    const result=await Promise.allSettled(Array.from({length:8},()=>x.service.decide(
      verifier,x.taskId,"APPROVED","Concurrent review attempts must collapse to one terminal decision.",NOW_DATE
    )));
    assert.equal(result.filter(item=>item.status==="fulfilled").length,1);
    assert.equal(result.filter(item=>item.status==="rejected").length,7);
    const decisions=await database.query(`SELECT decision_id,outcome FROM evidence_review_decisions WHERE task_id=$1`,[x.taskId]);
    assert.equal(decisions.rows.length,1);
    assert.equal(decisions.rows[0].outcome,"APPROVED");
    await assert.rejects(database.query(`UPDATE evidence_review_decisions SET reason='tampered' WHERE decision_id=$1`,[decisions.rows[0].decision_id]),error=>error?.code==="55000");
    await assert.rejects(database.query(`DELETE FROM evidence_review_decisions WHERE decision_id=$1`,[decisions.rows[0].decision_id]),error=>error?.code==="55000");
    await assert.rejects(x.service.declareConflict(verifier,x.taskId,"A conflict cannot be declared after a terminal decision.",NOW_DATE),EvidenceReviewAccessError);
    const conflicts=await database.query(`SELECT COUNT(*)::int AS count FROM evidence_review_conflicts WHERE task_id=$1`,[x.taskId]);
    assert.equal(conflicts.rows[0].count,0);
    const state=await database.query(`SELECT case_status,owner_kind,next_action FROM assurance_cases WHERE case_id=$1`,[x.caseId]);
    assert.equal(state.rows[0].case_status,"Assessment pending");
    assert.equal(state.rows[0].owner_kind,"background_job");
    assert.match(state.rows[0].next_action,/policy/i);
  } finally { await database.close(); }
});

test("M2.02 CHANGES_REQUESTED returns the case to the Worker while preserving reviewed-version lineage",async()=>{
  const database=await db();
  try {
    const x=await queueObservation(database,"L");
    const verifier=await seedVerifier(database,"M");
    await x.service.claim(verifier,x.taskId,NOW_DATE);
    await x.service.decide(verifier,x.taskId,"CHANGES_REQUESTED","Observation needs a clearer competency-specific description.",NOW_DATE);
    const task=await database.query(`SELECT task_status,source_version_id FROM evidence_review_tasks WHERE task_id=$1`,[x.taskId]);
    const decision=await database.query(`SELECT outcome,source_version_id FROM evidence_review_decisions WHERE task_id=$1`,[x.taskId]);
    const state=await database.query(`SELECT case_status,owner_kind,next_action FROM assurance_cases WHERE case_id=$1`,[x.caseId]);
    assert.equal(task.rows[0].task_status,"CHANGES_REQUESTED");
    assert.equal(task.rows[0].source_version_id,x.observationId);
    assert.equal(decision.rows[0].outcome,"CHANGES_REQUESTED");
    assert.equal(decision.rows[0].source_version_id,x.observationId);
    assert.equal(state.rows[0].case_status,"Evidence pending");
    assert.equal(state.rows[0].owner_kind,"worker");
    assert.match(state.rows[0].next_action,/correct/i);
  } finally { await database.close(); }
});

test("M2.02 history-preserving rollback and repeat-safe reapply keep review rows intact",async()=>{
  const database=await db();
  try {
    const x=await queueObservation(database,"N");
    const down=readFileSync("database/migrations/0034_evidence_verification_queues.down.sql","utf8");
    const up=readFileSync("database/migrations/0034_evidence_verification_queues.up.sql","utf8");
    await database.execute(down);
    const retainedRelation=await database.query(`SELECT to_regclass('public.evidence_review_tasks') AS relation`);
    assert.equal(retainedRelation.rows[0].relation,"evidence_review_tasks");
    const retainedBefore=await database.query(`SELECT task_id,source_version_id FROM evidence_review_tasks WHERE task_id=$1`,[x.taskId]);
    assert.equal(retainedBefore.rows.length,1);
    assert.equal(retainedBefore.rows[0].source_version_id,x.observationId);
    await database.execute(up);
    const retainedAfter=await database.query(`SELECT task_id,source_version_id FROM evidence_review_tasks WHERE task_id=$1`,[x.taskId]);
    assert.equal(retainedAfter.rows.length,1);
    assert.equal(retainedAfter.rows[0].source_version_id,x.observationId);
  } finally { await database.close(); }
});
