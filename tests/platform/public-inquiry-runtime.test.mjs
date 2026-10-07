import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../../tests/helpers/migration-ceiling.mjs";
import {loadTs as realTs} from "../../scripts/interview-test-ts-loader.mjs";
import {resolve} from "node:path";
const load=path=>realTs(resolve(path));
const {PublicInquiryRepository}=load("src/lib/public-inquiry/public-inquiry-repository.ts");
const env={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",releaseSha:"public-inquiry-prototype",sessionSecret:"inquiry-session-secret-more-than-32-characters",authPepper:"inquiry-auth-pepper-more-than-32-characters",authSandboxEnabled:false,authSandboxAccessKey:null,demoAuthEnabled:false,demoDataEnabled:false};
const input={kind:"demo",name:"Sample Person",email:"person@example.test",company:"Example",message:"Please arrange a demonstration.",submissionNonce:"n".repeat(32)};
const fingerprint="a".repeat(64),now=new Date("2026-10-06T12:20:00Z");
async function fixture(){
 const db=await openScriptDatabase(env);
 await applyMigrationsThrough(db,env.releaseSha,"0084_assessment_timeout_submission");
 const schema=readFileSync("database/migrations/0085_public_inquiry_intake.up.sql","utf8");
 await db.execute(schema);await db.execute(schema);
 return {db,repo:new PublicInquiryRepository(db,env.sessionSecret)};
}
test("public intake validates, deduplicates and keeps required audit free of private fields",async()=>{
 const {db,repo}=await fixture();try{
  await assert.rejects(repo.submit({...input,email:"bad"},fingerprint,now),/valid email/);
  assert.equal((await db.query("SELECT count(*)::int n FROM public_inquiries")).rows[0].n,0);
  const first=await repo.submit(input,fingerprint,now);
  assert.equal(first.created,true);
  assert.deepEqual(await repo.submit(input,fingerprint,now),{reference:first.reference,created:false});
  await assert.rejects(repo.submit({...input,kind:"contact"},fingerprint,now),/Reload/);
  await assert.rejects(repo.submit(input,"b".repeat(64),now),/Reload/);
  const events=(await db.query("SELECT action_key,actor_account_id,actor_role,metadata FROM platform_audit_events WHERE action_key='public_inquiry.received'")).rows;
  assert.equal(events.length,1);assert.equal(events[0].actor_account_id,null);assert.equal(events[0].actor_role,null);
  assert.deepEqual(events[0].metadata,{kind:"demo",systemComponent:"public-inquiry-intake"});
  assert.deepEqual((await db.query("SELECT used FROM public_inquiry_rate_windows")).rows.map(r=>r.used),[1,1]);
 }finally{await db.close();}
});
test("required audit failure rolls back intake and quotas; retry succeeds; email quota rejects excess",async()=>{
 const {db,repo}=await fixture();try{
  await db.execute("CREATE FUNCTION reject_inquiry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='public_inquiry.received' THEN RAISE EXCEPTION 'injected intake audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_inquiry_audit BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION reject_inquiry_audit();");
  await assert.rejects(repo.submit(input,fingerprint,now),/injected intake audit failure/);
  for(const table of ["public_inquiries","public_inquiry_rate_windows"])assert.equal((await db.query("SELECT count(*)::int n FROM "+table)).rows[0].n,0);
  await db.execute("DROP TRIGGER reject_inquiry_audit ON platform_audit_events; DROP FUNCTION reject_inquiry_audit();");
  for(let i=0;i<5;i++)assert.equal((await repo.submit({...input,submissionNonce:String(i).repeat(32)},fingerprint,now)).created,true);
  await assert.rejects(repo.submit({...input,submissionNonce:"x".repeat(32)},fingerprint,now),/Too many/);
  assert.equal((await db.query("SELECT count(*)::int n FROM public_inquiries")).rows[0].n,5);
  assert.equal((await db.query("SELECT count(*)::int n FROM platform_audit_events WHERE action_key='public_inquiry.received'")).rows[0].n,5);
  assert.deepEqual((await db.query("SELECT used FROM public_inquiry_rate_windows")).rows.map(r=>r.used),[5,5]);
  assert.equal((await repo.submit({...input,submissionNonce:"x".repeat(32)},fingerprint,new Date("2026-10-06T13:01:00Z"))).created,true);
 }finally{await db.close();}
});

test("private inquiry queue permits current Admin/Root sessions and denies public, other roles and revoked authority",async()=>{
 const {db,repo}=await fixture();try{
  const {bindPlatformAuditReadPrincipal}=load("src/lib/audit/audit-domain.ts");
  await repo.submit(input,fingerprint,now);
  await assert.rejects(repo.list({}),/audit|denied/i);
  await assert.rejects(repo.listForStaff({}));
  for(const role of ["worker","company","assessor","verifier"]) await assert.rejects(repo.listForStaff({accountId:"account_"+role,sessionId:"session_"+role,activeRole:role,accountStatus:"active",tenantMembership:null}),/audit|denied/i);
  for(const role of ["worker","company","assessor","verifier"])assert.throws(()=>bindPlatformAuditReadPrincipal({accountId:"account_"+role,sessionId:"session_"+role,activeRole:role,accountStatus:"active",tenantMembership:null}),/audit|denied/i);
  for(const role of ["admin","root"]){
   const id="account_"+role,sid="session_"+role;
   await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at) VALUES($1,$2,$1,'active','fixture',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",[id,role+"@example.test"]);
   await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,$2)",[id,role]);
   await db.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,expires_at) VALUES($1,$2,$3,$1,$1,'2099-01-01')",[sid,id,role]);
   const principal=bindPlatformAuditReadPrincipal({accountId:id,sessionId:sid,activeRole:role,accountStatus:"active",tenantMembership:null});
   const rows=await repo.listForStaff({accountId:id,sessionId:sid,activeRole:role,accountStatus:"active",tenantMembership:null});assert.equal(rows.length,1);assert.equal(rows[0].email,input.email);
   await db.query("UPDATE auth_accounts SET account_status='locked',locked_until='2099-01-01' WHERE account_id=$1",[id]);
   await assert.rejects(repo.listForStaff(principal),/denied/);
   await db.query("UPDATE auth_accounts SET account_status='active',locked_until=NULL WHERE account_id=$1",[id]);
   await db.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='fixture' WHERE session_id=$1",[sid]);
   await assert.rejects(repo.listForStaff(principal),/denied/);
  }
 }finally{await db.close();}
});

test("IP bucket applies across email addresses and intake audit remains immutable",async()=>{
 const {db,repo}=await fixture();try{
  for(let i=0;i<20;i++)await repo.submit({...input,email:"person"+i+"@example.test",submissionNonce:"ip_"+String(i).padStart(29,"0")},fingerprint,now);
  await assert.rejects(repo.submit({...input,email:"excess@example.test",submissionNonce:"z".repeat(32)},fingerprint,now),/Too many/);
  assert.equal((await db.query("SELECT count(*)::int n FROM public_inquiries")).rows[0].n,20);
  assert.equal((await db.query("SELECT count(*)::int n FROM public_inquiry_rate_windows")).rows[0].n,21);
  await assert.rejects(db.query("DELETE FROM platform_audit_events WHERE action_key='public_inquiry.received'"),/immutable|append|delete/i);
  await assert.rejects(db.query("UPDATE platform_audit_events SET metadata='{}' WHERE action_key='public_inquiry.received'"),/immutable|append|update/i);
  assert.equal((await db.query("SELECT count(*)::int n FROM platform_audit_events WHERE action_key='public_inquiry.received'")).rows[0].n,20);
 }finally{await db.close();}
});
