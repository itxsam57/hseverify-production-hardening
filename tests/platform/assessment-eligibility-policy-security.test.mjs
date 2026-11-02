import assert from "node:assert/strict";
import test from "node:test";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { assessmentEligibilityWaitingFixture } from "../helpers/assessment-eligibility-policy-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const { EffectivePolicyService }=loadWorkerRegistrationTs("src/lib/policy/effective-policy-service.ts");
const { WorkerAssessmentApplicationService }=loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const { AssessmentCatalogueEligibilityService }=loadWorkerRegistrationTs("src/lib/assessment-catalogue/assessment-catalogue-eligibility-service.ts");

test("Actual published typed limits reject malformed config, prevent tenant weakening, enforce tighter Company rules and bind Worker access",async()=>{
  const fixture=await assessmentEligibilityWaitingFixture({waitingPeriodDays:0,attemptLimit:2,terminalAt:new Date()});
  const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
  try {
    const policies=new EffectivePolicyService(database), now=new Date();
    for(const policyValues of [
      {assessmentWaitingPeriodDays:-1},{assessmentWaitingPeriodDays:1.5},{assessmentWaitingPeriodDays:"2"},{assessmentWaitingPeriodDays:null},
      {assessmentAttemptLimit:0},{assessmentAttemptLimit:-1},{assessmentAttemptLimit:1.5},{assessmentAttemptLimit:"2"},{assessmentAttemptLimit:null}
    ]) {
      await assert.rejects(()=>policies.publishPolicyVersion(fixture.admin,{frameworkReference:"SEARCH-WORKER",policyReference:"INVALID-ELIGIBILITY",title:"Invalid policy",
        effectiveFrom:new Date("2026-01-01"),effectiveTo:null,policyValues,overrideAllowedFields:[],overrideDirections:{}},now),/must be/i);
    }
    for (const requirements of [null,[],{}, {qualificationTitles:[]},{qualificationCategories:[""]},
      {qualificationTitles:["same"," SAME "]},{countriesOfResidence:["Pakistan",7]},
      {minimumExperienceMonths:-1},{minimumExperienceMonths:1.5},{minimumExperienceMonths:"6"},
      {experienceRoleTitles:"Technician"},{riskContextRequired:true},{unrecognizedRequirement:true}]) {
      await assert.rejects(()=>policies.publishPolicyVersion(fixture.admin,{frameworkReference:"SEARCH-WORKER",
        policyReference:"INVALID-CONTEXT",title:"Invalid optional requirements",effectiveFrom:new Date("2026-01-01"),
        effectiveTo:null,policyValues:{assessmentEligibility:requirements},overrideAllowedFields:[],overrideDirections:{}},now),
        /assessmentEligibility|must be|must not/i);
    }
    assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM assurance_policy_packs WHERE policy_reference='INVALID-CONTEXT'")).rows[0].n,0);
    assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM assurance_policy_packs WHERE policy_reference='INVALID-ELIGIBILITY'")).rows[0].n,0);
    const company={...fixture.company,authorizedTenantPermission:"company.settings.manage"};
    await assert.rejects(()=>policies.saveTenantOverride(company,{policyReference:"ELIGIBILITY-POLICY",overrideValues:{assessmentAttemptLimit:3},effectiveFrom:new Date("2026-01-01"),effectiveTo:null},now),/weakens/i);
    await policies.saveTenantOverride(company,{policyReference:"ELIGIBILITY-POLICY",overrideValues:{assessmentAttemptLimit:1},effectiveFrom:new Date("2026-01-01"),effectiveTo:null},now);
    const applications=new WorkerAssessmentApplicationService(database);
    assert.equal((await applications.listOfferings(fixture.worker,now)).find(row=>row.catalogueVersionId===fixture.catalogue).eligibilityStatus,"AVAILABLE","Global rules permit one prior attempt; Company may tighten its own scope");
    const snapshot=async()=>({
      requests:(await database.query("SELECT funding_request_id,status,reserved_credit_units FROM funding_requests ORDER BY funding_request_id")).rows,
      applications:(await database.query("SELECT application_id,application_status FROM worker_assessment_applications ORDER BY application_id")).rows,
      cases:(await database.query("SELECT case_id,case_status FROM assurance_cases ORDER BY case_id")).rows
    });
    const before=await snapshot();
    await assert.rejects(()=>applications.requestCompanyFunding(fixture.worker,{...fixture.fundingInput,catalogueVersionId:fixture.catalogue},now),/attempt limit/i);
    assert.deepEqual(await snapshot(),before,"Tightening denial must not create requests, applications or cases");
    const eligibility=new AssessmentCatalogueEligibilityService(database);
    await assert.rejects(()=>eligibility.listUnavailableForWorker({...fixture.worker,accountId:"foreign-worker"},now));
    await database.query("UPDATE auth_sessions SET revoked_at=$2,revocation_reason='policy-security-test' WHERE session_id=$1",[fixture.worker.sessionId,now.toISOString()]);
    await assert.rejects(()=>eligibility.listUnavailableForWorker(fixture.worker,now));
    await assert.rejects(()=>applications.listOfferings(fixture.worker,now));
    assert.deepEqual(await snapshot(),before);
    console.log("ACTUAL_ELIGIBILITY_SECURITY published typed validation; Rules Engine tenant tightening with real terminal Worker/framework history; denial rollback; live owned role/session binding.");
  } finally {await database.close();await fixture.cleanup();}
});
