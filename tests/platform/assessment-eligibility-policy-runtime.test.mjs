import { seedPublishedQuestion } from "../helpers/question-publication-fixture.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { assessmentFundingFixture, fundingPrincipal } from "../helpers/assessment-funding-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const { WorkerAssessmentApplicationService } = loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const { AssessmentCatalogueEligibilityService } = loadWorkerRegistrationTs("src/lib/assessment-catalogue/assessment-catalogue-eligibility-service.ts");
const { AssessmentAttemptService } = loadWorkerRegistrationTs("src/lib/assessment-attempt/assessment-attempt-service.ts");
const { AssuranceOrderService } = loadWorkerRegistrationTs("src/lib/assurance/assurance-order-service.ts");
const { EffectivePolicyService } = loadWorkerRegistrationTs("src/lib/policy/effective-policy-service.ts");
const id = (prefix, seed) => prefix + "_" + createHash("sha256").update(seed).digest("hex").slice(0,24);

test("Published waiting/attempt policy follows actual terminal answer through Worker listing, apply, assigned begin and Company validation/submission", async () => {
  const fixture = await assessmentFundingFixture(), database = await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
  const now = new Date();
  try {
    await database.query("UPDATE auth_sessions SET expires_at='2099-01-01' WHERE session_id IN ($1,$2)", [fixture.worker.sessionId, fixture.company.sessionId]);
    const admin = await fundingPrincipal(database, fixture.credentials.admin, "admin");
    const policies = new EffectivePolicyService(database);
    await database.query("UPDATE assurance_policy_packs SET policy_status='INACTIVE' WHERE policy_reference='ASSESSMENT-FUNDING'");
    const values = {pass_mark:70, assessmentWaitingPeriodDays:2, assessmentAttemptLimit:2};
    await policies.publishPolicyVersion(admin, {frameworkReference:"SEARCH-WORKER", policyReference:"ELIGIBILITY-POLICY", title:"Configured repeat assessment policy",
      effectiveFrom:new Date("2026-01-01"), effectiveTo:null, policyValues:values,
      overrideAllowedFields:["assessmentWaitingPeriodDays","assessmentAttemptLimit"], overrideDirections:{assessmentWaitingPeriodDays:"MINIMUM",assessmentAttemptLimit:"MAXIMUM"}}, now);
    const source = (await database.query("SELECT * FROM assessment_catalogue_versions WHERE catalogue_version_id=$1", [fixture.fundingInput.catalogueVersionId])).rows[0];
    const entry = id("assessment_catalogue","eligibility-repeat"), catalogue = id("catalogue_version","eligibility-repeat");
    await database.query("INSERT INTO assessment_catalogue_entries(catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'ELIGIBILITY-REPEAT','INACTIVE',NULL,$2,$3,$3)", [entry,admin.accountId,now.toISOString()]);
    await database.query("INSERT INTO assessment_catalogue_versions(catalogue_version_id,catalogue_entry_id,version_no,title,framework_id,blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at) VALUES($1,$2,1,'Repeat safety assessment',$3,$4,0,$5,$6)", [catalogue,entry,source.framework_id,source.blueprint_version_id,admin.accountId,now.toISOString()]);
    await database.query("UPDATE assessment_catalogue_entries SET current_version_id=$2,catalogue_status='ACTIVE' WHERE catalogue_entry_id=$1",[entry,catalogue]);
    for (const seed of ["eligibility-second","eligibility-third"]) {
      const question=id("assessment_question",seed), version=id("question_version",seed), fingerprint=createHash("sha256").update(seed).digest("hex");
      await seedPublishedQuestion(database,{questionId:question,versionId:version,reference:seed.toUpperCase(),questionType:"MULTIPLE_CHOICE",prompt:seed+" safe choice",options:["Stop and assess","Ignore the hazard"],answerKey:"Stop and assess",frameworkId:source.framework_id,fingerprint,authorAccountId:admin.accountId,now:now.toISOString()});
    }
    const applications=new WorkerAssessmentApplicationService(database), eligibility=new AssessmentCatalogueEligibilityService(database), attempts=new AssessmentAttemptService(database);
    const firstApp=await applications.applyWorkerPay(fixture.worker,source.catalogue_version_id,now);
    const first=await applications.confirmSandboxWorkerPayment(fixture.worker,firstApp.applicationId,now);
    const secondApp=await applications.applyWorkerPay(fixture.worker,catalogue,now);
    const second=await applications.confirmSandboxWorkerPayment(fixture.worker,secondApp.applicationId,now);
    const orders=new AssuranceOrderService(database), company={...fixture.company,authorizedTenantPermission:"company.orders.manage"};
    const draft=await orders.createDraft(company,{orderName:"Policy validation",orderReference:"POLICY-VALIDATE",requestedIdentityChecks:[],requestedEvidenceChecks:[],assessmentFrameworkReferences:["SEARCH-WORKER"],interviewRequired:false,effectivePolicyReference:"ELIGIBILITY-POLICY"},now);
    await orders.addWorkerTarget(company,draft.orderId,fixture.fundingInput.workerLinkId,"company",now);
    assert.equal((await orders.validateOrder(company,draft.orderId,now)).ready,true);
    const initial=await attempts.begin(fixture.worker,{caseId:first.caseId,catalogueVersionId:source.catalogue_version_id},now);
    const terminal=await attempts.submitCurrentAnswer(fixture.worker,{attemptId:initial.attempt.attemptId,position:1,questionVersionId:initial.currentQuestion.questionVersionId,answer:"Stop and assess"},now);
    assert.equal(terminal.submitted,true,"Actual final answer must authoritatively persist SUBMITTED");
    const waiting=(await applications.listOfferings(fixture.worker,now)).find(row=>row.catalogueVersionId===catalogue);
    assert.equal(waiting.eligibilityStatus,"WAITING","Published waiting policy currently has no consumer");
    assert.equal(waiting.availableAt,new Date(now.getTime()+2*86400000).toISOString());
    assert.match(waiting.eligibilityReason,/waiting/i);
    assert.equal((await eligibility.findAvailableForCase(fixture.worker,second.caseId,now)).length,0);
    await assert.rejects(()=>attempts.begin(fixture.worker,{caseId:second.caseId,catalogueVersionId:catalogue},now));
    await assert.rejects(()=>applications.applyWorkerPay(fixture.worker,catalogue,now),/waiting/i);
    await assert.rejects(()=>orders.submitOrder(company,draft.orderId,now),/waiting/i);
    assert.equal((await database.query("SELECT order_status FROM assurance_orders WHERE order_id=$1",[draft.orderId])).rows[0].order_status,"READY");
    const validation=await orders.validateOrder(company,draft.orderId,now);
    assert.equal(validation.ready,false);
    assert.match(validation.errors.join(" "),/waiting/i);
    const frozen=(await database.query("SELECT effective_value_json FROM assurance_case_policy_snapshots WHERE case_id=$1",[second.caseId])).rows[0].effective_value_json;
    assert.equal(frozen.assessmentWaitingPeriodDays,2);
    await database.query("UPDATE assurance_policy_packs SET policy_status='INACTIVE' WHERE policy_reference='ELIGIBILITY-POLICY'");
    await policies.publishPolicyVersion(admin,{frameworkReference:"SEARCH-WORKER",policyReference:"LATER-POLICY",title:"Later published rules",effectiveFrom:new Date("2026-01-01"),effectiveTo:null,policyValues:{pass_mark:70,assessmentWaitingPeriodDays:90,assessmentAttemptLimit:1},overrideAllowedFields:[],overrideDirections:{}},now);
    const later=new Date(now.getTime()+2*86400000);
    assert.ok((await eligibility.findAvailableForCase(fixture.worker,second.caseId,later)).some(row=>row.catalogueVersionId===catalogue),"Historical case uses pinned2days, not later90days");
    const resumed=await attempts.begin(fixture.worker,{caseId:second.caseId,catalogueVersionId:catalogue},later);
    assert.equal(resumed.attempt.status,"IN_PROGRESS");
    const before=await database.query("SELECT COUNT(*)::int AS n FROM assessment_attempts WHERE worker_account_id=$1",[fixture.worker.accountId]);
    const unavailable=(await applications.listOfferings(fixture.worker,later)).find(row=>row.catalogueVersionId===catalogue);
    assert.equal(unavailable.eligibilityStatus,"ATTEMPT_LIMIT");
    await assert.rejects(()=>applications.requestCompanyFunding(fixture.worker,{...fixture.fundingInput,catalogueVersionId:catalogue},later),/attempt limit/i);
    assert.deepEqual((await database.query("SELECT effective_value_json FROM assurance_case_policy_snapshots WHERE case_id=$1",[second.caseId])).rows[0].effective_value_json,frozen);
    assert.deepEqual(await database.query("SELECT COUNT(*)::int AS n FROM assessment_attempts WHERE worker_account_id=$1",[fixture.worker.accountId]),before);
  } finally {await database.close();await fixture.cleanup();}
});
