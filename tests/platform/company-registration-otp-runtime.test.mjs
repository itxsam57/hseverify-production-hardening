import assert from "node:assert/strict";
import test from "node:test";
import {createHmac} from "node:crypto";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {CompanyRegistrationService}=loadWorkerRegistrationTs("src/lib/company/company-registration-service.ts");
const {CompanyRegistrationRepository}=loadWorkerRegistrationTs("src/lib/company/company-registration-repository.ts");
const {decryptSecret}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
const ENV={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",releaseSha:"company-registration-boundaries",sessionSecret:"company-runtime-session-secret-more-than-thirty-two",authPepper:"company-runtime-pepper-more-than-thirty-two",authSandboxEnabled:true,authSandboxAccessKey:"company-runtime-sandbox-key",demoAuthEnabled:false,demoDataEnabled:false};
const NOW="2026-10-05T03:00:00.000Z";
async function fixture(){
 const db=await openScriptDatabase(ENV);await applyMigrationsThrough(db,ENV.releaseSha,"0080_staff_invitation_revocation_audit");
 const service=new CompanyRegistrationService(new CompanyRegistrationRepository(db),{pepper:ENV.authPepper,sandboxEnabled:true},()=>new Date(NOW));
 const result=await service.start({legalName:"Runtime Safety Limited",tradingName:"Runtime Safety",registrationNumber:"RUNTIME-COMPANY-2026",country:"Pakistan",industry:"Safety services",companySize:"11-50",website:"https://runtime.example.test",authorizedRepresentative:"Runtime Company QA",businessEmail:"runtime.company@example.test",businessPhone:"+923001224466",password:"CompanyRuntime!Password2026",termsAccepted:true,privacyAccepted:true,requestFingerprint:"company-runtime"});
 const flow=(await db.query("SELECT * FROM company_registration_flows")).rows[0];
 const delivery=(await db.query("SELECT encrypted_code FROM auth_sandbox_deliveries")).rows[0];
 return {db,service,flow,token:result.token,code:decryptSecret(delivery.encrypted_code,ENV.authPepper)};
}
const wrong=code=>String((Number(code)+1)%1000000).padStart(6,"0");
async function state(f){
 const result={};
 for(const [key,sql] of Object.entries({account:"SELECT * FROM auth_accounts WHERE account_id=$1",flow:"SELECT * FROM company_registration_flows WHERE account_id=$1",factor:"SELECT * FROM auth_mfa_factors WHERE account_id=$1",tenant:"SELECT t.* FROM platform_tenants t JOIN company_registration_flows f ON f.tenant_id=t.tenant_id WHERE f.account_id=$1",membership:"SELECT * FROM auth_tenant_memberships WHERE account_id=$1",challenge:"SELECT * FROM auth_otp_challenges WHERE account_id=$1",events:"SELECT * FROM auth_security_events WHERE account_id=$1 ORDER BY event_id",audit:"SELECT * FROM platform_audit_events WHERE actor_account_id=$1 ORDER BY audit_event_id",sessions:"SELECT * FROM auth_sessions WHERE account_id=$1"}))result[key]=(await f.db.query(sql,[f.flow.account_id])).rows;
 return result;
}
test("Company email exhaustion commits five rejections and immutable audit; correct exhausted code cannot advance",async()=>{
 const f=await fixture();try{
 for(let i=0;i<5;i++){
  await assert.rejects(f.service.verifyEmail({token:f.token,code:wrong(f.code),requestFingerprint:"wrong-company-email"}),e=>e.code==="invalid_code");
  const row=(await f.db.query("SELECT attempts_remaining,invalidated_at,consumed_at FROM auth_otp_challenges")).rows[0];
  assert.equal(row.attempts_remaining,4-i);assert.equal(Boolean(row.invalidated_at),i===4);assert.equal(row.consumed_at,null);
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE action_key='authentication.otp.failed' AND actor_account_id=$1",[f.flow.account_id])).rows[0].count,i+1);
 }
 await assert.rejects(f.service.verifyEmail({token:f.token,code:f.code,requestFingerprint:"exhausted-company-email"}),e=>e.code==="challenge_missing");
 const s=await state(f);assert.equal(s.account[0].account_status,"pending_email");assert.equal(s.account[0].email_verified_at,null);assert.equal(s.flow[0].current_step,"pending_email");assert.equal(s.factor[0].factor_status,"pending");assert.equal(s.membership[0].membership_status,"invited");assert.equal(s.tenant[0].tenant_status,"pending");assert.equal(s.sessions.length,0);
 }finally{await f.db.close();}
});
for(const transition of ["rejected_email","verified_email"])test("Company "+transition+" audit failure rolls back all state",async()=>{
 const f=await fixture();try{
  const before=await state(f),action=transition==="rejected_email"?"authentication.otp.failed":"authentication.otp.verified";
  await f.db.query(`CREATE FUNCTION company_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='${action}' THEN RAISE EXCEPTION 'company audit unavailable'; END IF; RETURN NEW; END; $$`);
  await f.db.query("CREATE TRIGGER company_test_audit_failure BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION company_test_reject_audit()");
  await assert.rejects(f.service.verifyEmail({token:f.token,code:transition==="rejected_email"?wrong(f.code):f.code,requestFingerprint:"company-audit-failure"}),/company audit unavailable/);
  assert.deepEqual(await state(f),before);
 }finally{await f.db.close();}
});

for(const auditUnavailable of [false,true])test("Company rejected MFA "+(auditUnavailable?"rolls back when audit fails":"commits immutable failure without activating"),async()=>{
 const f=await fixture();try{
  await f.service.verifyEmail({token:f.token,code:f.code,requestFingerprint:"verified-email"});
  const before=await state(f);
  if(auditUnavailable){
   await f.db.query("CREATE FUNCTION company_test_reject_mfa_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='authentication.mfa.failed' THEN RAISE EXCEPTION 'company MFA audit unavailable'; END IF; RETURN NEW; END; $$");
   await f.db.query("CREATE TRIGGER company_test_mfa_audit_failure BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION company_test_reject_mfa_audit()");
  }
  await assert.rejects(f.service.verifyMfa({token:f.token,code:"invalid",requestFingerprint:"wrong-mfa"}),auditUnavailable?/company MFA audit unavailable/:e=>e.code==="invalid_code");
  const after=await state(f);
  if(auditUnavailable)assert.deepEqual(after,before);
  else{
   for(const key of ["account","flow","factor","tenant","membership","challenge","sessions"])assert.deepEqual(after[key],before[key]);
   assert.equal(after.events.filter(e=>e.event_type==="mfa_failed").length,1);
   assert.equal(after.audit.filter(e=>e.action_key==="authentication.mfa.failed"&&e.actor_account_id===f.flow.account_id).length,1);
  }
 }finally{await f.db.close();}
});

test("Company valid MFA enrollment audit failure rolls back factor, membership and flow activation",async()=>{
 const f=await fixture();try{
  const publicState=await f.service.verifyEmail({token:f.token,code:f.code,requestFingerprint:"verified-company-email"});
  const before=await state(f);
  await f.db.query("CREATE FUNCTION company_test_reject_enrollment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='authentication.mfa.enrolled' THEN RAISE EXCEPTION 'company enrollment audit unavailable'; END IF; RETURN NEW; END; $$");
  await f.db.query("CREATE TRIGGER company_test_enrollment_audit_failure BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION company_test_reject_enrollment_audit()");
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",bits=[...publicState.totpSetupKey].map(c=>alphabet.indexOf(c).toString(2).padStart(5,"0")).join("");
  const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
  const message=Buffer.alloc(8);message.writeBigUInt64BE(BigInt(Math.floor(new Date(NOW).getTime()/30000)));
  const digest=createHmac("sha1",Buffer.from(bytes)).update(message).digest(),offset=digest.at(-1)&15;
  const code=String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
  await assert.rejects(f.service.verifyMfa({token:f.token,code,requestFingerprint:"valid-company-mfa-audit-failure"}),/company enrollment audit unavailable/);
  assert.deepEqual(await state(f),before);
 }finally{await f.db.close();}
});

test("Company early resend preserves all rows, then cooldown boundary rotates only current email challenge",async()=>{
 const f=await fixture();try{
  const before=await state(f);await assert.rejects(f.service.resendEmail({token:f.token,requestFingerprint:'company-early-resend'}),e=>e.code==='challenge_cooldown');assert.deepEqual(await state(f),before);
  const later=new CompanyRegistrationService(new CompanyRegistrationRepository(f.db),{pepper:ENV.authPepper,sandboxEnabled:true},()=>new Date('2026-10-05T03:01:00.000Z'));
  const result=await later.resendEmail({token:f.token,requestFingerprint:'company-after-cooldown'});assert.equal(result.step,'pending_email');
  const rows=(await f.db.query('SELECT c.*,d.encrypted_code FROM auth_otp_challenges c JOIN auth_sandbox_deliveries d ON d.challenge_id=c.challenge_id WHERE c.account_id=$1 ORDER BY c.created_at',[f.flow.account_id])).rows;assert.equal(rows.length,2);assert.ok(rows[0].invalidated_at);assert.equal(rows[0].consumed_at,null);assert.equal(rows[1].invalidated_at,null);assert.equal(rows[1].attempts_remaining,5);
  const fresh=decryptSecret(rows[1].encrypted_code,ENV.authPepper);if(fresh!==f.code)await assert.rejects(later.verifyEmail({token:f.token,code:f.code,requestFingerprint:'old-company-code'}),e=>e.code==='invalid_code');
  assert.equal((await later.verifyEmail({token:f.token,code:fresh,requestFingerprint:'new-company-code'})).step,'pending_mfa');
  assert.equal((await f.db.query('SELECT count(*)::int AS count FROM auth_sessions WHERE account_id=$1',[f.flow.account_id])).rows[0].count,0);
 }finally{await f.db.close();}
});
test("Company expired email does not consume attempts or advance; resend recovers pending MFA",async()=>{
 const f=await fixture();try{
  const later=new CompanyRegistrationService(new CompanyRegistrationRepository(f.db),{pepper:ENV.authPepper,sandboxEnabled:true},()=>new Date('2026-10-05T03:10:00.000Z'));
  const before=await state(f);await assert.rejects(later.verifyEmail({token:f.token,code:f.code,requestFingerprint:'expired-company-code'}),e=>e.code==='challenge_expired');assert.deepEqual(await state(f),before);
  await later.resendEmail({token:f.token,requestFingerprint:'expired-company-resend'});
  const delivery=(await f.db.query('SELECT d.encrypted_code FROM auth_sandbox_deliveries d JOIN auth_otp_challenges c ON c.challenge_id=d.challenge_id WHERE c.account_id=$1 AND c.invalidated_at IS NULL',[f.flow.account_id])).rows[0];
  assert.equal((await later.verifyEmail({token:f.token,code:decryptSecret(delivery.encrypted_code,ENV.authPepper),requestFingerprint:'new-company-code'})).step,'pending_mfa');
  assert.equal((await f.db.query('SELECT count(*)::int AS count FROM auth_sessions WHERE account_id=$1',[f.flow.account_id])).rows[0].count,0);
 }finally{await f.db.close();}
});
