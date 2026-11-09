import assert from "node:assert/strict";
import test from "node:test";
import {appealInterviewFixture,actualInterviewActions,recommendationForm} from "../helpers/appeal-interview-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {InterviewSchedulingService}=loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const {InterviewRuntimeService}=loadWorkerRegistrationTs("src/lib/interview/interview-runtime-service.ts");
const {InterviewPlaybookService}=loadWorkerRegistrationTs("src/lib/interview/interview-playbook-service.ts");
for(const replace of [false,true])test("Appeal "+(replace?"replacement ":"")+"interview completes through actual runtime and recommendation without reopening the original credential case",async()=>{
 const f=await appealInterviewFixture();try{
  const db=f.database,original=(await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[f.row.case_id])).rows[0];
  const followup=await f.followups.request({principal:f.admin,appealId:f.appeal.appealId,expectedVersion:1,kind:"interview",reason:"An independent interview is required to resolve the grounds of this appeal."});
  const scheduling=new InterviewSchedulingService(db);let request=await scheduling.getAssignedInterview({assessorAccountId:f.assessor.accountId,interviewRequestId:followup.interviewRequestId});
  if(replace){
   request=await scheduling.scheduleInterview({principal:f.assessor,tenantId:f.row.tenant_id,request,scheduledAt:new Date().toISOString()});
   const interrupted=new InterviewRuntimeService(Promise.resolve(db));await interrupted.claim(f.assessor,request.interviewRequestId);await interrupted.technicalIssue(f.assessor,request.interviewRequestId,"The documented connection failure requires a separate replacement interview.");
   const oldId=request.interviewRequestId,replacement=await scheduling.requestReplacementInterview({principal:f.assessor,interviewRequestId:oldId,reason:"Retain the interrupted appeal interview and schedule its replacement."});
   assert.equal((await scheduling.requestReplacementInterview({principal:f.assessor,interviewRequestId:oldId,reason:"Repeat the same retained replacement request safely."})).interviewRequestId,replacement.interviewRequestId);
   await assert.rejects(interrupted.start(f.assessor,oldId),/closed|replaced/i);request=await scheduling.getAssignedInterview({assessorAccountId:f.assessor.accountId,interviewRequestId:replacement.interviewRequestId});
  }
  request=await scheduling.scheduleInterview({principal:f.assessor,tenantId:f.row.tenant_id,request,scheduledAt:new Date().toISOString()});
  const runtime=new InterviewRuntimeService(Promise.resolve(db)),session=await runtime.claim(f.assessor,request.interviewRequestId);await new InterviewPlaybookService(Promise.resolve(db)).ensure(f.assessor,request.interviewRequestId);
  await runtime.markWorkerReady(f.worker,request.interviewRequestId,{cameraReady:true,microphoneReady:true,connectionReady:true,identityConfirmed:true,recordingConsent:false});await runtime.admit(f.assessor,request.interviewRequestId);await runtime.start(f.assessor,request.interviewRequestId);
  const {InterviewAccommodationSupportService}=loadWorkerRegistrationTs("src/lib/privacy/interview-accommodation-support.ts");assert.equal((await new InterviewAccommodationSupportService(Promise.resolve(db)).read(f.assessor,request.interviewRequestId)).role,"assessor");
  await actualInterviewActions(db,f.assessor).saveInterviewConsoleAction(recommendationForm(request.interviewRequestId,session.interviewSessionId));
  await runtime.end(f.assessor,request.interviewRequestId);await actualInterviewActions(db,f.assessor).submitInterviewConsoleAction(recommendationForm(request.interviewRequestId,session.interviewSessionId));
  assert.deepEqual((await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[f.row.case_id])).rows[0],original);
  const events=(await db.query("SELECT event_type,request_id,recommendation FROM credential_appeal_followup_events WHERE appeal_id=$1 ORDER BY appeal_version",[f.appeal.appealId])).rows;assert.deepEqual(events.map(e=>e.event_type),["requested","interview_submitted"]);assert.equal(events[1].request_id,followup.requestId);assert.equal(events[1].recommendation,"PASS");
  const notices=(await db.query("SELECT * FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'='appeal.interview.submitted'")).rows;assert.equal(notices.length,1);assert.equal(notices[0].enqueued_by_account_id,f.assessor.accountId);assert.equal(notices[0].enqueued_by_role,"assessor");await db.query("SELECT * FROM platform_project_assurance_event_notification($1)",[notices[0].job_id]);const recipients=(await db.query("SELECT recipient_account_id,recipient_role FROM platform_notifications WHERE source_job_id=$1",[notices[0].job_id])).rows;assert(recipients.some(r=>r.recipient_account_id===f.admin.accountId&&r.recipient_role==="admin"));assert(recipients.some(r=>r.recipient_account_id===f.worker.accountId&&r.recipient_role==="worker"));assert(!recipients.some(r=>r.recipient_account_id===f.credentials.admin.accountId));
  const {CredentialAppealsRepository}=loadWorkerRegistrationTs("src/lib/credential/credential-appeals-repository.ts");const latest=await new CredentialAppealsRepository(Promise.resolve(db)).find(f.appeal.appealId);await f.appeals.reviewOutcome(latest,{status:"rejected",reviewerId:f.admin.accountId,reason:"The independent completed interview confirms the original reasoned outcome."});
  assert.deepEqual((await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[f.row.case_id])).rows[0],original);
 }finally{await f.cleanup();}
});

test("Withdrawn appeal removes followup interview mutation authority without changing the original case",async()=>{
 const f=await appealInterviewFixture();try{
  const request=await f.followups.request({principal:f.admin,appealId:f.appeal.appealId,expectedVersion:1,kind:"interview",reason:"An independent interview is needed for this subsequently withdrawn appeal."});
  const {CredentialAppealsRepository}=loadWorkerRegistrationTs("src/lib/credential/credential-appeals-repository.ts");const latest=await new CredentialAppealsRepository(Promise.resolve(f.database)).find(f.appeal.appealId);await f.appeals.withdraw(latest,f.row.permanent_worker_id);
  await assert.rejects(new InterviewRuntimeService(Promise.resolve(f.database)).claim(f.assessor,request.interviewRequestId),/appeal|closed/i);
  assert.equal((await f.database.query("SELECT status FROM interview_requests WHERE interview_request_id=$1",[request.interviewRequestId])).rows[0].status,"CANCELLED","Withdrawal must release the no-longer-needed appeal appointment workload");
 }finally{await f.cleanup();}
});

test("A later failed calibration supersedes current calibration for assigned appeal runtime and matching",async()=>{
 const f=await appealInterviewFixture();try{
  const db=f.database,followup=await f.followups.request({principal:f.admin,appealId:f.appeal.appealId,expectedVersion:1,kind:"interview",reason:"Independent interview requires current exact framework calibration."});
  const calibration=(await db.query("SELECT * FROM staff_calibrations WHERE account_id=$1 AND role='assessor' AND framework_version_id IS NOT NULL ORDER BY valid_from DESC,calibration_sequence DESC LIMIT 1",[f.assessor.accountId])).rows[0];
  const {StaffCalibrationService}=loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");await new StaffCalibrationService(Promise.resolve(db)).record(f.admin,{accountId:f.assessor.accountId,role:"assessor",frameworkReference:calibration.framework_reference,frameworkVersionId:calibration.framework_version_id,status:"FAILED",validFrom:new Date(),validUntil:new Date("2099-01-01"),note:"A subsequent benchmark failed and removes live eligibility."});
  await assert.rejects(new InterviewRuntimeService(Promise.resolve(db)).claim(f.assessor,followup.interviewRequestId),/calibration/i);
  await assert.rejects(new InterviewSchedulingService(db).getAssignedInterview({assessorAccountId:f.assessor.accountId,interviewRequestId:followup.interviewRequestId}),/calibration/i);
  const {InterviewAssignmentService}=loadWorkerRegistrationTs("src/lib/interview/interview-assignment-service.ts");
  const extra=await new InterviewSchedulingService(db).requestAdditionalInterview({tenantId:f.row.tenant_id,caseId:f.row.case_id,workerAccountId:f.worker.accountId,requestedAt:new Date().toISOString()});
  const evaluated=await new InterviewAssignmentService(db).evaluate(extra.interviewRequestId);assert.equal(evaluated.candidates.find(x=>x.assessorAccountId===f.assessor.accountId)?.checks.calibration,false);
 }finally{await f.cleanup();}
});

for(const expired of [false,true])test("Calibration "+(expired?"expiry":"failure")+" closes retained drafts, playbook, runtime and final submission",async()=>{
 const f=await appealInterviewFixture();try{
  const db=f.database,followup=await f.followups.request({principal:f.admin,appealId:f.appeal.appealId,expectedVersion:1,kind:"interview",reason:"Further interview must retain live exact framework calibration through final submission."});
  const scheduling=new InterviewSchedulingService(db),request=await scheduling.getAssignedInterview({assessorAccountId:f.assessor.accountId,interviewRequestId:followup.interviewRequestId});
  await scheduling.scheduleInterview({principal:f.assessor,tenantId:f.row.tenant_id,request,scheduledAt:new Date().toISOString()});
  const runtime=new InterviewRuntimeService(Promise.resolve(db)),session=await runtime.claim(f.assessor,request.interviewRequestId),playbook=new InterviewPlaybookService(Promise.resolve(db));await playbook.ensure(f.assessor,request.interviewRequestId);
  await runtime.markWorkerReady(f.worker,request.interviewRequestId,{cameraReady:true,microphoneReady:true,connectionReady:true,identityConfirmed:true,recordingConsent:false});await runtime.admit(f.assessor,request.interviewRequestId);await runtime.start(f.assessor,request.interviewRequestId);
  const actions=actualInterviewActions(db,f.assessor),form=recommendationForm(request.interviewRequestId,session.interviewSessionId);await actions.saveInterviewConsoleAction(form);await runtime.end(f.assessor,request.interviewRequestId);
  const calibration=(await db.query("SELECT * FROM staff_calibrations WHERE account_id=$1 AND role='assessor' AND framework_version_id IS NOT NULL ORDER BY valid_from DESC,calibration_sequence DESC LIMIT 1",[f.assessor.accountId])).rows[0];
  const {StaffCalibrationService}=loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");await new StaffCalibrationService(Promise.resolve(db)).record(f.admin,{accountId:f.assessor.accountId,role:"assessor",frameworkReference:calibration.framework_reference,frameworkVersionId:calibration.framework_version_id,status:expired?"CURRENT":"FAILED",validFrom:new Date(Date.now()-30000),validUntil:expired?new Date(Date.now()-1000):new Date("2099-01-01"),note:"Later effective result removes live interview eligibility before submission."});
  const {authorizeInterviewMedia}=loadWorkerRegistrationTs("src/lib/interview/interview-media-service.ts");await assert.rejects(authorizeInterviewMedia(db,{...f.assessor,role:"assessor"},request.interviewRequestId),/calibration/i);
  const {RecordingAssetService}=loadWorkerRegistrationTs("src/lib/recording/recording-asset-service.ts");await assert.rejects(new RecordingAssetService(Promise.resolve(db),{}).storeInterviewSegment(f.assessor,request.interviewRequestId,{ingestKey:"failed_calibration_recording",source:"VIDEO_AUDIO",mimeType:"video/webm",bytes:new Uint8Array([1]),startedAt:new Date().toISOString(),endedAt:new Date().toISOString()}),/calibration/i);
  const {InterviewAccommodationSupportService}=loadWorkerRegistrationTs("src/lib/privacy/interview-accommodation-support.ts");await assert.rejects(new InterviewAccommodationSupportService(Promise.resolve(db)).read(f.assessor,request.interviewRequestId),/calibration/i);
  await assert.rejects(runtime.view(f.assessor,request.interviewRequestId),/calibration/i);await assert.rejects(runtime.start(f.assessor,request.interviewRequestId),/calibration/i);await assert.rejects(playbook.getAssigned(f.assessor,request.interviewRequestId));await assert.rejects(playbook.ensure(f.assessor,request.interviewRequestId));
  await assert.rejects(actions.saveInterviewConsoleAction(form),/not found|calibration/i);await assert.rejects(actions.submitInterviewConsoleAction(form),/not found|calibration/i);
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM credential_appeal_followup_events WHERE appeal_id=$1 AND event_type='interview_submitted'",[f.appeal.appealId])).rows[0].n,0);
 }finally{await f.cleanup();}
});
