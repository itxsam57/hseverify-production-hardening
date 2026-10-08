import assert from "node:assert/strict";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {assessorSchedulingPrincipal} from "../helpers/assessor-scheduling-native-principal.mjs";
import {loadTs} from "../../scripts/interview-test-ts-loader.mjs";
const {InterviewSchedulingService}=loadTs("src/lib/interview/interview-scheduling-service.ts");
test("Required scheduling email delivery work exists for authorized recipients",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  await new InterviewSchedulingService(db).scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+3600000).toISOString()});
  const counts=(await db.query("SELECT job_type,count(*)::int AS total FROM platform_outbox_jobs GROUP BY job_type ORDER BY job_type")).rows;
  const email=counts.filter(row=>row.job_type.startsWith('email.')).reduce((sum,row)=>sum+row.total,0);
  console.log("ACTUAL_NATIVE_SCHEDULING_EMAIL_BOUNDARY",JSON.stringify({counts,email}));
  assert.equal(email,3,"Scheduling requires email as well as in-app recipient intents");
 }finally{await db.close();await fixture.cleanup();}
});

import {loadWorkerRegistrationTs,setWorkerRegistrationRuntimeEnvironment} from "../helpers/worker-registration-runtime-loader.mjs";
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob}=loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const {validateRuntimeEnvironment}=loadWorkerRegistrationTs("src/lib/config/environment.ts");
test("Actual fixed worker sends required scheduling emails through configured transport",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),previousFetch=globalThis.fetch;
 const calls=[];
 try{
  setWorkerRegistrationRuntimeEnvironment(validateRuntimeEnvironment({...fixture.environment,HSE_OTP_EMAIL_API_KEY:'configured-native-provider-key',HSE_OTP_EMAIL_FROM:'notifications@example.test',HSE_PUBLIC_BASE_URL:'https://hse.example.test'}));
  globalThis.fetch=async(url,options)=>{
   assert.equal(String(url),'https://api.resend.com/emails');
   const message=JSON.parse(options.body);assert.equal(message.subject,'Interview scheduled');
   assert.match(message.text,/https:\/\/hse\.example\.test\/(worker\/interviews\/|assessor\/interviews\/|company\/assurance-orders\/)/);
   assert.equal(message.to.length,1);assert.match(options.headers['Idempotency-Key'],/^[a-f0-9]{64}$/);
   calls.push({message,key:options.headers['Idempotency-Key']});
   return new Response(JSON.stringify({id:'native-provider-'+calls.length}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  await new InterviewSchedulingService(db).scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+3600000).toISOString()});
  const repository=new DatabaseOutboxRepository(Promise.resolve(db));
  for(let i=0;i<6;i++)assert.equal((await processNextOutboxJob({repository,database:db})).status,'succeeded');
  assert.equal(calls.length,3);assert.equal(new Set(calls.map(call=>call.key)).size,3);
  const deliveries=(await db.query("SELECT status,delivered_at FROM platform_email_deliveries WHERE delivery_type='interview.scheduled'")).rows;
  assert.equal(deliveries.length,3);for(const delivery of deliveries){assert.equal(delivery.status,'sent');assert.equal(delivery.delivered_at,null);}
  console.log("ACTUAL_NATIVE_CONFIGURED_SCHEDULING_MAIL realfixedworker, authoritative3 recipients/fixedauthenticated links, provider accepted Sent not Delivered; controlledfetch only, no liveprovider certificate");
 }finally{globalThis.fetch=previousFetch;await db.close();await fixture.cleanup();}
});

async function scheduleEmailFixture(db,fixture){
 await new InterviewSchedulingService(db).scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+3600000).toISOString()});
 const repository=new DatabaseOutboxRepository(Promise.resolve(db));
 for(let i=0;i<3;i++)assert.equal((await processNextOutboxJob({repository,database:db})).status,"succeeded");
 return repository;
}
function configureEmail(fixture){
 setWorkerRegistrationRuntimeEnvironment(validateRuntimeEnvironment({...fixture.environment,HSE_OTP_EMAIL_API_KEY:"configured-native-provider-key",HSE_OTP_EMAIL_FROM:"notifications@example.test",HSE_PUBLIC_BASE_URL:"https://hse.example.test"}));
}
test("Queued scheduling emails suppress recipients whose verified address changes or becomes unverified",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),previousFetch=globalThis.fetch;
 let calls=0;
 try{
  configureEmail(fixture);globalThis.fetch=async()=>{calls++;throw new Error("Suppressed email must not reach transport");};
  const repository=await scheduleEmailFixture(db,fixture);
  await db.query("UPDATE auth_accounts SET email_verified_at=NULL,account_status='pending_email' WHERE account_id=$1",[fixture.credentials.worker.accountId]);
  await db.query("UPDATE auth_accounts SET email_normalized='changed-assessor@example.test' WHERE account_id=$1",[fixture.credentials.assessor.accountId]);
  await db.query("UPDATE auth_accounts SET email_verified_at=NULL,account_status='pending_email' WHERE account_id=$1",[fixture.credentials.company.accountId]);
  for(let i=0;i<3;i++)assert.equal((await processNextOutboxJob({repository,database:db})).status,"succeeded");
  assert.equal(calls,0);
  const deliveries=(await db.query("SELECT status,delivered_at FROM platform_email_deliveries WHERE delivery_type='interview.scheduled'")).rows;
  assert.equal(deliveries.length,3);for(const row of deliveries){assert.equal(row.status,"suppressed");assert.equal(row.delivered_at,null);}
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_email_delivery_attempts WHERE outcome='suppressed'")).rows[0].total,3);
 }finally{globalThis.fetch=previousFetch;await db.close();await fixture.cleanup();}
});
test("Provider acceptance followed by audit failure retries the same provider key and recovers the running attempt",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),previousFetch=globalThis.fetch;
 const calls=[],accepted=new Map();
 try{
  configureEmail(fixture);
  globalThis.fetch=async(_url,options)=>{
   const key=options.headers["Idempotency-Key"];calls.push(key);
   if(!accepted.has(key))accepted.set(key,"native-idempotent-"+accepted.size);
   return new Response(JSON.stringify({id:accepted.get(key)}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  const repository=await scheduleEmailFixture(db,fixture);
  await db.exec("CREATE FUNCTION native_fail_email_sent_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='email.delivery.sent' THEN RAISE EXCEPTION 'native required audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER native_fail_email_sent_audit BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION native_fail_email_sent_audit();");
  const retried=await processNextOutboxJob({repository,database:db});assert.equal(retried.status,"retry_wait");
  const pending=(await db.query("SELECT status,delivered_at FROM platform_email_deliveries WHERE source_job_id=$1",[retried.jobId])).rows[0];
  assert.equal(pending.status,"processing");assert.equal(pending.delivered_at,null);
  await db.exec("DROP TRIGGER native_fail_email_sent_audit ON platform_audit_events; DROP FUNCTION native_fail_email_sent_audit();");
  for(let i=0;i<2;i++)assert.equal((await processNextOutboxJob({repository,database:db})).status,"succeeded");
  const remaining=(await db.query("SELECT GREATEST(0,EXTRACT(EPOCH FROM next_attempt_at-clock_timestamp())) AS seconds FROM platform_outbox_jobs WHERE job_id=$1",[retried.jobId])).rows[0];
  await new Promise(resolve=>setTimeout(resolve,Number(remaining.seconds)*1000+100));
  assert.equal((await processNextOutboxJob({repository,database:db})).status,"succeeded");
  assert.equal(calls.length,4);assert.equal(calls[0],calls[3]);assert.equal(accepted.size,3);
  const deliveries=(await db.query("SELECT status,delivered_at FROM platform_email_deliveries WHERE delivery_type='interview.scheduled'")).rows;
  assert.equal(deliveries.length,3);for(const row of deliveries){assert.equal(row.status,"sent");assert.equal(row.delivered_at,null);}
  const attempts=(await db.query("SELECT outcome FROM platform_email_delivery_attempts WHERE source_job_id=$1 ORDER BY attempt_number",[retried.jobId])).rows;
  assert.deepEqual(attempts.map(row=>row.outcome),["lease_expired","accepted"]);
 }finally{globalThis.fetch=previousFetch;await db.close();await fixture.cleanup();}
});

test("Deferred email enqueue rolls back its whole recipient set and bounded reconciliation repairs it once",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  await db.exec("CREATE FUNCTION native_fail_second_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.delivery_type='interview.scheduled' AND EXISTS(SELECT 1 FROM platform_email_deliveries WHERE delivery_type='interview.scheduled') THEN RAISE EXCEPTION 'native partial enqueue failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER native_fail_second_email BEFORE INSERT ON platform_email_deliveries FOR EACH ROW EXECUTE FUNCTION native_fail_second_email();");
  await new InterviewSchedulingService(db).scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+3600000).toISOString()});
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_outbox_jobs WHERE job_type='email.interview.scheduled'")).rows[0].total,0);
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_email_deliveries WHERE delivery_type='interview.scheduled'")).rows[0].total,0);
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_audit_events WHERE action_key='email.interview.intent.recorded'")).rows[0].total,0);
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_outbox_jobs WHERE job_type='notification.interview.scheduled'")).rows[0].total,3);
  const {reconcileInterviewScheduledEmails}=loadWorkerRegistrationTs("src/lib/email-delivery/interview-email-handler.ts");
  assert.deepEqual(await reconcileInterviewScheduledEmails(db),{examined:0,deferred:0});
  await db.exec("DROP TRIGGER native_fail_second_email ON platform_email_deliveries; DROP FUNCTION native_fail_second_email();");
  await new Promise(resolve=>setTimeout(resolve,30100));
  assert.deepEqual(await reconcileInterviewScheduledEmails(db),{examined:1,deferred:0});
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_email_deliveries WHERE delivery_type='interview.scheduled'")).rows[0].total,3);
  assert.deepEqual(await reconcileInterviewScheduledEmails(db),{examined:0,deferred:0});
 }finally{await db.close();await fixture.cleanup();}
});

test("A recipient lookup that outlives the actual SQL lease never dispatches email",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),previousFetch=globalThis.fetch;
 let calls=0,delayed=false;
 try{
  configureEmail(fixture);globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({id:"must-not-send"}),{status:200});};
  await scheduleEmailFixture(db,fixture);
  const {OUTBOX_LEASE_JOB_SQL}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
  const wrapped={
   query:async(sql,params)=>{
    const result=await db.query(sql,params);
    if(sql.startsWith("SELECT accounts.email_normalized,eligible.role")){delayed=true;await new Promise(resolve=>setTimeout(resolve,1200));}
    return result;
   },
   transaction:operation=>db.transaction(tx=>operation({query:(sql,params)=>tx.query(sql,sql===OUTBOX_LEASE_JOB_SQL?[...params.slice(0,3),1]:params)}))
  };
  const {createTrustedOutboxWorker}=loadWorkerRegistrationTs("src/lib/outbox/outbox-domain.ts");
  const {processInterviewEmailJob}=loadWorkerRegistrationTs("src/lib/email-delivery/interview-email-handler.ts");
  const repository=new DatabaseOutboxRepository(Promise.resolve(wrapped));
  const claimed=await repository.claimNext(createTrustedOutboxWorker());
  assert.equal(claimed.job.jobType,"email.interview.scheduled");
  await assert.rejects(()=>processInterviewEmailJob(claimed.job,claimed.lease,wrapped),/lease/i);
  assert.equal(delayed,true);assert.equal(calls,0,"A lease that expired during recipient lookup must not dispatch");
 }finally{globalThis.fetch=previousFetch;await db.close();await fixture.cleanup();}
});

test("Interview attempts reject legacy adapter and Delivered semantics at repository and SQL boundaries",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),previousFetch=globalThis.fetch;
 try{
  configureEmail(fixture);const repository=await scheduleEmailFixture(db,fixture);
  const {createTrustedOutboxWorker}=loadWorkerRegistrationTs("src/lib/outbox/outbox-domain.ts");
  const {DatabaseEmailDeliveryRepository}=loadWorkerRegistrationTs("src/lib/email-delivery/email-delivery-repository.ts");
  const {processInterviewEmailJob}=loadWorkerRegistrationTs("src/lib/email-delivery/interview-email-handler.ts");
  const claimed=await repository.claimNext(createTrustedOutboxWorker()),emailRepository=new DatabaseEmailDeliveryRepository(Promise.resolve(db));
  await assert.rejects(()=>emailRepository.beginAttemptInTransaction(db,claimed.job,claimed.lease,"local_test"),/Email adapter does not match its fixed delivery type/);
  await assert.rejects(()=>db.query("INSERT INTO platform_email_delivery_attempts(email_attempt_id,delivery_id,source_job_id,source_outbox_attempt_id,attempt_number,worker_id,lease_id,adapter_key,dispatch_key,outcome) SELECT $1,deliveries.delivery_id,jobs.job_id,attempts.attempt_id,attempts.attempt_number,attempts.worker_id,attempts.lease_id,'local_test',$3,'running' FROM platform_email_deliveries deliveries JOIN platform_outbox_jobs jobs ON jobs.job_id=deliveries.source_job_id JOIN platform_outbox_job_attempts attempts ON attempts.job_id=jobs.job_id AND attempts.outcome='running' WHERE jobs.job_id=$2",["email_attempt_"+"a".repeat(24),claimed.job.jobId,"b".repeat(64)]),/Email adapter does not match its fixed delivery type/);
  let checked=false;
  globalThis.fetch=async()=>{
   await assert.rejects(()=>emailRepository.finalizeAttemptInTransaction(db,claimed.job,claimed.lease,{outcome:"delivered",status:"delivered",code:"invalid_legacy",summary:"Invalid legacy outcome.",providerReferenceHash:"c".repeat(64)}),/Email outcome does not match its fixed delivery type/);
   await assert.rejects(()=>db.query("UPDATE platform_email_delivery_attempts SET outcome='delivered',result_code='invalid_legacy',result_summary='Invalid legacy outcome.',provider_reference_hash=$2 WHERE source_job_id=$1 AND outcome='running'",[claimed.job.jobId,"c".repeat(64)]),/Email delivery attempt outcome is immutable after finalization/);
   checked=true;return new Response(JSON.stringify({id:"native-fixed-type"}),{status:200});
  };
  assert.deepEqual(await processInterviewEmailJob(claimed.job,claimed.lease,db),{kind:"succeeded"});assert.equal(checked,true);
  assert.equal((await db.query("SELECT outcome FROM platform_email_delivery_attempts WHERE source_job_id=$1",[claimed.job.jobId])).rows[0].outcome,"accepted");
 }finally{globalThis.fetch=previousFetch;await db.close();await fixture.cleanup();}
});

test("An older ambiguous resend attempt cannot dispatch beyond the provider idempotency window",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),previousFetch=globalThis.fetch;
 let calls=0;
 try{
  configureEmail(fixture);
  await new InterviewSchedulingService(db).scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+7*86400000).toISOString()});
  const repository=new DatabaseOutboxRepository(Promise.resolve(db));for(let i=0;i<3;i++)await processNextOutboxJob({repository,database:db});
  const {createTrustedOutboxWorker}=loadWorkerRegistrationTs("src/lib/outbox/outbox-domain.ts");
  const {deriveEmailDispatchKey}=loadWorkerRegistrationTs("src/lib/email-delivery/email-delivery-domain.ts");
  const {processInterviewEmailJob}=loadWorkerRegistrationTs("src/lib/email-delivery/interview-email-handler.ts");
  let claimed=await repository.claimNext(createTrustedOutboxWorker());
  const delivery=(await db.query("SELECT delivery_id FROM platform_email_deliveries WHERE source_job_id=$1",[claimed.job.jobId])).rows[0];
  // Schema-valid persisted ambiguous history, fixed timestamp rather than a 24-hour wall-clock wait.
  await db.query("INSERT INTO platform_email_delivery_attempts(email_attempt_id,delivery_id,source_job_id,source_outbox_attempt_id,attempt_number,worker_id,lease_id,adapter_key,dispatch_key,outcome,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,'resend',$8,'running',clock_timestamp()-INTERVAL '24 hours')",["email_attempt_"+"d".repeat(24),delivery.delivery_id,claimed.job.jobId,claimed.lease.attemptId,claimed.lease.attemptNumber,claimed.lease.workerId,claimed.lease.leaseId,deriveEmailDispatchKey(delivery.delivery_id,claimed.lease)]);
  await db.query("UPDATE platform_email_deliveries SET status='processing',attempt_count=1 WHERE delivery_id=$1",[delivery.delivery_id]);
  const ambiguousJobId=claimed.job.jobId;
  await repository.retry(claimed.lease,{code:"handler_exception",summary:"Native ambiguous prior send."});
  globalThis.fetch=async()=>new Response(JSON.stringify({id:"native-other-recipient"}),{status:200});
  for(let i=0;i<2;i++)assert.equal((await processNextOutboxJob({repository,database:db})).status,"succeeded");
  await new Promise(resolve=>setTimeout(resolve,5200));
  claimed=await repository.claimNext(createTrustedOutboxWorker());
  assert.equal(claimed.job.jobId,ambiguousJobId);
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({id:"must-not-repeat"}),{status:200});};
  console.log("NATIVE_AMBIGUOUS_WINDOW",JSON.stringify((await db.query("SELECT source_job_id,started_at,started_at<=clock_timestamp()-INTERVAL '23 hours' AS expired FROM platform_email_delivery_attempts WHERE source_job_id=$1",[claimed.job.jobId])).rows));
  const result=await processInterviewEmailJob(claimed.job,claimed.lease,db);
  assert.equal(calls,0);assert.equal(result.kind,"terminal");assert.equal(result.failure.code,"idempotency_window_expired");
  const current=(await db.query("SELECT status,delivered_at,last_result_code FROM platform_email_deliveries WHERE delivery_id=$1",[delivery.delivery_id])).rows[0];
  assert.equal(current.status,"terminal_failed");assert.equal(current.delivered_at,null);assert.equal(current.last_result_code,"idempotency_window_expired");
 }finally{globalThis.fetch=previousFetch;await db.close();await fixture.cleanup();}
});

test("Unconfigured provider reaches the actual five-attempt terminal boundary without a false send",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),previousFetch=globalThis.fetch;
 let calls=0;
 try{
  setWorkerRegistrationRuntimeEnvironment(validateRuntimeEnvironment(fixture.environment));globalThis.fetch=async()=>{calls++;throw new Error("Unconfigured provider must not dispatch");};
  const repository=await scheduleEmailFixture(db,fixture);
  for(let attempt=1;attempt<=5;attempt++){
   for(let recipient=0;recipient<3;recipient++)assert.equal((await processNextOutboxJob({repository,database:db})).status,attempt===5?"terminal_failed":"retry_wait");
   // Advance the native queue's due time; preserve its attempt count, lifecycle and audit trail.
   await db.query("UPDATE platform_outbox_jobs SET next_attempt_at=clock_timestamp() WHERE job_type='email.interview.scheduled' AND status='retry_wait'");
  }
  assert.equal(calls,0);
  const rows=(await db.query("SELECT status,attempt_count,last_result_code,delivered_at FROM platform_email_deliveries WHERE delivery_type='interview.scheduled'")).rows;
  assert.equal(rows.length,3);for(const row of rows){assert.equal(row.status,"terminal_failed");assert.equal(row.attempt_count,5);assert.equal(row.last_result_code,"provider_unconfigured");assert.equal(row.delivered_at,null);}
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_email_delivery_attempts")).rows[0].total,15);
 }finally{globalThis.fetch=previousFetch;await db.close();await fixture.cleanup();}
});
test("Cancelled schedule and changed Company permission suppress their queued email without exposing a link",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),previousFetch=globalThis.fetch;
 let calls=0;
 try{
  configureEmail(fixture);globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({id:"native-current-access-"+calls}),{status:200});};
  const repository=await scheduleEmailFixture(db,fixture);
  await db.query("INSERT INTO auth_tenant_permission_overrides(membership_id,membership_role,permission_key,effect,reason) SELECT membership_id,membership_role,'company.orders.read','deny','Native email current permission probe' FROM auth_tenant_memberships WHERE membership_id=$1",[fixture.credentials.company.membershipId]);
  for(let i=0;i<3;i++)assert.equal((await processNextOutboxJob({repository,database:db})).status,"succeeded");
  assert.equal(calls,2);
  assert.equal((await db.query("SELECT status FROM platform_email_deliveries WHERE delivery_type='interview.scheduled' AND recipient_role='company'")).rows[0].status,"suppressed");
  await new InterviewSchedulingService(db).scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Beta,scheduledAt:new Date(Date.now()+3600000).toISOString()});
  await db.query("UPDATE interview_requests SET status='CANCELLED' WHERE interview_request_id=$1",[fixture.requests.Beta.interviewRequestId]);
  // Permission revocation removes Company from the second source; Worker/Assessor remain queued in each channel.
  for(let i=0;i<4;i++)assert.equal((await processNextOutboxJob({repository,database:db})).status,"succeeded");
  assert.equal(calls,2);
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_email_deliveries WHERE status='suppressed'")).rows[0].total,3);
 }finally{globalThis.fetch=previousFetch;await db.close();await fixture.cleanup();}
});

test("Fixed email transport classifies throttling, failures, conflicting keys and malformed acceptance",{timeout:10000},async()=>{
 const {sendInterviewEmail}=loadWorkerRegistrationTs("src/lib/email-delivery/interview-email-transport.ts");
 const input={providers:{emailApiKey:"configured-unit-key",emailFrom:"notifications@example.test"},publicBaseUrl:"https://hse.example.test",recipient:"worker@example.test",href:"/worker/interviews/record",idempotencyKey:"f".repeat(64)};
 for(const [status,body,kind,code] of [
  [429,{}, "retryable","provider_http_429"],[503,{},"retryable","provider_http_503"],[400,{},"terminal","provider_http_400"],
  [409,{name:"concurrent_idempotent_requests"},"retryable","provider_http_409"],
  [409,{name:"invalid_idempotent_request"},"terminal","provider_http_409"],
  [200,{id:null},"retryable","provider_invalid_response"]
 ]){
  assert.deepEqual(await sendInterviewEmail(input,async()=>new Response(JSON.stringify(body),{status})),{kind,code});
 }
 assert.deepEqual(await sendInterviewEmail(input,async()=>{throw new Error("Native timeout");}),{kind:"retryable",code:"provider_unreachable"});
 assert.deepEqual(await sendInterviewEmail({...input,publicBaseUrl:"https://attacker.invalid/path"},async()=>{throw new Error("Invalid origin must not dispatch");}),{kind:"retryable",code:"provider_unconfigured"});
});
