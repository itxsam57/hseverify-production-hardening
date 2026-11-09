import {createHash} from "node:crypto";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {assessmentEligibilityWaitingFixture} from "./assessment-eligibility-policy-fixture.mjs";
import {seedEligibilityCertificate} from "./assessment-eligibility-certificate-fixture.mjs";
import {loadWorkerRegistrationTs} from "./worker-registration-runtime-loader.mjs";
const {EffectivePolicyService}=loadWorkerRegistrationTs("src/lib/policy/effective-policy-service.ts");
const {WorkerEvidenceService}=loadWorkerRegistrationTs("src/lib/worker-evidence/worker-evidence-service.ts");
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const id=(prefix,seed)=>prefix+"_"+createHash("sha256").update(seed).digest("hex").slice(0,24);
export async function assessmentEligibilityQualificationFixture(){
 const terminalAt=new Date(),cutoff=new Date(terminalAt.getTime()+1000);
 const fixture=await assessmentEligibilityWaitingFixture({waitingPeriodDays:0,attemptLimit:2,terminalAt,policyEffectiveTo:cutoff});
 const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 let complete=false;
 try{
  const now=cutoff;
  await new EffectivePolicyService(database).publishPolicyVersion(fixture.admin,{frameworkReference:"SEARCH-WORKER",policyReference:"ELIGIBILITY-POLICY",title:"Verified trade framework requirements",
   effectiveFrom:now,effectiveTo:null,policyValues:{pass_mark:70,assessmentWaitingPeriodDays:0,assessmentAttemptLimit:2,
    assessmentEligibility:{qualificationCategories:["safety"],qualificationTitles:["Trade Safety Certificate"]}},overrideAllowedFields:[],overrideDirections:{}},now);
  const source=(await database.query("SELECT * FROM assessment_catalogue_versions WHERE catalogue_version_id=$1",[fixture.catalogue])).rows[0];
  const entry=id("assessment_catalogue","eligibility-verified-trade"),catalogue=id("catalogue_version","eligibility-verified-trade");
  await database.query("INSERT INTO assessment_catalogue_entries(catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'ELIGIBILITY-VERIFIED-TRADE','INACTIVE',NULL,$2,$3,$3)",[entry,fixture.admin.accountId,now.toISOString()]);
  await database.query("INSERT INTO assessment_catalogue_versions(catalogue_version_id,catalogue_entry_id,version_no,title,framework_id,blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at) VALUES($1,$2,1,'Verified trade assessment',$3,$4,0,$5,$6)",[catalogue,entry,source.framework_id,source.blueprint_version_id,fixture.admin.accountId,now.toISOString()]);
  await database.query("UPDATE assessment_catalogue_entries SET current_version_id=$2,catalogue_status='ACTIVE' WHERE catalogue_entry_id=$1",[entry,catalogue]);
  const evidence=new WorkerEvidenceService(Promise.resolve(database),()=>now),draft=await evidence.createDraft(fixture.worker,"qualification");
  const saved=await evidence.saveQualificationDraft(fixture.worker,{recordId:draft.recordId,expectedRevision:draft.currentVersion.revision,
   title:"Trade Safety Certificate",category:"safety",issuingOrganization:"Verified issuer",learningProvider:null,
   certificateNumber:draft.recordId,issueDate:"2020-01-01",expiryDate:null,level:"Certificate",country:"Pakistan",verificationUrl:null,declarationAccepted:true});
  await seedEligibilityCertificate(database,fixture.worker,saved,now);
  await evidence.submit(fixture.worker,draft.recordId,saved.currentVersion.revision);
  const review=await new EvidenceReviewService(database).queueIndependentWorkerEvidence(fixture.worker,draft.recordId,now);
  complete=true;
  return {...fixture,qualificationCatalogue:catalogue,qualificationTaskId:review.taskId};
 }finally{await database.close();if(!complete)await fixture.cleanup();}
}
