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
const {validateRuntimeEnvironment}=loadWorkerRegistrationTs("src/lib/config/environment.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {getInterviewEmailHealth,requestInterviewEmailRetries}=loadWorkerRegistrationTs("src/lib/email-delivery/interview-email-health-service.ts");
async function adminPrincipal(db,identity) {
 await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[identity.accountId]);
 const sessionId="email-health-native-"+randomUUID(),now=new Date().toISOString();
 await new AuthAccessRepository(db).authentication.insertSession({sessionId,accountId:identity.accountId,activeRole:"admin",
  tokenHash:createHash("sha256").update(sessionId).digest("hex"),csrfTokenHash:createHash("sha256").update("csrf:"+sessionId).digest("hex"),
  userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
 return {accountId:identity.accountId,sessionId,activeRole:"admin",accountStatus:"active",tenantMembership:null};
}
const configure = (fixture) => setWorkerRegistrationRuntimeEnvironment(validateRuntimeEnvironment({...fixture.environment,HSE_OTP_EMAIL_API_KEY:"manual-retry-controlled-key",HSE_OTP_EMAIL_FROM:"notifications@example.test",HSE_PUBLIC_BASE_URL:"https://hse.example.test"}));
const jobs = async(db) => (await db.query("SELECT job_id,idempotency_key,payload,status,attempt_count,max_attempts,next_attempt_at,lease_id,updated_at FROM platform_outbox_jobs WHERE job_type='email.interview.scheduled' ORDER BY job_id")).rows;
async function scheduleRetries(db,fixture,assessor) {
 setWorkerRegistrationRuntimeEnvironment(validateRuntimeEnvironment(fixture.environment));
 await new InterviewSchedulingService(db).scheduleInterview({principal:assessor,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+86400000).toISOString()});
 const repository=new DatabaseOutboxRepository(Promise.resolve(db));
 for(let i=0;i<6;i++)assert.equal((await processNextOutboxJob({repository,database:db})).status,i<3?"succeeded":"retry_wait");
 // Represent a delayed retry schedule using actual produced jobs; live clock, keys and attempt history remain unchanged.
 await db.query("UPDATE platform_outbox_jobs SET next_attempt_at=clock_timestamp()+INTERVAL '1 hour' WHERE job_type='email.interview.scheduled' AND status='retry_wait'");
 return repository;
}
test("Current Admin manual retry accelerates the same produced jobs atomically and preserves provider keys and attempt caps",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),previousFetch=globalThis.fetch;
 try {
  const assessor=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),admin=await adminPrincipal(db,fixture.credentials.assessor);
  globalThis.fetch=async()=>{throw new Error("Unconfigured email cannot dispatch");};
  const repository=await scheduleRetries(db,fixture,assessor),before=await jobs(db);
  await assert.rejects(()=>requestInterviewEmailRetries(admin,db),error=>error.name==="InterviewEmailRetryUnavailableError");
  assert.deepEqual(await jobs(db),before);
  configure(fixture);assert.equal((await getInterviewEmailHealth(admin,db)).eligibleRetries,3);
  assert.equal(await requestInterviewEmailRetries(admin,db),3);assert.equal(await requestInterviewEmailRetries(admin,db),0);
  const after=await jobs(db);
  for(let i=0;i<3;i++){
   for(const key of ["job_id","idempotency_key","payload","status","attempt_count","max_attempts","lease_id"])assert.deepEqual(after[i][key],before[i][key],key);
   assert.ok(new Date(after[i].next_attempt_at).getTime()<=Date.now());
  }
  const audit=(await db.query("SELECT actor_account_id,actor_role,target_reference,metadata FROM platform_audit_events WHERE action_key='email.delivery.retry_scheduled' AND reason_key='manual_retry'")).rows;
  assert.equal(audit.length,3);assert.ok(audit.every(row=>row.actor_account_id===admin.accountId&&row.actor_role==="admin"));assert.deepEqual(audit.map(row=>row.target_reference).sort(),before.map(row=>row.job_id).sort());
  assert.doesNotMatch(JSON.stringify(audit),/@|manual-retry-controlled-key|email_normalized|provider_reference/);
  const keys=[];globalThis.fetch=async(url,init)=>{assert.equal(String(url),"https://api.resend.com/emails");keys.push(new Headers(init.headers).get("Idempotency-Key"));return new Response(JSON.stringify({id:"controlled-manual-"+keys.length}),{status:200});};
  for(let i=0;i<3;i++)assert.equal((await processNextOutboxJob({repository,database:db})).status,"succeeded");
  assert.deepEqual(keys.sort(),before.map(row=>row.idempotency_key).sort());assert.equal((await getInterviewEmailHealth(admin,db)).sent,3);assert.equal(await requestInterviewEmailRetries(admin,db),0);
  console.log("ACTUAL_MANUAL_RETRY_NATIVE producer3 -> real CLI-equivalent worker retry_wait -> authorized Admin -> same job/provider keys -> controlled accepted3; no new jobs, attempt reset or live-provider claim");
 }finally{globalThis.fetch=previousFetch;await db.close();await fixture.cleanup();}
});
test("Manual retry rejects foreign, revoked, disabled and expired Admin state and rolls back every due-time update on required audit failure",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),previousFetch=globalThis.fetch;
 try {
  const assessor=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),admin=await adminPrincipal(db,fixture.credentials.assessor);
  globalThis.fetch=async()=>{throw new Error("Unconfigured email cannot dispatch");};await scheduleRetries(db,fixture,assessor);configure(fixture);const before=await jobs(db);
  for(const principal of [assessor,{...assessor,activeRole:"admin"},{...admin,accountId:fixture.credentials.worker.accountId},{...admin,tenantMembership:{tenantId:fixture.credentials.company.tenantId}}])await assert.rejects(()=>requestInterviewEmailRetries(principal,db),error=>error.name==="InterviewEmailHealthAccessError");
  await db.exec("CREATE FUNCTION manual_retry_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='email.delivery.retry_scheduled' AND NEW.reason_key='manual_retry' THEN RAISE EXCEPTION 'required manual retry audit fixture failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER manual_retry_audit_failure BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION manual_retry_audit_failure()");
  await assert.rejects(()=>requestInterviewEmailRetries(admin,db),/required manual retry audit fixture failure/);assert.deepEqual(await jobs(db),before);
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_audit_events WHERE reason_key='manual_retry'")).rows[0].total,0);await db.exec("DROP TRIGGER manual_retry_audit_failure ON platform_audit_events; DROP FUNCTION manual_retry_audit_failure()");
  await db.query("UPDATE auth_sessions SET revoked_at=clock_timestamp(),revocation_reason='logout' WHERE session_id=$1",[admin.sessionId]);await assert.rejects(()=>requestInterviewEmailRetries(admin,db),error=>error.name==="InterviewEmailHealthAccessError");
  await db.query("UPDATE auth_sessions SET revoked_at=NULL,revocation_reason=NULL WHERE session_id=$1",[admin.sessionId]);
  await db.query("UPDATE auth_accounts SET account_status='disabled' WHERE account_id=$1",[admin.accountId]);await assert.rejects(()=>requestInterviewEmailRetries(admin,db),error=>error.name==="InterviewEmailHealthAccessError");
  await db.query("UPDATE auth_accounts SET account_status='active' WHERE account_id=$1",[admin.accountId]);
  await db.query("UPDATE auth_sessions SET created_at=clock_timestamp()-INTERVAL '1 hour',last_seen_at=clock_timestamp()-INTERVAL '1 minute',expires_at=clock_timestamp()-INTERVAL '1 second' WHERE session_id=$1",[admin.sessionId]);await assert.rejects(()=>requestInterviewEmailRetries(admin,db),error=>error.name==="InterviewEmailHealthAccessError");assert.deepEqual(await jobs(db),before);
 }finally{globalThis.fetch=previousFetch;await db.close();await fixture.cleanup();}
});

test("Admin expiry during required audit rolls back the complete manual retry transaction",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const assessor=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),admin=await adminPrincipal(db,fixture.credentials.assessor);
  await scheduleRetries(db,fixture,assessor);configure(fixture);const before=await jobs(db);
  await db.query("UPDATE auth_sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",[admin.sessionId]);
  let delayed=false;
  const wrapped={transaction:operation=>db.transaction(tx=>operation({query:async(sql,params)=>{
   const result=await tx.query(sql,params);
   if(!delayed&&sql.includes("INSERT INTO platform_audit_events")){delayed=true;await new Promise(resolve=>setTimeout(resolve,2200));}
   return result;
  }}))};
  await assert.rejects(()=>requestInterviewEmailRetries(admin,wrapped),error=>error.name==="InterviewEmailHealthAccessError");
  assert.equal(delayed,true);assert.deepEqual(await jobs(db),before);
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_audit_events WHERE reason_key='manual_retry'")).rows[0].total,0);
 }finally{await db.close();await fixture.cleanup();}
});

test("Manual retry excludes expired provider windows, active leases, pending jobs and terminal jobs",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  configure(fixture);const assessor=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),admin=await adminPrincipal(db,fixture.credentials.assessor);
  await new InterviewSchedulingService(db).scheduleInterview({principal:assessor,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+86400000).toISOString()});
  const repository=new DatabaseOutboxRepository(Promise.resolve(db));
  for(let i=0;i<3;i++)assert.equal((await processNextOutboxJob({repository,database:db})).status,"succeeded");
  const {createTrustedOutboxWorker}=loadWorkerRegistrationTs("src/lib/outbox/outbox-domain.ts");
  const {deriveEmailDispatchKey}=loadWorkerRegistrationTs("src/lib/email-delivery/email-delivery-domain.ts");
  const old=await repository.claimNext(createTrustedOutboxWorker());
  const delivery=(await db.query("SELECT delivery_id FROM platform_email_deliveries WHERE source_job_id=$1",[old.job.jobId])).rows[0];
  // Schema-valid old ambiguous history; no finalized record or clock is rewritten.
  await db.query("INSERT INTO platform_email_delivery_attempts(email_attempt_id,delivery_id,source_job_id,source_outbox_attempt_id,attempt_number,worker_id,lease_id,adapter_key,dispatch_key,outcome,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,'resend',$8,'running',clock_timestamp()-INTERVAL '24 hours')",["email_attempt_"+"d".repeat(24),delivery.delivery_id,old.job.jobId,old.lease.attemptId,old.lease.attemptNumber,old.lease.workerId,old.lease.leaseId,deriveEmailDispatchKey(delivery.delivery_id,old.lease)]);
  await db.query("UPDATE platform_email_deliveries SET status='processing',attempt_count=1 WHERE delivery_id=$1",[delivery.delivery_id]);
  await repository.retry(old.lease,{code:"handler_exception",summary:"Ambiguous prior send fixture."});
  await db.query("UPDATE platform_outbox_jobs SET next_attempt_at=clock_timestamp()+INTERVAL '1 hour' WHERE job_id=$1",[old.job.jobId]);
  const leased=await repository.claimNext(createTrustedOutboxWorker());
  assert.equal(leased.job.jobType,"email.interview.scheduled");
  let before=await jobs(db);assert.deepEqual(before.map(row=>row.status).sort(),["leased","pending","retry_wait"]);
  assert.equal((await getInterviewEmailHealth(admin,db)).eligibleRetries,0);assert.equal(await requestInterviewEmailRetries(admin,db),0);assert.deepEqual(await jobs(db),before);
  await repository.terminalFail(leased.lease,{code:"handler_exception",summary:"Terminal fixture."});
  before=await jobs(db);assert.ok(before.some(row=>row.status==="terminal_failed"));
  assert.equal(await requestInterviewEmailRetries(admin,db),0);assert.deepEqual(await jobs(db),before);
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_audit_events WHERE reason_key='manual_retry'")).rows[0].total,0);
 }finally{await db.close();await fixture.cleanup();}
});
