import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {appealInterviewFixture,actualInterviewActions,recommendationForm} from "../helpers/appeal-interview-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const load=path=>loadWorkerRegistrationTs("src/lib/"+path+".ts");
const {InterviewSchedulingService}=load("interview/interview-scheduling-service");
const {InterviewRuntimeService}=load("interview/interview-runtime-service");
const {InterviewPlaybookService}=load("interview/interview-playbook-service");
const {AuthAccessRepository}=load("auth/auth-access-repository");
const {CaseAppealService}=load("assurance/case-appeal-service");
const {findAppealInterviewContext}=load("credential/appeal-interview-context");

for(const replacementMode of [false,true])test("Rejected-case "+(replacementMode?"replacement ":"")+"independent appeal interview uses real Assessor runtime and retains original decision",{timeout:180000},async()=>{
 const f=await appealInterviewFixture({caseAppeal:true});
 try{
  const db=f.database;
  const auth=new AuthAccessRepository(db),now=new Date().toISOString();
  await auth.authentication.insertSecurityEvent({eventId:"case-appeal-interview-mfa",accountId:f.admin.accountId,eventType:"mfa_succeeded",activeRole:"admin",occurredAt:now});
  await auth.authentication.insertSecurityEvent({eventId:"case-appeal-interview-login",accountId:f.admin.accountId,eventType:"login_succeeded",activeRole:"admin",metadata:{sessionId:f.admin.sessionId,mfaEventId:"case-appeal-interview-mfa"},occurredAt:now});
  const before=(await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[f.row.case_id])).rows[0];
  assert.equal(before.case_status,"Rejected");assert.equal(before.credential_reference,null);
  const originalDecision=before.decision_reference;
  const requested=await f.followups.requestInterview(f.admin,{appealId:f.appeal.appealId,expectedVersion:1,
   reason:"The independent appeal needs an additional assessed interview before determining its outcome."});
  assert.match(requested.interviewRequestId,/^interview_request_/);
  assert.equal(requested.assessorId,f.assessor.accountId,"A calibrated eligible Assessor must be assigned");
  assert.equal((await f.followups.listInterviews(f.worker,f.appeal.appealId)).length,1);
  await assert.rejects(f.followups.requestInterview(f.admin,{appealId:f.appeal.appealId,expectedVersion:1,
   reason:"Repeated stale Admin appeal interview request should never create a second interview."}),/version|conflict/i);
  await assert.rejects(new CaseAppealService(Promise.resolve(db)).review(f.admin,{appealId:f.appeal.appealId,
   version:2,status:"accepted",reason:"Prematurely approving the rejected case without finishing requested interview."}),/interview/i);
  const scheduling=new InterviewSchedulingService(db);
  let assigned=await scheduling.getAssignedInterview({assessorAccountId:f.assessor.accountId,interviewRequestId:requested.interviewRequestId});
  assert.equal((await findAppealInterviewContext(db,assigned.interviewRequestId)).kind,"case");
  assigned=await scheduling.scheduleInterview({principal:f.assessor,tenantId:f.row.tenant_id,request:assigned,scheduledAt:new Date().toISOString()});
  if(replacementMode){
   const interrupted=new InterviewRuntimeService(Promise.resolve(db));
   await interrupted.claim(f.assessor,assigned.interviewRequestId);
   await interrupted.technicalIssue(f.assessor,assigned.interviewRequestId,"The recorded technical interruption requires a fresh independent appeal interview.");
   const newRequest=await scheduling.requestReplacementInterview({principal:f.assessor,interviewRequestId:assigned.interviewRequestId,reason:"The interrupted appeal session needs an independently retained replacement."});
   assert.notEqual(newRequest.interviewRequestId,assigned.interviewRequestId);
   assigned=await scheduling.getAssignedInterview({assessorAccountId:f.assessor.accountId,interviewRequestId:newRequest.interviewRequestId});
   assigned=await scheduling.scheduleInterview({principal:f.assessor,tenantId:f.row.tenant_id,request:assigned,scheduledAt:new Date().toISOString()});
   assert.equal((await findAppealInterviewContext(db,assigned.interviewRequestId)).kind,"case");
  }
  const runtime=new InterviewRuntimeService(Promise.resolve(db));
  const session=await runtime.claim(f.assessor,assigned.interviewRequestId);
  await new InterviewPlaybookService(Promise.resolve(db)).ensure(f.assessor,assigned.interviewRequestId);
  await runtime.markWorkerReady(f.worker,assigned.interviewRequestId,{cameraReady:true,microphoneReady:true,connectionReady:true,identityConfirmed:true,recordingConsent:false});
  await runtime.admit(f.assessor,assigned.interviewRequestId);
  await runtime.start(f.assessor,assigned.interviewRequestId);
  await actualInterviewActions(db,f.assessor).saveInterviewConsoleAction(recommendationForm(assigned.interviewRequestId,session.interviewSessionId));
  await runtime.end(f.assessor,assigned.interviewRequestId);
  await actualInterviewActions(db,f.assessor).submitInterviewConsoleAction(recommendationForm(assigned.interviewRequestId,session.interviewSessionId));
  const after=(await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[f.row.case_id])).rows[0];
  assert.deepEqual(after,before,"Appeal interview must not reopen or mutate rejected original case");
  const visible=await f.followups.listInterviews(f.worker,f.appeal.appealId);
  assert.equal(visible[0].interviewRequestId,assigned.interviewRequestId,"Worker must open the active replacement, not cancelled original");
  const outcome=(await db.query("SELECT * FROM assurance_case_appeal_interview_outcomes WHERE interview_request_id=$1",[requested.interviewRequestId])).rows;
  assert.equal(outcome.length,1);assert.equal(outcome[0].recommendation,"PASS");
  assert.equal(outcome[0].assessor_account_id,f.assessor.accountId);
  const history=(await db.query("SELECT version,status,actor_account_id FROM assurance_case_appeal_events WHERE appeal_id=$1 ORDER BY version",[f.appeal.appealId])).rows;
  assert.deepEqual(history.map(row=>[Number(row.version),row.status]),[[1,"submitted"],[2,"under_review"],[3,"under_review"]]);
  await assert.rejects(f.followups.respondInterview(f.assessor,{interviewRequestId:assigned.interviewRequestId,recommendationEventId:outcome[0].recommendation_event_id}),/already completed|unavailable|conflict/i);
  if(replacementMode)assert.notEqual(outcome[0].interview_request_id,assigned.interviewRequestId,"Outcome must link to original case appeal request after a replacement");
  const latest=await new CaseAppealService(Promise.resolve(db)).review(f.admin,{
   appealId:f.appeal.appealId,version:3,status:"rejected",reason:"Independent interview completed; appeal declined with retained reasoned evidence."});
  assert.equal(latest.status,"rejected");assert.equal(latest.version,4);
  await assert.rejects(db.query("UPDATE assurance_case_appeal_interview_outcomes SET recommendation='FAIL' WHERE interview_request_id=$1",[requested.interviewRequestId]),/immutable/i);
  await assert.rejects(db.query(readFileSync("database/migrations/0134_case_appeal_interview.down.sql","utf8").split("DROP TRIGGER")[0]),/history cannot be rolled back/i);
  assert.equal((await db.query("SELECT decision_reference FROM assurance_cases WHERE case_id=$1",[f.row.case_id])).rows[0].decision_reference,originalDecision);
  console.log("M21303_CASE_INTERVIEW_COMPLETE: independent Admin -> calibrated Assessor -> real runtime -> immutable PASS -> reasoned final without reopening original rejected case");
 }finally{await f.cleanup()}
});
