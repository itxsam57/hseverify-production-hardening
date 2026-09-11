import "server-only";

import { createIdentifier, type AuthRole } from "../auth/auth-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import {
  readServerAuthorizationContext,
  requirePortalAuthorization
} from "../authorization/authorization-service";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { getServerEnvironment } from "../config/server-environment";
import { getDatabaseClient } from "../database/database";
import { processNextOutboxJob } from "../outbox/outbox-worker";
import { runRequiredOutboxTransaction } from "../outbox/outbox-service";
import {
  NotificationAccessDeniedError,
  normalizeNotificationId,
  resolveNotificationHref,
  type NotificationQueryOptions,
  type NotificationRecord
} from "./notification-domain";
import {
  DatabaseNotificationRepository,
  getNotificationRepository,
  type NotificationReadResult,
  type NotificationRepository
} from "./notification-repository";

export type NotificationMenuProjection = Readonly<{
  unreadCount: number;
  notifications: readonly NotificationRecord[];
}>;

export type NotificationCenterProjection = NotificationMenuProjection;

async function requireCurrentNotificationPrincipal(): Promise<AuthorizationPrincipal> {
  const resolution = await readServerAuthorizationContext();
  if (!resolution.allowed) throw new NotificationAccessDeniedError();
  return resolution.principal;
}

async function projectNotificationsForRole(input: {
  role: AuthRole;
  options: NotificationQueryOptions;
  repository?: NotificationRepository;
}): Promise<NotificationMenuProjection> {
  const principal = await requirePortalAuthorization(input.role);
  const repository = input.repository ?? getNotificationRepository();
  const [notifications, unreadCount] = await Promise.all([
    repository.listForPrincipal(principal, input.options),
    repository.unreadCountForPrincipal(principal)
  ]);
  return Object.freeze({ notifications, unreadCount });
}

export async function getNotificationMenu(
  role: AuthRole,
  repository: NotificationRepository = getNotificationRepository()
): Promise<NotificationMenuProjection> {
  return projectNotificationsForRole({
    role,
    options: { limit: 5 },
    repository
  });
}

export async function getNotificationCenter(
  role: AuthRole,
  repository: NotificationRepository = getNotificationRepository()
): Promise<NotificationCenterProjection> {
  return projectNotificationsForRole({
    role,
    options: { limit: 50 },
    repository
  });
}

export async function listNotificationsForRole(input: {
  role: AuthRole;
  options?: NotificationQueryOptions;
  repository?: NotificationRepository;
}): Promise<readonly NotificationRecord[]> {
  const principal = await requirePortalAuthorization(input.role);
  return (input.repository ?? getNotificationRepository()).listForPrincipal(
    principal,
    input.options
  );
}

async function markReadWithAudit(input: {
  principal: AuthorizationPrincipal;
  notificationId: string;
}): Promise<NotificationReadResult | null> {
  const database = await getDatabaseClient();
  return database.transaction(async (transaction) => {
    const repository = new DatabaseNotificationRepository(
      Promise.resolve(transaction)
    );
    const result = await repository.markReadForPrincipal(
      input.principal,
      input.notificationId
    );
    if (!result?.changed) return result;

    const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
    await audit.append(bindTrustedAuditActor(input.principal), {
      action: "notification.read",
      outcome: "succeeded",
      target: {
        type: "notification",
        reference: result.notification.notificationId
      },
      metadata: {
        notificationType: result.notification.notificationType,
        recipientRole: result.notification.recipientRole
      }
    });
    return result;
  });
}

export async function markCurrentNotificationRead(
  notificationId: string
): Promise<NotificationReadResult | null> {
  const principal = await requireCurrentNotificationPrincipal();
  return markReadWithAudit({ principal, notificationId });
}

async function recordDeniedDeepLink(input: {
  principal: AuthorizationPrincipal;
  notificationId: string;
}): Promise<void> {
  const audit = new DatabaseAuditRepository();
  await audit.append(bindTrustedAuditActor(input.principal), {
    action: "notification.deep_link.denied",
    outcome: "denied",
    reason: "notification_unavailable",
    target: {
      type: "notification",
      reference: normalizeNotificationId(input.notificationId)
    },
    metadata: { recipientRole: input.principal.activeRole }
  });
}

export async function openCurrentNotification(
  notificationId: string
): Promise<Readonly<{ role: AuthRole; href: string | null }>> {
  const principal = await requireCurrentNotificationPrincipal();
  const repository = getNotificationRepository();
  const notification = await repository.findForPrincipal(
    principal,
    notificationId
  );
  if (!notification) {
    await recordDeniedDeepLink({ principal, notificationId });
    return Object.freeze({ role: principal.activeRole, href: null });
  }

  const href = resolveNotificationHref({
    role: principal.activeRole,
    target: notification.target,
    targetReference: notification.targetReference
  });
  await markReadWithAudit({
    principal,
    notificationId: notification.notificationId
  });
  return Object.freeze({ role: principal.activeRole, href });
}

export async function createDevelopmentNotificationFixture(): Promise<Readonly<{
  role: AuthRole;
  jobId: string;
}>> {
  const environment = getServerEnvironment();
  if (environment.appEnvironment === "production") {
    throw new NotificationAccessDeniedError();
  }

  const principal = await requireCurrentNotificationPrincipal();
  const fixtureRef = createIdentifier("notification_fixture");
  const job = await runRequiredOutboxTransaction({
    principal,
    operation: async ({ enqueueRequired }) =>
      enqueueRequired({
        jobType: "notification.portal.foundation",
        businessKey: `foundation-notification:${principal.accountId}:${principal.activeRole}:${fixtureRef}`,
        payload: { fixtureRef }
      })
  });

  while (true) {
    const processed = await processNextOutboxJob();
    if (!processed) {
      throw new Error(
        "The committed notification job was not available to the real outbox worker."
      );
    }
    if (processed.jobId !== job.jobId) continue;
    if (processed.status !== "succeeded") {
      throw new Error(
        "The committed notification job did not complete successfully."
      );
    }
    return Object.freeze({ role: principal.activeRole, jobId: job.jobId });
  }
}
