import "server-only";
import {reviewerCapacity} from "../review/reviewer-capacity";
import type {DatabaseClient} from "../database/database";

export type WrittenReviewCandidate = { accountId: string; displayName: string };

// Submission and recovery use the same pinned framework, calibration and conflict rules.
export async function eligibleWrittenReviewers(database: DatabaseClient, caseId: string, attemptId: string): Promise<WrittenReviewCandidate[]> {
 const schema = await database.query(`SELECT 1 FROM information_schema.columns WHERE table_name='staff_calibrations' AND column_name='framework_version_id'`);
 if (!schema.rows[0]) return [];
 const result = await database.query<{account_id:string;display_name:string}>(`
  SELECT accounts.account_id,accounts.display_name
  FROM assurance_cases cases
  JOIN assessment_attempts attempts ON attempts.attempt_id=cases.assessment_reference AND attempts.case_id=cases.case_id AND attempts.worker_account_id=cases.worker_account_id
  JOIN assessment_blueprint_versions blueprint ON blueprint.blueprint_version_id=attempts.blueprint_version_id
  JOIN assurance_case_policy_snapshots snapshots ON snapshots.case_id=cases.case_id AND snapshots.tenant_id=cases.tenant_id AND snapshots.framework_id=blueprint.framework_id
  JOIN assurance_frameworks frameworks ON frameworks.framework_id=snapshots.framework_id AND frameworks.framework_status='ACTIVE'
  JOIN LATERAL(SELECT * FROM assurance_framework_revisions WHERE framework_id=snapshots.framework_id AND effective_from<=snapshots.reference_time ORDER BY effective_from DESC,version_no DESC LIMIT 1) revision ON TRUE
  JOIN auth_account_roles roles ON roles.role='verifier'
  JOIN auth_accounts accounts ON accounts.account_id=roles.account_id AND accounts.account_status='active' AND accounts.account_id<>cases.worker_account_id
  JOIN LATERAL(SELECT status,valid_until FROM staff_calibrations WHERE account_id=accounts.account_id AND role='verifier' AND framework_id=revision.framework_id AND framework_version_id=revision.framework_version_id AND valid_from<=clock_timestamp() ORDER BY valid_from DESC,calibration_sequence DESC LIMIT 1) calibration ON calibration.status='CURRENT' AND calibration.valid_until>clock_timestamp()
  WHERE cases.case_id=$1 AND attempts.attempt_id=$2 AND attempts.status IN ('SUBMITTED','AUTO_SUBMITTED')
    AND cases.closed_at IS NULL AND cases.case_status IN ('Assessment in progress','Review pending')
    AND NOT EXISTS(SELECT 1 FROM scoring_conflict_declarations conflicts JOIN written_score_reviews review ON review.review_id=conflicts.review_id WHERE review.case_id=cases.case_id AND review.attempt_id=attempts.attempt_id AND conflicts.reviewer_account_id=accounts.account_id)
    AND NOT EXISTS(SELECT 1 FROM evidence_review_conflicts conflicts JOIN evidence_review_tasks tasks USING(task_id) WHERE tasks.case_id=cases.case_id AND conflicts.verifier_account_id=accounts.account_id)
  ORDER BY (SELECT COUNT(*) FROM written_score_reviews WHERE reviewer_account_id=accounts.account_id AND status='DRAFT'),accounts.account_id
 `,[caseId,attemptId]);
 const eligible=[];
 for(const row of result.rows){const capacity=await reviewerCapacity(database,row.account_id);if(!capacity||capacity.open<capacity.limit)eligible.push({accountId:row.account_id,displayName:row.display_name});}
 return eligible;
}

