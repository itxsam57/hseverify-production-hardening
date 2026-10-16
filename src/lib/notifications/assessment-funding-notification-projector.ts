import "server-only";
import { enqueueAssuranceEventNotifications } from "./assurance-event-notification-enqueue";

import { bindTrustedSystemAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import {
  normalizeAssessmentFundingNotificationPayload,
  OutboxContractError,
  type OutboxHandlerResult,
  type OutboxJobRecord
} from "../outbox/outbox-domain";

// Called inside the application transition transaction; delivery happens later in the actual worker.
export async function enqueueAssessmentFundingNotification(
  database: DatabaseClient,
  eventRef: string
): Promise<void> {
  const payload = normalizeAssessmentFundingNotificationPayload({ eventRef });
  const result = await database.query<{ job_id: string }>(
    "SELECT platform_enqueue_assessment_funding_notification($1) AS job_id",
    [payload.eventRef]
  );
  if (!/^job_[A-Za-z0-9_-]{24}$/.test(result.rows[0]?.job_id ?? "")) {
    throw new OutboxContractError("Required funding notification intent was not retained.");
  }
  const source = await database.query<{notification_type:"assessment.funding.requested"|"assessment.funding.approved"}>(
    "SELECT notification_type FROM platform_assessment_funding_notification_source($1)",[payload.eventRef]
  );
  if (!source.rows[0]) throw new OutboxContractError("Funding source was not retained.");
  await enqueueAssuranceEventNotifications(database,source.rows[0].notification_type,"funding:"+payload.eventRef);
}

export async function projectAssessmentFundingNotification(
  job: OutboxJobRecord,
  database?: DatabaseClient
): Promise<OutboxHandlerResult> {
  if (job.jobType !== "notification.assessment.funding" || job.schemaVersion !== 1) {
    throw new OutboxContractError();
  }
  normalizeAssessmentFundingNotificationPayload(job.payload);
  const client = database ?? await getDatabaseClient();
  return client.transaction(async (transaction) => {
    const result = await transaction.query<{ created: number; suppressed: boolean }>(
      "SELECT * FROM platform_project_assessment_funding_notification($1)",
      [job.jobId]
    );
    const projection = result.rows[0];
    if (!projection || !Number.isInteger(projection.created) || projection.created < 0 ||
        typeof projection.suppressed !== "boolean") {
      throw new OutboxContractError();
    }
    if (projection.created > 0 || projection.suppressed) {
      await new DatabaseAuditRepository(Promise.resolve(transaction)).append(
        bindTrustedSystemAuditActor("outbox-worker"),
        {
          action: "notification.projected",
          outcome: "succeeded",
          target: { type: "job", reference: job.jobId },
          metadata: {
            notificationType: "assessment.funding",
            createdCount: projection.created,
            reason: projection.suppressed ? "funding_or_recipient_no_longer_actionable" : "projection_created"
          }
        }
      );
    }
    return { kind: "succeeded" as const };
  });
}
