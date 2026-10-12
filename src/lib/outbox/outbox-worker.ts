import "server-only";
import { processReportGenerationJob } from "../reports/report-generation-handler";
import { processReportEmailJob } from "../reports/report-email-handler";
import { projectAssessmentFundingNotification } from "../notifications/assessment-funding-notification-projector";
import { projectAssuranceEventNotification } from "../notifications/assurance-event-notification-projector";
import {processInterviewEmailJob} from "../email-delivery/interview-email-handler";
import { processAssuranceEventEmailJob } from "../email-delivery/assurance-event-email-handler";
import {projectInterviewScheduledNotification} from "../notifications/interview-notification-projector";

import { processRegistrationDeliveryJob } from "../auth/registration-delivery-handler";

import { processAssessmentExpiryJob } from "../assessment-attempt/assessment-expiry-handler";

import type { DatabaseClient } from "../database/database";

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
  lease: TrustedOutboxLease,
  database?: DatabaseClient
) => Promise<OutboxHandlerResult>;

const HANDLERS: Readonly<Record<OutboxJobType, OutboxHandler<OutboxJobType>>> =
  Object.freeze({
    "email.assurance.event": async (job, lease, database) =>
      processAssuranceEventEmailJob(job, lease, database),
    "email.report.ready": async (job, lease, database) =>
      processReportEmailJob(job, lease, database),
    "report.generation": async (job, lease, database) =>
      processReportGenerationJob(job, lease, database),
    "notification.assurance.event": async (job, _lease, database) =>
      projectAssuranceEventNotification(job, database),
    "notification.assessment.funding": async (job, _lease, database) =>
      projectAssessmentFundingNotification(job, database),
    "authentication.challenge.delivery": async (job,lease,database) =>
      processRegistrationDeliveryJob(job,lease,database),
    "assessment.attempt.expiry": async (job,lease,database) =>
      processAssessmentExpiryJob(job,lease,database),
    "platform.foundation.noop": async () => ({ kind: "succeeded" as const }),
    "notification.portal.foundation": async (job, _lease, database) =>
      projectNotificationOutboxJob(job, { database }),
    "notification.interview.scheduled": async (job,_lease,database) =>
      projectInterviewScheduledNotification(job,database),
    "notification.interview.reminder": async (job,_lease,database) =>
      projectInterviewScheduledNotification(job,database),
    "notification.account.security": async (job, _lease, database) =>
      projectNotificationOutboxJob(job, { database }),
    "email.interview.scheduled": async (job,lease,database) => processInterviewEmailJob(job,lease,database),
    "email.interview.reminder": async (job,lease,database) => processInterviewEmailJob(job,lease,database),
    "email.delivery.foundation": async (job, lease) =>
      processEmailDeliveryOutboxJob(job, lease),
    "secure_file.scan": async (job, lease) =>
      handleSecureFileScanJob(job, lease),
    "worker_identity.automated_checks": async (job, lease) =>
      getWorkerIdentityAutomatedCheckHandler().handle(job, lease)
  });

export async function processNextOutboxJob(input?: {
  repository?: OutboxRepository;
  database?: DatabaseClient;
}): Promise<OutboxJobRecord | null> {
  const repository = input?.repository ?? getOutboxRepository();
  const worker = createTrustedOutboxWorker();
  const claimed = await repository.claimNext(worker);
  if (!claimed) return null;

  const handler = HANDLERS[claimed.job.jobType];
  let result: OutboxHandlerResult;
  try {
    result = await handler(claimed.job, claimed.lease, input?.database);
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
