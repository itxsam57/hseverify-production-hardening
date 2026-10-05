import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {AuthenticationRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-repository.ts");
const {createIdentifier}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
const {AUDIT_ACTIONS}=loadWorkerRegistrationTs("src/lib/audit/audit-domain.ts");
const ENV={databaseDriver:"pglite",pgliteDataDir:"memory://",releaseSha:"password-change-audit-runtime"};
const OLD_EVENTS=["registration_started","otp_issued","otp_failed","otp_verified","password_created","password_reset_requested","password_reset_completed","login_failed","login_succeeded","logout","session_revoked","account_locked","account_unlocked","invitation_created","invitation_accepted","mfa_enrolled","mfa_failed","mfa_succeeded","access_denied"];
async function mappings(db){return (await db.query("SELECT event_type,platform_audit_auth_action(event_type) AS action,platform_audit_auth_target_type(event_type) AS target FROM unnest($1::text[]) AS event_type ORDER BY event_type",[OLD_EVENTS])).rows;}
test("Forward account-security migration preserves every prior native mapping and projects all six roles; application rollback retains immutable audit",async()=>{
 const db=await openScriptDatabase(ENV);try{
  await applyMigrationsThrough(db,ENV.releaseSha,"0080_staff_invitation_revocation_audit");
  const before=await mappings(db);assert.ok(before.every(x=>x.action));
  assert.equal((await db.query("SELECT platform_audit_auth_action('password_changed') AS action")).rows[0].action,null);
  await applyMigrationsThrough(db,ENV.releaseSha,"0081_account_security_audit");
  assert.deepEqual(await mappings(db),before);assert.ok(AUDIT_ACTIONS.includes("authentication.password.changed"));
  assert.deepEqual((await db.query("SELECT platform_audit_auth_action('password_changed') AS action,platform_audit_auth_target_type('password_changed') AS target")).rows,[{action:"authentication.password.changed",target:"account"}]);
  for(const [event,action] of [["mfa_replaced","authentication.mfa.replaced"],["mfa_recovery_codes_rotated","authentication.mfa.recovery_codes.rotated"]]) {
   assert.ok(AUDIT_ACTIONS.includes(action));
   assert.deepEqual((await db.query("SELECT platform_audit_auth_action($1) AS action,platform_audit_auth_target_type($1) AS target",[event])).rows,[{action,target:"account"}]);
  }
  const repository=new AuthenticationRepository(db),expected=[];
  for(const role of ["worker","company","assessor","verifier","admin","root"]){
   const accountId=createIdentifier("account"),eventId=createIdentifier("event"),now=new Date().toISOString();
   await repository.insertAccount({accountId,email:role+".password.audit@example.test",phone:null,displayName:"Password audit "+role,status:"pending_email",passwordHash:null,workerReference:null,now});
   await repository.addRole(accountId,role,now);
   await repository.insertSecurityEvent({eventId,accountId,eventType:"password_changed",activeRole:role,metadata:{otherSessionsRevoked:true},occurredAt:now});
   expected.push({actor_account_id:accountId,actor_role:role,source_event_id:eventId,target_type:"account",target_reference:accountId});
  }
  const root=expected.find(e=>e.actor_role==="root");
  for(const [event,action] of [["mfa_replaced","authentication.mfa.replaced"],["mfa_recovery_codes_rotated","authentication.mfa.recovery_codes.rotated"]]) {
   const eventId=createIdentifier("event");
   await repository.insertSecurityEvent({eventId,accountId:root.actor_account_id,eventType:event,activeRole:"root",metadata:{},occurredAt:new Date().toISOString()});
   assert.deepEqual((await db.query("SELECT actor_account_id,actor_role,source_event_id,target_type,target_reference FROM platform_audit_events WHERE action_key=$1",[action])).rows,[{...root,source_event_id:eventId}]);
  }
  const query="SELECT actor_account_id,actor_role,source_event_id,target_type,target_reference FROM platform_audit_events WHERE action_key='authentication.password.changed' ORDER BY actor_role";
  const result=(await db.query(query)).rows;assert.deepEqual(result,expected.sort((a,b)=>a.actor_role.localeCompare(b.actor_role)));
  await db.execute(await readFile("database/migrations/0081_account_security_audit.down.sql","utf8"));
  assert.deepEqual((await db.query(query)).rows,result);
  await assert.rejects(db.query("DELETE FROM platform_audit_events WHERE action_key='authentication.password.changed'"),/append.only|immutable/i);
 }finally{await db.close();}
});
for(const [event,action] of [["password_changed","authentication.password.changed"],["mfa_replaced","authentication.mfa.replaced"],["mfa_recovery_codes_rotated","authentication.mfa.recovery_codes.rotated"]])test("Native "+event+" audit destination failure rolls back the producer event",async()=>{
 const db=await openScriptDatabase(ENV);try{
  await applyMigrationsThrough(db,ENV.releaseSha,"0081_account_security_audit");
  await db.query(`CREATE FUNCTION password_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='${action}' THEN RAISE EXCEPTION 'password audit unavailable'; END IF; RETURN NEW; END; $$`);
  await db.query("CREATE TRIGGER password_test_audit_failure BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION password_test_reject_audit()");
  const eventId=createIdentifier("event");
  await assert.rejects(new AuthenticationRepository(db).insertSecurityEvent({eventId,accountId:null,eventType:event,activeRole:"worker",metadata:{otherSessionsRevoked:true},occurredAt:new Date().toISOString()}),/password audit unavailable/);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_security_events WHERE event_id=$1",[eventId])).rows[0].count,0);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE source_event_id=$1",[eventId])).rows[0].count,0);
 }finally{await db.close();}
});
