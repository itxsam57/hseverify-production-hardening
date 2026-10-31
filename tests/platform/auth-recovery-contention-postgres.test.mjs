import assert from "node:assert/strict";
import test, {before, after} from "node:test";
import {readFileSync,readdirSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {AuthRecoveryService}=loadWorkerRegistrationTs("src/lib/auth/auth-recovery-service.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {hashPassword,decryptSecret,verifyPassword}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
if(!process.env.HSE_POSTGRES_TEST_DATABASE_URL)throw new Error("Actual PostgreSQL recovery contention requires an isolated test database URL.");
const ENV={appEnvironment:"test",databaseDriver:"postgres",databaseUrl:process.env.HSE_POSTGRES_TEST_DATABASE_URL,releaseSha:"recovery-contention"};
const name="recovery_contention_"+Date.now()+"_"+process.pid;
const pepper=randomBytes(32).toString("hex"),config={pepper,sandboxEnabled:true};
const OLD="OldRecovery!Password2026",NEW="NewRecovery!Password2026";
let admin,created=false,sequence=0;
before(async()=>{
 admin=await openScriptDatabase(ENV);await admin.execute('CREATE DATABASE "'+name+'"');created=true;
 const url=new URL(ENV.databaseUrl);url.pathname="/"+name;ENV.databaseUrl=url.href;
 const db=await openScriptDatabase(ENV);
 try{for(const file of readdirSync("database/migrations").filter(x=>x.endsWith(".up.sql")).sort())await db.execute(readFileSync("database/migrations/"+file,"utf8"));}finally{await db.close();}
});
after(async()=>{try{if(created)await admin.execute('DROP DATABASE "'+name+'"');}finally{await admin?.close();}});
const outcome=promise=>promise.then(value=>({ok:true,value}),error=>({ok:false,code:error.code}));
async function fixture(){
 const db=await openScriptDatabase(ENV),other=await openScriptDatabase(ENV),control=await openScriptDatabase(ENV);
 const suffix=String(++sequence),accountId="recovery-race-worker-"+suffix,email="recovery.race."+suffix+"@example.test",now=new Date().toISOString();
 const repo=new AuthAccessRepository(db);
 await repo.authentication.insertAccount({accountId,email,phone:null,displayName:"Recovery contention",status:"pending_email",passwordHash:await hashPassword(OLD,pepper),workerReference:"HSE-REG-RECOVERYRACE"+suffix,now});
 await repo.authentication.updateAccountAfterEmailVerification(accountId,now);await repo.authentication.addRole(accountId,"worker",now);
 await repo.authentication.insertSession({sessionId:"recovery-race-session-"+suffix,accountId,activeRole:"worker",tokenHash:randomBytes(32).toString("hex"),csrfTokenHash:randomBytes(32).toString("hex"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
 const request={role:"worker",email,requestFingerprint:"recovery-race-"+suffix};
 const service=new AuthRecoveryService(repo,config),initial=await service.request(request);
 const row=(await db.query("SELECT d.encrypted_code FROM auth_sandbox_deliveries d JOIN auth_otp_challenges c ON c.challenge_id=d.challenge_id WHERE c.account_id=$1 AND c.purpose='password_reset'",[accountId])).rows[0];
 return {db,other,control,accountId,request,service,token:initial.token,code:decryptSecret(row.encrypted_code,pepper),async close(){await other.close();await control.close();await db.close();}};
}
async function blockedBy(control,holder){
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){
  const rows=await control.query("SELECT pid FROM pg_stat_activity WHERE datname=$1 AND $2::int=ANY(pg_blocking_pids(pid))",[name,holder]);
  if(rows.rows.length)return;
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 throw new Error("Actual competing recovery service did not wait on the held account lock.");
}
async function state(f){
 const row=(await f.db.query("SELECT password_hash FROM auth_accounts WHERE account_id=$1",[f.accountId])).rows[0];
 return {old:await verifyPassword(OLD,row.password_hash,pepper),next:await verifyPassword(NEW,row.password_hash,pepper),
  active:Number((await f.db.query("SELECT count(*) n FROM auth_sessions WHERE account_id=$1 AND revoked_at IS NULL",[f.accountId])).rows[0].n),
  audits:Number((await f.db.query("SELECT count(*) n FROM platform_audit_events WHERE actor_account_id=$1 AND action_key='authentication.password_reset.completed'",[f.accountId])).rows[0].n)};
}
for(const operation of ["reset","resend"])test("Actual PostgreSQL new recovery request serializes competing "+operation+" and invalidates its old token",async()=>{
 const f=await fixture();let competing;
 try{
  let fresh;
  // Hold the real request producer's first row lock to establish a deterministic interleaving.
  await f.db.transaction(async tx=>{
   await tx.query("SET LOCAL statement_timeout='15s'");
   await tx.query("SELECT account_id FROM auth_accounts WHERE account_id=$1 FOR UPDATE",[f.accountId]);
   const holder=(await tx.query("SELECT pg_backend_pid() pid")).rows[0].pid;
   const service=new AuthRecoveryService(new AuthAccessRepository(f.other),config,()=>new Date(Date.now()+(operation==="resend"?61000:0)));
   competing=outcome(operation==="reset"?service.resetPassword({token:f.token,code:f.code,password:NEW}):service.resend({token:f.token}));
   await blockedBy(f.control,holder);
   fresh=await new AuthRecoveryService(new AuthAccessRepository(tx),config).request({...f.request,requestFingerprint:"new-"+operation});
  });
  const result=await competing;assert.equal(result.ok,false);assert.equal(result.code,"flow_missing");
  assert.equal(await f.service.readState(f.token),null);assert.equal((await f.service.readState(fresh.token)).role,"worker");
  assert.deepEqual(await state(f),{old:true,next:false,active:1,audits:0});
  assert.equal(Number((await f.db.query("SELECT count(*) n FROM auth_recovery_flows WHERE account_id=$1 AND consumed_at IS NULL",[f.accountId])).rows[0].n),1);
  assert.equal(Number((await f.db.query("SELECT count(*) n FROM auth_otp_challenges WHERE account_id=$1 AND purpose='password_reset'",[f.accountId])).rows[0].n),2);
 }finally{await competing?.catch(()=>{});await f.close();}
});
test("Actual PostgreSQL reset finishes before a waiting new recovery request without losing password or revocation",async()=>{
 const f=await fixture();let requesting;
 try{
  await f.db.transaction(async tx=>{
   await tx.query("SET LOCAL statement_timeout='15s'");
   await tx.query("SELECT account_id FROM auth_accounts WHERE account_id=$1 FOR UPDATE",[f.accountId]);
   const holder=(await tx.query("SELECT pg_backend_pid() pid")).rows[0].pid;
   requesting=outcome(new AuthRecoveryService(new AuthAccessRepository(f.other),config).request({...f.request,requestFingerprint:"after-reset"}));
   await blockedBy(f.control,holder);
   assert.deepEqual(await new AuthRecoveryService(new AuthAccessRepository(tx),config).resetPassword({token:f.token,code:f.code,password:NEW}),{role:"worker"});
  });
  const result=await requesting;assert.equal(result.ok,true);
  assert.equal(await f.service.readState(f.token),null);assert.equal((await f.service.readState(result.value.token)).role,"worker");
  assert.deepEqual(await state(f),{old:false,next:true,active:0,audits:1});
  await assert.rejects(f.service.resetPassword({token:f.token,code:f.code,password:OLD}),error=>error.code==="flow_missing");
 }finally{await requesting?.catch(()=>{});await f.close();}
});
