import "server-only";
import type {DatabaseClient} from "../database/database";
import type {OutboxJobRecord} from "../outbox/outbox-domain";
import {bindTrustedSystemAuditActor} from "../audit/audit-domain";
import {DatabaseAuditRepository} from "../audit/audit-repository";

export async function finalizeAssuranceEventEmailFailure(database:DatabaseClient,job:OutboxJobRecord):Promise<void>{
 if(job.jobType!=="email.assurance.event")return;
 const stored=await database.query(
  "SELECT job_id FROM platform_outbox_jobs WHERE job_id=$1 AND job_type='email.assurance.event' "+
   "AND status='terminal_failed' AND idempotency_key=$2 AND payload=$3::jsonb",
  [job.jobId,job.idempotencyKey,JSON.stringify(job.payload)]);
 if(!stored.rows[0])return;
 await database.query(
  "UPDATE platform_email_delivery_attempts attempts SET outcome='lease_expired',result_code='lease_expired',"+
   "result_summary='The prior email delivery worker lease expired before completion.',provider_reference_hash=NULL,finished_at=CURRENT_TIMESTAMP "+
  "FROM platform_outbox_job_attempts outbox_attempts "+
  "WHERE attempts.source_job_id=$1 AND attempts.outcome='running' "+
   "AND outbox_attempts.attempt_id=attempts.source_outbox_attempt_id "+
   "AND outbox_attempts.outcome IN ('lease_expired','terminal_failed','retry_scheduled')",[job.jobId]);
 const changed=await database.query(
  "UPDATE platform_email_deliveries SET status='terminal_failed',"+
   "last_result_code='delivery_not_confirmed',last_result_summary='Email delivery could not be confirmed after the available attempts.',"+
   "updated_at=CURRENT_TIMESTAMP WHERE source_job_id=$1 AND status IN ('queued','processing','retry_wait') RETURNING delivery_id",[job.jobId]);
 if(changed.rows[0])await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedSystemAuditActor("outbox-worker"),{
  action:"email.delivery.terminal_failed",outcome:"failed",target:{type:"job",reference:job.jobId},
  metadata:{deliveryType:"assurance.event",reason:"outbox_terminal_failure"}
 });
}
