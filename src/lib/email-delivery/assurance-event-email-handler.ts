import "server-only";
import type {AuthRole} from "../auth/auth-domain";
import {bindTrustedSystemAuditActor,type AuditAction} from "../audit/audit-domain";
import {DatabaseAuditRepository} from "../audit/audit-repository";
import {getServerEnvironment} from "../config/server-environment";
import {getDatabaseClient,type DatabaseClient} from "../database/database";
import {resolveNotificationHref,type NotificationTarget} from "../notifications/notification-domain";
import {assertTrustedOutboxLease,StaleOutboxLeaseError,type OutboxJobRecord,type OutboxHandlerResult,type TrustedOutboxLease} from "../outbox/outbox-domain";
import {assertEmailDeliveryJob,hashProviderReference} from "./email-delivery-domain";
import {DatabaseEmailDeliveryRepository,type FinalizeEmailAttemptInput} from "./email-delivery-repository";
import {sendInterviewEmail} from "./interview-email-transport";

type Recipient={email_normalized:string;role:AuthRole;target_key:NotificationTarget;target_reference:string};

export async function processAssuranceEventEmailJob(
 jobInput:OutboxJobRecord,leaseInput:TrustedOutboxLease,database?:DatabaseClient
):Promise<OutboxHandlerResult>{
 const job=assertEmailDeliveryJob(jobInput),lease=assertTrustedOutboxLease(leaseInput);
 if(job.jobType!=="email.assurance.event" || lease.jobId!==job.jobId)throw new StaleOutboxLeaseError();
 const db=database??await getDatabaseClient(),repository=new DatabaseEmailDeliveryRepository(Promise.resolve(db));
 const owned=async(tx:DatabaseClient):Promise<string>=>{
  const row=await tx.query<{idempotency_key:string}>(
   "SELECT jobs.idempotency_key FROM platform_outbox_jobs jobs JOIN platform_outbox_job_attempts attempts "+
    "ON attempts.attempt_id=$12 AND attempts.job_id=jobs.job_id AND attempts.attempt_number=$11 "+
    "AND attempts.worker_id=$3 AND attempts.lease_id=$2 AND attempts.outcome='running' "+
   "WHERE jobs.job_id=$1 AND jobs.job_type='email.assurance.event' AND jobs.schema_version=1 "+
    "AND jobs.status='leased' AND jobs.lease_id=$2 AND jobs.worker_id=$3 AND jobs.lease_expires_at>clock_timestamp() "+
    "AND jobs.payload=$4::jsonb AND jobs.idempotency_key=$5 AND jobs.enqueued_by_account_id IS NOT DISTINCT FROM $6 "+
    "AND jobs.enqueued_by_role IS NOT DISTINCT FROM $7 AND jobs.enqueued_system_component IS NOT DISTINCT FROM $8 "+
    "AND jobs.tenant_id IS NOT DISTINCT FROM $9 AND jobs.membership_id IS NOT DISTINCT FROM $10 "+
    "AND jobs.attempt_count=$11 AND jobs.max_attempts=$13",
   [job.jobId,lease.leaseId,lease.workerId,JSON.stringify(job.payload),job.idempotencyKey,
    job.enqueuedByAccountId,job.enqueuedByRole,job.enqueuedBySystemComponent??null,job.tenantId,job.membershipId,
    lease.attemptNumber,lease.attemptId,job.maxAttempts]);
  if(!row.rows[0])throw new StaleOutboxLeaseError();
  return row.rows[0].idempotency_key;
 };
 const recipient=async(tx:DatabaseClient)=>{
  const result=await tx.query<Recipient>(
   "SELECT accounts.email_normalized,eligible.role,eligible.target_key,eligible.target_reference "+
   "FROM platform_outbox_jobs jobs CROSS JOIN LATERAL platform_assurance_event_recipients(jobs.payload->>'eventType',jobs.payload->>'eventRef') eligible "+
   "JOIN auth_accounts accounts ON accounts.account_id=eligible.account_id AND accounts.email_verified_at IS NOT NULL "+
   "JOIN platform_email_deliveries deliveries ON deliveries.source_job_id=jobs.job_id "+
    "AND deliveries.delivery_type=jobs.payload->>'eventType' AND deliveries.delivery_key=jobs.idempotency_key "+
    "AND deliveries.recipient_account_id=eligible.account_id AND deliveries.recipient_role=eligible.role "+
    "AND deliveries.tenant_id IS NOT DISTINCT FROM eligible.tenant_id AND deliveries.membership_id IS NOT DISTINCT FROM eligible.membership_id "+
    "AND deliveries.recipient_address_hash=encode(sha256(convert_to(lower(btrim(accounts.email_normalized)),'UTF8')),'hex') "+
   "WHERE jobs.job_id=$1 AND eligible.account_id=jobs.payload->>'recipientRef' AND eligible.role=jobs.payload->>'recipientRole' "+
    "AND eligible.membership_id IS NOT DISTINCT FROM jobs.payload->>'membershipRef'",[job.jobId]);
  return result.rows[0]??null;
 };
 const audit=async(tx:DatabaseClient,action:AuditAction,outcome:"succeeded"|"failed")=>
  new DatabaseAuditRepository(Promise.resolve(tx)).append(bindTrustedSystemAuditActor("outbox-worker"),{
   action,outcome,target:{type:"job",reference:job.jobId},
   metadata:{deliveryType:job.payload.eventType,attemptNumber:lease.attemptNumber,adapterKey:"resend"}
  });
 const prepared=await db.transaction(async tx=>{
  await tx.query("SELECT account_id FROM auth_accounts WHERE account_id IN "+
   "(SELECT enqueued_by_account_id FROM platform_outbox_jobs WHERE job_id=$1 UNION "+
    "SELECT payload->>'recipientRef' FROM platform_outbox_jobs WHERE job_id=$1) ORDER BY account_id FOR NO KEY UPDATE",[job.jobId]);
  await tx.query("SELECT account_id FROM auth_account_roles WHERE account_id IN "+
   "(SELECT enqueued_by_account_id FROM platform_outbox_jobs WHERE job_id=$1 UNION "+
    "SELECT payload->>'recipientRef' FROM platform_outbox_jobs WHERE job_id=$1) ORDER BY account_id,role FOR UPDATE",[job.jobId]);
  await tx.query("SELECT job_id FROM platform_outbox_jobs WHERE job_id=$1 FOR UPDATE",[job.jobId]);
  await tx.query("SELECT delivery_id FROM platform_email_deliveries WHERE source_job_id=$1 FOR UPDATE",[job.jobId]);
  await owned(tx);
  const preparation=await repository.beginAttemptInTransaction(tx,job,lease,"resend");
  if(preparation.kind==="attempt" && preparation.created)await audit(tx,"email.delivery.attempt.started","succeeded");
  return preparation;
 });
 if(prepared.kind==="already_sent" || prepared.kind==="already_suppressed")return {kind:"succeeded"};
 if(prepared.kind!=="attempt")return {kind:"terminal",failure:{code:"delivery_already_terminal",summary:"The email delivery already reached a terminal state."}};
 const finish=async(input:FinalizeEmailAttemptInput,action:AuditAction)=>{
  await db.transaction(async tx=>{
   await tx.query("SELECT job_id FROM platform_outbox_jobs WHERE job_id=$1 FOR UPDATE",[job.jobId]);
   await tx.query("SELECT delivery_id FROM platform_email_deliveries WHERE source_job_id=$1 FOR UPDATE",[job.jobId]);
   await owned(tx);
   const result=await repository.finalizeAttemptInTransaction(tx,job,lease,input);
   if(result.changed)await audit(tx,action,input.status==="sent" || input.status==="suppressed"?"succeeded":"failed");
  });
 };
 await owned(db);
 const current=await recipient(db);
 if(!prepared.recipientAddress || !current){
  await finish({outcome:"suppressed",status:"suppressed",code:"recipient_or_record_unavailable",
   summary:"The email was suppressed because the recipient or record is no longer eligible."},"email.delivery.suppressed");
  return {kind:"succeeded"};
 }
 const dispatchWindow=await db.query<{expired:boolean}>(
  "SELECT coalesce(min(started_at)<=clock_timestamp()-INTERVAL '23 hours',FALSE) AS expired "+
  "FROM platform_email_delivery_attempts WHERE source_job_id=$1 AND adapter_key='resend'",[job.jobId]);
 if(dispatchWindow.rows[0]?.expired){
  const failure={code:"idempotency_window_expired",summary:"Delivery confirmation remains unknown after the safe provider retry window."};
  await finish({outcome:"terminal_failure",status:"terminal_failed",...failure},"email.delivery.terminal_failed");
  return {kind:"terminal",failure};
 }
 const providerKey=await owned(db),environment=getServerEnvironment();
 const result=await sendInterviewEmail({
  providers:environment.registrationOtpProviders??{},publicBaseUrl:environment.publicBaseUrl,
  recipient:current.email_normalized,
  href:resolveNotificationHref({role:current.role,target:current.target_key,targetReference:current.target_reference}),
  idempotencyKey:providerKey,kind:job.payload.eventType
 });
 if(result.kind==="accepted"){
  await finish({outcome:"accepted",status:"sent",code:"provider_accepted",
   summary:"The email provider accepted the message.",providerReferenceHash:hashProviderReference(result.providerReference)},"email.delivery.sent");
  return {kind:"succeeded"};
 }
 const terminal=result.kind==="terminal" || lease.attemptNumber>=job.maxAttempts;
 const failure={code:result.code,summary:"Email delivery could not be confirmed."};
 await finish({outcome:terminal?"terminal_failure":"retryable_failure",status:terminal?"terminal_failed":"retry_wait",...failure},
  terminal?"email.delivery.terminal_failed":"email.delivery.retry_scheduled");
 return {kind:terminal?"terminal":"retryable",failure};
}
