import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { evaluatePlatformPermission } from "../authorization/authorization-domain";
import {
  WorkerIdentityAccessDeniedError,
  assertWorkerIdentityPrincipal,
  type WorkerIdentitySnapshot
} from "./worker-identity-domain";
import {
  getWorkerIdentityRepository,
  type WorkerIdentityRepository
} from "./worker-identity-repository";
import {
  getWorkerIdentitySubmissionCoordinator,
  type WorkerIdentitySubmissionCoordinator
} from "./worker-identity-submission-coordinator";

function assertWorkerIdentityManagePermission(
  principal: AuthorizationPrincipal
): AuthorizationPrincipal & Readonly<{ activeRole: "worker" }> {
  const worker = assertWorkerIdentityPrincipal(principal);
  const decision = evaluatePlatformPermission({
    role: worker.activeRole,
    permission: "worker.self.manage"
  });
  if (!decision.allowed) throw new WorkerIdentityAccessDeniedError();
  return worker;
}

export class WorkerIdentityService {
  constructor(
    private readonly repository: WorkerIdentityRepository =
      getWorkerIdentityRepository(),
    private readonly submissionCoordinator: WorkerIdentitySubmissionCoordinator | null = null
  ) {}

  async load(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentitySnapshot | null> {
    const worker = assertWorkerIdentityManagePermission(principal);
    return this.repository.loadOwn(worker);
  }

  async ensureDraft(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentitySnapshot> {
    const worker = assertWorkerIdentityManagePermission(principal);
    return this.repository.ensureOwnDraft(worker);
  }

  async submit(
    principal: AuthorizationPrincipal,
    expectedLockVersion: number
  ): Promise<WorkerIdentitySnapshot> {
    const worker = assertWorkerIdentityManagePermission(principal);
    if (this.submissionCoordinator) {
      return this.submissionCoordinator.submitInitial(worker, expectedLockVersion);
    }
    return this.repository.submitOwn(worker, expectedLockVersion);
  }

  async withdraw(
    principal: AuthorizationPrincipal,
    expectedLockVersion: number
  ): Promise<WorkerIdentitySnapshot> {
    const worker = assertWorkerIdentityManagePermission(principal);
    return this.repository.withdrawOwn(worker, expectedLockVersion);
  }
}

let service: WorkerIdentityService | null = null;

export function getWorkerIdentityService(): WorkerIdentityService {
  service ??= new WorkerIdentityService(
    getWorkerIdentityRepository(),
    getWorkerIdentitySubmissionCoordinator()
  );
  return service;
}
