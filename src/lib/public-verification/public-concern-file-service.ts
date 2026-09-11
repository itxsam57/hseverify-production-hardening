import "server-only";

import { randomBytes } from "node:crypto";

import { getServerEnvironment } from "@/lib/config/server-environment";
import { getDatabaseClient } from "@/lib/database/database";
import {
  PublicVerificationRepository,
  type PublicConcernEvidenceCandidate
} from "@/lib/public-verification/public-verification-repository";
import {
  bindTrustedPublicConcernSecureFileOwner,
  createSecureFileId,
  createSecureFileReservationIntent,
  deriveSecureFileObjectKey,
  type TrustedSecureFileOwner
} from "@/lib/secure-files/secure-file-domain";
import {
  PrivateObjectConflictError,
  createLocalTestPrivateObjectStorage,
  type PrivateObjectStorage
} from "@/lib/secure-files/private-object-storage";
import {
  SecureFileUploadValidationError,
  confirmStoredSecureFileUpload,
  createDefaultSecureFileUploadPolicy,
  materializeValidatedSecureFileUploadBytes,
  validateSecureFileUpload
} from "@/lib/secure-files/secure-file-upload-domain";

const TRUSTED_PUBLIC_CONCERN_UPLOAD_AUTHORITY = Symbol(
  "trusted-public-concern-upload-authority"
);
const TRUSTED_PUBLIC_CONCERN_UPLOAD_AUTHORITIES = new WeakSet<object>();
const CONCERN_ID_PATTERN = /^public_concern_[A-Za-z0-9_-]{24}$/;
const CONCERN_NONCE_PATTERN = /^concern_nonce_[A-Za-z0-9_-]{24}$/;
const CANDIDATE_ID_PATTERN = /^public_concern_evidence_[A-Za-z0-9_-]{24}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const CONCERN_UPLOAD_LIMIT = 5;

export type PublicConcernUploadAuthority = Readonly<{
  concernReference: string;
  owner: TrustedSecureFileOwner;
  [TRUSTED_PUBLIC_CONCERN_UPLOAD_AUTHORITY]: true;
}>;

export type PublicConcernEvidenceUploadResult = Readonly<{
  candidateReference: string;
  status: "pending" | "bound" | "rejected";
}>;

function createCandidateId(): string {
  return `public_concern_evidence_${randomBytes(18).toString("base64url")}`;
}

function assertFingerprint(value: string): string {
  if (typeof value !== "string" || !FINGERPRINT_PATTERN.test(value)) {
    throw new SecureFileUploadValidationError("invalid_policy");
  }
  return value;
}

function assertNonce(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!CONCERN_NONCE_PATTERN.test(normalized)) {
    throw new SecureFileUploadValidationError("invalid_policy");
  }
  return normalized;
}

function assertCandidateReference(value: string): string {
  if (!CANDIDATE_ID_PATTERN.test(value)) {
    throw new SecureFileUploadValidationError("invalid_reservation");
  }
  return value;
}

function result(candidate: PublicConcernEvidenceCandidate): PublicConcernEvidenceUploadResult {
  return Object.freeze({
    candidateReference: candidate.candidateId,
    status: candidate.candidateStatus
  });
}

export class PublicConcernFileService {
  constructor(
    private readonly repository: PublicVerificationRepository,
    private readonly storage: PrivateObjectStorage
  ) {}

  async authorizeConcernUpload(
    concernReferenceInput: string
  ): Promise<PublicConcernUploadAuthority> {
    const concernReference = typeof concernReferenceInput === "string"
      ? concernReferenceInput.trim()
      : "";
    if (!CONCERN_ID_PATTERN.test(concernReference)) {
      throw new SecureFileUploadValidationError("invalid_reservation");
    }
    const concern = await this.repository.findReceivedConcern(concernReference);
    if (!concern || concern.concernId !== concernReference) {
      throw new SecureFileUploadValidationError("invalid_reservation");
    }

    const authority = Object.freeze({
      concernReference,
      owner: bindTrustedPublicConcernSecureFileOwner(concernReference),
      [TRUSTED_PUBLIC_CONCERN_UPLOAD_AUTHORITY]: true as const
    });
    TRUSTED_PUBLIC_CONCERN_UPLOAD_AUTHORITIES.add(authority);
    return authority;
  }

  private assertAuthority(
    authority: PublicConcernUploadAuthority
  ): PublicConcernUploadAuthority {
    if (
      !authority ||
      authority[TRUSTED_PUBLIC_CONCERN_UPLOAD_AUTHORITY] !== true ||
      !TRUSTED_PUBLIC_CONCERN_UPLOAD_AUTHORITIES.has(authority) ||
      !CONCERN_ID_PATTERN.test(authority.concernReference) ||
      authority.owner.authorityMode !== "public_concern" ||
      authority.owner.concernReference !== authority.concernReference
    ) {
      throw new SecureFileUploadValidationError("invalid_reservation");
    }
    return authority;
  }

  private async consumeUploadLimit(
    requestFingerprint: string,
    now: Date
  ): Promise<void> {
    const fingerprint = assertFingerprint(requestFingerprint);
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new SecureFileUploadValidationError("invalid_policy");
    }
    const count = await this.repository.consumeRateLimit({
      action: "concern_upload",
      bucketKey: fingerprint,
      now: now.toISOString(),
      resetBefore: new Date(now.getTime() - RATE_WINDOW_MS).toISOString()
    });
    if (count > CONCERN_UPLOAD_LIMIT) {
      throw new SecureFileUploadValidationError("invalid_policy");
    }
  }

  async uploadConcernEvidence(input: {
    authority: PublicConcernUploadAuthority;
    requestFingerprint: string;
    idempotencyNonce: string;
    originalFilename: string;
    declaredMime: string;
    bytes: Uint8Array;
    now?: Date;
  }): Promise<PublicConcernEvidenceUploadResult> {
    const authority = this.assertAuthority(input.authority);
    const nonce = assertNonce(input.idempotencyNonce);
    const now = input.now ?? new Date();
    await this.consumeUploadLimit(input.requestFingerprint, now);

    const policy = createDefaultSecureFileUploadPolicy();
    const proposedFileId = createSecureFileId();
    const proposedObjectKey = deriveSecureFileObjectKey(proposedFileId);
    const intent = createSecureFileReservationIntent({
      owner: authority.owner,
      businessReference: `concern-evidence:${nonce}`,
      displayFilename: input.originalFilename
    });

    // Validate before durable reservation so an unsupported/malformed file cannot
    // consume a permanent candidate slot.
    validateSecureFileUpload({
      policy,
      fileId: proposedFileId,
      objectKey: proposedObjectKey,
      reservedDisplayFilename: intent.displayFilename,
      originalFilename: input.originalFilename,
      declaredMime: input.declaredMime,
      bytes: input.bytes
    });

    const reservation = await this.repository.reserveConcernEvidenceCandidate({
      owner: authority.owner,
      intent,
      candidateId: createCandidateId(),
      fileId: proposedFileId,
      objectKey: proposedObjectKey
    });
    let candidate = reservation.candidate;
    if (candidate.candidateStatus !== "pending") return result(candidate);
    if (
      candidate.lifecycleStatus === "quarantined" ||
      candidate.lifecycleStatus === "scan_pending"
    ) {
      candidate = await this.repository.scheduleConcernEvidenceScan({
        owner: authority.owner,
        candidateId: candidate.candidateId
      });
      return result(candidate);
    }
    if (
      candidate.lifecycleStatus === "available" ||
      candidate.lifecycleStatus === "unsafe" ||
      candidate.lifecycleStatus === "scan_failed"
    ) {
      candidate = await this.repository.finalizeConcernEvidenceCandidate({
        owner: authority.owner,
        candidateId: candidate.candidateId
      });
      return result(candidate);
    }

    const validated = validateSecureFileUpload({
      policy,
      fileId: candidate.secureFileId,
      objectKey: candidate.objectKey,
      reservedDisplayFilename: candidate.displayFilename,
      originalFilename: input.originalFilename,
      declaredMime: input.declaredMime,
      bytes: input.bytes
    });
    const immutableBytes = materializeValidatedSecureFileUploadBytes(validated);

    try {
      await this.storage.put(candidate.objectKey, immutableBytes);
    } catch (error) {
      if (!(error instanceof PrivateObjectConflictError)) throw error;
      // A retry may arrive after bytes were stored but before quarantine metadata
      // committed. The stat/hash check below decides whether that object is safe
      // to continue with; a different object fails closed.
    }

    const storedStat = await this.storage.stat(candidate.objectKey);
    if (!storedStat) {
      throw new SecureFileUploadValidationError("stored_object_inconsistent");
    }
    const stored = confirmStoredSecureFileUpload(validated, storedStat);
    candidate = await this.repository.quarantineConcernEvidence({
      owner: authority.owner,
      candidateId: candidate.candidateId,
      upload: stored
    });
    if (candidate.candidateStatus !== "pending") return result(candidate);

    candidate = await this.repository.scheduleConcernEvidenceScan({
      owner: authority.owner,
      candidateId: candidate.candidateId
    });
    return result(candidate);
  }

  async finalizeConcernEvidenceCandidate(input: {
    authority: PublicConcernUploadAuthority;
    candidateReference: string;
  }): Promise<PublicConcernEvidenceUploadResult> {
    const authority = this.assertAuthority(input.authority);
    const candidateReference = assertCandidateReference(input.candidateReference);
    const candidate = await this.repository.finalizeConcernEvidenceCandidate({
      owner: authority.owner,
      candidateId: candidateReference
    });
    return result(candidate);
  }
}

let service: PublicConcernFileService | null = null;

export async function getPublicConcernFileService(): Promise<PublicConcernFileService> {
  if (service) return service;
  const environment = getServerEnvironment();
  if (
    environment.appEnvironment !== "development" &&
    environment.appEnvironment !== "test"
  ) {
    // Production private object storage/scanner adapters remain provider-owned;
    // do not silently fall back to local disk.
    throw new SecureFileUploadValidationError("invalid_policy");
  }
  const database = await getDatabaseClient();
  service = new PublicConcernFileService(
    new PublicVerificationRepository(database),
    createLocalTestPrivateObjectStorage(environment.appEnvironment)
  );
  return service;
}
