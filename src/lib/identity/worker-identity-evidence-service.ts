import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { evaluatePlatformPermission } from "../authorization/authorization-domain";
import {
  getSecureFileService,
  type SecureFileService
} from "../secure-files/secure-file-service";
import {
  WorkerIdentityAccessDeniedError,
  assertWorkerIdentityPrincipal
} from "./worker-identity-domain";
import {
  WorkerIdentityEvidenceUnavailableError,
  normalizeWorkerIdentityEvidenceBindingInput,
  normalizeWorkerIdentityEvidenceBindingReference,
  type WorkerIdentityEvidenceBindingInput,
  type WorkerIdentityEvidenceBindingRecord
} from "./worker-identity-evidence-domain";
import {
  getWorkerIdentityEvidenceRepository,
  type WorkerIdentityEvidenceRepository
} from "./worker-identity-evidence-repository";
import {
  getWorkerIdentityRepository,
  type WorkerIdentityRepository
} from "./worker-identity-repository";

function assertWorkerIdentityEvidenceManagePermission(
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

export class WorkerIdentityEvidenceService {
  constructor(
    private readonly identityRepository: WorkerIdentityRepository =
      getWorkerIdentityRepository(),
    private readonly evidenceRepository: WorkerIdentityEvidenceRepository =
      getWorkerIdentityEvidenceRepository(),
    private readonly secureFiles: SecureFileService = getSecureFileService()
  ) {}

  async list(
    principal: AuthorizationPrincipal
  ): Promise<readonly WorkerIdentityEvidenceBindingRecord[]> {
    const worker = assertWorkerIdentityEvidenceManagePermission(principal);
    return this.evidenceRepository.listOwn(worker);
  }

  async bind(
    principal: AuthorizationPrincipal,
    input: WorkerIdentityEvidenceBindingInput,
    expectedActiveBindingId: string | null
  ): Promise<WorkerIdentityEvidenceBindingRecord> {
    const worker = assertWorkerIdentityEvidenceManagePermission(principal);
    const normalized = normalizeWorkerIdentityEvidenceBindingInput(input);
    const expected = normalizeWorkerIdentityEvidenceBindingReference(
      expectedActiveBindingId
    );
    await this.identityRepository.ensureOwnDraft(worker);

    // Reuse the accepted M1.06 scoped read path first. The evidence repository and
    // SQL insert trigger revalidate the same ownership/lifecycle facts again inside
    // the binding transaction so this preflight cannot become the authority.
    const file = await this.secureFiles.findForPrincipal(
      worker,
      normalized.secureFileId
    );
    if (!file || file.lifecycleStatus !== "available") {
      throw new WorkerIdentityEvidenceUnavailableError();
    }
    if (
      (normalized.purpose === "profile_photo" || normalized.purpose === "selfie") &&
      file.detectedMime !== "image/png" &&
      file.detectedMime !== "image/jpeg"
    ) {
      throw new WorkerIdentityEvidenceUnavailableError();
    }

    return this.evidenceRepository.bindOwn(worker, normalized, expected);
  }
}

let service: WorkerIdentityEvidenceService | null = null;

export function getWorkerIdentityEvidenceService(): WorkerIdentityEvidenceService {
  service ??= new WorkerIdentityEvidenceService();
  return service;
}
