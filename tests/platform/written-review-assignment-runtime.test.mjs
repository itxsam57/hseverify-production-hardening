import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import {integrityAssessmentFixture} from "../helpers/integrity-assessment-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {AssessmentIntegrityService}=loadWorkerRegistrationTs("src/lib/integrity/assessment-integrity-service.ts");

async function submit(f){
 await new AssessmentIntegrityService(Promise.resolve(f.database)).record(f.worker,f.attemptId,null,{type:"COPY_PASTE_DETECTED"});
 await f.attempts.submitCurrentAnswer(f.worker,{attemptId:f.attemptId,position:1,answer:"Stop and assess"},new Date(),null);
 return (await f.database.query("SELECT * FROM written_score_reviews WHERE attempt_id=$1",[f.attemptId])).rows[0];
}

test("Actual submission skips an active uncalibrated verifier instead of stranding the review",async()=>{
 const f=await integrityAssessmentFixture();try{
  const id="account_000_uncalibrated";
  await f.database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at) VALUES($1,'uncalibrated@example.test','Uncalibrated reviewer','active','fixture-hash',clock_timestamp(),clock_timestamp())",[id]);
  await f.database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'verifier')",[id]);
  const review=await submit(f);
  assert.equal(review.reviewer_account_id,f.credentials.verifier.accountId,"The actual submitted attempt must reach the calibrated reviewer");
  await f.database.execute(readFileSync("database/migrations/0120_review_recovery_notifications.down.sql","utf8"));
  await f.database.execute(readFileSync("database/migrations/0118_scoring_assignment_notifications.down.sql","utf8"));
  await f.database.execute(readFileSync("database/migrations/0118_scoring_assignment_notifications.up.sql","utf8"));
 }finally{await f.cleanup();}
});

test("No eligible reviewer retains submission and Admin can assign it after calibration is restored",async()=>{
 const f=await integrityAssessmentFixture();try{
  const reviewer=f.credentials.verifier.accountId;
  await f.database.query("DELETE FROM auth_account_roles WHERE account_id=$1 AND role='verifier'",[reviewer]);
  assert.equal(await submit(f),undefined);
  assert.equal((await f.database.query("SELECT owner_kind FROM assurance_cases WHERE case_id=$1",[f.sourceCase.case_id])).rows[0].owner_kind,"admin");
  await f.database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'verifier')",[reviewer]);
  const {WrittenReviewAssignmentService}=loadWorkerRegistrationTs("src/lib/scoring/written-review-assignment-service.ts");
  const session=(await f.database.query("SELECT session_id FROM auth_sessions WHERE account_id=$1 AND active_role='admin' ORDER BY created_at DESC LIMIT 1",[f.credentials.admin.accountId])).rows[0].session_id;
  const admin={accountId:f.credentials.admin.accountId,sessionId:session,activeRole:"admin",accountStatus:"active",tenantMembership:null};
  const service=new WrittenReviewAssignmentService(f.database);
  const pending=await service.list(admin);
  assert.ok(pending.some(row=>row.caseId===f.sourceCase.case_id && row.candidates.some(candidate=>candidate.accountId===reviewer)));
  const input={caseId:f.sourceCase.case_id,reviewerAccountId:reviewer,expectedReviewId:null,expectedRevision:0,reason:"Assign the independently calibrated reviewer after staffing recovery."};
  await assert.rejects(service.assign(f.worker,input));
  await assert.rejects(service.assign(admin,input),/MFA/);
  const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
  const auth=new AuthAccessRepository(f.database),now=new Date().toISOString();
  await auth.authentication.insertSecurityEvent({eventId:"assignment-admin-mfa",accountId:admin.accountId,eventType:"mfa_succeeded",activeRole:"admin",occurredAt:now});
  await auth.authentication.insertSecurityEvent({eventId:"assignment-admin-login",accountId:admin.accountId,eventType:"login_succeeded",activeRole:"admin",metadata:{sessionId:admin.sessionId,mfaEventId:"assignment-admin-mfa"},occurredAt:now});
  await service.assign(admin,input);
  const review=(await f.database.query("SELECT * FROM written_score_reviews WHERE attempt_id=$1",[f.attemptId])).rows[0];
  assert.equal(review.reviewer_account_id,reviewer);
  assert.equal((await f.database.query("SELECT owner_kind FROM assurance_cases WHERE case_id=$1",[f.sourceCase.case_id])).rows[0].owner_kind,"reviewer");
  await assert.rejects(service.assign(admin,input),/changed|reload/i);
  const audit=(await f.database.query("SELECT metadata FROM platform_audit_events WHERE metadata->>'assessmentReviewAssignment'=$1",[review.review_id])).rows;
  assert.equal(audit.length,1);
  await assert.rejects(f.database.execute(readFileSync("database/migrations/0118_scoring_assignment_notifications.down.sql","utf8")),/histories must be retained/);
  assert.equal((await f.database.query("SELECT COUNT(*)::integer n FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'='assessment.review.assigned'")).rows[0].n,1,"Recovered assignment must notify its actual next actor");
 }finally{await f.cleanup();}
});


test("Reassigned cleared objective review retains a pinned score and can explicitly finalize",async()=>{
 const f=await integrityAssessmentFixture();try{
  const review=await submit(f);
  const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
  const {IntegrityReviewService}=loadWorkerRegistrationTs("src/lib/integrity/integrity-review-service.ts");
  const {WrittenScoringService}=loadWorkerRegistrationTs("src/lib/scoring/written-scoring-service.ts");
  const {WrittenReviewAssignmentService}=loadWorkerRegistrationTs("src/lib/scoring/written-review-assignment-service.ts");
  const {seedWorkerPrincipal}=await import("../helpers/assessment-attempt-fixture.mjs");
  const auth=new AuthAccessRepository(f.database),now=new Date().toISOString();
  const reviewerSession="objective-reassignment-reviewer";
  await auth.authentication.insertSession({sessionId:reviewerSession,accountId:review.reviewer_account_id,activeRole:"verifier",tokenHash:reviewerSession.padEnd(64,"0"),csrfTokenHash:reviewerSession.padEnd(64,"1"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:"2099-01-01T00:00:00Z"});
  const original={accountId:review.reviewer_account_id,sessionId:reviewerSession,activeRole:"verifier",accountStatus:"active",tenantMembership:null};
  await new IntegrityReviewService(f.database).resolve(original,{reviewId:review.review_id,disposition:"CLEAR",reason:"Current retained signal independently cleared.",expectedEventCount:1,expectedRevision:0});
  const second=await seedWorkerPrincipal(f.database,"objective-reassignment-second");
  await f.database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'verifier')",[second.accountId]);await f.database.query("UPDATE auth_sessions SET active_role='verifier' WHERE session_id=$1",[second.sessionId]);
  await f.database.query(`INSERT INTO staff_calibrations(calibration_id,account_id,role,framework_reference,status,valid_from,valid_until,note,recorded_by_account_id,framework_id,framework_version_id) SELECT 'staff_calibration_'||repeat('o',24),$1,role,framework_reference,status,valid_from,valid_until,note,recorded_by_account_id,framework_id,framework_version_id FROM staff_calibrations WHERE account_id=$2`,[second.accountId,original.accountId]);
  const adminSession=(await f.database.query("SELECT session_id FROM auth_sessions WHERE account_id=$1 AND active_role='admin' ORDER BY created_at DESC LIMIT 1",[f.credentials.admin.accountId])).rows[0].session_id;
  const admin={accountId:f.credentials.admin.accountId,sessionId:adminSession,activeRole:"admin",accountStatus:"active",tenantMembership:null};
  await auth.authentication.insertSecurityEvent({eventId:"objective-assignment-mfa",accountId:admin.accountId,eventType:"mfa_succeeded",activeRole:"admin",occurredAt:now});
  await auth.authentication.insertSecurityEvent({eventId:"objective-assignment-login",accountId:admin.accountId,eventType:"login_succeeded",activeRole:"admin",metadata:{sessionId:admin.sessionId,mfaEventId:"objective-assignment-mfa"},occurredAt:now});
  const current=(await f.database.query("SELECT draft_revision FROM written_score_reviews WHERE review_id=$1",[review.review_id])).rows[0];
  await new WrittenReviewAssignmentService(f.database).assign(admin,{caseId:f.sourceCase.case_id,reviewerAccountId:second.accountId,expectedReviewId:review.review_id,expectedRevision:current.draft_revision,reason:"New calibrated reviewer must explicitly finalize the cleared objective result."});
  const next={...second,activeRole:"verifier"};
  await new WrittenScoringService(f.database,next).finalizeAndAdvance({reviewId:review.review_id,reviewerAccountId:second.accountId});
  const final=(await f.database.query("SELECT status,score,decision FROM written_score_reviews WHERE review_id=$1",[review.review_id])).rows[0];assert.deepEqual(final,{status:"FINAL",score:100,decision:"PASS"});
 }finally{await f.cleanup();}
});
