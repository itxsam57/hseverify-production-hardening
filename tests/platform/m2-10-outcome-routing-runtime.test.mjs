import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "../helpers/written-scoring-authority-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";

const { normalizeWrittenScoreDecision }=loadWorkerRegistrationTs("src/lib/scoring/written-scoring-domain.ts");

for (const scenario of [
 {decision:"PASS",marks:[90,90],status:"Decision pending",owner:"admin",next:/final Assurance Case decision/},
 {decision:"FAIL",marks:[60,60],status:"Reassessment required",owner:"worker",next:/Complete the required reassessment/},
 {decision:"CHANGES_REQUESTED",marks:[75,75],status:"Reassessment required",owner:"worker",next:/verifier requested a new assessment attempt/i}
]) {
 test("real scoring finalization routes "+scenario.decision+" to the correct next owner",async()=>{
  const f=await fixture("m210-outcome-"+scenario.decision.toLowerCase());
  try{
   for(const [i,mark] of scenario.marks.entries()) {
    await f.service.addRubricMark({
     reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,
     criterion:"Q1:C"+i,mark,reason:"Independently marked published safety response criterion.",
     expectedRevision:i
    });
   }
   const saved=await f.service.saveDraftDecision({
    reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,expectedRevision:2,
    decision:scenario.decision,reason:"Reasoned assessment conclusion from the exact pinned rubric and current response."
   });
   assert.equal(saved.decision,scenario.decision);
   await f.service.finalizeAndAdvance({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId});
   const source=(await f.db.query("SELECT status,decision,score FROM written_score_reviews WHERE review_id=$1",[f.reviewId])).rows[0];
   assert.equal(source.status,"FINAL");assert.equal(source.decision,scenario.decision);
   const state=(await f.db.query("SELECT case_status,owner_kind,next_action FROM assurance_cases WHERE case_id=$1",[f.caseId])).rows[0];
   assert.equal(state.case_status,scenario.status);assert.equal(state.owner_kind,scenario.owner);assert.match(state.next_action,scenario.next);
   const current=(await f.db.query("SELECT owner_kind,action_status FROM assurance_action_items WHERE case_id=$1 AND action_status='open'",[f.caseId])).rows;
   assert.equal(current.length,1);assert.equal(current[0].owner_kind,scenario.owner);
   await assert.rejects(f.service.finalizeAndAdvance({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId}));
   const final=(await f.db.query("SELECT status,decision,score FROM written_score_reviews WHERE review_id=$1",[f.reviewId])).rows[0];
   assert.deepEqual(final,source);
  }finally{await f.db.close();}
 });
}

test("ADDITIONAL_REVIEW is a distinct supported outcome, never an alias for Worker changes",()=>{
 assert.equal(normalizeWrittenScoreDecision("ADDITIONAL_REVIEW"),"ADDITIONAL_REVIEW");
 assert.notEqual(normalizeWrittenScoreDecision("ADDITIONAL_REVIEW"),"CHANGES_REQUESTED");
});

test("reasoned additional written review routes to Admin and a second independent calibrated Verifier with immutable original",async()=>{
 const f=await fixture("m210-second-independent","0127_written_scoring_additional_review");
 const {seedWorkerPrincipal,stableId}=await import("../helpers/assessment-attempt-fixture.mjs");
 const {WrittenReviewAssignmentService}=loadWorkerRegistrationTs("src/lib/scoring/written-review-assignment-service.ts");
 const {WrittenScoringService}=loadWorkerRegistrationTs("src/lib/scoring/written-scoring-service.ts");
 const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
 try {
  for(const [i,mark] of [65,90].entries())
   await f.service.addRubricMark({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,criterion:"Q1:C"+i,mark,reason:"Criterion marked for independent technical review.",expectedRevision:i});
  await f.service.saveDraftDecision({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,expectedRevision:2,decision:"ADDITIONAL_REVIEW",reason:"Independent verifier must investigate the contradictory safety evidence."});
  await f.service.finalizeAndAdvance({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId});
  const original=(await f.db.query("SELECT * FROM written_score_reviews WHERE review_id=$1",[f.reviewId])).rows[0];
  assert.equal(original.decision,"ADDITIONAL_REVIEW");assert.equal(original.status,"FINAL");
  assert.equal((await f.db.query("SELECT owner_kind,case_status FROM assurance_cases WHERE case_id=$1",[f.caseId])).rows[0].owner_kind,"admin");
  assert.equal((await f.db.query("SELECT case_status FROM assurance_cases WHERE case_id=$1",[f.caseId])).rows[0].case_status,"Review pending");
  const actions=(await f.db.query("SELECT owner_kind FROM assurance_action_items WHERE case_id=$1 AND action_status='open'",[f.caseId])).rows;
  assert.deepEqual(actions.map(r=>r.owner_kind),["admin"]);
  await assert.rejects(f.service.finalizeAndAdvance({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId}));
  await assert.rejects(f.service.beginAmendment({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,reason:"Attempt to override Admin-only independent reviewer selection."}),/Admin assignment|independent/i);
  await assert.rejects(f.service.amendFinal({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,score:100,decision:"PASS",reason:"Attempt to bypass the independently required second review."}),/Admin reassignment/i);
  assert.equal((await f.service.listReviewQueue({reviewerAccountId:f.actor.accountId})).find(r=>r.review_id===f.reviewId).canAmend,false);
  await assert.rejects(f.db.query("UPDATE written_score_reviews SET reason='Changed' WHERE review_id=$1",[f.reviewId]),/immutable/i);

  const secondWorker=await seedWorkerPrincipal(f.db,"m210-independent-second-verifier");
  const adminWorker=await seedWorkerPrincipal(f.db,"m210-independent-admin");
  for(const [account,role]of [[secondWorker,"verifier"],[adminWorker,"admin"]]) {
   await f.db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,$2)",[account.accountId,role]);
   await f.db.query("UPDATE auth_sessions SET active_role=$2 WHERE session_id=$1",[account.sessionId,role]);
  }
  const second={...secondWorker,activeRole:"verifier"};
  const admin={...adminWorker,activeRole:"admin"};
  await f.db.query(`INSERT INTO staff_calibrations(calibration_id,account_id,role,framework_reference,status,valid_from,valid_until,note,recorded_by_account_id,framework_id,framework_version_id)
   SELECT $1,$2,'verifier',framework_reference,status,valid_from,valid_until,'Current independent verifier',recorded_by_account_id,framework_id,framework_version_id
   FROM staff_calibrations WHERE account_id=$3 ORDER BY calibration_sequence DESC LIMIT 1`,[stableId("staff_calibration","m210-independent"),second.accountId,f.actor.accountId]);
  const assignments=new WrittenReviewAssignmentService(f.db);
  const queue=await assignments.list(admin),source=queue.find(r=>r.caseId===f.caseId);
  assert.ok(source,"Admin queue must display additional review pending");
  assert.ok(source.candidates.some(c=>c.accountId===second.accountId));
  assert.ok(!source.candidates.some(c=>c.accountId===f.actor.accountId),"First verifier must not be eligible for the independent review");
  const request={caseId:f.caseId,reviewerAccountId:second.accountId,expectedReviewId:f.reviewId,expectedRevision:source.revision,reason:"Assign independent calibrated reviewer for the retained first finding."};
  await assert.rejects(assignments.assign(f.actor,request),/access|role|admin/i);
  await assert.rejects(assignments.assign(admin,request),/MFA/i);
  const auth=new AuthAccessRepository(f.db),now=new Date().toISOString();
  await auth.authentication.insertSecurityEvent({eventId:"m210_admin_mfa",accountId:admin.accountId,eventType:"mfa_succeeded",activeRole:"admin",occurredAt:now});
  await auth.authentication.insertSecurityEvent({eventId:"m210_admin_login",accountId:admin.accountId,eventType:"login_succeeded",activeRole:"admin",metadata:{sessionId:admin.sessionId,mfaEventId:"m210_admin_mfa"},occurredAt:now});
  await assert.rejects(assignments.assign(admin,{...request,reviewerAccountId:f.actor.accountId}),/independent|calibrated|already assigned/i);
  const newId=await assignments.assign(admin,request);
  assert.notEqual(newId,f.reviewId);
  const preserved=(await f.db.query("SELECT * FROM written_score_reviews WHERE review_id=$1",[f.reviewId])).rows[0];
  assert.deepEqual({...preserved,status:"FINAL"},original);
  const newDraft=(await f.db.query("SELECT status,decision,score,reviewer_account_id,draft_revision FROM written_score_reviews WHERE review_id=$1",[newId])).rows[0];
  assert.deepEqual(newDraft,{status:"DRAFT",decision:null,score:null,reviewer_account_id:second.accountId,draft_revision:0});
  const linked=(await f.db.query("SELECT original_review_id,replacement_review_id,reviewer_account_id FROM written_score_amendments WHERE original_review_id=$1",[f.reviewId])).rows[0];
  assert.deepEqual(linked,{original_review_id:f.reviewId,replacement_review_id:newId,reviewer_account_id:second.accountId});
  assert.equal((await f.db.query("SELECT owner_kind FROM assurance_cases WHERE case_id=$1",[f.caseId])).rows[0].owner_kind,"reviewer");
  await assert.rejects(assignments.assign(admin,request),/changed|current/i);
  await assert.rejects(f.service.addRubricMark({reviewId:newId,reviewerAccountId:f.actor.accountId,criterion:"Q1:C0",mark:99,reason:"Old scorer cannot change new marks",expectedRevision:0}),/reviewer|own|actor/i);

  const secondService=new WrittenScoringService(f.db,second);
  for(const [i,mark] of [90,95].entries())
   await secondService.addRubricMark({reviewId:newId,reviewerAccountId:second.accountId,criterion:"Q1:C"+i,mark,reason:"Second independent criterion mark and reason.",expectedRevision:i});
  await secondService.saveDraftDecision({reviewId:newId,reviewerAccountId:second.accountId,expectedRevision:2,decision:"PASS",reason:"Second independent evidence review confirms the published standard."});
  await secondService.finalizeAndAdvance({reviewId:newId,reviewerAccountId:second.accountId});
  assert.equal((await f.db.query("SELECT status FROM written_score_reviews WHERE review_id=$1",[newId])).rows[0].status,"FINAL");
  assert.equal((await f.db.query("SELECT case_status,owner_kind FROM assurance_cases WHERE case_id=$1",[f.caseId])).rows[0].case_status,"Decision pending");
  assert.equal((await f.db.query("SELECT owner_kind FROM assurance_cases WHERE case_id=$1",[f.caseId])).rows[0].owner_kind,"admin");
  const history=(await f.db.query("SELECT decision,status,reviewer_account_id FROM written_score_reviews WHERE attempt_id=$1 ORDER BY created_at,review_id",[f.attemptId])).rows;
  assert.equal(history.length,2);assert.ok(history.some(x=>x.decision==="ADDITIONAL_REVIEW"&&x.status==="SUPERSEDED"));assert.ok(history.some(x=>x.decision==="PASS"&&x.status==="FINAL"));
  assert.equal((await f.db.query("SELECT COUNT(*)::integer n FROM platform_audit_events WHERE metadata->>'assessmentReviewAssignment'=$1",[newId])).rows[0].n,1);
  const {readFile}=await import("node:fs/promises");
  await assert.rejects(f.db.execute(await readFile("database/migrations/0127_written_scoring_additional_review.down.sql","utf8")),/retained additional written review decisions/i);
  assert.equal((await f.db.query("SELECT count(*)::integer n FROM written_score_reviews WHERE attempt_id=$1",[f.attemptId])).rows[0].n,2);
 }finally{await f.db.close();}
});
