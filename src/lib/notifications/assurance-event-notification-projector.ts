import "server-only";
import { bindTrustedSystemAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import {
  normalizeAssuranceEventNotificationPayload, OutboxContractError,
  type OutboxHandlerResult, type OutboxJobRecord
} from "../outbox/outbox-domain";

export async function projectAssuranceEventNotification(
  job: OutboxJobRecord, database?: DatabaseClient
): Promise<OutboxHandlerResult> {
  if (job.jobType !== "notification.assurance.event" || job.schemaVersion !== 1) throw new OutboxContractError();
  const payload = normalizeAssuranceEventNotificationPayload(job.payload);
  const client = database ?? await getDatabaseClient();
  return client.transaction(async transaction => {
    const retained = await transaction.query(
      "SELECT job_id FROM platform_outbox_jobs WHERE job_id=$1 AND job_type='notification.assurance.event' AND schema_version=1 " +
      "AND payload=$2::jsonb AND idempotency_key=$3 AND enqueued_by_account_id IS NOT DISTINCT FROM $4 " +
      "AND enqueued_by_role IS NOT DISTINCT FROM $5 AND enqueued_system_component IS NOT DISTINCT FROM $6 " +
      "AND tenant_id IS NOT DISTINCT FROM $7 AND membership_id IS NOT DISTINCT FROM $8",
      [job.jobId,JSON.stringify(payload),job.idempotencyKey,job.enqueuedByAccountId,job.enqueuedByRole,
        job.enqueuedBySystemComponent ?? null,job.tenantId,job.membershipId]
    );
    if (!retained.rows[0]) throw new OutboxContractError("Assurance projection input does not match its retained source.");
    const result = await transaction.query<{created:number;suppressed:boolean}>(
      "SELECT * FROM platform_project_assurance_event_notification($1)",[job.jobId]
    );
    const projection=result.rows[0];
    if (!projection || !Number.isInteger(projection.created) || projection.created<0 || typeof projection.suppressed!=="boolean") throw new OutboxContractError();
    if (projection.created>0 || projection.suppressed) await new DatabaseAuditRepository(Promise.resolve(transaction)).append(
      bindTrustedSystemAuditActor("outbox-worker"),{
        action:"notification.projected",outcome:"succeeded",target:{type:"job",reference:job.jobId},
        metadata:{notificationType:payload.eventType,createdCount:projection.created,
          reason:projection.suppressed ? "source_or_recipient_no_longer_actionable" : "projection_created"}
      }
    );
    return {kind:"succeeded"};
  });
}
