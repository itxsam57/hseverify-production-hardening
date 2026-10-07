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

const {AuthRecoveryService}=loadWorkerRegistrationTs("src/lib/auth/auth-recovery-service.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {hashPassword}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
test("Configured non-sandbox eligible Worker recovery persists a real flow and delivery challenge",async()=>{
 const db=await openScriptDatabase(ENV);await applyMigrationsThrough(db,ENV.releaseSha,"0087_recovery_otp_delivery");
 try {
  const repo=new AuthAccessRepository(db),accountId="provider-recovery-account",email="provider.recovery@example.test";
  await repo.authentication.insertAccount({accountId,email,phone:null,displayName:"Provider Recovery",status:"pending_email",
   passwordHash:await hashPassword("RecoveryProvider!Password2026",ENV.authPepper),workerReference:"HSE-REG-PROVIDERRECOVERY",now:NOW});
  await repo.authentication.updateAccountAfterEmailVerification(accountId,NOW);await repo.authentication.addRole(accountId,"worker",NOW);
  const service=new AuthRecoveryService(repo,{pepper:ENV.authPepper,sandboxEnabled:false,registrationDeliveryChannels:["email"]});
  const result=await service.request({role:"worker",email,requestFingerprint:"provider-recovery-fixture"});
  assert.ok(result.token);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_recovery_flows WHERE account_id=$1",[accountId])).rows[0].count,1);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_otp_challenges WHERE account_id=$1 AND purpose='password_reset'",[accountId])).rows[0].count,1);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_sandbox_deliveries")).rows[0].count,0);
 }finally{await db.close();}
});

const PROVIDERS={emailApiKey:"fixture-email-key",emailFrom:"verify@example.test"};
setWorkerRegistrationRuntimeEnvironment({...ENV,authSandboxEnabled:false,registrationOtpProviders:PROVIDERS});
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob}=loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const OLD_PASSWORD="RecoveryProvider!Password2026",NEW_PASSWORD="RecoveryUpdated!Password2026";
async function fixture(role="worker",channels=["email"],offset=0) {
 const db=await openScriptDatabase(ENV);await applyMigrationsThrough(db,ENV.releaseSha,"0087_recovery_otp_delivery");
 const repo=new AuthAccessRepository(db),accountId="recovery_"+role,email=role+".recovery@example.test",now=new Date().toISOString();
 await repo.authentication.insertAccount({accountId,email,phone:null,displayName:"Recovery "+role,status:"pending_email",
   passwordHash:await hashPassword(OLD_PASSWORD,ENV.authPepper),workerReference:role==="worker"?"HSE-REG-RECOVERY":null,now});
 await repo.authentication.updateAccountAfterEmailVerification(accountId,now);await repo.authentication.addRole(accountId,role,now);
 const service=new AuthRecoveryService(repo,{pepper:ENV.authPepper,sandboxEnabled:false,registrationDeliveryChannels:channels},()=>new Date(Date.now()+offset));
 return {db,repo,service,accountId,email,role,advance:milliseconds=>{offset+=milliseconds;},repository:new DatabaseOutboxRepository(Promise.resolve(db))};
}
async function dispatch(f,fetcher) {
 const old=globalThis.fetch;globalThis.fetch=fetcher;
 try{return await processNextOutboxJob({database:f.db,repository:f.repository});}finally{globalThis.fetch=old;}
}
async function intent(f) {
 const row=(await f.db.query("SELECT * FROM auth_registration_delivery_intents ORDER BY created_at DESC")).rows[0];
 return {...row,payload:row.payload_ciphertext?JSON.parse(decryptSecret(row.payload_ciphertext,ENV.authPepper)):null};
}
for(const role of ["worker","company","assessor","verifier","admin","root"])test(role+" configured recovery -> registered dispatch -> password reset and session revocation",async()=>{
 const f=await fixture(role);try {
  const sid="recovery_session_"+role;
  await f.db.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,expires_at) VALUES($1,$2,$3,$1,$1,'2099-01-01')",[sid,f.accountId,role]);
  const {token}=await f.service.request({role,email:f.email,requestFingerprint:"recovery-"+role});
  const pending=await intent(f);assert.equal(pending.status,"queued");assert.equal(pending.payload.purpose,"password_reset");
  assert.equal((await f.db.query("SELECT enqueued_system_component FROM platform_outbox_jobs WHERE job_type='authentication.challenge.delivery'")).rows[0].enqueued_system_component,"recovery-verification");
  let calls=0;
  const job=await dispatch(f,async(url,options)=>{
   calls++;assert.equal(url,"https://api.resend.com/emails");assert.equal(options.headers["Idempotency-Key"],pending.challenge_id);
   const body=JSON.parse(options.body);assert.deepEqual(body.to,[f.email]);assert.ok(body.text.includes(pending.payload.code));
   return new Response(JSON.stringify({id:"recovery-provider-accepted"}),{status:200});
  });
  assert.equal(job.status,"succeeded");assert.equal(calls,1);
  assert.equal((await intent(f)).payload_ciphertext,null);assert.equal((await f.service.readState(token)).deliveryStatus,"accepted");
  assert.deepEqual(await f.service.resetPassword({token,code:pending.payload.code,password:NEW_PASSWORD}),{role});
  assert.ok((await f.db.query("SELECT revoked_at FROM auth_sessions WHERE session_id=$1",[sid])).rows[0].revoked_at);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_sessions WHERE revoked_at IS NULL")).rows[0].n,0);
  const account=await f.repo.authentication.findAccountById(f.accountId);
  const {verifyPassword}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
  assert.equal(await verifyPassword(NEW_PASSWORD,account.passwordHash,ENV.authPepper),true);
  assert.equal(await verifyPassword(OLD_PASSWORD,account.passwordHash,ENV.authPepper),false);
  await assert.rejects(f.service.resetPassword({token,code:pending.payload.code,password:NEW_PASSWORD}),e=>e.code==="invalid_code");
  assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_sandbox_deliveries")).rows[0].n,0);
 }finally{await f.db.close();}
});

test("Production recovery request/resend/reset do not distinguish unknown account or wrong role",async()=>{
 const f=await fixture();try {
  const eligible=await f.service.request({role:"worker",email:f.email,requestFingerprint:"eligible"});
  const unknown=await f.service.request({role:"worker",email:"unknown@example.test",requestFingerprint:"unknown"});
  const wrongRole=await f.service.request({role:"admin",email:f.email,requestFingerprint:"wrong-role"});
  for(const result of [eligible,unknown,wrongRole])assert.deepEqual(Object.keys(result),["token"]);
  const pending=await intent(f);
  for(const result of [eligible,unknown,wrongRole])await f.service.resend({token:result.token});
  assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_registration_delivery_intents")).rows[0].n,1);
  const messages=[];
  for(const result of [eligible,unknown,wrongRole]) {
   try {await f.service.resetPassword({token:result.token,code:pending.payload.code==="000000"?"111111":"000000",password:NEW_PASSWORD});assert.fail("Must reject");}
   catch(e){messages.push({code:e.code,message:e.userMessage});}
  }
  assert.deepEqual(messages,[messages[0],messages[0],messages[0]]);
  assert.deepEqual(messages[0],{code:"invalid_code",message:"The verification code is invalid or expired."});
 }finally{await f.db.close();}
});

for(const branch of ["expired","invalidated","consumed","exhausted","flow_expired","role_revoked"])test("Recovery dispatcher skips "+branch+" authority without provider send",async()=>{
 const f=await fixture("worker",["email"],branch==="expired"?-11*60000:0);try {
  await f.service.request({role:"worker",email:f.email,requestFingerprint:branch});
  const pending=await intent(f);
  const changes={invalidated:"invalidated_at=CURRENT_TIMESTAMP",consumed:"consumed_at=CURRENT_TIMESTAMP",exhausted:"attempts_remaining=0"};
  if(changes[branch])await f.db.query("UPDATE auth_otp_challenges SET "+changes[branch]+" WHERE challenge_id=$1",[pending.challenge_id]);
  if(branch==="flow_expired") { await f.db.query("UPDATE auth_recovery_flows SET expires_at=clock_timestamp()+INTERVAL '100 milliseconds' WHERE challenge_id=$1",[pending.challenge_id]); await new Promise(resolve=>setTimeout(resolve,150)); }
  if(branch==="role_revoked")await f.db.query("DELETE FROM auth_account_roles WHERE account_id=$1 AND role='worker'",[f.accountId]);
  let calls=0;const job=await dispatch(f,async()=>{calls++;throw new Error("No send");});
  assert.equal(calls,0);assert.equal(job.status,"succeeded");
  assert.equal((await intent(f)).status,"obsolete");assert.equal((await intent(f)).payload_ciphertext,null);
 }finally{await f.db.close();}
});
for(const action of ["authentication.otp.issued","outbox.job.enqueued","authentication.password_reset.requested"])test("Recovery "+action+" audit failure rolls back complete issuance",async()=>{
 const f=await fixture();try {
  await f.db.execute("CREATE FUNCTION reject_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='"+action+"' THEN RAISE EXCEPTION 'injected recovery audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_recovery_audit BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION reject_recovery_audit();");
  await assert.rejects(f.service.request({role:"worker",email:f.email,requestFingerprint:"rollback"}),/injected recovery audit failure/);
  for(const table of ["auth_recovery_flows","auth_otp_challenges","auth_registration_delivery_intents","platform_outbox_jobs"])assert.equal((await f.db.query("SELECT count(*)::int n FROM "+table)).rows[0].n,0);
 }finally{await f.db.close();}
});
test("Recovery safe email retry preserves idempotency and required fixed origin",async()=>{
 const f=await fixture();try {
  await f.service.request({role:"worker",email:f.email,requestFingerprint:"retry"});
  const pending=await intent(f);let keys=[];
  await assert.rejects(f.repository.enqueueRegistrationDelivery(f.db,pending.delivery_id),/binding/);
  const first=await dispatch(f,async(url,options)=>{keys.push(options.headers["Idempotency-Key"]);return new Response("unavailable",{status:503});});
  assert.equal(first.status,"retry_wait");assert.equal((await intent(f)).status,"queued");assert.ok((await intent(f)).payload_ciphertext);
  await f.db.query("UPDATE platform_outbox_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE job_id=$1",[first.jobId]);
  const second=await dispatch(f,async(url,options)=>{keys.push(options.headers["Idempotency-Key"]);return new Response(JSON.stringify({id:"retry-accepted"}),{status:200});});
  assert.equal(second.status,"succeeded");assert.deepEqual(keys,[pending.challenge_id,pending.challenge_id]);assert.equal((await intent(f)).payload_ciphertext,null);
 }finally{await f.db.close();}
});
test("Recovery resend invalidates old challenge delivery and binds queue to new flow challenge",async()=>{
 const f=await fixture("worker",["email"],-61000);try {
  const {token}=await f.service.request({role:"worker",email:f.email,requestFingerprint:"resend"});
  const previous=await intent(f);

  await f.service.resend({token});
  const current=await intent(f);assert.notEqual(current.challenge_id,previous.challenge_id);
  assert.equal((await f.db.query("SELECT challenge_id FROM auth_recovery_flows WHERE consumed_at IS NULL")).rows[0].challenge_id,current.challenge_id);
  let calls=0;const fetcher=async()=>{calls++;return new Response(JSON.stringify({id:"resend-accepted"}),{status:200});};
  await dispatch(f,fetcher);await dispatch(f,fetcher);assert.equal(calls,1);
  const old=(await f.db.query("SELECT status,payload_ciphertext FROM auth_registration_delivery_intents WHERE delivery_id=$1",[previous.delivery_id])).rows[0];
  assert.deepEqual(old,{status:"obsolete",payload_ciphertext:null});
  await assert.rejects(f.service.resetPassword({token,code:previous.payload.code,password:NEW_PASSWORD}),e=>e.code==="invalid_code");
  await f.service.resetPassword({token,code:current.payload.code,password:NEW_PASSWORD});
 }finally{await f.db.close();}
});
test("Recovery five wrong codes exhaust challenge with committed audit and no password change",async()=>{
 const f=await fixture();try {
  const {token}=await f.service.request({role:"worker",email:f.email,requestFingerprint:"attempts"}),pending=await intent(f);
  const wrong=pending.payload.code==="000000"?"111111":"000000";
  for(let i=0;i<5;i++)await assert.rejects(f.service.resetPassword({token,code:wrong,password:NEW_PASSWORD}),e=>e.code==="invalid_code");
  const challenge=(await f.db.query("SELECT attempts_remaining FROM auth_otp_challenges WHERE challenge_id=$1",[pending.challenge_id])).rows[0];
  assert.equal(challenge.attempts_remaining,0);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM platform_audit_events WHERE action_key='authentication.otp.failed'")).rows[0].n,5);
  await assert.rejects(f.service.resetPassword({token,code:pending.payload.code,password:NEW_PASSWORD}),e=>e.code==="invalid_code");
  const account=await f.repo.authentication.findAccountById(f.accountId);const {verifyPassword}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");assert.equal(await verifyPassword(OLD_PASSWORD,account.passwordHash,ENV.authPepper),true);
 }finally{await f.db.close();}
});

for(const boundary of ["flow","challenge"])test("Fresh reset database clock denies expiry after acquiring "+boundary+" lock",async()=>{
 const f=await fixture();try {
  const {token}=await f.service.request({role:"worker",email:f.email,requestFingerprint:"late-reset-"+boundary}),pending=await intent(f);
  if(boundary==="flow")await f.db.query("UPDATE auth_recovery_flows SET expires_at=clock_timestamp()+INTERVAL '500 milliseconds' WHERE challenge_id=$1",[pending.challenge_id]);
  else await f.db.query("UPDATE auth_otp_challenges SET expires_at=clock_timestamp()+INTERVAL '500 milliseconds',resend_available_at=created_at WHERE challenge_id=$1",[pending.challenge_id]);
  const original=f.repo.transaction.bind(f.repo);
  f.repo.transaction=operation=>original(async repo=>{
   const holder=boundary==="flow"?repo:repo.authentication;
   const method=boundary==="flow"?"findRecoveryFlowForUpdate":"findOtpChallengeForUpdate",find=holder[method].bind(holder);
   holder[method]=async(...args)=>{const value=await find(...args);await new Promise(resolve=>setTimeout(resolve,700));return value;};
   return operation(repo);
  });
  await assert.rejects(f.service.resetPassword({token,code:pending.payload.code,password:NEW_PASSWORD}),e=>e.code==="invalid_code");
  const account=await f.repo.authentication.findAccountById(f.accountId);const {verifyPassword}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");assert.equal(await verifyPassword(OLD_PASSWORD,account.passwordHash,ENV.authPepper),true);
  assert.equal((await f.db.query("SELECT consumed_at FROM auth_recovery_flows WHERE challenge_id=$1",[pending.challenge_id])).rows[0].consumed_at,null);
 }finally{await f.db.close();}
});
test("Fresh resend database clock skips flow expired while waiting for its lock",async()=>{
 const f=await fixture("worker",["email"],-61000);try {
  const {token}=await f.service.request({role:"worker",email:f.email,requestFingerprint:"late-resend"}),pending=await intent(f);
  await f.db.query("UPDATE auth_recovery_flows SET expires_at=clock_timestamp()+INTERVAL '500 milliseconds' WHERE challenge_id=$1",[pending.challenge_id]);
  const original=f.repo.transaction.bind(f.repo);
  f.repo.transaction=operation=>original(async repo=>{
   const find=repo.findRecoveryFlowForUpdate.bind(repo);
   repo.findRecoveryFlowForUpdate=async(...args)=>{const value=await find(...args);await new Promise(resolve=>setTimeout(resolve,700));return value;};
   return operation(repo);
  });
  await f.service.resend({token});assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_registration_delivery_intents")).rows[0].n,1);
  assert.equal((await f.db.query("SELECT challenge_id FROM auth_recovery_flows")).rows[0].challenge_id,pending.challenge_id);
 }finally{await f.db.close();}
});
test("Encrypted JSON null is terminalized and scrubbed without provider send",async()=>{
 const f=await fixture();try {
  await f.service.request({role:"worker",email:f.email,requestFingerprint:"malformed"});
  const pending=await intent(f);const {encryptSecret}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
  await f.db.query("UPDATE auth_registration_delivery_intents SET payload_ciphertext=$2 WHERE delivery_id=$1",[pending.delivery_id,encryptSecret("null",ENV.authPepper)]);
  let calls=0;const job=await dispatch(f,async()=>{calls++;throw new Error("No send");});assert.equal(calls,0);assert.equal(job.status,"terminal_failed");
  assert.equal((await intent(f)).status,"terminal");assert.equal((await intent(f)).payload_ciphertext,null);
 }finally{await f.db.close();}
});


test("Populated recovery history survives0087/0086 rollback and additive reapply without widening generic enqueue",async()=>{
 const f=await fixture();const previous=process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK='true';
 try {
  await f.service.request({role:'worker',email:f.email,requestFingerprint:'history-accepted'});
  await dispatch(f,async()=>new Response(JSON.stringify({id:'history-accepted'}),{status:200}));
  const acceptedBefore=(await f.db.query("SELECT * FROM auth_registration_delivery_intents WHERE status='accepted'")).rows;
  const account=await f.repo.authentication.findAccountById(f.accountId);
  for(const role of ['company','admin']){
   const id='history_recovery_'+role,email=role+'.history.recovery@example.test',now=new Date().toISOString();
   await f.repo.authentication.insertAccount({accountId:id,email,phone:null,displayName:'History recovery '+role,status:'pending_email',passwordHash:account.passwordHash,workerReference:null,now});
   await f.repo.authentication.updateAccountAfterEmailVerification(id,now);await f.repo.authentication.addRole(id,role,now);
   await f.service.request({role,email,requestFingerprint:'history-'+role});
  }
  await f.db.query("UPDATE auth_registration_delivery_intents SET status='dispatching',dispatch_lease_id='fixture-recovery-lease' WHERE delivery_id=(SELECT delivery_id FROM auth_registration_delivery_intents WHERE status='queued' ORDER BY created_at DESC LIMIT 1)");
  const {rollbackLatestMigration}=await import('../../scripts/lib/migrations.mjs');
  assert.equal(await rollbackLatestMigration(f.db,ENV),'0087_recovery_otp_delivery');
  assert.equal(await rollbackLatestMigration(f.db,ENV),'0086_registration_otp_delivery');
  assert.deepEqual(await applyMigrationsThrough(f.db,ENV.releaseSha+'-history-reapply','0087_recovery_otp_delivery'),['0086_registration_otp_delivery','0087_recovery_otp_delivery']);
  assert.deepEqual((await f.db.query("SELECT * FROM auth_registration_delivery_intents WHERE status='accepted'")).rows,acceptedBefore);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_registration_delivery_intents WHERE payload_ciphertext IS NOT NULL")).rows[0].n,0);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_registration_delivery_intents WHERE status='obsolete'")).rows[0].n,1);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_registration_delivery_intents WHERE status='unknown'")).rows[0].n,1);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM platform_outbox_jobs WHERE enqueued_system_component='recovery-verification'")).rows[0].n,3);
  let sends=0;for(let i=0;i<4;i++){const job=await dispatch(f,()=>{sends++;throw new Error('Retained obsolete/unknown recovery must never send');});if(!job)break;}assert.equal(sends,0);
  await assert.rejects(f.db.query("INSERT INTO auth_registration_delivery_intents(delivery_id,challenge_id,status,created_at,updated_at) VALUES($1,'missing-recovery-challenge','obsolete',clock_timestamp(),clock_timestamp())",['delivery_'+ 'r'.repeat(24)]),/foreign key/);
  await f.service.request({role:'worker',email:f.email,requestFingerprint:'history-new-valid'});
  const fresh=await intent(f),{bindTrustedSystemAuditActor}=loadWorkerRegistrationTs('src/lib/audit/audit-domain.ts');
  await assert.rejects(f.db.transaction(tx=>f.repository.enqueueInTransaction(tx,bindTrustedSystemAuditActor('recovery-verification'),{jobType:'authentication.challenge.delivery',businessKey:'forged-generic-recovery',payload:{dispatchRef:fresh.delivery_id}})));
  assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_registration_delivery_intents WHERE status='queued'")).rows[0].n,1);
  assert.equal((await dispatch(f,async()=>new Response(JSON.stringify({id:'new-history-valid'}),{status:200}))).status,'succeeded');
 }finally{if(previous===undefined)delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=previous;await f.db.close();}
});

 test("Authentication outbox rejects null origin after initial migrations and reapply", async()=>{
 const db=await openScriptDatabase(ENV);const previous=process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK='true';
 try {
 const deny=async label=>assert.rejects(db.query("INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,enqueued_by_account_id,enqueued_by_role,enqueued_system_component,tenant_id,membership_id) VALUES($1,'authentication.challenge.delivery',1,$2,'{}'::jsonb,NULL,NULL,NULL,NULL,NULL)",['job_null_origin_'+label,'a'.repeat(64)]),error=>error.code==='23514' && error.constraint==='platform_outbox_enqueue_origin');
 await applyMigrationsThrough(db,ENV.releaseSha,'0086_registration_otp_delivery');await deny('registration');
 await applyMigrationsThrough(db,ENV.releaseSha,'0087_recovery_otp_delivery');await deny('recovery');
 const {rollbackLatestMigration}=await import('../../scripts/lib/migrations.mjs');
 await rollbackLatestMigration(db,ENV);await rollbackLatestMigration(db,ENV);
 await applyMigrationsThrough(db,ENV.releaseSha,'0087_recovery_otp_delivery');await deny('reapply');
 }finally{if(previous===undefined)delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=previous;await db.close();}
 });
