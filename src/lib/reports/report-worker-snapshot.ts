import "server-only";
import type {DatabaseClient} from "../database/database";
import {getServerEnvironment} from "../config/server-environment";
import {PublicVerificationRepository} from "../public-verification/public-verification-repository";
import {projectPublicCredentialVerification} from "../public-verification/public-verification-domain";
import {ReportInputError} from "./report-delivery-domain";
import {resolveReportWorkerId} from "./report-owner-access";
import {REPORT_HEADERS,type WorkerReportType,type ReportFilters,type ReportRow,type ReportSourceReference} from "./report-types";
type Row=Record<string,unknown>;
export type WorkerReportSnapshot=Readonly<{headers:readonly string[];rows:readonly ReportRow[];sources:readonly ReportSourceReference[]}>;
const text=(value:unknown):string=>value==null?"":value instanceof Date?value.toISOString():String(value);
const range=(column:string)=>`($2::timestamptz IS NULL OR ${column}>=$2) AND ($3::timestamptz IS NULL OR ${column}<=$3)`;
function snapshot(kind:WorkerReportType,rows:readonly Row[]):WorkerReportSnapshot{
 if(rows.length>10000)throw new ReportInputError("Select a smaller date range for reports with more than 10,000 rows.");
 const headers=REPORT_HEADERS[kind];
 const fixed=rows.map(row=>Object.freeze(Object.fromEntries(headers.map(key=>[key,text(row[key])]))));
 if(fixed.some(row=>Object.values(row).some(value=>value.length>4096)))throw new ReportInputError("A report value exceeds the supported export size.");
 return Object.freeze({headers,rows:Object.freeze(fixed),sources:Object.freeze(rows.map(row=>Object.freeze({
  sourceType:text(row.source_type),sourceRef:text(row.source_ref),version:text(row.source_version)
 })))});
}
function labels(value:unknown):string{
 const parsed=typeof value==="string"?JSON.parse(value):value;
 if(!Array.isArray(parsed) || parsed.some(item=>typeof item!=="string"))throw new ReportInputError("Living Record labels are invalid.");
 return parsed.join("; ");
}
export async function captureWorkerReportSnapshot(database:DatabaseClient,accountId:string,kind:WorkerReportType,filters:ReportFilters,requestedAt:string):Promise<WorkerReportSnapshot>{
 const workerId=await resolveReportWorkerId(database,accountId),parameters=[accountId,filters.from,filters.to];
 if(filters.credentialId && kind!=="credential-pdf")throw new ReportInputError("Credential selection applies only to credential snapshots.");
 if(kind==="identity-verification-summary"){
  const found=await database.query<Row>(`SELECT $4::text AS "Worker ID",coalesce(identity.lifecycle_status,'Not submitted') AS "Identity status",
   identity.current_version_number AS "Identity version",versions.submitted_at AS "Submitted at",worker_ids.issued_at AS "Verified at",
   CASE WHEN identity.identity_id IS NULL THEN 'worker-account' ELSE 'worker-identity' END AS source_type,
   coalesce(identity.identity_id,accounts.account_id) AS source_ref,coalesce(identity.lock_version::text,'1') AS source_version
   FROM auth_accounts accounts LEFT JOIN worker_identities identity ON identity.worker_account_id=accounts.account_id
   LEFT JOIN worker_identity_versions versions ON versions.identity_id=identity.identity_id AND versions.version_number=identity.current_version_number
   LEFT JOIN worker_identity_worker_ids worker_ids ON worker_ids.worker_account_id=accounts.account_id AND worker_ids.identity_id=identity.identity_id
   WHERE accounts.account_id=$1 AND ${range("coalesce(versions.submitted_at,identity.created_at,accounts.created_at)")}`,[...parameters,workerId]);
  return snapshot(kind,found.rows);
 }
 if(kind==="qualification"){
  const found=await database.query<Row>(`SELECT records.record_id AS "Evidence ID",versions.version_number AS "Version",
   qualification.qualification_title AS "Title",qualification.qualification_level AS "Level",qualification.issuing_organization AS "Institution",
   qualification.issue_date AS "Awarded date",versions.version_status||
    CASE WHEN review.outcome IS NOT NULL THEN ' / '||review.outcome
     WHEN review.task_status IN ('QUEUED','ASSIGNED') THEN ' / Pending review' ELSE '' END AS "Status",'qualification-evidence' AS source_type,
   records.record_id AS source_ref,versions.version_number::text||':'||versions.revision::text||':'||coalesce(review.decision_id,review.task_id,'unreviewed') AS source_version
   FROM worker_evidence_records records JOIN worker_evidence_versions versions
    ON versions.version_id=records.current_version_id AND versions.record_id=records.record_id
   JOIN worker_qualification_versions qualification ON qualification.version_id=versions.version_id
   LEFT JOIN LATERAL (SELECT tasks.task_id,tasks.task_status,decisions.decision_id,decisions.outcome
    FROM evidence_review_tasks tasks LEFT JOIN evidence_review_decisions decisions
     ON decisions.task_id=tasks.task_id AND decisions.source_version_id=versions.version_id AND decisions.outcome=tasks.task_status
    WHERE tasks.worker_account_id=records.worker_account_id AND tasks.evidence_kind='qualification'
     AND tasks.source_record_id=records.record_id AND tasks.source_version_id=versions.version_id
     AND tasks.task_status IN ('QUEUED','ASSIGNED','APPROVED','REJECTED','CHANGES_REQUESTED')
    ORDER BY coalesce(decisions.decided_at,tasks.updated_at) DESC,tasks.task_id DESC LIMIT 1) review ON TRUE
   WHERE records.worker_account_id=$1 AND records.record_kind='qualification' AND ${range("versions.created_at")}
   ORDER BY records.record_id LIMIT 10001`,parameters);
  return snapshot(kind,found.rows);
 }
 if(kind==="assessment-breakdown"){
  const found=await database.query<Row>(`SELECT cases.case_id AS "Case ID",attempts.attempt_id AS "Attempt ID",catalogue.title AS "Assessment",
   attempts.status AS "Status",attempts.question_count AS "Question count",attempts.submitted_at AS "Submitted at",
   final.score AS "Final score",final.decision AS "Final decision",'assessment-attempt' AS source_type,
   attempts.attempt_id AS source_ref,coalesce(final.review_id,attempts.updated_at::text) AS source_version
   FROM assessment_attempts attempts JOIN assurance_cases cases ON cases.case_id=attempts.case_id AND cases.worker_account_id=attempts.worker_account_id
   JOIN assessment_catalogue_versions catalogue ON catalogue.catalogue_version_id=attempts.catalogue_version_id
   LEFT JOIN LATERAL (SELECT reviews.score,reviews.decision,reviews.review_id FROM written_score_reviews reviews
    WHERE reviews.case_id=cases.case_id AND reviews.tenant_id=cases.tenant_id AND reviews.attempt_id=attempts.attempt_id AND reviews.status='FINAL'
    ORDER BY reviews.created_at DESC,reviews.review_id DESC LIMIT 1) final ON TRUE
   WHERE attempts.worker_account_id=$1 AND ${range("attempts.started_at")} ORDER BY cases.case_id,attempts.attempt_id LIMIT 10001`,parameters);
  return snapshot(kind,found.rows);
 }
 if(kind==="interview-summary"){
  const found=await database.query<Row>(`SELECT cases.case_id AS "Case ID",requests.interview_request_id AS "Interview ID",requests.status AS "Status",
   requests.scheduled_at AS "Scheduled at",CASE WHEN requests.status='COMPLETED' AND final.recommendation IN
    ('PASS','CONDITIONAL_PASS','ADDITIONAL_EVIDENCE_REQUIRED','REASSESSMENT_REQUIRED','SECOND_INTERVIEW_REQUIRED','FAIL')
    THEN final.recommendation ELSE NULL END AS "Final recommendation",'interview' AS source_type,
   requests.interview_request_id AS source_ref,coalesce(final.updated_at,requests.requested_at) AS source_version
   FROM interview_requests requests JOIN assurance_cases cases ON cases.case_id=requests.case_id AND cases.tenant_id=requests.tenant_id
    AND cases.worker_account_id=requests.worker_account_id
   LEFT JOIN LATERAL (SELECT drafts.recommendation,drafts.updated_at FROM interview_console_drafts drafts
    WHERE drafts.interview_request_id=requests.interview_request_id AND drafts.tenant_id=requests.tenant_id AND drafts.submitted=TRUE
    ORDER BY drafts.updated_at DESC,drafts.interview_session_id DESC LIMIT 1) final ON TRUE
   WHERE requests.worker_account_id=$1 AND ${range("requests.requested_at")} ORDER BY requests.interview_request_id LIMIT 10001`,parameters);
  return snapshot(kind,found.rows);
 }
 if(kind==="credential-pdf"){
  const found=await database.query<Row>(`SELECT credentials.credential_id,credentials.worker_id,credentials.version
   FROM credential_issuances credentials WHERE $1::text IS NOT NULL AND credentials.worker_id=$4 AND ($5::text IS NULL OR credentials.credential_id=$5)
    AND ${range("credentials.issued_at")} ORDER BY credentials.credential_id LIMIT 10001`,[...parameters,workerId,filters.credentialId]);
  if(filters.credentialId && found.rows.length!==1)throw new ReportInputError("The selected credential is not owned by this Worker.");
  if(found.rows.length>10000)throw new ReportInputError("Select a smaller credential date range.");
  const env=getServerEnvironment(),keys=[env.credentialSigningSecret,...(env.credentialSigningPreviousSecrets??[])].filter((key):key is string=>typeof key==="string" && key.length>0);
  const repository=new PublicVerificationRepository(database),rows:Row[]=[];
  for(const row of found.rows){
   const source=await repository.findPublicCredentialById(text(row.credential_id),keys);
   if(!source)throw new ReportInputError("A credential cannot be authenticated for this report.");
   const current=projectPublicCredentialVerification(source,requestedAt);
   rows.push({"Credential ID":source.credentialId,"Worker ID":workerId,"Qualification":source.qualification,
    "Issued at":current.issuedAt,"Expires at":current.expiresAt,"Status":current.status,"Authentication":source.authentication,
    source_type:"credential",source_ref:source.credentialId,source_version:text(row.version)});
  }
  return snapshot(kind,rows);
 }
 if(kind==="living-record-history"){
  const found=await database.query<Row>(`SELECT competency.competency_id AS "Competency ID",competency.title AS "Title",
   competency.source_credential_id AS "Source credential",versions.version AS "Version",versions.status AS "Status",
   versions.effective_at AS "Effective from",versions.expires_at AS "Expires at",versions.restrictions,versions.conditions,
   'living-record-version' AS source_type,competency.competency_id AS source_ref,versions.version AS source_version
   FROM living_record_competencies competency JOIN living_record_versions versions ON versions.competency_id=competency.competency_id
   WHERE $1::text IS NOT NULL AND competency.worker_id=$4 AND ${range("versions.effective_at")} ORDER BY competency.competency_id,versions.version LIMIT 10001`,[...parameters,workerId]);
  return snapshot(kind,found.rows.map(row=>({...row,"Restrictions":labels(row.restrictions),"Conditions":labels(row.conditions)})));
 }
 const found=await database.query<Row>(`SELECT 'Appeal' AS "Event type",appeals.appeal_id AS "Reference",appeals.credential_id AS "Credential ID",
  events.status AS "Status",events.version::text AS "Version",events.changed_at AS "Recorded at",coalesce(events.outcome_action,'') AS "Outcome",
  'credential-appeal' AS source_type,appeals.appeal_id AS source_ref,events.version::text AS source_version
  FROM credential_appeals appeals JOIN credential_appeal_events events ON events.appeal_id=appeals.appeal_id
  JOIN credential_issuances credentials ON credentials.credential_id=appeals.credential_id AND credentials.worker_id=appeals.worker_id
  WHERE appeals.worker_id=$4 AND ${range("events.changed_at")}
 UNION ALL SELECT 'Reassessment case',cases.case_id,coalesce(cases.credential_reference,''),cases.case_status,cases.updated_at::text,
  cases.updated_at,''::text,'assurance-case',cases.case_id,cases.updated_at::text FROM assurance_cases cases
  WHERE cases.worker_account_id=$1 AND cases.case_status='Reassessment required' AND ${range("cases.updated_at")}
 ORDER BY "Recorded at","Reference","Version" LIMIT 10001`,[...parameters,workerId]);
 return snapshot(kind,found.rows);
}
