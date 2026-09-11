import "server-only";

import { bindTrustedSystemAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  normalizeOutboxFailure,
  type OutboxHandlerResult,
  type OutboxJobRecord
} from "../outbox/outbox-domain";
import {
  DatabaseNotificationRepository,
  type NotificationRepository
} from "./notification-repository";

export async function projectNotificationOutboxJob(
  job: OutboxJobRecord,
  input?: {
    database?: DatabaseClient;
    repository?: NotificationRepository;
  }
): Promise<OutboxHandlerResult> {
  const database = input?.database ?? await getDatabaseClient();
  const repository = input?.repository
    ?? new DatabaseNotificationRepository(Promise.resolve(database));

  return database.transaction(async (transaction) => {
    const result = await repository.projectInTransaction(transaction, job);
    if (result.kind === "recipient_unavailable") {
      return {
        kind: "terminal" as const,
        failure: normalizeOutboxFailure({
          code: "notification_recipient_unavailable",
          summary: "The notification recipient is no longer eligible for this portal."
        })
      };
    }

    if (result.created) {
      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      await audit.append(
        bindTrustedSystemAuditActor("outbox-worker", {
          tenantId: job.tenantId,
          membershipId: job.membershipId
        }),
        {
          action: "notification.projected",
          outcome: "succeeded",
          target: {
            type: "notification",
            reference: result.notification.notificationId
          },
          metadata: {
            notificationType: result.notification.notificationType,
            recipientRole: result.notification.recipientRole,
            sourceJobId: result.notification.sourceJobId
          }
        }
      );
    }

    return { kind: "succeeded" as const };
  });
}
