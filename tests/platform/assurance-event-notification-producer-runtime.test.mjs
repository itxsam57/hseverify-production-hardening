import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import { policyInterview } from "../helpers/interview-policy-fixture.mjs";
import { fundingPrincipal, assessmentFundingFixture } from "../helpers/assessment-funding-fixture.mjs";
import { seedPermanentWorkerId } from "../helpers/permanent-worker-id-fixture.mjs";
import { loadWorkerRegistrationTs, setWorkerRegistrationRuntimeEnvironment } from "../helpers/worker-registration-runtime-loader.mjs";
import { PGlite } from "@electric-sql/pglite";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";

const { WorkerEvidenceService } = loadWorkerRegistrationTs("src/lib/worker-evidence/worker-evidence-service.ts");
const { EvidenceReviewService } = loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const { DecisionRepository } = loadWorkerRegistrationTs("src/lib/decision/decision-engine-repository.ts");
const { createDecision } = loadWorkerRegistrationTs("src/lib/decision/decision-engine-domain.ts");
const { CredentialAppealsService } = loadWorkerRegistrationTs("src/lib/credential/credential-appeals-service.ts");
const { WorkerAssessmentApplicationService } = loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const SIGNING = "assurance-notification-owned-signing-fixture-more-than32";

async function notificationFixture() {
  const x = await policyInterview({policy:null,start:false,claim:false,credentialTarget:"Controlled assurance notification"});
  await x.database.close();
  // Use the existing real nested-transaction adapter for the original decision/credential/appeal producers.
  x.database = await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:x.fixture.environment.HSE_PGLITE_DATA_DIR});
  x.cleanup = async () => {await x.database.close();await x.fixture.cleanup();};
  return x;
}
async function submittedExperience(x) {
  const worker = await fundingPrincipal(x.database, x.fixture.credentials.worker);
  const service = new WorkerEvidenceService(Promise.resolve(x.database));
  const draft = await service.createDraft(worker, "experience");
  const saved = await service.saveExperienceDraft(worker, {
    recordId: draft.recordId, expectedRevision: draft.currentVersion.revision,
    companyName: "Controlled notification fixture", roleTitle: "Safety officer",
    duties: "Review hazards and maintain safe work controls.", country: "GB",
    startDate: "2025-01-01", endDate: null, status: "current"
  });
  return {worker, record: await service.submit(worker, saved.recordId, saved.currentVersion.revision)};
}
async function requireJobs(database, eventType, eventRef, {emailOnly = false} = {}) {
  const jobs = (await database.query(
    "SELECT job_type,payload FROM platform_outbox_jobs WHERE job_type IN ('notification.assurance.event','email.assurance.event') AND payload->>'eventType'=$1 AND payload->>'eventRef'=$2",
    [eventType,eventRef]
  )).rows;
  if (!emailOnly) assert.equal(jobs.filter(j => j.job_type === "notification.assurance.event").length, 1,
    "The accepted original " + eventType + " producer must retain exactly one actionable in-app intent.");
  assert.ok(jobs.some(j => j.job_type === "email.assurance.event"),
    "The accepted original " + eventType + " producer must retain an email delivery intent for the eligible next actor.");
}
async function approvedDecision(x) {
  const db = x.database, caseId = x.request.caseId, tenantId = x.fixture.credentials.company.tenantId;
  const workerId = await seedPermanentWorkerId(db, x.fixture.credentials.worker, "n");
  await db.query("UPDATE assurance_cases SET case_status='Decision pending',owner_kind='admin',next_action='Record final decision.',permanent_worker_id=$2 WHERE case_id=$1", [caseId,workerId]);
  const decision = createDecision({tenantId,caseId,state:"APPROVED",reasonCode:"complete",explanation:"Controlled evidence and interview support this decision.",ruleVersion:"notification-fixture",inputReferences:[x.snapshot.snapshotId,x.set.questionSetId],createdAt:new Date().toISOString()});
  await new DecisionRepository(Promise.resolve(db),SIGNING).saveDecisionAndProgressCase(decision,x.admin.accountId);
  const stored = (await db.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[caseId])).rows[0];
  assert.ok(stored.credential_reference);
  return {decision,workerId,credentialId:stored.credential_reference};
}
test("Original Worker evidence submission retains fixed in-app and email intents from its immutable event", async () => {
  const x=await notificationFixture();
  try {
    const {record}=await submittedExperience(x);
    const source=(await x.database.query("SELECT audit_event_id FROM platform_audit_events WHERE action_key='worker_evidence.version.submitted' AND target_reference=$1 ORDER BY audit_sequence DESC LIMIT 1",[record.recordId])).rows[0];
    assert.ok(source);
    await requireJobs(x.database,"evidence.submitted","audit:"+source.audit_event_id);
  } finally {await x.cleanup();}
});
test("Actual additional-evidence review outcome retains its authorized Worker delivery intents", async () => {
  const x=await notificationFixture();
  try {
    const {worker,record}=await submittedExperience(x), service=new EvidenceReviewService(x.database);
    const task=await service.queueIndependentWorkerEvidence(worker,record.recordId);
    const verifier=await fundingPrincipal(x.database,x.fixture.credentials.verifier,"verifier");
    await service.claim(verifier,task.taskId);
    await service.decide(verifier,task.taskId,"CHANGES_REQUESTED","Please provide the missing retained employment dates.");
    const source=(await x.database.query("SELECT decision_id,outcome FROM evidence_review_decisions WHERE task_id=$1",[task.taskId])).rows[0];
    assert.equal(source.outcome,"CHANGES_REQUESTED");
    await requireJobs(x.database,"evidence.additional.requested","review:"+source.decision_id);
  } finally {await x.cleanup();}
});
test("Actual Admin final decision and credential issue retain both original event delivery intents", async () => {
  const x=await notificationFixture();
  try {
    const {credentialId}=await approvedDecision(x);
    const source=(await x.database.query("SELECT timeline_event_id FROM assurance_case_timeline_events WHERE case_id=$1 AND event_type='decision_recorded'",[x.request.caseId])).rows[0];
    assert.ok(source);
    const issuance=(await x.database.query("SELECT version,status FROM credential_issuance_events WHERE credential_id=$1 ORDER BY version",[credentialId])).rows[0];
    assert.equal(issuance.status,"valid");
    await requireJobs(x.database,"decision.recorded","case:"+source.timeline_event_id);
    await requireJobs(x.database,"credential.issued","issuance:"+credentialId+":"+issuance.version);
  } finally {await x.cleanup();}
});
test("Original appeal submission and reasoned review retain next-actor and Worker delivery intents", async () => {
  const x=await notificationFixture();
  try {
    const {credentialId,workerId}=await approvedDecision(x), service=new CredentialAppealsService(Promise.resolve(x.database));
    const appeal=await service.submit({credentialId,workerId,reason:"Please reconsider the retained evidence underlying this assurance outcome.",createdAt:new Date().toISOString()},"notification_fixture");
    const reviewerId="account_notification_independent_appeal";
    await x.database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,email_verified_at,password_hash,password_set_at,created_at,updated_at) SELECT $1,'notification-independent-appeal@example.test','Independent notification appeal reviewer','active',CURRENT_TIMESTAMP,password_hash,password_set_at,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM auth_accounts WHERE account_id=$2",[reviewerId,x.admin.accountId]);
    await x.database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[reviewerId]);
    const review={status:"under_review",reason:"Independent review started against the original retained evidence.",outcomeAction:"none"};
    await assert.rejects(service.reviewOutcome(appeal,{...review,reviewerId:x.admin.accountId}),/independent reviewer outside the original decision/);
    assert.deepEqual((await x.database.query("SELECT status FROM credential_appeal_events WHERE appeal_id=$1 ORDER BY version",[appeal.appealId])).rows.map(r=>r.status),["submitted"]);
    const reviewed=await service.reviewOutcome(appeal,{...review,reviewerId});
    assert.equal(reviewed.appeal.version,2);
    assert.deepEqual((await x.database.query("SELECT status FROM credential_appeal_events WHERE appeal_id=$1 ORDER BY version",[appeal.appealId])).rows.map(r=>r.status),["submitted","under_review"]);
    await requireJobs(x.database,"appeal.submitted","appeal:"+appeal.appealId+":1");
    await requireJobs(x.database,"appeal.updated","appeal:"+appeal.appealId+":2");
  } finally {await x.cleanup();}
});
test("Existing Company funding producer retains email intent alongside its atomic in-app intent", async () => {
  const fixture=await assessmentFundingFixture(), db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try {
    const application=await new WorkerAssessmentApplicationService(db).requestCompanyFunding(fixture.worker,fixture.fundingInput);
    const source=(await db.query("SELECT event_id FROM worker_assessment_application_events WHERE application_id=$1 AND to_status='FUNDING_REQUESTED'",[application.applicationId])).rows[0];
    assert.ok(source);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM platform_outbox_jobs WHERE job_type='notification.assessment.funding' AND payload->>'eventRef'=$1",[source.event_id])).rows[0].count,1);
    await requireJobs(db,"assessment.funding.requested","funding:"+source.event_id,{emailOnly:true});
  } finally {await db.close();await fixture.cleanup();}
});

const {bindPlatformAuditReadPrincipal}=loadWorkerRegistrationTs("src/lib/audit/audit-domain.ts");
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {createTrustedOutboxWorker}=loadWorkerRegistrationTs("src/lib/outbox/outbox-domain.ts");
const {DatabaseNotificationRepository}=loadWorkerRegistrationTs("src/lib/notifications/notification-repository.ts");
const {DatabaseEmailDeliveryRepository}=loadWorkerRegistrationTs("src/lib/email-delivery/email-delivery-repository.ts");
const {projectAssuranceEventNotification}=loadWorkerRegistrationTs("src/lib/notifications/assurance-event-notification-projector.ts");
const {processAssuranceEventEmailJob}=loadWorkerRegistrationTs("src/lib/email-delivery/assurance-event-email-handler.ts");
const {projectInterviewScheduledNotification}=loadWorkerRegistrationTs("src/lib/notifications/interview-notification-projector.ts");
const {processInterviewEmailJob}=loadWorkerRegistrationTs("src/lib/email-delivery/interview-email-handler.ts");
const {resolveNotificationHref}=loadWorkerRegistrationTs("src/lib/notifications/notification-domain.ts");
const {findWorkerAssuranceCase}=loadWorkerRegistrationTs("src/lib/assurance-orders/worker-assurance-case-service.ts");


async function eventJob(x,eventType,jobType="notification.assurance.event"){
 const row=(await x.database.query("SELECT job_id FROM platform_outbox_jobs WHERE job_type=$1 AND payload->>'eventType'=$2 ORDER BY job_sequence LIMIT 1",[jobType,eventType])).rows[0];
 assert.ok(row);
 return new DatabaseOutboxRepository(Promise.resolve(x.database)).findPlatformById(bindPlatformAuditReadPrincipal({...x.admin,authorizedPlatformPermission:"platform.security.read"}),row.job_id);
}
async function acknowledgeResult(repo,lease,result){
 if(result.kind==="succeeded")return repo.succeed(lease);
 if(result.kind==="retryable")return repo.retry(lease,result.failure);
 return repo.terminalFail(lease,result.failure);
}
async function claimEventEmail(x,eventType){
 const repo=new DatabaseOutboxRepository(Promise.resolve(x.database));
 setWorkerRegistrationRuntimeEnvironment({registrationOtpProviders:{},publicBaseUrl:"http://localhost"});
 for(let examined=0;examined<20;examined++){
  const claimed=await repo.claimNext(createTrustedOutboxWorker());
  assert.ok(claimed,"The original email intent must be available to the real lease producer.");
  const {job,lease}=claimed;
  if(job.jobType==="email.assurance.event" && job.payload.eventType===eventType && job.payload.recipientRole==="worker")return {repo,...claimed};
  let result;
  if(job.jobType==="notification.assurance.event")result=await projectAssuranceEventNotification(job,x.database);
  else if(job.jobType==="notification.interview.scheduled" || job.jobType==="notification.interview.reminder")result=await projectInterviewScheduledNotification(job,x.database);
  else if(job.jobType==="email.interview.scheduled" || job.jobType==="email.interview.reminder")result=await processInterviewEmailJob(job,lease,x.database);
  else assert.fail("Unexpected fixture job before the original event email: "+job.jobType);
  await acknowledgeResult(repo,lease,result);
 }
 assert.fail("Original event email was not reached within the bounded fixture queue.");
}
test("Real evidence projection has an owned exact link, immutable fixed content and canonical replay protection",async()=>{
 const x=await notificationFixture();
 try{
  const {worker,record}=await submittedExperience(x),job=await eventJob(x,"evidence.submitted");
  assert.deepEqual(await projectAssuranceEventNotification(job,x.database),{kind:"succeeded"});
  assert.deepEqual(await projectAssuranceEventNotification(job,x.database),{kind:"succeeded"});
  const notices=new DatabaseNotificationRepository(Promise.resolve(x.database));
  const notice=(await notices.listForPrincipal(worker)).find(n=>n.sourceJobId===job.jobId);
  assert.ok(notice);assert.equal(notice.title,"Evidence submitted");
  assert.equal(resolveNotificationHref({role:"worker",target:notice.target,targetReference:notice.targetReference}),"/worker/evidence#"+record.recordId);
  assert.equal((await x.database.query("SELECT count(*)::int AS n FROM platform_notifications WHERE source_job_id=$1",[job.jobId])).rows[0].n,1);
  const foreign=await fundingPrincipal(x.database,x.fixture.credentials.verifier,"verifier");
  assert.equal(await notices.findForPrincipal(foreign,notice.notificationId),null);
  await assert.rejects(()=>projectAssuranceEventNotification({...job,idempotencyKey:"0".repeat(64)},x.database),/retained source/);
  await assert.rejects(()=>x.database.query("UPDATE platform_outbox_jobs SET payload=payload||'{\"eventRef\":\"audit:forged\"}'::jsonb WHERE job_id=$1",[job.jobId]),/immutable/);
  await assert.rejects(()=>x.database.query("UPDATE platform_notifications SET body='Arbitrary copy' WHERE notification_id=$1",[notice.notificationId]),/immutable/);
  assert.equal((await notices.markReadForPrincipal(worker,notice.notificationId)).changed,true);
  assert.equal((await notices.markReadForPrincipal(worker,notice.notificationId)).changed,false);
 }finally{await x.cleanup();}
});
test("Queued evidence reaches the actual next Verifier and live conflict removes list, count, Open and read access",async()=>{
 const x=await notificationFixture();
 try{
  const {worker,record}=await submittedExperience(x),reviews=new EvidenceReviewService(x.database);
  const task=await reviews.queueIndependentWorkerEvidence(worker,record.recordId);
  const verifier=await fundingPrincipal(x.database,x.fixture.credentials.verifier,"verifier"),job=await eventJob(x,"evidence.submitted");
  await projectAssuranceEventNotification(job,x.database);
  const notices=new DatabaseNotificationRepository(Promise.resolve(x.database));
  const notice=(await notices.listForPrincipal(verifier)).find(n=>n.sourceJobId===job.jobId);
  assert.ok(notice);assert.equal(resolveNotificationHref({role:"verifier",target:notice.target,targetReference:notice.targetReference}),"/verifier/reviews/"+task.taskId);
  const before=await notices.unreadCountForPrincipal(verifier);
  await reviews.declareConflict(verifier,task.taskId,"I have a declared prior relationship with this Worker.");
  assert.equal((await notices.listForPrincipal(verifier)).some(n=>n.notificationId===notice.notificationId),false);
  assert.equal(await notices.unreadCountForPrincipal(verifier),before-1);
  assert.equal(await notices.findForPrincipal(verifier,notice.notificationId),null);
  assert.equal(await notices.markReadForPrincipal(verifier,notice.notificationId),null);
  assert.equal((await notices.markAllReadForPrincipal(verifier)).some(n=>n.notificationId===notice.notificationId),false);
  assert.equal((await x.database.query("SELECT read_at FROM platform_notifications WHERE notification_id=$1",[notice.notificationId])).rows[0].read_at,null);
  assert.ok((await notices.listForPrincipal(worker)).some(n=>n.sourceJobId===job.jobId));
 }finally{await x.cleanup();}
});
test("Assurance email binds the genuine stored lease and key, retries with one provider identity and reports acceptance without delivery",async()=>{
 const x=await notificationFixture(),priorFetch=globalThis.fetch;
 try{
  const {record}=await submittedExperience(x),first=await claimEventEmail(x,"evidence.submitted");
  let calls=0,keys=[],urls=[],subjects=[];
  setWorkerRegistrationRuntimeEnvironment({registrationOtpProviders:{emailApiKey:"owned-fixture-key",emailFrom:"Fixture <fixture@example.test>"},publicBaseUrl:"http://localhost"});
  globalThis.fetch=async(url,input)=>{assert.equal(url,"https://api.resend.com/emails");calls++;keys.push(input.headers["Idempotency-Key"]);const body=JSON.parse(input.body);urls.push(body.text);subjects.push(body.subject);return new Response(JSON.stringify(calls===1?{message:"controlled temporary failure"}:{id:"owned_provider_acceptance"}),{status:calls===1?503:200,headers:{"content-type":"application/json"}});};
  await assert.rejects(()=>processAssuranceEventEmailJob({...first.job,idempotencyKey:"f".repeat(64)},first.lease,x.database),/lease/);
  await assert.rejects(()=>processAssuranceEventEmailJob({...first.job,payload:{...first.job.payload,recipientRef:x.admin.accountId}},first.lease,x.database),/lease/);
  assert.equal(calls,0,"No forged copied caller job can cause provider dispatch or create an attempt.");
  assert.equal((await x.database.query("SELECT count(*)::int AS n FROM platform_email_delivery_attempts WHERE source_job_id=$1",[first.job.jobId])).rows[0].n,0);
  const result=await processAssuranceEventEmailJob(first.job,first.lease,x.database);
  assert.equal(result.kind,"retryable");assert.equal(result.failure.code,"provider_http_503");
  await first.repo.retry(first.lease,result.failure);
  await x.database.query("UPDATE platform_outbox_jobs SET next_attempt_at=clock_timestamp()-INTERVAL '1 second' WHERE job_id=$1",[first.job.jobId]);
  const second=await claimEventEmail(x,"evidence.submitted");
  setWorkerRegistrationRuntimeEnvironment({registrationOtpProviders:{emailApiKey:"owned-fixture-key",emailFrom:"Fixture <fixture@example.test>"},publicBaseUrl:"http://localhost"});
  assert.equal(second.job.jobId,first.job.jobId);
  assert.deepEqual(await processAssuranceEventEmailJob(second.job,second.lease,x.database),{kind:"succeeded"});
  assert.deepEqual(await processAssuranceEventEmailJob(second.job,second.lease,x.database),{kind:"succeeded"});
  assert.equal(calls,2);assert.deepEqual(keys,[first.job.idempotencyKey,first.job.idempotencyKey]);assert.deepEqual(subjects,["Evidence submitted","Evidence submitted"]);
  assert.ok(urls.every(text=>text.endsWith("http://localhost/worker/evidence#"+record.recordId)));
  const delivery=(await x.database.query("SELECT status,attempt_count,delivered_at,last_result_code FROM platform_email_deliveries WHERE source_job_id=$1",[first.job.jobId])).rows[0];
  assert.deepEqual(delivery,{status:"sent",attempt_count:2,delivered_at:null,last_result_code:"provider_accepted"});
  assert.deepEqual((await x.database.query("SELECT outcome FROM platform_email_delivery_attempts WHERE source_job_id=$1 ORDER BY attempt_number",[first.job.jobId])).rows.map(r=>r.outcome),["retryable_failure","accepted"]);
  await second.repo.succeed(second.lease);
  await assert.rejects(()=>processAssuranceEventEmailJob(second.job,second.lease,x.database),/lease/);
 }finally{globalThis.fetch=priorFetch;setWorkerRegistrationRuntimeEnvironment(undefined);await x.cleanup();}
});
test("Current recipient revocation suppresses original event email without changing the submitted business record",async()=>{
 const x=await notificationFixture(),priorFetch=globalThis.fetch;
 try{
  const {record}=await submittedExperience(x),claimed=await claimEventEmail(x,"evidence.submitted");let calls=0;
  setWorkerRegistrationRuntimeEnvironment({registrationOtpProviders:{emailApiKey:"owned-fixture-key",emailFrom:"fixture@example.test"},publicBaseUrl:"http://localhost"});
  globalThis.fetch=async()=>{calls++;assert.fail("Revoked recipient cannot reach the provider.");};
  await x.database.query("UPDATE auth_accounts SET account_status='disabled' WHERE account_id=$1",[claimed.job.payload.recipientRef]);
  assert.deepEqual(await processAssuranceEventEmailJob(claimed.job,claimed.lease,x.database),{kind:"succeeded"});
  await claimed.repo.succeed(claimed.lease);assert.equal(calls,0);
  assert.equal((await x.database.query("SELECT status FROM platform_email_deliveries WHERE source_job_id=$1",[claimed.job.jobId])).rows[0].status,"suppressed");
  assert.equal((await x.database.query("SELECT version_status AS status FROM worker_evidence_versions WHERE version_id=$1",[record.currentVersion.versionId])).rows[0].status,"submitted");
 }finally{globalThis.fetch=priorFetch;setWorkerRegistrationRuntimeEnvironment(undefined);await x.cleanup();}
});
test("Original event outbox terminal failure closes its queued email visibly while retaining accepted evidence",async()=>{
 const x=await notificationFixture();
 try{
  const {record}=await submittedExperience(x),claimed=await claimEventEmail(x,"evidence.submitted");
  await claimed.repo.terminalFail(claimed.lease,{code:"controlled_handler_failure",summary:"The owned delivery handler could not complete."});
  const delivery=(await x.database.query("SELECT status,last_result_code FROM platform_email_deliveries WHERE source_job_id=$1",[claimed.job.jobId])).rows[0];
  assert.deepEqual(delivery,{status:"terminal_failed",last_result_code:"delivery_not_confirmed"});
  assert.equal((await x.database.query("SELECT submitted_at IS NOT NULL AS submitted FROM worker_evidence_versions WHERE version_id=$1",[record.currentVersion.versionId])).rows[0].submitted,true);
 }finally{await x.cleanup();}
});
test("Decision and credential notifications resolve real owned Worker records and foreign cases stay unavailable",async()=>{
 const x=await notificationFixture();
 try{
  const {credentialId}=await approvedDecision(x),worker=await fundingPrincipal(x.database,x.fixture.credentials.worker);
  const notices=new DatabaseNotificationRepository(Promise.resolve(x.database));
  for(const type of ["decision.recorded","credential.issued"])await projectAssuranceEventNotification(await eventJob(x,type),x.database);
  const current=await notices.listForPrincipal(worker),decision=current.find(n=>n.notificationType==="decision.recorded"),credential=current.find(n=>n.notificationType==="credential.issued");
  assert.ok(decision);assert.ok(credential);
  assert.equal(resolveNotificationHref({role:"worker",target:decision.target,targetReference:decision.targetReference}),"/worker/assurance-cases/"+x.request.caseId);
  assert.equal(resolveNotificationHref({role:"worker",target:credential.target,targetReference:credential.targetReference}),"/worker/passport#"+credentialId);
  const owned=await findWorkerAssuranceCase(worker,x.request.caseId,x.database);assert.ok(owned);assert.equal(owned.credentialReference,credentialId);
  await x.database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,\'worker\') ON CONFLICT DO NOTHING",[x.fixture.credentials.assessor.accountId]);
  const foreignWorker=await fundingPrincipal(x.database,x.fixture.credentials.assessor,"worker");
  assert.notEqual(foreignWorker.accountId,worker.accountId);
  assert.equal(await findWorkerAssuranceCase(foreignWorker,x.request.caseId,x.database),null);
  await assert.rejects(()=>findWorkerAssuranceCase(x.admin,x.request.caseId,x.database),/unavailable/);
  await x.database.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason=\'controlled_owned_fixture\' WHERE session_id=$1",[worker.sessionId]);
  assert.equal(await findWorkerAssuranceCase(worker,x.request.caseId,x.database),null);
 }finally{await x.cleanup();}
});

test("Empty0099 rollback restores exact prior constraints, email guards, triggers and source uniqueness",async()=>{
 const x=await notificationFixture();
 try{
  const saved=(await x.database.query("SELECT platform_assurance_event_rollback_contract() AS contract")).rows[0].contract;
  await x.database.execute(await readFile("database/migrations/0099_assurance_event_notifications.down.sql","utf8"));
  for(const item of saved.checks){
   const actual=(await x.database.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2",[item.table,item.constraint])).rows[0];
   assert.equal(actual?.definition,item.definition);
  }
  for(const item of saved.functions){
   const name=item.definition.match(/FUNCTION (?:public\.)?([a-z_]+)\(/)?.[1];
   assert.ok(name);assert.equal((await x.database.query("SELECT pg_get_functiondef($1::regprocedure) AS definition",[name+"()"])).rows[0].definition,item.definition);
  }
  for(const item of saved.triggers)assert.equal((await x.database.query("SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname=$1",[item.name])).rows[0].definition,item.definition);
  assert.equal((await x.database.query("SELECT pg_get_indexdef('platform_notifications_legacy_source_job_idx'::regclass) AS definition")).rows[0].definition,saved.legacyIndex);
  assert.equal((await x.database.query("SELECT to_regprocedure('platform_assurance_event_source(text,text)') AS function")).rows[0].function,null);
 }finally{await x.cleanup();}
});
test("0099 rollback refuses retained original event delivery history without altering the accepted submission",async()=>{
 const x=await notificationFixture();
 try{
  const {record}=await submittedExperience(x);
  const down=await readFile("database/migrations/0099_assurance_event_notifications.down.sql","utf8");
  await assert.rejects(()=>x.database.execute(down),/Cannot roll back retained/);
  assert.equal((await x.database.query("SELECT submitted_at IS NOT NULL AS submitted FROM worker_evidence_versions WHERE version_id=$1",[record.currentVersion.versionId])).rows[0].submitted,true);
  assert.ok((await x.database.query("SELECT job_id FROM platform_outbox_jobs WHERE job_type='notification.assurance.event'")).rows.length>0);
 }finally{await x.cleanup();}
});
