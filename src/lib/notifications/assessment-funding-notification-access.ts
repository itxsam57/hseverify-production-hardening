import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import type { NotificationRecord } from "./notification-domain";

export async function canOpenAssessmentFundingNotification(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  notification: NotificationRecord
): Promise<boolean> {
  if (notification.notificationType !== "assessment.funding.requested" &&
      notification.notificationType !== "assessment.funding.approved") return true;
  if (!("eventRef" in notification.metadata)) return false;
  const membership = principal.tenantMembership;
  const result = await database.query(
    `SELECT 1 FROM platform_assessment_funding_notification_recipients($1)
      WHERE account_id=$2 AND role=$3
        AND tenant_id IS NOT DISTINCT FROM $4::text
        AND membership_id IS NOT DISTINCT FROM $5::text
        AND notification_type=$6 AND target_key=$7 AND target_reference=$8`,
    [
      notification.metadata.eventRef,
      principal.accountId,
      principal.activeRole,
      membership?.tenantId ?? null,
      membership?.membershipId ?? null,
      notification.notificationType,
      notification.target,
      notification.targetReference
    ]
  );
  return !!result.rows[0];
}
