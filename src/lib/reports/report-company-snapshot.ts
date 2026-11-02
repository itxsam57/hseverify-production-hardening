import "server-only";
import {getServerEnvironment} from "../config/server-environment";
import {PublicVerificationRepository} from "../public-verification/public-verification-repository";
import {projectPublicCredentialVerification} from "../public-verification/public-verification-domain";
import type {DatabaseClient} from "../database/database";
import {ReportInputError,type ReportScope} from "./report-delivery-domain";
import {REPORT_HEADERS,type CompanyReportType,type ReportFilters,type ReportRow,type ReportSourceReference} from "./report-types";
export type ReportSnapshot=Readonly<{headers:readonly string[];rows:readonly ReportRow[];sources:readonly ReportSourceReference[]}>;
type Row=Record<string,unknown>;
function cell(value:unknown):string {
 if(value==null)return "";
 if(value instanceof Date)return value.toISOString();
 return String(value);
}
function result(kind:CompanyReportType,rows:readonly Row[]):ReportSnapshot {
 if(rows.length>10000)throw new ReportInputError("Select a smaller scope or date range for reports with more than 10,000 rows.");
 const headers=REPORT_HEADERS[kind];
 return Object.freeze({headers,rows:Object.freeze(rows.map(row=>Object.freeze(Object.fromEntries(headers.map(key=>[key,cell(row[key])]))))),
  sources:Object.freeze(rows.map(row=>Object.freeze({sourceType:cell(row.source_type),sourceRef:cell(row.source_ref),version:cell(row.source_version)})))});
}
const CASES=`WITH scoped_links AS (
 SELECT links.link_id,links.tenant_id,links.worker_account_id,links.permanent_worker_id,links.site_id,links.department_id,
  coalesce(worker_ids.permanent_worker_id,CASE WHEN NOT EXISTS (SELECT 1 FROM worker_identity_worker_ids others
    WHERE others.permanent_worker_id=accounts.worker_reference AND others.worker_account_id<>links.worker_account_id)
    THEN accounts.worker_reference END,links.link_id) AS worker_id
 FROM company_worker_links links JOIN auth_accounts accounts ON accounts.account_id=links.worker_account_id
 LEFT JOIN worker_identity_worker_ids worker_ids ON worker_ids.worker_account_id=links.worker_account_id
 WHERE links.tenant_id=$1
 AND ($2::text IS NULL OR links.site_id=$2) AND ($3::text IS NULL OR links.department_id=$3)
), scoped_cases AS (
 SELECT cases.case_id,cases.order_id,cases.target_id,cases.tenant_id,cases.worker_link_id,cases.worker_account_id,cases.permanent_worker_id,
  cases.case_status,cases.credential_reference,cases.created_at,cases.updated_at,links.worker_id,
  coalesce(targets.site_id,orders.site_id,links.site_id) AS case_site_id,
  coalesce(targets.department_id,orders.department_id,links.department_id) AS case_department_id,
  orders.credential_target,orders.assessment_framework_references,orders.scope_version
 FROM assurance_cases cases JOIN scoped_links links
  ON links.tenant_id=cases.tenant_id AND links.link_id=cases.worker_link_id AND links.worker_account_id=cases.worker_account_id
 JOIN assurance_orders orders ON orders.order_id=cases.order_id AND orders.tenant_id=cases.tenant_id AND orders.order_status<>'CANCELLED'
 JOIN assurance_order_workers targets ON targets.target_id=cases.target_id AND targets.order_id=cases.order_id
  AND targets.tenant_id=cases.tenant_id AND targets.worker_link_id=cases.worker_link_id AND targets.worker_account_id=cases.worker_account_id
 WHERE cases.tenant_id=$1
  AND ($2::text IS NULL OR coalesce(targets.site_id,orders.site_id,links.site_id)=$2)
  AND ($3::text IS NULL OR coalesce(targets.department_id,orders.department_id,links.department_id)=$3)
)`;
const dates=(column:string)=>`($4::timestamptz IS NULL OR ${column}>=$4) AND ($5::timestamptz IS NULL OR ${column}<=$5)`;
export async function captureCompanyReportSnapshot(
 database:DatabaseClient,tenantId:string,scope:ReportScope,kind:CompanyReportType,filters:ReportFilters,requestedAt:string
):Promise<ReportSnapshot>{
 const parameters=[tenantId,scope.siteId,scope.departmentId,filters.from,filters.to];
 if(kind==="workforce-status"){
  const found=await database.query<Row>(`SELECT coalesce(worker_ids.permanent_worker_id,CASE WHEN NOT EXISTS (SELECT 1 FROM worker_identity_worker_ids others
    WHERE others.permanent_worker_id=accounts.worker_reference AND others.worker_account_id<>links.worker_account_id)
    THEN accounts.worker_reference END,links.link_id) AS "Worker ID",
    links.link_id AS "Worker link",links.link_status AS "Worker status",links.site_id AS "Site ID",links.department_id AS "Department ID",
    coalesce(current_case.case_status,'No Company case') AS "Company case status",
    'company-worker-link' AS source_type,links.link_id AS source_ref,links.updated_at AS source_version
   FROM company_worker_links links JOIN auth_accounts accounts ON accounts.account_id=links.worker_account_id
   LEFT JOIN worker_identity_worker_ids worker_ids ON worker_ids.worker_account_id=links.worker_account_id
   LEFT JOIN LATERAL (
    SELECT cases.case_status FROM assurance_cases cases WHERE cases.tenant_id=links.tenant_id AND cases.worker_link_id=links.link_id
     AND cases.worker_account_id=links.worker_account_id ORDER BY cases.updated_at DESC,cases.case_id DESC LIMIT 1
   ) current_case ON TRUE WHERE links.tenant_id=$1
    AND ($2::text IS NULL OR links.site_id=$2) AND ($3::text IS NULL OR links.department_id=$3)
    AND ${dates("links.created_at")} ORDER BY links.link_id LIMIT 10001`,parameters);
  return result(kind,found.rows);
 }
 if(kind==="site-department-readiness"){
  const found=await database.query<Row>(CASES+` SELECT 'Site' AS scope_kind,sites.site_id AS scope_id,sites.name AS scope_name,
    cases.case_id,cases.case_status,cases.updated_at FROM company_sites sites
   LEFT JOIN scoped_cases cases ON cases.case_site_id=sites.site_id AND cases.case_status<>'Closed' AND ${dates("cases.created_at")}
   WHERE sites.tenant_id=$1 AND sites.site_status='active' AND ($2::text IS NULL OR sites.site_id=$2)
    AND ($3::text IS NULL OR cases.case_department_id=$3)
   UNION ALL
   SELECT 'Department',departments.department_id,departments.name,cases.case_id,cases.case_status,cases.updated_at
   FROM company_departments departments LEFT JOIN scoped_cases cases ON cases.case_department_id=departments.department_id
    AND cases.case_status<>'Closed' AND ${dates("cases.created_at")}
   WHERE departments.tenant_id=$1 AND departments.department_status='active' AND ($3::text IS NULL OR departments.department_id=$3)
    AND ($2::text IS NULL OR cases.case_site_id=$2)
   ORDER BY scope_kind DESC,scope_id,case_id LIMIT 10001`,parameters);
  if(found.rows.length>10000)throw new ReportInputError("Select a smaller readiness scope or date range.");
  const groups=new Map<string,{row:Row;total:number;assured:number;conditional:number;attention:number;progress:number}>();
  const sources:ReportSourceReference[]=[];
  for(const row of found.rows){
   const key=cell(row.scope_kind)+":"+cell(row.scope_id);
   let group=groups.get(key);
   if(!group){group={row,total:0,assured:0,conditional:0,attention:0,progress:0};groups.set(key,group);}
   if(row.case_id){
    group.total++;
    const status=cell(row.case_status);
    if(status==="Approved" || status==="Conditionally approved"){group.assured++;if(status==="Conditionally approved")group.conditional++;}
    else if(["Reassessment required","Rejected","Suspended"].includes(status))group.attention++;else group.progress++;
    sources.push({sourceType:"assurance-case",sourceRef:cell(row.case_id),version:cell(row.updated_at)});
   }
  }
  const rows=[...groups.values()].map(group=>Object.freeze({
   "Scope":cell(group.row.scope_kind),"Scope ID":cell(group.row.scope_id),"Scope name":cell(group.row.scope_name),
   "Cases":String(group.total),"Assured":String(group.assured),"Conditional":String(group.conditional),"Attention":String(group.attention),
   "In progress":String(group.progress),"Readiness %":String(group.total?Math.round(group.assured/group.total*100):0)
  }));
  return Object.freeze({headers:REPORT_HEADERS[kind],rows:Object.freeze(rows),sources:Object.freeze(sources)});
 }
 if(kind==="competency-gaps"){
  const found=await database.query<Row>(CASES+` SELECT cases.case_id AS "Case ID",cases.worker_id AS "Worker ID",
   cases.worker_link_id AS "Worker link",coalesce(cases.credential_target,frameworks.reference,'No competency target recorded') AS "Competency target",
   cases.case_status AS "Case status",CASE WHEN cases.credential_target IS NULL AND frameworks.reference IS NULL THEN 'Target not defined'
    ELSE 'Needs assurance' END AS "Gap",'assurance-case' AS source_type,cases.case_id AS source_ref,cases.updated_at AS source_version
   FROM scoped_cases cases LEFT JOIN LATERAL jsonb_array_elements_text(cases.assessment_framework_references) frameworks(reference) ON TRUE
   WHERE cases.case_status NOT IN ('Approved','Conditionally approved','Closed') AND ${dates("cases.created_at")}
   ORDER BY cases.case_id,frameworks.reference LIMIT 10001`,parameters);
  return result(kind,found.rows);
 }
 if(kind==="expiring-credentials"){
  const cutoff=new Date(Date.parse(requestedAt)+filters.expiryDays*86400000).toISOString();
  const found=await database.query<Row>(CASES+` SELECT DISTINCT credentials.credential_id AS "Credential ID",
   credentials.worker_id AS "Worker ID",credentials.qualification AS "Qualification",credentials.issued_at AS "Issued at",
   credentials.expires_at AS "Expires at",credentials.status AS "Status",'credential' AS source_type,
   credentials.credential_id AS source_ref,credentials.version AS source_version
   FROM scoped_cases cases JOIN credential_issuances credentials ON credentials.credential_id=cases.credential_reference
    AND credentials.worker_id=cases.worker_id
   WHERE credentials.expires_at IS NOT NULL AND credentials.expires_at>=$6 AND credentials.expires_at<=$7
    AND credentials.status='valid' AND ${dates("credentials.expires_at")}
   ORDER BY "Expires at","Credential ID" LIMIT 10001`,[...parameters,requestedAt,cutoff]);
  if(found.rows.length>10000)throw new ReportInputError("Select a smaller credential date range.");
  const environment=getServerEnvironment(),keys=[environment.credentialSigningSecret,...(environment.credentialSigningPreviousSecrets??[])]
   .filter((key):key is string=>typeof key==="string" && key.length>0);
  const repository=new PublicVerificationRepository(database),rows:Row[]=[];
  for(const row of found.rows){
   const source=await repository.findPublicCredentialById(cell(row["Credential ID"]),keys);
   if(!source || source.authentication!=="authenticated")throw new ReportInputError("A credential cannot be authenticated for this report.");
   const current=projectPublicCredentialVerification(source,requestedAt);
   if(current.status!=="valid")continue;
   rows.push({...row,"Qualification":source.qualification,"Issued at":current.issuedAt,"Expires at":current.expiresAt,"Status":current.status});
  }
  return result(kind,rows);
 }
 if(kind==="assessment-completion"){
  const found=await database.query<Row>(CASES+` SELECT cases.case_id AS "Case ID",cases.worker_id AS "Worker ID",
   cases.worker_link_id AS "Worker link",attempts.attempt_id AS "Attempt ID",
   coalesce(catalogue.title,'No assessment attempt') AS "Assessment",coalesce(attempts.status,'Not started') AS "Status",
   attempts.started_at AS "Started at",attempts.submitted_at AS "Submitted at",
   CASE WHEN attempts.attempt_id IS NULL THEN 'assurance-case' ELSE 'assessment-attempt' END AS source_type,
   coalesce(attempts.attempt_id,cases.case_id) AS source_ref,coalesce(attempts.updated_at,cases.updated_at) AS source_version
   FROM scoped_cases cases LEFT JOIN assessment_attempts attempts ON attempts.case_id=cases.case_id AND attempts.worker_account_id=cases.worker_account_id
   LEFT JOIN assessment_catalogue_versions catalogue ON catalogue.catalogue_version_id=attempts.catalogue_version_id
   WHERE ${dates("coalesce(attempts.started_at,cases.created_at)")} ORDER BY cases.case_id,attempts.attempt_id LIMIT 10001`,parameters);
  return result(kind,found.rows);
 }
 if(kind==="interview-outcomes"){
  const found=await database.query<Row>(CASES+` SELECT cases.case_id AS "Case ID",cases.worker_id AS "Worker ID",
   cases.worker_link_id AS "Worker link",requests.interview_request_id AS "Interview ID",requests.status AS "Status",
   requests.scheduled_at AS "Scheduled at",CASE WHEN requests.status='COMPLETED' AND final.recommendation IN ('PASS','CONDITIONAL_PASS','ADDITIONAL_EVIDENCE_REQUIRED','REASSESSMENT_REQUIRED','SECOND_INTERVIEW_REQUIRED','FAIL') THEN final.recommendation ELSE NULL END AS "Final recommendation",
   'interview' AS source_type,requests.interview_request_id AS source_ref,coalesce(final.updated_at,requests.requested_at) AS source_version
   FROM scoped_cases cases JOIN interview_requests requests ON requests.case_id=cases.case_id AND requests.tenant_id=cases.tenant_id
    AND requests.worker_account_id=cases.worker_account_id
   LEFT JOIN LATERAL (SELECT recommendation,updated_at FROM interview_console_drafts drafts
    WHERE drafts.tenant_id=requests.tenant_id AND drafts.interview_request_id=requests.interview_request_id
     AND drafts.submitted=TRUE ORDER BY drafts.updated_at DESC,drafts.interview_session_id DESC LIMIT 1) final ON TRUE
   WHERE ${dates("requests.requested_at")} ORDER BY cases.case_id,requests.interview_request_id LIMIT 10001`,parameters);
  return result(kind,found.rows);
 }
 if(kind==="failed-pending-cases"){
  const found=await database.query<Row>(CASES+` SELECT cases.case_id AS "Case ID",cases.worker_id AS "Worker ID",
   cases.worker_link_id AS "Worker link",cases.case_status AS "Case status",cases.created_at AS "Created at",cases.updated_at AS "Updated at",
   'assurance-case' AS source_type,cases.case_id AS source_ref,cases.updated_at AS source_version
   FROM scoped_cases cases WHERE cases.case_status NOT IN ('Approved','Conditionally approved','Closed')
    AND ${dates("cases.updated_at")} ORDER BY cases.updated_at,cases.case_id LIMIT 10001`,parameters);
  return result(kind,found.rows);
 }
 const found=await database.query<Row>(`SELECT 'Ledger' AS "Record type",ledger.ledger_entry_id AS "Reference",ledger.entry_type AS "Status",
  ledger.credit_delta::text AS "Credit change",'' AS "Requested credits",'' AS "Reserved credits",ledger.amount_minor::text AS "Amount minor",
  ledger.currency AS "Currency",ledger.occurred_at AS "Recorded at",'credit-ledger' AS source_type,ledger.ledger_entry_id AS source_ref,
  ledger.occurred_at::text AS source_version FROM billing_credit_ledger ledger WHERE ledger.tenant_id=$1 AND $2::text IS NULL AND $3::text IS NULL AND ${dates("ledger.occurred_at")}
 UNION ALL SELECT 'Funding request',funding.funding_request_id,funding.status,''::text,funding.credit_units::text,
  funding.reserved_credit_units::text,''::text,''::text,funding.created_at,'funding-request',funding.funding_request_id,funding.updated_at::text
 FROM funding_requests funding JOIN company_worker_links links ON links.tenant_id=funding.tenant_id AND links.link_id=funding.worker_link_id
 WHERE funding.tenant_id=$1 AND $2::text IS NULL AND $3::text IS NULL AND ${dates("funding.created_at")} ORDER BY "Recorded at","Reference" LIMIT 10001`,parameters);
 return result(kind,found.rows);
}
