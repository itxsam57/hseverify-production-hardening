import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";

const {CompanyRegistrationService}=loadWorkerRegistrationTs("src/lib/company/company-registration-service.ts");
const {CompanyRegistrationRepository}=loadWorkerRegistrationTs("src/lib/company/company-registration-repository.ts");
const {decryptSecret}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
const rawUrl=process.env.HSE_POSTGRES_TEST_DATABASE_URL;
if(!rawUrl||!/^postgres(?:ql)?:\/\/[^/]+/.test(rawUrl)){
 throw new Error("HSE_POSTGRES_TEST_DATABASE_URL must point to approved disposable actual PostgreSQL; never use production.");
}
const approvedHost=new URL(rawUrl).hostname;
if(!["127.0.0.1","localhost","::1"].includes(approvedHost)){
 throw new Error("Refusing to create/drop a database on a non-loopback PostgreSQL host.");
}
const NOW="2026-10-05T03:00:00.000Z";
const ENV={
 appEnvironment:"test",databaseDriver:"postgres",databaseUrl:rawUrl,pgliteDataDir:null,
 releaseSha:"m10304-real-postgres-race",sessionSecret:"m10304-real-postgres-session-secret-test-only",
 authPepper:"m10304-real-postgres-auth-pepper-test-only",authSandboxEnabled:true,
 authSandboxAccessKey:"m10304-real-postgres-sandbox-test-key",demoAuthEnabled:false,demoDataEnabled:false
};
function totp(base32){
 const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
 const bits=[...base32].map(x=>alphabet.indexOf(x).toString(2).padStart(5,"0")).join("");
 const bytes=[];
 for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
 const message=Buffer.alloc(8);
 message.writeBigUInt64BE(BigInt(Math.floor(Date.parse(NOW)/30000)));
 const digest=createHmac("sha1",Buffer.from(bytes)).update(message).digest();
 const offset=digest.at(-1)&15;
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
test("actual PostgreSQL concurrent Company MFA activation waits on row lock and commits one audit",{
 timeout:120000
},async()=>{
 const name="m10304_"+Date.now()+"_"+process.pid;
 const admin=await openScriptDatabase(ENV);
 const testUrl=new URL(rawUrl);testUrl.pathname="/"+name;
 const testingEnv={...ENV,databaseUrl:testUrl.href};
 let main,holder,lockTask,releaseLock,created=false;
 const parallel=[];
 try{
  await admin.execute('CREATE DATABASE "'+name+'"');created=true;
  main=await openScriptDatabase(testingEnv);
  await applyMigrationsThrough(main,ENV.releaseSha,"0080_staff_invitation_revocation_audit");
  const service=new CompanyRegistrationService(new CompanyRegistrationRepository(main),
   {pepper:ENV.authPepper,sandboxEnabled:true},()=>new Date(NOW));
  const started=await service.start({
   legalName:"Real PostgreSQL MFA Lock Laboratory",tradingName:"MFA Lock Laboratory",
   registrationNumber:"PG-MFA-"+process.pid,country:"Pakistan",industry:"Safety services",
   companySize:"11-50",website:"https://mfa-lock.example.test",
   authorizedRepresentative:"Company Lock Test",businessEmail:"pg-mfa@example.test",
   businessPhone:"+923001224466",password:"CompanyPg!Password2026",
   termsAccepted:true,privacyAccepted:true,requestFingerprint:"pg-start"
  });
  const flow=(await main.query("SELECT * FROM company_registration_flows")).rows[0];
  const delivered=(await main.query("SELECT encrypted_code FROM auth_sandbox_deliveries")).rows[0];
  const state=await service.verifyEmail({
   token:started.token,code:decryptSecret(delivered.encrypted_code,ENV.authPepper),
   requestFingerprint:"pg-email"
  });
  assert.equal(state.step,"pending_mfa");
  holder=await openScriptDatabase(testingEnv);
  let announceLock;
  const lockReady=new Promise(resolve=>announceLock=resolve);
  const hold=new Promise(resolve=>releaseLock=resolve);
  lockTask=holder.transaction(async tx=>{
   await tx.query("SELECT flow_id FROM company_registration_flows WHERE flow_id=$1 FOR UPDATE",[flow.flow_id]);
   announceLock();
   await hold;
  });
  await lockReady;
  for(let i=0;i<6;i++){
   const db=await openScriptDatabase(testingEnv);
   parallel.push(db);
  }
  const liveCode=totp(state.totpSetupKey);
  let returned=0;
  const attempts=parallel.map((db,index)=>{
   const independentService=new CompanyRegistrationService(new CompanyRegistrationRepository(db),
    {pepper:ENV.authPepper,sandboxEnabled:true},()=>new Date(NOW));
   return independentService.verifyMfa({
    token:started.token,code:liveCode,requestFingerprint:"pg-parallel-"+index
   }).then(value=>{returned+=1;return value;});
  });
  try{
   let waiting=0;
   for(let i=0;i<50;i++){
    const count=await main.query(
     "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",
     [name]
    );
    waiting=count.rows[0].n;
    if(waiting>0)break;
    await delay(80);
   }
   assert.ok(waiting>0,"Independent PostgreSQL clients never showed actual row lock contention");
   assert.equal(returned,0,"MFA activation finished while the registration flow row was locked");
   console.log("POSTGRES_ROW_LOCK_CONTENTION_OBSERVED waiting="+waiting+" completed_before_release="+returned);
  }finally{
   releaseLock();await lockTask;
  }
  const results=await Promise.allSettled(attempts);
  assert.deepEqual(results.map(item=>item.status==="fulfilled"?item.value.step:String(item.reason)),
   Array(6).fill("complete"));
  const row=(await main.query(
   "SELECT current_step,completed_at FROM company_registration_flows WHERE flow_id=$1",[flow.flow_id]
  )).rows[0];
  assert.equal(row.current_step,"complete");assert.ok(row.completed_at);
  const factor=(await main.query(
   "SELECT factor_status,last_accepted_counter FROM auth_mfa_factors WHERE account_id=$1",[flow.account_id]
  )).rows[0];
  assert.equal(factor.factor_status,"active");assert.ok(factor.last_accepted_counter!==null);
  const member=(await main.query(
   "SELECT membership_status,membership_role,portal_role FROM auth_tenant_memberships WHERE membership_id=$1",
   [flow.membership_id]
  )).rows[0];
  assert.deepEqual(member,{membership_status:"active",membership_role:"owner",portal_role:"company"});
  assert.equal((await main.query(
   "SELECT tenant_status FROM platform_tenants WHERE tenant_id=$1",[flow.tenant_id]
  )).rows[0].tenant_status,"pending");
  const audit=(await main.query(
   "SELECT count(*)::integer AS n FROM platform_audit_events WHERE actor_account_id=$1 AND action_key='authentication.mfa.enrolled'",
   [flow.account_id]
  )).rows[0].n;
  const enrollment=(await main.query(
   "SELECT count(*)::integer AS n FROM auth_security_events WHERE account_id=$1 AND event_type='mfa_enrolled'",
   [flow.account_id]
  )).rows[0].n;
  const sessions=(await main.query(
   "SELECT count(*)::integer AS n FROM auth_sessions WHERE account_id=$1",[flow.account_id]
  )).rows[0].n;
  assert.equal(audit,1);assert.equal(enrollment,1);assert.equal(sessions,0);
  console.log("POSTGRES_MFA_CONCURRENT_ACTIVATION_PASS: six independent clients; one activation; one audited enrollment; zero session");
 }finally{
  if(releaseLock)releaseLock();
  if(lockTask)await lockTask.catch(()=>{});
  await Promise.allSettled(parallel.map(db=>db.close()));
  if(holder)await holder.close();
  if(main)await main.close();
  if(created)await admin.execute('DROP DATABASE "'+name+'"');
  await admin.close();
 }
});