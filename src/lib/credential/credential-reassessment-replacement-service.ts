import "server-only";
import { createIdentifier } from "../auth/auth-domain";
import type { DatabaseClient } from "../database/database";
import type { DecisionRecord } from "../decision/decision-engine-domain";
import { resolveAssessmentReassessmentSource } from "../assessment-catalogue/assessment-reassessment-source-service";
import { appendLivingCompetencyVersion, currentLivingCompetencyVersion } from "../living-record/living-record-domain";
import { LivingRecordRepository } from "../living-record/living-record-repository";
import { credentialAuthentication } from "./credential-issuance-domain";
import { CredentialIssuanceRepository } from "./credential-issuance-repository";
import { derivePinnedCredentialValidity } from "./credential-validity-domain";

export async function finalizeExplicitReassessmentReplacement(database:DatabaseClient,decision:DecisionRecord,
 actorAccountId:string,credentialId:string,authenticationKeys:readonly string[]) {
 // Old migration ceilings and independent applications remain compatible.
 const available=await database.query<{present:boolean}>("SELECT to_regclass('public.worker_assessment_reassessment_sources') IS NOT NULL AS present");
 if(!available.rows[0]?.present)return;
 const associations=await database.query<{
  application_id:string;source_appeal_id:string;source_appeal_version:number;source_case_id:string;source_tenant_id:string;
  source_framework_id:string;source_credential_id:string;source_decision_id:string;worker_account_id:string;
  permanent_worker_id:string;worker_link_id:string;application_status:string;
 }>(`SELECT source.*,application.application_status
   FROM worker_assessment_reassessment_sources source JOIN worker_assessment_applications application USING(application_id)
   WHERE application.assurance_case_id=$1 FOR UPDATE OF application`,[decision.caseId]);
 if(!associations.rows.length)return;
 if(associations.rows.length!==1)throw new Error("Reassessment replacement association is ambiguous.");
 const source=associations.rows[0];
 if(source.application_status!=="CASE_CREATED" || source.source_tenant_id!==decision.tenantId ||
    source.worker_account_id===actorAccountId)throw new Error("Reassessment requires independent review in the original tenant boundary.");
 const current=await resolveAssessmentReassessmentSource(database,{
  sourceAppealId:source.source_appeal_id,sourceAppealVersion:Number(source.source_appeal_version),
  workerAccountId:source.worker_account_id,permanentWorkerId:source.permanent_worker_id,
  frameworkId:source.source_framework_id,workerLinkId:source.worker_link_id,lock:true
 });
 if(current.sourceCaseId!==source.source_case_id || current.credentialId!==source.source_credential_id ||
    current.decisionId!==source.source_decision_id || current.tenantId!==source.source_tenant_id)
  throw new Error("Reassessment source provenance changed.");
 const pins=await database.query<{snapshot_id:string;tenant_id:string;framework_id:string;global_policy_version_id:string;effective_value_json:unknown}>(
  "SELECT snapshot_id,tenant_id,framework_id,global_policy_version_id,effective_value_json FROM assurance_case_policy_snapshots WHERE case_id=$1",[decision.caseId]);
 const pin=pins.rows[0];
 if(!pin || pin.tenant_id!==decision.tenantId || pin.framework_id!==source.source_framework_id ||
    derivePinnedCredentialValidity({snapshotId:pin.snapshot_id,policyVersionId:pin.global_policy_version_id,effectiveValue:pin.effective_value_json},decision.createdAt).validity.mode==="unspecified")
  throw new Error("Reassessment replacement requires configured pinned credential validity.");
 const credentials=new CredentialIssuanceRepository(Promise.resolve(database));
 const original=await credentials.findPublic(source.source_credential_id),replacement=await credentials.findPublic(credentialId);
 if(!original || !replacement || original.workerId!==source.permanent_worker_id ||
    replacement.workerId!==source.permanent_worker_id || original.status==="revoked" ||
    credentialAuthentication(original,authenticationKeys)!=="authenticated" ||
    credentialAuthentication(replacement,authenticationKeys)!=="authenticated")
  throw new Error("Reassessment replacement issuance authentication or ownership is invalid.");
 await database.query(`INSERT INTO credential_replacements(replacement_id,appeal_id,tenant_id,worker_id,
   old_case_id,new_case_id,old_decision_id,new_decision_id,old_credential_id,new_credential_id,
   policy_snapshot_id,reason,actor_account_id,replaced_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
  [createIdentifier("credential_replacement"),source.source_appeal_id,decision.tenantId,source.permanent_worker_id,
   source.source_case_id,decision.caseId,source.source_decision_id,decision.decisionId,
   original.credentialId,replacement.credentialId,pin.snapshot_id,decision.reason.explanation,actorAccountId,decision.createdAt]);
 if(!await credentials.updateStatus(original.credentialId,"revoked",original.version,original.status,decision.createdAt))
  throw new Error("Reassessment replacement lifecycle conflict.");
 const living=new LivingRecordRepository(Promise.resolve(database));
 for(const record of await living.findByCredential(original.credentialId)){
  const previous=currentLivingCompetencyVersion(record);
  await living.replaceCompetencyRecord(original.workerId,appendLivingCompetencyVersion(record,{
   ...previous,status:"revoked",effectiveAt:decision.createdAt,
   restrictions:[...previous.restrictions,"This issuance has been replaced. Verify the current credential shared by the Worker."],
   reassessment:{required:false,dueAt:null,reason:null}
  }));
 }
}
