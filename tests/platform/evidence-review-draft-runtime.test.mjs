import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const ENV={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",releaseSha:"review-draft-test",sessionSecret:"review-draft-session-secret-2026-00000000000000",authPepper:"review-draft-auth-pepper-2026-00000000000000",authSandboxEnabled:false,authSandboxAccessKey:null,demoAuthEnabled:false,demoDataEnabled:false};
const NOW=new Date().toISOString();
async function actor(db,id,role){
 await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$1,'active','scrypt$16384$8$1$salt$hash',$3,$3,$3,$3)",[id,id+"@example.test",NOW]);
 await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[id,role,NOW]);
 await db.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,$3,$1,$1,$4,$4,'2099-01-01')",[id+"_session",id,role,NOW]);
 return {accountId:id,sessionId:id+"_session",activeRole:role,accountStatus:"active",email:id+"@example.test",displayName:id,createdAt:NOW,lastSeenAt:NOW,expiresAt:"2099-01-01",tenantMembership:null};
}
async function fixture(){
 const db=await openScriptDatabase(ENV);await applyMigrationsThrough(db,ENV.releaseSha,"0104_evidence_review_drafts");
 const worker=await actor(db,"draft_worker","worker"),verifier=await actor(db,"draft_verifier","verifier"),other=await actor(db,"draft_other","verifier");
 await db.query("INSERT INTO worker_evidence_records(record_id,worker_account_id,record_kind,lifecycle_status,current_version_id,created_at,updated_at) VALUES('draft_record',$1,'qualification','active',NULL,$2,$2)",[worker.accountId,NOW]);
 await db.query("INSERT INTO worker_evidence_versions(version_id,record_id,version_number,revision,version_status,created_at,updated_at,submitted_at) VALUES('draft_version','draft_record',1,1,'submitted',$1,$1,$1)",[NOW]);
 await db.query("UPDATE worker_evidence_records SET current_version_id='draft_version' WHERE record_id='draft_record'");
 const service=new EvidenceReviewService(db),task=await service.queueIndependentWorkerEvidence(worker,"draft_record");await service.claim(verifier,task.taskId);
 return {db,worker,verifier,other,service,task};
}
test("Reviewer drafts reload privately, retain revisions and reject stale concurrent saves",async()=>{
 const f=await fixture();try{
 const first=await f.service.saveDraftNotes(f.verifier,f.task.taskId,"Contacted the issuer; awaiting their written response.",0);
 assert.equal(first.revision,1);assert.equal((await f.service.findDraftNotes(f.verifier,f.task.taskId)).notes,first.notes);
 await assert.rejects(f.service.findDraftNotes(f.other,f.task.taskId));await assert.rejects(f.service.findDraftNotes(f.worker,f.task.taskId));
 const attempts=await Promise.allSettled([f.service.saveDraftNotes(f.verifier,f.task.taskId,"Issuer confirmed the registration; checking dates.",1),f.service.saveDraftNotes(f.verifier,f.task.taskId,"Issuer response remains pending; checking records.",1)]);
 assert.equal(attempts.filter(x=>x.status==="fulfilled").length,1);
 const rows=(await f.db.query("SELECT revision,notes FROM evidence_review_draft_revisions WHERE task_id=$1 ORDER BY revision",[f.task.taskId])).rows;assert.equal(rows.length,2);assert.equal(rows[0].notes,first.notes);
 await assert.rejects(f.db.query("UPDATE evidence_review_draft_revisions SET notes='replacement' WHERE task_id=$1",[f.task.taskId]),/immutable|append.only/i);
 await assert.rejects(f.db.query("DELETE FROM evidence_review_draft_revisions WHERE task_id=$1",[f.task.taskId]),/immutable|append.only/i);
 }finally{await f.db.close();}
});
test("Revoked sessions cannot read drafts; finalized tasks retain original private history but deny writes",async()=>{
 const f=await fixture();try{
 await f.service.saveDraftNotes(f.verifier,f.task.taskId,"Initial private issuer checks are in progress.",0);
 await f.db.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='Draft regression revocation' WHERE session_id=$1",[f.verifier.sessionId]);
 await assert.rejects(f.service.findDraftNotes(f.verifier,f.task.taskId));await assert.rejects(f.service.saveDraftNotes(f.verifier,f.task.taskId,"Invalid revoked update.",1));
 await f.db.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES('draft_fresh_session',$1,'verifier','draft_fresh_token','draft_fresh_csrf',$2,$2,'2099-01-01')",[f.verifier.accountId,NOW]);
 const fresh={...f.verifier,sessionId:"draft_fresh_session"};
 await f.service.decide(fresh,f.task.taskId,"CHANGES_REQUESTED","Please provide the missing certificate reference.");
 await assert.rejects(f.service.saveDraftNotes(fresh,f.task.taskId,"Finalized task update must be denied.",1));
 assert.equal((await f.service.findDraftNotes(fresh,f.task.taskId)).revision,1);
 assert.equal((await f.db.query("SELECT count(*)::int total FROM evidence_review_draft_revisions")).rows[0].total,1);
 }finally{await f.db.close();}
});

test("Conflicts remove draft access and populated draft history refuses migration rollback",async()=>{
 const f=await fixture();try{
 await f.service.saveDraftNotes(f.verifier,f.task.taskId,"Private issuer checks retained for audit history.",0);
 const down=await readFile("database/migrations/0104_evidence_review_drafts.down.sql","utf8");
 await assert.rejects(f.db.execute(down),/history must be retained/i);
 assert.equal((await f.service.findDraftNotes(f.verifier,f.task.taskId)).revision,1);
 await f.service.declareConflict(f.verifier,f.task.taskId,"I previously supervised this worker's submitted qualification.");
 await assert.rejects(f.service.findDraftNotes(f.verifier,f.task.taskId));
 await assert.rejects(f.service.saveDraftNotes(f.verifier,f.task.taskId,"Conflicted draft update must not be saved.",1));
 assert.equal((await f.db.query("SELECT count(*)::int total FROM evidence_review_draft_revisions")).rows[0].total,1);
 const audit=(await f.db.query("SELECT metadata FROM platform_audit_events WHERE action_key='verification.draft.saved'")).rows;
 assert.equal(audit.length,1);assert.equal(JSON.stringify(audit).includes("Private issuer checks"),false);
 }finally{await f.db.close();}
});

test("Changed evidence version cannot receive a draft and audit failure rolls back the draft revision",async()=>{
 const f=await fixture();try{
 await f.db.execute("CREATE FUNCTION fail_draft_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected draft audit failure'; END $$; CREATE TRIGGER fail_draft_audit BEFORE INSERT ON platform_audit_events FOR EACH ROW WHEN(NEW.action_key='verification.draft.saved') EXECUTE FUNCTION fail_draft_audit();");
 await assert.rejects(f.service.saveDraftNotes(f.verifier,f.task.taskId,"This private draft must roll back with audit failure.",0),/Injected draft audit failure/);
 assert.equal((await f.db.query("SELECT count(*)::int total FROM evidence_review_draft_revisions")).rows[0].total,0);
 await f.db.execute("DROP TRIGGER fail_draft_audit ON platform_audit_events;DROP FUNCTION fail_draft_audit();");
 await f.db.query("INSERT INTO worker_evidence_versions(version_id,record_id,version_number,revision,version_status,supersedes_version_id,created_at,updated_at) VALUES('draft_new_version','draft_record',2,1,'draft','draft_version',$1,$1)",[NOW]);
 await f.db.query("UPDATE worker_evidence_records SET current_version_id='draft_new_version' WHERE record_id='draft_record'");
 await assert.rejects(f.service.saveDraftNotes(f.verifier,f.task.taskId,"Stale submitted source must never receive new notes.",0));
 assert.equal((await f.db.query("SELECT count(*)::int total FROM evidence_review_draft_revisions")).rows[0].total,0);
 }finally{await f.db.close();}
});
test("Empty draft migration rollback restores the exact audit constraint and reapplies cleanly",async()=>{
 const f=await fixture();try{
 const original=(await f.db.query("SELECT hse_review_draft_rollback_constraint() AS definition")).rows[0].definition;
 await f.db.execute(await readFile("database/migrations/0104_evidence_review_drafts.down.sql","utf8"));
 const restored=(await f.db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='platform_audit_events'::regclass AND conname='platform_audit_events_action_key_check'")).rows[0].definition;
 assert.equal(restored,original);
 await f.db.execute(await readFile("database/migrations/0104_evidence_review_drafts.up.sql","utf8"));
 assert.equal((await f.service.saveDraftNotes(f.verifier,f.task.taskId,"Draft saves work after safe empty rollback and reapply.",0)).revision,1);
 }finally{await f.db.close();}
});
