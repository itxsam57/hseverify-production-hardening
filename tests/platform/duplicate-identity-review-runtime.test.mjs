import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import {setupTest,prepareSubmittedWorker,advanceThroughAutomatedChecks,markVerified,seedPrincipal} from "../helpers/duplicate-identity-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
test("Duplicate identity staff recovery is authenticated, stale-safe, reasoned and issues only the target Worker ID",async()=>{
 const db=await setupTest("duplicate-identity-review");try{
  const target=await prepareSubmittedWorker(db,"target",{documentNumber:"DUPLICATE-123"}),candidate=await prepareSubmittedWorker(db,"candidate",{documentNumber:"DUPLICATE123"});
  await advanceThroughAutomatedChecks(target);await advanceThroughAutomatedChecks(candidate);await markVerified(db,target.submitted.identity.identityId);
  const check=await target.eligibilityService.evaluate(target.submitted.identity.identityId),admin=await seedPrincipal(db,"admin","admin");
  const {DuplicateIdentityReviewService}=loadWorkerRegistrationTs("src/lib/identity/duplicate-identity-review-service.ts");const service=new DuplicateIdentityReviewService(db);
  await assert.rejects(service.list(target.worker));
  const queued=await service.list(admin),entry=queued.find(row=>row.check_id===check.checkId);assert.ok(entry);assert.equal(entry.comparison.length,2);assert.ok(entry.comparison.some(row=>row.identity_version_id===candidate.submitted.currentVersion.identityVersionId));assert.ok(!JSON.stringify(entry.comparison).includes("DUPLICATE-123"));
  const input={identityId:check.identityId,identityVersionId:check.identityVersionId,checkId:check.checkId,expectedRevision:0,disposition:"duplicate_review",reason:"Independent document comparison needs a retained further review."};
  await assert.rejects(service.decide(target.worker,input));await assert.rejects(service.decide(admin,input),/MFA/);
  const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts"),auth=new AuthAccessRepository(db),now=new Date().toISOString();
  await auth.authentication.insertSecurityEvent({eventId:"duplicate-mfa",accountId:admin.accountId,eventType:"mfa_succeeded",activeRole:"admin",occurredAt:now});await auth.authentication.insertSecurityEvent({eventId:"duplicate-login",accountId:admin.accountId,eventType:"login_succeeded",activeRole:"admin",metadata:{sessionId:admin.sessionId,mfaEventId:"duplicate-mfa"},occurredAt:now});
  await service.decide(admin,input);
  await assert.rejects(service.decide(admin,{...input,disposition:"continue"}),/changed|reload|stale/i);
  assert.equal((await target.eligibilityService.loadOwnStatus(target.worker)).latestDisposition,"duplicate_review");
  const retained=(await service.list(admin)).find(row=>row.check_id===check.checkId);assert.ok(retained.history.some(history=>history.reason&&history.actor_account_id===admin.accountId));
  await service.decide(admin,{...input,expectedRevision:1,disposition:"continue",reason:"Independent source documents establish distinct people despite the shared matching signal."});
  const own=await target.eligibilityService.loadOwnStatus(target.worker);assert.match(own.permanentWorkerId,/^worker_id_/);
  assert.equal((await candidate.eligibilityService.loadOwnStatus(candidate.worker)).permanentWorkerId,null);
  const audits=(await db.query("SELECT actor_account_id,metadata FROM platform_audit_events WHERE metadata->>'duplicateReviewCheckId'=$1",[check.checkId])).rows;assert.equal(audits.length,2);assert.ok(audits.every(a=>a.actor_account_id===admin.accountId&&a.metadata.reason));
  assert.equal((await db.query("SELECT COUNT(*)::integer n FROM worker_identities WHERE identity_id=ANY($1::text[])",[[check.identityId,candidate.submitted.identity.identityId]])).rows[0].n,2);
  await db.query("UPDATE auth_sessions SET revoked_at=clock_timestamp(),revocation_reason='review revocation test' WHERE session_id=$1",[admin.sessionId]);await assert.rejects(service.list(admin),error=>error.name==='EvidenceReviewAccessError');
 }finally{await db.close();}
});


test("Verified Worker stays a duplicate candidate while their identity correction is pending",async()=>{
 const db=await setupTest("duplicate-correction-pending","0125_worker_identity_duplicate_correction_candidates");try{
  const draft={legalFirstName:"Amal",legalLastName:"Sethi",dateOfBirth:"1994-06-03"};
  const established=await prepareSubmittedWorker(db,"corr-origin",{draft,documentNumber:"CORR-3025"});
  await advanceThroughAutomatedChecks(established);
  await markVerified(db,established.submitted.identity.identityId);
  const clear=await established.eligibilityService.evaluate(established.submitted.identity.identityId);
  assert.equal(clear.checkStatus,"clear");
  const issued=await established.eligibilityService.issuePermanentWorkerId(established.submitted.identity.identityId);
  assert.match(issued.permanentWorkerId,/^worker_id_/);
  const {DatabaseWorkerIdentityCorrectionRepository}=loadWorkerRegistrationTs("src/lib/identity/worker-identity-correction-repository.ts");
  const corrections=new DatabaseWorkerIdentityCorrectionRepository(Promise.resolve(db));
  const current=(await db.query("SELECT lock_version FROM worker_identities WHERE identity_id=$1",[established.submitted.identity.identityId])).rows[0];
  const pending=await corrections.requestOwn(established.worker,{
   reason:"Updating my verified identity after a lawful document correction.",
   expectedLockVersion:Number(current.lock_version)
  });
  assert.ok(pending.correctionVersionId);
  const second=await prepareSubmittedWorker(db,"corr-second",{draft,documentNumber:"CORR3025"});
  await advanceThroughAutomatedChecks(second);
  await markVerified(db,second.submitted.identity.identityId);
  const duplicateCheck=await second.eligibilityService.evaluate(second.submitted.identity.identityId);
  assert.equal(duplicateCheck.checkStatus,"review_required",
   "Current correction draft cannot erase previously verified identity from duplicate matching.");
  const firstSignals=(await db.query(
   "SELECT candidate_identity_version_id FROM worker_identity_duplicate_signals WHERE check_id=$1",
   [duplicateCheck.checkId]
  )).rows;
  assert.ok(firstSignals.length>0);
  assert.ok(firstSignals.every(row=>row.candidate_identity_version_id===established.submitted.currentVersion.identityVersionId),
   "Only the previously verified parent, never an unverified correction draft, is an admissible duplicate candidate.");
  await assert.rejects(
   db.query(`INSERT INTO worker_identity_duplicate_signals(
      signal_id,check_id,candidate_identity_id,candidate_identity_version_id,signal_type,signal_strength
   ) VALUES($1,$2,$3,$4,'identity_document_exact','high')`,
   ["identity_duplicate_signal_"+ "z".repeat(24),duplicateCheck.checkId,established.submitted.identity.identityId,
    pending.correctionVersionId]),
   /latest verified or current submitted/i,
   "DB must reject attempted unverified correction candidate, even from direct forged SQL."
  );

  const pendingIdentity=(await db.query(
   "SELECT lock_version FROM worker_identities WHERE identity_id=$1",
   [established.submitted.identity.identityId]
  )).rows[0];
  const submittedCorrection=await corrections.submitOwn(established.worker,Number(pendingIdentity.lock_version));
  assert.ok(submittedCorrection.submittedAt,"Correction submission is still unapproved pending staff review.");
  const afterUnapprovedSubmit=await second.eligibilityService.evaluate(second.submitted.identity.identityId);
  assert.equal(afterUnapprovedSubmit.checkStatus,"review_required",
   "Submitting but not approving a correction must not make established identity disappear.");
  const submittedSignals=(await db.query(
   "SELECT candidate_identity_version_id FROM worker_identity_duplicate_signals WHERE check_id=$1",
   [afterUnapprovedSubmit.checkId]
  )).rows;
  assert.ok(submittedSignals.length>0);
  assert.ok(submittedSignals.every(row=>row.candidate_identity_version_id===established.submitted.currentVersion.identityVersionId),
   "Even submitted corrections cannot replace the immutable verified parent until approved.");
  await assert.rejects(
   second.eligibilityService.issuePermanentWorkerId(second.submitted.identity.identityId),
   error=>error?.name==="WorkerIdentityWorkerIdBlockedError"
  );
  const ids=(await db.query("SELECT identity_id FROM worker_identity_worker_ids")).rows;
  assert.deepEqual(ids,[{identity_id:established.submitted.identity.identityId}]);
  const identities=(await db.query("SELECT identity_id,lifecycle_status FROM worker_identities WHERE identity_id=ANY($1::text[])",[[established.submitted.identity.identityId,second.submitted.identity.identityId]])).rows;
  assert.equal(identities.length,2);
  assert.equal(identities.find(row=>row.identity_id===established.submitted.identity.identityId).lifecycle_status,"correction_pending");
 }finally{await db.close();}
});


test("Migration 0125 rollback restores original duplicate-signal guard and reapply preserves data",async()=>{
 const db=await setupTest("duplicate-correction-migration-roundtrip","0125_worker_identity_duplicate_correction_candidates");
 try {
  const baseline=(await db.query("SELECT pg_get_functiondef('worker_identity_duplicate_signal_validate_insert()'::regprocedure) AS source")).rows[0].source;
  assert.match(baseline,/latest verified or current submitted version/);
  const down=readFileSync("database/migrations/0125_worker_identity_duplicate_correction_candidates.down.sql","utf8");
  const up=readFileSync("database/migrations/0125_worker_identity_duplicate_correction_candidates.up.sql","utf8");
  await db.execute(down);
  const prior=(await db.query("SELECT pg_get_functiondef('worker_identity_duplicate_signal_validate_insert()'::regprocedure) AS source")).rows[0].source;
  assert.match(prior,/another identity current submitted version/);
  assert.doesNotMatch(prior,/latest verified or current submitted version/);
  await db.execute(up);
  const restored=(await db.query("SELECT pg_get_functiondef('worker_identity_duplicate_signal_validate_insert()'::regprocedure) AS source")).rows[0].source;
  assert.equal(restored,baseline);
 }finally{await db.close();}
});
