import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {fixture} from "../helpers/written-scoring-authority-fixture.mjs";
import {seedWorkerPrincipal} from "../helpers/assessment-attempt-fixture.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {WrittenReviewAssignmentService}=loadWorkerRegistrationTs("src/lib/scoring/written-review-assignment-service.ts");
const {WrittenScoringService}=loadWorkerRegistrationTs("src/lib/scoring/written-scoring-service.ts");
const {StaffCalibrationService}=loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
async function setup(seed){
 const f=await fixture(seed);
 await applyMigrationsThrough(f.db,"written-live-authority","0118_scoring_assignment_notifications");
 const promote=async(role)=>{
  const worker=await seedWorkerPrincipal(f.db,seed+role);
  await f.db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,$2)",[worker.accountId,role]);
  await f.db.query("UPDATE auth_sessions SET active_role=$2 WHERE session_id=$1",[worker.sessionId,role]);
  return {...worker,activeRole:role};
 };
 const admin=await promote("admin"),second=await promote("verifier"),auth=new AuthAccessRepository(f.db),now=new Date().toISOString(),event=randomUUID();
 await auth.authentication.insertSecurityEvent({eventId:event,accountId:admin.accountId,eventType:"mfa_succeeded",activeRole:"admin",occurredAt:now});
 await auth.authentication.insertSecurityEvent({eventId:randomUUID(),accountId:admin.accountId,eventType:"login_succeeded",activeRole:"admin",metadata:{sessionId:admin.sessionId,mfaEventId:event},occurredAt:now});
 const revision=(await f.db.query("SELECT revisions.* FROM assurance_framework_revisions revisions JOIN assessment_blueprint_versions blueprint USING(framework_id) WHERE blueprint.blueprint_version_id=$1",[f.blueprintVersionId])).rows[0];
 await new StaffCalibrationService(Promise.resolve(f.db)).record(admin,{accountId:second.accountId,role:"verifier",frameworkReference:revision.framework_reference,frameworkVersionId:revision.framework_version_id,status:"CURRENT",validFrom:new Date(revision.effective_from),validUntil:new Date("2099-01-01"),note:"Independent benchmark for reassignment recovery."});
 const service=new WrittenReviewAssignmentService(f.db);
 const assign=async(accountId)=>{
  const row=(await f.db.query("SELECT draft_revision FROM written_score_reviews WHERE review_id=$1",[f.reviewId])).rows[0];
  return service.assign(admin,{caseId:f.caseId,reviewerAccountId:accountId,expectedReviewId:f.reviewId,expectedRevision:row.draft_revision,reason:"Independent staffing recovery with original evidence retained."});
 };
 return {...f,admin,second,service,assign};
}
test("Reassignment excludes a declared written-scoring conflict",async()=>{
 const f=await setup("assignment-conflict");try{
  await f.service.list(f.admin);
  await new WrittenScoringService(f.db,f.actor).recordConflict({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,tenantId:f.tenantId,reason:"I previously supervised this worker and must not review this evidence."});
  await f.assign(f.second.accountId);
  const rows=await f.service.list(f.admin);
  assert.ok(!rows.find(row=>row.caseId===f.caseId).candidates.some(candidate=>candidate.accountId===f.actor.accountId));
  await assert.rejects(f.assign(f.actor.accountId),/independent|calibrat|conflict/i);
 }finally{await f.db.close();}
});
test("Returning assignment to the original reviewer requires fresh marks and retains historical marks",async()=>{
 const f=await setup("assignment-marks");try{
  const scoring=new WrittenScoringService(f.db,f.actor);
  for(let index=0;index<2;index++)await scoring.addRubricMark({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,criterion:"Q1:C"+index,mark:100,reason:"Original rubric observation before staffing change.",expectedRevision:index});
  await f.assign(f.second.accountId);await f.assign(f.actor.accountId);
  const view=(await scoring.listReviewQueue({reviewerAccountId:f.actor.accountId}))[0];
  assert.equal(view.rubricMarks.length,0,"Earlier assignment marks must not become current again");
  await assert.rejects(scoring.saveDraftDecision({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,expectedRevision:view.draft_revision,decision:"PASS",reason:"A return assignment needs new criterion evidence."}),/criterion|mark/i);
  assert.equal((await f.db.query("SELECT COUNT(*)::integer n FROM written_score_rubric_marks WHERE review_id=$1",[f.reviewId])).rows[0].n,2);
 }finally{await f.db.close();}
});
test("Returning to an earlier assignee never revives an obsolete assignment notification",async()=>{
 const f=await setup("assignment-notice");try{
  await f.assign(f.second.accountId);
  const first=(await f.db.query("SELECT audit_event_id FROM platform_audit_events WHERE metadata->>'assessmentReviewAssignment'=$1 ORDER BY audit_sequence DESC LIMIT 1",[f.reviewId])).rows[0].audit_event_id;
  await f.assign(f.actor.accountId);await f.assign(f.second.accountId);
  const old=await f.db.query("SELECT * FROM platform_assurance_event_recipients('assessment.review.assigned',$1)",["scoring:"+first]);
  assert.equal(old.rows.length,0,"Superseded notification intent stays suppressed after A/B/A changes");
 }finally{await f.db.close();}
});
test("Candidate deactivation between eligibility and locking cannot create an unavailable assignment",async()=>{
 const f=await setup("assignment-account-race");try{
  let injected=false;
  const database=new Proxy(f.db,{get(target,key){
   if(key==="transaction")return operation=>target.transaction(tx=>operation(new Proxy(tx,{get(client,name){
    if(name==="query")return async(sql,params)=>{
     if(!injected&&sql.includes("FOR UPDATE OF accounts,roles")){injected=true;await client.query("UPDATE auth_accounts SET account_status='disabled' WHERE account_id=$1",[f.second.accountId]);}
     return client.query(sql,params);
    };
    const value=client[name];return typeof value==="function"?value.bind(client):value;
   }})));
   const value=target[key];return typeof value==="function"?value.bind(target):value;
  }});
  await assert.rejects(new WrittenReviewAssignmentService(database).assign(f.admin,{caseId:f.caseId,reviewerAccountId:f.second.accountId,expectedReviewId:f.reviewId,expectedRevision:0,reason:"Assignment must recheck a deactivated candidate after locking."}),/unavailable|eligib|reviewer/i);
  assert.equal((await f.db.query("SELECT reviewer_account_id FROM written_score_reviews WHERE review_id=$1",[f.reviewId])).rows[0].reviewer_account_id,f.actor.accountId);
 }finally{await f.db.close();}
});
