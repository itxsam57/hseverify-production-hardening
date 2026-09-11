import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import { getServerEnvironment } from "../config/server-environment";
import { runRequiredOutboxTransaction } from "../outbox/outbox-service";
import {
  normalizeOutboxBusinessKey,
  normalizeOutboxPayload
} from "../outbox/outbox-domain";
import {
  DatabaseEmailDeliveryRepository,
  getEmailDeliveryRepository,
  type EmailDeliveryQueryOptions,
  type EmailDeliveryRepository
} from "./email-delivery-repository";
import type {
  EmailDeliveryAttemptRecord,
  EmailDeliveryRecord,
  FoundationEmailDeliveryPayload
} from "./email-delivery-domain";

export async function queueFoundationEmailDelivery(input: {
  principal: AuthorizationPrincipal;
  businessKey: string;
  fixtureRef: string;
  repository?: EmailDeliveryRepository;
}): Promise<EmailDeliveryRecord> {
  const environment = getServerEnvironment();
  if (
    environment.appEnvironment !== "development" &&
    environment.appEnvironment !== "test"
  ) {
    throw new Error(
      "Foundation email delivery fixtures are disabled outside development and test."
    );
  }

  const actor = bindTrustedAuditActor(input.principal);
  const businessKey = normalizeOutboxBusinessKey(input.businessKey);
  const payload = normalizeOutboxPayload(
    "email.delivery.foundation",
    { fixtureRef: input.fixtureRef }
  ) as FoundationEmailDeliveryPayload;

  return runRequiredOutboxTransaction({
    principal: input.principal,
    operation: async ({ database, enqueueRequired }) => {
      const job = await enqueueRequired({
        jobType: "email.delivery.foundation",
        businessKey,
        payload
      });
      const repository = input.repository
        ?? new DatabaseEmailDeliveryRepository(Promise.resolve(database));
      const queued = await repository.queueInTransaction(database, job);
      if (queued.created) {
        const audit = new DatabaseAuditRepository(Promise.resolve(database));
        await audit.append(actor, {
          action: "email.delivery.queued",
          outcome: "succeeded",
          target: {
            type: "email_delivery",
            reference: queued.delivery.deliveryId
          },
          metadata: {
            deliveryType: queued.delivery.deliveryType,
            sourceJobId: queued.delivery.sourceJobId,
            recipientRole: queued.delivery.recipientRole,
            schemaVersion: queued.delivery.schemaVersion
          }
        });
      }
      return queued.delivery;
    }
  });
}

export async function listEmailDeliveriesForPrincipal(input: {
  principal: AuthorizationPrincipal;
  options?: EmailDeliveryQueryOptions;
  repository?: EmailDeliveryRepository;
}): Promise<readonly EmailDeliveryRecord[]> {
  return (input.repository ?? getEmailDeliveryRepository()).listForPrincipal(
    input.principal,
    input.options
  );
}

export async function findEmailDeliveryForPrincipal(input: {
  principal: AuthorizationPrincipal;
  deliveryId: string;
  repository?: EmailDeliveryRepository;
}): Promise<EmailDeliveryRecord | null> {
  return (input.repository ?? getEmailDeliveryRepository()).findForPrincipal(
    input.principal,
    input.deliveryId
  );
}

export async function listEmailDeliveryAttemptsForPrincipal(input: {
  principal: AuthorizationPrincipal;
  deliveryId: string;
  limit?: number;
  repository?: EmailDeliveryRepository;
}): Promise<readonly EmailDeliveryAttemptRecord[]> {
  return (input.repository ?? getEmailDeliveryRepository()).listAttemptsForPrincipal(
    input.principal,
    input.deliveryId,
    input.limit
  );
}
