import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { evaluatePlatformPermission } from "../authorization/authorization-domain";
import { WorkerIdentityAccessDeniedError } from "./worker-identity-domain";
import {
  createTrustedWorkerIdentityCorrectionAuthority,
  type WorkerIdentityCorrectionDecision,
  type WorkerIdentityCorrectionRecord
} from "./worker-identity-correction-domain";
import {
  getWorkerIdentityCorrectionRepository,
  type WorkerIdentityCorrectionRepository
} from "./worker-identity-correction-repository";
import {
  getWorkerIdentitySubmissionCoordinator,
  type WorkerIdentitySubmissionCoordinator
} from "./worker-identity-submission-coordinator";

function assertWorkerCorrectionPermission(principal: AuthorizationPrincipal): void {
  const decision = evaluatePlatformPermission({
    role: principal.activeRole,
    permission: "worker.self.manage"
  });
  if (!decision.allowed || principal.activeRole !== "worker") {
    throw new WorkerIdentityAccessDeniedError();
  }
}

export class WorkerIdentityCorrectionService {
  private readonly authority = createTrustedWorkerIdentityCorrectionAuthority();

  constructor(
    private readonly repository: WorkerIdentityCorrectionRepository =
      getWorkerIdentityCorrectionRepository(),
    private readonly submissionCoordinator: WorkerIdentitySubmissionCoordinator | null = null
  ) {}

  loadOwn(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentityCorrectionRecord | null> {
    assertWorkerCorrectionPermission(principal);
    return this.repository.loadOwn(principal);
  }

  requestOwn(
    principal: AuthorizationPrincipal,
    input: Readonly<{ reason: string; expectedLockVersion: number }>
  ): Promise<WorkerIdentityCorrectionRecord> {
    assertWorkerCorrectionPermission(principal);
    return this.repository.requestOwn(principal, input);
  }

  submitOwn(
    principal: AuthorizationPrincipal,
    expectedLockVersion: number
  ): Promise<WorkerIdentityCorrectionRecord> {
    assertWorkerCorrectionPermission(principal);
    if (this.submissionCoordinator) {
      return this.submissionCoordinator.submitCorrection(
        principal,
        expectedLockVersion
      );
    }
    return this.repository.submitOwn(principal, expectedLockVersion);
  }

  decide(input: Readonly<{
    correctionRequestId: string;
    decision: WorkerIdentityCorrectionDecision;
    reasonCode: string;
  }>): Promise<WorkerIdentityCorrectionRecord> {
    return this.repository.decide(this.authority, input);
  }
}

let service: WorkerIdentityCorrectionService | null = null;

export function getWorkerIdentityCorrectionService(): WorkerIdentityCorrectionService {
  service ??= new WorkerIdentityCorrectionService(
    getWorkerIdentityCorrectionRepository(),
    getWorkerIdentitySubmissionCoordinator()
  );
  return service;
}
