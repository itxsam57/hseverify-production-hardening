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
   else {await assert.rejects(assertIntegrityDispositionClear(x.database,x.attemptId));const row=(await x.database.query("SELECT owner_kind,case_status FROM assurance_cases WHERE case_id=$1",[x.sourceCase.case_id])).rows[0];assert.equal(row.owner_kind,"admin");assert.equal(row.case_status,"Review pending");assert.equal((await x.database.query("SELECT owner_kind FROM assurance_action_items WHERE case_id=$1 AND action_status='open'",[x.sourceCase.case_id])).rows[0].owner_kind,"admin");}
   await assert.rejects(x.database.query("UPDATE assessment_integrity_dispositions SET reason='Changed reason' WHERE attempt_id=$1",[x.attemptId]),/immutable/);
   await assert.rejects(service.resolve(principal,{reviewId:review.review_id,disposition,reason:"Duplicate final disposition",expectedEventCount:1}));
   if(disposition==="CLEAR"){
    const {WrittenScoringService}=loadWorkerRegistrationTs("src/lib/scoring/written-scoring-service.ts");
    await new WrittenScoringService(x.database,principal).finalizeAndAdvance({reviewId:review.review_id,reviewerAccountId:principal.accountId});
    const score=(await x.database.query("SELECT score,decision,status FROM written_score_reviews WHERE review_id=$1",[review.review_id])).rows[0];
    assert.deepEqual(score,{score:100,decision:"PASS",status:"FINAL"});
    assert.equal((await x.database.query("SELECT case_status FROM assurance_cases WHERE case_id=$1",[x.sourceCase.case_id])).rows[0].case_status,"Interview pending");
    assert.equal((await x.database.query("SELECT COUNT(*)::integer n FROM interview_requests WHERE case_id=$1 AND worker_account_id=$2",[x.sourceCase.case_id,x.worker.accountId])).rows[0].n,1);
   }
  }finally{await x.cleanup();}
 });
}

test("new retained evidence can be cleared by an append-only integrity amendment",async()=>{
 const x=await integrityAssessmentFixture();try{
  await new AssessmentIntegrityService(Promise.resolve(x.database)).record(x.worker,x.attemptId,null,{type:"COPY_PASTE_DETECTED"});
  await x.attempts.submitCurrentAnswer(x.worker,{attemptId:x.attemptId,position:1,answer:"Stop and assess"},new Date(),null);
  const review=(await x.database.query("SELECT review_id,reviewer_account_id FROM written_score_reviews WHERE attempt_id=$1",[x.attemptId])).rows[0];
  const sessionId="integrity_amendment",now=new Date().toISOString();
  await new AuthAccessRepository(x.database).authentication.insertSession({sessionId,accountId:review.reviewer_account_id,activeRole:"verifier",tokenHash:sessionId.padEnd(64,"0"),csrfTokenHash:sessionId.padEnd(64,"1"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
  const actor={accountId:review.reviewer_account_id,sessionId,activeRole:"verifier",accountStatus:"active",tenantMembership:null};
  const service=new IntegrityReviewService(x.database);
  await service.resolve(actor,{reviewId:review.review_id,disposition:"CLEAR",reason:"Retained chronology independently reviewed",expectedEventCount:1,expectedRevision:0});
  await x.database.query("INSERT INTO integrity_capture_events(event_id,attempt_id,event_type,classification,state,occurred_at,details) VALUES('late_integrity_event',$1,'COPY_PASTE_DETECTED','RED','MONITORING',clock_timestamp(),'{}')",[x.attemptId]);
  await assert.rejects(assertIntegrityDispositionClear(x.database,x.attemptId));
  await assert.rejects(service.resolve(actor,{reviewId:review.review_id,disposition:"CLEAR",reason:"Stale amendment cannot clear evidence",expectedEventCount:2,expectedRevision:0}));
  await service.resolve(actor,{reviewId:review.review_id,disposition:"CLEAR",reason:"New signal separately reviewed and cleared",expectedEventCount:2,expectedRevision:1});
  await assertIntegrityDispositionClear(x.database,x.attemptId);
  const history=(await x.database.query("SELECT revision,reason,reviewed_event_count FROM assessment_integrity_dispositions WHERE attempt_id=$1 ORDER BY revision",[x.attemptId])).rows;
  assert.deepEqual(history.map(row=>[row.revision,row.reviewed_event_count]),[[1,1],[2,2]]);
  assert.equal(history[0].reason,"Retained chronology independently reviewed");
  assert.equal((await service.list(actor)).length,1);
 }finally{await x.cleanup();}
});

test("Admin returns escalated integrity for calibrated independent review with retained history and recent MFA",async()=>{
 const x=await integrityAssessmentFixture();try{
  await new AssessmentIntegrityService(Promise.resolve(x.database)).record(x.worker,x.attemptId,null,{type:"COPY_PASTE_DETECTED"});
  await x.attempts.submitCurrentAnswer(x.worker,{attemptId:x.attemptId,position:1,answer:"Stop and assess"},new Date(),null);
  const review=(await x.database.query("SELECT review_id,reviewer_account_id FROM written_score_reviews WHERE attempt_id=$1",[x.attemptId])).rows[0];
  const sessionId="integrity_return_reviewer",now=new Date().toISOString();
  await new AuthAccessRepository(x.database).authentication.insertSession({sessionId,accountId:review.reviewer_account_id,activeRole:"verifier",tokenHash:sessionId.padEnd(64,"0"),csrfTokenHash:sessionId.padEnd(64,"1"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
  const actor={accountId:review.reviewer_account_id,sessionId,activeRole:"verifier",accountStatus:"active",tenantMembership:null};
  const adminSession=(await x.database.query("SELECT session_id FROM auth_sessions WHERE account_id=$1 AND active_role='admin' ORDER BY created_at DESC LIMIT 1",[x.credentials.admin.accountId])).rows[0].session_id;
  const admin={accountId:x.credentials.admin.accountId,sessionId:adminSession,activeRole:"admin",accountStatus:"active",tenantMembership:null};
  const service=new IntegrityReviewService(x.database);
  await service.resolve(actor,{reviewId:review.review_id,disposition:"ESCALATE",reason:"Independent investigation of signal required",expectedEventCount:1});
  assert.equal((await x.database.query("SELECT COUNT(*)::integer n FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'='integrity.escalated'")).rows[0].n,1);
  const input={reviewId:review.review_id,expectedRevision:1,expectedEventCount:1,reason:"Additional context reviewed; assigned reviewer must reconsider"};
  await assert.rejects(service.returnEscalation(actor,input));
  await assert.rejects(service.returnEscalation(admin,input),/MFA/i);
  const repository=new AuthAccessRepository(x.database),at=new Date().toISOString();
  await repository.authentication.insertSecurityEvent({eventId:"integrity_admin_mfa",accountId:admin.accountId,eventType:"mfa_succeeded",activeRole:"admin",occurredAt:at});
  await repository.authentication.insertSecurityEvent({eventId:"integrity_admin_login",accountId:admin.accountId,eventType:"login_succeeded",activeRole:"admin",metadata:{sessionId:admin.sessionId,mfaEventId:"integrity_admin_mfa"},occurredAt:at});
  await assert.rejects(service.returnEscalation({...admin,sessionId:"forged"},input));
  await service.returnEscalation(admin,input);
  const notice=(await x.database.query("SELECT job_id FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'='integrity.returned'")).rows[0];
  assert.ok(notice);
  assert.equal((await x.database.query("SELECT COUNT(*)::integer n FROM platform_assurance_event_recipients('integrity.escalated',(SELECT payload->>'eventRef' FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'='integrity.escalated' LIMIT 1))")).rows[0].n,0);
  await x.database.query("SELECT * FROM platform_project_assurance_event_notification($1)",[notice.job_id]);
  assert.equal((await x.database.query("SELECT recipient_account_id,target_key FROM platform_notifications WHERE source_job_id=$1",[notice.job_id])).rows[0].recipient_account_id,actor.accountId);
  await assert.rejects(service.returnEscalation(admin,input));
  await assert.rejects(assertIntegrityDispositionClear(x.database,x.attemptId));
  const owner=(await x.database.query("SELECT owner_kind FROM assurance_cases WHERE case_id=$1",[x.sourceCase.case_id])).rows[0];
  assert.equal(owner.owner_kind,"reviewer");
  await service.resolve(actor,{reviewId:review.review_id,disposition:"CLEAR",reason:"Additional retained context independently clears signal",expectedEventCount:1,expectedRevision:2});
  await assertIntegrityDispositionClear(x.database,x.attemptId);
  const history=(await x.database.query("SELECT disposition,actor_account_id FROM assessment_integrity_dispositions WHERE attempt_id=$1 ORDER BY revision",[x.attemptId])).rows;
  assert.deepEqual(history.map(row=>row.disposition),["ESCALATE","REVIEW_REQUIRED","CLEAR"]);
  assert.equal(history[1].actor_account_id,admin.accountId);
  const {CaseReplayService}=loadWorkerRegistrationTs("src/lib/audit/case-replay-service.ts");
  const replay=await new CaseReplayService(Promise.resolve(x.database)).replay(admin,x.sourceCase.case_id,"Review preserved integrity escalation and resolution history");
  assert.deepEqual(replay.sections.integrityDispositions.map(row=>row.disposition),["ESCALATE","REVIEW_REQUIRED","CLEAR"]);

  assert.equal((await x.database.query("SELECT COUNT(*)::integer n FROM platform_assurance_event_recipients('integrity.returned',(SELECT payload->>'eventRef' FROM platform_outbox_jobs WHERE job_id=$1))",[notice.job_id])).rows[0].n,0);
  const suppressed=(await x.database.query("SELECT * FROM platform_project_assurance_event_notification($1)",[notice.job_id])).rows[0];
  assert.equal(suppressed.created,0);assert.equal(suppressed.suppressed,true);
 }finally{await x.cleanup();}
});

test("empty integrity notification rollback restores the prior contract and reapplies without losing history",async()=>{
 const x=await integrityAssessmentFixture();try{
  const {readFile}=await import("node:fs/promises");
  await x.database.execute(await readFile("database/migrations/0117_integrity_review_notifications.down.sql","utf8"));
  assert.equal((await x.database.query("SELECT to_regprocedure('platform_integrity_installed_contract()') name")).rows[0].name,null);
  await x.database.execute(await readFile("database/migrations/0117_integrity_review_notifications.up.sql","utf8"));
  assert.ok((await x.database.query("SELECT to_regprocedure('platform_integrity_installed_contract()') name")).rows[0].name);
  assert.equal((await x.database.query("SELECT COUNT(*)::integer n FROM assessment_attempts WHERE attempt_id=$1",[x.attemptId])).rows[0].n,1);
 }finally{await x.cleanup();}
});

test("scoring acquires case and attempt before review to match integrity resolution",async()=>{
 const x=await integrityAssessmentFixture();try{
  await new AssessmentIntegrityService(Promise.resolve(x.database)).record(x.worker,x.attemptId,null,{type:"COPY_PASTE_DETECTED"});
  await x.attempts.submitCurrentAnswer(x.worker,{attemptId:x.attemptId,position:1,answer:"Stop and assess"},new Date(),null);
  const review=(await x.database.query("SELECT review_id,reviewer_account_id FROM written_score_reviews WHERE attempt_id=$1",[x.attemptId])).rows[0],sessionId="scoring_lock_order",now=new Date().toISOString();
  await new AuthAccessRepository(x.database).authentication.insertSession({sessionId,accountId:review.reviewer_account_id,activeRole:"verifier",tokenHash:sessionId.padEnd(64,"0"),csrfTokenHash:sessionId.padEnd(64,"1"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
  const actor={accountId:review.reviewer_account_id,sessionId,activeRole:"verifier",accountStatus:"active",tenantMembership:null},locks=[];
  const trace=database=>({query:(sql,args)=>{if(/FOR UPDATE/i.test(sql))locks.push(sql);return database.query(sql,args);},execute:sql=>database.execute(sql),transaction:fn=>database.transaction(tx=>fn(trace(tx)))});
  const {WrittenScoringService}=loadWorkerRegistrationTs("src/lib/scoring/written-scoring-service.ts");
  await new WrittenScoringService(trace(x.database),actor).listReviewQueue({reviewerAccountId:actor.accountId});
  const caseLock=locks.findIndex(sql=>/FROM assurance_cases/i.test(sql)),reviewLock=locks.findIndex(sql=>/FROM written_score_reviews/i.test(sql));
  assert.ok(caseLock>=0 && reviewLock>caseLock,"Real scoring queries must acquire the case before the review row");
 }finally{await x.cleanup();}
});

async function objectiveReviewFixture(answer="Stop and assess",options={}){
 const x=await integrityAssessmentFixture(options);
 try{
  await new AssessmentIntegrityService(Promise.resolve(x.database)).record(x.worker,x.attemptId,null,{type:"COPY_PASTE_DETECTED"});
  await x.attempts.submitCurrentAnswer(x.worker,{attemptId:x.attemptId,position:1,answer},new Date(),null);
  const review=(await x.database.query("SELECT review_id,reviewer_account_id FROM written_score_reviews WHERE attempt_id=$1",[x.attemptId])).rows[0],sessionId="objective_review_session",now=new Date().toISOString();
  await new AuthAccessRepository(x.database).authentication.insertSession({sessionId,accountId:review.reviewer_account_id,activeRole:"verifier",tokenHash:sessionId.padEnd(64,"0"),csrfTokenHash:sessionId.padEnd(64,"1"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
  const actor={accountId:review.reviewer_account_id,sessionId,activeRole:"verifier",accountStatus:"active",tenantMembership:null};
  return {...x,review,actor,service:new IntegrityReviewService(x.database)};
 }catch(error){await x.cleanup();throw error;}
}
test("integrity clearance does not turn an incorrect objective answer into a pass",async()=>{
 const x=await objectiveReviewFixture("Ignore the hazard");try{
  await x.service.resolve(x.actor,{reviewId:x.review.review_id,disposition:"CLEAR",reason:"Signal cleared independently of correctness",expectedEventCount:1});
  const {WrittenScoringService}=loadWorkerRegistrationTs("src/lib/scoring/written-scoring-service.ts");
  await new WrittenScoringService(x.database,x.actor).finalizeAndAdvance({reviewId:x.review.review_id,reviewerAccountId:x.actor.accountId});
  assert.deepEqual((await x.database.query("SELECT score,decision FROM written_score_reviews WHERE review_id=$1",[x.review.review_id])).rows[0],{score:0,decision:"FAIL"});
  assert.equal((await x.database.query("SELECT case_status FROM assurance_cases WHERE case_id=$1",[x.sourceCase.case_id])).rows[0].case_status,"Reassessment required");
 }finally{await x.cleanup();}
});
test("forged saved objective score cannot bypass pinned scoring at finalization",async()=>{
 const x=await objectiveReviewFixture();try{
  await x.service.resolve(x.actor,{reviewId:x.review.review_id,disposition:"CLEAR",reason:"Signal independently cleared for correct response",expectedEventCount:1});
  await x.database.query("UPDATE written_score_reviews SET score=0,decision='FAIL' WHERE review_id=$1",[x.review.review_id]);
  const {WrittenScoringService}=loadWorkerRegistrationTs("src/lib/scoring/written-scoring-service.ts");
  await assert.rejects(new WrittenScoringService(x.database,x.actor).finalizeAndAdvance({reviewId:x.review.review_id,reviewerAccountId:x.actor.accountId}),/pinned answers/);
  assert.equal((await x.database.query("SELECT status FROM written_score_reviews WHERE review_id=$1",[x.review.review_id])).rows[0].status,"DRAFT");
 }finally{await x.cleanup();}
});
