import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { evaluatePlatformPermission } from "../authorization/authorization-domain";
import type { OutboxJobRecord } from "../outbox/outbox-domain";
import {
  WorkerIdentityAccessDeniedError,
  assertWorkerIdentityPrincipal
} from "./worker-identity-domain";
import {
  getWorkerIdentityCheckRepository,
  type WorkerIdentityCheckProjection,
  type WorkerIdentityCheckRepository
} from "./worker-identity-check-repository";

function assertWorkerIdentityCheckPermission(
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

export class WorkerIdentityCheckService {
  constructor(
    private readonly repository: WorkerIdentityCheckRepository =
      getWorkerIdentityCheckRepository()
  ) {}

  async scheduleOwn(principal: AuthorizationPrincipal): Promise<OutboxJobRecord> {
    const worker = assertWorkerIdentityCheckPermission(principal);
    return this.repository.scheduleOwn(worker);
  }

  async loadOwn(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentityCheckProjection | null> {
    const worker = assertWorkerIdentityCheckPermission(principal);
    return this.repository.loadOwn(worker);
  }
}

let service: WorkerIdentityCheckService | null = null;
export function getWorkerIdentityCheckService(): WorkerIdentityCheckService {
  service ??= new WorkerIdentityCheckService();
  return service;
}
