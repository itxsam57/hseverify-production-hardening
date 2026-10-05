import "server-only";

import { bindTrustedSystemAuditActor } from "../audit/audit-domain";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import {
  assertTrustedOutboxLease, normalizeAssessmentExpiryPayload,
  type OutboxHandlerResult, type OutboxJobRecord, type TrustedOutboxLease
} from "../outbox/outbox-domain";
import { AssessmentAttemptService } from "./assessment-attempt-service";

export async function processAssessmentExpiryJob(
  job: OutboxJobRecord, lease: TrustedOutboxLease, database?: DatabaseClient
): Promise<OutboxHandlerResult> {
  assertTrustedOutboxLease(lease);
  if (job.jobType !== "assessment.attempt.expiry" || lease.jobId !== job.jobId ||
      !(job.enqueuedByRole === "worker" && job.enqueuedByAccountId !== null &&
        !job.enqueuedBySystemComponent ||
        job.enqueuedBySystemComponent === "outbox-worker" &&
        job.enqueuedByRole === null && job.enqueuedByAccountId === null) ||
      job.tenantId !== null || job.membershipId !== null) {
    throw new Error("Assessment expiry job binding is invalid.");
  }
  await new AssessmentAttemptService(database ?? await getDatabaseClient()).processExpiry(
    normalizeAssessmentExpiryPayload(job.payload),job.enqueuedByAccountId,
    bindTrustedSystemAuditActor("outbox-worker")
  );
  return {kind:"succeeded"};
}
