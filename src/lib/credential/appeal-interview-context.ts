import "server-only";
import type {DatabaseClient} from "../database/database";
export type AppealInterviewContext={kind:"credential"|"case";appeal_id:string;appeal_version:number;followup_request_id:string;interview_request_id:string;case_id:string;tenant_id:string;worker_account_id:string};
const lineage=`WITH RECURSIVE lineage AS (SELECT interview_request_id,replaces_interview_request_id FROM interview_requests WHERE interview_request_id=$1 UNION SELECT parent.interview_request_id,parent.replaces_interview_request_id FROM interview_requests parent JOIN lineage child ON child.replaces_interview_request_id=parent.interview_request_id)`;
export async function isAppealInterviewLinked(database:DatabaseClient,requestId:string):Promise<boolean>{
 if(!(await database.query<{relation:string|null}>("SELECT to_regclass('credential_appeal_followup_events') AS relation")).rows[0]?.relation)return false;
 const original=Boolean((await database.query(lineage+" SELECT 1 FROM credential_appeal_followup_events event WHERE event.event_type='requested' AND event.kind='interview' AND event.interview_request_id IN(SELECT interview_request_id FROM lineage) LIMIT 1",[requestId])).rows[0]);
 if(original)return true;
 if(!(await database.query<{relation:string|null}>("SELECT to_regclass('assurance_case_appeal_interview_requests') AS relation")).rows[0]?.relation)return false;
 return Boolean((await database.query(lineage+" SELECT 1 FROM assurance_case_appeal_interview_requests request WHERE request.interview_request_id IN(SELECT interview_request_id FROM lineage) LIMIT 1",[requestId])).rows[0]);
}
// A pending appeal followup is a separate authority; the issued case is never reopened.
// Callers retain their ordinary live participant, assignment and calibration checks.
export async function findAppealInterviewContext(database:DatabaseClient,requestId:string,lock=false):Promise<AppealInterviewContext|null>{
 if(!(await database.query<{relation:string|null}>("SELECT to_regclass('credential_appeal_followup_events') AS relation")).rows[0]?.relation)return null;
 const result=await database.query<AppealInterviewContext>(lineage+` SELECT appeal.appeal_id,appeal.version AS appeal_version,followup.event_id AS followup_request_id,requests.interview_request_id,cases.case_id,cases.tenant_id,cases.worker_account_id
  FROM interview_requests requests JOIN credential_appeal_followup_events followup ON followup.interview_request_id IN(SELECT interview_request_id FROM lineage) AND followup.event_type='requested' AND followup.kind='interview'
  JOIN credential_appeals appeal ON appeal.appeal_id=followup.appeal_id AND appeal.status='under_review' AND appeal.version>=followup.appeal_version
  JOIN credential_issuances credential ON credential.credential_id=appeal.credential_id AND credential.worker_id=appeal.worker_id
  JOIN assurance_cases cases ON cases.credential_reference=credential.credential_id AND cases.permanent_worker_id=credential.worker_id AND cases.case_id=requests.case_id AND cases.tenant_id=requests.tenant_id AND cases.worker_account_id=requests.worker_account_id
  WHERE requests.interview_request_id=$1 AND NOT EXISTS(SELECT 1 FROM interview_requests successor WHERE successor.replaces_interview_request_id=requests.interview_request_id) AND NOT EXISTS(SELECT 1 FROM credential_appeal_followup_events response WHERE response.request_id=followup.event_id)
  ${lock?"FOR UPDATE OF appeal,followup":""}`,[requestId]);
 if(result.rows.length===1)return {...result.rows[0],kind:"credential"};
 if(!(await database.query<{relation:string|null}>("SELECT to_regclass('assurance_case_appeal_interview_requests') AS relation")).rows[0]?.relation)return null;
 const second=await database.query<Omit<AppealInterviewContext,"kind">>(lineage+` SELECT appeal.appeal_id,appeal.version AS appeal_version,link.interview_request_id AS followup_request_id,
  interview.interview_request_id,source.case_id,source.tenant_id,source.worker_account_id
  FROM interview_requests interview JOIN assurance_case_appeal_interview_requests link ON
    link.interview_request_id IN(SELECT interview_request_id FROM lineage)
  JOIN assurance_case_appeals appeal ON appeal.appeal_id=link.appeal_id AND appeal.status='under_review'
  AND appeal.version>=link.appeal_version AND appeal.reviewer_account_id=link.requested_by_account_id
  JOIN assurance_cases source ON source.case_id=appeal.case_id AND source.tenant_id=appeal.tenant_id
    AND source.worker_account_id=appeal.worker_account_id
  JOIN platform_decisions decision ON decision.decision_id=appeal.decision_id
    AND decision.case_id=source.case_id AND decision.tenant_id=source.tenant_id
  WHERE interview.interview_request_id=$1 AND interview.case_id=source.case_id AND interview.tenant_id=source.tenant_id
    AND interview.worker_account_id=source.worker_account_id
    AND source.case_status='Rejected' AND source.decision_reference=appeal.decision_id
    AND source.credential_reference IS NULL AND decision.state='REJECTED'
    AND NOT EXISTS(SELECT 1 FROM interview_requests successor WHERE successor.replaces_interview_request_id=interview.interview_request_id)
    AND NOT EXISTS(SELECT 1 FROM assurance_case_appeal_interview_outcomes result
      WHERE result.interview_request_id=link.interview_request_id)
    ${lock?"FOR UPDATE OF appeal,link":""}`,[requestId]);
 return second.rows.length===1?{...second.rows[0],kind:"case"}:null;
}
