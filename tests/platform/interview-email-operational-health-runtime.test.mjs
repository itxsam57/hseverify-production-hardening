import assert from "node:assert/strict";
import test from "node:test";
import {createHash,randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {assessorSchedulingPrincipal} from "../helpers/assessor-scheduling-native-principal.mjs";
import {loadWorkerRegistrationTs,setWorkerRegistrationRuntimeEnvironment} from "../helpers/worker-registration-runtime-loader.mjs";
const {InterviewSchedulingService}=loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob}=loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const {DatabaseEmailDeliveryRepository}=loadWorkerRegistrationTs("src/lib/email-delivery/email-delivery-repository.ts");
const {bindTrustedAuditActor}=loadWorkerRegistrationTs("src/lib/audit/audit-domain.ts");
const {validateRuntimeEnvironment}=loadWorkerRegistrationTs("src/lib/config/environment.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {getInterviewEmailHealth}=loadWorkerRegistrationTs("src/lib/email-delivery/interview-email-health-service.ts");
async function adminPrincipal(db,identity) {
 await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[identity.accountId]);
 const sessionId="email-health-native-"+randomUUID(),now=new Date().toISOString();
 await new AuthAccessRepository(db).authentication.insertSession({sessionId,accountId:identity.accountId,activeRole:"admin",
  tokenHash:createHash("sha256").update(sessionId).digest("hex"),csrfTokenHash:createHash("sha256").update("csrf:"+sessionId).digest("hex"),
  userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
 return {accountId:identity.accountId,sessionId,activeRole:"admin",accountStatus:"active",tenantMembership:null};
}
test("Actual Admin email health reflects fixed worker retry and acceptance with live authorization and no recipient data",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),previousFetch=globalThis.fetch;
 try {
  const assessor=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),admin=await adminPrincipal(db,fixture.credentials.assessor);
  const empty=await getInterviewEmailHealth(admin,db);assert.equal(empty.queueDepth,0);assert.equal(empty.failureRate24h,null);assert.equal(empty.lastAcceptedAt,null);
  await new InterviewSchedulingService(db).scheduleInterview({principal:assessor,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+86400000).toISOString()});
  const repository=new DatabaseOutboxRepository(Promise.resolve(db)),email=new DatabaseEmailDeliveryRepository(Promise.resolve(db));
  await db.transaction(async tx=>{const job=await repository.enqueueInTransaction(tx,bindTrustedAuditActor(admin),{jobType:"email.delivery.foundation",businessKey:"email-health-excluded-fixture",payload:{fixtureRef:"email.foundation.success.health"},availableAt:new Date(Date.now()+86400000).toISOString()});await email.queueInTransaction(tx,job);});
  const queued=await getInterviewEmailHealth(admin,db);assert.equal(queued.queued,3);assert.equal(queued.queueDepth,3);assert.equal(queued.sent,0);
  await assert.rejects(()=>getInterviewEmailHealth(assessor,db),error=>error.name==="InterviewEmailHealthAccessError");
  await assert.rejects(()=>getInterviewEmailHealth({...assessor,activeRole:"admin"},db),error=>error.name==="InterviewEmailHealthAccessError");
  await assert.rejects(()=>getInterviewEmailHealth({...admin,accountId:fixture.credentials.worker.accountId},db),error=>error.name==="InterviewEmailHealthAccessError");
  setWorkerRegistrationRuntimeEnvironment(validateRuntimeEnvironment(fixture.environment));
  globalThis.fetch=async()=>{throw new Error("Unconfigured email must not reach provider");};
  for(let i=0;i<6;i++){const job=await processNextOutboxJob({repository,database:db});assert.equal(job.status,i<3?"succeeded":"retry_wait");}
  const retry=await getInterviewEmailHealth(admin,db);assert.equal(retry.retrying,3);assert.equal(retry.queueDepth,3);assert.equal(retry.completedAttempts24h,3);assert.equal(retry.failedAttempts24h,3);assert.equal(retry.failureRate24h,1);assert.ok(retry.nextRetryAt);assert.equal(retry.lastAcceptedAt,null);
  const due=(await db.query("SELECT max(next_attempt_at) AS due FROM platform_outbox_jobs WHERE job_type='email.interview.scheduled'")).rows[0].due;
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,new Date(due).getTime()-Date.now()+100)));
  setWorkerRegistrationRuntimeEnvironment(validateRuntimeEnvironment({...fixture.environment,HSE_OTP_EMAIL_API_KEY:"configured-health-key",HSE_OTP_EMAIL_FROM:"notifications@example.test",HSE_PUBLIC_BASE_URL:"https://hse.example.test"}));
  let calls=0;globalThis.fetch=async(url)=>{assert.equal(String(url),"https://api.resend.com/emails");calls++;return new Response(JSON.stringify({id:"controlled-health-"+calls}),{status:200});};
  for(let i=0;i<3;i++)assert.equal((await processNextOutboxJob({repository,database:db})).status,"succeeded");assert.equal(calls,3);
  const sent=await getInterviewEmailHealth(admin,db);assert.equal(sent.queueDepth,0);assert.equal(sent.sent,3);assert.equal(sent.completedAttempts24h,6);assert.equal(sent.failedAttempts24h,3);assert.equal(sent.failureRate24h,0.5);assert.ok(sent.lastAcceptedAt);assert.equal(sent.nextRetryAt,null);
  assert.doesNotMatch(JSON.stringify(sent),/@|provider_reference|recipient|configured-health-key/);
  await new InterviewSchedulingService(db).scheduleInterview({principal:assessor,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+172800000).toISOString()});
  for(const role of ["worker","assessor","company"])await db.query("UPDATE auth_accounts SET email_normalized=$2 WHERE account_id=$1",[fixture.credentials[role].accountId,"changed-health-"+role+"@example.test"]);
  globalThis.fetch=async()=>{throw new Error("Suppressed recipient must not reach provider");};
  for(let i=0;i<6;i++)assert.equal((await processNextOutboxJob({repository,database:db})).status,"succeeded");
  const suppressed=await getInterviewEmailHealth(admin,db);assert.equal(suppressed.suppressed,3);assert.equal(suppressed.sent,3);assert.equal(suppressed.queueDepth,0);assert.equal(suppressed.completedAttempts24h,6);assert.equal(suppressed.failedAttempts24h,3);assert.equal(suppressed.failureRate24h,0.5);assert.equal(suppressed.lastAcceptedAt,sent.lastAcceptedAt);

  await db.query("UPDATE auth_sessions SET revoked_at=clock_timestamp(),revocation_reason='logout' WHERE session_id=$1",[admin.sessionId]);
  await assert.rejects(()=>getInterviewEmailHealth(admin,db),error=>error.name==="InterviewEmailHealthAccessError");
  await db.query("UPDATE auth_sessions SET revoked_at=NULL,revocation_reason=NULL WHERE session_id=$1",[admin.sessionId]);
  await db.query("UPDATE auth_accounts SET account_status='disabled' WHERE account_id=$1",[admin.accountId]);
  await assert.rejects(()=>getInterviewEmailHealth(admin,db),error=>error.name==="InterviewEmailHealthAccessError");
  await db.query("UPDATE auth_accounts SET account_status='active' WHERE account_id=$1",[admin.accountId]);
  await db.query("UPDATE auth_sessions SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE session_id=$1",[admin.sessionId]);
  await assert.rejects(()=>getInterviewEmailHealth(admin,db),error=>error.name==="InterviewEmailHealthAccessError");
  console.log("ACTUAL_NATIVE_EMAIL_HEALTH source3 -> retry3/100%failed -> accepted3/50%attemptfailure; fixed foundation excluded, live role/account/session guards, aggregate only; no live provider certificate");
 }finally{globalThis.fetch=previousFetch;await db.close();await fixture.cleanup();}
});
