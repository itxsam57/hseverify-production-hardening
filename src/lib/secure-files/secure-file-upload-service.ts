import "server-only";

import { bindTrustedAuditActor } from "../audit/audit-domain";
import { getServerEnvironment } from "../config/server-environment";
import {
  SecureFileAccessDeniedError,
  SecureFileReservationConflictError,
  bindTrustedSecureFileOwner,
  type SecureFileRecord
} from "./secure-file-domain";
import {
  PrivateObjectConflictError,
  createLocalTestPrivateObjectStorage,
  type PrivateObjectStorage
} from "./private-object-storage";
import {
  SecureFileUploadValidationError,
  confirmStoredSecureFileUpload,
  materializeValidatedSecureFileUploadBytes,
  validateSecureFileUpload,
  type TrustedSecureFileUploadPolicy
} from "./secure-file-upload-domain";
import {
  getSecureFileUploadRepository,
  type SecureFileQuarantineResult,
  type SecureFileUploadRepository
} from "./secure-file-upload-repository";
import {
  getSecureFileService,
  type SecureFileService
} from "./secure-file-service";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";

export class SecureFileUploadService {
  constructor(
    private readonly files: SecureFileService,
    private readonly uploads: SecureFileUploadRepository,
    private readonly storage: PrivateObjectStorage
  ) {}

  async quarantineForPrincipal(input: {
    principal: AuthorizationPrincipal;
    policy: TrustedSecureFileUploadPolicy;
    fileId: string;
    originalFilename: string;
    declaredMime: string;
    bytes: Uint8Array;
  }): Promise<SecureFileQuarantineResult> {
    const file = await this.files.findForPrincipal(input.principal, input.fileId);
    if (!file) throw new SecureFileAccessDeniedError();
    this.assertUploadableState(file);

    const validated = validateSecureFileUpload({
      policy: input.policy,
      fileId: file.fileId,
      objectKey: file.objectKey,
      reservedDisplayFilename: file.displayFilename,
      originalFilename: input.originalFilename,
      declaredMime: input.declaredMime,
      bytes: input.bytes
    });

    const bytes = materializeValidatedSecureFileUploadBytes(validated);
    try {
      await this.storage.put(file.objectKey, bytes);
    } catch (error) {
      if (error instanceof PrivateObjectConflictError) {
        throw new SecureFileUploadValidationError("stored_object_inconsistent");
      }
      throw error;
    }

    const storedStat = await this.storage.stat(file.objectKey);
    if (!storedStat) {
      throw new SecureFileUploadValidationError("stored_object_inconsistent");
    }
    const stored = confirmStoredSecureFileUpload(validated, storedStat);
    const owner = bindTrustedSecureFileOwner(input.principal);
    const actor = bindTrustedAuditActor(input.principal);
    return this.uploads.finalizeQuarantine(owner, actor, stored);
  }

  private assertUploadableState(file: SecureFileRecord): void {
    if (file.lifecycleStatus !== "reserved" && file.lifecycleStatus !== "quarantined") {
      throw new SecureFileReservationConflictError();
    }
  }
}

let service: SecureFileUploadService | null = null;

export function getSecureFileUploadService(): SecureFileUploadService {
  if (service) return service;
  const environment = getServerEnvironment();
  if (
    environment.appEnvironment !== "development" &&
    environment.appEnvironment !== "test"
  ) {
    throw new SecureFileUploadValidationError("invalid_policy");
  }
  service = new SecureFileUploadService(
    getSecureFileService(),
    getSecureFileUploadRepository(),
    createLocalTestPrivateObjectStorage(environment.appEnvironment)
  );
  return service;
}
