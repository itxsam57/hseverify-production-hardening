import assert from "node:assert/strict";
import test from "node:test";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const {WorkerRegistrationService}=loadWorkerRegistrationTs("src/lib/auth/worker-registration-service.ts");
const {WorkerRegistrationRepository}=loadWorkerRegistrationTs("src/lib/auth/worker-registration-repository.ts");
const {decryptSecret}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
const ENV={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",releaseSha:"worker-otp-server-boundaries",sessionSecret:"worker-otp-server-session-secret-more-than-thirty-two",authPepper:"worker-otp-server-auth-pepper-more-than-thirty-two",authSandboxEnabled:true,authSandboxAccessKey:"worker-otp-server-sandbox",demoAuthEnabled:false,demoDataEnabled:false};
const NOW="2026-10-06T04:00:00.000Z";
async function fixture(){
 const db=await openScriptDatabase(ENV);await applyMigrationsThrough(db,ENV.releaseSha,"0085_public_inquiry_intake");
 let now=new Date(NOW);
 const service=new WorkerRegistrationService(new WorkerRegistrationRepository(db),{pepper:ENV.authPepper,sandboxEnabled:true,sandboxAccessKey:ENV.authSandboxAccessKey},()=>now);
 const result=await service.start({displayName:"OTP Server Boundary Worker",email:"otp.server@example.test",phone:"+923008883310",password:"OtpServer!Password2026",country:"Pakistan",termsAccepted:true,privacyAccepted:true,requestFingerprint:"otp-server-fixture"});
 return {db,service,token:result.token,setNow:value=>now=new Date(value)};
}
async function challenge(f,purpose){const row=(await f.db.query("SELECT c.*,d.encrypted_code FROM auth_otp_challenges c JOIN auth_sandbox_deliveries d ON d.challenge_id=c.challenge_id WHERE purpose=$1 ORDER BY c.created_at DESC,c.challenge_id DESC",[purpose])).rows[0];return {...row,code:decryptSecret(row.encrypted_code,ENV.authPepper)};}
async function snapshot(f){const out={};for(const table of ['auth_accounts','auth_registration_flows','auth_otp_challenges','auth_sandbox_deliveries','auth_security_events','platform_audit_events','auth_sessions'])out[table]=(await f.db.query('SELECT * FROM '+table+' ORDER BY 1')).rows;return out;}
const wrong=code=>String((Number(code)+1)%1000000).padStart(6,'0');
const verify=(f,code)=>f.service.verify({token:f.token,code,requestFingerprint:'otp-server-verify'});
const resend=f=>f.service.resend({token:f.token,requestFingerprint:'otp-server-resend'});
test('Worker email and phone early resend preserves exact state and current code remains usable',async()=>{
 const f=await fixture();try{
 for(const purpose of ['registration_email','registration_phone']){
  const c=await challenge(f,purpose),before=await snapshot(f);
  await assert.rejects(resend(f),e=>e.code==='challenge_cooldown'&&e.retryAt===new Date(c.resend_available_at).toISOString());
  assert.deepEqual(await snapshot(f),before);
  const result=await verify(f,c.code);assert.equal(result.state.step,purpose==='registration_email'?'pending_phone':'complete');
 }
 assert.equal((await f.db.query('SELECT count(*)::int AS count FROM auth_sessions')).rows[0].count,0);
 }finally{await f.db.close();}
});
test('Worker email and phone five failures persist exhaustion; correct exhausted code cannot activate and new challenge recovers',async()=>{
 const f=await fixture();try{
 for(const [index,purpose] of ['registration_email','registration_phone'].entries()){
  const c=await challenge(f,purpose);
  for(let i=0;i<5;i++){
   await assert.rejects(verify(f,wrong(c.code)),e=>e.code==='invalid_code');
   const row=(await f.db.query('SELECT attempts_remaining,invalidated_at,consumed_at FROM auth_otp_challenges WHERE challenge_id=$1',[c.challenge_id])).rows[0];
   assert.equal(row.attempts_remaining,4-i);assert.equal(Boolean(row.invalidated_at),i===4);assert.equal(row.consumed_at,null);
  }
  const before=await snapshot(f);await assert.rejects(verify(f,c.code),e=>e.code==='challenge_missing');assert.deepEqual(await snapshot(f),before);
  const account=(await f.db.query("SELECT account_status,email_verified_at,phone_verified_at FROM auth_accounts WHERE email_normalized='otp.server@example.test'")).rows[0];
  assert.equal(account.account_status,index===0?'pending_email':'pending_phone');assert.equal(Boolean(account.email_verified_at),index===1);assert.equal(account.phone_verified_at,null);
  f.setNow(index===0?'2026-10-06T04:01:01.000Z':'2026-10-06T04:02:02.000Z');
  await resend(f);const fresh=await challenge(f,purpose);assert.notEqual(fresh.challenge_id,c.challenge_id);assert.equal(fresh.attempts_remaining,5);
  const result=await verify(f,fresh.code);assert.equal(result.state.step,index===0?'pending_phone':'complete');
 }
 const failures=(await f.db.query("SELECT metadata FROM platform_audit_events WHERE action_key='authentication.otp.failed' AND actor_account_id=(SELECT account_id FROM auth_accounts WHERE email_normalized='otp.server@example.test')")).rows;
 assert.equal(failures.length,10);
 assert.equal((await f.db.query('SELECT count(*)::int AS count FROM auth_sessions')).rows[0].count,0);
 }finally{await f.db.close();}
});
for(const action of ['authentication.otp.failed','authentication.otp.verified','authentication.otp.issued'])test('Worker OTP transition rolls back on required audit failure: '+action,async()=>{
 const f=await fixture();try{
  const c=await challenge(f,'registration_email');f.setNow('2026-10-06T04:01:01.000Z');
  await f.db.query(`CREATE FUNCTION reject_worker_boundary_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='${action}' THEN RAISE EXCEPTION 'worker boundary audit unavailable'; END IF; RETURN NEW; END; $$`);
  await f.db.query('CREATE TRIGGER reject_worker_boundary_audit BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION reject_worker_boundary_audit()');
  const before=await snapshot(f);
  await assert.rejects(action.endsWith('.issued')?resend(f):verify(f,action.endsWith('.failed')?wrong(c.code):c.code),/worker boundary audit unavailable/);
  assert.deepEqual(await snapshot(f),before);
  await f.db.query('DROP TRIGGER reject_worker_boundary_audit ON platform_audit_events');
  if(action.endsWith('.issued'))assert.equal((await resend(f)).step,'pending_email');
  else if(action.endsWith('.verified'))assert.equal((await verify(f,c.code)).state.step,'pending_phone');
  else await assert.rejects(verify(f,wrong(c.code)),e=>e.code==='invalid_code');
 }finally{await f.db.close();}
});
