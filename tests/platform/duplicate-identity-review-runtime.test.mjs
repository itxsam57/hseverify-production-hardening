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
