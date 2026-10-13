import { seedPublishedQuestion } from "./question-publication-fixture.mjs";
import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {reportCompanyFixture,reportAddSite,reportAddDepartment} from "./report-company-fixture.mjs";
import {seedPermanentWorkerId} from "./permanent-worker-id-fixture.mjs";
import {loadWorkerRegistrationTs,setWorkerRegistrationRuntimeEnvironment} from "./worker-registration-runtime-loader.mjs";
const {EffectivePolicyService}=loadWorkerRegistrationTs("src/lib/policy/effective-policy-service.ts");
const {StaffCalibrationService}=loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {BillingService}=loadWorkerRegistrationTs("src/lib/billing/billing-service.ts");
const {WorkerAssessmentApplicationService}=loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const {AssessmentAttemptService}=loadWorkerRegistrationTs("src/lib/assessment-attempt/assessment-attempt-service.ts");
const id=(prefix,seed)=>prefix+"_"+createHash("sha256").update(seed).digest("hex").slice(0,24);
export async function integrityAssessmentFixture(){
 const fixture=await reportCompanyFixture();await fixture.database.close();
 let databaseReleased=false;
 const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});fixture.database=database;
 try{
  const now=new Date().toISOString(),admin=fixture.credentials.admin.accountId,key=randomBytes(32).toString("hex"),
   policyValues={pass_mark:70,credentialValidityDays:7};
  setWorkerRegistrationRuntimeEnvironment({appEnvironment:"development",credentialSigningSecret:key,credentialSigningPreviousSecrets:[]});
  const siteId=await reportAddSite(fixture,"=SUM(3,4) Nórth Ж <script>"),departmentId=await reportAddDepartment(fixture,"+SUM(4,5) Équipe");
  await database.query("UPDATE company_worker_links SET site_id=$2,department_id=$3 WHERE link_id=$1",[fixture.link.linkId,siteId,departmentId]);
  const workerId=await seedPermanentWorkerId(database,fixture.credentials.worker,"r",now);
  await database.query("UPDATE company_worker_links SET payment_responsibility='company' WHERE link_id=$1",[fixture.link.linkId]);
  const adminSession="integrity-admin-"+randomUUID();
  await new AuthAccessRepository(database).authentication.insertSession({sessionId:adminSession,accountId:admin,activeRole:"admin",tokenHash:createHash("sha256").update(adminSession).digest("hex"),csrfTokenHash:createHash("sha256").update("csrf:"+adminSession).digest("hex"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
  const adminPrincipal={accountId:admin,sessionId:adminSession,activeRole:"admin",accountStatus:"active",tenantMembership:null};
  const framework=await new EffectivePolicyService(database).createFramework(adminPrincipal,{reference:"REPORT-CATALOGUE",title:"Report catalogue framework"},new Date("2000-01-01T00:00:00Z")),blueprintId=id("assessment_blueprint","report-catalogue"),blueprint=id("blueprint_version","report-catalogue");
  const revision=(await database.query("SELECT framework_version_id,effective_from FROM assurance_framework_revisions WHERE framework_id=$1 ORDER BY version_no DESC LIMIT 1",[framework])).rows[0];
  for(const account of (await database.query("SELECT account_id FROM auth_account_roles WHERE role='verifier'")).rows)await new StaffCalibrationService(Promise.resolve(database)).record(adminPrincipal,{accountId:account.account_id,role:"verifier",frameworkReference:"REPORT-CATALOGUE",frameworkVersionId:revision.framework_version_id,status:"CURRENT",validFrom:new Date(revision.effective_from),validUntil:new Date("2099-01-01T00:00:00Z"),note:"Observed exact revision benchmark for integrity review fixture."});
  await database.query("INSERT INTO assessment_blueprints(blueprint_id,blueprint_reference,blueprint_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'REPORT-CATALOGUE','INACTIVE',NULL,$2,$3,$3)",[blueprintId,admin,now]);
  await database.query("INSERT INTO assessment_blueprint_versions(blueprint_version_id,blueprint_id,version_no,framework_id,title,selectors_json,created_by_account_id,created_at) VALUES($1,$2,1,$3,'Report blueprint',$4::jsonb,$5,$6)",[blueprint,blueprintId,framework,JSON.stringify([{count:1,questionType:"MULTIPLE_CHOICE",tagsAll:[]}]),admin,now]);
  await database.query("UPDATE assessment_blueprints SET current_version_id=$2,blueprint_status='ACTIVE' WHERE blueprint_id=$1",[blueprintId,blueprint]);
    const policyId = id("policy", "report-catalogue"), policyVersionId = id("policy_version", "report-catalogue");
    await database.query("INSERT INTO assurance_policy_packs(policy_id,framework_id,policy_reference,title,policy_status,created_by_account_id,created_at,updated_at) VALUES($1,$2,'REPORT-CATALOGUE','Funding policy','ACTIVE',$3,$4,$4)", [policyId, framework, admin, now]);
    await database.query("INSERT INTO assurance_policy_versions(policy_version_id,policy_id,version_no,version_status,effective_from,policy_values,created_by_account_id,created_at) VALUES($1,$2,1,'PUBLISHED','2026-01-01T00:00:00Z',$3::jsonb,$4,$5)", [policyVersionId, policyId, JSON.stringify(policyValues), admin, now]);
    const entry = id("assessment_catalogue", "report-catalogue"), version = id("catalogue_version", "report-catalogue");
    await database.query("INSERT INTO assessment_catalogue_entries(catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'REPORT-CATALOGUE','INACTIVE',NULL,$2,$3,$3)", [entry, admin, now]);
    await database.query("INSERT INTO assessment_catalogue_versions(catalogue_version_id,catalogue_entry_id,version_no,title,description,framework_id,blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at) VALUES($1,$2,1,'Owned safety assessment','Funding workflow fixture',$3,$4,0,$5,$6)", [version, entry, framework, blueprint, admin, now]);
    await database.query("UPDATE assessment_catalogue_entries SET current_version_id=$2,catalogue_status='ACTIVE' WHERE catalogue_entry_id=$1", [entry, version]);
    const question = id("assessment_question", "report-catalogue"), questionVersion = id("question_version", "report-catalogue"), fingerprint = createHash("sha256").update("funding question").digest("hex");
    await seedPublishedQuestion(database,{questionId:question,versionId:questionVersion,reference:"REPORT-CATALOGUE-Q",questionType:"MULTIPLE_CHOICE",prompt:"private-question-prompt-marker",options:["Stop and assess","Ignore the hazard"],answerKey:"Stop and assess",frameworkId:framework,fingerprint,authorAccountId:admin,now});

  const company={...fixture.principal,authorizedTenantPermission:"company.billing.manage"},billing=new BillingService(database);
  const checkout=await billing.createCreditCheckout(company,{idempotencyKey:"report-catalogue-"+randomUUID(),creditUnits:3,amountMinor:300,currency:"USD"});
  await billing.completeSandboxCheckout(company,checkout.checkoutId);
  const applications=new WorkerAssessmentApplicationService(database);
  const funded=await applications.requestCompanyFunding(fixture.worker,{catalogueVersionId:version,tenantId:fixture.credentials.company.tenantId,workerLinkId:fixture.link.linkId},new Date());
  await applications.decideCompanyFunding(company,{fundingRequestId:funded.fundingRequestId,approved:true,now:new Date()});
  let source=(await database.query("SELECT cases.* FROM assurance_cases cases JOIN worker_assessment_applications applications ON applications.assurance_case_id=cases.case_id WHERE applications.application_id=$1",[funded.applicationId])).rows[0];
  assert.equal(source.worker_account_id,fixture.worker.accountId);
  const attempts=new AssessmentAttemptService(database),begun=await attempts.begin(fixture.worker,{caseId:source.case_id,catalogueVersionId:version},new Date());
  return {...fixture,attempts,sourceCase:source,attemptId:begun.attempt.attemptId,releaseDatabase:async()=>{await database.close();databaseReleased=true;},cleanup:async()=>{if(!databaseReleased)await database.close();await fixture.cleanup();}};
 }catch(error){await database.close();await fixture.cleanup();throw error;}
}
