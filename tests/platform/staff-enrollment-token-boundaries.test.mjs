import assert from "node:assert/strict";
import test from "node:test";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";

const {StaffProvisioningService}=loadWorkerRegistrationTs("src/lib/auth/staff-provisioning-service.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {createTotpCode,totpCounter}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
const NOW="2026-10-05T01:00:00.000Z";
const ENV={
 appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",
 releaseSha:"m10305-staff-token-boundaries",sessionSecret:"staff-token-boundary-session-secret-more-than-32",
 authPepper:"staff-token-boundary-pepper-more-than-32",authSandboxEnabled:true,
 authSandboxAccessKey:"staff-token-boundary-sandbox-key",demoAuthEnabled:false,demoDataEnabled:false
};
async function fixture(){
 const db=await openScriptDatabase(ENV);
 await applyMigrationsThrough(db,ENV.releaseSha,"0080_staff_invitation_revocation_audit");
 const repo=new AuthAccessRepository(db);
 const issuer="staff-token-boundary-root";
 await repo.authentication.insertAccount({accountId:issuer,email:"token.boundary.root@example.test",
  phone:null,displayName:"Authorized Root Issuer",status:"pending_email",
  passwordHash:null,workerReference:null,now:NOW});
 await repo.authentication.updateAccountAfterEmailVerification(issuer,NOW);
 await repo.authentication.addRole(issuer,"root",NOW);
 await repo.authentication.insertSession({sessionId:"staff-token-boundary-session",accountId:issuer,
  activeRole:"root",tokenHash:"staff-token-boundary-session-hash",
  csrfTokenHash:"staff-token-boundary-csrf-hash",userAgentHash:null,ipAddressHash:null,
  createdAt:NOW,lastSeenAt:NOW,expiresAt:"2026-10-06T01:00:00.000Z"});
 const service=new StaffProvisioningService(repo,{pepper:ENV.authPepper,
  sandboxEnabled:true,sandboxAccessKey:ENV.authSandboxAccessKey},()=>new Date(NOW));
 async function invite(email,role){
  return service.createInvitation({inviterAccountId:issuer,inviterRole:"root",
   email,role,requestFingerprint:"staff-boundary-"+role});
 }
 return {db,repo,service,invite,issuer};
}
async function count(db,query,params=[]){
 return (await db.query(query,params)).rows[0].n;
}
function code(secret){return createTotpCode(secret,totpCounter(new Date(NOW)));}
test("M1.03.05 hybrid invitation and enrollment tokens never cross-authorize or cancel another role",async()=>{
 const f=await fixture();
 try{
  const a=await f.invite("mix.verifier@example.test","verifier");
  const b=await f.invite("mix.assessor@example.test","assessor");
  const first=await f.service.beginEnrollment(a.token);
  const second=await f.service.beginEnrollment(b.token);
  const hybrid=a.token+"."+second.token.split(".")[1];
  const accountsBeforeForgery=await count(f.db,"SELECT count(*)::int n FROM auth_accounts");
  assert.equal(await f.service.readEnrollmentState(hybrid),null);
  await assert.rejects(f.service.completeProfile({combinedToken:hybrid,
   displayName:"Forged Cross Role",password:"TokenBoundary!Password2026"}),
   e=>e.code==="flow_missing");
  await f.service.cancelEnrollment(hybrid);
  assert.equal((await f.service.readEnrollmentState(first.token)).step,"profile");
  assert.equal((await f.service.readEnrollmentState(second.token)).step,"profile");
  assert.equal(await count(f.db,"SELECT count(*)::int n FROM auth_accounts"),accountsBeforeForgery);
  const aProfile=await f.service.completeProfile({combinedToken:first.token,
   displayName:"Valid Verifier",password:"TokenBoundary!Password2026"});
  assert.equal(aProfile.step,"totp");
  await f.service.cancelEnrollment(first.token);
  assert.equal(await f.service.readEnrollmentState(first.token),null);
  assert.equal(await count(f.db,"SELECT count(*)::int n FROM auth_accounts WHERE email_normalized=$1",
   ["mix.verifier@example.test"]),0);
  assert.equal((await f.db.query("SELECT invitation_status FROM auth_staff_invitations WHERE invitation_id=$1",
   [a.invitation.invitationId])).rows[0].invitation_status,"pending");
  assert.equal((await f.service.readEnrollmentState(second.token)).step,"profile");
  const retry=await f.service.beginEnrollment(a.token);
  assert.equal((await f.service.readEnrollmentState(retry.token)).step,"profile");
  await assert.rejects(f.service.verifyEnrollmentTotp({combinedToken:first.token,code:code(aProfile.totpSecret)}),
   e=>["flow_missing","invitation_unavailable"].includes(e.code));
  const fresh=await f.service.completeProfile({combinedToken:retry.token,
   displayName:"Reopened Verifier",password:"ReopenedVerifier!Password2026"});
  assert.deepEqual(await f.service.verifyEnrollmentTotp({combinedToken:retry.token,code:code(fresh.totpSecret)}),
   {role:"verifier"});
  assert.equal(await count(f.db,"SELECT count(*)::int n FROM auth_accounts WHERE email_normalized=$1",
   ["mix.verifier@example.test"]),1);
  assert.equal(await count(f.db,"SELECT count(*)::int n FROM auth_sessions WHERE active_role='verifier'"),0);
  assert.equal((await f.db.query("SELECT invitation_status FROM auth_staff_invitations WHERE invitation_id=$1",
   [b.invitation.invitationId])).rows[0].invitation_status,"pending");
  assert.equal((await f.service.readEnrollmentState(second.token)).step,"profile");
 }finally{await f.db.close();}
});
test("M1.03.05 opening invitation again rotates the enrollment token; stale token cannot set credentials",async()=>{
 const f=await fixture();
 try{
  const invitation=await f.invite("rotate.assessor@example.test","assessor");
  const original=await f.service.beginEnrollment(invitation.token);
  const rotated=await f.service.beginEnrollment(invitation.token);
  assert.notEqual(original.token,rotated.token);
  assert.equal(await f.service.readEnrollmentState(original.token),null);
  await assert.rejects(f.service.completeProfile({combinedToken:original.token,
   displayName:"Stale Token",password:"StaleToken!Password2026"}),e=>e.code==="flow_missing");
  assert.equal(await count(f.db,"SELECT count(*)::int n FROM auth_accounts WHERE email_normalized=$1",
   ["rotate.assessor@example.test"]),0);
  const profile=await f.service.completeProfile({combinedToken:rotated.token,
   displayName:"Valid Assessor",password:"ValidAssessor!Password2026"});
  const activated=await f.service.verifyEnrollmentTotp({combinedToken:rotated.token,code:code(profile.totpSecret)});
  assert.deepEqual(activated,{role:"assessor"});
  await assert.rejects(f.service.verifyEnrollmentTotp({combinedToken:rotated.token,
   code:code(profile.totpSecret)}),e=>e.code==="invitation_unavailable");
  await assert.rejects(f.service.beginEnrollment(invitation.token),e=>e.code==="invitation_unavailable");
  assert.equal(await count(f.db,"SELECT count(*)::int n FROM auth_accounts WHERE email_normalized=$1",
   ["rotate.assessor@example.test"]),1);
  assert.equal(await count(f.db,"SELECT count(*)::int n FROM auth_security_events WHERE event_type='mfa_enrolled' AND active_role='assessor'"),1);
  assert.equal(await count(f.db,"SELECT count(*)::int n FROM auth_sessions WHERE active_role='assessor'"),0);
 }finally{await f.db.close();}
});