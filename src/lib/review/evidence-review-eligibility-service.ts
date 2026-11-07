import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import { EvidenceReviewAccessError, EvidenceReviewConflictError } from "./evidence-review-domain";
import {qualitySchema} from "./review-quality-service";
import {reviewerCapacity} from "./reviewer-capacity";
import { latestEffectiveCalibration, requireLiveReviewActor } from "./review-calibration-authority";

export type EvidenceReviewEligibility = Readonly<{
 eligible: boolean;
 reason: "ELIGIBLE"|"FRAMEWORK_UNRESOLVED"|"FRAMEWORK_UNAVAILABLE"|"PINNED_FRAMEWORK_MISMATCH"|"CALIBRATION_MISSING"|"CALIBRATION_NOT_CURRENT"|"CONFLICT_DECLARED"|"SECOND_REVIEW_INDEPENDENCE"|"REVIEWER_CAPACITY_REACHED"|"QUALITY_SCOPE_CHANGED";
 frameworkId: string|null;
 frameworkVersionId: string|null;
 bindingId: string|null;
 calibrationId: string|null;
}>;

// Every live review consumer must call this same predicate. Finalized history is retained separately.
export class EvidenceReviewEligibilityService {
 constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}
 async evaluate(principal: AuthorizationPrincipal, taskId: string, at = new Date(), lock = false): Promise<EvidenceReviewEligibility> {
  const db=await this.databasePromise;
  await requireLiveReviewActor(db,principal,"verifier",lock);
  const task=await db.query<{case_id:string|null;tenant_id:string|null;worker_account_id:string;task_status:string;assigned_verifier_account_id:string|null}>(
   `SELECT case_id,tenant_id,worker_account_id,task_status,assigned_verifier_account_id FROM evidence_review_tasks WHERE task_id=$1 ${lock ? "FOR UPDATE" : ""}`,[taskId]);
  const row=task.rows[0];
  if(!row || row.worker_account_id===principal.accountId || (row.task_status!=="QUEUED" && row.assigned_verifier_account_id!==principal.accountId)) throw new EvidenceReviewAccessError();
  const bindings=await db.query<{binding_id:string;framework_id:string;framework_version_id:string;case_snapshot_id:string|null;effective_from:string|Date;framework_status:string}>(
   `SELECT bindings.binding_id,bindings.framework_id,bindings.framework_version_id,bindings.case_snapshot_id,revisions.effective_from,frameworks.framework_status
    FROM evidence_review_framework_bindings bindings JOIN assurance_framework_revisions revisions USING(framework_id,framework_version_id)
    JOIN assurance_frameworks frameworks USING(framework_id) WHERE bindings.task_id=$1 ORDER BY bindings.binding_sequence DESC LIMIT 1 ${lock ? "FOR SHARE OF frameworks" : ""}`,[taskId]);
  const binding=bindings.rows[0];
  const result=(reason:EvidenceReviewEligibility["reason"],calibrationId:string|null=null):EvidenceReviewEligibility=>Object.freeze({eligible:reason==="ELIGIBLE",reason,frameworkId:binding?.framework_id??null,frameworkVersionId:binding?.framework_version_id??null,bindingId:binding?.binding_id??null,calibrationId});
  if(!binding)return result("FRAMEWORK_UNRESOLVED");
  if(binding.framework_status!=="ACTIVE" || new Date(binding.effective_from)>at)return result("FRAMEWORK_UNAVAILABLE");
  if(row.case_id){
   const pinned=await db.query<{snapshot_id:string;framework_id:string;reference_time:string|Date;framework_version_id:string}>(
    `SELECT snapshots.snapshot_id,snapshots.framework_id,snapshots.reference_time,revisions.framework_version_id
     FROM assurance_case_policy_snapshots snapshots JOIN LATERAL(SELECT framework_version_id FROM assurance_framework_revisions revisions
      WHERE revisions.framework_id=snapshots.framework_id AND revisions.effective_from<=snapshots.reference_time ORDER BY revisions.effective_from DESC,revisions.version_no DESC LIMIT 1) revisions ON TRUE
     WHERE snapshots.case_id=$1 AND snapshots.tenant_id=$2`,[row.case_id,row.tenant_id]);
   const snapshot=pinned.rows[0];
   if(!snapshot)return result("PINNED_FRAMEWORK_MISMATCH");
   if(snapshot && (snapshot.framework_id!==binding.framework_id || snapshot.framework_version_id!==binding.framework_version_id || snapshot.snapshot_id!==binding.case_snapshot_id))return result("PINNED_FRAMEWORK_MISMATCH");
  }
  const conflict=await db.query(`SELECT 1 FROM evidence_review_conflicts WHERE task_id=$1 AND verifier_account_id=$2`,[taskId,principal.accountId]);
  if(conflict.rows[0])return result("CONFLICT_DECLARED");
  const calibration=await latestEffectiveCalibration(db,principal.accountId,"verifier",binding.framework_id,binding.framework_version_id,at);
  if(!calibration)return result("CALIBRATION_MISSING");
  if(calibration.status!=="CURRENT" || new Date(calibration.valid_until)<=at)return result("CALIBRATION_NOT_CURRENT",calibration.calibration_id);
  if(await qualitySchema(db)){
   const prior=await db.query("SELECT 1 FROM evidence_review_quality_rounds WHERE task_id=$1 AND verifier_account_id=$2",[taskId,principal.accountId]);
   if(prior.rows[0])return result("SECOND_REVIEW_INDEPENDENCE",calibration.calibration_id);
   const selection=(await db.query<{framework_version_id:string;policy_snapshot_id:string|null}>("SELECT framework_version_id,policy_snapshot_id FROM evidence_review_quality_selections WHERE task_id=$1",[taskId])).rows[0];
   if(selection&&(selection.framework_version_id!==binding.framework_version_id||selection.policy_snapshot_id!==binding.case_snapshot_id))return result("QUALITY_SCOPE_CHANGED",calibration.calibration_id);
   if(row.task_status==="QUEUED"){
    const capacity=await reviewerCapacity(db,principal.accountId,lock);
    if(capacity&&capacity.open>=capacity.limit)return result("REVIEWER_CAPACITY_REACHED",calibration.calibration_id);
   }
  }
  return result("ELIGIBLE",calibration.calibration_id);
 }
 async assertEligible(principal: AuthorizationPrincipal, taskId: string, at = new Date(), lock = false): Promise<EvidenceReviewEligibility> {
  const result=await this.evaluate(principal,taskId,at,lock);
  if(!result.eligible)throw new EvidenceReviewConflictError(`Framework calibration eligibility is blocked: ${result.reason}.`);
  return result;
 }
}
