import "server-only";

import {
  bindTrustedSystemAuditActor,
  type AuditAction,
  type AuditOutcome
} from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  OUTBOX_MAX_ATTEMPTS,
  assertTrustedOutboxLease,
  normalizeOutboxFailure,
  type OutboxHandlerResult,
  type OutboxJobRecord,
  type TrustedOutboxLease
} from "../outbox/outbox-domain";
import {
  getEmailDeliveryAdapter,
  type EmailDeliveryAdapter
} from "./email-delivery-adapter";
import {
  assertEmailDeliveryJob,
  hashProviderReference,
  isFinalEmailAttempt,
  normalizeEmailAdapterResult,
  type EmailAdapterResult,
  type EmailDeliveryOutboxJob
} from "./email-delivery-domain";
import {
  DatabaseEmailDeliveryRepository,
  type EmailDeliveryRepository,
  type FinalizeEmailAttemptInput
} from "./email-delivery-repository";

async function appendDeliveryAudit(input: {
  database: DatabaseClient;
  job: EmailDeliveryOutboxJob;
  action: AuditAction;
  outcome: AuditOutcome;
  deliveryId: string;
  attemptNumber: number;
  adapterKey: string;
  resultCode?: string | null;
}): Promise<void> {
  const audit = new DatabaseAuditRepository(Promise.resolve(input.database));
  await audit.append(
    bindTrustedSystemAuditActor("outbox-worker", {
      tenantId: input.job.tenantId,
      membershipId: input.job.membershipId
    }),
    {
      action: input.action,
      outcome: input.outcome,
      target: { type: "email_delivery", reference: input.deliveryId },
      metadata: {
        sourceJobId: input.job.jobId,
        attemptNumber: input.attemptNumber,
        adapterKey: input.adapterKey,
        ...(input.resultCode ? { resultCode: input.resultCode } : {})
      }
    }
  );
}

function storedAttemptResult(input: {
  outcome: string;
  resultCode: string | null;
  resultSummary: string | null;
}): OutboxHandlerResult | null {
  if (input.outcome === "running") return null;
  if (input.outcome === "delivered") {
    return Object.freeze({ kind: "succeeded" as const });
  }
  const failure = normalizeOutboxFailure({
    code: input.resultCode ?? "email_delivery_failed",
    summary: input.resultSummary ?? "The email delivery attempt did not complete."
  });
  if (input.outcome === "retryable_failure") {
    return Object.freeze({ kind: "retryable" as const, failure });
  }
  return Object.freeze({ kind: "terminal" as const, failure });
}

function finalizationForResult(
  result: EmailAdapterResult,
  attemptNumber: number
): FinalizeEmailAttemptInput {
  const normalized = normalizeEmailAdapterResult(result);
  if (normalized.kind === "delivered") {
    return Object.freeze({
      outcome: "delivered" as const,
      status: "delivered" as const,
      code: normalized.code,
      summary: normalized.summary,
      providerReferenceHash: hashProviderReference(normalized.providerReference)
    });
  }
  if (normalized.kind === "terminal" || isFinalEmailAttempt(attemptNumber)) {
    return Object.freeze({
      outcome: "terminal_failure" as const,
      status: "terminal_failed" as const,
      code: normalized.code,
      summary: normalized.summary,
      providerReferenceHash: null
    });
  }
  return Object.freeze({
    outcome: "retryable_failure" as const,
    status: "retry_wait" as const,
    code: normalized.code,
    summary: normalized.summary,
    providerReferenceHash: null
  });
}

export async function processEmailDeliveryOutboxJob(
  jobInput: OutboxJobRecord,
  leaseInput: TrustedOutboxLease,
  dependencies: Readonly<{
    database?: DatabaseClient;
    repository?: EmailDeliveryRepository;
    adapter?: EmailDeliveryAdapter;
  }> = {}
): Promise<OutboxHandlerResult> {
  const job = assertEmailDeliveryJob(jobInput);
  const lease = assertTrustedOutboxLease(leaseInput);
  if (lease.jobId !== job.jobId) {
    return Object.freeze({
      kind: "terminal" as const,
      failure: normalizeOutboxFailure({
        code: "email_lease_mismatch",
        summary: "The email delivery lease does not match the claimed job."
      })
    });
  }

  const database = dependencies.database ?? await getDatabaseClient();
  const repository = dependencies.repository
    ?? new DatabaseEmailDeliveryRepository(Promise.resolve(database));
  const adapter = dependencies.adapter ?? getEmailDeliveryAdapter();

  const preparation = await database.transaction(async (transaction) => {
    const attempt = await repository.beginAttemptInTransaction(
      transaction,
      job,
      lease,
      adapter.key
    );
    if (attempt.kind === "attempt" && attempt.created) {
      await appendDeliveryAudit({
        database: transaction,
        job,
        action: "email.delivery.attempt.started",
        outcome: "succeeded",
        deliveryId: attempt.delivery.deliveryId,
        attemptNumber: lease.attemptNumber,
        adapterKey: adapter.key
      });
    }
    return attempt;
  });

  if (preparation.kind === "already_delivered") {
    return Object.freeze({ kind: "succeeded" as const });
  }
  if (preparation.kind === "already_terminal") {
    return Object.freeze({
      kind: "terminal" as const,
      failure: normalizeOutboxFailure({
        code: preparation.delivery.lastResultCode ?? "email_terminal_failed",
        summary: preparation.delivery.lastResultSummary
          ?? "The email delivery already reached terminal failure."
      })
    });
  }

  const prepared = preparation;
  const alreadyFinal = storedAttemptResult(prepared.attempt);
  if (alreadyFinal) return alreadyFinal;

  let adapterResult: EmailAdapterResult;
  if (!prepared.recipientAddress) {
    adapterResult = Object.freeze({
      kind: "terminal" as const,
      code: "recipient_unavailable",
      summary: "The verified email recipient is no longer available."
    });
  } else {
    try {
      adapterResult = await adapter.deliver({
        deliveryId: prepared.delivery.deliveryId,
        fixtureRef: job.payload.fixtureRef,
        recipientAddress: prepared.recipientAddress,
        attemptNumber: lease.attemptNumber,
        dispatchKey: prepared.attempt.dispatchKey
      });
    } catch {
      adapterResult = Object.freeze({
        kind: "retryable" as const,
        code: "adapter_execution_failed",
        summary: "The email delivery adapter failed before returning a result."
      });
    }
  }

  const finalization = finalizationForResult(adapterResult, lease.attemptNumber);
  const finalized = await database.transaction(async (transaction) => {
    const result = await repository.finalizeAttemptInTransaction(
      transaction,
      job,
      lease,
      finalization
    );
    if (result.changed) {
      const action = finalization.status === "delivered"
        ? "email.delivery.delivered"
        : finalization.status === "retry_wait"
          ? "email.delivery.retry_scheduled"
          : "email.delivery.terminal_failed";
      await appendDeliveryAudit({
        database: transaction,
        job,
        action,
        outcome: finalization.status === "delivered" ? "succeeded" : "failed",
        deliveryId: result.delivery.deliveryId,
        attemptNumber: lease.attemptNumber,
        adapterKey: adapter.key,
        resultCode: finalization.code
      });
    }
    return result;
  });

  if (finalized.delivery.status === "delivered") {
    return Object.freeze({ kind: "succeeded" as const });
  }
  const failure = normalizeOutboxFailure({
    code: finalization.code,
    summary: finalization.summary
  });
  if (
    finalized.delivery.status === "retry_wait" &&
    lease.attemptNumber < OUTBOX_MAX_ATTEMPTS
  ) {
    return Object.freeze({ kind: "retryable" as const, failure });
  }
  return Object.freeze({ kind: "terminal" as const, failure });
}
