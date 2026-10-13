import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedConsoleFile, seedConsoleIdentity } from "../helpers/interview-console-file-fixture.mjs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assessorInterviewSearchFixture } from "../helpers/assessor-interview-search-fixture.mjs";
import { authorizeReviewFixture } from "../helpers/evidence-review-calibration-fixture.mjs";
import { assessorSchedulingPrincipal } from "../helpers/assessor-scheduling-native-principal.mjs";
import { seedInProgressAttempt, ATTEMPT_NOW_DATE } from "../helpers/assessment-attempt-fixture.mjs";
import { loadWorkerRegistrationTs, setWorkerRegistrationRuntimeEnvironment } from "../helpers/worker-registration-runtime-loader.mjs";

const { InterviewConsoleContextService } = loadWorkerRegistrationTs("src/lib/interview/interview-console-context-service.ts");
const { SupervisorObservationService } = loadWorkerRegistrationTs("src/lib/review/supervisor-observation-service.ts");
const { EvidenceReviewService } = loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const { AuthAccessRepository } = loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const { InterviewSchedulingService } = loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const { AssessmentAttemptService } = loadWorkerRegistrationTs("src/lib/assessment-attempt/assessment-attempt-service.ts");
const { WrittenScoringService } = loadWorkerRegistrationTs("src/lib/scoring/written-scoring-service.ts");
const { StaffCalibrationService } = loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");
const { createRuntimePrivateObjectStorage } = loadWorkerRegistrationTs("src/lib/secure-files/private-object-storage.ts");
const hash = value => createHash("sha256").update(value).digest("hex");
const id = (prefix,value) => prefix+"_"+hash(value).slice(0,24);

async function principal(db,identity,role) {
  const sessionId="console-native-"+randomUUID(),now=new Date().toISOString();
  await new AuthAccessRepository(db).authentication.insertSession({
    sessionId,accountId:identity.accountId,activeRole:role,tokenHash:hash(sessionId),csrfTokenHash:hash("csrf:"+sessionId),
    userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()
  });
  return {accountId:identity.accountId,sessionId,activeRole:role,accountStatus:"active",tenantMembership:null};
}
async function fixture(options={}) {
  const f=await assessorInterviewSearchFixture({evidenceChecks:["qualification","employment"],...options}),db=await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
  const actor=await assessorSchedulingPrincipal(db,f.credentials.assessor);
  setWorkerRegistrationRuntimeEnvironment({appEnvironment:"test",sessionSecret:f.environment.HSE_SESSION_SECRET});
  return {...f,db,actor,service:new InterviewConsoleContextService(db),close:async()=>{await db.close();await f.cleanup();}};
}
async function evidence(x,kind,seed) {
  const recordId=id("evidence_record",kind+":"+seed),versionId=id("evidence_version",kind+":"+seed),now=new Date().toISOString();
  await x.db.query("INSERT INTO worker_evidence_records(record_id,worker_account_id,record_kind,lifecycle_status,current_version_id,created_at,updated_at) VALUES($1,$2,$3,'active',NULL,$4,$4)",[recordId,x.credentials.worker.accountId,kind,now]);
  await x.db.query("INSERT INTO worker_evidence_versions(version_id,record_id,version_number,version_status,created_at,updated_at,submitted_at) VALUES($1,$2,1,'submitted',$3,$3,$3)",[versionId,recordId,now]);
  await x.db.query("UPDATE worker_evidence_records SET current_version_id=$2 WHERE record_id=$1",[recordId,versionId]);
  if(kind==="qualification") await x.db.query("INSERT INTO worker_qualification_versions(version_id,qualification_title,issuing_organization,qualification_level,declaration_accepted) VALUES($1,$2,'Console issuer','Level 3',TRUE)",[versionId,seed+" qualification"]);
  if(kind==="employment") await x.db.query("INSERT INTO worker_employment_versions(version_id,company_name,role_title,duties,country,start_date,employment_status) VALUES($1,$2,'Electrician','Observed workplace duties.','Pakistan','2025-01-01','current')",[versionId,seed+" employer"]);
  return {recordId,versionId};
}
async function company(x) {
  const c=x.credentials.company;
  return {...await principal(x.db,c,"company"),authorizedTenantPermission:"company.orders.manage",
    tenantMembership:{tenantId:c.tenantId,tenantStatus:"active",membershipId:c.membershipId,role:"owner",status:"active",overrides:[]}};
}
async function approved(x) {
  const qualification=await evidence(x,"qualification","Owned"),employment=await evidence(x,"employment","Owned");
  const review=new EvidenceReviewService(x.db),verifier=await principal(x.db,x.credentials.verifier,"verifier");
  assert.equal(await review.queueCaseEvidence(await company(x),x.requests.Alpha.caseId),2);
  const tasks=(await x.db.query("SELECT task_id,evidence_kind FROM evidence_review_tasks WHERE case_id=$1 ORDER BY evidence_kind",[x.requests.Alpha.caseId])).rows;
  for(const task of tasks) {
    await authorizeReviewFixture(x.db,{taskId:task.task_id,verifiers:[verifier],at:new Date()});
    await review.claim(verifier,task.task_id);
    await review.decide(verifier,task.task_id,"APPROVED",task.evidence_kind==="employment"?"Explicitly shared employment verification.":"Private reviewer reason must stay private.",new Date(),{assessorVisible:task.evidence_kind==="employment"});
  }
  return {qualification,employment,tasks,review,verifier};
}

test("Owned console projects current approved evidence and only explicitly shared reviewer reasons",async()=>{
  const x=await fixture();
  try {
    const sources=await approved(x);
    const context=await x.service.load(x.actor,x.requests.Alpha.interviewRequestId);
    assert.equal(context.evidence.length,2);
    assert(context.evidence.some(e=>e.title==="Owned qualification"&&e.issuer==="Console issuer"));
    assert(context.evidence.some(e=>e.company==="Owned employer"&&e.role==="Electrician"));
    assert.deepEqual(context.comments.map(c=>c.reason),["Explicitly shared employment verification."]);
    assert(!JSON.stringify(context).includes("Private reviewer reason"));
    const rows=(await x.db.query("SELECT assessor_visible FROM evidence_review_decisions ORDER BY assessor_visible")).rows;
    assert.deepEqual(rows.map(r=>r.assessor_visible),[false,true]);
    await assert.rejects(x.db.query("UPDATE evidence_review_decisions SET assessor_visible=FALSE WHERE assessor_visible"),e=>e.code==="55000");
    const next=id("evidence_version","Owned newer"),now=new Date().toISOString();
    await x.db.query("INSERT INTO worker_evidence_versions(version_id,record_id,version_number,version_status,supersedes_version_id,created_at,updated_at,submitted_at) VALUES($1,$2,2,'submitted',$3,$4,$4,$4)",[next,sources.employment.recordId,sources.employment.versionId,now]);
    await x.db.query("UPDATE worker_evidence_records SET current_version_id=$2 WHERE record_id=$1",[sources.employment.recordId,next]);
    const updated=await x.service.load(x.actor,x.requests.Alpha.interviewRequestId);
    assert.equal(updated.evidence.length,1);assert.equal(updated.comments.length,0);
    await assert.rejects(x.db.exec(await readFile("database/migrations/0093_assessor_console_visibility.down.sql","utf8")),/history must be retained/);
  } finally {await x.close();}
});

test("Console denies foreign assignments, forged roles, revoked sessions and successor context on archived appointments",async()=>{
  const x=await fixture();
  try {
    await assert.rejects(x.service.load(x.actor,x.requests.ForeignAlpha.interviewRequestId),{name:"InterviewConsoleContextAccessError"});
    await assert.rejects(x.service.load({...x.actor,activeRole:"worker"},x.requests.Alpha.interviewRequestId),{name:"InterviewConsoleContextAccessError"});
    await x.db.query("UPDATE assurance_cases SET interview_reference=$2 WHERE case_id=$1",[x.requests.Alpha.caseId,x.requests.Beta.interviewRequestId]);
    assert.equal(await x.service.load(x.actor,x.requests.Alpha.interviewRequestId),null);
    await x.db.query("UPDATE assurance_cases SET interview_reference=$2 WHERE case_id=$1",[x.requests.Alpha.caseId,x.requests.Alpha.interviewRequestId]);
    await x.db.query("UPDATE interview_requests SET status='CANCELLED' WHERE interview_request_id=$1",[x.requests.Alpha.interviewRequestId]);
    assert.equal(await x.service.load(x.actor,x.requests.Alpha.interviewRequestId),null);
    await x.db.query("UPDATE auth_sessions SET revoked_at=clock_timestamp(),revocation_reason='security_review' WHERE session_id=$1",[x.actor.sessionId]);
    await assert.rejects(x.service.load(x.actor,x.requests.Beta.interviewRequestId),{name:"InterviewConsoleContextAccessError"});
  } finally {await x.close();}
});

test("Visibility migration restores private defaults and safely refuses retained opt-in history",async()=>{
  const x=await fixture();
  try {
    const down=await readFile("database/migrations/0093_assessor_console_visibility.down.sql","utf8"),up=await readFile("database/migrations/0093_assessor_console_visibility.up.sql","utf8");
    const before=(await x.db.query("SELECT table_name,column_name,column_default,is_nullable FROM information_schema.columns WHERE column_name='assessor_visible' ORDER BY table_name")).rows;
    assert.equal(before.length,2);assert(before.every(r=>r.column_default==="false"&&r.is_nullable==="NO"));
    await x.db.exec(down);
    assert.equal((await x.db.query("SELECT 1 FROM information_schema.columns WHERE column_name='assessor_visible'")).rows.length,0);
    await x.db.exec(up);
    assert.deepEqual((await x.db.query("SELECT table_name,column_name,column_default,is_nullable FROM information_schema.columns WHERE column_name='assessor_visible' ORDER BY table_name")).rows,before);
  } finally {await x.close();}
});

test("Console reads submitted pinned assessment topics and latest written revisions without answer keys",async()=>{
  const x=await fixture();
  try {
    const worker=await principal(x.db,x.credentials.worker,"worker");
    // Schema-valid form/catalogue context; actual answer/revision producers below.
    const attempt=await seedInProgressAttempt(x.db,worker,"console-assessment",[
      {questionType:"MULTIPLE_CHOICE",answerKey:"Alpha"},
      {questionType:"SHORT_TEXT",prompt:"Explain the isolation controls."},
      {questionType:"LONG_TEXT",prompt:"Explain the stop-work decision."}
    ]);
    await x.db.query("INSERT INTO assessment_blueprint_delivery_settings(blueprint_version_id,progression_mode) VALUES($1,'CONTROLLED_REVIEW')",[attempt.blueprintVersionId]);
    const pinnedFramework=(await x.db.query("SELECT framework_id FROM assessment_blueprint_versions WHERE blueprint_version_id=$1",[attempt.blueprintVersionId])).rows[0].framework_id;
    await x.db.query(`INSERT INTO assurance_case_policy_snapshots(snapshot_id,case_id,tenant_id,framework_id,policy_id,global_policy_version_id,policy_source,effective_value_json,reference_time)
      VALUES($1,$2,$3,$4,$5,$6,'GLOBAL','{\"pass_mark\":80}'::jsonb,$7)`,
      [id("policy_snapshot","console-assessment"),attempt.caseId,attempt.tenantId,pinnedFramework,id("policy","console-assessment"),id("policy_version","console-assessment"),ATTEMPT_NOW_DATE.toISOString()]);
    const assessment=new AssessmentAttemptService(x.db,requestTime=>requestTime);
    const now=ATTEMPT_NOW_DATE;
    await assessment.submitCurrentAnswer(worker,{attemptId:attempt.attemptId,position:1,answer:"Bravo"},now);
    await assessment.reviseCommittedAnswer(worker,{attemptId:attempt.attemptId,position:1,answer:"Alpha"},null,now);
    await assessment.submitCurrentAnswer(worker,{attemptId:attempt.attemptId,position:2,answer:"Initial written response."},now);
    await assessment.reviseCommittedAnswer(worker,{attemptId:attempt.attemptId,position:2,answer:"Latest submitted isolation response."},null,now);
    await assessment.submitCurrentAnswer(worker,{attemptId:attempt.attemptId,position:3,answer:"Stop work when safe isolation cannot be proved."},now);
    await assessment.finalizeAssessment(worker,attempt.attemptId,null,now);
    const scheduling=new InterviewSchedulingService(x.db);
    let request=await scheduling.requestInterview({tenantId:attempt.tenantId,caseId:attempt.caseId,workerAccountId:worker.accountId,requestedAt:new Date().toISOString()});
    request=await scheduling.assignInterview({tenantId:attempt.tenantId,request,assessorAccountId:x.actor.accountId});
    await x.db.query("UPDATE assurance_cases SET interview_reference=$2 WHERE case_id=$1",[attempt.caseId,request.interviewRequestId]);
    await x.db.query("INSERT INTO integrity_capture_events(event_id,attempt_id,event_type,classification,state,occurred_at,details) VALUES('console_integrity',$1,'focus_lost','YELLOW','OBSERVED',clock_timestamp(),'{\"privateDetectorDetail\":\"never project\"}')",[attempt.attemptId]);
    const context=await x.service.load(x.actor,request.interviewRequestId);
    assert.equal(context.attempts[0].status,"SUBMITTED");
    assert.equal(context.topics[0].total,3);
    assert.equal(context.topics[0].correct,1);
    assert.equal(context.topics[0].incorrectMcq,0);
    assert.equal(context.written.length,2);
    assert.equal(context.written[0].response,"Latest submitted isolation response.");
    assert.equal(context.integrity[0].classification,"YELLOW");
    assert(!JSON.stringify(context).includes("Initial written response."));
    assert(!JSON.stringify(context).includes("answer_key"));
    assert(!JSON.stringify(context).includes("privateDetectorDetail"));
    const review=(await x.db.query("SELECT review_id,reviewer_account_id FROM written_score_reviews WHERE attempt_id=$1 AND status='DRAFT'",[attempt.attemptId])).rows[0];
    assert(review);
    const reviewer=await principal(x.db,x.credentials.verifier,"verifier");
    assert.equal(reviewer.accountId,review.reviewer_account_id);
    const admin=await principal(x.db,x.credentials.admin,"admin");
    const framework=(await x.db.query("SELECT frameworks.framework_reference FROM assessment_blueprint_versions versions JOIN assurance_frameworks frameworks ON frameworks.framework_id=versions.framework_id WHERE versions.blueprint_version_id=$1",[attempt.blueprintVersionId])).rows[0];
    await new StaffCalibrationService(Promise.resolve(x.db)).record(admin,{accountId:reviewer.accountId,role:"verifier",frameworkReference:framework.framework_reference,status:"CURRENT",validFrom:ATTEMPT_NOW_DATE,validUntil:new Date("2099-01-01T00:00:00.000Z"),note:"Current calibration for the exact pinned written assessment framework."});
    const scoring=new WrittenScoringService(x.db,reviewer);
    await scoring.addRubricMark({reviewId:review.review_id,reviewerAccountId:reviewer.accountId,tenantId:attempt.tenantId,criterion:"Q2:C0",mark:80,reason:"Isolation controls meet the pinned rubric criterion.",expectedRevision:0});
    await scoring.addRubricMark({reviewId:review.review_id,reviewerAccountId:reviewer.accountId,tenantId:attempt.tenantId,criterion:"Q3:C0",mark:80,reason:"Stop-work reasoning meets the pinned rubric criterion.",expectedRevision:1});
    await scoring.saveDraftDecision({reviewId:review.review_id,reviewerAccountId:reviewer.accountId,tenantId:attempt.tenantId,expectedRevision:2,decision:"PASS",reason:"Explicitly shared final written assessment reason."});
    await scoring.finalize({reviewId:review.review_id,reviewerAccountId:reviewer.accountId,tenantId:attempt.tenantId,assessorVisible:true});
    assert((await x.service.load(x.actor,request.interviewRequestId)).comments.some(c=>c.reason==="Explicitly shared final written assessment reason."));
  } finally {await x.close();}
});

test("Assessor and Verifier preview current owned evidence through production filesystem storage and deny revoked authority",async()=>{
  const x=await fixture(),directory=await mkdtemp(join(tmpdir(),"hse-console-private-"));
  const oldRoot=process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT;
  process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT=join(directory,"objects");
  try {
    const source=await evidence(x,"qualification","Private file");
    const file=await seedConsoleFile(x.db,x.credentials.worker.accountId,"console-private-file");
    await createRuntimePrivateObjectStorage("production").put(file.objectKey,file.bytes);
    await x.db.query(
      "INSERT INTO worker_evidence_attachments(attachment_id,record_id,version_id,attachment_kind,secure_file_id,display_filename,created_at) VALUES($1,$2,$3,'primary_certificate',$4,'Console evidence.pdf',clock_timestamp())",
      [id("attachment","console-private"),source.recordId,source.versionId,file.fileId]);
    const review=new EvidenceReviewService(x.db),verifier=await principal(x.db,x.credentials.verifier,"verifier");
    assert.equal(await review.queueCaseEvidence(await company(x),x.requests.Alpha.caseId),1);
    const task=(await x.db.query("SELECT task_id FROM evidence_review_tasks WHERE case_id=$1",[x.requests.Alpha.caseId])).rows[0];
    await authorizeReviewFixture(x.db,{taskId:task.task_id,verifiers:[verifier],at:new Date()});
    await review.claim(verifier,task.task_id);
    setWorkerRegistrationRuntimeEnvironment({appEnvironment:"production",sessionSecret:x.environment.HSE_SESSION_SECRET});
    const verifierContent=await review.preview(verifier,task.task_id);
    assert.deepEqual(Buffer.from(verifierContent.bytes),file.bytes);
    await review.decide(verifier,task.task_id,"APPROVED","Reviewed private evidence.");
    const content=await x.service.preview(x.actor,x.requests.Alpha.interviewRequestId,file.fileId);
    assert.deepEqual(Buffer.from(content.bytes),file.bytes);
    assert.match(content.headers["Cache-Control"],/private/);
    assert.match(content.headers["Cache-Control"],/no-store/);
    assert.equal(content.headers["X-Content-Type-Options"],"nosniff");
    const otherFile=await seedConsoleFile(x.db,x.credentials.worker.accountId,"unbound-private-file");
    await assert.rejects(x.service.preview(x.actor,x.requests.Alpha.interviewRequestId,otherFile.fileId),{name:"SecureFileAccessDeniedError"});
    await assert.rejects(x.service.preview(x.actor,x.requests.ForeignAlpha.interviewRequestId,file.fileId),{name:"InterviewConsoleContextAccessError"});
    await x.db.query("UPDATE worker_evidence_attachments SET superseded_at=clock_timestamp() WHERE secure_file_id=$1",[file.fileId]);
    await assert.rejects(x.service.preview(x.actor,x.requests.Alpha.interviewRequestId,file.fileId),{name:"SecureFileAccessDeniedError"});
    await assert.rejects(review.preview(verifier,task.task_id),{name:"SecureFileAccessDeniedError"});
    await x.db.query("UPDATE auth_sessions SET revoked_at=clock_timestamp(),revocation_reason='security_review' WHERE session_id=$1",[verifier.sessionId]);
    await assert.rejects(review.preview(verifier,task.task_id),{name:"EvidenceReviewAccessError"});
  } finally {
    setWorkerRegistrationRuntimeEnvironment({appEnvironment:"test",sessionSecret:x.environment.HSE_SESSION_SECRET});
    if(oldRoot===undefined)delete process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT;else process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT=oldRoot;
    await rm(directory,{recursive:true,force:true});await x.close();
  }
});

test("Console shares only opted-in current identity review, verified profile photo and approved supervisor observation",async()=>{
  const x=await fixture({identityChecks:["document"],frameworkReferences:["SUPERVISOR-CONSOLE-PROOF"]}),directory=await mkdtemp(join(tmpdir(),"hse-console-photo-"));
  const oldRoot=process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT;
  process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT=join(directory,"objects");
  try {
    const identity=await seedConsoleIdentity(x.db,x.credentials.worker.accountId,"console-profile");
    const storage=createRuntimePrivateObjectStorage("production");
    for(const file of [identity.profile_photo,identity.selfie,identity.identity_document])await storage.put(file.objectKey,file.bytes);
    const review=new EvidenceReviewService(x.db),companyActor=await company(x),verifier=await principal(x.db,x.credentials.verifier,"verifier");
    const observations=new SupervisorObservationService(Promise.resolve(x.db));
    const observationId=await observations.create(companyActor,{
      caseId:x.requests.Alpha.caseId,observerMembershipId:x.credentials.company.membershipId,
      frameworkReference:"SUPERVISOR-CONSOLE-PROOF",competencyReference:"Safe isolation",taskReference:"Safe isolation task",
      checklist:[],supervisorDeclaration:"I personally observed the Worker isolate safely.",observedAt:new Date(),
      observationText:"Observed the Worker isolate and verify the circuit safely.",outcome:"demonstrated"
    });
    await observations.acknowledge(await principal(x.db,x.credentials.worker,"worker"),observationId,"I saw this observation.");
    assert.equal(await review.queueCaseEvidence(companyActor,x.requests.Alpha.caseId),1);
    for(const task of (await x.db.query("SELECT task_id,evidence_kind FROM evidence_review_tasks WHERE case_id=$1",[x.requests.Alpha.caseId])).rows) {
      await authorizeReviewFixture(x.db,{taskId:task.task_id,verifiers:[verifier],at:new Date()});
      await review.claim(verifier,task.task_id);
      await review.decide(verifier,task.task_id,"APPROVED",task.evidence_kind==="identity"?"Explicit identity review comment.":"Private supervisor review reason.",new Date(),{assessorVisible:task.evidence_kind==="identity"});
    }
    const context=await x.service.load(x.actor,x.requests.Alpha.interviewRequestId);
    assert.equal(context.profile.workerId,identity.workerId);
    assert.equal(context.profile.photoFileId,identity.profile_photo.fileId);
    assert.deepEqual(context.comments.map(c=>c.reason),["Explicit identity review comment."]);
    assert.equal(context.observations[0].id,observationId);
    assert.equal(context.observations[0].text,"Observed the Worker isolate and verify the circuit safely.");
    assert(!JSON.stringify(context).includes("PRIVATE-PASSPORT-CONSOLE"));
    assert(!JSON.stringify(context).includes("Private supervisor review reason."));
    setWorkerRegistrationRuntimeEnvironment({appEnvironment:"production",sessionSecret:x.environment.HSE_SESSION_SECRET});
    assert.deepEqual(Buffer.from((await x.service.preview(x.actor,x.requests.Alpha.interviewRequestId,identity.profile_photo.fileId)).bytes),identity.profile_photo.bytes);
    for(const ref of [identity.identity_document.fileId,identity.selfie.fileId])
      await assert.rejects(x.service.preview(x.actor,x.requests.Alpha.interviewRequestId,ref),{name:"SecureFileAccessDeniedError"});
    await x.db.query("UPDATE worker_identities SET lifecycle_status='suspended',lock_version=lock_version+1 WHERE identity_id=$1",[identity.identityId]);
    assert.equal((await x.service.load(x.actor,x.requests.Alpha.interviewRequestId)).profile.photoFileId,null);
    await assert.rejects(x.service.preview(x.actor,x.requests.Alpha.interviewRequestId,identity.profile_photo.fileId),{name:"SecureFileAccessDeniedError"});
    await x.db.query("DELETE FROM auth_account_roles WHERE account_id=$1 AND role='assessor'",[x.actor.accountId]);
    await assert.rejects(x.service.load(x.actor,x.requests.Alpha.interviewRequestId),{name:"InterviewConsoleContextAccessError"});
  } finally {
    setWorkerRegistrationRuntimeEnvironment({appEnvironment:"test",sessionSecret:x.environment.HSE_SESSION_SECRET});
    if(oldRoot===undefined)delete process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT;else process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT=oldRoot;
    await rm(directory,{recursive:true,force:true});await x.close();
  }
});
