import assert from "node:assert/strict";
import test from "node:test";
import {fixture} from "../helpers/written-scoring-authority-fixture.mjs";

test("Declared scoring conflict removes live authority and hands the retained draft to Admin recovery",async()=>{
 const f=await fixture("conflict-recovery");
 try{
  await f.service.recordConflict({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,tenantId:f.tenantId,reason:"I supervised this candidate and cannot provide independent scoring.",expectedRevision:0});
  const row=(await f.db.query("SELECT owner_kind,next_action FROM assurance_cases WHERE case_id=$1",[f.caseId])).rows[0];
  assert.equal(row.owner_kind,"admin");assert.match(row.next_action,/conflict|independent/i);
  await assert.rejects(f.service.addRubricMark({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,criterion:"Q1:C0",mark:80,reason:"A conflicted reviewer cannot continue marking.",expectedRevision:0}),/conflict/i);
  const queue=await f.service.listReviewQueue({reviewerAccountId:f.actor.accountId});
  assert.equal(queue[0].canReview,false);assert.equal(queue[0].questions.length,0);
  assert.equal((await f.db.query("SELECT COUNT(*)::integer n FROM platform_audit_events WHERE metadata->>'scoringConflictId' IS NOT NULL")).rows[0].n,1);
 }finally{await f.db.close();}
});

test("A final scoring amendment retains the original and requires a fresh rubric before case progression",async()=>{
 const f=await fixture("amendment-recovery");
 try{
  await f.service.addRubricMark({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,criterion:"Q1:C0",mark:80,reason:"Original isolation criterion was independently marked.",expectedRevision:0});
  await f.service.addRubricMark({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,criterion:"Q1:C1",mark:90,reason:"Original zero-energy test was independently marked.",expectedRevision:1});
  await f.service.saveDraftDecision({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,expectedRevision:2,decision:"PASS",reason:"The original written response meets the published requirements."});
  await f.service.finalizeAndAdvance({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId});
  const original=(await f.db.query("SELECT * FROM written_score_reviews WHERE review_id=$1",[f.reviewId])).rows[0];
  assert.equal((await f.service.listReviewQueue({reviewerAccountId:f.actor.accountId})).find(r=>r.review_id===f.reviewId).canAmend,true);
  const input={reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,tenantId:f.tenantId,reason:"A documented rubric interpretation error requires fresh criterion marking."};
  const replacement=await f.service.beginAmendment(input);
  await assert.rejects(f.service.beginAmendment(input),/final|current|changed/i);
  const retained=(await f.db.query("SELECT * FROM written_score_reviews WHERE review_id=$1",[f.reviewId])).rows[0];
  assert.deepEqual({...retained,status:original.status},original);
  const next=(await f.db.query("SELECT status,score,decision FROM written_score_reviews WHERE review_id=$1",[replacement.replacementReviewId])).rows[0];
  assert.deepEqual(next,{status:"DRAFT",score:null,decision:null});
  assert.equal((await f.db.query("SELECT case_status FROM assurance_cases WHERE case_id=$1",[f.caseId])).rows[0].case_status,"Review pending");
  await assert.rejects(f.service.finalizeAndAdvance({reviewId:replacement.replacementReviewId,reviewerAccountId:f.actor.accountId}));
  await f.service.addRubricMark({reviewId:replacement.replacementReviewId,reviewerAccountId:f.actor.accountId,criterion:"Q1:C0",mark:60,reason:"Corrected isolation mark reflects the retained answer.",expectedRevision:0});
  await f.service.addRubricMark({reviewId:replacement.replacementReviewId,reviewerAccountId:f.actor.accountId,criterion:"Q1:C1",mark:70,reason:"Corrected zero-energy mark reflects the retained answer.",expectedRevision:1});
  await f.service.saveDraftDecision({reviewId:replacement.replacementReviewId,reviewerAccountId:f.actor.accountId,expectedRevision:2,decision:"FAIL",reason:"Corrected rubric result requires a new independently generated assessment."});
  await f.service.finalizeAndAdvance({reviewId:replacement.replacementReviewId,reviewerAccountId:f.actor.accountId});
  const final=(await f.db.query("SELECT score,status FROM written_score_reviews WHERE review_id=$1",[replacement.replacementReviewId])).rows[0];
  assert.deepEqual(final,{score:64,status:"FINAL"});
  assert.equal((await f.db.query("SELECT case_status FROM assurance_cases WHERE case_id=$1",[f.caseId])).rows[0].case_status,"Reassessment required");
  assert.equal((await f.db.query("SELECT COUNT(*)::integer n FROM written_score_amendments WHERE original_review_id=$1 AND replacement_review_id=$2",[f.reviewId,replacement.replacementReviewId])).rows[0].n,1);
 }finally{await f.db.close();}
});

test("Amendment at capacity retains the final review and creates no replacement",async()=>{
 const f=await fixture("amendment-capacity");
 try{
  for(const [i,mark] of [80,90].entries())await f.service.addRubricMark({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,criterion:`Q1:C${i}`,mark,reason:"Independent retained rubric assessment.",expectedRevision:i});
  await f.service.saveDraftDecision({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,expectedRevision:2,decision:"PASS",reason:"The pinned written rubric meets the published requirements."});
  await f.service.finalizeAndAdvance({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId});
  const {applyMigrationsThrough}=await import("../helpers/migration-ceiling.mjs");
  await applyMigrationsThrough(f.db,"amendment-capacity","0119_evidence_review_quality_controls");
  const {seedInProgressAttempt,stableId}=await import("../helpers/assessment-attempt-fixture.mjs");
  const busy=await seedInProgressAttempt(f.db,f.actor,"capacity-busy",[{questionType:"LONG_TEXT",rubric:{maxScore:10,criteria:[{description:"Isolation",points:10}]}}]);
  await f.db.query("UPDATE assurance_cases SET case_status='Review pending',owner_kind='reviewer' WHERE case_id=$1",[busy.caseId]);
  await f.db.query("INSERT INTO written_score_reviews(review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,reason,status) VALUES($1,$2,$3,$4,$5,$6,'Another open assigned review','DRAFT')",[stableId("written_score","busy"),busy.tenantId,busy.caseId,busy.attemptId,f.actor.accountId,busy.blueprintVersionId]);
  await f.db.query("INSERT INTO reviewer_capacity_revisions(capacity_id,account_id,max_open_reviews,reason,recorded_by_account_id) VALUES($1,$2,1,'Explicit test workload limit',$2)",[stableId("review_capacity","busy"),f.actor.accountId]);
  await assert.rejects(f.service.beginAmendment({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,reason:"Correct a documented interpretation error."}),/workload|capacity/i);
  assert.equal((await f.db.query("SELECT status FROM written_score_reviews WHERE review_id=$1",[f.reviewId])).rows[0].status,"FINAL");
  assert.equal((await f.db.query("SELECT COUNT(*)::integer n FROM written_score_amendments WHERE original_review_id=$1",[f.reviewId])).rows[0].n,0);
 }finally{await f.db.close();}
});

test("Scoring conflict notifications cannot revive across actual Admin reassignment and a later conflict",async()=>{
 const f=await fixture("conflict-notification-stale");
 try{
  const {applyMigrationsThrough}=await import("../helpers/migration-ceiling.mjs");await applyMigrationsThrough(f.db,"conflict-notifications","0120_review_recovery_notifications");
  const {seedWorkerPrincipal,stableId}=await import("../helpers/assessment-attempt-fixture.mjs");
  const {loadWorkerRegistrationTs}=await import("../helpers/worker-registration-runtime-loader.mjs");
  const secondBase=await seedWorkerPrincipal(f.db,"conflict-second"),adminBase=await seedWorkerPrincipal(f.db,"conflict-admin");
  for(const [actor,role]of [[secondBase,"verifier"],[adminBase,"admin"]]){await f.db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,$2)",[actor.accountId,role]);await f.db.query("UPDATE auth_sessions SET active_role=$2 WHERE session_id=$1",[actor.sessionId,role]);}
  const second={...secondBase,activeRole:"verifier"},admin={...adminBase,activeRole:"admin"};
  await f.db.query("INSERT INTO staff_calibrations(calibration_id,account_id,role,framework_reference,status,valid_from,valid_until,note,recorded_by_account_id,framework_id,framework_version_id) SELECT $1,$2,role,framework_reference,status,valid_from,valid_until,note,recorded_by_account_id,framework_id,framework_version_id FROM staff_calibrations WHERE account_id=$3",[stableId("staff_calibration","second-conflict"),second.accountId,f.actor.accountId]);
  await f.service.recordConflict({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,reason:"A prior professional relationship removes scoring independence.",expectedRevision:0});
  const firstJob=(await f.db.query("SELECT * FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'='assessment.review.conflict'")).rows[0];assert.ok(firstJob);
  const recipients=()=>f.db.query("SELECT * FROM platform_assurance_event_recipients($1,$2)",[firstJob.payload.eventType,firstJob.payload.eventRef]);const initialRecipients=(await recipients()).rows;assert.ok(initialRecipients.some(r=>r.account_id===admin.accountId));assert.ok(initialRecipients.every(r=>r.role==="admin"&&r.target_key==="admin.scoring.assignment"));
  const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");const auth=new AuthAccessRepository(f.db),now=new Date().toISOString();
  await auth.authentication.insertSecurityEvent({eventId:"conflict-assignment-mfa",accountId:admin.accountId,eventType:"mfa_succeeded",activeRole:"admin",occurredAt:now});
  await auth.authentication.insertSecurityEvent({eventId:"conflict-assignment-login",accountId:admin.accountId,eventType:"login_succeeded",activeRole:"admin",metadata:{sessionId:admin.sessionId,mfaEventId:"conflict-assignment-mfa"},occurredAt:now});
  const {WrittenReviewAssignmentService}=loadWorkerRegistrationTs("src/lib/scoring/written-review-assignment-service.ts");
  await new WrittenReviewAssignmentService(f.db).assign(admin,{caseId:f.caseId,reviewerAccountId:second.accountId,expectedReviewId:f.reviewId,expectedRevision:1,reason:"Assign a different independently calibrated reviewer after the retained conflict."});
  assert.equal((await recipients()).rows.length,0);
  const current=(await f.db.query("SELECT draft_revision FROM written_score_reviews WHERE review_id=$1",[f.reviewId])).rows[0];
  const {WrittenScoringService}=loadWorkerRegistrationTs("src/lib/scoring/written-scoring-service.ts");await new WrittenScoringService(f.db,second).recordConflict({reviewId:f.reviewId,reviewerAccountId:second.accountId,reason:"Newly disclosed involvement also removes this reviewer independence.",expectedRevision:current.draft_revision});
  assert.equal((await recipients()).rows.length,0,"The earlier reviewer conflict notice must remain suppressed");
  const jobs=(await f.db.query("SELECT * FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'='assessment.review.conflict' ORDER BY created_at")).rows;assert.equal(jobs.length,2);
  const latest=jobs.find(j=>j.job_id!==firstJob.job_id);assert.deepEqual((await f.db.query("SELECT * FROM platform_assurance_event_recipients($1,$2)",[latest.payload.eventType,latest.payload.eventRef])).rows.map(r=>r.account_id).sort(),initialRecipients.map(r=>r.account_id).sort());
 }finally{await f.db.close();}
});
