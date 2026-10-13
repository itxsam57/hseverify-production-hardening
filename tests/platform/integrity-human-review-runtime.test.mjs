import assert from "node:assert/strict";
import test from "node:test";
import {integrityAssessmentFixture} from "../helpers/integrity-assessment-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {AssessmentIntegrityService}=loadWorkerRegistrationTs("src/lib/integrity/assessment-integrity-service.ts");
const {createIntegrityEvidenceEvent,summarizeIntegrityTimeline}=loadWorkerRegistrationTs("src/lib/integrity/integrity-domain.ts");
test("recovery retains serious concern independently of monitoring state",()=>{
 const events=["COPY_PASTE_DETECTED","BROWSER_RESUMED"].map((type,index)=>createIntegrityEvidenceEvent({eventId:"integrity_"+index,attemptId:"attempt_integrity",type,occurredAt:new Date().toISOString()}));
 assert.equal(summarizeIntegrityTimeline(events).classification,"RED");
 assert.equal(summarizeIntegrityTimeline(events).state,"RECOVERED");
});
test("actual objective assessment submission with retained concern requires human review",async()=>{
 const x=await integrityAssessmentFixture();try{
  await new AssessmentIntegrityService(Promise.resolve(x.database)).record(x.worker,x.attemptId,null,{type:"COPY_PASTE_DETECTED"});
  const submitted=await x.attempts.submitCurrentAnswer(x.worker,{attemptId:x.attemptId,position:1,answer:"Stop and assess"},new Date(),null);
  assert.equal(submitted.submitted,true);
  const row=(await x.database.query("SELECT case_status,owner_kind FROM assurance_cases WHERE case_id=$1",[x.sourceCase.case_id])).rows[0];
  assert.equal(row.case_status,"Review pending");
  assert.notEqual(row.owner_kind,null);
 }finally{await x.cleanup();}
});

const {IntegrityReviewService,assertIntegrityDispositionClear}=loadWorkerRegistrationTs("src/lib/integrity/integrity-review-service.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
for (const disposition of ["CLEAR","CONCERN_CONFIRMED","UNABLE","ESCALATE"]) {
 test("reasoned assigned integrity disposition "+disposition+" is immutable and controls progression",async()=>{
  const x=await integrityAssessmentFixture();try{
   await new AssessmentIntegrityService(Promise.resolve(x.database)).record(x.worker,x.attemptId,null,{type:"COPY_PASTE_DETECTED"});
   await x.attempts.submitCurrentAnswer(x.worker,{attemptId:x.attemptId,position:1,answer:"Stop and assess"},new Date(),null);
   const review=(await x.database.query("SELECT review_id,reviewer_account_id FROM written_score_reviews WHERE attempt_id=$1 AND status='DRAFT'",[x.attemptId])).rows[0];
   assert.ok(review);
   const sessionId="integrity_native_"+disposition,now=new Date().toISOString();
   await new AuthAccessRepository(x.database).authentication.insertSession({sessionId,accountId:review.reviewer_account_id,activeRole:"verifier",tokenHash:sessionId.padEnd(64,"0"),csrfTokenHash:sessionId.padEnd(64,"1"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
   const principal={accountId:review.reviewer_account_id,sessionId,activeRole:"verifier",accountStatus:"active",tenantMembership:null};
   const service=new IntegrityReviewService(x.database);
   await assert.rejects(service.resolve({...principal,sessionId:"forged"},{reviewId:review.review_id,disposition,reason:"Reviewed actual signal chronology",expectedEventCount:1}));
   await assert.rejects(service.resolve(principal,{reviewId:review.review_id,disposition,reason:"Reviewed actual signal chronology",expectedEventCount:2}));
   await service.resolve(principal,{reviewId:review.review_id,disposition,reason:"Reviewed actual signal chronology",expectedEventCount:1});
   if(disposition==="CLEAR") await assertIntegrityDispositionClear(x.database,x.attemptId);
   else {await assert.rejects(assertIntegrityDispositionClear(x.database,x.attemptId));const row=(await x.database.query("SELECT owner_kind,case_status FROM assurance_cases WHERE case_id=$1",[x.sourceCase.case_id])).rows[0];assert.equal(row.owner_kind,"admin");assert.equal(row.case_status,"Review pending");}
   await assert.rejects(x.database.query("UPDATE assessment_integrity_dispositions SET reason='Changed reason' WHERE attempt_id=$1",[x.attemptId]),/immutable/);
   await assert.rejects(service.resolve(principal,{reviewId:review.review_id,disposition,reason:"Duplicate final disposition",expectedEventCount:1}));
  }finally{await x.cleanup();}
 });
}
