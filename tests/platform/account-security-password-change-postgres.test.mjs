import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {createRequire} from "node:module";
import {readFileSync,readdirSync} from "node:fs";
import {rm} from "node:fs/promises";
import test, {before,after} from "node:test";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
import {loadAssessmentAttemptRuntime} from "../helpers/assessment-attempt-runtime-loader.mjs";

if (!process.env.HSE_POSTGRES_TEST_DATABASE_URL) {
 throw new Error("M1.03.08 requires an isolated PostgreSQL test admin URL.");
}
const ADMIN_URL=process.env.HSE_POSTGRES_TEST_DATABASE_URL;
const DB_NAME="m10308_change_race_"+process.pid+"_"+randomBytes(4).toString("hex");
const ENV={appEnvironment:"test",databaseDriver:"postgres",databaseUrl:ADMIN_URL,releaseSha:"m10308-concurrent-password"};
const PEPPER="m10308-synthetic-test-pepper-more-than-thirty-two";
const OLD="M10308OldSafePassword2026!",NEW_ONE="M10308NewSafePasswordOne2026!",NEW_TWO="M10308NewSafePasswordTwo2026!";
process.env.HSE_APP_ENV="test";
process.env.HSE_DATABASE_DRIVER="postgres";
process.env.HSE_SESSION_SECRET="m10308-synthetic-test-session-secret-more-than-thirty-two";
process.env.HSE_AUTH_PEPPER=PEPPER;
process.env.HSE_CREDENTIAL_SIGNING_SECRET="m10308-synthetic-test-signing-secret-more-than-thirty-two";
process.env.HSE_RELEASE_SHA=ENV.releaseSha;
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {hashPassword,verifyPassword}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
const compiled=loadAssessmentAttemptRuntime(["auth/account-security-service.ts"]);
const {AccountSecurityService}=createRequire(import.meta.url)(compiled+"/auth/account-security-service.js");
let admin,created=false;
before(async()=>{
 admin=await openScriptDatabase(ENV);
 await admin.execute('CREATE DATABASE "'+DB_NAME+'"');
 created=true;
 const url=new URL(ADMIN_URL);url.pathname="/"+DB_NAME;ENV.databaseUrl=url.href;
 const db=await openScriptDatabase(ENV);
 try {
  for (const name of readdirSync("database/migrations").filter(n=>n.endsWith(".up.sql")).sort())
   await db.execute(readFileSync("database/migrations/"+name,"utf8"));
 } finally {await db.close();}
 process.env.DATABASE_URL=ENV.databaseUrl;
});
after(async()=>{
 try {if (created)await admin.execute('DROP DATABASE "'+DB_NAME+'"');}
 finally {await admin?.close();await rm(compiled,{recursive:true,force:true});}
});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
test("M1.03.08 actual PostgreSQL concurrent old-password changes accept one and preserve one session", {timeout:120000},async()=>{
 const db=await Promise.all([openScriptDatabase(ENV),openScriptDatabase(ENV),openScriptDatabase(ENV)]);
 const [first,second,control]=db;
 const accountId="m10308_synthetic_"+randomBytes(4).toString("hex"),now=new Date().toISOString();
 const sessions=[accountId+"_one",accountId+"_two"];
 const firstRead=deferred(),secondRead=deferred(),release=deferred();
 try{
  const repository=new AuthAccessRepository(control);
  await repository.authentication.insertAccount({accountId,email:accountId+"@example.test",phone:null,displayName:"Synthetic Worker",status:"pending_email",passwordHash:await hashPassword(OLD,PEPPER),workerReference:"HSE-REG-M10308-"+accountId.slice(-8),now});
  await repository.authentication.updateAccountAfterEmailVerification(accountId,now);
  await repository.authentication.addRole(accountId,"worker",now);
  for(const id of sessions){
   await repository.authentication.insertSession({sessionId:id,accountId,activeRole:"worker",tokenHash:randomBytes(32).toString("hex"),csrfTokenHash:randomBytes(32).toString("hex"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
  }
  function traced(client,which){
   return {...client,transaction:callback=>client.transaction(async tx=>callback({...tx,query:async(sql,params)=>{
    const result=await tx.query(sql,params);
    if(sql.includes("SELECT password_hash FROM auth_accounts")){
     if(which==="first"){firstRead.resolve();await release.promise;}
     else secondRead.resolve();
    }
    return result;
   }}))};
  }
  const invoke=(client,which,sessionId,password)=>new AccountSecurityService(Promise.resolve(traced(client,which))).changePassword({session:{accountId,role:"worker",sessionId},currentPassword:OLD,newPassword:password}).then(()=>({ok:true}),e=>({ok:false,error:e.message}));
  const firstPromise=invoke(first,"first",sessions[0],NEW_ONE);
  await firstRead.promise;
  const secondPromise=invoke(second,"second",sessions[1],NEW_TWO);
  const secondState=await Promise.race([secondRead.promise.then(()=>"stale-read"),new Promise(resolve=>setTimeout(()=>resolve("blocked-until-first-commit"),700))]);
  release.resolve();
  const outcomes=await Promise.all([firstPromise,secondPromise]);
  assert.equal(secondState,"blocked-until-first-commit","second reauthentication must wait for the account row lock");
  const active=(await control.query("SELECT session_id,revoked_at FROM auth_sessions WHERE account_id=$1",[accountId])).rows.filter(row=>!row.revoked_at);
  const events=Number((await control.query("SELECT count(*) AS n FROM auth_security_events WHERE account_id=$1 AND event_type='password_changed'",[accountId])).rows[0].n);
  const audits=Number((await control.query("SELECT count(*) AS n FROM platform_audit_events WHERE actor_account_id=$1 AND action_key='authentication.password.changed'",[accountId])).rows[0].n);
  const hash=(await control.query("SELECT password_hash FROM auth_accounts WHERE account_id=$1",[accountId])).rows[0].password_hash;
  console.log("M10308_REAL_POSTGRES_RACE",JSON.stringify({secondState,outcomes,activeCount:active.length,events,audits}));
  assert.equal(outcomes.filter(o=>o.ok).length,1,"two stale-password changes must not both succeed");
  assert.equal(active.length,1,"exactly the successful password change's session must remain active");
  assert.equal(active[0].session_id,outcomes[0].ok?sessions[0]:sessions[1]);
  assert.equal(events,1,"only one security completion event");
  assert.equal(audits,1,"only one immutable password change audit");
  assert.equal(await verifyPassword(outcomes[0].ok?NEW_ONE:NEW_TWO,hash,PEPPER),true);
  assert.equal(await verifyPassword(outcomes[0].ok?NEW_TWO:NEW_ONE,hash,PEPPER),false);
 } finally {release.resolve();await Promise.all(db.map(client=>client.close()));}
});

async function seedSecuritySession(control, suffix, options = {}) {
 const accountId="m10308_validity_"+suffix+"_"+randomBytes(4).toString("hex");
 const sessionId=accountId+"_session", createdAt=new Date(Date.now()-7200000).toISOString();
 const now=new Date().toISOString();
 const expiresAt=options.expiresAt??(options.expired?new Date(Date.now()-3600000).toISOString():new Date(Date.now()+3600000).toISOString());
 const repository=new AuthAccessRepository(control);
 await repository.authentication.insertAccount({
  accountId,email:accountId+"@example.test",phone:null,displayName:"Synthetic account security",
  status:"pending_email",passwordHash:await hashPassword(OLD,PEPPER),
  workerReference:"HSE-REG-"+accountId.slice(-8),now:createdAt
 });
 await repository.authentication.updateAccountAfterEmailVerification(accountId,now);
 await repository.authentication.addRole(accountId,"worker",now);
 await repository.authentication.insertSession({
  sessionId,accountId,activeRole:"worker",tokenHash:randomBytes(32).toString("hex"),
  csrfTokenHash:randomBytes(32).toString("hex"),userAgentHash:null,ipAddressHash:null,
  createdAt,lastSeenAt:createdAt,expiresAt
 });
 if(options.revoked)await control.query(
  "UPDATE auth_sessions SET revoked_at=$2,revocation_reason='user_logout' WHERE session_id=$1",
  [sessionId,new Date().toISOString()]
 );
 return {accountId,sessionId,role:"worker",email:accountId+"@example.test",
  displayName:"Synthetic account security",createdAt,lastSeenAt:createdAt,expiresAt};
}
async function securityMutationCounts(db,accountId) {
 const hash=(await db.query("SELECT password_hash FROM auth_accounts WHERE account_id=$1",[accountId])).rows[0].password_hash;
 const events=Number((await db.query(
  "SELECT count(*) n FROM auth_security_events WHERE account_id=$1 AND event_type IN ('password_changed','mfa_recovery_codes_rotated','mfa_replaced')",
  [accountId])).rows[0].n);
 const audits=Number((await db.query(
  "SELECT count(*) n FROM platform_audit_events WHERE actor_account_id=$1 AND action_key='authentication.password.changed'",
  [accountId])).rows[0].n);
 return {oldPasswordPreserved:await verifyPassword(OLD,hash,PEPPER),events,audits};
}
test("M1.03.08 PostgreSQL rejects revoked, expired, role-mismatched security sessions without mutation",{timeout:120000},async()=>{
 const db=await openScriptDatabase(ENV);
 const service=new AccountSecurityService(Promise.resolve(db));
 const rejectedMessage="Security session is no longer active. Sign in again.";
 try {
  for(const condition of ["revoked","expired","wrong-role","revoked-recovery","revoked-factor-confirm"]) {
   const fixture=await seedSecuritySession(db,condition.replace(/-/g,"_"),{
    revoked:condition.startsWith("revoked"),expired:condition==="expired"
   });
   const session=condition==="wrong-role"?{...fixture,role:"admin"}:fixture;
   let actual=null;
   try {
    if(condition==="revoked-recovery"){
     await service.rotateRecoveryCodes({session,currentPassword:OLD});
    } else if(condition==="revoked-factor-confirm"){
     await service.confirmMfaReplacement({session,challengeId:"synthetic_missing_challenge",newCode:"123456"});
    } else {
     await service.changePassword({session,currentPassword:OLD,newPassword:NEW_ONE});
    }
    actual="ACCEPTED";
   } catch(error){actual=error.message}
   const persisted=await securityMutationCounts(db,fixture.accountId);
   console.log("M10308_SESSION_REVALIDATION",JSON.stringify({condition,actual,persisted}));
   assert.equal(actual,rejectedMessage,condition+" should reject the stale session");
   assert.deepEqual(persisted,{oldPasswordPreserved:true,events:0,audits:0},
    condition+" must not write a password, event or audit");
  }
  const valid=await seedSecuritySession(db,"valid");
  await service.changePassword({session:valid,currentPassword:OLD,newPassword:NEW_ONE});
  const accepted=await securityMutationCounts(db,valid.accountId);
  console.log("M10308_ACTIVE_SESSION_POSITIVE",JSON.stringify(accepted));
  assert.deepEqual(accepted,{oldPasswordPreserved:false,events:1,audits:1});
 }finally{await db.close()}
});
test("M1.03.08 PostgreSQL logout committed before security lock rejects in-flight request",{timeout:45000},async()=>{
 const [worker,logout,control]=await Promise.all([openScriptDatabase(ENV),openScriptDatabase(ENV),openScriptDatabase(ENV)]);
 const atLock=deferred(),release=deferred();
 try {
  const session=await seedSecuritySession(control,"logout_wins_race");
  // Pause the already-started request BEFORE it acquires any account/session lock.
  const wrapped={...worker,transaction:cb=>worker.transaction(async tx=>cb({...tx,query:async(sql,params)=>{
   if(sql.includes("SELECT account_id FROM auth_accounts")){atLock.resolve();await release.promise;}
   return tx.query(sql,params);
  }}))};
  const pending=new AccountSecurityService(Promise.resolve(wrapped))
   .changePassword({session,currentPassword:OLD,newPassword:NEW_ONE})
   .then(()=>({accepted:true}),e=>({accepted:false,error:e.message}));
  await atLock.promise;
  const revoked=await logout.query(
   "UPDATE auth_sessions SET revoked_at=$2,revocation_reason='user_logout' WHERE session_id=$1 AND revoked_at IS NULL RETURNING session_id",
   [session.sessionId,new Date().toISOString()]
  );
  assert.equal(revoked.rows.length,1,"logout must commit before any security row is locked");
  release.resolve();
  const result=await pending;
  const persisted=await securityMutationCounts(control,session.accountId);
  console.log("M10308_LOGOUT_WINS_REAL_POSTGRES_RACE",JSON.stringify({result,persisted}));
  assert.deepEqual(result,{accepted:false,error:"Security session is no longer active. Sign in again."});
  assert.deepEqual(persisted,{oldPasswordPreserved:true,events:0,audits:0});
 }finally{release.resolve();await Promise.all([worker.close(),logout.close(),control.close()])}
});
test("M1.03.08 PostgreSQL security lock serializes simultaneous logout",{timeout:45000},async()=>{
 const [worker,logout,control]=await Promise.all([openScriptDatabase(ENV),openScriptDatabase(ENV),openScriptDatabase(ENV)]);
 const locked=deferred(),release=deferred();
 try {
  const session=await seedSecuritySession(control,"security_wins_race");
  // The transaction now owns BOTH account and session locks. Logout must wait.
  const wrapped={...worker,transaction:cb=>worker.transaction(async tx=>cb({...tx,query:async(sql,params)=>{
   const result=await tx.query(sql,params);
   if(sql.includes("SELECT session_id FROM auth_sessions")){locked.resolve();await release.promise;}
   return result;
  }}))};
  const pending=new AccountSecurityService(Promise.resolve(wrapped))
   .changePassword({session,currentPassword:OLD,newPassword:NEW_ONE})
   .then(()=>({accepted:true}),e=>({accepted:false,error:e.message}));
  await locked.promise;
  const logoutAttempt=logout.query(
   "UPDATE auth_sessions SET revoked_at=$2,revocation_reason='user_logout' WHERE session_id=$1 AND revoked_at IS NULL RETURNING session_id",
   [session.sessionId,new Date().toISOString()]
  );
  const order=await Promise.race([
   logoutAttempt.then(()=>"logout-committed"),
   new Promise(resolve=>setTimeout(()=>resolve("logout-waits-on-session-lock"),400))
  ]);
  assert.equal(order,"logout-waits-on-session-lock");
  release.resolve();
  const result=await pending;
  const revoked=await logoutAttempt;
  const persisted=await securityMutationCounts(control,session.accountId);
  const active=Number((await control.query("SELECT count(*) n FROM auth_sessions WHERE session_id=$1 AND revoked_at IS NULL",[session.sessionId])).rows[0].n);
  console.log("M10308_SECURITY_WINS_REAL_POSTGRES_RACE",JSON.stringify({order,result,logoutRows:revoked.rows.length,active,persisted}));
  assert.deepEqual(result,{accepted:true});
  assert.equal(revoked.rows.length,1);
  assert.equal(active,0,"successful security action completed BEFORE logout; logout then revokes session");
  assert.deepEqual(persisted,{oldPasswordPreserved:false,events:1,audits:1});
 }finally{release.resolve();await Promise.all([worker.close(),logout.close(),control.close()])}
});


test("M1.03.08 PostgreSQL session expiry during a row lock wait rejects the stale mutation",{timeout:45000},async()=>{
 const [worker,holder,control]=await Promise.all([openScriptDatabase(ENV),openScriptDatabase(ENV),openScriptDatabase(ENV)]);
 const holdReady=deferred(),release=deferred(),attempted=deferred();
 try {
  const session=await seedSecuritySession(control,"expiry_during_row_lock",{
   expiresAt:new Date(Date.now()+3000).toISOString()
  });
  const held=holder.transaction(async tx=>{
   await tx.query("UPDATE auth_sessions SET last_seen_at=last_seen_at WHERE session_id=$1",[session.sessionId]);
   holdReady.resolve();
   await release.promise;
  });
  await holdReady.promise;
  const wrapped={...worker,transaction:cb=>worker.transaction(async tx=>cb({...tx,query:async(sql,params)=>{
   if(sql.includes("SELECT session_id FROM auth_sessions"))attempted.resolve();
   return tx.query(sql,params);
  }}))};
  const pending=new AccountSecurityService(Promise.resolve(wrapped))
   .changePassword({session,currentPassword:OLD,newPassword:NEW_ONE})
   .then(()=>({accepted:true}),e=>({accepted:false,error:e.message}));
  await attempted.promise;
  const msUntilExpiry=Date.parse(session.expiresAt)-Date.now();
  assert.ok(msUntilExpiry>600,"This probe must start the session query while still unexpired");
  await new Promise(resolve=>setTimeout(resolve,msUntilExpiry+550));
  release.resolve();
  await held;
  const result=await pending;
  const persisted=await securityMutationCounts(control,session.accountId);
  console.log("M10308_EXPIRY_DURING_ROW_LOCK_REAL_POSTGRES",JSON.stringify({
   result,persisted,afterExpiry:Date.now()>Date.parse(session.expiresAt)
  }));
  assert.deepEqual(result,{accepted:false,error:"Security session is no longer active. Sign in again."},
   "PostgreSQL statement_timestamp captured BEFORE the lock wait must not authorize an expired session");
  assert.deepEqual(persisted,{oldPasswordPreserved:true,events:0,audits:0});
 }finally{release.resolve();await Promise.all([worker.close(),holder.close(),control.close()]);}
});
