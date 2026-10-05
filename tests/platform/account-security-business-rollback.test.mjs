
import assert from "node:assert/strict";
import test from "node:test";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {AuthRecoveryService}=loadWorkerRegistrationTs("src/lib/auth/auth-recovery-service.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {hashPassword,decryptSecret}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
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

process.env.HSE_APP_ENV="test";
process.env.HSE_DATABASE_DRIVER="pglite";
process.env.HSE_PGLITE_DATA_DIR="memory://";
process.env.HSE_RELEASE_SHA="account-security-business-rollback";
process.env.HSE_SESSION_SECRET=ENV.sessionSecret;
process.env.HSE_AUTH_PEPPER=ENV.authPepper;
import {loadAssessmentAttemptRuntime} from "../helpers/assessment-attempt-runtime-loader.mjs";
import {createRequire} from "node:module";
const accountSecurityRuntime=loadAssessmentAttemptRuntime(["auth/account-security-service.ts"]);
const {AccountSecurityService}=createRequire(import.meta.url)(accountSecurityRuntime+"/auth/account-security-service.js");
for (const destination of ["audit","queue"]) test("Actual password change rolls back account and sessions when required "+destination+" fails",async()=>{
 const f=await fixture();try{
  await applyMigrationsThrough(f.db,ENV.releaseSha,"0082_account_security_notifications");
  const snapshot=async()=>JSON.stringify(await Promise.all(["auth_accounts","auth_sessions"].map(async table=>(await f.db.query("SELECT * FROM "+table+" WHERE account_id=$1 ORDER BY "+(table==="auth_accounts"?"account_id":"session_id"),[f.accountId])).rows)));
  const before=await snapshot(),table=destination==="audit"?"platform_audit_events":"platform_outbox_jobs";
  await f.db.execute("CREATE FUNCTION security_business_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled security business destination unavailable'; END; $$; CREATE TRIGGER security_business_failure BEFORE INSERT ON "+table+" FOR EACH ROW EXECUTE FUNCTION security_business_fault();");
  await assert.rejects(new AccountSecurityService(Promise.resolve(f.db)).changePassword({session:{accountId:f.accountId,role:"worker",sessionId:"recovery-worker-one"},currentPassword:OLD,newPassword:NEW}),/controlled security business destination unavailable/);
  assert.ok(await snapshot()===before,"Failed password change modified the account or sessions");
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM auth_security_events WHERE account_id=$1 AND event_type='password_changed'",[f.accountId])).rows[0].count,0);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE actor_account_id=$1 AND action_key='authentication.password.changed'",[f.accountId])).rows[0].count,0);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM platform_outbox_jobs WHERE enqueued_by_account_id=$1",[f.accountId])).rows[0].count,0);
  console.log("ACTUAL_PASSWORD_CHANGE_BUSINESS_ROLLBACK",destination,"account and all sessions retained; no completion, audit or job");
 }finally{await f.db.close();}
});

import {rm} from "node:fs/promises";
test.after(async()=>{await rm(accountSecurityRuntime,{recursive:true,force:true});});
