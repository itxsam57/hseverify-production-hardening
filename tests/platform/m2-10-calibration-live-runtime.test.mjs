import assert from "node:assert/strict";
import test from "node:test";
import {fixture} from "../helpers/written-scoring-authority-fixture.mjs";
import {seedWorkerPrincipal,stableId} from "../helpers/assessment-attempt-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {WrittenReviewAssignmentService}=loadWorkerRegistrationTs("src/lib/scoring/written-review-assignment-service.ts");
const {WrittenScoringService}=loadWorkerRegistrationTs("src/lib/scoring/written-scoring-service.ts");
const {eligibleWrittenReviewers}=loadWorkerRegistrationTs("src/lib/scoring/written-review-eligibility.ts");

for(const mode of ["FAILED","EXPIRED","SUSPENDED","CURRENT_BUT_TIME_EXPIRED"]){
 test("M2.10.05 "+mode+" blocks live scoring, marks, calibration notes, reviewer selection and leaves a recoverable case",{timeout:45000},async()=>{
  const f=await fixture("m21005-"+mode,"0127_written_scoring_additional_review");
  try{
   const adminRaw=await seedWorkerPrincipal(f.db,"m21005-admin-"+mode);
   await f.db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[adminRaw.accountId]);
   await f.db.query("UPDATE auth_sessions SET active_role='admin' WHERE session_id=$1",[adminRaw.sessionId]);
   const admin={...adminRaw,activeRole:"admin"};
   const assignment=new WrittenReviewAssignmentService(f.db);
   assert.ok((await eligibleWrittenReviewers(f.db,f.caseId,f.attemptId)).some(x=>x.accountId===f.actor.accountId));
   assert.ok((await f.service.listReviewQueue({reviewerAccountId:f.actor.accountId})).find(x=>x.review_id===f.reviewId).canReview);
   const now=Date.now(),validFrom=new Date(now-180000).toISOString();
   const validUntil=new Date(mode==="EXPIRED"||mode==="CURRENT_BUT_TIME_EXPIRED"?now-1000:now+86400000).toISOString();
   const status=mode==="CURRENT_BUT_TIME_EXPIRED"?"CURRENT":mode;
   await f.db.query(`INSERT INTO staff_calibrations(calibration_id,account_id,role,framework_reference,status,valid_from,valid_until,note,recorded_by_account_id,framework_id,framework_version_id)
    SELECT $1,account_id,role,framework_reference,$2,$3,$4,'Authoritative live calibration withheld',$5,framework_id,framework_version_id FROM staff_calibrations WHERE account_id=$6 ORDER BY calibration_sequence DESC LIMIT 1`,
   [stableId("staff_calibration","blocked-"+mode),status,validFrom,validUntil,admin.accountId,f.actor.accountId]);
   const current=(await f.service.listReviewQueue({reviewerAccountId:f.actor.accountId})).find(x=>x.review_id===f.reviewId);
   assert.ok(current);assert.equal(current.canReview,false);
   assert.equal(current.canAmend,false);assert.deepEqual(current.questions,[]);
   assert.match(current.unavailableReason,/calibration/i);
   assert.ok(!(await eligibleWrittenReviewers(f.db,f.caseId,f.attemptId)).some(x=>x.accountId===f.actor.accountId));
   const adminQueue=(await assignment.list(admin)).find(x=>x.caseId===f.caseId);
   assert.ok(adminQueue);assert.ok(!adminQueue.candidates.some(x=>x.accountId===f.actor.accountId));
   const marking={reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,criterion:"Q1:C0",mark:99,reason:"Would bypass expired or failed calibration.",expectedRevision:0};
   const saves={reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,expectedRevision:0,decision:"PASS",reason:"Would bypass expired or failed calibration."};
   await assert.rejects(f.service.addRubricMark(marking),/calibration/i);
   await assert.rejects(f.service.saveDraftDecision(saves),/calibration/i);
   await assert.rejects(f.service.finalizeAndAdvance({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId}),/calibration/i);
   await assert.rejects(f.service.addCalibration({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,tenantId:f.tenantId,note:"A fake reviewer calibration note."}),/calibration/i);
   await assert.rejects(f.service.recordConflict({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,reason:"Would bypass expired or failed calibration.",expectedRevision:0}),/calibration/i);
   const foreign=new WrittenScoringService(f.db,{...admin,activeRole:"admin"});
   await assert.rejects(foreign.addRubricMark({...marking,reviewerAccountId:admin.accountId}),/actor|scope|reviewer/i);
   assert.equal((await f.db.query("SELECT count(*)::integer n FROM written_score_rubric_marks WHERE review_id=$1",[f.reviewId])).rows[0].n,0);
   assert.deepEqual((await f.db.query("SELECT status,score,decision,draft_revision FROM written_score_reviews WHERE review_id=$1",[f.reviewId])).rows[0],
     {status:"DRAFT",score:null,decision:null,draft_revision:0});
   assert.equal((await f.db.query("SELECT case_status FROM assurance_cases WHERE case_id=$1",[f.caseId])).rows[0].case_status,"Review pending");
   await f.db.query(`INSERT INTO staff_calibrations(calibration_id,account_id,role,framework_reference,status,valid_from,valid_until,note,recorded_by_account_id,framework_id,framework_version_id)
    SELECT $1,account_id,role,framework_reference,'CURRENT',$2,'2099-01-01','New verified current calibration',$3,framework_id,framework_version_id FROM staff_calibrations WHERE account_id=$4 ORDER BY calibration_sequence DESC LIMIT 1`,
    [stableId("staff_calibration","restored-"+mode),new Date(now-500).toISOString(),admin.accountId,f.actor.accountId]);
   assert.equal((await f.service.listReviewQueue({reviewerAccountId:f.actor.accountId})).find(x=>x.review_id===f.reviewId).canReview,true);
   assert.ok((await eligibleWrittenReviewers(f.db,f.caseId,f.attemptId)).some(x=>x.accountId===f.actor.accountId));
   await f.service.addRubricMark(marking);
   assert.equal((await f.db.query("SELECT count(*)::integer n FROM written_score_rubric_marks WHERE review_id=$1",[f.reviewId])).rows[0].n,1);
  }finally{await f.db.close();}
 });
}
