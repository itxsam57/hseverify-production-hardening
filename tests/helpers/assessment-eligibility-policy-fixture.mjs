import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { assessmentFundingFixture, fundingPrincipal } from "./assessment-funding-fixture.mjs";
import { loadWorkerRegistrationTs } from "./worker-registration-runtime-loader.mjs";
const { WorkerAssessmentApplicationService } = loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const { AssessmentAttemptService } = loadWorkerRegistrationTs("src/lib/assessment-attempt/assessment-attempt-service.ts");
const { AssuranceOrderService } = loadWorkerRegistrationTs("src/lib/assurance/assurance-order-service.ts");
const { EffectivePolicyService } = loadWorkerRegistrationTs("src/lib/policy/effective-policy-service.ts");
const id = (prefix, seed) => prefix + "_" + createHash("sha256").update(seed).digest("hex").slice(0,24);

export async function assessmentEligibilityWaitingFixture({waitingPeriodDays=2,attemptLimit=2,terminalAt=new Date(Date.now()-2*86400000+45000),policyEffectiveTo=null}={}) {
  const fixture = await assessmentFundingFixture(), database = await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
  const now = terminalAt;
  try {
    await database.query("UPDATE auth_sessions SET expires_at='2099-01-01' WHERE session_id IN ($1,$2)", [fixture.worker.sessionId, fixture.company.sessionId]);
    const admin = await fundingPrincipal(database, fixture.credentials.admin, "admin");
    const policies = new EffectivePolicyService(database);
    await database.query("UPDATE assurance_policy_packs SET policy_status='INACTIVE' WHERE policy_reference='ASSESSMENT-FUNDING'");
    const values = {pass_mark:70, assessmentWaitingPeriodDays:waitingPeriodDays, assessmentAttemptLimit:attemptLimit};
    await policies.publishPolicyVersion(admin, {frameworkReference:"SEARCH-WORKER", policyReference:"ELIGIBILITY-POLICY", title:"Configured repeat assessment policy",
      effectiveFrom:new Date("2026-01-01"), effectiveTo:policyEffectiveTo, policyValues:values,
      overrideAllowedFields:["assessmentWaitingPeriodDays","assessmentAttemptLimit"], overrideDirections:{assessmentWaitingPeriodDays:"MINIMUM",assessmentAttemptLimit:"MAXIMUM"}}, now);
    const source = (await database.query("SELECT * FROM assessment_catalogue_versions WHERE catalogue_version_id=$1", [fixture.fundingInput.catalogueVersionId])).rows[0];
    const entry = id("assessment_catalogue","eligibility-repeat"), catalogue = id("catalogue_version","eligibility-repeat");
    await database.query("INSERT INTO assessment_catalogue_entries(catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'ELIGIBILITY-REPEAT','INACTIVE',NULL,$2,$3,$3)", [entry,admin.accountId,now.toISOString()]);
    await database.query("INSERT INTO assessment_catalogue_versions(catalogue_version_id,catalogue_entry_id,version_no,title,framework_id,blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at) VALUES($1,$2,1,'Repeat safety assessment',$3,$4,0,$5,$6)", [catalogue,entry,source.framework_id,source.blueprint_version_id,admin.accountId,now.toISOString()]);
    await database.query("UPDATE assessment_catalogue_entries SET current_version_id=$2,catalogue_status='ACTIVE' WHERE catalogue_entry_id=$1",[entry,catalogue]);
    for (const seed of ["eligibility-second","eligibility-third"]) {
      const question=id("assessment_question",seed), version=id("question_version",seed), fingerprint=createHash("sha256").update(seed).digest("hex");
      await database.query("INSERT INTO assessment_questions(question_id,question_reference,question_status,current_version_id,current_content_fingerprint,created_by_account_id,created_at,updated_at) VALUES($1,$2,'INACTIVE',NULL,NULL,$3,$4,$4)",[question,seed.toUpperCase(),admin.accountId,now.toISOString()]);
      await database.query("INSERT INTO assessment_question_versions(question_version_id,question_id,version_no,question_type,prompt,options_json,answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,content_fingerprint,created_by_account_id,created_at) VALUES($1,$2,1,'MULTIPLE_CHOICE',$3,'[\"Stop and assess\",\"Ignore the hazard\"]'::jsonb,'\"Stop and assess\"'::jsonb,NULL,$4,'Core','MEDIUM','[]'::jsonb,$5,$6,$7)",[version,question,seed+" safe choice",source.framework_id,fingerprint,admin.accountId,now.toISOString()]);
      await database.query("UPDATE assessment_questions SET current_version_id=$2,current_content_fingerprint=$3,question_status='ACTIVE' WHERE question_id=$1",[question,version,fingerprint]);
    }
    const applications=new WorkerAssessmentApplicationService(database), attempts=new AssessmentAttemptService(database);
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
    await database.close();
    return {...fixture, admin, first, second, catalogue, draft, availableAt: new Date(now.getTime()+waitingPeriodDays*86400000).toISOString()};
  } catch(error) {await database.close();await fixture.cleanup();throw error;}
}
