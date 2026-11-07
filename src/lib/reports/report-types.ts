export const COMPANY_REPORT_TYPES=["workforce-status","site-department-readiness","competency-gaps","expiring-credentials","assessment-completion","interview-outcomes","failed-pending-cases","credit-billing-usage"] as const;
export const WORKER_REPORT_TYPES=["identity-verification-summary","qualification","assessment-breakdown","interview-summary","credential-pdf","living-record-history","reassessment-appeal-history"] as const;
export type CompanyReportType=(typeof COMPANY_REPORT_TYPES)[number];
export type WorkerReportType=(typeof WORKER_REPORT_TYPES)[number];
export type ReportType=CompanyReportType|WorkerReportType;
export const REPORT_HEADERS={
  "workforce-status": [
    "Worker ID",
    "Worker link",
    "Worker status",
    "Site ID",
    "Department ID",
    "Company case status"
  ],
  "site-department-readiness": [
    "Scope",
    "Scope ID",
    "Scope name",
    "Cases",
    "Assured",
    "Conditional",
    "Attention",
    "In progress",
    "Readiness %"
  ],
  "competency-gaps": [
    "Case ID",
    "Worker ID",
    "Worker link",
    "Competency target",
    "Case status",
    "Gap"
  ],
  "expiring-credentials": [
    "Credential ID",
    "Worker ID",
    "Qualification",
    "Issued at",
    "Expires at",
    "Status"
  ],
  "assessment-completion": [
    "Case ID",
    "Worker ID",
    "Worker link",
    "Attempt ID",
    "Assessment",
    "Status",
    "Started at",
    "Submitted at"
  ],
  "interview-outcomes": [
    "Case ID",
    "Worker ID",
    "Worker link",
    "Interview ID",
    "Status",
    "Scheduled at",
    "Final recommendation"
  ],
  "failed-pending-cases": [
    "Case ID",
    "Worker ID",
    "Worker link",
    "Case status",
    "Created at",
    "Updated at"
  ],
  "credit-billing-usage": [
    "Record type",
    "Reference",
    "Status",
    "Credit change",
    "Requested credits",
    "Reserved credits",
    "Amount minor",
    "Currency",
    "Recorded at"
  ],
  "identity-verification-summary": [
    "Worker ID",
    "Identity status",
    "Identity version",
    "Submitted at",
    "Verified at"
  ],
  "qualification": [
    "Evidence ID",
    "Version",
    "Title",
    "Level",
    "Institution",
    "Awarded date",
    "Status"
  ],
  "assessment-breakdown": [
    "Case ID",
    "Attempt ID",
    "Assessment",
    "Status",
    "Question count",
    "Submitted at",
    "Final score",
    "Final decision"
  ],
  "interview-summary": [
    "Case ID",
    "Interview ID",
    "Status",
    "Scheduled at",
    "Final recommendation"
  ],
  "credential-pdf": [
    "Credential ID",
    "Worker ID",
    "Qualification",
    "Issued at",
    "Expires at",
    "Status",
    "Authentication"
  ],
  "living-record-history": [
    "Competency ID",
    "Title",
    "Source credential",
    "Version",
    "Status",
    "Effective from",
    "Expires at",
    "Restrictions",
    "Conditions"
  ],
  "reassessment-appeal-history": [
    "Event type",
    "Reference",
    "Credential ID",
    "Status",
    "Version",
    "Recorded at",
    "Outcome"
  ]
} as const;
export const REPORT_TITLES:Readonly<Record<ReportType,string>>={
 "workforce-status":"Workforce status","site-department-readiness":"Site and department readiness",
 "competency-gaps":"Competency gaps","expiring-credentials":"Expiring credentials",
 "assessment-completion":"Assessment completion","interview-outcomes":"Interview outcomes",
 "failed-pending-cases":"Failed and pending cases","credit-billing-usage":"Credit and billing usage",
 "identity-verification-summary":"Identity and verification summary","qualification":"Qualification",
 "assessment-breakdown":"Assessment breakdown","interview-summary":"Interview summary",
 "credential-pdf":"Credential snapshot","living-record-history":"Living Record history",
 "reassessment-appeal-history":"Reassessment and appeal history"
};
export type ReportRow=Readonly<Record<string,string>>;
export type ReportSourceReference=Readonly<{sourceType:string;sourceRef:string;version:string}>;
export type ReportFilters=Readonly<{from:string|null;to:string|null;expiryDays:number;credentialId:string|null}>;
export function isCompanyReportType(value:unknown):value is CompanyReportType {
 return typeof value==="string" && (COMPANY_REPORT_TYPES as readonly string[]).includes(value);
}
export function isWorkerReportType(value:unknown):value is WorkerReportType {
 return typeof value==="string" && (WORKER_REPORT_TYPES as readonly string[]).includes(value);
}
export function normalizeReportFilters(value:unknown={}):ReportFilters {
 if(!value || typeof value!=="object" || Array.isArray(value) ||
    Object.keys(value).some(key=>!["from","to","expiryDays","credentialId"].includes(key)))throw new Error("Report filters are invalid.");
 const input=value as Record<string,unknown>;
 const timestamp=(raw:unknown):string|null=>{
  if(raw==null || raw==="")return null;
  if(typeof raw!=="string" || raw.length>40 || !/^\d{4}-\d{2}-\d{2}(T.*Z)?$/.test(raw) || !Number.isFinite(Date.parse(raw)))throw new Error("Report date filter is invalid.");
  const canonical=new Date(raw).toISOString(),prefix=raw.endsWith("Z")?raw.slice(0,-1):raw;
  if(canonical.slice(0,prefix.length)!==prefix)throw new Error("Report date filter is invalid.");
  return canonical;
 };
 const from=timestamp(input.from),to=timestamp(input.to),expiryDays=input.expiryDays??30;
 if(from && to && from>to)throw new Error("The report date range is invalid.");
 if(!Number.isInteger(expiryDays) || Number(expiryDays)<1 || Number(expiryDays)>365)throw new Error("The expiry window is invalid.");
 const credentialId=input.credentialId==null || input.credentialId==="" ? null:input.credentialId;
 if(credentialId!==null && (typeof credentialId!=="string" || !/^credential_id_[A-Za-z0-9_-]{1,96}$/.test(credentialId)))throw new Error("Credential selection is invalid.");
 return Object.freeze({from,to,expiryDays:Number(expiryDays),credentialId:credentialId as string|null});
}
