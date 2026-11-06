import assert from "node:assert/strict";
import test from "node:test";
import {policyInterview,actions,scoreForm,configuredPolicy,dimensions} from "../helpers/interview-policy-fixture.mjs";
test("M2.12.05 missing scorecard or missing recommendation never finalizes and a valid finalization changes decision once",{timeout:140000},async()=>{
 const x=await policyInterview({policy:{...configuredPolicy(),minimumActiveSeconds:0},start:true}),id=x.request.interviewRequestId;
 try{
  const a=actions(x);
  const snapshot=async()=>({
   request:(await x.database.query("SELECT status FROM interview_requests WHERE interview_request_id=$1",[id])).rows,
   case:(await x.database.query("SELECT case_status,owner_kind,interview_reference FROM assurance_cases WHERE case_id=$1",[x.request.caseId])).rows,
   events:(await x.database.query("SELECT count(*)::int n FROM interview_recommendation_events WHERE interview_request_id=$1",[id])).rows[0].n,
   draft:(await x.database.query("SELECT interview_session_id,scorecard,recommendation,submitted FROM interview_console_drafts WHERE interview_request_id=$1",[id])).rows
  });
  // Even a fully formed recommendation cannot submit before the runtime ends.
  await assert.rejects(a.submitInterviewConsoleAction(scoreForm(x)),/End the interview runtime/i);
  assert.equal((await x.runtime.view(x.principal,id)).status,"ACTIVE");
  for(const field of [...dimensions,"comments"]){
   const incomplete=scoreForm(x);incomplete.set(field,"");
   await a.saveInterviewConsoleAction(incomplete);
   await assert.rejects(x.runtime.end(x.principal,id),{name:"InterviewRuntimeConflictError"});
   assert.equal((await x.runtime.view(x.principal,id)).status,"ACTIVE");
   assert.equal((await snapshot()).events,0);
  }
  // Uncovered policy topics also reject End with a fully numeric scorecard.
  const uncovered=scoreForm(x);uncovered.delete("coveredQuestionId");
  await a.saveInterviewConsoleAction(uncovered);
  await assert.rejects(x.runtime.end(x.principal,id),/mandatory|coverage|topic/i);
  const complete=scoreForm(x);await a.saveInterviewConsoleAction(complete);
  assert.equal((await x.runtime.end(x.principal,id)).status,"ENDED");
  const frozen=await snapshot();assert.equal(frozen.request[0].status,"ASSIGNED");assert.equal(frozen.case[0].case_status,"Interview pending");assert.equal(frozen.events,0);assert.equal(frozen.draft[0].submitted,false);
  const missing=scoreForm(x);missing.delete("recommendation");
  const empty=scoreForm(x);empty.set("recommendation","");
  const invalid=scoreForm(x);invalid.set("recommendation","UNAPPROVED_PASS");
  const noComments=scoreForm(x);noComments.set("comments","");
  const incomplete=scoreForm(x);incomplete.set("technicalKnowledge","");
  const outOfRange=scoreForm(x);outOfRange.set("safetyAwareness","6");
  const notEnoughCoverage=scoreForm(x);notEnoughCoverage.delete("coveredQuestionId");
  for(const [label,attempt] of [["missing",missing],["empty",empty],["invalid",invalid],["no comments",noComments],["partial score",incomplete],["out of range",outOfRange],["missing coverage",notEnoughCoverage]]){
   await assert.rejects(a.submitInterviewConsoleAction(attempt),undefined,label+" should fail");
   assert.deepEqual(await snapshot(),frozen,label+" must not advance workflow, write recommendation/audit, alter saved scorecard or mark submitted");
  }
  const forged=scoreForm(x);forged.set("interviewSessionId","interview_session_forged_invalid_reference");
  await assert.rejects(a.submitInterviewConsoleAction(forged));
  assert.deepEqual(await snapshot(),frozen);
  const ok=scoreForm(x);
  await a.submitInterviewConsoleAction(ok);
  const completed=await snapshot();
  assert.equal(completed.request[0].status,"COMPLETED");assert.equal(completed.draft[0].submitted,true);assert.equal(completed.draft[0].recommendation,"PASS");assert.equal(completed.events,1);
  assert.notEqual(completed.case[0].case_status,"Interview pending");
  await assert.rejects(a.submitInterviewConsoleAction(ok));
  assert.deepEqual(await snapshot(),completed,"Duplicate submit must not create a second recommendation or double-advance");
  console.log("ACTUAL_M21205_NATIVE real pinned high-risk policy, 8 incomplete End denials, 8 invalid or forged Submit denials, frozen case+draft, complete PASS decision advances once, duplicate denied.");
 }finally{await x.cleanup();}
});
