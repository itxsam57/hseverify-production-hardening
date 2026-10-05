
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
test("Five rejected recovery codes persist attempts and audit, exhaust the challenge and preserve password/sessions",async()=>{
 const f=await fixture();try{
  const before=await accountState(f.db,f.accountId);
  for(let index=0;index<5;index++){
   await assert.rejects(f.service.resetPassword({token:f.token,code:wrong(f.code),password:NEW}),e=>e.code==="invalid_code");
   const row=(await f.db.query("SELECT attempts_remaining,invalidated_at,consumed_at FROM auth_otp_challenges WHERE challenge_id=$1",[f.challengeId])).rows[0];
   assert.equal(row.attempts_remaining,4-index);assert.equal(Boolean(row.invalidated_at),index===4);assert.equal(row.consumed_at,null);
   assert.equal((await failedAudit(f.db,f.accountId)).length,index+1);
  }
  await assert.rejects(f.service.resetPassword({token:f.token,code:f.code,password:NEW}),e=>e.code==="invalid_code");
  assert.deepEqual(await accountState(f.db,f.accountId),before);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM auth_sessions WHERE account_id=$1 AND revoked_at IS NULL",[f.accountId])).rows[0].count,2);
  assert.equal((await f.db.query("SELECT consumed_at FROM auth_recovery_flows WHERE account_id=$1",[f.accountId])).rows[0].consumed_at,null);
  const events=(await f.db.query("SELECT active_role,metadata FROM auth_security_events WHERE event_type='otp_failed' AND account_id=$1 ORDER BY metadata->>'attemptsRemaining'",[f.accountId])).rows;
  assert.equal(events.length,5);assert.deepEqual(events.map(r=>r.metadata.attemptsRemaining).sort(),[0,1,2,3,4]);assert.ok(events.every(r=>r.active_role==="worker"&&r.metadata.purpose==="password_reset"));
 }finally{await f.db.close();}
});
for(const role of ["worker","company","assessor","verifier","admin","root"]) test(role+" recovery after rejected code changes password atomically, revokes both sessions and denies replay",async()=>{
 const f=await fixture(role);try{
  await assert.rejects(f.service.resetPassword({token:f.token,code:wrong(f.code),password:NEW}),e=>e.code==="invalid_code");
  assert.deepEqual(await f.service.resetPassword({token:f.token,code:f.code,password:NEW}),{role});
  const a=await accountState(f.db,f.accountId);assert.equal(await verifyPassword(NEW,a.password_hash,ENV.authPepper),true);assert.equal(await verifyPassword(OLD,a.password_hash,ENV.authPepper),false);
  const sessions=(await f.db.query("SELECT active_role,revoked_at,revocation_reason FROM auth_sessions WHERE account_id=$1",[f.accountId])).rows;
  assert.equal(sessions.length,2);assert.ok(sessions.every(s=>s.active_role===role&&s.revoked_at&&s.revocation_reason==="password_reset"));
  assert.equal((await f.db.query("SELECT attempts_remaining FROM auth_otp_challenges WHERE challenge_id=$1",[f.challengeId])).rows[0].attempts_remaining,4);
  assert.ok((await f.db.query("SELECT consumed_at FROM auth_recovery_flows WHERE account_id=$1",[f.accountId])).rows[0].consumed_at);
  await assert.rejects(f.service.resetPassword({token:f.token,code:f.code,password:OLD}),e=>e.code==="flow_missing");
  assert.equal((await failedAudit(f.db,f.accountId)).length,1);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE action_key='authentication.password_reset.completed' AND actor_account_id=$1 AND actor_role=$2",[f.accountId,role])).rows[0].count,1);
 }finally{await f.db.close();}
});
for(const action of ["authentication.otp.failed","authentication.password_reset.completed"]) test("Audit failure rolls back recovery transition for "+action,async()=>{
 const f=await fixture();try{
  const before=await accountState(f.db,f.accountId);
  await f.db.query(`CREATE FUNCTION recovery_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='${action}' THEN RAISE EXCEPTION 'recovery test audit unavailable'; END IF; RETURN NEW; END; $$`);
  await f.db.query("CREATE TRIGGER recovery_test_audit_failure BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION recovery_test_reject_audit()");
  await assert.rejects(f.service.resetPassword({token:f.token,code:action.endsWith(".failed")?wrong(f.code):f.code,password:NEW}),/recovery test audit unavailable/);
  assert.deepEqual(await accountState(f.db,f.accountId),before);
  const c=(await f.db.query("SELECT attempts_remaining,consumed_at,invalidated_at FROM auth_otp_challenges WHERE challenge_id=$1",[f.challengeId])).rows[0];assert.deepEqual(c,{attempts_remaining:5,consumed_at:null,invalidated_at:null});
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM auth_sessions WHERE account_id=$1 AND revoked_at IS NULL",[f.accountId])).rows[0].count,2);
  assert.equal((await f.db.query("SELECT consumed_at FROM auth_recovery_flows WHERE account_id=$1",[f.accountId])).rows[0].consumed_at,null);
  assert.equal((await failedAudit(f.db,f.accountId)).length,0);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM auth_security_events WHERE account_id=$1 AND event_type IN ('otp_failed','otp_verified','password_reset_completed')",[f.accountId])).rows[0].count,0);
 }finally{await f.db.close();}
});
test("Wrong-role and unknown recovery requests issue no usable flow",async()=>{
 const f=await fixture();try{
  for(const input of [{role:"root",email:f.email},{role:"worker",email:"unknown.recovery@example.test"}]){
   const result=await f.service.request({...input,requestFingerprint:"denied-recovery"});assert.equal(typeof result.token,"string");assert.equal(await f.service.readState(result.token),null);
   await assert.rejects(f.service.resetPassword({token:result.token,code:f.code,password:NEW}),e=>e.code==="flow_missing");
  }
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM auth_recovery_flows")).rows[0].count,1);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM auth_otp_challenges WHERE purpose='password_reset'")).rows[0].count,1);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM auth_sessions WHERE revoked_at IS NULL")).rows[0].count,2);
 }finally{await f.db.close();}
});
test("Recovery resend rejects an immediate request without creating another challenge",async()=>{
 const f=await fixture();try{
  const c=await f.repo.authentication.findOtpChallengeForUpdate(f.challengeId);
  assert.equal(c.resendAvailableAt,"2026-10-05T03:01:00.000Z");
  await assert.rejects(f.service.resend({token:f.token}),e=>e.code==="cooldown");
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM auth_otp_challenges WHERE account_id=$1 AND purpose='password_reset'",[f.accountId])).rows[0].count,1);
 }finally{await f.db.close();}
});

test("Expired recovery challenge rejects without consuming another attempt",async()=>{const f=await fixture();try{const expired=new AuthRecoveryService(f.repo,{pepper:ENV.authPepper,sandboxEnabled:true},()=>new Date("2026-10-05T03:11:00.000Z"));await assert.rejects(expired.resetPassword({token:f.token,code:wrong(f.code),password:NEW}),e=>e.code==="invalid_code");const row=(await f.db.query("SELECT attempts_remaining FROM auth_otp_challenges WHERE challenge_id=$1",[f.challengeId])).rows[0];assert.equal(row.attempts_remaining,5);}finally{await f.db.close();}});

test("Real account, OTP and session repositories return ISO timestamps and preserve nulls",async()=>{
 const f=await fixture();try{
  await f.db.query("UPDATE auth_accounts SET account_status='locked',locked_until=$2,phone_e164='+923001234567',phone_verified_at=$3 WHERE account_id=$1",[f.accountId,"2026-10-05T03:01:00.000Z",NOW]);
  const account=await f.repo.authentication.findAccountById(f.accountId);
  assert.equal(account.lockedUntil,"2026-10-05T03:01:00.000Z");assert.equal(account.emailVerifiedAt,NOW);assert.equal(account.phoneVerifiedAt,NOW);assert.equal(account.createdAt,NOW);assert.equal(account.updatedAt,NOW);
  const otp=await f.repo.authentication.findOtpChallengeForUpdate(f.challengeId);assert.equal(otp.createdAt,NOW);assert.equal(otp.expiresAt,"2026-10-05T03:10:00.000Z");assert.equal(otp.resendAvailableAt,"2026-10-05T03:01:00.000Z");assert.equal(otp.consumedAt,null);assert.equal(otp.invalidatedAt,null);
  await f.db.query("UPDATE auth_accounts SET account_status='active',locked_until=NULL WHERE account_id=$1",[f.accountId]);
  const session=await f.repo.authentication.findActiveSessionByTokenHash("token-worker-one",NOW);assert.equal(session.createdAt,NOW);assert.equal(session.lastSeenAt,NOW);assert.equal(session.expiresAt,"2026-10-06T03:00:00.000Z");assert.equal(session.revokedAt,null);
  await f.db.query("UPDATE auth_accounts SET locked_until=NULL,phone_e164=NULL,phone_verified_at=NULL WHERE account_id=$1",[f.accountId]);const cleared=await f.repo.authentication.findAccountById(f.accountId);assert.equal(cleared.lockedUntil,null);assert.equal(cleared.phoneVerifiedAt,null);
 }finally{await f.db.close();}
});
