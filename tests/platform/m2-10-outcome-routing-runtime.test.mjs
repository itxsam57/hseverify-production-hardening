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

test("ADDITIONAL_REVIEW is not a supported written-scoring disposition and must not be reported as tested",()=>{
 assert.throws(()=>normalizeWrittenScoreDecision("ADDITIONAL_REVIEW"),/Unknown scoring decision/);
});
