import "server-only";

import { bindTrustedCompanyApplicationAuditActor } from "../audit/audit-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { getServerEnvironment } from "../config/server-environment";
import { processNextOutboxJob } from "../outbox/outbox-worker";
import {
  PrivateObjectConflictError,
  createLocalTestPrivateObjectStorage,
  type PrivateObjectStorage
} from "../secure-files/private-object-storage";
import {
  SecureFileAccessDeniedError,
  SecureFileReservationConflictError,
  bindTrustedCompanyApplicationSecureFileOwner,
  createSecureFileReservationIntent,
  type SecureFileRecord
} from "../secure-files/secure-file-domain";
import {
  DatabaseSecureFileRepository,
  type SecureFileReservationResult
} from "../secure-files/secure-file-repository";
import { DatabaseSecureFileScanRepository } from "../secure-files/secure-file-scan-repository";
import {
  SecureFileUploadValidationError,
  confirmStoredSecureFileUpload,
  materializeValidatedSecureFileUploadBytes,
  validateSecureFileUpload,
  type TrustedSecureFileUploadPolicy
} from "../secure-files/secure-file-upload-domain";
import { DatabaseSecureFileUploadRepository } from "../secure-files/secure-file-upload-repository";
import { CompanyVerificationSecureFileAuthorityRepository } from "./company-verification-secure-file-authority-repository";

const MAX_LOCAL_PROCESSING_STEPS = 12;

export class CompanyApplicationSecureFileService {
  constructor(
    private readonly files = new DatabaseSecureFileRepository(),
    private readonly uploads = new DatabaseSecureFileUploadRepository(),
    private readonly scans = new DatabaseSecureFileScanRepository(),
    private readonly storage: PrivateObjectStorage,
    private readonly authorities = new CompanyVerificationSecureFileAuthorityRepository()
  ) {}

  async reserve(input: {
    principal: AuthorizationPrincipal;
    businessReference: string;
    displayFilename: string;
  }): Promise<SecureFileReservationResult> {
    const owner = bindTrustedCompanyApplicationSecureFileOwner(input.principal);
    const intent = createSecureFileReservationIntent({
      owner,
      businessReference: input.businessReference,
      displayFilename: input.displayFilename
    });
    return this.authorities.reserve(owner, intent);
  }

  async find(
    principal: AuthorizationPrincipal,
    fileId: string
  ): Promise<SecureFileRecord | null> {
    return this.files.findForTrustedOwner(
      bindTrustedCompanyApplicationSecureFileOwner(principal),
      fileId
    );
  }

  async quarantine(input: {
    principal: AuthorizationPrincipal;
    policy: TrustedSecureFileUploadPolicy;
    fileId: string;
    originalFilename: string;
    declaredMime: string;
    bytes: Uint8Array;
  }): Promise<SecureFileRecord> {
    const owner = bindTrustedCompanyApplicationSecureFileOwner(input.principal);
    const file = await this.files.findForTrustedOwner(owner, input.fileId);
    if (!file) throw new SecureFileAccessDeniedError();
    if (file.lifecycleStatus !== "reserved" && file.lifecycleStatus !== "quarantined") {
      throw new SecureFileReservationConflictError();
    }
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
    const stat = await this.storage.stat(file.objectKey);
    if (!stat) throw new SecureFileUploadValidationError("stored_object_inconsistent");
    const stored = confirmStoredSecureFileUpload(validated, stat);
    const result = await this.uploads.finalizeQuarantine(
      owner,
      bindTrustedCompanyApplicationAuditActor(input.principal),
      stored
    );
    return result.file;
  }

  async scheduleScan(input: {
    principal: AuthorizationPrincipal;
    fileId: string;
  }): Promise<void> {
    await this.scans.scheduleForCompanyApplication({
      principal: input.principal,
      fileRef: input.fileId
    });
  }

  async settleLocalScan(
    principal: AuthorizationPrincipal,
    fileId: string
  ): Promise<void> {
    const environment = getServerEnvironment();
    if (
      environment.appEnvironment !== "development" &&
      environment.appEnvironment !== "test"
    ) {
      return;
    }
    for (let step = 0; step < MAX_LOCAL_PROCESSING_STEPS; step += 1) {
      const file = await this.find(principal, fileId);
      if (
        !file ||
        file.lifecycleStatus === "available" ||
        file.lifecycleStatus === "unsafe" ||
        file.lifecycleStatus === "scan_failed"
      ) {
        return;
      }
      if (!(await processNextOutboxJob())) return;
    }
  }
}

let service: CompanyApplicationSecureFileService | null = null;

export function getCompanyApplicationSecureFileService(): CompanyApplicationSecureFileService {
  if (service) return service;
  const environment = getServerEnvironment();
  if (
    environment.appEnvironment !== "development" &&
    environment.appEnvironment !== "test"
  ) {
    throw new SecureFileUploadValidationError("invalid_policy");
  }
  service = new CompanyApplicationSecureFileService(
    new DatabaseSecureFileRepository(),
    new DatabaseSecureFileUploadRepository(),
    new DatabaseSecureFileScanRepository(),
    createLocalTestPrivateObjectStorage(environment.appEnvironment)
  );
  return service;
}
