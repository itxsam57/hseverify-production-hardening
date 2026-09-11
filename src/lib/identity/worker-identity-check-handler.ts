import "server-only";

import type { HseAppEnvironment } from "../config/environment";
import { getServerEnvironment } from "../config/server-environment";
import {
  normalizeOutboxFailure,
  type OutboxHandlerResult,
  type OutboxJobRecord,
  type TrustedOutboxLease
} from "../outbox/outbox-domain";
import {
  WorkerIdentityCheckProviderUnavailableError,
  WorkerIdentityCheckStaleVersionError,
  createWorkerIdentityVerificationAdapter,
  type WorkerIdentityVerificationAdapter
} from "./worker-identity-check-domain";
import {
  getWorkerIdentityCheckRepository,
  type WorkerIdentityCheckRepository
} from "./worker-identity-check-repository";

type WorkerIdentityCheckEnvironmentProvider = () => HseAppEnvironment;
type WorkerIdentityVerificationAdapterFactory = (
  appEnvironment: HseAppEnvironment
) => WorkerIdentityVerificationAdapter;

export class WorkerIdentityAutomatedCheckHandler {
  constructor(
    private readonly repository: WorkerIdentityCheckRepository =
      getWorkerIdentityCheckRepository(),
    private readonly environmentProvider: WorkerIdentityCheckEnvironmentProvider = () =>
      getServerEnvironment().appEnvironment,
    private readonly adapterFactory: WorkerIdentityVerificationAdapterFactory =
      createWorkerIdentityVerificationAdapter
  ) {}

  async handle(
    job: OutboxJobRecord,
    lease: TrustedOutboxLease
  ): Promise<OutboxHandlerResult> {
    if (job.jobType !== "worker_identity.automated_checks") {
      return {
        kind: "terminal",
        failure: normalizeOutboxFailure({
          code: "wrong_identity_check_job_type",
          summary: "The job is not an automated Worker identity-check job."
        })
      };
    }

    try {
      const begun = await this.repository.beginLeasedRun(job, lease);
      if (begun.kind === "already_completed" || begun.kind === "stale") {
        return { kind: "succeeded" };
      }

      let adapter: WorkerIdentityVerificationAdapter;
      try {
        adapter = this.adapterFactory(this.environmentProvider());
      } catch (error) {
        if (error instanceof WorkerIdentityCheckProviderUnavailableError) {
          await this.repository.failProviderUnavailable(job, lease);
          return {
            kind: "terminal",
            failure: normalizeOutboxFailure({
              code: "identity_provider_not_configured",
              summary: "Identity provider checks are not configured for this environment."
            })
          };
        }
        throw error;
      }

      const batch = await adapter.run(begun.request);
      try {
        await this.repository.completeLeasedRun(job, lease, batch);
      } catch (error) {
        if (error instanceof WorkerIdentityCheckStaleVersionError) {
          return { kind: "succeeded" };
        }
        throw error;
      }
      return { kind: "succeeded" };
    } catch (error) {
      if (error instanceof WorkerIdentityCheckProviderUnavailableError) {
        await this.repository.failProviderUnavailable(job, lease);
        return {
          kind: "terminal",
          failure: normalizeOutboxFailure({
            code: "identity_provider_not_configured",
            summary: "Identity provider checks are not configured for this environment."
          })
        };
      }
      if (error instanceof WorkerIdentityCheckStaleVersionError) {
        return { kind: "succeeded" };
      }
      return {
        kind: "retryable",
        failure: normalizeOutboxFailure({
          code: "identity_check_processing_failed",
          summary: "The automated Worker identity-check attempt did not complete."
        })
      };
    }
  }
}

let handler: WorkerIdentityAutomatedCheckHandler | null = null;
export function getWorkerIdentityAutomatedCheckHandler(): WorkerIdentityAutomatedCheckHandler {
  handler ??= new WorkerIdentityAutomatedCheckHandler();
  return handler;
}
