import "server-only";
import type {DatabaseClient} from "../database/database";
import {latestEffectiveCalibration} from "../review/review-calibration-authority";

// Historical migration-ceiling tests predate exact revision calibration. Current
// schemas fail closed when the immutable case policy cannot resolve its revision.
export async function interviewCalibrationCurrent(db:DatabaseClient,accountId:string,requestId:string):Promise<boolean>{
 const schema=await db.query<{present:boolean}>("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='staff_calibrations' AND column_name='framework_version_id') AS present");
 if(!schema.rows[0]?.present)return true;
 const scope=(await db.query<{framework_id:string;framework_version_id:string}>(`SELECT snapshots.framework_id,revisions.framework_version_id
 FROM interview_requests requests JOIN assurance_case_policy_snapshots snapshots ON snapshots.case_id=requests.case_id AND snapshots.tenant_id=requests.tenant_id
 JOIN assurance_frameworks frameworks ON frameworks.framework_id=snapshots.framework_id AND frameworks.framework_status='ACTIVE'
 JOIN LATERAL(SELECT framework_version_id FROM assurance_framework_revisions revisions WHERE revisions.framework_id=snapshots.framework_id AND revisions.effective_from<=snapshots.reference_time ORDER BY revisions.effective_from DESC,revisions.version_no DESC LIMIT 1) revisions ON TRUE
 WHERE requests.interview_request_id=$1`,[requestId])).rows[0];
 if(!scope)return false;
 const at=new Date((await db.query<{now:string|Date}>("SELECT clock_timestamp() AS now")).rows[0].now);
 const calibration=await latestEffectiveCalibration(db,accountId,"assessor",scope.framework_id,scope.framework_version_id,at);
 return Boolean(calibration?.status==="CURRENT"&&new Date(calibration.valid_until)>at);
}
