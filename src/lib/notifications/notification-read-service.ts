import "server-only";

import { bindTrustedAuditActor, bindTrustedCompanyApplicationAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import { DatabaseNotificationRepository } from "./notification-repository";

export function bindNotificationAuditActor(principal: AuthorizationPrincipal) {
  return principal.activeRole === "company" && principal.tenantMembership?.tenantStatus === "pending"
    ? bindTrustedCompanyApplicationAuditActor(principal)
    : bindTrustedAuditActor(principal);
}

export async function markAllNotificationsReadForPrincipal(
  database: DatabaseClient,
  principal: AuthorizationPrincipal
): Promise<number> {
  return database.transaction(async (transaction) => {
    const repository = new DatabaseNotificationRepository(Promise.resolve(transaction));
    const notifications = await repository.markAllReadForPrincipal(principal);
    if (notifications.length === 0) return 0;
    const actor = bindNotificationAuditActor(principal);
    const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
    for (const notification of notifications) {
      await audit.append(actor, {
        action: "notification.read",
        outcome: "succeeded",
        target: { type: "notification", reference: notification.notificationId },
        metadata: { notificationType: notification.notificationType, recipientRole: notification.recipientRole }
      });
    }
    return notifications.length;
  });
}
