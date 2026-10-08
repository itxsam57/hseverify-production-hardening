import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assessorInterviewSearchFixture } from "../../tests/helpers/assessor-interview-search-fixture.mjs";
import { assessorSchedulingPrincipal } from "../../tests/helpers/assessor-scheduling-native-principal.mjs";
import { loadWorkerRegistrationTs } from "../../tests/helpers/worker-registration-runtime-loader.mjs";
const { InterviewSchedulingService } = loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const { InterviewRuntimeService } = loadWorkerRegistrationTs("src/lib/interview/interview-runtime-service.ts");
const { InterviewAssignmentService } = loadWorkerRegistrationTs("src/lib/interview/interview-assignment-service.ts");
const { StaffCalibrationService } = loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");
async function eligibleAssessor(db, fixture) {
 const admin={accountId:fixture.credentials.admin.accountId,activeRole:"admin",accountStatus:"active",tenantMembership:null};
 const matching=new InterviewAssignmentService(db);
 for(const p of await matching.listProfiles(admin)){
  await matching.upsertProfile(admin,{...p,status:"PAUSED"});
 }
 await matching.upsertProfile(admin,{assessorAccountId:fixture.credentials.assessor.accountId,tradeScopes:["*"],qualificationScopes:["*"],languages:["*"],jurisdictions:["*"],riskLevels:["*"],availability:{},maxActiveInterviews:8,status:"ACTIVE"});
 await new StaffCalibrationService(Promise.resolve(db)).record(admin,{accountId:fixture.credentials.assessor.accountId,role:"assessor",frameworkReference:"SEARCH-WORKER",status:"CURRENT",validFrom:new Date(Date.now()-86400000),validUntil:new Date(Date.now()+86400000),note:"Current calibration recorded through the real producer for recovery verification."});
 return matching;
}
test("Real matching profile and calibration producers select the replacement Assessor",async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const matching=await eligibleAssessor(db,fixture),service=new InterviewSchedulingService(db);
  const request=await service.requestAdditionalInterview({tenantId:fixture.credentials.company.tenantId,caseId:fixture.requests.Alpha.caseId,workerAccountId:fixture.credentials.worker.accountId,requestedAt:new Date().toISOString()});
  const result=await matching.evaluateAndPersist(request.interviewRequestId);
  assert.equal(result.selectedAssessorAccountId,fixture.credentials.assessor.accountId);
  assert.equal(result.candidates.find(c=>c.assessorAccountId===result.selectedAssessorAccountId).checks.calibration,true);
  assert.equal((await db.query("SELECT selected FROM interview_assignment_decisions WHERE interview_request_id=$1 AND assessor_account_id=$2",[request.interviewRequestId,result.selectedAssessorAccountId])).rows[0].selected,true);
 }finally{await db.close();await fixture.cleanup();}
});
for(const outcome of ["NO_SHOW","TECHNICAL_HOLD"]){
 test("Actual "+outcome+" creates one distinct replacement and preserves the original runtime",async()=>{
  const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   await eligibleAssessor(db,fixture);
   const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),service=new InterviewSchedulingService(db);
   const first=await service.scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()-45*60000).toISOString()});
   // The search fixture owns schema-valid case context; it does not certify order funding/progression.
   await db.query("UPDATE assurance_cases SET interview_reference=$2 WHERE case_id=$1",[first.caseId,first.interviewRequestId]);
   const runtime=new InterviewRuntimeService(Promise.resolve(db));
   const closed=outcome==="NO_SHOW"?await runtime.noShow(principal,first.interviewRequestId):await runtime.technicalIssue(principal,first.interviewRequestId,"Connection could not be restored.");
   assert.equal(closed.status,outcome);
   const input={principal,interviewRequestId:first.interviewRequestId,reason:"The documented interruption requires a replacement appointment."};
   const next=await service.requestReplacementInterview(input);
   assert.notEqual(next.interviewRequestId,first.interviewRequestId);
   assert.equal(next.assessorAccountId,fixture.credentials.assessor.accountId);
   assert.equal(next.scheduledAt,null);
   assert.equal((await service.requestReplacementInterview(input)).interviewRequestId,next.interviewRequestId);
   assert.equal((await db.query("SELECT interview_reference FROM assurance_cases WHERE case_id=$1",[first.caseId])).rows[0].interview_reference,next.interviewRequestId);
   assert.equal((await db.query("SELECT status FROM interview_requests WHERE interview_request_id=$1",[first.interviewRequestId])).rows[0].status,"CANCELLED");
   const history=await runtime.view(principal,first.interviewRequestId);
   assert.equal(history.interviewSessionId,closed.interviewSessionId);assert.equal(history.status,outcome);
  }finally{await db.close();await fixture.cleanup();}
 });
}

async function interruptedFixture(outcome="TECHNICAL_HOLD",{eligible=true}={}) {
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  if(eligible)await eligibleAssessor(db,fixture);
  else {
   const admin={accountId:fixture.credentials.admin.accountId,activeRole:"admin",accountStatus:"active",tenantMembership:null},matching=new InterviewAssignmentService(db);
   for(const p of await matching.listProfiles(admin))await matching.upsertProfile(admin,{...p,status:"PAUSED"});
  }
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),service=new InterviewSchedulingService(db);
  const first=await service.scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()-45*60000).toISOString()});
  await db.query("UPDATE assurance_cases SET interview_reference=$2 WHERE case_id=$1",[first.caseId,first.interviewRequestId]);
  const runtime=new InterviewRuntimeService(Promise.resolve(db));
  if(outcome==="NO_SHOW")await runtime.noShow(principal,first.interviewRequestId);
  else await runtime.technicalIssue(principal,first.interviewRequestId,"Connection could not be restored.");
  return {fixture,db,principal,service,first,runtime,input:{principal,interviewRequestId:first.interviewRequestId,reason:"The documented interruption requires a replacement appointment."},cleanup:async()=>{await db.close();await fixture.cleanup();}};
 }catch(error){await db.close();await fixture.cleanup();throw error;}
}
test("Retired technical runtime rejects further mutations and keeps history readable",async()=>{
 const x=await interruptedFixture();
 try {
  await x.service.requestReplacementInterview(x.input);
  const before=await x.runtime.view(x.principal,x.first.interviewRequestId);
  await assert.rejects(x.runtime.technicalIssue(x.principal,x.first.interviewRequestId,"A forged stale technical report."),{name:"InterviewRuntimeConflictError"});
  assert.deepEqual(await x.runtime.view(x.principal,x.first.interviewRequestId),before);
 }finally{await x.cleanup();}
});
test("An unmatched replacement stays unscheduled in the existing Admin queue",async()=>{
 const x=await interruptedFixture("NO_SHOW",{eligible:false});
 try{
  const next=await x.service.requestReplacementInterview(x.input);
  assert.equal(next.status,"REQUESTED");assert.equal(next.assessorAccountId,null);assert.equal(next.scheduledAt,null);
  const current=(await x.db.query("SELECT interview_reference,owner_kind,next_action FROM assurance_cases WHERE case_id=$1",[x.first.caseId])).rows[0];
  assert.equal(current.interview_reference,next.interviewRequestId);assert.equal(current.owner_kind,"admin");
  const admin={accountId:x.fixture.credentials.admin.accountId,activeRole:"admin",accountStatus:"active",tenantMembership:null};
  assert((await new InterviewAssignmentService(x.db).listUnassigned(admin)).some(r=>r.interviewRequestId===next.interviewRequestId));
  assert.equal((await x.db.query("SELECT deep_link FROM assurance_action_items WHERE case_id=$1 AND action_status<>'resolved'",[x.first.caseId])).rows[0].deep_link,"/admin/assessor-matching");
 }finally{await x.cleanup();}
});
test("Replacement copies matching and recording policy, preserves history, denies old media and schedules separately",async()=>{
 const x=await interruptedFixture();
 try{
  await x.db.query("UPDATE interview_requests SET trade_scope='Electrical',qualification_scope='Level3',risk_level='HIGH',recording_policy='AUDIO_ONLY',recording_retention_days=180,recording_consent_required=TRUE WHERE interview_request_id=$1",[x.first.interviewRequestId]);
  const fields="trade_scope,qualification_scope,risk_level,language,jurisdiction,recording_policy,recording_retention_days,recording_consent_required";
  const policy=(await x.db.query("SELECT "+fields+" FROM interview_requests WHERE interview_request_id=$1",[x.first.interviewRequestId])).rows[0];
  const history=await x.runtime.view(x.principal,x.first.interviewRequestId);
  const events=(await x.db.query("SELECT * FROM interview_runtime_events WHERE interview_session_id=$1 ORDER BY event_id",[history.interviewSessionId])).rows;
  await x.service.saveConsoleState({tenantId:x.fixture.credentials.company.tenantId,interviewSessionId:history.interviewSessionId,interviewRequestId:x.first.interviewRequestId,notes:[{content:"Persisted draft must survive replacement.",authorAccountId:x.principal.accountId}],scorecard:{technicalKnowledge:3},recommendation:null,submitted:false,updatedAt:new Date().toISOString()});
  const draft=(await x.db.query("SELECT * FROM interview_console_drafts WHERE interview_request_id=$1",[x.first.interviewRequestId])).rows;
  const audits=(await x.db.query("SELECT * FROM platform_audit_events WHERE target_reference=$1 ORDER BY audit_sequence",[x.first.interviewRequestId])).rows;
  const next=await x.service.requestReplacementInterview(x.input);
  assert.deepEqual((await x.db.query("SELECT "+fields+" FROM interview_requests WHERE interview_request_id=$1",[next.interviewRequestId])).rows[0],policy);
  await x.service.requestReplacementInterview(x.input);
  assert.equal(Number((await x.db.query("SELECT COUNT(*) AS count FROM interview_requests WHERE replaces_interview_request_id=$1",[x.first.interviewRequestId])).rows[0].count),1);
  assert.equal(Number((await x.db.query("SELECT COUNT(*) AS count FROM platform_audit_events WHERE action_key='interview.replacement.requested' AND target_reference=$1",[x.first.interviewRequestId])).rows[0].count),1);
  assert.deepEqual(await x.runtime.view(x.principal,x.first.interviewRequestId),history);
  assert.deepEqual((await x.db.query("SELECT * FROM interview_runtime_events WHERE interview_session_id=$1 ORDER BY event_id",[history.interviewSessionId])).rows,events);
  assert.deepEqual((await x.db.query("SELECT * FROM interview_console_drafts WHERE interview_request_id=$1",[x.first.interviewRequestId])).rows,draft);
  assert.deepEqual((await x.db.query("SELECT * FROM platform_audit_events WHERE audit_event_id=ANY($1::text[]) ORDER BY audit_sequence",[audits.map(a=>a.audit_event_id)])).rows,audits);
  const {publishInterviewMediaSignal}=await import("../../src/lib/interview/interview-media-service.ts");
  const session={accountId:x.principal.accountId,role:"assessor"};
  await assert.rejects(publishInterviewMediaSignal(x.db,session,x.first.interviewRequestId,{kind:"leave",payload:{connectionId:"recovery_connection_123456"}}),{name:"InterviewMediaAccessError"});
  const scheduled=await x.service.scheduleInterview({principal:x.principal,tenantId:x.fixture.credentials.company.tenantId,request:next,scheduledAt:new Date(Date.now()+86400000).toISOString()});
  assert(scheduled.scheduledAt);
  const opened=await x.runtime.claim(x.principal,next.interviewRequestId);
  assert.notEqual(opened.interviewSessionId,history.interviewSessionId);
  assert.equal((await publishInterviewMediaSignal(x.db,session,next.interviewRequestId,{kind:"leave",payload:{connectionId:"recovery_connection_123456"}})).kind,"leave");
  assert.deepEqual(await x.runtime.view(x.principal,x.first.interviewRequestId),history);
 }finally{await x.cleanup();}
});
test("Persisted replacement linkage rejects another case and another Worker",async()=>{
 const x=await interruptedFixture();
 try{
  const next=await x.service.requestReplacementInterview(x.input);
  await assert.rejects(x.db.query("UPDATE interview_requests SET replaces_interview_request_id=$2 WHERE interview_request_id=$1",[next.interviewRequestId,x.fixture.requests.Beta.interviewRequestId]),e=>e.constraint==="interview_replacement_same_case");
  await assert.rejects(x.db.query("UPDATE interview_requests SET worker_account_id='search_foreign_worker' WHERE interview_request_id=$1",[next.interviewRequestId]),e=>e.constraint==="interview_replacement_same_case");
 }finally{await x.cleanup();}
});

test("Replacement denies foreign ownership, stale pointers and revoked sessions without new state",async()=>{
 const x=await interruptedFixture();
 try{
  await assert.rejects(x.service.requestReplacementInterview({...x.input,interviewRequestId:x.fixture.requests.ForeignAlpha.interviewRequestId}),{name:"InterviewAssignmentAccessError"});
  await x.db.query("UPDATE assurance_cases SET interview_reference=NULL WHERE case_id=$1",[x.first.caseId]);
  await assert.rejects(x.service.requestReplacementInterview(x.input),{name:"InterviewSchedulingInputError"});
  await x.db.query("UPDATE assurance_cases SET interview_reference=$2 WHERE case_id=$1",[x.first.caseId,x.first.interviewRequestId]);
  await x.db.query("UPDATE auth_sessions SET revoked_at=clock_timestamp(),revocation_reason='security_review' WHERE session_id=$1",[x.principal.sessionId]);
  await assert.rejects(x.service.requestReplacementInterview(x.input),{name:"InterviewAssignmentAccessError"});
  assert.equal((await x.db.query("SELECT status FROM interview_requests WHERE interview_request_id=$1",[x.first.interviewRequestId])).rows[0].status,"ASSIGNED");
  assert.equal(Number((await x.db.query("SELECT COUNT(*) AS count FROM interview_requests WHERE replaces_interview_request_id=$1",[x.first.interviewRequestId])).rows[0].count),0);
 }finally{await x.cleanup();}
});
test("Required replacement audit failure rolls back request, case, timeline and action",async()=>{
 const x=await interruptedFixture();
 try{
  const before=(await x.db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[x.first.caseId])).rows[0];
  await x.db.exec("CREATE FUNCTION reject_replacement_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='interview.replacement.requested' THEN RAISE EXCEPTION 'forced replacement audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_replacement_audit BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION reject_replacement_audit()");
  await assert.rejects(x.service.requestReplacementInterview(x.input),/forced replacement audit failure/);
  assert.deepEqual((await x.db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[x.first.caseId])).rows[0],before);
  assert.equal((await x.db.query("SELECT status FROM interview_requests WHERE interview_request_id=$1",[x.first.interviewRequestId])).rows[0].status,"ASSIGNED");
  assert.equal(Number((await x.db.query("SELECT COUNT(*) AS count FROM interview_requests WHERE replaces_interview_request_id=$1",[x.first.interviewRequestId])).rows[0].count),0);
  assert.equal(Number((await x.db.query("SELECT COUNT(*) AS count FROM assurance_case_timeline_events WHERE case_id=$1",[x.first.caseId])).rows[0].count),0);
  assert.equal(Number((await x.db.query("SELECT COUNT(*) AS count FROM assurance_action_items WHERE case_id=$1",[x.first.caseId])).rows[0].count),0);
 }finally{await x.cleanup();}
});
test("Session expiry during the held case boundary denies replacement against the fresh database clock",async()=>{
 const x=await interruptedFixture();
 try{
  await x.db.query("UPDATE auth_sessions SET expires_at=clock_timestamp()+INTERVAL '1 second' WHERE session_id=$1",[x.principal.sessionId]);
  const delayed=new Proxy(x.db,{get(target,key){
   if(key==="transaction")return callback=>target.transaction(tx=>callback(new Proxy(tx,{get(t,k){
    if(k==="query")return async(sql,params)=>{const result=await t.query(sql,params);if(sql.includes("FROM assurance_cases") && sql.includes("FOR UPDATE"))await t.query("SELECT pg_sleep(2.2)");return result;};
    const value=Reflect.get(t,k,t);return typeof value==="function"?value.bind(t):value;
   }})));
   const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
  await assert.rejects(new InterviewSchedulingService(delayed).requestReplacementInterview(x.input),{name:"InterviewAssignmentAccessError"});
  assert.equal((await x.db.query("SELECT interview_reference FROM assurance_cases WHERE case_id=$1",[x.first.caseId])).rows[0].interview_reference,x.first.interviewRequestId);
 }finally{await x.cleanup();}
});
test("Replacement migration round-trips while empty and refuses retained replacement history",async()=>{
 const x=await interruptedFixture();
 try{
  const {readFile}=await import("node:fs/promises");
  const down=await readFile("database/migrations/0091_interview_replacement.down.sql","utf8"),up=await readFile("database/migrations/0091_interview_replacement.up.sql","utf8");
  const originals=(await x.db.query("SELECT platform_interview_replacement_original_check() AS audit,interview_replacement_original_destination_check() AS destination")).rows[0];
  await x.db.exec("BEGIN");await x.db.exec(down);await x.db.exec("COMMIT");
  for(const [table,name,expected] of [["platform_audit_events","platform_audit_events_action_key_check",originals.audit],["assurance_action_items","assurance_action_items_deep_link_check",originals.destination]]){
   assert.equal((await x.db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2",[table,name])).rows[0].definition,expected);
  }
  await x.db.exec("BEGIN");await x.db.exec(up);await x.db.exec("COMMIT");
  const next=await x.service.requestReplacementInterview(x.input);
  await x.db.exec("BEGIN");
  try{await assert.rejects(x.db.exec(down),/Retained interview replacement history prevents rollback/);}
  finally{await x.db.exec("ROLLBACK");}
  assert.equal((await x.db.query("SELECT interview_reference FROM assurance_cases WHERE case_id=$1",[x.first.caseId])).rows[0].interview_reference,next.interviewRequestId);
  assert.equal(await x.service.getWorkerReplacementInterviewId({workerAccountId:"search_foreign_worker",interviewRequestId:x.first.interviewRequestId}),null);
  assert.equal(await x.service.getWorkerReplacementInterviewId({workerAccountId:x.fixture.credentials.worker.accountId,interviewRequestId:x.first.interviewRequestId}),next.interviewRequestId);
 }finally{await x.cleanup();}
});

test("Retired playbook rejects follow-up versions and retains readable questions",async()=>{
 const x=await interruptedFixture();
 try{
  const {InterviewPlaybookService}=loadWorkerRegistrationTs("src/lib/interview/interview-playbook-service.ts");
  const playbook=new InterviewPlaybookService(Promise.resolve(x.db));
  await playbook.ensure(x.principal,x.first.interviewRequestId);
  const before=await playbook.addFollowUp(x.principal,x.first.interviewRequestId,"Explain the safe stop-work conditions for this task.");
  assert.equal(before.versionNo,2);
  await x.service.requestReplacementInterview(x.input);
  const versions=(await x.db.query("SELECT * FROM interview_question_sets WHERE interview_request_id=$1 ORDER BY version_no",[x.first.interviewRequestId])).rows;
  await assert.rejects(playbook.addFollowUp(x.principal,x.first.interviewRequestId,"A stale follow-up must not alter archived history."),{name:"InterviewPlaybookInputError"});
  assert.deepEqual(await playbook.getAssigned(x.principal,x.first.interviewRequestId),before);
  assert.deepEqual((await x.db.query("SELECT * FROM interview_question_sets WHERE interview_request_id=$1 ORDER BY version_no",[x.first.interviewRequestId])).rows,versions);
 }finally{await x.cleanup();}
});
test("Retired interview cannot create a previously missing playbook",async()=>{
 const x=await interruptedFixture();
 try{
  const {InterviewPlaybookService}=loadWorkerRegistrationTs("src/lib/interview/interview-playbook-service.ts");
  const playbook=new InterviewPlaybookService(Promise.resolve(x.db));
  assert.equal(await playbook.getAssigned(x.principal,x.first.interviewRequestId),null);
  await x.service.requestReplacementInterview(x.input);
  await assert.rejects(playbook.ensure(x.principal,x.first.interviewRequestId),{name:"InterviewPlaybookInputError"});
  assert.equal(await playbook.getAssigned(x.principal,x.first.interviewRequestId),null);
 }finally{await x.cleanup();}
});

for(const hasDraft of [true,false]){
 test("Console session binding rejects archived runtime reuse"+(hasDraft?" with a saved draft":" without a saved draft"),async()=>{
  const x=await interruptedFixture();
  try{
   const session=await x.runtime.view(x.principal,x.first.interviewRequestId);
   const draft={tenantId:x.fixture.credentials.company.tenantId,interviewSessionId:session.interviewSessionId,interviewRequestId:x.first.interviewRequestId,notes:[{content:"Original observations.",authorAccountId:x.principal.accountId}],scorecard:{technicalKnowledge:null},recommendation:null,submitted:false,updatedAt:new Date().toISOString()};
   if(hasDraft)await x.service.saveConsoleState(draft);
   const before=(await x.db.query("SELECT * FROM interview_console_drafts WHERE interview_request_id=$1",[x.first.interviewRequestId])).rows;
   const next=await x.service.requestReplacementInterview(x.input);
   await assert.rejects(x.service.saveConsoleState({...draft,interviewRequestId:next.interviewRequestId,notes:[{content:"Forged session must not overwrite history.",authorAccountId:x.principal.accountId}]}),{name:"InterviewSchedulingInputError"});
   assert.deepEqual((await x.db.query("SELECT * FROM interview_console_drafts WHERE interview_request_id=$1",[x.first.interviewRequestId])).rows,before);
   assert.equal(Number((await x.db.query("SELECT COUNT(*) AS n FROM interview_console_drafts WHERE interview_request_id=$1",[next.interviewRequestId])).rows[0].n),0);
  }finally{await x.cleanup();}
 });
}

test("A saved pre-claim draft session cannot be rebound to another request",async()=>{
 const x=await interruptedFixture();
 try{
  const {createInterviewSession}=loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-domain.ts");
  const session=createInterviewSession({interviewRequestId:x.first.interviewRequestId,caseId:x.first.caseId});
  const draft={tenantId:x.fixture.credentials.company.tenantId,interviewSessionId:session.interviewSessionId,interviewRequestId:x.first.interviewRequestId,notes:[{content:"Saved pre-claim observations.",authorAccountId:x.principal.accountId}],scorecard:{},recommendation:null,submitted:false,updatedAt:new Date().toISOString()};
  await x.service.saveConsoleState(draft);
  const before=(await x.db.query("SELECT * FROM interview_console_drafts WHERE interview_request_id=$1",[x.first.interviewRequestId])).rows;
  const next=await x.service.requestReplacementInterview(x.input);
  await assert.rejects(x.service.saveConsoleState({...draft,interviewRequestId:next.interviewRequestId}),{name:"InterviewSchedulingInputError"});
  assert.deepEqual((await x.db.query("SELECT * FROM interview_console_drafts WHERE interview_request_id=$1",[x.first.interviewRequestId])).rows,before);
 }finally{await x.cleanup();}
});
