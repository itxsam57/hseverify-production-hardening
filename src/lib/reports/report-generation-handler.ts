import "server-only";
import { TenantScopeDeniedError } from "../authorization/tenant-scoped-resource-domain";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import {
  assertTrustedOutboxLease, normalizeOutboxFailure,
  type OutboxHandlerResult, type OutboxJobRecord, type TrustedOutboxLease
} from "../outbox/outbox-domain";
import {
  ReportAccessError, ReportConflictError, ReportInputError, ReportNotFoundError
} from "./report-delivery-domain";
import { ReportDeliveryRepository } from "./report-delivery-repository";
import { ReportDeliveryService } from "./report-delivery-service";
import {WorkerReportService} from "./worker-report-service";

export async function processReportGenerationJob(
  job: OutboxJobRecord, lease: TrustedOutboxLease, database?: DatabaseClient
): Promise<OutboxHandlerResult> {
  assertTrustedOutboxLease(lease);
  const client = database ?? await getDatabaseClient();
  const repository = job.enqueuedByRole === "worker" ? new WorkerReportService(Promise.resolve(client)) : new ReportDeliveryRepository(Promise.resolve(client));
  try {
    if (repository instanceof WorkerReportService) await repository.generate(job, lease);
    else await new ReportDeliveryService(repository).generate(job, lease);
    return { kind: "succeeded" };
  } catch (error) {
    const denied = error instanceof ReportAccessError || error instanceof TenantScopeDeniedError ||
      error instanceof ReportInputError || error instanceof ReportConflictError || error instanceof ReportNotFoundError;
    const terminal = denied || lease.attemptNumber >= job.maxAttempts;
    const code = denied ? "report_generation_denied" : terminal ? "report_generation_exhausted" : "report_generation_retry";
    // This method can only update the row bound to this still-owned real lease.
    try { await repository.generationFailed(job, lease, code); }
    catch (bindingError) {
      if (!(bindingError instanceof ReportAccessError || bindingError instanceof ReportInputError)) throw bindingError;
      return { kind: "terminal", failure: normalizeOutboxFailure({
        code: "report_generation_denied", summary: "Report generation job binding is invalid."
      }) };
    }
    return {
      kind: terminal ? "terminal" : "retryable",
      failure: normalizeOutboxFailure({
        code, summary: denied ? "Report generation access is no longer valid." :
          terminal ? "Report generation exhausted its bounded attempts." : "Report generation could not persist its private artifact."
      })
    };
  }
}
