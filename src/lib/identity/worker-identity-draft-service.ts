import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { evaluatePlatformPermission } from "../authorization/authorization-domain";
import {
  WorkerIdentityAccessDeniedError,
  assertWorkerIdentityPrincipal
} from "./worker-identity-domain";
import {
  getWorkerIdentityRepository,
  type WorkerIdentityRepository
} from "./worker-identity-repository";
import type {
  WorkerIdentityDraftInput,
  WorkerIdentityDraftRecord
} from "./worker-identity-draft-domain";
import {
  getWorkerIdentityDraftRepository,
  type WorkerIdentityDraftRepository
} from "./worker-identity-draft-repository";

function assertWorkerIdentityDraftManagePermission(
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

export class WorkerIdentityDraftService {
  constructor(
    private readonly identityRepository: WorkerIdentityRepository =
      getWorkerIdentityRepository(),
    private readonly draftRepository: WorkerIdentityDraftRepository =
      getWorkerIdentityDraftRepository()
  ) {}

  async load(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentityDraftRecord | null> {
    const worker = assertWorkerIdentityDraftManagePermission(principal);
    return this.draftRepository.loadOwn(worker);
  }

  async loadOrInitialize(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentityDraftRecord> {
    const worker = assertWorkerIdentityDraftManagePermission(principal);
    await this.identityRepository.ensureOwnDraft(worker);
    const existing = await this.draftRepository.loadOwn(worker);
    if (existing) return existing;
    return this.draftRepository.ensureOwn(worker);
  }

  async save(
    principal: AuthorizationPrincipal,
    input: WorkerIdentityDraftInput,
    expectedDraftRevision: number | null
  ): Promise<WorkerIdentityDraftRecord> {
    const worker = assertWorkerIdentityDraftManagePermission(principal);
    await this.identityRepository.ensureOwnDraft(worker);
    return this.draftRepository.saveOwn(
      worker,
      input,
      expectedDraftRevision
    );
  }
}

let service: WorkerIdentityDraftService | null = null;

export function getWorkerIdentityDraftService(): WorkerIdentityDraftService {
  service ??= new WorkerIdentityDraftService();
  return service;
}
