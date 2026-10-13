import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {authorizeReviewFixture} from "../helpers/evidence-review-calibration-fixture.mjs";
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
 const db=await openScriptDatabase(ENV);await applyMigrationsThrough(db,ENV.releaseSha,"0108_review_resolution_notifications");
 const worker=await actor(db,"draft_worker","worker"),verifier=await actor(db,"draft_verifier","verifier"),other=await actor(db,"draft_other","verifier");
 await db.query("INSERT INTO worker_evidence_records(record_id,worker_account_id,record_kind,lifecycle_status,current_version_id,created_at,updated_at) VALUES('draft_record',$1,'qualification','active',NULL,$2,$2)",[worker.accountId,NOW]);
 await db.query("INSERT INTO worker_evidence_versions(version_id,record_id,version_number,revision,version_status,created_at,updated_at,submitted_at) VALUES('draft_version','draft_record',1,1,'submitted',$1,$1,$1)",[NOW]);
 await db.query("UPDATE worker_evidence_records SET current_version_id='draft_version' WHERE record_id='draft_record'");
 const service=new EvidenceReviewService(db),task=await service.queueIndependentWorkerEvidence(worker,"draft_record");await authorizeReviewFixture(db,{taskId:task.taskId,verifiers:[verifier,other],at:new Date(NOW)});await service.claim(verifier,task.taskId);
 return {db,worker,verifier,other,service,task};
}
test("Unable to verify preserves methods and limits without creating approval or fraud decision",async()=>{
 const f=await fixture();try{
 await f.service.resolveReview(f.verifier,f.task.taskId,{expectedRevision:0,outcome:"UNABLE_TO_VERIFY",reason:"The issuer records could not be independently confirmed.",attemptedMethods:"Contacted the issuer and checked the public registration directory.",limitations:"Issuer did not respond and the directory does not cover this year."});
 const task=(await f.db.query("SELECT task_status FROM evidence_review_tasks WHERE task_id=$1",[f.task.taskId])).rows[0];assert.equal(task.task_status,"UNABLE_TO_VERIFY");
 assert.equal((await f.db.query("SELECT count(*)::int total FROM evidence_review_decisions WHERE task_id=$1",[f.task.taskId])).rows[0].total,0);
 const event=(await f.db.query("SELECT outcome,attempted_methods,limitations FROM evidence_review_resolution_events WHERE task_id=$1",[f.task.taskId])).rows[0];assert.equal(event.outcome,"UNABLE_TO_VERIFY");assert.match(event.attempted_methods,/issuer/);assert.match(event.limitations,/respond/);
 assert.equal((await f.db.query("SELECT version_status FROM worker_evidence_versions WHERE version_id='draft_version'")).rows[0].version_status,"submitted");
 await assert.rejects(f.service.decide(f.verifier,f.task.taskId,"APPROVED","Neutral review cannot be silently changed to approval."));
 }finally{await f.db.close();}
});
test("Reasoned escalation reaches authorized Admin and returns to a claimable queue with retained history",async()=>{
 const f=await fixture();try{
 const admin=await actor(f.db,"review_admin","admin");
 await f.service.resolveReview(f.verifier,f.task.taskId,{expectedRevision:0,outcome:"ESCALATED",destination:"admin",reason:"Issuer information is inconsistent; independent review is required."});
 await assert.rejects(f.service.listEscalations(f.verifier));await assert.rejects(f.service.listEscalations(f.worker));
 const rows=await f.service.listEscalations(admin);assert.equal(rows.length,1);assert.equal(rows[0].taskId,f.task.taskId);
 await assert.rejects(f.service.returnEscalation(f.other,f.task.taskId,1,"Send the task back to the review queue."));
 await f.service.returnEscalation(admin,f.task.taskId,1,"Additional issuer records are available; return for independent review.");
 assert.equal((await f.db.query("SELECT task_status FROM evidence_review_tasks WHERE task_id=$1",[f.task.taskId])).rows[0].task_status,"QUEUED");
 assert.equal((await f.db.query("SELECT count(*)::int total FROM evidence_review_resolution_events WHERE task_id=$1",[f.task.taskId])).rows[0].total,2);
 await assert.rejects(f.service.returnEscalation(admin,f.task.taskId,1,"A stale Admin action must not repeat the return."));
 await f.service.claim(f.other,f.task.taskId);
 }finally{await f.db.close();}
});

test("Old resolution form cannot act after Admin return and same-Verifier reclaim",async()=>{
 const f=await fixture();try{
 const admin=await actor(f.db,"recycled_admin","admin");
 await f.service.resolveReview(f.verifier,f.task.taskId,{expectedRevision:0,outcome:"ESCALATED",destination:"admin",reason:"Independent issuer interpretation needs an Admin review."});
 await f.service.returnEscalation(admin,f.task.taskId,1,"Additional records are available; return this for review.");await f.service.claim(f.verifier,f.task.taskId);
 await assert.rejects(f.service.resolveReview(f.verifier,f.task.taskId,{expectedRevision:0,outcome:"UNABLE_TO_VERIFY",reason:"This is the stale original form.",attemptedMethods:"Original issuer checks from the previous assignment.",limitations:"Original issuer limitations from the previous assignment."}));
 assert.equal((await f.db.query("SELECT task_status FROM evidence_review_tasks WHERE task_id=$1",[f.task.taskId])).rows[0].task_status,"ASSIGNED");
 }finally{await f.db.close();}
});
test("Lower draft migration cannot erase a newer resolution contract even when both histories are empty",async()=>{
 const f=await fixture();try{
 await assert.rejects(f.db.execute(await readFile("database/migrations/0104_evidence_review_drafts.down.sql","utf8")),/newer|resolution.*depend/i);
 await f.service.resolveReview(f.verifier,f.task.taskId,{expectedRevision:0,outcome:"ESCALATED",destination:"admin",reason:"Escalation audit remains available after refused lower rollback."});
 }finally{await f.db.close();}
});

const escalationInput={expectedRevision:0,outcome:"ESCALATED",destination:"admin",reason:"Independent issuer checks require an Admin review."};
test("Foreign, demoted, conflicted and revoked reviewers cannot record resolutions",async()=>{
 for(const denial of ["foreign","demoted","conflicted","revoked"]){
  const f=await fixture();try{
   let reviewer=f.verifier;
   if(denial==="foreign")reviewer=f.other;
   if(denial==="demoted")await f.db.query("DELETE FROM auth_account_roles WHERE account_id=$1 AND role='verifier'",[f.verifier.accountId]);
   if(denial==="conflicted")await f.service.declareConflict(f.verifier,f.task.taskId,"I supervised this worker and cannot independently review.");
   if(denial==="revoked")await f.db.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='Resolution access regression' WHERE session_id=$1",[f.verifier.sessionId]);
   await assert.rejects(f.service.resolveReview(reviewer,f.task.taskId,escalationInput));
   assert.equal((await f.db.query("SELECT count(*)::int total FROM evidence_review_resolution_events")).rows[0].total,0);
  }finally{await f.db.close();}
 }
});
test("Resolution races have one winner and immutable history survives refused rollback",async()=>{
 const f=await fixture();try{
  const results=await Promise.allSettled([f.service.resolveReview(f.verifier,f.task.taskId,escalationInput),f.service.resolveReview(f.verifier,f.task.taskId,escalationInput)]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
  assert.equal((await f.db.query("SELECT count(*)::int total FROM evidence_review_resolution_events")).rows[0].total,1);
  await assert.rejects(f.db.query("UPDATE evidence_review_resolution_events SET reason='replacement' WHERE task_id=$1",[f.task.taskId]),/immutable|append.only/i);
  await assert.rejects(f.db.query("DELETE FROM evidence_review_resolution_events WHERE task_id=$1",[f.task.taskId]),/immutable|append.only/i);
  await assert.rejects(f.db.execute(await readFile("database/migrations/0105_evidence_review_resolutions.down.sql","utf8")),/Newer calibration or notification contracts depend on review resolution history/i);
  assert.equal((await f.service.findResolutionHistory(f.verifier,f.task.taskId)).length,1);
 }finally{await f.db.close();}
});
test("Resolution audit failure rolls back status and history atomically",async()=>{
 const f=await fixture();try{
  await f.db.execute("CREATE FUNCTION fail_resolution_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected resolution audit failure'; END $$; CREATE TRIGGER fail_resolution_audit BEFORE INSERT ON platform_audit_events FOR EACH ROW WHEN(NEW.action_key='verification.resolution.recorded') EXECUTE FUNCTION fail_resolution_audit();");
  await assert.rejects(f.service.resolveReview(f.verifier,f.task.taskId,escalationInput),/Injected resolution audit failure/);
  assert.equal((await f.db.query("SELECT count(*)::int total FROM evidence_review_resolution_events")).rows[0].total,0);
  assert.equal((await f.db.query("SELECT task_status FROM evidence_review_tasks WHERE task_id=$1",[f.task.taskId])).rows[0].task_status,"ASSIGNED");
 }finally{await f.db.close();}
});
test("Revoked and demoted Admin sessions cannot list or return escalations",async()=>{
 for(const denial of ["revoked","demoted"]){
  const f=await fixture();try{
   const admin=await actor(f.db,"denied_admin","admin");await f.service.resolveReview(f.verifier,f.task.taskId,escalationInput);
   if(denial==="revoked")await f.db.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='Admin access regression' WHERE session_id=$1",[admin.sessionId]);
   else await f.db.query("DELETE FROM auth_account_roles WHERE account_id=$1 AND role='admin'",[admin.accountId]);
   await assert.rejects(f.service.listEscalations(admin));await assert.rejects(f.service.returnEscalation(admin,f.task.taskId,1,"Fresh records allow another independent review."));
   assert.equal((await f.db.query("SELECT task_status FROM evidence_review_tasks WHERE task_id=$1",[f.task.taskId])).rows[0].task_status,"ESCALATED");
  }finally{await f.db.close();}
 }
});
test("Lower resolution rollback is refused while newer calibration/notification contracts exist",async()=>{
 const f=await fixture();try{
  await assert.rejects(f.db.execute(await readFile("database/migrations/0105_evidence_review_resolutions.down.sql","utf8")),/Newer calibration or notification contracts/);
  assert.equal((await f.db.query("SELECT to_regclass('public.evidence_review_resolution_events') AS relation")).rows[0].relation,"evidence_review_resolution_events");
  await f.service.resolveReview(f.verifier,f.task.taskId,escalationInput);
  assert.equal((await f.db.query("SELECT count(*)::int total FROM evidence_review_resolution_events WHERE task_id=$1",[f.task.taskId])).rows[0].total,1);
 }finally{await f.db.close();}
});

for(const outcome of ["APPROVED","REJECTED","CHANGES_REQUESTED"]){
 test("Stale ordinary "+outcome+" form is denied after escalation return and same-Verifier reclaim",async()=>{
  const f=await fixture();try{
   const admin=await actor(f.db,"fenced_admin","admin");
   await f.service.resolveReview(f.verifier,f.task.taskId,escalationInput);
   await f.service.returnEscalation(admin,f.task.taskId,1,"New issuer records are available; return for fresh review.");
   await f.service.claim(f.verifier,f.task.taskId);
   await assert.rejects(f.service.decide(f.verifier,f.task.taskId,outcome,"The stale original finalization must not affect the returned task.",new Date(),{expectedResolutionRevision:0}));
   assert.equal((await f.db.query("SELECT count(*)::int total FROM evidence_review_decisions WHERE task_id=$1",[f.task.taskId])).rows[0].total,0);
   await f.service.decide(f.verifier,f.task.taskId,outcome,"Fresh review against the returned task and latest Admin history.",new Date(),{expectedResolutionRevision:2});
   assert.equal((await f.db.query("SELECT task_status FROM evidence_review_tasks WHERE task_id=$1",[f.task.taskId])).rows[0].task_status,outcome);
  }finally{await f.db.close();}
 });
}
