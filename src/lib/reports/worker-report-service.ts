import "server-only";
import {createHash} from "node:crypto";
import {bindTrustedAuditActor} from "../audit/audit-domain";
import {getDatabaseClient,type DatabaseClient} from "../database/database";
import {getServerEnvironment} from "../config/server-environment";
import {assertTrustedOutboxLease,type OutboxJobRecord,type TrustedOutboxLease} from "../outbox/outbox-domain";
import {DatabaseOutboxRepository} from "../outbox/outbox-repository";
import {createRuntimePrivateObjectStorage} from "../secure-files/private-object-storage";
import type {PrivateObjectStorage} from "../secure-files/private-object-storage";
import {ReportAccessError,ReportArtifactUnavailableError,ReportConflictError,ReportInputError,ReportNotFoundError,
 createReportCsv,createReportPrint,REPORT_FORMATS,type ReportFormat,type ReportStatus} from "./report-delivery-domain";
import {WORKER_REPORT_TYPES,REPORT_TITLES,isWorkerReportType,normalizeReportFilters,
 type WorkerReportType,type ReportFilters,type ReportRow,type ReportSourceReference} from "./report-types";
import {runWorkerReportCommand,type WorkerReportPrincipal} from "./report-owner-access";
import {captureWorkerReportSnapshot} from "./report-worker-snapshot";
import {renderReportPdf} from "./report-renderer";
export type WorkerReportRequest=Readonly<{
 reportId:string;reportType:WorkerReportType;format:ReportFormat;requestedAt:string;scheduleAt?:string;
 filters?:Partial<ReportFilters>;queueEmail?:boolean;definitionId?:string|null;definitionVersion?:number|null
}>;
export type WorkerReportRecord=Readonly<{
 reportId:string;requestedBy:string;reportType:WorkerReportType;format:ReportFormat;status:ReportStatus;deliveryKey:string;
 requestedAt:string;scheduleAt:string|null;headers:readonly string[];rows:readonly ReportRow[];filters:ReportFilters;
 sourceProvenance:readonly ReportSourceReference[];generationJobId:string;generationVersion:number;jobStatus:string|null;
 artifactKey:string|null;artifactSha256:string|null;artifactByteSize:number|null;artifactMimeType:string|null;generatedAt:string|null;
 lastErrorCode:string|null;queueEmail:boolean;recipientAddressHash:string|null;emailStatus:string|null;
 definitionId:string|null;definitionVersion:number|null
}>;
type Row=Record<string,unknown>;
const SELECT=`SELECT reports.*,jobs.status AS job_status,emails.status AS email_status
 FROM worker_report_deliveries reports LEFT JOIN platform_outbox_jobs jobs ON jobs.job_id=reports.generation_job_id
 LEFT JOIN report_email_deliveries emails ON emails.generation_job_id=reports.generation_job_id`;
const iso=(value:unknown):string=>value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
const nullable=(value:unknown):string|null=>value==null?null:String(value);
const json=(value:unknown):unknown=>typeof value==="string"?JSON.parse(value):value;
export function normalizeWorkerReportId(value:unknown):string{
 if(typeof value!=="string" || !/^report_worker_[A-Za-z0-9_-]{24}$/.test(value))throw new ReportInputError("Worker report ID is invalid.");
 return value;
}
function record(row:Row):WorkerReportRecord{
 if(!isWorkerReportType(row.report_type))throw new ReportInputError("Worker report type is invalid.");
 return Object.freeze({
  reportId:String(row.report_id),requestedBy:String(row.requested_by),reportType:row.report_type,format:row.format as ReportFormat,
  status:row.status as ReportStatus,deliveryKey:String(row.delivery_key),requestedAt:iso(row.requested_at),
  scheduleAt:row.schedule_at==null?null:iso(row.schedule_at),headers:Object.freeze(json(row.snapshot_headers) as string[]),
  rows:Object.freeze(json(row.snapshot_rows) as ReportRow[]),sourceProvenance:Object.freeze(json(row.source_provenance) as ReportSourceReference[]),
  filters:normalizeReportFilters(json(row.request_filters)),generationJobId:String(row.generation_job_id),
  generationVersion:Number(row.generation_version),jobStatus:nullable(row.job_status),artifactKey:nullable(row.artifact_key),
  artifactSha256:nullable(row.artifact_sha256),artifactByteSize:row.artifact_byte_size==null?null:Number(row.artifact_byte_size),
  artifactMimeType:nullable(row.artifact_mime_type),generatedAt:row.generated_at==null?null:iso(row.generated_at),
  lastErrorCode:nullable(row.last_error_code),queueEmail:row.queue_email===true,recipientAddressHash:nullable(row.recipient_address_hash),
  emailStatus:nullable(row.email_status),definitionId:nullable(row.definition_id),
  definitionVersion:row.definition_version==null?null:Number(row.definition_version)
 });
}
async function background(database:DatabaseClient,saved:Pick<WorkerReportRecord,"requestedBy"|"reportType">):Promise<void>{
 const found=await database.query<{allowed:boolean}>("SELECT hse_report_owner_access('worker',$1,NULL,NULL,'{}'::jsonb,$2) AS allowed",[saved.requestedBy,saved.reportType]);
 if(found.rows[0]?.allowed!==true)throw new ReportAccessError();
}
async function owned(database:DatabaseClient,job:OutboxJobRecord,lease:TrustedOutboxLease):Promise<string>{
 assertTrustedOutboxLease(lease);
 const payload=job.payload as {reportRef?:unknown};
 if(job.jobType!=="report.generation" || job.enqueuedByRole!=="worker" || job.enqueuedBySystemComponent ||
  !job.enqueuedByAccountId || job.tenantId || job.membershipId || lease.jobId!==job.jobId ||
  Object.keys(job.payload).length!==1)throw new ReportAccessError();
 const id=normalizeWorkerReportId(payload.reportRef);
 const found=await database.query(`SELECT job_id FROM platform_outbox_jobs WHERE job_id=$1 AND job_type='report.generation'
  AND schema_version=1 AND status='leased' AND lease_id=$2 AND worker_id=$3 AND attempt_count=$4
  AND enqueued_by_account_id=$5 AND enqueued_by_role='worker' AND enqueued_system_component IS NULL
  AND tenant_id IS NULL AND membership_id IS NULL AND payload=$6::jsonb AND idempotency_key=$7
  AND lease_expires_at>clock_timestamp() FOR UPDATE`,
  [job.jobId,lease.leaseId,lease.workerId,lease.attemptNumber,job.enqueuedByAccountId,JSON.stringify({reportRef:id}),job.idempotencyKey]);
 if(found.rows.length!==1)throw new ReportAccessError();
 return id;
}
function artifactKey(saved:WorkerReportRecord,digest:string):string{
 return "secure-files/"+createHash("sha256").update(["worker",saved.requestedBy,saved.reportId,digest].join("\0")).digest("hex");
}
async function artifact(storage:PrivateObjectStorage,saved:WorkerReportRecord):Promise<Uint8Array>{
 if(saved.status!=="delivered" || !saved.artifactKey || !saved.artifactSha256 || !saved.artifactByteSize ||
  !saved.artifactMimeType || saved.artifactKey!==artifactKey(saved,saved.artifactSha256))throw new ReportArtifactUnavailableError();
 const bytes=await storage.read(saved.artifactKey);
 if(!bytes || bytes.byteLength!==saved.artifactByteSize || createHash("sha256").update(bytes).digest("hex")!==saved.artifactSha256)throw new ReportArtifactUnavailableError();
 return bytes;
}
export class WorkerReportService{
 constructor(private readonly databasePromise:Promise<DatabaseClient>=getDatabaseClient(),private readonly suppliedStorage?:PrivateObjectStorage){}
 private storage():PrivateObjectStorage{return this.suppliedStorage??createRuntimePrivateObjectStorage(getServerEnvironment().appEnvironment);}
 async queue(principal:WorkerReportPrincipal,input:WorkerReportRequest):Promise<WorkerReportRecord>{
  if(!Number.isFinite(Date.parse(input.requestedAt)) || (input.scheduleAt && !Number.isFinite(Date.parse(input.scheduleAt))))throw new ReportInputError("Report dates are invalid.");
  const id=normalizeWorkerReportId(input.reportId),now=new Date(),requestedAt=new Date(input.requestedAt).toISOString();
  if(!isWorkerReportType(input.reportType) || !REPORT_FORMATS.includes(input.format) ||
   Math.abs(Date.parse(requestedAt)-now.getTime())>300000 ||
   (input.queueEmail!==undefined && typeof input.queueEmail!=="boolean"))throw new ReportInputError();
  let filters:ReportFilters;
  try{filters=normalizeReportFilters(input.filters);}catch{throw new ReportInputError("Report filters are invalid.");}
  if(filters.credentialId && input.reportType!=="credential-pdf")throw new ReportInputError("Credential selection applies only to credential snapshots.");
  if((input.definitionId==null)!==(input.definitionVersion==null) || (input.definitionId!=null &&
   (!/^report_definition_[A-Za-z0-9_-]{24}$/.test(input.definitionId) || !Number.isInteger(input.definitionVersion) ||
    Number(input.definitionVersion)<1 || Number(input.definitionVersion)>1000)))throw new ReportInputError("Saved report version is invalid.");
  const scheduleAt=input.scheduleAt?new Date(input.scheduleAt).toISOString():null;
  if(scheduleAt && Date.parse(scheduleAt)<=now.getTime())throw new ReportInputError("Schedule a report for a future time.");
  return runWorkerReportCommand(await this.databasePromise,principal,async database=>{
   await background(database,{requestedBy:principal.accountId,reportType:input.reportType});
   const found=await database.query<Row>(SELECT+" WHERE reports.report_id=$1 FOR UPDATE OF reports",[id]);
   if(found.rows[0]){
    const saved=record(found.rows[0]);
    if(saved.requestedBy!==principal.accountId || saved.reportType!==input.reportType || saved.format!==input.format ||
     saved.scheduleAt!==scheduleAt || JSON.stringify(saved.filters)!==JSON.stringify(filters) || saved.queueEmail!==(input.queueEmail??false) ||
     saved.definitionId!==(input.definitionId??null) || saved.definitionVersion!==(input.definitionVersion??null))throw new ReportConflictError();
    return saved;
   }
   const captured=await captureWorkerReportSnapshot(database,principal.accountId,input.reportType,filters,requestedAt);
   const address=input.queueEmail?await database.query<{email_normalized:string}>("SELECT email_normalized FROM auth_accounts WHERE account_id=$1 AND account_status='active' AND email_verified_at IS NOT NULL FOR UPDATE",[principal.accountId]):null;
   if(input.queueEmail && address?.rows.length!==1)throw new ReportAccessError();
   const addressHash=address?createHash("sha256").update(address.rows[0].email_normalized.trim().toLowerCase()).digest("hex"):null;
   const job=await new DatabaseOutboxRepository(Promise.resolve(database)).enqueueInTransaction(database,bindTrustedAuditActor(principal),{
    jobType:"report.generation",businessKey:id+".generation.1",payload:{reportRef:id},availableAt:scheduleAt??requestedAt
   });
   const inserted=await database.query<Row>(`INSERT INTO worker_report_deliveries(report_id,requested_by,report_type,format,status,
    delivery_key,requested_at,schedule_at,snapshot_headers,snapshot_rows,source_provenance,request_filters,generation_job_id,
    queue_email,recipient_address_hash,definition_id,definition_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17) RETURNING *`,
    [id,principal.accountId,input.reportType,input.format,scheduleAt?"scheduled":"queued","report.delivery.worker."+principal.accountId+"."+id+"."+input.format,
     requestedAt,scheduleAt,JSON.stringify(captured.headers),JSON.stringify(captured.rows),JSON.stringify(captured.sources),JSON.stringify(filters),
     job.jobId,input.queueEmail??false,addressHash,input.definitionId??null,input.definitionVersion??null]);
   if(!inserted.rows[0])throw new ReportConflictError();
   return record({...inserted.rows[0],job_status:job.status});
  });
 }
 async workspace(principal:WorkerReportPrincipal):Promise<{reports:readonly WorkerReportRecord[];reportTypes:typeof WORKER_REPORT_TYPES}>{
  return runWorkerReportCommand(await this.databasePromise,principal,async database=>{
   const found=await database.query<Row>(SELECT+" WHERE reports.requested_by=$1 ORDER BY reports.created_at DESC,reports.report_id LIMIT 100",[principal.accountId]);
   return {reports:found.rows.map(record),reportTypes:WORKER_REPORT_TYPES};
  });
 }
 private async owner(database:DatabaseClient,principal:WorkerReportPrincipal,id:string):Promise<WorkerReportRecord>{
  const found=await database.query<Row>(SELECT+" WHERE reports.report_id=$1 AND reports.requested_by=$2 FOR UPDATE OF reports",[normalizeWorkerReportId(id),principal.accountId]);
  if(!found.rows[0])throw new ReportNotFoundError();
  const saved=record(found.rows[0]);await background(database,saved);return saved;
 }
 async download(principal:WorkerReportPrincipal,id:string):Promise<{delivery:WorkerReportRecord;bytes:Uint8Array}>{
  return runWorkerReportCommand(await this.databasePromise,principal,async database=>{
   const delivery=await this.owner(database,principal,id);return {delivery,bytes:await artifact(this.storage(),delivery)};
  });
 }
 async retry(principal:WorkerReportPrincipal,id:string):Promise<WorkerReportRecord>{
  return runWorkerReportCommand(await this.databasePromise,principal,async database=>{
   const saved=await this.owner(database,principal,id);
   if(saved.status==="delivered" || saved.jobStatus!=="terminal_failed")throw new ReportConflictError("Only a terminally failed report can be retried.");
   if(saved.generationVersion>=5)throw new ReportConflictError("This report has reached its retry limit. Create a new request.");
   const version=saved.generationVersion+1,job=await new DatabaseOutboxRepository(Promise.resolve(database)).enqueueInTransaction(database,bindTrustedAuditActor(principal),{
    jobType:"report.generation",businessKey:saved.reportId+".generation."+version,payload:{reportRef:saved.reportId}
   });
   const found=await database.query<Row>(`UPDATE worker_report_deliveries SET status='queued',generation_job_id=$2,generation_version=$3,
    last_error_code=NULL WHERE report_id=$1 AND generation_job_id=$4 RETURNING *`,[saved.reportId,job.jobId,version,saved.generationJobId]);
   if(!found.rows[0])throw new ReportConflictError();
   return record({...found.rows[0],job_status:job.status});
  });
 }
 async generate(job:OutboxJobRecord,lease:TrustedOutboxLease):Promise<void>{
  await (await this.databasePromise).transaction(async database=>{
   const id=await owned(database,job,lease),found=await database.query<Row>(SELECT+` WHERE reports.report_id=$1 AND reports.requested_by=$2
    AND reports.generation_job_id=$3 FOR UPDATE OF reports`,[id,job.enqueuedByAccountId,job.jobId]);
   if(!found.rows[0])throw new ReportAccessError();
   const saved=record(found.rows[0]);await background(database,saved);
   if(saved.scheduleAt && Date.parse(saved.scheduleAt)>Date.now())throw new ReportAccessError();
   if(saved.status==="delivered"){
    await artifact(this.storage(),saved);
    if(saved.queueEmail)await database.query("SELECT hse_enqueue_report_ready_email($1,$2,$3)",[job.jobId,lease.leaseId,lease.workerId]);
    return;
   }
   if(!["queued","scheduled","processing","failed"].includes(saved.status))throw new ReportConflictError();
   await database.query("UPDATE worker_report_deliveries SET status='processing',last_error_code=NULL WHERE report_id=$1",[id]);
   const bytes=saved.format==="pdf"?await renderReportPdf({reportId:id,title:REPORT_TITLES[saved.reportType]+" report",requestedAt:saved.requestedAt,headers:saved.headers,rows:saved.rows}):
    Buffer.from(saved.format==="csv"?createReportCsv(saved.rows,saved.headers):createReportPrint(id,saved.requestedAt,saved.rows,saved.headers,REPORT_TITLES[saved.reportType]+" report"),"utf8");
   const digest=createHash("sha256").update(bytes).digest("hex"),key=artifactKey(saved,digest),storage=this.storage();
   const stored=await storage.put(key,bytes),persisted=await storage.read(key);
   if(stored.byteSize!==bytes.byteLength || stored.sha256!==digest || !persisted || persisted.byteLength!==bytes.byteLength ||
    createHash("sha256").update(persisted).digest("hex")!==digest)throw new ReportArtifactUnavailableError();
   const mime=saved.format==="pdf"?"application/pdf":saved.format==="csv"?"text/csv; charset=utf-8":"text/html; charset=utf-8";
   const updated=await database.query(`UPDATE worker_report_deliveries SET status='delivered',artifact_key=$2,artifact_sha256=$3,
    artifact_byte_size=$4,artifact_mime_type=$5,generated_at=clock_timestamp(),last_error_code=NULL WHERE report_id=$1
    AND generation_job_id=$6 AND EXISTS(SELECT 1 FROM platform_outbox_jobs WHERE job_id=$6 AND status='leased'
     AND lease_id=$7 AND worker_id=$8 AND attempt_count=$9 AND lease_expires_at>clock_timestamp()) RETURNING report_id`,
    [id,key,digest,bytes.byteLength,mime,job.jobId,lease.leaseId,lease.workerId,lease.attemptNumber]);
   if(updated.rows.length!==1)throw new ReportAccessError();
   if(saved.queueEmail)await database.query("SELECT hse_enqueue_report_ready_email($1,$2,$3)",[job.jobId,lease.leaseId,lease.workerId]);
  });
 }
 async generationFailed(job:OutboxJobRecord,lease:TrustedOutboxLease,code:string):Promise<void>{
  await (await this.databasePromise).transaction(async database=>{
   const id=await owned(database,job,lease);
   await database.query("UPDATE worker_report_deliveries SET status='failed',last_error_code=$4 WHERE report_id=$1 AND requested_by=$2 AND generation_job_id=$3 AND status<>'delivered'",[id,job.enqueuedByAccountId,job.jobId,code]);
  });
 }
}
export function getWorkerReportService():WorkerReportService{return new WorkerReportService();}
