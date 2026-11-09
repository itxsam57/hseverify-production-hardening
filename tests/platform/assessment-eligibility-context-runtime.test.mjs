import assert from "node:assert/strict";
import test from "node:test";
import { assessmentEligibilityQualificationFixture } from "../helpers/assessment-eligibility-context-fixture.mjs";
import { seedEligibilityCertificate } from "../helpers/assessment-eligibility-certificate-fixture.mjs";
import { seedEligibilityResidenceIdentity } from "../helpers/assessment-eligibility-residence-fixture.mjs";
import { fundingPrincipal } from "../helpers/assessment-funding-fixture.mjs";
import { authorizeReviewFixture } from "../helpers/evidence-review-calibration-fixture.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { assessmentEligibilityWaitingFixture } from "../helpers/assessment-eligibility-policy-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const { EffectivePolicyService }=loadWorkerRegistrationTs("src/lib/policy/effective-policy-service.ts");
const { WorkerAssessmentApplicationService }=loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const { AssessmentCatalogueEligibilityService }=loadWorkerRegistrationTs("src/lib/assessment-catalogue/assessment-catalogue-eligibility-service.ts");
const { AssuranceOrderService }=loadWorkerRegistrationTs("src/lib/assurance/assurance-order-service.ts");


const { WorkerEvidenceService }=loadWorkerRegistrationTs("src/lib/worker-evidence/worker-evidence-service.ts");
const { EvidenceReviewService }=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const { AssessmentAttemptService }=loadWorkerRegistrationTs("src/lib/assessment-attempt/assessment-attempt-service.ts");
const { evaluateWorkerAssessmentHistory }=loadWorkerRegistrationTs("src/lib/assessment-catalogue/assessment-eligibility-policy-service.ts");
const { DatabaseWorkerIdentityCorrectionRepository }=loadWorkerRegistrationTs("src/lib/identity/worker-identity-correction-repository.ts");

async function produceEvidence(database,fixture,kind,details,now,approve=true) {
 const evidence=new WorkerEvidenceService(Promise.resolve(database),()=>now);
 const draft=await evidence.createDraft(fixture.worker,kind);
 const common={recordId:draft.recordId,expectedRevision:draft.currentVersion.revision};
 const saved=kind==="qualification"
  ? await evidence.saveQualificationDraft(fixture.worker,{...common,title:"Trade Safety Certificate",category:"safety",
      issuingOrganization:"Test issuer",learningProvider:null,certificateNumber:draft.recordId,issueDate:"2020-01-01",expiryDate:null,
      level:"Certificate",country:"Pakistan",verificationUrl:null,declarationAccepted:true,...details})
  : await evidence.saveExperienceDraft(fixture.worker,{...common,companyName:"Verified employer",roleTitle:"Safety technician",
      duties:"Safely perform the framework activities.",country:"Pakistan",startDate:"2024-01-01",endDate:"2025-01-01",status:"ended",...details});
 if(kind==="qualification") await seedEligibilityCertificate(database,fixture.worker,saved,now);
 const submitted=await evidence.submit(fixture.worker,draft.recordId,saved.currentVersion.revision);
 const reviews=new EvidenceReviewService(database), task=await reviews.queueIndependentWorkerEvidence(fixture.worker,draft.recordId,now);
 const verifier=await fundingPrincipal(database,fixture.credentials.verifier,"verifier");
 await authorizeReviewFixture(database,{taskId:task.taskId,verifiers:[verifier],at:now});
 if(approve){await reviews.claim(verifier,task.taskId,now);await reviews.decide(verifier,task.taskId,"APPROVED","Current evidence version and attributable facts were verified.",now);}
 return {evidence,submitted,task,verifier,reviews};
}

test("Actual published framework qualification requirements gate original Worker and Company producers while old case pins remain unchanged",async()=>{
 const terminalAt=new Date(), policyEffectiveTo=new Date(terminalAt.getTime()+5000);
 const fixture=await assessmentEligibilityWaitingFixture({waitingPeriodDays:0,attemptLimit:2,terminalAt,policyEffectiveTo});
 const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try {
  const now=policyEffectiveTo, policies=new EffectivePolicyService(database);
  await policies.publishPolicyVersion(fixture.admin,{frameworkReference:"SEARCH-WORKER",policyReference:"ELIGIBILITY-POLICY",title:"Verified framework qualification mapping",
   effectiveFrom:now,effectiveTo:null,policyValues:{pass_mark:70,assessmentWaitingPeriodDays:0,assessmentAttemptLimit:2,
    assessmentEligibility:{qualificationCategories:["safety"],qualificationTitles:["Trade Safety Certificate"]}},overrideAllowedFields:[],overrideDirections:{}},now);
  const applications=new WorkerAssessmentApplicationService(database), eligibility=new AssessmentCatalogueEligibilityService(database),orders=new AssuranceOrderService(database);
  const blocked=(await applications.listOfferings(fixture.worker,now)).find(row=>row.catalogueVersionId===fixture.catalogue);
  assert.equal(blocked.eligibilityStatus,"QUALIFICATION_REQUIRED","Published qualification mapping must consume authoritative approved current evidence rather than unrelated counts");
  await assert.rejects(()=>applications.applyWorkerPay(fixture.worker,fixture.catalogue,now),/qualification/i);
  await assert.rejects(()=>applications.requestCompanyFunding(fixture.worker,{...fixture.fundingInput,catalogueVersionId:fixture.catalogue},now),/qualification/i);
  const company={...fixture.company,authorizedTenantPermission:"company.orders.manage"};
  await assert.rejects(()=>orders.submitOrder(company,fixture.draft.orderId,now),/qualification/i);
  assert.equal((await database.query("SELECT order_status FROM assurance_orders WHERE order_id=$1",[fixture.draft.orderId])).rows[0].order_status,"READY");
  assert.equal((await eligibility.listAvailableForWorker(fixture.worker,now)).some(row=>row.caseId===fixture.second.caseId),true,"Earlier case policy pin must retain its absent optional requirements");
  await produceEvidence(database,fixture,"qualification",{title:"Unrelated certificate"},now);
  await produceEvidence(database,fixture,"qualification",{category:"Unrelated trade"},now);
  assert.equal((await applications.listOfferings(fixture.worker,now)).find(row=>row.catalogueVersionId===fixture.catalogue).eligibilityStatus,"QUALIFICATION_REQUIRED",
   "Separate approved records must not combine category and title into a false qualification match");
  const matched=await produceEvidence(database,fixture,"qualification",{},now,false);
  assert.equal((await applications.listOfferings(fixture.worker,now)).find(row=>row.catalogueVersionId===fixture.catalogue).eligibilityStatus,"QUALIFICATION_REQUIRED",
   "Submitted but unapproved evidence cannot authorize a configured assessment");
  await matched.reviews.claim(matched.verifier,matched.task.taskId,now);
  await matched.reviews.decide(matched.verifier,matched.task.taskId,"APPROVED","Matching current qualification facts were verified.",now);
  assert.equal((await applications.listOfferings(fixture.worker,now)).find(row=>row.catalogueVersionId===fixture.catalogue).eligibilityStatus,"AVAILABLE");
  assert.equal((await orders.validateOrder(company,fixture.draft.orderId,now)).ready,true);
  await orders.submitOrder(company,fixture.draft.orderId,now);
  const newCase=(await database.query("SELECT case_id FROM assurance_cases WHERE order_id=$1",[fixture.draft.orderId])).rows[0].case_id;
  await matched.evidence.startRevision(fixture.worker,matched.submitted.recordId,matched.submitted.currentVersion.revision);
  assert.equal((await applications.listOfferings(fixture.worker,now)).find(row=>row.catalogueVersionId===fixture.catalogue).eligibilityStatus,"QUALIFICATION_REQUIRED",
   "A current draft cannot borrow approval from the prior submitted version");
  assert.equal((await eligibility.listUnavailableForWorker(fixture.worker,now)).find(row=>row.caseId===newCase).eligibilityStatus,"QUALIFICATION_REQUIRED");
  const priorAttempts=(await database.query("SELECT attempt_id,case_id,status FROM assessment_attempts ORDER BY attempt_id")).rows;
  await assert.rejects(()=>new AssessmentAttemptService(database).begin(fixture.worker,{caseId:newCase,catalogueVersionId:fixture.catalogue},now),{name:"AssessmentAttemptAccessError"});
  assert.deepEqual((await database.query("SELECT attempt_id,case_id,status FROM assessment_attempts ORDER BY attempt_id")).rows,priorAttempts,"Original begin denial must preserve all attempts");

 } finally {await database.close();await fixture.cleanup();}
});

test("Actual verified experience producers union overlapping intervals, require configured roles and do not count pending or unrelated evidence",async()=>{
 const terminalAt=new Date(),cutoff=new Date(terminalAt.getTime()+5000);
 const fixture=await assessmentEligibilityWaitingFixture({waitingPeriodDays:0,attemptLimit:2,terminalAt,policyEffectiveTo:cutoff});
 const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try{
  const policies=new EffectivePolicyService(database),now=cutoff,applications=new WorkerAssessmentApplicationService(database);
  await policies.publishPolicyVersion(fixture.admin,{frameworkReference:"SEARCH-WORKER",policyReference:"ELIGIBILITY-POLICY",title:"Verified framework experience",
   effectiveFrom:now,effectiveTo:null,policyValues:{pass_mark:70,assessmentEligibility:{experienceRoleTitles:["Safety technician"],minimumExperienceMonths:18}},
   overrideAllowedFields:[],overrideDirections:{}},now);
  const status=async()=>(await applications.listOfferings(fixture.worker,now)).find(row=>row.catalogueVersionId===fixture.catalogue).eligibilityStatus;
  assert.equal(await status(),"EXPERIENCE_REQUIRED");
  await produceEvidence(database,fixture,"experience",{},now);
  await produceEvidence(database,fixture,"experience",{startDate:"2024-07-01"},now);
  await produceEvidence(database,fixture,"experience",{roleTitle:"Unrelated role",startDate:"2020-01-01"},now);
  assert.equal(await status(),"EXPERIENCE_REQUIRED","Overlapping 12 and 6 month records count 12 union months; unrelated roles cannot inflate the requirement");
  const additional=await produceEvidence(database,fixture,"experience",{startDate:"2025-01-01",endDate:"2025-07-01"},now,false);
  assert.equal(await status(),"EXPERIENCE_REQUIRED","Pending six-month experience cannot satisfy verified duration");
  await additional.reviews.claim(additional.verifier,additional.task.taskId,now);
  await additional.reviews.decide(additional.verifier,additional.task.taskId,"APPROVED","Nonoverlapping framework role experience period was verified.",now);
  assert.equal(await status(),"AVAILABLE","Actual approved intervals establish eighteen nonoverlapping calendar months");
 }finally{await database.close();await fixture.cleanup();}
});

test("Published residence requirements use verified frozen identity details and reject pending identity and unverified correction context",async()=>{
 const terminalAt=new Date(),cutoff=new Date(terminalAt.getTime()+5000);
 const fixture=await assessmentEligibilityWaitingFixture({waitingPeriodDays:0,attemptLimit:2,terminalAt,policyEffectiveTo:cutoff});
 const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try{
  const policies=new EffectivePolicyService(database),now=cutoff,applications=new WorkerAssessmentApplicationService(database);
  const values={pass_mark:70,assessmentEligibility:{countriesOfResidence:["Pakistan"]}};
  await policies.publishPolicyVersion(fixture.admin,{frameworkReference:"SEARCH-WORKER",policyReference:"ELIGIBILITY-POLICY",title:"Verified residence jurisdiction",
   effectiveFrom:now,effectiveTo:null,policyValues:values,overrideAllowedFields:[],overrideDirections:{}},now);
  const missing=(await applications.listOfferings(fixture.worker,now)).find(row=>row.catalogueVersionId===fixture.catalogue);
  assert.equal(missing.eligibilityStatus,"JURISDICTION_REQUIRED");
  assert.match(missing.eligibilityReason,/missing/i,"Legacy verified identity without frozen residence must not acquire an invented jurisdiction");
  const worker=await fundingPrincipal(database,{accountId:"search_foreign_worker"}),verifier=await fundingPrincipal(database,fixture.credentials.verifier,"verifier");
  const identity=await seedEligibilityResidenceIdentity(database,worker.accountId,now);
  const framework=(await database.query("SELECT framework_id FROM assurance_frameworks WHERE framework_reference='SEARCH-WORKER'")).rows[0].framework_id;
  const decision=()=>evaluateWorkerAssessmentHistory(database,{workerAccountId:worker.accountId,frameworkId:framework,policyValues:values,now});
  assert.equal((await decision()).eligibilityStatus,"JURISDICTION_REQUIRED","Submitted personal details alone are not verified authority");
  const reviews=new EvidenceReviewService(database),task=await reviews.queueIndependentIdentity(worker,now);
  await authorizeReviewFixture(database,{taskId:task.taskId,verifiers:[verifier],at:now});
  await reviews.claim(verifier,task.taskId,now);
  await reviews.decide(verifier,task.taskId,"APPROVED","Submitted frozen identity and country of residence were verified.",now);
  assert.equal((await applications.listOfferings(worker,now)).find(row=>row.catalogueVersionId===fixture.catalogue).eligibilityStatus,"AVAILABLE");
  await assert.rejects(()=>database.query("UPDATE worker_identity_version_drafts SET country_of_residence='Canada',draft_revision=draft_revision+1 WHERE identity_version_id=$1",[identity.versionId]),/immutable|draft|submitted/i);
  const corrections=new DatabaseWorkerIdentityCorrectionRepository(Promise.resolve(database));
  const lock=(await database.query("SELECT lock_version FROM worker_identities WHERE identity_id=$1",[identity.identityId])).rows[0].lock_version;
  await corrections.requestOwn(worker,{reason:"Update residence with separately reviewed evidence.",expectedLockVersion:lock});
  const draft=(await database.query("SELECT versions.identity_version_id FROM worker_identities identities JOIN worker_identity_versions versions ON versions.identity_id=identities.identity_id AND versions.version_number=identities.current_version_number WHERE identities.identity_id=$1",[identity.identityId])).rows[0].identity_version_id;
  await database.query("UPDATE worker_identity_version_drafts SET country_of_residence='Canada',draft_revision=draft_revision+1 WHERE identity_version_id=$1",[draft]);
  assert.equal((await decision()).eligibilityStatus,"JURISDICTION_REQUIRED","Unverified current correction must not authorize configured country access");
  assert.equal((await database.query("SELECT country_of_residence FROM worker_identity_version_drafts WHERE identity_version_id=$1",[identity.versionId])).rows[0].country_of_residence,"Pakistan");
 }finally{await database.close();await fixture.cleanup();}
});

test("An actual terminal producer between offering read and Worker application transaction cannot bypass the published attempt limit",async()=>{
 const fixture=await assessmentEligibilityQualificationFixture();
 const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try{
  const now=new Date(),reviews=new EvidenceReviewService(database),verifier=await fundingPrincipal(database,fixture.credentials.verifier,"verifier");
  await authorizeReviewFixture(database,{taskId:fixture.qualificationTaskId,verifiers:[verifier],at:now});
  await reviews.claim(verifier,fixture.qualificationTaskId,now);
  await reviews.decide(verifier,fixture.qualificationTaskId,"APPROVED","Current framework qualification was verified.",now);
  assert.equal((await new WorkerAssessmentApplicationService(database).listOfferings(fixture.worker,now)).find(row=>row.catalogueVersionId===fixture.qualificationCatalogue).eligibilityStatus,"AVAILABLE","Original offering is eligible before the actual terminal producer interleaves");
  let interleaved=false,afterProducer;
  const wrapped={query:(text,values)=>database.query(text,values),transaction:async(work)=>{
   if(!interleaved){
    interleaved=true;
    const attempts=new AssessmentAttemptService(database);
    const view=await attempts.begin(fixture.worker,{caseId:fixture.second.caseId,catalogueVersionId:fixture.catalogue},now);
    assert.equal((await attempts.submitCurrentAnswer(fixture.worker,{attemptId:view.attempt.attemptId,position:1,
      questionVersionId:view.currentQuestion.questionVersionId,answer:"Stop and assess"},now)).submitted,true);
    afterProducer=(await database.query("SELECT application_id,application_status FROM worker_assessment_applications ORDER BY application_id")).rows;
   }
   return database.transaction(work);
  }};
  await assert.rejects(()=>new WorkerAssessmentApplicationService(wrapped).applyWorkerPay(fixture.worker,fixture.qualificationCatalogue,now),/attempt limit/i);
  assert.equal(interleaved,true,"The actual second terminal attempt must occur before the application transaction");
  assert.deepEqual((await database.query("SELECT application_id,application_status FROM worker_assessment_applications ORDER BY application_id")).rows,afterProducer);
  assert.equal((await database.query("SELECT COUNT(DISTINCT case_id)::int AS n FROM assessment_attempts WHERE worker_account_id=$1",[fixture.worker.accountId])).rows[0].n,2);
 }finally{await database.close();await fixture.cleanup();}
});
