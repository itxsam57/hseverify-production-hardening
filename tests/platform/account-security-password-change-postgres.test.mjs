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