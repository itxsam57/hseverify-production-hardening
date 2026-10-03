import "server-only";

import { EvidenceReviewService } from "../review/evidence-review-service";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import type { WorkerIdentityCorrectionRecord } from "./worker-identity-correction-domain";
import { DatabaseWorkerIdentityCorrectionRepository } from "./worker-identity-correction-repository";
import type { WorkerIdentitySnapshot } from "./worker-identity-domain";
import { DatabaseWorkerIdentityRepository } from "./worker-identity-repository";
import { WorkerIdentitySubmissionReadinessService } from "./worker-identity-submission-readiness-service";

export class WorkerIdentitySubmissionCoordinator {
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  private client(): Promise<DatabaseClient> {
    return this.clientPromise;
  }

  async submitInitial(
    principal: AuthorizationPrincipal,
    expectedLockVersion: number
  ): Promise<WorkerIdentitySnapshot> {
    const database = await this.client();
    return database.transaction(async (transaction) => {
      const transactionClient = Promise.resolve(transaction);
      await new WorkerIdentitySubmissionReadinessService(
        transactionClient
      ).assertOwnReady(principal, {
        expectedLockVersion,
        expectedVersionKind: "initial"
      });
      return new DatabaseWorkerIdentityRepository(transactionClient).submitOwn(
        principal,
        expectedLockVersion
      );
    });
  }

  async submitCorrection(
    principal: AuthorizationPrincipal,
    expectedLockVersion: number
  ): Promise<WorkerIdentityCorrectionRecord> {
    const database = await this.client();
    return database.transaction(async (transaction) => {
      const transactionClient = Promise.resolve(transaction);
      await new WorkerIdentitySubmissionReadinessService(
        transactionClient
      ).assertOwnReady(principal, {
        expectedLockVersion,
        expectedVersionKind: "correction"
      });
      const correction = await new DatabaseWorkerIdentityCorrectionRepository(
        transactionClient
      ).submitOwn(principal, expectedLockVersion);
      await new EvidenceReviewService(transaction).queueIndependentIdentity(principal);
      return correction;
    });
  }
}

let coordinator: WorkerIdentitySubmissionCoordinator | null = null;

export function getWorkerIdentitySubmissionCoordinator(): WorkerIdentitySubmissionCoordinator {
  coordinator ??= new WorkerIdentitySubmissionCoordinator();
  return coordinator;
}
