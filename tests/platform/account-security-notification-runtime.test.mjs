
import assert from "node:assert/strict";
import test from "node:test";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {AuthRecoveryService}=loadWorkerRegistrationTs("src/lib/auth/auth-recovery-service.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {hashPassword,verifyPassword,decryptSecret}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
const ENV={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",releaseSha:"recovery-otp-runtime",
sessionSecret:"recovery-runtime-session-secret-more-than-thirty-two",authPepper:"recovery-runtime-pepper-more-than-thirty-two",authSandboxEnabled:true,authSandboxAccessKey:"recovery-test-sandbox-key",demoAuthEnabled:false,demoDataEnabled:false};
const NOW="2026-10-05T03:00:00.000Z",OLD="RecoveryOld!Password2026",NEW="RecoveryNew!Password2026";
async function fixture(role="worker") {
  const db=await openScriptDatabase(ENV);await applyMigrationsThrough(db,ENV.releaseSha,"0080_staff_invitation_revocation_audit");
  const repo=new AuthAccessRepository(db), accountId="recovery-"+role+"-account",email=role+".recovery@example.test";
  await repo.authentication.insertAccount({accountId,email,phone:null,displayName:"Recovery "+role,status:"pending_email",passwordHash:await hashPassword(OLD,ENV.authPepper),workerReference:role==="worker"?"HSE-REG-RECOVERYTEST":null,now:NOW});
  await repo.authentication.updateAccountAfterEmailVerification(accountId,NOW);await repo.authentication.addRole(accountId,role,NOW);
  for(const suffix of ["one","two"]) await repo.authentication.insertSession({sessionId:"recovery-"+role+"-"+suffix,accountId,activeRole:role,tokenHash:"token-"+role+"-"+suffix,csrfTokenHash:"csrf-"+role+"-"+suffix,userAgentHash:null,ipAddressHash:null,createdAt:NOW,lastSeenAt:NOW,expiresAt:"2026-10-06T03:00:00.000Z"});
  const service=new AuthRecoveryService(repo,{pepper:ENV.authPepper,sandboxEnabled:true},()=>new Date(NOW));
  const request=await service.request({role,email,requestFingerprint:"recovery-fixture"});
  const delivery=(await db.query("SELECT d.encrypted_code,c.challenge_id FROM auth_sandbox_deliveries d JOIN auth_otp_challenges c ON c.challenge_id=d.challenge_id WHERE c.account_id=$1 AND c.purpose='password_reset'",[accountId])).rows[0];
  const code=decryptSecret(delivery.encrypted_code,ENV.authPepper);
  return {db,repo,service,accountId,email,token:request.token,code,challengeId:delivery.challenge_id};
}
const wrong=code=>String((Number(code)+1)%1000000).padStart(6,"0");
async function accountState(db,accountId) {return (await db.query("SELECT * FROM auth_accounts WHERE account_id=$1",[accountId])).rows[0];}
async function failedAudit(db,accountId) {return (await db.query("SELECT actor_account_id,actor_role,metadata FROM platform_audit_events WHERE action_key='authentication.otp.failed' AND actor_account_id=$1 ORDER BY occurred_at,audit_event_id",[accountId])).rows;}

const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob}=loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const {DatabaseNotificationRepository}=loadWorkerRegistrationTs("src/lib/notifications/notification-repository.ts");
const {accountSecurityNotificationType,notificationContent}=loadWorkerRegistrationTs("src/lib/notifications/notification-domain.ts");
async function ready(){const f=await fixture();await applyMigrationsThrough(f.db,ENV.releaseSha,"0082_account_security_notifications");f.outbox=new DatabaseOutboxRepository(Promise.resolve(f.db));return f;}
async function work(f){return processNextOutboxJob({repository:f.outbox,database:f.db});}
async function queueState(f){return (await f.db.query("SELECT job_id,job_type,payload,enqueued_by_account_id,enqueued_by_role,status,attempt_count,tenant_id,membership_id FROM platform_outbox_jobs ORDER BY job_sequence")).rows;}
test("Actual password recovery queues and real worker projects one safe security notification idempotently",async()=>{
 const f=await ready();try{
  await f.service.resetPassword({token:f.token,code:f.code,password:NEW});
  const jobs=await queueState(f);assert.equal(jobs.length,1);assert.equal(jobs[0].job_type,"notification.account.security");assert.equal(jobs[0].enqueued_by_account_id,f.accountId);assert.equal(jobs[0].enqueued_by_role,"worker");assert.deepEqual(Object.keys(jobs[0].payload),["eventRef"]);assert.equal(jobs[0].status,"pending");
  const job=await work(f);assert.equal(job.status,"succeeded");assert.equal(job.attemptCount,1);
  const notices=(await f.db.query("SELECT notification_type,title,body,metadata,target_key,target_reference,read_at FROM platform_notifications WHERE recipient_account_id=$1",[f.accountId])).rows;
  assert.equal(notices.length,1);assert.equal(notices[0].notification_type,"account.password.reset");assert.equal(notices[0].title,"Password reset");assert.equal(notices[0].target_key,"account.security");assert.equal(notices[0].target_reference,null);assert.equal(notices[0].read_at,null);assert.deepEqual(notices[0].metadata,jobs[0].payload);
  const again=await new DatabaseNotificationRepository(Promise.resolve(f.db)).projectInTransaction(f.db,job);assert.equal(again.created,false);assert.equal(await work(f),null);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE action_key='outbox.job.enqueued' AND target_reference=$1",[job.jobId])).rows[0].count,1);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE action_key='notification.projected'",[])).rows[0].count,1);
  await assert.rejects(new DatabaseNotificationRepository(Promise.resolve(f.db)).projectInTransaction(f.db,{...job,enqueuedByAccountId:"foreign_account"}),/could not be accessed/);
  await f.db.execute(await import("node:fs/promises").then(m=>m.readFile("database/migrations/0082_account_security_notifications.down.sql","utf8")));
  await f.db.execute(await import("node:fs/promises").then(m=>m.readFile("database/migrations/0082_account_security_notifications.up.sql","utf8")));
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM platform_notifications")).rows[0].count,1);
  await assert.rejects(f.db.query("DELETE FROM platform_notifications"),/cannot be deleted/);
  console.log("ACTUAL_SECURITY_NOTIFICATION_RECOVERY native intent, real claim/project/succeed, idempotency, source binding and retained immutable history");
 }finally{await f.db.close();}
});
test("All four security completions project exact six-role notices, including pending Company scope",async()=>{
 const f=await ready();try{
  const roles=["worker","company","assessor","verifier","admin","root"],events=["password_changed","password_reset_completed","mfa_replaced","mfa_recovery_codes_rotated"];
  for(const role of roles){
   const id="security_notification_"+role;
   await f.repo.authentication.insertAccount({accountId:id,email:role+".notification@example.test",phone:null,displayName:"Security notification "+role,status:"pending_email",passwordHash:null,workerReference:null,now:NOW});await f.repo.authentication.updateAccountAfterEmailVerification(id,NOW);await f.repo.authentication.addRole(id,role,NOW);
   if(role==="company"){
    await f.db.query("INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at) VALUES('tenant_ssssssssssssssssssssssss','company','Security Notice Company','pending',$1,$2,$2)",[id,NOW]);
    await f.db.query("INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at) VALUES('membership_mmmmmmmmmmmmmmmmmmmmmmmm','tenant_ssssssssssssssssssssssss',$1,'company','owner','active',$1,$2,$2,$2)",[id,NOW]);
   }
   for(const eventType of events)await f.repo.authentication.insertSecurityEvent({eventId:"event_notice_"+role+"_"+eventType,accountId:id,eventType,activeRole:role,metadata:{},occurredAt:NOW});
  }
  assert.equal((await queueState(f)).length,24);for(let i=0;i<24;i++)assert.equal((await work(f)).status,"succeeded");assert.equal(await work(f),null);
  for(const role of roles){
   const notices=(await f.db.query("SELECT n.*,e.event_type,e.account_id,e.active_role FROM platform_notifications n JOIN auth_security_events e ON e.event_id=n.metadata->>'eventRef' WHERE n.recipient_account_id=$1 ORDER BY notification_type",["security_notification_"+role])).rows;assert.equal(notices.length,4);
   for(const n of notices){const type=accountSecurityNotificationType(n.event_type),content=notificationContent(type);assert.equal(n.notification_type,type);assert.equal(n.title,content.title);assert.equal(n.body,content.body);assert.equal(n.recipient_role,role);assert.equal(n.account_id,n.recipient_account_id);assert.equal(n.active_role,role);assert.deepEqual(Object.keys(n.metadata),["eventRef"]);assert.equal(n.target_key,"account.security");assert.equal(n.target_reference,null);assert.equal(n.read_at,null);assert.equal(n.tenant_id,role==="company"?"tenant_ssssssssssssssssssssssss":null);assert.equal(n.membership_id,role==="company"?"membership_mmmmmmmmmmmmmmmmmmmmmmmm":null);}
  }
  const workerNotice=(await f.db.query("SELECT * FROM platform_notifications WHERE recipient_account_id='security_notification_worker' AND notification_type='account.password.changed'")).rows[0];
  for(const overrides of [{title:"Forged title"},{body:"Forged content"},{notification_type:"account.mfa.replaced"},{metadata:{eventRef:"missing_event"}},{recipient_role:"admin"}]) await assert.rejects(rawNotice(f.db,workerNotice,overrides),/notification .* (match|scope)/);
  for(const [index,eventRef] of ["missing_event","event_notice_assessor_password_changed"].entries()){
   const jobId="job_"+String(index+1).repeat(24);
   await f.db.query("INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,enqueued_by_account_id,enqueued_by_role) VALUES($1,'notification.account.security',1,$2,$3::jsonb,'security_notification_worker','worker')",[jobId,String(index+1).repeat(64),JSON.stringify({eventRef})]);
   await assert.rejects(rawNotice(f.db,workerNotice,{source_job_id:jobId,metadata:{eventRef}}),/security notification does not match its source event/);
  }
  const companyNotice=(await f.db.query("SELECT * FROM platform_notifications WHERE recipient_account_id='security_notification_company' LIMIT 1")).rows[0];
  await assert.rejects(rawNotice(f.db,companyNotice,{tenant_id:"tenant_"+ "x".repeat(24),membership_id:"membership_"+ "x".repeat(24)}),/notification recipient scope does not match/);
  const foundationJob="job_"+ "f".repeat(24);
  await f.db.query("INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,enqueued_by_account_id,enqueued_by_role,tenant_id,membership_id) VALUES($1,'notification.portal.foundation',1,$2,$3::jsonb,'security_notification_company','company','tenant_ssssssssssssssssssssssss','membership_mmmmmmmmmmmmmmmmmmmmmmmm')",[foundationJob,"f".repeat(64),JSON.stringify({fixtureRef:"foundation_after_security"})]);
  const foundation={...companyNotice,source_job_id:foundationJob,notification_type:"platform.foundation.ready",title:"Notification foundation ready",body:"This persisted notification verifies the current portal notification channel.",metadata:{fixtureRef:"foundation_after_security"},target_key:"portal.dashboard"};
  await assert.rejects(rawNotice(f.db,foundation),/notification recipient is not eligible/);
  await f.db.query("UPDATE platform_tenants SET tenant_status='active',activated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE tenant_id='tenant_ssssssssssssssssssssssss'");
  await rawNotice(f.db,foundation);
  console.log("ACTUAL_SECURITY_NOTIFICATION_SQL_BOUNDARIES missing/foreign source, forged content/type/metadata/role/Company scope denied; foundation pending denied and active accepted after0082");
  console.log("ACTUAL_24_ROLE_BOUND_SECURITY_NOTICES four authoritative event types, exact recipients/content and pending Company boundary");
 }finally{await f.db.close();}
});
test("Required queue failure rolls back actual recovery password, sessions, challenge, flow and completion audit",async()=>{
 const f=await ready();try{
  const snapshot=async()=>JSON.stringify(await Promise.all(["auth_accounts","auth_sessions","auth_otp_challenges","auth_recovery_flows"].map(async table=>(await f.db.query("SELECT * FROM "+table+" WHERE account_id=$1",[f.accountId])).rows)));
  const before=await snapshot();
  await f.db.execute("CREATE FUNCTION security_notice_reject_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled security queue unavailable'; END; $$; CREATE TRIGGER security_notice_queue_fault BEFORE INSERT ON platform_outbox_jobs FOR EACH ROW EXECUTE FUNCTION security_notice_reject_queue();");
  await assert.rejects(f.service.resetPassword({token:f.token,code:f.code,password:NEW}),/controlled security queue unavailable/);
  assert.ok(await snapshot()===before,"Required notification queue failure changed recovery state");assert.equal((await queueState(f)).length,0);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM auth_security_events WHERE event_type='password_reset_completed'")).rows[0].count,0);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE action_key='authentication.password_reset.completed'")).rows[0].count,0);
 }finally{await f.db.close();}
});
test("Notification projection outage retries without undoing accepted recovery",async()=>{
 const f=await ready();try{
  await f.service.resetPassword({token:f.token,code:f.code,password:NEW});
  await f.db.execute("CREATE FUNCTION security_notice_reject_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled notification destination unavailable'; END; $$; CREATE TRIGGER security_notice_projection_fault BEFORE INSERT ON platform_notifications FOR EACH ROW EXECUTE FUNCTION security_notice_reject_projection();");
  const retry=await work(f);assert.equal(retry.status,"retry_wait");assert.equal(retry.attemptCount,1);assert.equal(retry.lastErrorCode,"handler_exception");
  assert.equal(await verifyPassword(NEW,(await accountState(f.db,f.accountId)).password_hash,ENV.authPepper),true);
  assert.ok((await f.db.query("SELECT consumed_at FROM auth_recovery_flows WHERE account_id=$1",[f.accountId])).rows[0].consumed_at);assert.equal((await f.db.query("SELECT count(*)::int AS count FROM auth_sessions WHERE account_id=$1 AND revoked_at IS NULL",[f.accountId])).rows[0].count,0);
  await f.db.execute("DROP TRIGGER security_notice_projection_fault ON platform_notifications");await f.db.query("UPDATE platform_outbox_jobs SET next_attempt_at=CURRENT_TIMESTAMP - interval '1 second' WHERE job_id=$1",[retry.jobId]);
  const finished=await work(f);assert.equal(finished.status,"succeeded");assert.equal(finished.attemptCount,2);assert.equal((await f.db.query("SELECT count(*)::int AS count FROM platform_notifications")).rows[0].count,1);
  console.log("ACTUAL_SECURITY_NOTIFICATION_RETRY accepted recovery retained, real failed attempt retried exactly once");
 }finally{await f.db.close();}
});

async function rawNotice(db, base, overrides={}) {
 const fields=["notification_id","notification_type","schema_version","source_job_id","projection_key","recipient_account_id","recipient_role","tenant_id","membership_id","title","body","metadata","target_key","target_reference"];
 const value={...base,notification_id:"notification_"+(await import("node:crypto")).randomBytes(18).toString("base64url"),projection_key:(await import("node:crypto")).randomBytes(32).toString("hex"),...overrides};
 return db.query("INSERT INTO platform_notifications ("+fields.join(",")+") VALUES ("+fields.map((_,i)=>"$"+(i+1)).join(",")+")",fields.map(k=>k==="metadata"?JSON.stringify(value[k]):value[k]));
}
