import "server-only";
import type {AuthorizationPrincipal} from "../authorization/authorization-context-domain";
import type {DatabaseClient} from "../database/database";

export class WrittenScoringAccessError extends Error {}

export async function requireLiveWrittenReviewer(database:DatabaseClient,actor:AuthorizationPrincipal|undefined,accountId:string):Promise<void>{
 if(!actor || actor.accountId!==accountId || actor.activeRole!=="verifier" || actor.accountStatus!=="active" || actor.tenantMembership!==null)throw new WrittenScoringAccessError("Actual written scoring actor session is required.");
 const live=await database.query(`SELECT 1 FROM auth_sessions s JOIN auth_accounts a ON a.account_id=s.account_id JOIN auth_account_roles r ON r.account_id=a.account_id AND r.role='verifier' WHERE s.session_id=$1 AND s.account_id=$2 AND s.active_role='verifier' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND a.account_status='active' FOR UPDATE OF s,a,r`,[actor.sessionId,actor.accountId]);
 if(!live.rows[0])throw new WrittenScoringAccessError("Written scoring actor session is unavailable.");
}

export async function requireWrittenAttemptEligibility(database:DatabaseClient,accountId:string,attemptId:string,caseId:string,tenantId:string):Promise<void>{
 const source=await database.query<{framework_id:string;reference_time:string|Date}>(`SELECT snapshots.framework_id,snapshots.reference_time
 FROM assurance_cases cases JOIN assessment_attempts attempts ON attempts.attempt_id=cases.assessment_reference AND attempts.case_id=cases.case_id AND attempts.worker_account_id=cases.worker_account_id
 JOIN generated_assessment_forms forms ON forms.form_id=attempts.form_id AND forms.case_id=cases.case_id AND forms.worker_account_id=cases.worker_account_id AND forms.blueprint_version_id=attempts.blueprint_version_id
 JOIN assessment_blueprint_versions blueprint ON blueprint.blueprint_version_id=attempts.blueprint_version_id
 JOIN assurance_case_policy_snapshots snapshots ON snapshots.case_id=cases.case_id AND snapshots.tenant_id=cases.tenant_id AND snapshots.framework_id=blueprint.framework_id
 WHERE cases.case_id=$1 AND cases.tenant_id=$2 AND attempts.attempt_id=$3 AND attempts.status IN ('SUBMITTED','AUTO_SUBMITTED')
 AND cases.worker_account_id<>$4 AND cases.closed_at IS NULL AND cases.case_status NOT IN ('Approved','Conditionally approved','Rejected','Closed','Suspended','Revoked','Expired')
 FOR UPDATE OF cases,attempts`,[caseId,tenantId,attemptId,accountId]);
 const row=source.rows[0];if(!row)throw new WrittenScoringAccessError("Written scoring pinned source or scope is unavailable.");
 const framework=await database.query(`SELECT 1 FROM assurance_frameworks WHERE framework_id=$1 AND framework_status='ACTIVE' FOR SHARE`,[row.framework_id]);
 if(!framework.rows[0])throw new WrittenScoringAccessError("Written scoring framework scope is unavailable.");
 const calibration=await database.query(`SELECT c.status,c.valid_until>clock_timestamp() AS unexpired FROM (SELECT * FROM assurance_framework_revisions WHERE framework_id=$2 AND effective_from<=$3 ORDER BY effective_from DESC,version_no DESC LIMIT 1) revision LEFT JOIN LATERAL
 (SELECT calibration.status,calibration.valid_until FROM staff_calibrations calibration WHERE calibration.account_id=$1 AND calibration.role='verifier' AND calibration.framework_id=revision.framework_id AND calibration.framework_version_id=revision.framework_version_id AND calibration.valid_from<=clock_timestamp() ORDER BY calibration.valid_from DESC,calibration.calibration_sequence DESC LIMIT 1)c ON TRUE
`,[accountId,row.framework_id,row.reference_time]);
 const current=calibration.rows[0] as {status:string;unexpired:boolean}|undefined;
 if(current?.status!=="CURRENT" || current.unexpired!==true)throw new WrittenScoringAccessError("Current written scoring calibration for the exact pinned framework revision is required.");
}
