import "server-only";

import { bindTrustedSystemAuditActor } from "@/lib/audit/audit-domain";
import { DatabaseAuditRepository } from "@/lib/audit/audit-repository";
import type { DatabaseClient } from "@/lib/database/database";
import {
  createOutboxJobId,
  deriveOutboxIdempotencyKey
} from "@/lib/outbox/outbox-domain";
import {
  normalizePublicVerificationIdentifier,
  type PublicWorkerVerificationSource
} from "@/lib/public-verification/public-verification-domain";
import {
  PUBLIC_CONCERN_SECURE_FILE_OWNER_ACCOUNT_ID,
  PUBLIC_CONCERN_SECURE_FILE_OWNER_ROLE,
  SECURE_FILE_SCHEMA_VERSION,
  assertTrustedSecureFileOwner,
  assertTrustedSecureFileReservationIntent,
  deriveSecureFileObjectKey,
  normalizeSecureFileReference,
  type SecureFileLifecycleStatus,
  type TrustedSecureFileOwner,
  type TrustedSecureFileReservationIntent
} from "@/lib/secure-files/secure-file-domain";
import { deriveSecureFileScanBusinessKey } from "@/lib/secure-files/secure-file-scan-domain";
import {
  assertTrustedStoredSecureFileUpload,
  secureFileMatchesStoredUpload,
  type TrustedStoredSecureFileUpload
} from "@/lib/secure-files/secure-file-upload-domain";

export const PUBLIC_VERIFICATION_RATE_LIMIT_ACTIONS = Object.freeze([
  "lookup",
  "result",
  "concern",
  "concern_upload"
] as const);

export type PublicVerificationRateLimitAction =
  (typeof PUBLIC_VERIFICATION_RATE_LIMIT_ACTIONS)[number];

export type PublicVerificationRateLimitInput = {
  action: PublicVerificationRateLimitAction;
  bucketKey: string;
  now: string;
  resetBefore: string;
};

export const PUBLIC_VERIFICATION_CONCERN_CATEGORIES = Object.freeze([
  "identity_mismatch",
  "suspected_fraud",
  "status_dispute",
  "document_concern",
  "other"
] as const);

export type PublicVerificationConcernCategory =
  (typeof PUBLIC_VERIFICATION_CONCERN_CATEGORIES)[number];

export type CreatePublicVerificationConcernInput = Readonly<{
  concernId: string;
  subjectReferenceHash: string;
  category: PublicVerificationConcernCategory;
  description: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  idempotencyKey: string;
  requestFingerprintHash: string;
}>;

export type CreatePublicVerificationConcernResult = Readonly<{
  concernId: string;
  created: boolean;
}>;

export type PublicConcernEvidenceCandidateStatus =
  | "pending"
  | "bound"
  | "rejected";

export type PublicConcernEvidenceCandidate = Readonly<{
  candidateId: string;
  concernId: string;
  secureFileId: string;
  candidateStatus: PublicConcernEvidenceCandidateStatus;
  reservationKey: string;
  objectKey: string;
  displayFilename: string;
  lifecycleStatus: SecureFileLifecycleStatus;
  scanGeneration: number;
  scanJobId: string | null;
}>;

export type ReservePublicConcernEvidenceInput = Readonly<{
  owner: TrustedSecureFileOwner;
  intent: TrustedSecureFileReservationIntent;
  candidateId: string;
  fileId: string;
  objectKey: string;
}>;

export type ReservePublicConcernEvidenceResult = Readonly<{
  created: boolean;
  candidate: PublicConcernEvidenceCandidate;
}>;

type PublicWorkerRow = {
  permanent_worker_id: string;
  lifecycle_status: string;
  legal_first_name: string;
  legal_last_name: string;
  issued_at: string | Date;
};

type ConcernEvidenceRow = {
  candidate_id: string;
  concern_id: string;
  secure_file_id: string;
  candidate_status: string;
  reservation_key: string;
  object_key: string;
  display_filename: string;
  lifecycle_status: string;
  scan_generation: number | string;
  scan_job_id: string | null;
};

const HEX_64_PATTERN = /^[a-f0-9]{64}$/;
const CONCERN_ID_PATTERN = /^public_concern_[A-Za-z0-9_-]{24}$/;
const CANDIDATE_ID_PATTERN = /^public_concern_evidence_[A-Za-z0-9_-]{24}$/;
const EVIDENCE_STATUSES = ["pending", "bound", "rejected"] as const;

function assertConcernInput(input: CreatePublicVerificationConcernInput): void {
  if (!CONCERN_ID_PATTERN.test(input.concernId)) {
    throw new Error("Public verification concern ID is invalid.");
  }
  if (!HEX_64_PATTERN.test(input.subjectReferenceHash)) {
    throw new Error("Public verification concern subject hash is invalid.");
  }
  if (!PUBLIC_VERIFICATION_CONCERN_CATEGORIES.includes(input.category)) {
    throw new Error("Public verification concern category is invalid.");
  }
  if (
    input.description.length < 10 ||
    input.description.length > 4000 ||
    input.description !== input.description.trim()
  ) {
    throw new Error("Public verification concern description is invalid.");
  }
  if (
    input.contactName !== null &&
    (input.contactName.length < 1 ||
      input.contactName.length > 160 ||
      input.contactName !== input.contactName.trim())
  ) {
    throw new Error("Public verification concern contact name is invalid.");
  }
  if (
    input.contactEmail !== null &&
    (input.contactEmail.length < 3 ||
      input.contactEmail.length > 320 ||
      input.contactEmail !== input.contactEmail.trim())
  ) {
    throw new Error("Public verification concern contact email is invalid.");
  }
  if (
    input.contactPhone !== null &&
    (input.contactPhone.length < 8 ||
      input.contactPhone.length > 32 ||
      input.contactPhone !== input.contactPhone.trim())
  ) {
    throw new Error("Public verification concern contact phone is invalid.");
  }
  if (input.contactEmail === null && input.contactPhone === null) {
    throw new Error("Public verification concern requires a contact method.");
  }
  if (!HEX_64_PATTERN.test(input.idempotencyKey)) {
    throw new Error("Public verification concern idempotency key is invalid.");
  }
  if (!HEX_64_PATTERN.test(input.requestFingerprintHash)) {
    throw new Error("Public verification concern request fingerprint is invalid.");
  }
}

function normalizeTimestamp(value: string, label: string): string {
  if (typeof value !== "string" || value.length > 64) {
    throw new Error(`${label} is invalid.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed.toISOString();
}

function normalizeBucketKey(value: string): string {
  if (typeof value !== "string" || !HEX_64_PATTERN.test(value)) {
    throw new Error("Public verification rate-limit bucket is invalid.");
  }
  return value;
}

function normalizeAction(
  action: PublicVerificationRateLimitAction
): PublicVerificationRateLimitAction {
  if (!PUBLIC_VERIFICATION_RATE_LIMIT_ACTIONS.includes(action)) {
    throw new Error("Public verification rate-limit action is invalid.");
  }
  return action;
}

function timestamp(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Public Worker issue timestamp is invalid.");
  }
  return parsed.toISOString();
}

function assertPublicConcernOwner(ownerInput: TrustedSecureFileOwner): TrustedSecureFileOwner {
  const owner = assertTrustedSecureFileOwner(ownerInput);
  if (
    owner.authorityMode !== "public_concern" ||
    owner.accountId !== PUBLIC_CONCERN_SECURE_FILE_OWNER_ACCOUNT_ID ||
    owner.role !== PUBLIC_CONCERN_SECURE_FILE_OWNER_ROLE ||
    owner.tenantId !== null ||
    owner.membershipId !== null ||
    !owner.concernReference ||
    !CONCERN_ID_PATTERN.test(owner.concernReference)
  ) {
    throw new Error("Public concern secure-file authority is invalid.");
  }
  return owner;
}

function isSecureLifecycle(value: string): value is SecureFileLifecycleStatus {
  return [
    "reserved",
    "quarantined",
    "scan_pending",
    "available",
    "unsafe",
    "scan_failed"
  ].includes(value);
}

function evidenceFromRow(row: ConcernEvidenceRow): PublicConcernEvidenceCandidate {
  const scanGeneration = Number(row.scan_generation);
  if (
    !CANDIDATE_ID_PATTERN.test(row.candidate_id) ||
    !CONCERN_ID_PATTERN.test(row.concern_id) ||
    !normalizeSecureFileReference(row.secure_file_id) ||
    !EVIDENCE_STATUSES.includes(row.candidate_status as PublicConcernEvidenceCandidateStatus) ||
    !HEX_64_PATTERN.test(row.reservation_key) ||
    !/^secure-files\/[a-f0-9]{64}$/.test(row.object_key) ||
    row.display_filename.length < 1 ||
    row.display_filename.length > 180 ||
    !isSecureLifecycle(row.lifecycle_status) ||
    !Number.isSafeInteger(scanGeneration) ||
    scanGeneration < 0
  ) {
    throw new Error("Stored public concern evidence candidate is invalid.");
  }
  return Object.freeze({
    candidateId: row.candidate_id,
    concernId: row.concern_id,
    secureFileId: row.secure_file_id,
    candidateStatus: row.candidate_status as PublicConcernEvidenceCandidateStatus,
    reservationKey: row.reservation_key,
    objectKey: row.object_key,
    displayFilename: row.display_filename,
    lifecycleStatus: row.lifecycle_status,
    scanGeneration,
    scanJobId: row.scan_job_id
  });
}

const CONCERN_EVIDENCE_SELECT = `
SELECT candidates.candidate_id,
       candidates.concern_id,
       candidates.secure_file_id,
       candidates.candidate_status,
       files.reservation_key,
       files.object_key,
       files.display_filename,
       files.lifecycle_status,
       files.scan_generation,
       files.scan_job_id
  FROM public_verification_concern_evidence_candidates AS candidates
  JOIN platform_secure_files AS files
    ON files.file_id = candidates.secure_file_id`;

export class PublicVerificationRepository {
  private readonly concernInflight = new Map<
    string,
    Promise<CreatePublicVerificationConcernResult>
  >();

  constructor(private readonly database: DatabaseClient) {}

  async consumeRateLimit(
    input: PublicVerificationRateLimitInput
  ): Promise<number> {
    const action = normalizeAction(input.action);
    const bucketKey = normalizeBucketKey(input.bucketKey);
    const now = normalizeTimestamp(input.now, "Rate-limit timestamp");
    const resetBefore = normalizeTimestamp(
      input.resetBefore,
      "Rate-limit reset timestamp"
    );
    if (new Date(resetBefore).getTime() > new Date(now).getTime()) {
      throw new Error("Rate-limit reset timestamp cannot be after now.");
    }

    const result = await this.database.query<{
      attempt_count: number | bigint | string;
    }>(
      `INSERT INTO public_verification_rate_limits (
         action, bucket_key, window_started_at, attempt_count, updated_at
       ) VALUES ($1,$2,$3,1,$3)
       ON CONFLICT (action, bucket_key) DO UPDATE
       SET window_started_at = CASE
             WHEN public_verification_rate_limits.window_started_at <= $4 THEN $3
             ELSE public_verification_rate_limits.window_started_at
           END,
           attempt_count = CASE
             WHEN public_verification_rate_limits.window_started_at <= $4 THEN 1
             ELSE public_verification_rate_limits.attempt_count + 1
           END,
           updated_at = $3
       RETURNING attempt_count`,
      [action, bucketKey, now, resetBefore]
    );

    const count = Number(result.rows[0]?.attempt_count);
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error("Public verification rate-limit update returned no count.");
    }
    return count;
  }

  async findPublicWorkerByPermanentId(
    workerId: string
  ): Promise<PublicWorkerVerificationSource | null> {
    const identifier = normalizePublicVerificationIdentifier(workerId);
    if (!identifier || identifier.kind !== "worker") return null;

    const result = await this.database.query<PublicWorkerRow>(
      `SELECT worker_ids.permanent_worker_id,
              identities.lifecycle_status,
              drafts.legal_first_name,
              drafts.legal_last_name,
              worker_ids.issued_at
         FROM worker_identity_worker_ids AS worker_ids
         JOIN worker_identities AS identities
           ON identities.identity_id = worker_ids.identity_id
         JOIN worker_identity_versions AS current_versions
           ON current_versions.identity_id = identities.identity_id
          AND current_versions.version_number = identities.current_version_number
          AND current_versions.version_status = 'submitted'
         JOIN worker_identity_version_drafts AS drafts
           ON drafts.identity_version_id = current_versions.identity_version_id
        WHERE worker_ids.permanent_worker_id = $1
        LIMIT 1`,
      [identifier.normalizedIdentifier]
    );
    const row = result.rows[0];
    if (!row) return null;

    return Object.freeze({
      permanentWorkerId: row.permanent_worker_id,
      lifecycleStatus: row.lifecycle_status,
      legalFirstName: row.legal_first_name,
      legalLastName: row.legal_last_name,
      issuedAt: timestamp(row.issued_at)
    });
  }

  async findReceivedConcern(concernReference: string): Promise<Readonly<{
    concernId: string;
    subjectReferenceHash: string;
  }> | null> {
    if (!CONCERN_ID_PATTERN.test(concernReference)) return null;
    const result = await this.database.query<{
      concern_id: string;
      subject_reference_hash: string;
    }>(
      `SELECT concern_id, subject_reference_hash
         FROM public_verification_concerns
        WHERE concern_id=$1 AND intake_status='received'`,
      [concernReference]
    );
    const row = result.rows[0];
    if (!row || !HEX_64_PATTERN.test(row.subject_reference_hash)) return null;
    return Object.freeze({
      concernId: row.concern_id,
      subjectReferenceHash: row.subject_reference_hash
    });
  }

  async reserveConcernEvidenceCandidate(
    input: ReservePublicConcernEvidenceInput
  ): Promise<ReservePublicConcernEvidenceResult> {
    const owner = assertPublicConcernOwner(input.owner);
    const intent = assertTrustedSecureFileReservationIntent(input.intent);
    if (!CANDIDATE_ID_PATTERN.test(input.candidateId)) {
      throw new Error("Public concern evidence candidate ID is invalid.");
    }
    const fileId = normalizeSecureFileReference(input.fileId);
    if (!fileId || input.objectKey !== deriveSecureFileObjectKey(fileId)) {
      throw new Error("Public concern evidence file reservation is invalid.");
    }
    const concernId = owner.concernReference;
    if (!concernId) throw new Error("Public concern evidence authority is missing.");

    return this.database.transaction(async (transaction) => {
      const concern = await transaction.query<{ concern_id: string }>(
        `SELECT concern_id
           FROM public_verification_concerns
          WHERE concern_id=$1 AND intake_status='received'
          FOR UPDATE`,
        [concernId]
      );
      if (concern.rows[0]?.concern_id !== concernId) {
        throw new Error("Public concern evidence concern is unavailable.");
      }

      const inserted = await transaction.query<{ file_id: string }>(
        `INSERT INTO platform_secure_files (
           file_id, schema_version, reservation_key,
           owner_account_id, owner_role, tenant_id, membership_id,
           storage_adapter_key, object_key, display_filename, lifecycle_status
         ) VALUES ($1,$2,$3,$4,$5,NULL,NULL,'local_test',$6,$7,'reserved')
         ON CONFLICT (reservation_key) DO NOTHING
         RETURNING file_id`,
        [
          fileId,
          SECURE_FILE_SCHEMA_VERSION,
          intent.reservationKey,
          owner.accountId,
          owner.role,
          input.objectKey,
          intent.displayFilename
        ]
      );
      const created = Boolean(inserted.rows[0]);
      if (created) {
        await transaction.query(
          `INSERT INTO public_verification_concern_evidence_candidates (
             candidate_id, concern_id, secure_file_id, candidate_status
           ) VALUES ($1,$2,$3,'pending')`,
          [input.candidateId, concernId, fileId]
        );
      }

      const resolved = await transaction.query<ConcernEvidenceRow>(
        `${CONCERN_EVIDENCE_SELECT}
          WHERE candidates.concern_id=$1
            AND files.reservation_key=$2
            AND files.owner_account_id=$3
            AND files.owner_role=$4`,
        [concernId, intent.reservationKey, owner.accountId, owner.role]
      );
      const row = resolved.rows[0];
      if (!row) throw new Error("Public concern evidence reservation could not be resolved.");
      const candidate = evidenceFromRow(row);
      if (candidate.displayFilename !== intent.displayFilename) {
        throw new Error("Public concern evidence reservation conflicts with an existing upload.");
      }
      return Object.freeze({ created, candidate });
    });
  }

  async quarantineConcernEvidence(input: {
    owner: TrustedSecureFileOwner;
    candidateId: string;
    upload: TrustedStoredSecureFileUpload;
  }): Promise<PublicConcernEvidenceCandidate> {
    const owner = assertPublicConcernOwner(input.owner);
    const upload = assertTrustedStoredSecureFileUpload(input.upload);
    if (!CANDIDATE_ID_PATTERN.test(input.candidateId)) {
      throw new Error("Public concern evidence candidate ID is invalid.");
    }
    const concernId = owner.concernReference;
    if (!concernId) throw new Error("Public concern evidence authority is missing.");

    return this.database.transaction(async (transaction) => {
      const locked = await transaction.query<ConcernEvidenceRow>(
        `${CONCERN_EVIDENCE_SELECT}
          WHERE candidates.candidate_id=$1
            AND candidates.concern_id=$2
            AND files.file_id=$3
            AND files.owner_account_id=$4
            AND files.owner_role=$5
          FOR UPDATE OF candidates, files`,
        [input.candidateId, concernId, upload.fileId, owner.accountId, owner.role]
      );
      const row = locked.rows[0];
      if (!row) throw new Error("Public concern evidence candidate is unavailable.");
      const current = evidenceFromRow(row);
      if (current.candidateStatus !== "pending") return current;

      if (current.lifecycleStatus === "quarantined" || current.lifecycleStatus === "scan_pending") {
        const existing = await transaction.query<{
          file_extension: string | null;
          declared_mime: string | null;
          detected_mime: string | null;
          byte_size: number | string | null;
          content_sha256: string | null;
        }>(
          `SELECT file_extension, declared_mime, detected_mime, byte_size, content_sha256
             FROM platform_secure_files WHERE file_id=$1`,
          [current.secureFileId]
        );
        const file = existing.rows[0];
        if (!file || !secureFileMatchesStoredUpload({
          fileId: current.secureFileId,
          objectKey: current.objectKey,
          displayFilename: current.displayFilename,
          fileExtension: file.file_extension as TrustedStoredSecureFileUpload["fileExtension"],
          declaredMime: file.declared_mime as TrustedStoredSecureFileUpload["declaredMime"],
          detectedMime: file.detected_mime as TrustedStoredSecureFileUpload["detectedMime"],
          byteSize: file.byte_size === null ? null : Number(file.byte_size),
          contentSha256: file.content_sha256,
          lifecycleStatus: current.lifecycleStatus
        } as never, upload)) {
          throw new Error("Public concern evidence upload conflicts with stored content.");
        }
        return current;
      }
      if (current.lifecycleStatus !== "reserved") {
        return current;
      }

      const updated = await transaction.query<ConcernEvidenceRow>(
        `WITH changed AS (
           UPDATE platform_secure_files
              SET lifecycle_status='quarantined',
                  file_extension=$6,
                  declared_mime=$7,
                  detected_mime=$8,
                  byte_size=$9,
                  content_sha256=$10
            WHERE file_id=$3
              AND owner_account_id=$4
              AND owner_role=$5
              AND lifecycle_status='reserved'
            RETURNING file_id
         )
         ${CONCERN_EVIDENCE_SELECT}
         WHERE candidates.candidate_id=$1
           AND candidates.concern_id=$2
           AND files.file_id=(SELECT file_id FROM changed)`,
        [
          input.candidateId,
          concernId,
          upload.fileId,
          owner.accountId,
          owner.role,
          upload.fileExtension,
          upload.declaredMime,
          upload.detectedMime,
          upload.byteSize,
          upload.contentSha256
        ]
      );
      const updatedRow = updated.rows[0];
      if (!updatedRow) throw new Error("Public concern evidence quarantine failed.");

      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      await audit.append(bindTrustedSystemAuditActor("public-verification-intake"), {
        action: "secure_file.quarantined",
        outcome: "succeeded",
        target: { type: "secure_file", reference: upload.fileId },
        metadata: {
          policyKey: upload.policyKey,
          fileExtension: upload.fileExtension,
          declaredMime: upload.declaredMime,
          detectedMime: upload.detectedMime,
          byteSize: upload.byteSize,
          systemComponent: "public-verification-intake"
        }
      });
      return evidenceFromRow(updatedRow);
    });
  }

  async scheduleConcernEvidenceScan(input: {
    owner: TrustedSecureFileOwner;
    candidateId: string;
  }): Promise<PublicConcernEvidenceCandidate> {
    const owner = assertPublicConcernOwner(input.owner);
    const concernId = owner.concernReference;
    if (!concernId || !CANDIDATE_ID_PATTERN.test(input.candidateId)) {
      throw new Error("Public concern evidence scan authority is invalid.");
    }

    return this.database.transaction(async (transaction) => {
      const locked = await transaction.query<ConcernEvidenceRow & {
        content_sha256: string | null;
        byte_size: number | string | null;
      }>(
        `${CONCERN_EVIDENCE_SELECT.replace(
          "files.scan_job_id",
          "files.scan_job_id, files.content_sha256, files.byte_size"
        )}
          WHERE candidates.candidate_id=$1
            AND candidates.concern_id=$2
            AND files.owner_account_id=$3
            AND files.owner_role=$4
          FOR UPDATE OF candidates, files`,
        [input.candidateId, concernId, owner.accountId, owner.role]
      );
      const row = locked.rows[0];
      if (!row) throw new Error("Public concern evidence candidate is unavailable.");
      const current = evidenceFromRow(row);
      if (current.candidateStatus !== "pending") return current;
      if (current.lifecycleStatus === "scan_pending") return current;
      if (current.lifecycleStatus !== "quarantined" || !row.content_sha256) {
        throw new Error("Public concern evidence is not ready for scanning.");
      }

      const generation = 1;
      const businessKey = deriveSecureFileScanBusinessKey({
        fileRef: current.secureFileId,
        contentSha256: row.content_sha256,
        generation
      });
      const idempotencyKey = deriveOutboxIdempotencyKey(
        "secure_file.scan",
        businessKey,
        `account:${owner.accountId}`
      );
      const payload = JSON.stringify({
        fileRef: current.secureFileId,
        generation
      });
      const proposedJobId = createOutboxJobId();
      const inserted = await transaction.query<{ job_id: string }>(
        `INSERT INTO platform_outbox_jobs (
           job_id, job_type, schema_version, idempotency_key, payload,
           enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
         ) VALUES ($1,'secure_file.scan',1,$2,$3::jsonb,$4,$5,NULL,NULL)
         ON CONFLICT (job_type, idempotency_key) DO NOTHING
         RETURNING job_id`,
        [proposedJobId, idempotencyKey, payload, owner.accountId, owner.role]
      );
      const createdJob = Boolean(inserted.rows[0]);
      let jobId = inserted.rows[0]?.job_id ?? null;
      if (!jobId) {
        const existing = await transaction.query<{ job_id: string }>(
          `SELECT job_id FROM platform_outbox_jobs
            WHERE job_type='secure_file.scan' AND idempotency_key=$1`,
          [idempotencyKey]
        );
        jobId = existing.rows[0]?.job_id ?? null;
      }
      if (!jobId) throw new Error("Public concern evidence scan job could not be resolved.");

      const updated = await transaction.query<ConcernEvidenceRow>(
        `WITH changed AS (
           UPDATE platform_secure_files
              SET lifecycle_status='scan_pending',
                  scan_generation=$5,
                  scan_job_id=$6,
                  scan_result_code=NULL,
                  scan_completed_at=NULL
            WHERE file_id=$4
              AND owner_account_id=$2
              AND owner_role=$3
              AND lifecycle_status='quarantined'
            RETURNING file_id
         )
         ${CONCERN_EVIDENCE_SELECT}
         WHERE candidates.candidate_id=$1
           AND candidates.concern_id=$7
           AND files.file_id=(SELECT file_id FROM changed)`,
        [
          input.candidateId,
          owner.accountId,
          owner.role,
          current.secureFileId,
          generation,
          jobId,
          concernId
        ]
      );
      const updatedRow = updated.rows[0];
      if (!updatedRow) throw new Error("Public concern evidence scan scheduling failed.");

      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      const actor = bindTrustedSystemAuditActor("public-verification-intake");
      if (createdJob) {
        await audit.append(actor, {
          action: "outbox.job.enqueued",
          outcome: "succeeded",
          target: { type: "job", reference: jobId },
          metadata: {
            jobType: "secure_file.scan",
            systemComponent: "public-verification-intake"
          }
        });
      }
      await audit.append(actor, {
        action: "secure_file.scan.queued",
        outcome: "succeeded",
        target: { type: "secure_file", reference: current.secureFileId },
        metadata: {
          sourceJobId: jobId,
          generation,
          byteSize: row.byte_size === null ? null : Number(row.byte_size),
          systemComponent: "public-verification-intake"
        }
      });
      return evidenceFromRow(updatedRow);
    });
  }

  async finalizeConcernEvidenceCandidate(input: {
    owner: TrustedSecureFileOwner;
    candidateId: string;
  }): Promise<PublicConcernEvidenceCandidate> {
    const owner = assertPublicConcernOwner(input.owner);
    const concernId = owner.concernReference;
    if (!concernId || !CANDIDATE_ID_PATTERN.test(input.candidateId)) {
      throw new Error("Public concern evidence finalization authority is invalid.");
    }
    return this.database.transaction(async (transaction) => {
      const loaded = await transaction.query<ConcernEvidenceRow>(
        `${CONCERN_EVIDENCE_SELECT}
          WHERE candidates.candidate_id=$1
            AND candidates.concern_id=$2
            AND files.owner_account_id=$3
            AND files.owner_role=$4
          FOR UPDATE OF candidates, files`,
        [input.candidateId, concernId, owner.accountId, owner.role]
      );
      const row = loaded.rows[0];
      if (!row) throw new Error("Public concern evidence candidate is unavailable.");
      const current = evidenceFromRow(row);
      if (current.candidateStatus !== "pending") return current;

      let finalStatus: PublicConcernEvidenceCandidateStatus | null = null;
      if (current.lifecycleStatus === "available") finalStatus = "bound";
      if (current.lifecycleStatus === "unsafe" || current.lifecycleStatus === "scan_failed") {
        finalStatus = "rejected";
      }
      if (!finalStatus) return current;

      const updated = await transaction.query<ConcernEvidenceRow>(
        `WITH changed AS (
           UPDATE public_verification_concern_evidence_candidates
              SET candidate_status=$5, finalized_at=CURRENT_TIMESTAMP
            WHERE candidate_id=$1
              AND concern_id=$2
              AND secure_file_id=$6
              AND candidate_status='pending'
            RETURNING secure_file_id
         )
         ${CONCERN_EVIDENCE_SELECT}
         WHERE candidates.candidate_id=$1
           AND candidates.concern_id=$2
           AND files.owner_account_id=$3
           AND files.owner_role=$4
           AND files.file_id=(SELECT secure_file_id FROM changed)`,
        [
          input.candidateId,
          concernId,
          owner.accountId,
          owner.role,
          finalStatus,
          current.secureFileId
        ]
      );
      return updated.rows[0] ? evidenceFromRow(updated.rows[0]) : current;
    });
  }

  async createConcernWithAudit(
    input: CreatePublicVerificationConcernInput
  ): Promise<CreatePublicVerificationConcernResult> {
    assertConcernInput(input);

    const inFlight = this.concernInflight.get(input.idempotencyKey);
    if (inFlight) {
      const existing = await inFlight;
      return Object.freeze({ concernId: existing.concernId, created: false });
    }

    const operation = this.createConcernWithAuditTransaction(input);
    this.concernInflight.set(input.idempotencyKey, operation);
    try {
      return await operation;
    } finally {
      if (this.concernInflight.get(input.idempotencyKey) === operation) {
        this.concernInflight.delete(input.idempotencyKey);
      }
    }
  }

  private async createConcernWithAuditTransaction(
    input: CreatePublicVerificationConcernInput
  ): Promise<CreatePublicVerificationConcernResult> {
    return this.database.transaction(async (transaction) => {
      const inserted = await transaction.query<{ concern_id: string }>(
        `INSERT INTO public_verification_concerns (
           concern_id, subject_reference_hash, category, description,
           contact_name, contact_email, contact_phone, intake_status,
           idempotency_key, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'received',$8,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING concern_id`,
        [
          input.concernId,
          input.subjectReferenceHash,
          input.category,
          input.description,
          input.contactName,
          input.contactEmail,
          input.contactPhone,
          input.idempotencyKey
        ]
      );

      const created = Boolean(inserted.rows[0]);
      let concernId = inserted.rows[0]?.concern_id ?? null;
      if (!concernId) {
        const existing = await transaction.query<{ concern_id: string }>(
          `SELECT concern_id FROM public_verification_concerns WHERE idempotency_key=$1`,
          [input.idempotencyKey]
        );
        concernId = existing.rows[0]?.concern_id ?? null;
      }
      if (!concernId) {
        throw new Error("Public verification concern could not be resolved.");
      }

      if (created) {
        const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
        await audit.append(
          bindTrustedSystemAuditActor("public-verification-intake"),
          {
            action: "public_verification.concern.received",
            outcome: "succeeded",
            target: { type: "resource", reference: concernId },
            requestFingerprintHash: input.requestFingerprintHash,
            metadata: {
              category: input.category,
              systemComponent: "public-verification-intake"
            }
          }
        );
      }

      return Object.freeze({ concernId, created });
    });
  }
}
