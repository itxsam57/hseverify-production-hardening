import assert from "node:assert/strict";
import test from "node:test";
import {policyInterview} from "../helpers/interview-policy-fixture.mjs";
import {fundingPrincipal} from "../helpers/assessment-funding-fixture.mjs";
import {authorizeReviewFixture} from "../helpers/evidence-review-calibration-fixture.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";

const {WorkerEvidenceService}=loadWorkerRegistrationTs("src/lib/worker-evidence/worker-evidence-service.ts");
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {DatabaseNotificationRepository}=loadWorkerRegistrationTs("src/lib/notifications/notification-repository.ts");
const {projectAssuranceEventNotification}=loadWorkerRegistrationTs("src/lib/notifications/assurance-event-notification-projector.ts");
const {resolveNotificationHref}=loadWorkerRegistrationTs("src/lib/notifications/notification-domain.ts");
const {bindPlatformAuditReadPrincipal}=loadWorkerRegistrationTs("src/lib/audit/audit-domain.ts");

async function fixture() {
  const x=await policyInterview({policy:null,start:false,claim:false,
    credentialTarget:"Controlled skill review notification proof"});
  await x.database.close();
  x.database=await openScriptDatabase({databaseDriver:"pglite",
    pgliteDataDir:x.fixture.environment.HSE_PGLITE_DATA_DIR});
  const originalCleanup=x.fixture.cleanup;
  return {...x,cleanup:async()=>{await x.database.close();await originalCleanup();}};
}

async function retainedEvent(db,admin,type,decisionId) {
  const ref="review:"+decisionId;
  const rows=(await db.query("SELECT job_id FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'=$1 AND payload->>'eventRef'=$2",[type,ref])).rows;
  assert.equal(rows.length,1,"Exactly one notification intent must be produced by this skill decision");
  const email=(await db.query("SELECT count(*)::int AS n FROM platform_outbox_jobs WHERE job_type='email.assurance.event' AND payload->>'eventType'=$1 AND payload->>'eventRef'=$2",[type,ref])).rows[0];
  assert.ok(email.n>=1,"No real email provider acceptance is inferred, but the outbox intent must persist");
  const repo=new DatabaseOutboxRepository(Promise.resolve(db));
  return repo.findPlatformById(bindPlatformAuditReadPrincipal({...admin,
    authorizedPlatformPermission:"platform.security.read"}),rows[0].job_id);
}

async function skillRevision(evidence,worker,recordId,expectedRevision,proficiency) {
  const saved=await evidence.saveSkillDraft(worker,{
    recordId,expectedRevision,skillName:"Permit to Work",
    category:"Safety systems",proficiencyClaim:proficiency,
    experienceMonths:48,relatedTrade:"HSE"
  });
  return evidence.submit(worker,recordId,saved.currentVersion.revision);
}

test("M1.11.03 actual skill CHANGES v1 and APPROVED corrected v2 project Worker-only immutable deep links, deny foreign and replay",async()=>{
  const x=await fixture();
  try{
    const db=x.database;
    const worker=await fundingPrincipal(db,x.fixture.credentials.worker);
    const verifier=await fundingPrincipal(db,x.fixture.credentials.verifier,"verifier");
    const evidence=new WorkerEvidenceService(Promise.resolve(db));
    const reviews=new EvidenceReviewService(db);
    const noticeRepo=new DatabaseNotificationRepository(Promise.resolve(db));

    const draft=await evidence.createDraft(worker,"skill");
    const v1=await skillRevision(evidence,worker,draft.recordId,draft.currentVersion.revision,"Experienced");
    const first=await reviews.queueIndependentWorkerEvidence(worker,v1.recordId);
    await authorizeReviewFixture(db,{taskId:first.taskId,verifiers:[verifier],at:new Date()});
    await reviews.claim(verifier,first.taskId);
    await reviews.decide(verifier,first.taskId,"CHANGES_REQUESTED","Please attach a more recent Permit to Work skills record.");
    const d1=(await db.query("SELECT decision_id,outcome,source_version_id FROM evidence_review_decisions WHERE task_id=$1",[first.taskId])).rows[0];
    assert.equal(d1.outcome,"CHANGES_REQUESTED");
    assert.equal(d1.source_version_id,v1.currentVersion.versionId);
    const j1=await retainedEvent(db,x.admin,"evidence.additional.requested",d1.decision_id);
    assert.deepEqual(await projectAssuranceEventNotification(j1,db),{kind:"succeeded"});
    assert.deepEqual(await projectAssuranceEventNotification(j1,db),{kind:"succeeded"});
    const n1=(await noticeRepo.listForPrincipal(worker)).find(n=>n.sourceJobId===j1.jobId);
    assert.ok(n1,"Worker must receive actual independent skill correction notice");
    assert.equal(n1.title,"Additional evidence requested");
    assert.equal(resolveNotificationHref({role:"worker",target:n1.target,targetReference:n1.targetReference}),
      "/worker/evidence#"+v1.recordId);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_notifications WHERE source_job_id=$1",[j1.jobId])).rows[0].n,1);
    console.log("M11103_SKILL_NOTICE_WORKER_CHANGES_REQUESTED_V1_DEEP_LINK_AND_SINGLE_PROJECTION");

    await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'worker') ON CONFLICT DO NOTHING",[x.fixture.credentials.assessor.accountId]);
    const foreign=await fundingPrincipal(db,x.fixture.credentials.assessor,"worker");
    assert.notEqual(foreign.accountId,worker.accountId);
    assert.equal(await noticeRepo.findForPrincipal(foreign,n1.notificationId),null);
    assert.equal(await noticeRepo.findForPrincipal(verifier,n1.notificationId),null);
    assert.equal(await noticeRepo.markReadForPrincipal(foreign,n1.notificationId),null);
    assert.equal((await noticeRepo.markReadForPrincipal(worker,n1.notificationId)).changed,true);
    assert.equal((await noticeRepo.markReadForPrincipal(worker,n1.notificationId)).changed,false);
    console.log("M11103_SKILL_NOTICE_FOREIGN_WORKER_VERIFIER_DIRECT_NOTICE_AND_MARK_READ_DENIED");

    const revision=await evidence.startRevision(worker,v1.recordId,v1.currentVersion.revision);
    const v2=await skillRevision(evidence,worker,v1.recordId,revision.currentVersion.revision,
      "Advanced, current observed competence");
    assert.notEqual(v2.currentVersion.versionId,v1.currentVersion.versionId);
    const second=await reviews.queueIndependentWorkerEvidence(worker,v2.recordId);
    assert.notEqual(second.taskId,first.taskId);
    await authorizeReviewFixture(db,{taskId:second.taskId,verifiers:[verifier],at:new Date()});
    await reviews.claim(verifier,second.taskId);
    await reviews.decide(verifier,second.taskId,"APPROVED","Independent corrected skill evidence verified against current submitted version.");
    const d2=(await db.query("SELECT decision_id,outcome,source_version_id FROM evidence_review_decisions WHERE task_id=$1",[second.taskId])).rows[0];
    assert.equal(d2.outcome,"APPROVED");
    assert.equal(d2.source_version_id,v2.currentVersion.versionId);
    const j2=await retainedEvent(db,x.admin,"evidence.reviewed",d2.decision_id);
    assert.notEqual(j2.jobId,j1.jobId);
    assert.deepEqual(await projectAssuranceEventNotification(j2,db),{kind:"succeeded"});
    assert.deepEqual(await projectAssuranceEventNotification(j2,db),{kind:"succeeded"});
    const n2=(await noticeRepo.listForPrincipal(worker)).find(n=>n.sourceJobId===j2.jobId);
    assert.ok(n2,"Corrected skill approval must return to the same Worker");
    assert.equal(n2.title,"Evidence review recorded");
    assert.equal(resolveNotificationHref({role:"worker",target:n2.target,targetReference:n2.targetReference}),
      "/worker/evidence#"+v2.recordId);
    assert.equal(await noticeRepo.findForPrincipal(foreign,n2.notificationId),null);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_notifications WHERE source_job_id=$1",[j2.jobId])).rows[0].n,1);
    console.log("M11103_SKILL_NOTICE_WORKER_APPROVED_V2_DEEP_LINK_AND_SINGLE_PROJECTION");

    const versions=(await db.query("SELECT version_id,version_number,version_status FROM worker_evidence_versions WHERE record_id=$1 ORDER BY version_number",[v1.recordId])).rows;
    assert.equal(versions.length,2);
    assert.deepEqual(versions.map(v=>v.version_number),[1,2]);
    assert.equal(versions[0].version_status,"superseded");
    assert.equal(versions[1].version_status,"submitted");
    assert.deepEqual([d1.source_version_id,d2.source_version_id],versions.map(v=>v.version_id));
    assert.equal((await db.query("SELECT current_version_id FROM worker_evidence_records WHERE record_id=$1",[v1.recordId])).rows[0].current_version_id,versions[1].version_id);
    await assert.rejects(()=>projectAssuranceEventNotification({...j2,idempotencyKey:"0".repeat(64)},db),/retained source/);
    await assert.rejects(()=>db.query("UPDATE platform_notifications SET body='forged' WHERE notification_id=$1",[n2.notificationId]),/immutable/);
    console.log("M11103_SKILL_NOTICE_TWO_IMMUTABLE_VERSIONS_TWO_BOUND_DECISIONS_FORGED_REPLAY_DENIED");
  }finally{await x.cleanup();}
});
