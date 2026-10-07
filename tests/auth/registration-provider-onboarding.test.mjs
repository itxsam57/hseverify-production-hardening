import assert from "node:assert/strict";
import test from "node:test";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../../tests/helpers/migration-ceiling.mjs";
import { loadWorkerRegistrationTs, setWorkerRegistrationRuntimeEnvironment } from "../../tests/helpers/worker-registration-runtime-loader.mjs";
const {WorkerRegistrationService}=loadWorkerRegistrationTs("src/lib/auth/worker-registration-service.ts");
const {WorkerRegistrationRepository}=loadWorkerRegistrationTs("src/lib/auth/worker-registration-repository.ts");
const {decryptSecret}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
const ENV={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",releaseSha:"worker-otp-server-boundaries",sessionSecret:"worker-otp-server-session-secret-more-than-thirty-two",authPepper:"worker-otp-server-auth-pepper-more-than-thirty-two",authSandboxEnabled:true,authSandboxAccessKey:"worker-otp-server-sandbox",demoAuthEnabled:false,demoDataEnabled:false};
const NOW=new Date().toISOString();
const PROVIDERS={emailApiKey:"fixture-email-key",emailFrom:"verify@example.test",smsAccountSid:"AC"+"a".repeat(32),smsAuthToken:"fixture-sms-token",smsFrom:"+15550001111"};
setWorkerRegistrationRuntimeEnvironment({...ENV,authSandboxEnabled:false,registrationOtpProviders:PROVIDERS});
test("Configured non-sandbox Worker registration queues an encrypted OTP intent and commits required audit",async()=>{
 const db=await openScriptDatabase(ENV);await applyMigrationsThrough(db,ENV.releaseSha,"0086_registration_otp_delivery");
 try{
  const service=new WorkerRegistrationService(new WorkerRegistrationRepository(db),{pepper:ENV.authPepper,sandboxEnabled:false,sandboxAccessKey:null,registrationDeliveryChannels:["email","phone"]},()=>new Date(NOW));
  const result=await service.start({displayName:"Provider Boundary Worker",email:"provider.worker@example.test",phone:"+923008883311",password:"ProviderWorker!Password2026",country:"Pakistan",termsAccepted:true,privacyAccepted:true,requestFingerprint:"provider-worker-fixture"});
  assert.equal(result.state.step,"pending_email");
  assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_sandbox_deliveries")).rows[0].count,0);
  const intents=(await db.query("SELECT delivery_id,challenge_id,status,payload_ciphertext FROM auth_registration_delivery_intents")).rows;
  assert.equal(intents.length,1);assert.equal(intents[0].status,"queued");assert.ok(intents[0].payload_ciphertext);assert.ok(!intents[0].payload_ciphertext.includes("provider.worker@example.test"));
  const jobs=(await db.query("SELECT payload,status FROM platform_outbox_jobs WHERE job_type='authentication.challenge.delivery'")).rows;
  assert.deepEqual(jobs,[{payload:{dispatchRef:intents[0].delivery_id},status:"pending"}]);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE action_key='authentication.otp.issued'")).rows[0].count,1);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_sessions")).rows[0].count,0);
 }finally{await db.close();}
});

const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob}=loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const {CompanyRegistrationService}=loadWorkerRegistrationTs("src/lib/company/company-registration-service.ts");
const {CompanyRegistrationRepository}=loadWorkerRegistrationTs("src/lib/company/company-registration-repository.ts");
const {validateRuntimeEnvironment}=loadWorkerRegistrationTs("src/lib/config/environment.ts");
const WORKER={displayName:"Provider Worker",email:"delivery.worker@example.test",phone:"+923001112233",
 password:"DeliveryWorker!Password2026",country:"Pakistan",termsAccepted:true,privacyAccepted:true,requestFingerprint:"delivery-fixture"};
const COMPANY={legalName:"Provider Safety Limited",tradingName:"Provider Safety",registrationNumber:"PROVIDER-2026",
 country:"Pakistan",industry:"Safety services",companySize:"11-50",website:"https://provider.example.test",
 authorizedRepresentative:"Provider Company QA",businessEmail:"provider.company@example.test",businessPhone:"+923001224466",
 password:"CompanyProvider!Password2026",termsAccepted:true,privacyAccepted:true,requestFingerprint:"company-provider-fixture"};
async function fixture(company=false,channels=["email","phone"]) {
 const db=await openScriptDatabase(ENV);
 await applyMigrationsThrough(db,ENV.releaseSha,"0086_registration_otp_delivery");
 const service=company
  ? new CompanyRegistrationService(new CompanyRegistrationRepository(db),{pepper:ENV.authPepper,sandboxEnabled:false,registrationDeliveryChannels:channels})
  : new WorkerRegistrationService(new WorkerRegistrationRepository(db),{pepper:ENV.authPepper,sandboxEnabled:false,sandboxAccessKey:null,registrationDeliveryChannels:channels});
 const baseline={};
 for(const table of ["auth_accounts","auth_otp_challenges","auth_registration_delivery_intents","platform_outbox_jobs"])
  baseline[table]=(await db.query("SELECT count(*)::int AS count FROM "+table)).rows[0].count;
 return {db,service,repository:new DatabaseOutboxRepository(Promise.resolve(db)),company,baseline};
}
async function intent(f) {
 const row=(await f.db.query("SELECT * FROM auth_registration_delivery_intents ORDER BY created_at DESC")).rows[0];
 return {...row,payload:row.payload_ciphertext ? JSON.parse(decryptSecret(row.payload_ciphertext,ENV.authPepper)) : null};
}
async function dispatch(f,fetcher) {
 const old=globalThis.fetch;globalThis.fetch=fetcher;
 try{return await processNextOutboxJob({repository:f.repository,database:f.db});}
 finally{globalThis.fetch=old;}
}
const accepted=async endpoint=>new Response(JSON.stringify(endpoint.includes("twilio")?{sid:"SM"+"b".repeat(32)}:{id:"fixture-accepted"}),{status:200});
for(const company of [false,true])test((company?"Company":"Worker")+" actual configured queue -> registered provider dispatch -> OTP verification",async()=>{
 const f=await fixture(company);try {
  const result=await f.service.start(company?COMPANY:WORKER);
  const first=await intent(f);assert.equal(first.status,"queued");
  let calls=0;
  const job=await dispatch(f,async(endpoint,options)=>{
   calls++;assert.ok(endpoint==="https://api.resend.com/emails");
   const body=JSON.parse(options.body);assert.equal(body.to[0],company?COMPANY.businessEmail:WORKER.email);
   assert.ok(body.text.includes(first.payload.code));assert.equal(options.headers["Idempotency-Key"],first.challenge_id);
   return accepted(endpoint);
  });
  assert.equal(job.status,"succeeded");assert.equal(calls,1);
  assert.equal((await intent(f)).status,"accepted");assert.equal((await intent(f)).payload_ciphertext,null);
  assert.equal((await f.service.readState(result.token)).deliveryStatus,"accepted");
  // Reprocessing the accepted opaque reference must not contact the provider.
  await f.db.query("UPDATE platform_outbox_jobs SET status='retry_wait',succeeded_at=NULL,next_attempt_at=CURRENT_TIMESTAMP WHERE job_id=$1",[job.jobId]);
  await dispatch(f,async()=>{calls++;throw new Error("duplicate send");});assert.equal(calls,1);
  const verified=company
   ? await f.service.verifyEmail({token:result.token,code:first.payload.code,requestFingerprint:"provider-verification"})
   : (await f.service.verify({token:result.token,code:first.payload.code,requestFingerprint:"provider-verification"})).state;
  assert.equal(verified.step,company?"pending_mfa":"pending_phone");
  if(!company) {
   const sms=await intent(f);assert.equal(sms.payload.channel,"phone");
   let smsCalls=0;
   const smsJob=await dispatch(f,async(endpoint,options)=>{
    smsCalls++;assert.ok(endpoint.startsWith("https://api.twilio.com/"));
    assert.equal(new URLSearchParams(options.body).get("To"),WORKER.phone);
    assert.ok(new URLSearchParams(options.body).get("Body").includes(sms.payload.code));return accepted(endpoint);
   });
   assert.equal(smsCalls,1);assert.equal(smsJob.status,"succeeded");
   const complete=await f.service.verify({token:result.token,code:sms.payload.code,requestFingerprint:"provider-phone"});
   assert.equal(complete.state.step,"complete");
   assert.equal((await f.db.query("SELECT account_status FROM auth_accounts WHERE email_normalized=$1",[WORKER.email])).rows[0].account_status,"active");
  }
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM auth_sessions")).rows[0].count,0);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM auth_sandbox_deliveries")).rows[0].count,0);
  const audits=(await f.db.query("SELECT action_key,metadata FROM platform_audit_events")).rows;
  assert.ok(audits.some(x=>x.action_key==="outbox.job.succeeded"));
  assert.ok(!JSON.stringify(audits).includes(first.payload.code));
 }finally{await f.db.close();}
});
for(const company of [false,true])test((company?"Company":"Worker")+" missing provider refuses before partial registration",async()=>{
 const f=await fixture(company,company?[]:["email"]);try {
  await assert.rejects(f.service.start(company?COMPANY:WORKER),e=>e.code==="delivery_unavailable");
  for(const table of ["auth_accounts","auth_otp_challenges","auth_registration_delivery_intents","platform_outbox_jobs"])
   assert.equal((await f.db.query("SELECT count(*)::int AS count FROM "+table)).rows[0].count,f.baseline[table]);
 }finally{await f.db.close();}
});
for(const company of [false,true])for(const rejected of ["authentication.otp.issued","outbox.job.enqueued"])
test((company?"Company":"Worker")+" issuance rolls back challenge, encrypted intent and queue when required "+rejected+" audit fails",async()=>{
 const f=await fixture(company);try{
  await f.db.query(`CREATE FUNCTION delivery_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN IF NEW.action_key='${rejected}' THEN RAISE EXCEPTION 'required delivery audit unavailable'; END IF; RETURN NEW; END; $$`);
  await f.db.query("CREATE TRIGGER delivery_audit_failure BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION delivery_test_reject_audit()");
  await assert.rejects(f.service.start(company?COMPANY:WORKER),/required delivery audit unavailable/);
  for(const table of ["auth_accounts","auth_otp_challenges","auth_registration_delivery_intents","platform_outbox_jobs"])
   assert.equal((await f.db.query("SELECT count(*)::int AS count FROM "+table)).rows[0].count,f.baseline[table]);
 }finally{await f.db.close();}
});
for(const mutation of ["expired","invalidated","consumed","exhausted","flow_expired"])
test("Registered dispatcher never sends "+mutation+" challenge",async()=>{
 const f=await fixture();try {
  await f.service.start(WORKER);
  if(mutation==="expired")await f.db.query("UPDATE auth_otp_challenges SET created_at=CURRENT_TIMESTAMP-INTERVAL '20 minutes',resend_available_at=CURRENT_TIMESTAMP-INTERVAL '19 minutes',expires_at=CURRENT_TIMESTAMP-INTERVAL '1 minute'");
  if(mutation==="invalidated")await f.db.query("UPDATE auth_otp_challenges SET invalidated_at=CURRENT_TIMESTAMP");
  if(mutation==="consumed")await f.db.query("UPDATE auth_otp_challenges SET consumed_at=CURRENT_TIMESTAMP");
  if(mutation==="exhausted")await f.db.query("UPDATE auth_otp_challenges SET attempts_remaining=0");
  if(mutation==="flow_expired")await f.db.query("UPDATE auth_registration_flows SET created_at=CURRENT_TIMESTAMP-INTERVAL '2 hours',expires_at=CURRENT_TIMESTAMP-INTERVAL '1 minute'");
  let calls=0;const job=await dispatch(f,async()=>{calls++;throw new Error("must not send");});
  assert.equal(calls,0);assert.equal(job.status,"succeeded");
  assert.equal((await intent(f)).status,"obsolete");assert.equal((await intent(f)).payload_ciphertext,null);
 }finally{await f.db.close();}
});
test("Email retry uses the same challenge idempotency key and clears ciphertext only after acceptance",async()=>{
 const f=await fixture();try{
  await f.service.start(WORKER);const first=await intent(f),keys=[];
  const failed=await dispatch(f,async(_endpoint,options)=>{keys.push(options.headers["Idempotency-Key"]);return new Response("sensitive provider text",{status:503});});
  assert.equal(failed.status,"retry_wait");assert.equal((await intent(f)).status,"queued");assert.ok((await intent(f)).payload_ciphertext);
  await f.db.query("UPDATE platform_outbox_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE job_id=$1",[failed.jobId]);
  const job=await dispatch(f,async(endpoint,options)=>{keys.push(options.headers["Idempotency-Key"]);return accepted(endpoint);});
  assert.equal(job.status,"succeeded");assert.deepEqual(keys,[first.challenge_id,first.challenge_id]);
  assert.equal((await intent(f)).payload_ciphertext,null);
 }finally{await f.db.close();}
});
for(const lostLease of [false,true])test("SMS "+(lostLease?"lost dispatch lease":"ambiguous provider response")+" is unknown and never blindly retried",async()=>{
 const f=await fixture();try{
  const started=await f.service.start(WORKER),email=await intent(f);
  await dispatch(f,accepted);
  await f.service.verify({token:started.token,code:email.payload.code,requestFingerprint:"sms-boundary"});
  const sms=await intent(f);let calls=0;
  if(lostLease)await f.db.query("UPDATE auth_registration_delivery_intents SET status='dispatching',dispatch_lease_id='lost-provider-lease' WHERE delivery_id=$1",[sms.delivery_id]);
  const job=await dispatch(f,async()=>{calls++;throw new Error("secret network error");});
  assert.equal(calls,lostLease?0:1);assert.equal(job.status,"terminal_failed");
  assert.equal((await intent(f)).status,"unknown");assert.equal((await intent(f)).payload_ciphertext,null);
  await f.db.query("UPDATE platform_outbox_jobs SET status='retry_wait',terminal_failed_at=NULL,next_attempt_at=CURRENT_TIMESTAMP WHERE job_id=$1",[job.jobId]);
  await dispatch(f,async()=>{calls++;throw new Error("must not retry");});assert.equal(calls,lostLease?0:1);
  const serialized=JSON.stringify((await f.db.query("SELECT * FROM platform_outbox_job_attempts")).rows);
  assert.ok(!serialized.includes("secret network error"));
 }finally{await f.db.close();}
});
test("Optional provider configuration rejects partial/invalid values without leaking secrets",()=>{
 const base={HSE_APP_ENV:"test",HSE_SESSION_SECRET:"test-session-secret-more-than-thirty-two"};
 assert.equal(validateRuntimeEnvironment(base).registrationOtpProviders,undefined);
 for(const extra of [{HSE_OTP_EMAIL_API_KEY:"private-fixture-secret"},{HSE_OTP_SMS_ACCOUNT_SID:"private-fixture-secret"},
  {HSE_OTP_EMAIL_API_KEY:"private-fixture-secret",HSE_OTP_EMAIL_FROM:"invalid sender"}])
  assert.throws(()=>validateRuntimeEnvironment({...base,...extra}),e=>!e.message.includes("private-fixture-secret"));
 assert.equal(validateRuntimeEnvironment({...base,HSE_OTP_EMAIL_API_KEY:"fixture",HSE_OTP_EMAIL_FROM:"verify@example.test"}).registrationOtpProviders.emailFrom,"verify@example.test");
});

test("Exhausted provider retry budget terminalizes and scrubs encrypted intent",async()=>{
 const f=await fixture();try{
  await f.service.start(WORKER);
  let job;
  for(let i=0;i<5;i++){
   job=await dispatch(f,async()=>new Response("provider error",{status:503}));
   if(i<4)await f.db.query("UPDATE platform_outbox_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE job_id=$1",[job.jobId]);
  }
  assert.equal(job.status,"terminal_failed");assert.equal((await intent(f)).status,"terminal");
  assert.equal((await intent(f)).payload_ciphertext,null);
 }finally{await f.db.close();}
});
test("Final expired SMS lease is unknown and scrubbed when queue terminalizes it",async()=>{
 const f=await fixture();try{
  const started=await f.service.start(WORKER),email=await intent(f);await dispatch(f,accepted);
  await f.service.verify({token:started.token,code:email.payload.code,requestFingerprint:"last-sms-lease"});
  const sms=await intent(f);
  const {createTrustedOutboxWorker}=loadWorkerRegistrationTs("src/lib/outbox/outbox-domain.ts");
  let claimed;
  for(let i=0;i<5;i++){
   claimed=await f.repository.claimNext(createTrustedOutboxWorker());
   if(i<4){
    await f.repository.retry(claimed.lease,{code:"fixture_not_dispatched",summary:"Local test has not dispatched."});
    await f.db.query("UPDATE platform_outbox_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE job_id=$1",[claimed.job.jobId]);
   }
  }
  await f.db.query("UPDATE auth_registration_delivery_intents SET status='dispatching',dispatch_lease_id=$2 WHERE delivery_id=$1",[sms.delivery_id,claimed.lease.leaseId]);
  await f.db.query("UPDATE platform_outbox_jobs SET lease_expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE job_id=$1",[claimed.job.jobId]);
  let calls=0;await dispatch(f,async()=>{calls++;throw new Error("must not resend");});assert.equal(calls,0);
  assert.equal((await intent(f)).status,"unknown");assert.equal((await intent(f)).payload_ciphertext,null);
 }finally{await f.db.close();}
});

for(const boundary of ["challenge","lease"])test("Fresh database clock denies "+boundary+" expiry after acquiring dispatch lock",async()=>{
 const f=await fixture();try{
  await f.service.start(WORKER);
  const {createTrustedOutboxWorker}=loadWorkerRegistrationTs("src/lib/outbox/outbox-domain.ts");
  const {processRegistrationDeliveryJob}=loadWorkerRegistrationTs("src/lib/auth/registration-delivery-handler.ts");
  const claimed=await f.repository.claimNext(createTrustedOutboxWorker());
  if(boundary==="challenge")await f.db.query("UPDATE auth_otp_challenges SET resend_available_at=created_at,expires_at=clock_timestamp()+INTERVAL '400 milliseconds'");
  else await f.db.query("UPDATE platform_outbox_jobs SET lease_expires_at=clock_timestamp()+INTERVAL '400 milliseconds' WHERE job_id=$1",[claimed.job.jobId]);
  const delayed={...f.db,query:f.db.query.bind(f.db),transaction:op=>f.db.transaction(tx=>op({
   ...tx,query:async(sql,args)=>{
    const result=await tx.query(sql,args);
    if(sql==="SELECT job_id FROM platform_outbox_jobs WHERE job_id=$1 FOR UPDATE")
     await new Promise(resolve=>setTimeout(resolve,700));
    return result;
   }
  }))};
  let calls=0;const dispatch=()=>processRegistrationDeliveryJob(claimed.job,claimed.lease,delayed,
   {pepper:ENV.authPepper,providers:PROVIDERS,fetcher:async()=>{calls++;return accepted("https://api.resend.com/emails");}});
  if(boundary==="lease")await assert.rejects(dispatch(),/lease expired/);
  else{assert.equal((await dispatch()).kind,"succeeded");assert.equal((await intent(f)).status,"obsolete");}
  assert.equal(calls,0);
 }finally{await f.db.close();}
});
test("Generic system enqueue stays denied; registration queue origin remains immutable",async()=>{
 const f=await fixture();try{
  const {bindTrustedSystemAuditActor}=loadWorkerRegistrationTs("src/lib/audit/audit-domain.ts");
  await assert.rejects(f.db.transaction(tx=>f.repository.enqueueInTransaction(tx,bindTrustedSystemAuditActor("registration-verification"),
   {jobType:"authentication.challenge.delivery",businessKey:"forged",payload:{dispatchRef:"delivery_"+"x".repeat(24)}})));
  await f.service.start(WORKER);
  await assert.rejects(f.db.query("UPDATE platform_outbox_jobs SET enqueued_system_component='outbox-worker' WHERE job_type='authentication.challenge.delivery'"),/immutable/);
 }finally{await f.db.close();}
});
test("Monotonic rollback/reapply preserves accepted history, scrubs pending outcomes and restores new-reference enforcement",async()=>{
 const f=await fixture();try{
  await f.service.start(WORKER);await dispatch(f,accepted);
  const acceptedBefore=(await f.db.query("SELECT * FROM auth_registration_delivery_intents WHERE status='accepted'")).rows;
  await f.service.start({...WORKER,email:"queued.rollback@example.test",phone:"+923007778891"});
  await f.service.start({...WORKER,email:"dispatching.rollback@example.test",phone:"+923007778892"});
  await f.db.query("UPDATE auth_registration_delivery_intents SET status='dispatching',dispatch_lease_id='fixture-live-lease' WHERE delivery_id=(SELECT delivery_id FROM auth_registration_delivery_intents WHERE status='queued' ORDER BY created_at DESC LIMIT 1)");
  const {readFileSync}=await import("node:fs");
  await f.db.transaction(tx=>tx.execute(readFileSync("database/migrations/0086_registration_otp_delivery.down.sql","utf8")));
  assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_registration_delivery_intents WHERE status='obsolete' AND payload_ciphertext IS NULL")).rows[0].n,1);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_registration_delivery_intents WHERE status='unknown' AND payload_ciphertext IS NULL AND dispatch_lease_id IS NULL")).rows[0].n,1);
  await f.db.transaction(tx=>tx.execute(readFileSync("database/migrations/0086_registration_otp_delivery.up.sql","utf8")));
  assert.deepEqual((await f.db.query("SELECT * FROM auth_registration_delivery_intents WHERE status='accepted'")).rows,acceptedBefore);
  await assert.rejects(f.db.query("INSERT INTO auth_registration_delivery_intents(delivery_id,challenge_id,status,created_at,updated_at) VALUES($1,'missing-challenge','obsolete',clock_timestamp(),clock_timestamp())",['delivery_'+ 'z'.repeat(24)]),/foreign key/);
  const second={...WORKER,email:"abandoned.worker@example.test",phone:"+923007778899"};
  await f.service.start(second);
  const row=(await f.db.query("SELECT account_id FROM auth_accounts WHERE email_normalized=$1",[second.email])).rows[0];
  await f.db.query("DELETE FROM auth_accounts WHERE account_id=$1",[row.account_id]);
  const orphan=(await f.db.query("SELECT * FROM auth_registration_delivery_intents WHERE challenge_id IS NULL")).rows[0];
  assert.equal(orphan.status,"obsolete");assert.equal(orphan.payload_ciphertext,null);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM auth_registration_delivery_intents WHERE status='accepted'")).rows[0].count,1);
 }finally{await f.db.close();}
});

test("Populated historical downgrade refusal is atomic and higher-layer reapply preserves history without replay",async()=>{
 const f=await fixture();const previous=process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
 process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK="true";
 try{
  await f.service.start(WORKER);await dispatch(f,accepted);
  await f.service.start({...WORKER,email:"lower.queued@example.test",phone:"+923007778881"});
  await f.service.start({...WORKER,email:"lower.dispatching@example.test",phone:"+923007778882"});
  await f.db.query("UPDATE auth_registration_delivery_intents SET status='dispatching',dispatch_lease_id='fixture-live-lease' WHERE delivery_id=(SELECT delivery_id FROM auth_registration_delivery_intents WHERE status='queued' ORDER BY created_at DESC LIMIT 1)");
  const acceptedBefore=(await f.db.query("SELECT * FROM auth_registration_delivery_intents WHERE status='accepted'")).rows;
  const {migrationStatus,rollbackLatestMigration}=await import("../../scripts/lib/migrations.mjs");
  const ids=(await migrationStatus(f.db)).filter(row=>row.applied).map(row=>row.id);
  const lower=ids.indexOf("0002_authentication_foundation");assert.ok(lower>=0);
  const incompatible=ids.indexOf("0084_assessment_timeout_submission");
  assert.ok(incompatible>=0);
  for(const id of ids.slice(incompatible+1).reverse())assert.equal(await rollbackLatestMigration(f.db,ENV),id);
  const ledgerBefore=(await f.db.query("SELECT * FROM hse_schema_migrations ORDER BY migration_id")).rows;
  await assert.rejects(rollbackLatestMigration(f.db,ENV),error=>error.code==='23502' && /enqueued_by_account_id/.test(error.message));
  assert.deepEqual((await f.db.query("SELECT * FROM hse_schema_migrations ORDER BY migration_id")).rows,ledgerBefore);
  assert.equal((await f.db.query("SELECT is_nullable FROM information_schema.columns WHERE table_name='platform_outbox_jobs' AND column_name='enqueued_by_account_id'")).rows[0].is_nullable,'YES');
  assert.deepEqual((await f.db.query("SELECT * FROM auth_registration_delivery_intents WHERE status='accepted'")).rows,acceptedBefore);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_registration_delivery_intents WHERE payload_ciphertext IS NOT NULL")).rows[0].n,0);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_registration_delivery_intents WHERE status='unknown'")).rows[0].n,1);
  assert.deepEqual(await applyMigrationsThrough(f.db,ENV.releaseSha+'-full-reapply',"0086_registration_otp_delivery"),ids.slice(incompatible+1));
  assert.deepEqual((await f.db.query("SELECT * FROM auth_registration_delivery_intents WHERE status='accepted'")).rows,acceptedBefore);
  await assert.rejects(f.db.query("INSERT INTO auth_registration_delivery_intents(delivery_id,challenge_id,status,created_at,updated_at) VALUES($1,'missing-challenge','obsolete',clock_timestamp(),clock_timestamp())",['delivery_'+ 'y'.repeat(24)]),/foreign key/);
  let sends=0;for(let i=0;i<4;i++){const job=await dispatch(f,()=>{sends++;throw new Error('Retained stale history must never send');});if(!job)break;}assert.equal(sends,0);
  await f.service.start({...WORKER,email:"reapplied.valid@example.test",phone:"+923007778883"});
  assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_registration_delivery_intents WHERE status='queued'")).rows[0].n,1);
 }finally{
  if(previous===undefined)delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=previous;
  await f.db.close();
 }
});

test("Reattaching challenge FK retains actual abandoned accepted history while rejecting new orphan references",async()=>{
 const f=await fixture();try{
  await f.service.start(WORKER);await dispatch(f,accepted);
  const before=(await f.db.query("SELECT * FROM auth_registration_delivery_intents WHERE status='accepted'")).rows;
  const {readFileSync}=await import("node:fs");
  await f.db.transaction(tx=>tx.execute(readFileSync("database/migrations/0086_registration_otp_delivery.down.sql","utf8")));
  const account=(await f.db.query("SELECT account_id FROM auth_accounts WHERE email_normalized=$1",[WORKER.email])).rows[0];
  await f.db.query("DELETE FROM auth_accounts WHERE account_id=$1",[account.account_id]);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_otp_challenges WHERE challenge_id=$1",[before[0].challenge_id])).rows[0].n,0);
  await f.db.transaction(tx=>tx.execute(readFileSync("database/migrations/0086_registration_otp_delivery.up.sql","utf8")));
  assert.deepEqual((await f.db.query("SELECT * FROM auth_registration_delivery_intents WHERE status='accepted'")).rows,before);
  await assert.rejects(f.db.query("INSERT INTO auth_registration_delivery_intents(delivery_id,challenge_id,status,created_at,updated_at) VALUES($1,'missing-new-challenge','obsolete',clock_timestamp(),clock_timestamp())",['delivery_'+ 'v'.repeat(24)]),/foreign key/);
 }finally{await f.db.close();}
});

const {encryptSecret}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
for(const field of ["destination","code"])test("Malformed encrypted intent "+field+" is rejected against persisted challenge before provider send",async()=>{
 const f=await fixture();try{
  await f.service.start(WORKER);const first=await intent(f);
  const payload={...first.payload,[field]:field==="destination"?"other.recipient@example.test":String((Number(first.payload.code)+1)%1000000).padStart(6,"0")};
  await f.db.query("UPDATE auth_registration_delivery_intents SET payload_ciphertext=$2 WHERE delivery_id=$1",
   [first.delivery_id,encryptSecret(JSON.stringify(payload),ENV.authPepper)]);
  let calls=0;const job=await dispatch(f,async endpoint=>{calls++;return accepted(endpoint);});
  assert.equal(calls,0);assert.equal(job.status,"terminal_failed");
  assert.equal((await intent(f)).status,"terminal");assert.equal((await intent(f)).payload_ciphertext,null);
 }finally{await f.db.close();}
});
