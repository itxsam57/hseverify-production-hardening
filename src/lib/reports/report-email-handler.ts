import "server-only";
import {createHash} from "node:crypto";
import {getServerEnvironment} from "../config/server-environment";
import {getDatabaseClient,type DatabaseClient} from "../database/database";
import {assertTrustedOutboxLease,StaleOutboxLeaseError,type OutboxJobRecord,type OutboxHandlerResult,type TrustedOutboxLease} from "../outbox/outbox-domain";
import {createRuntimePrivateObjectStorage} from "../secure-files/private-object-storage";
import {ReportAccessError,ReportArtifactUnavailableError} from "./report-delivery-domain";
import {sendReportEmail} from "./report-email-transport";

type Delivery = {
 delivery_ref:string; owner_kind:"company"|"worker"; report_id:string; requested_by:string;
 tenant_id:string|null; membership_id:string|null; generation_job_id:string; generation_version:number;
 send_job_id:string; artifact_key:string; artifact_sha256:string; artifact_byte_size:number;
 artifact_mime_type:string; recipient_address_hash:string; status:string; first_dispatch_at:string|null;
};
type Source = Delivery & {email_normalized:string; request_scope:unknown; report_type:string};

function reference(job:OutboxJobRecord,lease:TrustedOutboxLease):string {
 assertTrustedOutboxLease(lease);
 const value=job.payload as {deliveryRef?:unknown};
 if(job.jobType!=="email.report.ready" || lease.jobId!==job.jobId ||
    job.enqueuedBySystemComponent!=="outbox-worker" || job.enqueuedByAccountId ||
    job.enqueuedByRole || job.tenantId || job.membershipId ||
    !value || Object.keys(value).join(",")!=="deliveryRef" ||
    typeof value.deliveryRef!=="string" || !/^report_email_[A-Za-z0-9_-]{24}$/.test(value.deliveryRef)) throw new ReportAccessError();
 return value.deliveryRef;
}
async function owned(database:DatabaseClient,job:OutboxJobRecord,lease:TrustedOutboxLease):Promise<void> {
 const result=await database.query(`SELECT job_id FROM platform_outbox_jobs WHERE job_id=$1
  AND job_type='email.report.ready' AND schema_version=1 AND status='leased'
  AND lease_id=$2 AND worker_id=$3 AND lease_expires_at>clock_timestamp() AND attempt_count=$4
  AND payload=$5::jsonb AND idempotency_key=$6 AND enqueued_system_component='outbox-worker'
  AND enqueued_by_account_id IS NULL AND enqueued_by_role IS NULL AND tenant_id IS NULL AND membership_id IS NULL
  FOR UPDATE`,[job.jobId,lease.leaseId,lease.workerId,lease.attemptNumber,JSON.stringify(job.payload),job.idempotencyKey]);
 if(result.rows.length!==1) throw new StaleOutboxLeaseError();
}
async function delivery(database:DatabaseClient,deliveryRef:string,jobId:string):Promise<Delivery> {
 const result=await database.query<Delivery>(
  "SELECT * FROM report_email_deliveries WHERE delivery_ref=$1 AND send_job_id=$2 FOR UPDATE",[deliveryRef,jobId]);
 if(result.rows.length!==1)throw new ReportAccessError();
 return result.rows[0];
}
async function currentSource(database:DatabaseClient,saved:Delivery):Promise<Source> {
 const company=saved.owner_kind==="company";
 const table=company ? "report_deliveries" : "worker_report_deliveries";
 const result=await database.query<Source>(`SELECT emails.*,accounts.email_normalized,
    requests.request_scope,requests.report_type
   FROM report_email_deliveries emails
   JOIN ${table} requests ON requests.report_id=emails.report_id AND requests.requested_by=emails.requested_by
    ${company ? "AND requests.tenant_id=emails.tenant_id AND requests.requested_by_membership_id=emails.membership_id" : "AND emails.tenant_id IS NULL AND emails.membership_id IS NULL"}
   JOIN platform_outbox_jobs generation ON generation.job_id=requests.generation_job_id
    AND generation.job_type='report.generation' AND generation.schema_version=1
    AND generation.payload=jsonb_build_object('reportRef',requests.report_id)
    AND generation.enqueued_by_account_id=requests.requested_by
    AND generation.enqueued_by_role=$3 AND generation.enqueued_system_component IS NULL
    AND generation.tenant_id IS NOT DISTINCT FROM emails.tenant_id
    AND generation.membership_id IS NOT DISTINCT FROM emails.membership_id
   JOIN auth_accounts accounts ON accounts.account_id=requests.requested_by AND accounts.account_status='active'
    AND accounts.email_verified_at IS NOT NULL
   WHERE emails.delivery_ref=$1 AND emails.send_job_id=$2
    AND requests.status='delivered' AND requests.queue_email=TRUE
    AND requests.generation_job_id=emails.generation_job_id AND requests.generation_version=emails.generation_version
    AND requests.artifact_key=emails.artifact_key AND requests.artifact_sha256=emails.artifact_sha256
    AND requests.artifact_byte_size=emails.artifact_byte_size AND requests.artifact_mime_type=emails.artifact_mime_type
    AND requests.recipient_address_hash=emails.recipient_address_hash
    AND emails.recipient_address_hash=encode(sha256(convert_to(lower(btrim(accounts.email_normalized)),'UTF8')),'hex')
    AND hse_report_owner_access(emails.owner_kind,emails.requested_by,emails.tenant_id,emails.membership_id,
      requests.request_scope,requests.report_type)
   FOR UPDATE OF accounts, requests`,[saved.delivery_ref,saved.send_job_id,saved.owner_kind]);
 if(result.rows.length!==1)throw new ReportAccessError();
 return result.rows[0];
}
function expectedKey(saved:Delivery):string {
 const parts=saved.owner_kind==="company" ? [saved.tenant_id,saved.membership_id,saved.report_id,saved.artifact_sha256] :
  ["worker",saved.requested_by,saved.report_id,saved.artifact_sha256];
 return "secure-files/"+createHash("sha256").update(parts.join("\0")).digest("hex");
}
async function verifyArtifact(saved:Delivery):Promise<void> {
 if(!/^[a-f0-9]{64}$/.test(saved.artifact_sha256) || saved.artifact_key!==expectedKey(saved) ||
    !Number.isSafeInteger(Number(saved.artifact_byte_size)) || Number(saved.artifact_byte_size)<1)throw new ReportArtifactUnavailableError();
 const bytes=await createRuntimePrivateObjectStorage(getServerEnvironment().appEnvironment).read(saved.artifact_key);
 if(!bytes || bytes.byteLength!==Number(saved.artifact_byte_size) ||
    createHash("sha256").update(bytes).digest("hex")!==saved.artifact_sha256)throw new ReportArtifactUnavailableError();
}
function failure(code:string):Readonly<{code:string;summary:string}> {
 return {code,summary:"Report dispatch could not be confirmed."};
}
export async function processReportEmailJob(job:OutboxJobRecord,lease:TrustedOutboxLease,database?:DatabaseClient):Promise<OutboxHandlerResult> {
 const deliveryRef=reference(job,lease),db=database??await getDatabaseClient();
 try {
  const prepared=await db.transaction(async tx=>{
   await owned(tx,job,lease);
   const saved=await delivery(tx,deliveryRef,job.jobId);
   if(saved.status==="sent")return {saved,alreadySent:true};
   if(saved.status==="failed")throw new ReportAccessError();
   await currentSource(tx,saved);
   const row=await tx.query<Delivery>(`UPDATE report_email_deliveries SET status='processing',
     first_dispatch_at=coalesce(first_dispatch_at,clock_timestamp()),last_error_code=NULL
     WHERE delivery_ref=$1 AND status IN ('queued','processing','retry_wait') RETURNING *`,[deliveryRef]);
   if(row.rows.length!==1)throw new ReportAccessError();
   return {saved:row.rows[0],alreadySent:false};
  });
  if(prepared.alreadySent)return {kind:"succeeded"};
  if(!prepared.saved.first_dispatch_at ||
     Date.parse(String(prepared.saved.first_dispatch_at))<=Date.now()-23*60*60*1000) {
   await db.transaction(async tx=>{
    await owned(tx,job,lease);
    await tx.query("UPDATE report_email_deliveries SET status='failed',last_error_code='report_email_window_expired' WHERE delivery_ref=$1 AND status<>'sent'",[deliveryRef]);
   });
   return {kind:"terminal",failure:failure("report_email_window_expired")};
  }
  await verifyArtifact(prepared.saved);
  const current=await db.transaction(async tx=>{
   await owned(tx,job,lease);
   return currentSource(tx,await delivery(tx,deliveryRef,job.jobId));
  });
  const environment=getServerEnvironment();
  const result=await sendReportEmail({
   providers:environment.registrationOtpProviders??{},publicBaseUrl:environment.publicBaseUrl,
   recipient:current.email_normalized,
   href:"/api/"+current.owner_kind+"/reports/"+current.report_id+"/export",
   idempotencyKey:job.idempotencyKey
  });
  const terminal=result.kind==="terminal" || lease.attemptNumber>=job.maxAttempts;
  await db.transaction(async tx=>{
   await owned(tx,job,lease);
   const saved=await delivery(tx,deliveryRef,job.jobId);
   if(saved.status==="sent")return;
   if(result.kind==="accepted") {
    await currentSource(tx,saved);
    await tx.query(`UPDATE report_email_deliveries SET status='sent',sent_at=clock_timestamp(),
      provider_reference_hash=$2,last_error_code=NULL WHERE delivery_ref=$1 AND status<>'sent'`,
      [deliveryRef,createHash("sha256").update(result.providerReference).digest("hex")]);
   } else {
    await tx.query("UPDATE report_email_deliveries SET status=$2,last_error_code=$3 WHERE delivery_ref=$1 AND status<>'sent'",
     [deliveryRef,terminal?"failed":"retry_wait",result.code]);
   }
  });
  return result.kind==="accepted" ? {kind:"succeeded"} :
   {kind:terminal?"terminal":"retryable",failure:failure(result.code)};
 } catch(error) {
  if(error instanceof StaleOutboxLeaseError)throw error;
  const denied=error instanceof ReportAccessError;
  const terminal=denied || lease.attemptNumber>=job.maxAttempts;
  const code=denied ? "report_email_denied" : "report_email_unavailable";
  await db.transaction(async tx=>{
   await owned(tx,job,lease);
   await tx.query("UPDATE report_email_deliveries SET status=$3,last_error_code=$4 WHERE delivery_ref=$1 AND send_job_id=$2 AND status<>'sent'",
    [deliveryRef,job.jobId,terminal?"failed":"retry_wait",code]);
  });
  return {kind:terminal?"terminal":"retryable",failure:failure(code)};
 }
}
export async function finalizeReportEmailFailure(database:DatabaseClient,job:OutboxJobRecord):Promise<void> {
 if(job.jobType!=="email.report.ready" || job.status!=="terminal_failed")return;
 const value=job.payload as {deliveryRef?:unknown};
 if(typeof value.deliveryRef!=="string" || !/^report_email_[A-Za-z0-9_-]{24}$/.test(value.deliveryRef))return;
 await database.query("UPDATE report_email_deliveries SET status='failed',last_error_code=$3 WHERE delivery_ref=$1 AND send_job_id=$2 AND status<>'sent'",
  [value.deliveryRef,job.jobId,job.lastErrorCode==="report_email_denied"?"report_email_denied":"report_email_exhausted"]);
}
