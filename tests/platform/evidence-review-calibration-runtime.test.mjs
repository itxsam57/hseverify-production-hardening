import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const { StaffCalibrationService } = loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");
const { EvidenceReviewFrameworkService } = loadWorkerRegistrationTs("src/lib/review/evidence-review-framework-service.ts");
const { EvidenceReviewEligibilityService } = loadWorkerRegistrationTs("src/lib/review/evidence-review-eligibility-service.ts");
const { EvidenceReviewService } = loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const { EffectivePolicyService, pinAssuranceCasePolicySnapshot } = loadWorkerRegistrationTs("src/lib/policy/effective-policy-service.ts");
const NOW = new Date(), before = new Date(NOW.getTime()-3600000), future = new Date(NOW.getTime()+3600000);
const id = (prefix, char) => `${prefix}_${char.repeat(24)}`;
const ENV = {appEnvironment:"test",databaseDriver:"pglite",pgliteDataDir:"memory://",releaseSha:"calibration-runtime",databaseUrl:null};
async function setup() {
 const db = await openScriptDatabase(ENV);
 for(const name of readdirSync("database/migrations").filter(x=>x.endsWith(".up.sql")).sort()) await db.execute(readFileSync(`database/migrations/${name}`,"utf8"));
 async function account(role,char) {
  const accountId=id("account",char),sessionId=id("session",char);
  await db.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$3,'active','scrypt$16384$8$1$salt$hash',$4,$4,$4,$4)`,[accountId,`${char}@example.test`,role,before.toISOString()]);
  await db.query(`INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)`,[accountId,role,before.toISOString()]);
  await db.query(`INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$6,$7)`,[sessionId,accountId,role,`token-${char}`,`csrf-${char}`,before.toISOString(),future.toISOString()]);
  return {accountId,sessionId,activeRole:role,accountStatus:"active",tenantMembership:null,email:`${char}@example.test`,displayName:role,createdAt:before.toISOString(),lastSeenAt:before.toISOString(),expiresAt:future.toISOString()};
 }
 const admin=await account("admin","A"),verifier=await account("verifier","V"),worker=await account("worker","W");
 const frameworkId=id("framework","F");
 await db.query(`INSERT INTO assurance_frameworks(framework_id,framework_reference,title,created_by_account_id,created_at,updated_at) VALUES($1,'CAL-B','Calibration framework',$2,$3,$3)`,[frameworkId,admin.accountId,before.toISOString()]);
 const calibration=new StaffCalibrationService(Promise.resolve(db));
 async function record(status,from=before,until=future) {return calibration.record(admin,{accountId:verifier.accountId,role:"verifier",frameworkReference:"CAL-B",status,validFrom:from,validUntil:until,note:"Observed benchmark result for evidence review."});}
 const recordId=id("worker_evidence_record","R"),versionId=id("worker_evidence_version","R");
 await db.query(`INSERT INTO worker_evidence_records(record_id,worker_account_id,record_kind,lifecycle_status,current_version_id,created_at,updated_at) VALUES($1,$2,'experience','active',NULL,$3,$3)`,[recordId,worker.accountId,before.toISOString()]);
 await db.query(`INSERT INTO worker_evidence_versions(version_id,record_id,version_number,revision,version_status,created_at,updated_at,submitted_at) VALUES($1,$2,1,1,'submitted',$3,$3,$3)`,[versionId,recordId,before.toISOString()]);
 await db.query(`UPDATE worker_evidence_records SET current_version_id=$2 WHERE record_id=$1`,[recordId,versionId]);
 const review=new EvidenceReviewService(db),task=await review.queueIndependentWorkerEvidence(worker,recordId,NOW);
 return {db,admin,verifier,worker,frameworkId,calibration,record,review,task};
}
test("latest effective FAILED supersedes earlier CURRENT while a future suspension does not apply early",async()=>{
 const x=await setup();try {
  await x.record("CURRENT");
  await x.record("SUSPENDED",future,new Date(future.getTime()+3600000));
  assert.equal(await x.calibration.hasCurrentCalibration(x.verifier.accountId,"verifier","CAL-B",NOW),true);
  await x.record("FAILED",new Date(NOW.getTime()-1000));
  assert.equal(await x.calibration.hasCurrentCalibration(x.verifier.accountId,"verifier","CAL-B",NOW),false);
 }finally{await x.db.close();}
});
test("real standalone producer remains unresolved and cannot be claimed using an unrelated CURRENT calibration",async()=>{
 const x=await setup();try {
  await x.record("CURRENT");
  await assert.rejects(x.review.claim(x.verifier,x.task.taskId,NOW),/framework|calibration/i);
  assert.equal((await x.db.query(`SELECT task_status FROM evidence_review_tasks WHERE task_id=$1`,[x.task.taskId])).rows[0].task_status,"QUEUED");
 }finally{await x.db.close();}
});

async function bind(x) {
 const service=new EvidenceReviewFrameworkService(Promise.resolve(x.db));
 const revisions=await service.listFrameworks(x.admin);
 const version=revisions.find(r=>r.frameworkId===x.frameworkId).frameworkVersionId;
 const binding=await service.bind(x.admin,{taskId:x.task.taskId,frameworkVersionId:version,reason:"Explicit evidence standard applicability approved.",expectedBindingId:null},NOW);
 return {service,version,binding};
}
test("authorized explicit standalone binding unlocks only matching calibration and later failure blocks assigned review",async()=>{
 const x=await setup();try {
  await bind(x);await x.record("CURRENT");
  await x.review.claim(x.verifier,x.task.taskId,NOW);
  const eligibility=new EvidenceReviewEligibilityService(Promise.resolve(x.db));
  assert.equal((await eligibility.evaluate(x.verifier,x.task.taskId,NOW)).eligible,true);
  await x.record("FAILED",new Date(NOW.getTime()-1000));
  assert.equal((await eligibility.evaluate(x.verifier,x.task.taskId,NOW)).reason,"CALIBRATION_NOT_CURRENT");
  await assert.rejects(x.review.decide(x.verifier,x.task.taskId,"APPROVED","Evidence reviewed against standard.",NOW),/calibration/i);
  assert.equal((await x.db.query("SELECT count(*)::integer n FROM evidence_review_decisions")).rows[0].n,0);
 }finally{await x.db.close();}
});
test("binding CAS and append-only history prevent stale edits and forged actor access",async()=>{
 const x=await setup();try {
  const {service,version,binding}=await bind(x);
  await assert.rejects(service.bind(x.admin,{taskId:x.task.taskId,frameworkVersionId:version,reason:"Stale applicability change.",expectedBindingId:null}),/changed/i);
  await assert.rejects(service.bind(x.verifier,{taskId:x.task.taskId,frameworkVersionId:version,reason:"Unauthorized applicability change.",expectedBindingId:binding}));
  await assert.rejects(x.db.query("UPDATE evidence_review_framework_bindings SET reason='changed reason'"),/append-only/i);
  await x.record("CURRENT");
  await assert.rejects(x.db.query("DELETE FROM staff_calibrations"),/append-only/i);
 }finally{await x.db.close();}
});
test("expired and future calibrations never unlock task; revoked Admin cannot bind",async()=>{
 const x=await setup();try {
  const {service,version,binding}=await bind(x);
  await x.record("CURRENT",before,new Date(NOW.getTime()-1000));
  const eligibility=new EvidenceReviewEligibilityService(Promise.resolve(x.db));
  assert.equal((await eligibility.evaluate(x.verifier,x.task.taskId,NOW)).reason,"CALIBRATION_NOT_CURRENT");
  await x.record("CURRENT",future,new Date(future.getTime()+3600000));
  assert.equal((await eligibility.evaluate(x.verifier,x.task.taskId,NOW)).eligible,false);
  await x.db.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='logout' WHERE session_id=$1",[x.admin.sessionId]);
  await assert.rejects(service.bind(x.admin,{taskId:x.task.taskId,frameworkVersionId:version,reason:"Revoked session applicability.",expectedBindingId:binding}));
 }finally{await x.db.close();}
});

test("binding audit failure rolls back applicability; populated migrations refuse erasure",async()=>{
 const x=await setup();try {
  const service=new EvidenceReviewFrameworkService(Promise.resolve(x.db));
  const revision=(await service.listFrameworks(x.admin))[0];
  await x.db.execute("CREATE FUNCTION fail_calibration_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END; $$; CREATE TRIGGER fail_calibration_audit BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION fail_calibration_audit();");
  await assert.rejects(service.bind(x.admin,{taskId:x.task.taskId,frameworkVersionId:revision.frameworkVersionId,reason:"Authorized binding with failed audit.",expectedBindingId:null}),/injected audit/i);
  assert.equal((await x.db.query("SELECT count(*)::integer n FROM evidence_review_framework_bindings")).rows[0].n,0);
  await x.db.execute("DROP TRIGGER fail_calibration_audit ON platform_audit_events; DROP FUNCTION fail_calibration_audit();");
  await bind(x);await x.record("CURRENT");
  await assert.rejects(x.db.execute(readFileSync("database/migrations/0107_review_calibration_audit.down.sql","utf8")),/Retained/i);
  await assert.rejects(x.db.execute(readFileSync("database/migrations/0106_evidence_review_calibration_binding.down.sql","utf8")),/Retained|Roll back/i);
 }finally{await x.db.close();}
});

test("empty dependency-ordered rollback restores schema and permits reapply",async()=>{
 const x=await setup();try {
  await assert.rejects(x.db.execute(readFileSync("database/migrations/0106_evidence_review_calibration_binding.down.sql","utf8")),/audit migration first/i);
  await x.db.execute(readFileSync("database/migrations/0107_review_calibration_audit.down.sql","utf8"));
  await x.db.execute(readFileSync("database/migrations/0106_evidence_review_calibration_binding.down.sql","utf8"));
  assert.equal((await x.db.query("SELECT to_regclass('evidence_review_framework_bindings') name")).rows[0].name,null);
  await x.db.execute(readFileSync("database/migrations/0106_evidence_review_calibration_binding.up.sql","utf8"));await x.db.execute(readFileSync("database/migrations/0107_review_calibration_audit.up.sql","utf8"));
  await bind(x);await x.record("CURRENT");assert.equal(await x.calibration.hasCurrentCalibration(x.verifier.accountId,"verifier","CAL-B",NOW),true);
 }finally{await x.db.close();}
});

test("actual case producer binding respects snapshot framework revision at reference time",async()=>{
 const x=await setup();try {
  const tenant=id("tenant","T"),caseId=id("assurance_case","C"),order=id("assurance_order","C"),target=id("assurance_target","C"),membership=id("membership","C"),link=id("company_worker_link","C");
  const company={...x.worker,activeRole:"company",authorizedTenantPermission:"company.orders.manage",tenantMembership:{tenantId:tenant,tenantStatus:"active",membershipId:membership,role:"owner",status:"active",overrides:[]}};
  await x.db.query(`INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,requested_identity_checks,requested_evidence_checks,assessment_framework_references,interview_required,order_status,submitted_at,created_at,updated_at) VALUES($1,$2,$3,'Pinned calibration order','PIN-CAL','[]','["experience"]','["CAL-B"]',FALSE,'SUBMITTED',$4,$4,$4)`,[order,tenant,membership,NOW.toISOString()]);
  await x.db.query(`INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'worker','submitted',$6,$6)`,[target,order,tenant,link,x.worker.accountId,NOW.toISOString()]);
  await x.db.query(`INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'Evidence pending','worker','Submit evidence.',$7,$7)`,[caseId,order,target,tenant,link,x.worker.accountId,NOW.toISOString()]);
  const policy=new EffectivePolicyService(x.db);await policy.publishPolicyVersion(x.admin,{frameworkReference:"CAL-B",policyReference:"PIN-CAL",title:"Pinned case rules",effectiveFrom:before,effectiveTo:null,policyValues:{pass_mark:80},overrideAllowedFields:[],overrideDirections:{}},NOW);
  await pinAssuranceCasePolicySnapshot(x.db,{caseId,tenantId:tenant,frameworkReferences:["CAL-B"],policyReference:"PIN-CAL",referenceTime:NOW,actorAccountId:x.admin.accountId,actorPrincipal:x.admin});
  await x.review.queueCaseEvidence(company,caseId,NOW);
  const task=(await x.db.query("SELECT task_id FROM evidence_review_tasks WHERE case_id=$1",[caseId])).rows[0].task_id;
  const service=new EvidenceReviewFrameworkService(Promise.resolve(x.db));const revision=(await service.listFrameworks(x.admin)).find(r=>r.frameworkId===x.frameworkId).frameworkVersionId;
  await assert.rejects(service.recordRevision(x.admin,{frameworkId:x.frameworkId,title:"Backdated rewritten standard",effectiveFrom:new Date(NOW.getTime()-1000)},NOW),/existing case snapshot/i);
  const v2=await service.recordRevision(x.admin,{frameworkId:x.frameworkId,title:"Revised standard",effectiveFrom:future},NOW);
  await assert.rejects(service.bind(x.admin,{taskId:task,frameworkVersionId:v2,reason:"Future revision must not replace pinned case.",expectedBindingId:null},new Date(future.getTime()+1000)),/pinned/i);
  await service.bind(x.admin,{taskId:task,frameworkVersionId:revision,reason:"Exact framework revision pinned to original case.",expectedBindingId:null},NOW);
  await x.record("CURRENT");assert.equal((await new EvidenceReviewEligibilityService(Promise.resolve(x.db)).evaluate(x.verifier,task,NOW)).eligible,true);
  await x.review.claim(x.verifier,task,NOW);
 }finally{await x.db.close();}
});

test("concurrent status failure and claim serialize into a task that cannot finalize",async()=>{
 const x=await setup();try {
  await bind(x);await x.record("CURRENT");
  const results=await Promise.allSettled([x.review.claim(x.verifier,x.task.taskId,NOW),x.record("FAILED",new Date(NOW.getTime()-1000))]);
  assert.equal(results[1].status,"fulfilled");
  const eligibility=new EvidenceReviewEligibilityService(Promise.resolve(x.db));assert.equal((await eligibility.evaluate(x.verifier,x.task.taskId,NOW)).eligible,false);
  await assert.rejects(x.review.decide(x.verifier,x.task.taskId,"APPROVED","Racing failure cannot authorize approval.",NOW));
  assert.equal((await x.db.query("SELECT count(*)::integer n FROM evidence_review_decisions")).rows[0].n,0);
 }finally{await x.db.close();}
});
test("concurrent binding attempts have one audited winner; assigned binding cannot change",async()=>{
 const x=await setup();try {
  const service=new EvidenceReviewFrameworkService(Promise.resolve(x.db));const version=(await service.listFrameworks(x.admin))[0].frameworkVersionId;
  const results=await Promise.allSettled(Array.from({length:4},()=>service.bind(x.admin,{taskId:x.task.taskId,frameworkVersionId:version,reason:"Concurrent authorized applicability resolution.",expectedBindingId:null},NOW)));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal((await x.db.query("SELECT count(*)::integer n FROM platform_audit_events WHERE action_key='evidence_review.framework.bound'")).rows[0].n,1);
  await x.record("CURRENT");await x.review.claim(x.verifier,x.task.taskId,NOW);
  await assert.rejects(service.bind(x.admin,{taskId:x.task.taskId,frameworkVersionId:version,reason:"Assigned binding mutation must be refused.",expectedBindingId:results.find(r=>r.status==="fulfilled").value},NOW),/unclaimed/i);
  assert.equal((await new EvidenceReviewEligibilityService(Promise.resolve(x.db)).evaluate(x.verifier,x.task.taskId,new Date(future.getTime()+1000))).reason,"CALIBRATION_NOT_CURRENT");
 }finally{await x.db.close();}
});

test("failed calibration after claim blocks material Unable to Verify but permits safe escalation",async()=>{
 const x=await setup();try{
  await bind(x);await x.record("CURRENT");await x.review.claim(x.verifier,x.task.taskId,NOW);
  await x.record("FAILED",new Date(NOW.getTime()-1000));
  await assert.rejects(x.review.resolveReview(x.verifier,x.task.taskId,{expectedRevision:0,outcome:"UNABLE_TO_VERIFY",reason:"Issuer cannot confirm submitted evidence",attemptedMethods:"Contacted issuer and checked reference",limitations:"Issuer did not reply to checks"},NOW),/calibration/i);
  assert.equal((await x.db.query("SELECT COUNT(*)::integer n FROM evidence_review_resolution_events")).rows[0].n,0);
  await x.review.resolveReview(x.verifier,x.task.taskId,{expectedRevision:0,outcome:"ESCALATED",destination:"admin",reason:"Calibration unavailable; reassignment or independent review required"},NOW);
  assert.equal((await x.db.query("SELECT task_status FROM evidence_review_tasks WHERE task_id=$1",[x.task.taskId])).rows[0].task_status,"ESCALATED");
 }finally{await x.db.close();}
});
test("Admin recovers policyless case with explicit published policy and matching calibration",async()=>{
 const x=await setup();try {
  const tenant=id("tenant","T"),caseId=id("assurance_case","C"),order=id("assurance_order","C"),target=id("assurance_target","C"),membership=id("membership","C"),link=id("company_worker_link","C");
  const company={...x.worker,activeRole:"company",authorizedTenantPermission:"company.orders.manage",tenantMembership:{tenantId:tenant,tenantStatus:"active",membershipId:membership,role:"owner",status:"active",overrides:[]}};
  await x.db.query(`INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,requested_identity_checks,requested_evidence_checks,assessment_framework_references,interview_required,order_status,submitted_at,created_at,updated_at) VALUES($1,$2,$3,'Pinned calibration order','PIN-CAL','[]','["experience"]','["CAL-B"]',FALSE,'SUBMITTED',$4,$4,$4)`,[order,tenant,membership,NOW.toISOString()]);
  await x.db.query(`INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'worker','submitted',$6,$6)`,[target,order,tenant,link,x.worker.accountId,NOW.toISOString()]);
  await x.db.query(`INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'Evidence pending','worker','Submit evidence.',$7,$7)`,[caseId,order,target,tenant,link,x.worker.accountId,NOW.toISOString()]);
  const policy=new EffectivePolicyService(x.db);await policy.publishPolicyVersion(x.admin,{frameworkReference:"CAL-B",policyReference:"PIN-CAL",title:"Pinned case rules",effectiveFrom:before,effectiveTo:null,policyValues:{pass_mark:80},overrideAllowedFields:[],overrideDirections:{}},NOW);

  await x.review.queueCaseEvidence(company,caseId,NOW);
  const task=(await x.db.query("SELECT task_id FROM evidence_review_tasks WHERE case_id=$1",[caseId])).rows[0].task_id;
  const service=new EvidenceReviewFrameworkService(Promise.resolve(x.db));const revision=(await service.listFrameworks(x.admin)).find(r=>r.frameworkId===x.frameworkId).frameworkVersionId;
  await service.bind(x.admin,{taskId:task,frameworkVersionId:revision,reason:"Explicit missing case policy resolution.",expectedBindingId:null,policyReference:"PIN-CAL"},NOW);
  await x.record("CURRENT");assert.equal((await new EvidenceReviewEligibilityService(Promise.resolve(x.db)).evaluate(x.verifier,task,NOW)).eligible,true);
  await x.review.claim(x.verifier,task,NOW);
 }finally{await x.db.close();}
});

test("Admin applicability queue renders the actual unresolved task without ambiguous revision joins",async()=>{
 const x=await setup();try{
  const rows=await new EvidenceReviewFrameworkService(Promise.resolve(x.db)).listTasks(x.admin);
  assert.ok(rows.some(row=>row.task_id===x.task.taskId && row.pinned_framework_version_id===null));
 }finally{await x.db.close();}
});
