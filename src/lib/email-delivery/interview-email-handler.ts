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
export async function processInterviewEmailJob(jobInput:OutboxJobRecord,leaseInput:TrustedOutboxLease,database?:DatabaseClient):Promise<OutboxHandlerResult>{
 const job=assertEmailDeliveryJob(jobInput),lease=assertTrustedOutboxLease(leaseInput);
 if((job.jobType!=="email.interview.scheduled" && job.jobType!=="email.interview.reminder") || lease.jobId!==job.jobId)throw new StaleOutboxLeaseError();
 const reminder=job.jobType==="email.interview.reminder";
 const recipientFunction=reminder ? "platform_interview_reminder_recipients" : "platform_interview_notification_recipients";
 const db=database??await getDatabaseClient(),repository=new DatabaseEmailDeliveryRepository(Promise.resolve(db));
 const owned=async(tx:DatabaseClient)=>{
  const row=await tx.query("SELECT job_id FROM platform_outbox_jobs WHERE job_id=$1 AND status='leased' "+
   "AND job_type=$6 AND lease_id=$2 AND worker_id=$3 AND lease_expires_at>clock_timestamp() "+
   "AND payload=$4::jsonb AND enqueued_by_account_id=$5 AND enqueued_by_role='assessor' "+
   "AND enqueued_system_component IS NULL AND tenant_id IS NULL AND membership_id IS NULL "+
    "AND ($6<>'email.interview.reminder' OR (SELECT (source.metadata->>'reminderAt')::timestamptz "+
    "FROM platform_audit_events source WHERE source.audit_event_id=payload->>'eventRef')<=clock_timestamp())",
   [job.jobId,lease.leaseId,lease.workerId,JSON.stringify(job.payload),job.enqueuedByAccountId,job.jobType]);
  if(!row.rows[0])throw new StaleOutboxLeaseError();
 };
 const recipient=async(tx:DatabaseClient)=>{
  const result=await tx.query<Recipient>(
   "SELECT accounts.email_normalized,eligible.role,eligible.target_key,eligible.target_reference "+
   "FROM platform_outbox_jobs jobs "+
   "JOIN "+recipientFunction+"(jobs.payload->>'eventRef') eligible "+
    "ON eligible.account_id=jobs.payload->>'recipientRef' AND eligible.role=jobs.payload->>'recipientRole' "+
    "AND eligible.membership_id IS NOT DISTINCT FROM jobs.payload->>'membershipRef' "+
   "JOIN auth_accounts accounts ON accounts.account_id=eligible.account_id AND accounts.email_verified_at IS NOT NULL "+
   "JOIN platform_email_deliveries deliveries ON deliveries.source_job_id=jobs.job_id "+
    "AND deliveries.recipient_account_id=eligible.account_id AND deliveries.recipient_role=eligible.role "+
    "AND deliveries.tenant_id IS NOT DISTINCT FROM eligible.tenant_id AND deliveries.membership_id IS NOT DISTINCT FROM eligible.membership_id "+
    "AND deliveries.recipient_address_hash=encode(sha256(convert_to(lower(btrim(accounts.email_normalized)),'UTF8')),'hex') "+
   "WHERE jobs.job_id=$1",[job.jobId]);
  return result.rows[0]??null;
 };
 const audit=async(tx:DatabaseClient,action:AuditAction,outcome:"succeeded"|"failed")=>
  new DatabaseAuditRepository(Promise.resolve(tx)).append(bindTrustedSystemAuditActor("outbox-worker"),{
   action,outcome,target:{type:"job",reference:job.jobId},
   metadata:{deliveryType:reminder ? "interview.reminder" : "interview.scheduled",attemptNumber:lease.attemptNumber,adapterKey:"resend"}
  });
 const prepared=await db.transaction(async tx=>{
  // Follow the scheduling producer account/role -> request order. No network runs under these locks.
  await tx.query("SELECT accounts.account_id FROM auth_accounts accounts WHERE accounts.account_id IN "+
   "(SELECT enqueued_by_account_id FROM platform_outbox_jobs WHERE job_id=$1 UNION "+
   "SELECT payload->>'recipientRef' FROM platform_outbox_jobs WHERE job_id=$1) "+
   "ORDER BY accounts.account_id FOR NO KEY UPDATE OF accounts",[job.jobId]);
  await tx.query("SELECT roles.account_id FROM auth_account_roles roles WHERE roles.account_id IN "+
   "(SELECT enqueued_by_account_id FROM platform_outbox_jobs WHERE job_id=$1 UNION "+
   "SELECT payload->>'recipientRef' FROM platform_outbox_jobs WHERE job_id=$1) "+
   "ORDER BY roles.account_id,roles.role FOR UPDATE OF roles",[job.jobId]);
  await tx.query("SELECT requests.interview_request_id FROM interview_requests requests "+
   "JOIN platform_audit_events source ON source.target_reference=requests.interview_request_id "+
   "JOIN platform_outbox_jobs jobs ON jobs.payload->>'eventRef'=source.audit_event_id "+
   "WHERE jobs.job_id=$1 FOR UPDATE OF requests",[job.jobId]);
  await tx.query("SELECT job_id FROM platform_outbox_jobs WHERE job_id=$1 FOR UPDATE",[job.jobId]);
  await tx.query("SELECT delivery_id FROM platform_email_deliveries WHERE source_job_id=$1 FOR UPDATE",[job.jobId]);
  await owned(tx);
  const preparation=await repository.beginAttemptInTransaction(tx,job,lease,"resend");
  if(preparation.kind==="attempt" && preparation.created)await audit(tx,"email.delivery.attempt.started","succeeded");
  return preparation;
 });
 if(prepared.kind==="already_sent" || prepared.kind==="already_suppressed")return {kind:"succeeded"};
 if(prepared.kind!=="attempt")return {kind:"terminal",failure:{code:"delivery_already_terminal",summary:"Scheduling email delivery already reached a terminal state."}};
 const finish=async(input:FinalizeEmailAttemptInput,action:AuditAction)=>{
  await db.transaction(async tx=>{
   await tx.query("SELECT job_id FROM platform_outbox_jobs WHERE job_id=$1 FOR UPDATE",[job.jobId]);
   await tx.query("SELECT delivery_id FROM platform_email_deliveries WHERE source_job_id=$1 FOR UPDATE",[job.jobId]);
   await owned(tx);
   const result=await repository.finalizeAttemptInTransaction(tx,job,lease,input);
   if(result.changed)await audit(tx,action,input.status==="sent" || input.status==="suppressed"?"succeeded":"failed");
  });
 };
 // Recheck fresh lease, current eligibility and the immutable verified-address hash before dispatch.
 await owned(db);
 const current=await recipient(db);
 if(!prepared.recipientAddress || !current){
  await finish({outcome:"suppressed",status:"suppressed",code:"recipient_or_schedule_unavailable",
   summary:"The scheduling email was suppressed because the recipient or schedule is no longer eligible."},"email.delivery.suppressed");
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
 await owned(db);
 const environment=getServerEnvironment();
 const result=await sendInterviewEmail({
  providers:environment.registrationOtpProviders??{},publicBaseUrl:environment.publicBaseUrl,
  recipient:current.email_normalized,
  href:resolveNotificationHref({role:current.role,target:current.target_key,targetReference:current.target_reference}),
  idempotencyKey:job.idempotencyKey,kind:reminder ? "reminder" : "scheduled"
 });
 if(result.kind==="accepted"){
  await finish({outcome:"accepted",status:"sent",code:"provider_accepted",
   summary:"The email provider accepted the scheduling message.",providerReferenceHash:hashProviderReference(result.providerReference)},"email.delivery.sent");
  return {kind:"succeeded"};
 }
 const terminal=result.kind==="terminal" || lease.attemptNumber>=job.maxAttempts;
 const failure={code:result.code,summary:"Scheduling email delivery could not be confirmed."};
 await finish({outcome:terminal?"terminal_failure":"retryable_failure",status:terminal?"terminal_failed":"retry_wait",...failure},
  terminal?"email.delivery.terminal_failed":"email.delivery.retry_scheduled");
 return {kind:terminal?"terminal":"retryable",failure};
}

export async function reconcileInterviewScheduledEmails(database:DatabaseClient,reminder=false):Promise<Readonly<{examined:number;deferred:number}>>{
 const intent=reminder ? "email.interview.reminder.intent.recorded" : "email.interview.intent.recorded";
 const deferredAction=reminder ? "email.interview.reminder.enqueue.deferred" : "email.interview.enqueue.deferred";
 const pending=await database.query<{audit_event_id:string}>(
  "SELECT source.audit_event_id FROM platform_audit_events source "+
  "WHERE source.action_key='interview.scheduled' AND source.outcome='succeeded' "+
  "AND (NOT $3 OR source.metadata->>'reminderAt' IS NOT NULL) "+
   "AND NOT EXISTS(SELECT 1 FROM platform_audit_events intents "+
  "WHERE intents.action_key=$1 AND intents.target_reference=source.audit_event_id) "+
  "AND NOT EXISTS(SELECT 1 FROM platform_audit_events deferred "+
  "WHERE deferred.action_key=$2 AND deferred.target_reference=source.audit_event_id "+
  "AND deferred.recorded_at>CURRENT_TIMESTAMP-INTERVAL '30 seconds') "+
  "ORDER BY source.audit_sequence ASC LIMIT 50",[intent,deferredAction,reminder]);
 let deferred=0;
 for(const event of pending.rows){
  const result=await database.query<{queued:number}>("SELECT "+(reminder ? "platform_enqueue_interview_reminder_emails" : "platform_enqueue_interview_emails")+"($1) AS queued",[event.audit_event_id]);
  if(result.rows[0]?.queued===-1)deferred++;
 }
 return Object.freeze({examined:pending.rows.length,deferred});
}
