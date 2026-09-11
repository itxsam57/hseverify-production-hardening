import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import {
  createTrustedWorkerIdentityEligibilityAuthority,
  type WorkerIdentityDuplicateCheckRecord,
  type WorkerIdentityDuplicateDisposition,
  type WorkerIdentityDuplicateDispositionRecord,
  type WorkerIdentityEligibilityStatus,
  type WorkerPermanentIdRecord
} from "./worker-identity-eligibility-domain";
import {
  getWorkerIdentityEligibilityRepository,
  type WorkerIdentityEligibilityRepository
} from "./worker-identity-eligibility-repository";

export class WorkerIdentityEligibilityService {
  private readonly authority = createTrustedWorkerIdentityEligibilityAuthority();

  constructor(
    private readonly repository: WorkerIdentityEligibilityRepository =
      getWorkerIdentityEligibilityRepository()
  ) {}

  evaluate(identityId: string): Promise<WorkerIdentityDuplicateCheckRecord> {
    return this.repository.evaluate(this.authority, identityId);
  }

  recordDisposition(input: Readonly<{
    checkId: string;
    disposition: WorkerIdentityDuplicateDisposition;
    reasonCode: string;
  }>): Promise<WorkerIdentityDuplicateDispositionRecord> {
    return this.repository.recordDisposition(this.authority, input);
  }

  issuePermanentWorkerId(identityId: string): Promise<WorkerPermanentIdRecord> {
    return this.repository.issuePermanentWorkerId(this.authority, identityId);
  }

  loadOwnStatus(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentityEligibilityStatus | null> {
    return this.repository.loadOwnStatus(principal);
  }
}

let service: WorkerIdentityEligibilityService | null = null;

export function getWorkerIdentityEligibilityService(): WorkerIdentityEligibilityService {
  service ??= new WorkerIdentityEligibilityService();
  return service;
}
