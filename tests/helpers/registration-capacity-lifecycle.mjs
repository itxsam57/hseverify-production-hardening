import assert from "node:assert/strict";
import {randomInt,randomUUID} from "node:crypto";
import {loadWorkerRegistrationTs} from "./worker-registration-runtime-loader.mjs";
const {WorkerRegistrationService}=loadWorkerRegistrationTs("src/lib/auth/worker-registration-service.ts");
const {AuthenticationRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-repository.ts");
const {WorkerRegistrationRepository}=loadWorkerRegistrationTs("src/lib/auth/worker-registration-repository.ts");
export async function assertRegistrationCapacityLifecycle(database){
 const suffix=randomUUID().replaceAll("-",""),email="capacity-cleanup-"+suffix+"@example.test";
 const now=new Date();
 const service=new WorkerRegistrationService(new WorkerRegistrationRepository(database),{
  pepper:"capacity-cleanup-test-pepper-longer-than-thirty-two-characters",
  sandboxEnabled:true,sandboxAccessKey:"capacity-cleanup-sandbox-test-only"
 },()=>now);
 const started=await service.start({displayName:"Capacity Cleanup Worker",email,phone:"+92300"+randomInt(1000000,9999999),
  password:"CapacityCleanup!Password2026",country:"Pakistan",termsAccepted:true,privacyAccepted:true,
  requestFingerprint:"capacity-cleanup-"+suffix});
 assert.equal(started.state.step,"pending_email");
 const account=(await database.query("SELECT account_id FROM auth_accounts WHERE email_normalized=$1",[email])).rows[0];
 assert.ok(account);
 assert.equal((await database.query("SELECT count(*)::int n FROM reviewer_capacity_locks WHERE account_id=$1",[account.account_id])).rows[0].n,1);
 const repository=new WorkerRegistrationRepository(database);
 await database.query("UPDATE auth_accounts SET account_status='active',email_verified_at=$2,phone_verified_at=$2 WHERE account_id=$1",[account.account_id,now.toISOString()]);
 assert.equal(await repository.deleteUnactivatedAccount(account.account_id),false,"Active accounts must not be deleted through registration cancellation");
 const sessionId="session_capacity_guard_"+suffix;
 await new AuthenticationRepository(database).insertSession({sessionId,accountId:account.account_id,activeRole:"worker",
  tokenHash:"a".repeat(64),csrfTokenHash:"b".repeat(64),userAgentHash:null,ipAddressHash:null,
  createdAt:now.toISOString(),lastSeenAt:now.toISOString(),expiresAt:new Date(now.getTime()+3600000).toISOString()});
 await database.query("UPDATE auth_accounts SET account_status='pending_email',email_verified_at=NULL,phone_verified_at=NULL WHERE account_id=$1",[account.account_id]);
 assert.equal(await repository.deleteUnactivatedAccount(account.account_id),false,"A pending account with any session must remain protected");
 assert.equal((await database.query("SELECT count(*)::int n FROM reviewer_capacity_locks WHERE account_id=$1",[account.account_id])).rows[0].n,1);
 await database.query("DELETE FROM auth_sessions WHERE session_id=$1",[sessionId]);
 const acceptance=(await database.query("SELECT audit_event_id,metadata FROM platform_audit_events WHERE actor_account_id=$1 ORDER BY audit_event_id",[account.account_id])).rows;
 assert.ok(acceptance.some(row=>row.metadata.stage==="policy_acceptance"));
 await service.cancel(started.token);
 for(const table of ["auth_accounts","reviewer_capacity_locks","auth_registration_flows","auth_otp_challenges"]){
  assert.equal((await database.query("SELECT count(*)::int n FROM "+table+" WHERE account_id=$1",[account.account_id])).rows[0].n,0,table+" retained unfinished signup state");
 }
 const retained=(await database.query("SELECT audit_event_id,metadata FROM platform_audit_events WHERE actor_account_id=$1 ORDER BY audit_event_id",[account.account_id])).rows;
 for(const event of acceptance)assert.deepEqual(retained.find(row=>row.audit_event_id===event.audit_event_id),event,"Accepted policy/audit history must remain immutable after cancellation");
 assert.ok(retained.some(row=>row.metadata.reason==="user_cancelled"),"Cancellation audit must survive account cleanup");
}
