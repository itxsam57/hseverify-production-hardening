import "server-only";

import { randomBytes } from "node:crypto";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import {
  bindTrustedSecureFileOwner,
  createSecureFileReservationIntent,
  type SecureFileRecord
} from "../secure-files/secure-file-domain";
import type { SecureFileScanService } from "../secure-files/secure-file-scan-service";
import type { SecureFileService } from "../secure-files/secure-file-service";
import {
  createTrustedSecureFileUploadPolicy,
  SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES
} from "../secure-files/secure-file-upload-domain";
import type { SecureFileUploadService } from "../secure-files/secure-file-upload-service";
import {
  DatabaseWorkerEmploymentLeavingLetterRepository,
  type WorkerEmploymentLeavingLetterRecord
} from "./worker-employment-leaving-letter-repository";
import {
  assertWorkerEvidencePrincipal,
  createWorkerEvidenceId,
  normalizeOptionalText,
  WorkerEvidenceAttachmentUnavailableError,
  WorkerEvidenceConflictError,
  WorkerEvidenceContractError,
  WorkerEvidenceNotFoundError,
  type WorkerEvidenceRecordKind
} from "./worker-evidence-domain";
import {
  DatabaseWorkerEvidenceFileCandidateRepository,
  type WorkerEvidenceFileBindingKind,
  type WorkerEvidenceFileCandidateRecord
} from "./worker-evidence-file-candidate-repository";
import { DatabaseWorkerEvidenceRepository } from "./worker-evidence-repository";

export const WORKER_EVIDENCE_ATTACHMENT_KINDS = [
  "primary_certificate",
  "supporting_evidence",
  "experience_evidence",
  "employment_evidence",
  "skill_evidence"
] as const;

export type WorkerEvidenceAttachmentKind =
  (typeof WORKER_EVIDENCE_ATTACHMENT_KINDS)[number];

export type WorkerEvidenceAttachmentRecord = Readonly<{
  attachmentId: string;
  recordId: string;
  versionId: string;
  attachmentKind: WorkerEvidenceAttachmentKind;
  secureFileId: string;
  displayFilename: string;
  createdAt: string;
  supersededAt: string | null;
}>;

export type WorkerEvidencePendingFileCandidate = Readonly<{
  candidateId: string;
  recordId: string;
  versionId: string;
  bindingKind: WorkerEvidenceFileBindingKind;
  secureFileId: string;
  displayFilename: string;
  expectedActiveBindingId: string | null;
  scanStatus: SecureFileRecord["lifecycleStatus"];
  createdAt: string;
}>;

export type WorkerEvidenceFinalizedFile =
  | WorkerEvidenceAttachmentRecord
  | WorkerEmploymentLeavingLetterRecord;

export type { WorkerEmploymentLeavingLetterRecord };

type SecureFiles = Pick<
  SecureFileService,
  "reserveForPrincipal" | "findForPrincipal"
>;
type SecureUploads = Pick<SecureFileUploadService, "quarantineForPrincipal">;
type SecureScans = Pick<SecureFileScanService, "scheduleForPrincipal">;
type SettleFileScan = (
  principal: AuthorizationPrincipal,
  fileId: string
) => Promise<void>;

function assertAttachmentKindForRecord(
  kind: WorkerEvidenceRecordKind,
  attachmentKind: WorkerEvidenceAttachmentKind
): void {
  const valid =
    (kind === "qualification" &&
      (attachmentKind === "primary_certificate" ||
        attachmentKind === "supporting_evidence")) ||
    (kind === "experience" && attachmentKind === "experience_evidence") ||
    (kind === "employment" && attachmentKind === "employment_evidence") ||
    (kind === "skill" && attachmentKind === "skill_evidence");
  if (!valid) {
    throw new WorkerEvidenceContractError(
      "That evidence file type does not belong to this Worker record."
    );
  }
}

function assertExpectedSecureFile(
  file: SecureFileRecord | null,
  input: {
    accountId: string;
    reservationKey: string;
    displayFilename: string;
    lifecycleStatus?: "reserved" | "available";
  }
): SecureFileRecord {
  if (
    !file ||
    file.ownerAccountId !== input.accountId ||
    file.ownerRole !== "worker" ||
    file.tenantId !== null ||
    file.membershipId !== null ||
    file.reservationKey !== input.reservationKey ||
    file.displayFilename !== input.displayFilename ||
    (input.lifecycleStatus !== undefined &&
      file.lifecycleStatus !== input.lifecycleStatus)
  ) {
    throw new WorkerEvidenceAttachmentUnavailableError();
  }
  return file;
}

function pendingCandidate(
  candidate: WorkerEvidenceFileCandidateRecord,
  file: SecureFileRecord
): WorkerEvidencePendingFileCandidate {
  return Object.freeze({
    candidateId: candidate.candidateId,
    recordId: candidate.recordId,
    versionId: candidate.versionId,
    bindingKind: candidate.bindingKind,
    secureFileId: candidate.secureFileId,
    displayFilename: candidate.displayFilename,
    expectedActiveBindingId: candidate.expectedActiveBindingId,
    scanStatus: file.lifecycleStatus,
    createdAt: candidate.createdAt
  });
}

function assertScannableCandidateFile(file: SecureFileRecord): void {
  if (file.lifecycleStatus === "unsafe" || file.lifecycleStatus === "scan_failed") {
    throw new WorkerEvidenceAttachmentUnavailableError(
      file.lifecycleStatus === "unsafe"
        ? "Worker evidence file failed malware safety checks."
        : "Worker evidence file security scanning failed."
    );
  }
  if (
    file.lifecycleStatus !== "quarantined" &&
    file.lifecycleStatus !== "scan_pending" &&
    file.lifecycleStatus !== "available"
  ) {
    throw new WorkerEvidenceAttachmentUnavailableError();
  }
}

function workerEvidenceBusinessReference(input: {
  recordId: string;
  versionId: string;
  attachmentKind: WorkerEvidenceAttachmentKind;
}): string {
  const nonce = randomBytes(6).toString("hex");
  return [
    "worker-evidence",
    input.recordId,
    input.versionId,
    input.attachmentKind,
    nonce
  ].join(":");
}

function workerLeavingLetterBusinessReference(input: {
  recordId: string;
  versionId: string;
}): string {
  const nonce = randomBytes(6).toString("hex");
  return [
    "worker-evidence",
    input.recordId,
    input.versionId,
    "leaving_letter",
    nonce
  ].join(":");
}

export class WorkerEvidenceAttachmentService {
  private readonly repository: DatabaseWorkerEvidenceRepository;
  private readonly leavingLetters: DatabaseWorkerEmploymentLeavingLetterRepository;
  private readonly candidates: DatabaseWorkerEvidenceFileCandidateRepository;

  constructor(
    clientPromise: Promise<DatabaseClient>,
    private readonly secureFiles: SecureFiles,
    private readonly secureUploads: SecureUploads,
    private readonly secureScans: SecureScans,
    private readonly settleFileScan: SettleFileScan = async () => undefined,
    private readonly now: () => Date = () => new Date()
  ) {
    this.repository = new DatabaseWorkerEvidenceRepository(clientPromise);
    this.leavingLetters = new DatabaseWorkerEmploymentLeavingLetterRepository(
      clientPromise
    );
    this.candidates = new DatabaseWorkerEvidenceFileCandidateRepository(
      clientPromise
    );
  }

  async uploadAndBind(
    principal: AuthorizationPrincipal,
    input: Readonly<{
      recordId: string;
      versionId: string;
      attachmentKind: WorkerEvidenceAttachmentKind;
      expectedActiveAttachmentId: string | null;
      originalFilename: string;
      declaredMime: string;
      bytes: Uint8Array;
    }>
  ): Promise<WorkerEvidenceAttachmentRecord | WorkerEvidencePendingFileCandidate> {
    const worker = assertWorkerEvidencePrincipal(principal);
    const recordId = input.recordId.trim();
    const versionId = input.versionId.trim();
    const current = await this.repository.findCurrentForWorker(
      worker.accountId,
      recordId
    );
    if (!current) throw new WorkerEvidenceNotFoundError();
    if (
      current.currentVersion.versionId !== versionId ||
      current.currentVersion.status !== "draft"
    ) {
      throw new WorkerEvidenceConflictError(
        "Evidence files can only be changed on the current draft version."
      );
    }
    assertAttachmentKindForRecord(current.kind, input.attachmentKind);

    const displayFilename = normalizeOptionalText(input.originalFilename, 240);
    if (!displayFilename) {
      throw new WorkerEvidenceContractError("Evidence filename is required.");
    }
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1) {
      throw new WorkerEvidenceContractError("Evidence file is required.");
    }

    const businessReference = workerEvidenceBusinessReference({
      recordId,
      versionId,
      attachmentKind: input.attachmentKind
    });
    const owner = bindTrustedSecureFileOwner(worker);
    const expectedReservation = createSecureFileReservationIntent({
      owner,
      businessReference,
      displayFilename
    });
    const reservation = await this.secureFiles.reserveForPrincipal({
      principal: worker,
      businessReference,
      displayFilename
    });
    const reserved = assertExpectedSecureFile(reservation.file, {
      accountId: worker.accountId,
      reservationKey: expectedReservation.reservationKey,
      displayFilename,
      lifecycleStatus: "reserved"
    });

    const policy = createTrustedSecureFileUploadPolicy({
      policyKey: `worker.evidence.${input.attachmentKind}`,
      allowedKinds: ["pdf", "png", "jpeg"],
      maxBytes: SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES
    });
    await this.secureUploads.quarantineForPrincipal({
      principal: worker,
      fileId: reserved.fileId,
      originalFilename: displayFilename,
      declaredMime: input.declaredMime,
      bytes: input.bytes,
      policy
    });
    await this.secureScans.scheduleForPrincipal({
      principal: worker,
      fileRef: reserved.fileId
    });
    await this.settleFileScan(worker, reserved.fileId);

    const observed = assertExpectedSecureFile(
      await this.secureFiles.findForPrincipal(worker, reserved.fileId),
      {
        accountId: worker.accountId,
        reservationKey: expectedReservation.reservationKey,
        displayFilename
      }
    );
    assertScannableCandidateFile(observed);

    const candidate = await this.candidates.create({
      workerAccountId: worker.accountId,
      candidateId: createWorkerEvidenceId("evidence_file_candidate"),
      recordId,
      versionId,
      bindingKind: input.attachmentKind,
      secureFileId: observed.fileId,
      reservationKey: expectedReservation.reservationKey,
      displayFilename,
      expectedActiveBindingId:
        input.expectedActiveAttachmentId?.trim() || null,
      now: this.now().toISOString()
    });
    if (!candidate) throw new WorkerEvidenceNotFoundError();

    if (observed.lifecycleStatus === "available") {
      const finalized = await this.finalizePendingCandidate(
        worker,
        candidate.candidateId
      );
      if (!("attachmentId" in finalized)) {
        throw new WorkerEvidenceConflictError(
          "The evidence candidate finalized into the wrong binding type."
        );
      }
      return finalized;
    }
    return pendingCandidate(candidate, observed);
  }

  async finalizePendingCandidate(
    principal: AuthorizationPrincipal,
    candidateIdInput: string
  ): Promise<WorkerEvidenceFinalizedFile> {
    const worker = assertWorkerEvidencePrincipal(principal);
    const candidateId = candidateIdInput.trim();
    if (!candidateId) throw new WorkerEvidenceNotFoundError();
    const candidate = await this.candidates.findForWorker(
      worker.accountId,
      candidateId
    );
    if (!candidate || candidate.status !== "pending") {
      throw new WorkerEvidenceNotFoundError();
    }

    const scanned = assertExpectedSecureFile(
      await this.secureFiles.findForPrincipal(worker, candidate.secureFileId),
      {
        accountId: worker.accountId,
        reservationKey: candidate.reservationKey,
        displayFilename: candidate.displayFilename,
        lifecycleStatus: "available"
      }
    );
    const now = this.now().toISOString();

    if (candidate.bindingKind === "leaving_letter") {
      const finalized = await this.candidates.finalizeLeavingLetter({
        principal: worker,
        workerAccountId: worker.accountId,
        candidateId: candidate.candidateId,
        secureFileId: scanned.fileId,
        leavingLetterId: createWorkerEvidenceId("leaving_letter"),
        now
      });
      if (!finalized) throw new WorkerEvidenceNotFoundError();
      return finalized as WorkerEmploymentLeavingLetterRecord;
    }

    const finalized = await this.candidates.finalizeAttachment({
      principal: worker,
      workerAccountId: worker.accountId,
      candidateId: candidate.candidateId,
      secureFileId: scanned.fileId,
      attachmentId: createWorkerEvidenceId("evidence_attachment"),
      now
    });
    if (!finalized) throw new WorkerEvidenceNotFoundError();
    return finalized as WorkerEvidenceAttachmentRecord;
  }

  async listPendingForRecord(
    principal: AuthorizationPrincipal,
    recordIdInput: string
  ): Promise<readonly WorkerEvidencePendingFileCandidate[]> {
    const worker = assertWorkerEvidencePrincipal(principal);
    const recordId = recordIdInput.trim();
    const current = await this.repository.findCurrentForWorker(
      worker.accountId,
      recordId
    );
    if (!current) throw new WorkerEvidenceNotFoundError();

    const candidates = await this.candidates.listForWorker(
      worker.accountId,
      recordId
    );
    const pending: WorkerEvidencePendingFileCandidate[] = [];
    for (const candidate of candidates) {
      if (candidate.status !== "pending") continue;
      const file = assertExpectedSecureFile(
        await this.secureFiles.findForPrincipal(worker, candidate.secureFileId),
        {
          accountId: worker.accountId,
          reservationKey: candidate.reservationKey,
          displayFilename: candidate.displayFilename
        }
      );
      pending.push(pendingCandidate(candidate, file));
    }
    return Object.freeze(pending);
  }

  async listForRecord(
    principal: AuthorizationPrincipal,
    recordIdInput: string
  ): Promise<readonly WorkerEvidenceAttachmentRecord[]> {
    const worker = assertWorkerEvidencePrincipal(principal);
    const recordId = recordIdInput.trim();
    const current = await this.repository.findCurrentForWorker(
      worker.accountId,
      recordId
    );
    if (!current) throw new WorkerEvidenceNotFoundError();
    return (await this.repository.listAttachmentsForWorker(
      worker.accountId,
      recordId
    )) as readonly WorkerEvidenceAttachmentRecord[];
  }

  async uploadLeavingLetter(
    principal: AuthorizationPrincipal,
    input: Readonly<{
      recordId: string;
      versionId: string;
      expectedActiveLeavingLetterId: string | null;
      originalFilename: string;
      declaredMime: string;
      bytes: Uint8Array;
    }>
  ): Promise<WorkerEmploymentLeavingLetterRecord | WorkerEvidencePendingFileCandidate> {
    const worker = assertWorkerEvidencePrincipal(principal);
    const recordId = input.recordId.trim();
    const versionId = input.versionId.trim();
    const current = await this.repository.findCurrentForWorker(
      worker.accountId,
      recordId
    );
    if (!current || current.kind !== "employment") {
      throw new WorkerEvidenceNotFoundError();
    }
    if (
      current.lifecycleStatus !== "ended" ||
      current.currentVersion.versionId !== versionId ||
      current.currentVersion.status !== "submitted"
    ) {
      throw new WorkerEvidenceConflictError(
        "A leaving letter can only be attached to the current submitted ended employment version."
      );
    }

    const displayFilename = normalizeOptionalText(input.originalFilename, 240);
    if (!displayFilename) {
      throw new WorkerEvidenceContractError("Leaving letter filename is required.");
    }
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1) {
      throw new WorkerEvidenceContractError("Leaving letter file is required.");
    }

    const businessReference = workerLeavingLetterBusinessReference({
      recordId,
      versionId
    });
    const owner = bindTrustedSecureFileOwner(worker);
    const expectedReservation = createSecureFileReservationIntent({
      owner,
      businessReference,
      displayFilename
    });
    const reservation = await this.secureFiles.reserveForPrincipal({
      principal: worker,
      businessReference,
      displayFilename
    });
    const reserved = assertExpectedSecureFile(reservation.file, {
      accountId: worker.accountId,
      reservationKey: expectedReservation.reservationKey,
      displayFilename,
      lifecycleStatus: "reserved"
    });

    const policy = createTrustedSecureFileUploadPolicy({
      policyKey: "worker.evidence.leaving_letter",
      allowedKinds: ["pdf", "png", "jpeg"],
      maxBytes: SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES
    });
    await this.secureUploads.quarantineForPrincipal({
      principal: worker,
      fileId: reserved.fileId,
      originalFilename: displayFilename,
      declaredMime: input.declaredMime,
      bytes: input.bytes,
      policy
    });
    await this.secureScans.scheduleForPrincipal({
      principal: worker,
      fileRef: reserved.fileId
    });
    await this.settleFileScan(worker, reserved.fileId);

    const observed = assertExpectedSecureFile(
      await this.secureFiles.findForPrincipal(worker, reserved.fileId),
      {
        accountId: worker.accountId,
        reservationKey: expectedReservation.reservationKey,
        displayFilename
      }
    );
    assertScannableCandidateFile(observed);

    const candidate = await this.candidates.create({
      workerAccountId: worker.accountId,
      candidateId: createWorkerEvidenceId("evidence_file_candidate"),
      recordId,
      versionId,
      bindingKind: "leaving_letter",
      secureFileId: observed.fileId,
      reservationKey: expectedReservation.reservationKey,
      displayFilename,
      expectedActiveBindingId:
        input.expectedActiveLeavingLetterId?.trim() || null,
      now: this.now().toISOString()
    });
    if (!candidate) throw new WorkerEvidenceNotFoundError();

    if (observed.lifecycleStatus === "available") {
      const finalized = await this.finalizePendingCandidate(
        worker,
        candidate.candidateId
      );
      if (!("leavingLetterId" in finalized)) {
        throw new WorkerEvidenceConflictError(
          "The leaving-letter candidate finalized into the wrong binding type."
        );
      }
      return finalized;
    }
    return pendingCandidate(candidate, observed);
  }

  async listLeavingLetters(
    principal: AuthorizationPrincipal,
    recordIdInput: string
  ): Promise<readonly WorkerEmploymentLeavingLetterRecord[]> {
    const worker = assertWorkerEvidencePrincipal(principal);
    const recordId = recordIdInput.trim();
    const current = await this.repository.findCurrentForWorker(
      worker.accountId,
      recordId
    );
    if (!current || current.kind !== "employment") {
      throw new WorkerEvidenceNotFoundError();
    }
    return this.leavingLetters.listForWorker(worker.accountId, recordId);
  }
}
