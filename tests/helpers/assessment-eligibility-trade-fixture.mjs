import { createHash } from "node:crypto";

// Scanned file metadata is a schema-valid prerequisite; qualification submit/review use original services.
export async function seedEligibilityTradeEvidence(database,worker,record,now) {
 const token=record.currentVersion.versionId.slice(-24),fileId="secure_file_"+token,jobId="job_eligibility_certificate_"+token;
 const hash=createHash("sha256").update(token).digest("hex"), timestamp=now.toISOString();
 await database.query(`INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,
  enqueued_by_account_id,enqueued_by_role,status,attempt_count,max_attempts,next_attempt_at,succeeded_at,created_at,updated_at)
  VALUES($1,'secure_file.scan',1,$2,$3::jsonb,$4,'worker','succeeded',1,5,$5,$5,$5,$5)`,
  [jobId,hash,JSON.stringify({fileRef:fileId,generation:1}),worker.accountId,timestamp]);
 await database.query(`INSERT INTO platform_secure_files(file_id,schema_version,reservation_key,owner_account_id,owner_role,
  tenant_id,membership_id,storage_adapter_key,object_key,display_filename,lifecycle_status,file_extension,declared_mime,detected_mime,
  byte_size,content_sha256,quarantined_at,available_at,created_at,updated_at,scan_generation,scan_job_id,scan_result_code,scan_completed_at)
  VALUES($1,1,$2,$3,'worker',NULL,NULL,'local_test',$4,'trade.pdf','available','pdf','application/pdf','application/pdf',
  128,$2,$5,$5,$5,$5,1,$6,'clean',$5)`,
  [fileId,hash,worker.accountId,"secure-files/"+hash,timestamp,jobId]);
 await database.query(`INSERT INTO worker_evidence_attachments(attachment_id,record_id,version_id,attachment_kind,
  secure_file_id,display_filename,created_at,superseded_at) VALUES($1,$2,$3,'skill_evidence',$4,'trade.pdf',$5,NULL)`,
  ["evidence_attachment_"+token,record.recordId,record.currentVersion.versionId,fileId,timestamp]);
 return fileId;
}

import { assessmentEligibilityWaitingFixture } from "./assessment-eligibility-policy-fixture.mjs";
import { fundingPrincipal } from "./assessment-funding-fixture.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { loadWorkerRegistrationTs } from "./worker-registration-runtime-loader.mjs";
const {WorkerEvidenceService}=loadWorkerRegistrationTs("src/lib/worker-evidence/worker-evidence-service.ts");
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const {EffectivePolicyService}=loadWorkerRegistrationTs("src/lib/policy/effective-policy-service.ts");

export async function produceEligibilityTradeSkill(database,fixture,now,{relatedTrade="Electrical",approve=false,confirmTrade=false}={}) {
 const evidence=new WorkerEvidenceService(Promise.resolve(database),()=>now);
 const draft=await evidence.createDraft(fixture.worker,"skill");
 const saved=await evidence.saveSkillDraft(fixture.worker,{recordId:draft.recordId,expectedRevision:draft.currentVersion.revision,
  skillName:"Isolation safety",category:"Safety",proficiencyClaim:"Practised",experienceMonths:24,relatedTrade});
 const fileId=await seedEligibilityTradeEvidence(database,fixture.worker,saved,now);
 const submitted=await evidence.submit(fixture.worker,saved.recordId,saved.currentVersion.revision);
 const reviews=new EvidenceReviewService(database),task=await reviews.queueIndependentWorkerEvidence(fixture.worker,saved.recordId,now);
 const verifier=await fundingPrincipal(database,fixture.credentials.verifier,"verifier");
 if(approve){await reviews.claim(verifier,task.taskId,now);await reviews.decide(verifier,task.taskId,"APPROVED",
  "The exact submitted skill trade mapping was checked against its attached evidence.",now,{confirmTrade});}
 return {evidence,submitted,reviews,task,verifier,fileId};
}

export async function assessmentEligibilityTradeFixture() {
 const terminalAt=new Date(Date.now()-10000),now=new Date(terminalAt.getTime()+1000);
 const fixture=await assessmentEligibilityWaitingFixture({waitingPeriodDays:0,attemptLimit:2,terminalAt,policyEffectiveTo:now});
 const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try {
  await new EffectivePolicyService(database).publishPolicyVersion(fixture.admin,{frameworkReference:"SEARCH-WORKER",policyReference:"ELIGIBILITY-POLICY",
   title:"Explicit evidence verified trade gate",effectiveFrom:now,effectiveTo:null,
   policyValues:{pass_mark:70,assessmentEligibility:{verifiedTrades:["Electrical"]}},overrideAllowedFields:[],overrideDirections:{}},now);
  const entry="assessment_catalogue_"+createHash("sha256").update("verified-electrical-trade").digest("hex").slice(0,24);
  const catalogue="catalogue_version_"+createHash("sha256").update("verified-electrical-trade").digest("hex").slice(0,24);
  const source=(await database.query("SELECT * FROM assessment_catalogue_versions WHERE catalogue_version_id=$1",[fixture.catalogue])).rows[0];
  await database.query("INSERT INTO assessment_catalogue_entries(catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'VERIFIED-ELECTRICAL-TRADE','INACTIVE',NULL,$2,$3,$3)",[entry,fixture.admin.accountId,now.toISOString()]);
  await database.query("INSERT INTO assessment_catalogue_versions(catalogue_version_id,catalogue_entry_id,version_no,title,framework_id,blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at) VALUES($1,$2,1,'Verified electrical trade assessment',$3,$4,0,$5,$6)",[catalogue,entry,source.framework_id,source.blueprint_version_id,fixture.admin.accountId,now.toISOString()]);
  await database.query("UPDATE assessment_catalogue_entries SET current_version_id=$2,catalogue_status='ACTIVE' WHERE catalogue_entry_id=$1",[entry,catalogue]);
  const pending=await produceEligibilityTradeSkill(database,fixture,now);
  await database.close();
  return {...fixture,tradeCatalogue:catalogue,tradeTaskId:pending.task.taskId,tradeVersionId:pending.submitted.currentVersion.versionId,tradeFileId:pending.fileId};
 }catch(error){await database.close();await fixture.cleanup();throw error;}
}
