import "server-only";

import { processEmailDeliveryOutboxJob } from "../email-delivery/email-delivery-handler";
import { getWorkerIdentityAutomatedCheckHandler } from "../identity/worker-identity-check-handler";
import { projectNotificationOutboxJob } from "../notifications/notification-projector";
import { handleSecureFileScanJob } from "../secure-files/secure-file-scan-handler";
import {
  createTrustedOutboxWorker,
  normalizeOutboxFailure,
  type OutboxHandlerResult,
  type OutboxJobRecord,
  type OutboxJobType,
  type TrustedOutboxLease
} from "./outbox-domain";
import {
  getOutboxRepository,
  type OutboxRepository
} from "./outbox-repository";

type OutboxHandler<T extends OutboxJobType> = (
  job: Extract<OutboxJobRecord, { jobType: T }> | OutboxJobRecord,
  lease: TrustedOutboxLease
) => Promise<OutboxHandlerResult>;

const HANDLERS: Readonly<Record<OutboxJobType, OutboxHandler<OutboxJobType>>> =
  Object.freeze({
    "platform.foundation.noop": async () => ({ kind: "succeeded" as const }),
    "notification.portal.foundation": async (job) =>
      projectNotificationOutboxJob(job),
    "email.delivery.foundation": async (job, lease) =>
      processEmailDeliveryOutboxJob(job, lease),
    "secure_file.scan": async (job, lease) =>
      handleSecureFileScanJob(job, lease),
    "worker_identity.automated_checks": async (job, lease) =>
      getWorkerIdentityAutomatedCheckHandler().handle(job, lease)
  });

export async function processNextOutboxJob(input?: {
  repository?: OutboxRepository;
}): Promise<OutboxJobRecord | null> {
  const repository = input?.repository ?? getOutboxRepository();
  const worker = createTrustedOutboxWorker();
  const claimed = await repository.claimNext(worker);
  if (!claimed) return null;

  const handler = HANDLERS[claimed.job.jobType];
  let result: OutboxHandlerResult;
  try {
    result = await handler(claimed.job, claimed.lease);
  } catch {
    result = {
      kind: "retryable",
      failure: normalizeOutboxFailure({
        code: "handler_exception",
        summary: "The registered outbox handler raised an exception."
      })
    };
  }

  switch (result.kind) {
    case "succeeded":
      return repository.succeed(claimed.lease);
    case "retryable":
      return repository.retry(claimed.lease, result.failure);
    case "terminal":
      return repository.terminalFail(claimed.lease, result.failure);
  }
}
