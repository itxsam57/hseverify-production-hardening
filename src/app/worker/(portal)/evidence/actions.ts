"use server";

import { revalidatePath } from "next/cache";

import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { settleLocalWorkerIdentityFileScan } from "@/lib/identity/worker-identity-local-processing-service";
import {
  SecureFileAccessDeniedError,
  SecureFileReservationConflictError
} from "@/lib/secure-files/secure-file-domain";
import { getSecureFileScanService } from "@/lib/secure-files/secure-file-scan-service";
import { getSecureFileService } from "@/lib/secure-files/secure-file-service";
import {
  SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES,
  SecureFileUploadValidationError
} from "@/lib/secure-files/secure-file-upload-domain";
import { getSecureFileUploadService } from "@/lib/secure-files/secure-file-upload-service";
import {
  INITIAL_WORKER_EVIDENCE_ACTION_STATE,
  type WorkerEvidenceActionState
} from "@/lib/worker-evidence/worker-evidence-action-state";
import {
  WorkerEvidenceAttachmentService,
  type WorkerEvidenceAttachmentKind
} from "@/lib/worker-evidence/worker-evidence-attachment-service";
import {
  WORKER_EVIDENCE_RECORD_KINDS,
  WorkerEvidenceAttachmentUnavailableError,
  WorkerEvidenceConflictError,
  WorkerEvidenceContractError,
  WorkerEvidenceNotFoundError,
  type WorkerEvidenceRecordKind
} from "@/lib/worker-evidence/worker-evidence-domain";
import { WorkerEvidenceService } from "@/lib/worker-evidence/worker-evidence-service";

function state(
  status: WorkerEvidenceActionState["status"],
  message: string,
  fieldErrors: Readonly<Record<string, string>> = {}
): WorkerEvidenceActionState {
  return Object.freeze({
    status,
    message,
    fieldErrors: Object.freeze(fieldErrors)
  });
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function optionalText(formData: FormData, name: string): string | null {
  const value = text(formData, name).trim();
  return value.length > 0 ? value : null;
}

function positiveInteger(formData: FormData, name: string): number | null {
  const value = text(formData, name).trim();
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalNonNegativeInteger(
  formData: FormData,
  name: string
): number | null {
  const value = text(formData, name).trim();
  if (value.length === 0) return null;
  if (!/^\d+$/.test(value)) {
    throw new WorkerEvidenceContractError(
      "Skill experience duration must be a whole number of months."
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new WorkerEvidenceContractError(
      "Skill experience duration is invalid."
    );
  }
  return parsed;
}

function evidenceService(): WorkerEvidenceService {
  return new WorkerEvidenceService(getDatabaseClient());
}

function attachmentService(): WorkerEvidenceAttachmentService {
  return new WorkerEvidenceAttachmentService(
    getDatabaseClient(),
    getSecureFileService(),
    getSecureFileUploadService(),
    getSecureFileScanService(),
    settleLocalWorkerIdentityFileScan
  );
}

function revalidateEvidence(): void {
  revalidatePath("/worker/evidence");
  revalidatePath("/worker/dashboard");
}

function failure(error: unknown): WorkerEvidenceActionState {
  if (
    error instanceof WorkerEvidenceConflictError ||
    error instanceof SecureFileReservationConflictError
  ) {
    return state(
      "conflict",
      "This evidence record changed in another request. The latest state has been preserved; reload and review it before trying again."
    );
  }
  if (error instanceof WorkerEvidenceAttachmentUnavailableError) {
    return state(
      "error",
      "The selected file is not safely available yet. Wait for security scanning to complete, or upload a genuine PDF, PNG or JPEG if the scan failed."
    );
  }
  if (error instanceof SecureFileUploadValidationError) {
    return state(
      "error",
      error.reason === "oversize"
        ? "The file is too large. Worker evidence is limited to 10 MB per file."
        : "The file could not be accepted safely. Use a genuine PDF, PNG or JPEG that matches its filename and file type."
    );
  }
  if (error instanceof SecureFileAccessDeniedError) {
    return state(
      "error",
      "Your current session can no longer change this evidence. Sign in again if the session expired."
    );
  }
  if (error instanceof WorkerEvidenceContractError) {
    return state("error", error.message);
  }
  if (error instanceof WorkerEvidenceNotFoundError) {
    return state(
      "error",
      "The evidence record is unavailable. Reload the page and try again."
    );
  }
  return state(
    "error",
    "The evidence request could not be completed safely. No accepted evidence history was overwritten."
  );
}

async function workerPrincipal() {
  return requirePortalAuthorization("worker");
}

function recordKind(value: string): WorkerEvidenceRecordKind | null {
  return WORKER_EVIDENCE_RECORD_KINDS.includes(
    value as WorkerEvidenceRecordKind
  )
    ? (value as WorkerEvidenceRecordKind)
    : null;
}

export async function createWorkerEvidenceRecordAction(
  _previousState: WorkerEvidenceActionState = INITIAL_WORKER_EVIDENCE_ACTION_STATE,
  formData: FormData
): Promise<WorkerEvidenceActionState> {
  const kind = recordKind(text(formData, "kind"));
  if (!kind) return state("error", "Select a valid evidence record type.");

  try {
    const principal = await workerPrincipal();
    await evidenceService().createDraft(principal, kind);
    revalidateEvidence();
    return state("success", `${kind[0].toUpperCase()}${kind.slice(1)} draft created.`);
  } catch (error) {
    return failure(error);
  }
}

export async function saveWorkerEvidenceDraftAction(
  _previousState: WorkerEvidenceActionState,
  formData: FormData
): Promise<WorkerEvidenceActionState> {
  const recordId = text(formData, "recordId").trim();
  const expectedRevision = positiveInteger(formData, "expectedRevision");
  if (!recordId || expectedRevision === null) {
    return state("error", "The evidence form is stale. Reload the page and try again.");
  }

  try {
    const principal = await workerPrincipal();
    const service = evidenceService();
    const record = await service.findCurrent(principal, recordId);

    if (record.kind === "qualification") {
      await service.saveQualificationDraft(principal, {
        recordId,
        expectedRevision,
        title: optionalText(formData, "title"),
        category: optionalText(formData, "category"),
        issuingOrganization: optionalText(formData, "issuingOrganization"),
        learningProvider: optionalText(formData, "learningProvider"),
        certificateNumber: optionalText(formData, "certificateNumber"),
        issueDate: optionalText(formData, "issueDate"),
        expiryDate: optionalText(formData, "expiryDate"),
        level: optionalText(formData, "level"),
        country: optionalText(formData, "country"),
        verificationUrl: optionalText(formData, "verificationUrl"),
        declarationAccepted: text(formData, "declarationAccepted") === "on"
      });
    } else if (record.kind === "experience") {
      const status = text(formData, "status");
      if (status !== "current" && status !== "ended") {
        return state("error", "Select a valid experience status.");
      }
      await service.saveExperienceDraft(principal, {
        recordId,
        expectedRevision,
        companyName: optionalText(formData, "companyName"),
        roleTitle: optionalText(formData, "roleTitle"),
        duties: optionalText(formData, "duties"),
        country: optionalText(formData, "country"),
        startDate: optionalText(formData, "startDate"),
        endDate: optionalText(formData, "endDate"),
        status
      });
    } else if (record.kind === "employment") {
      const status = text(formData, "status");
      if (status !== "current" && status !== "ended") {
        return state("error", "Select a valid employment status.");
      }
      await service.saveEmploymentDraft(principal, {
        recordId,
        expectedRevision,
        companyName: optionalText(formData, "companyName"),
        roleTitle: optionalText(formData, "roleTitle"),
        duties: optionalText(formData, "duties"),
        country: optionalText(formData, "country"),
        startDate: optionalText(formData, "startDate"),
        endDate: optionalText(formData, "endDate"),
        status,
        endReason: optionalText(formData, "endReason")
      });
    } else {
      await service.saveSkillDraft(principal, {
        recordId,
        expectedRevision,
        skillName: optionalText(formData, "skillName"),
        category: optionalText(formData, "category"),
        proficiencyClaim: optionalText(formData, "proficiencyClaim"),
        experienceMonths: optionalNonNegativeInteger(formData, "experienceMonths"),
        relatedTrade: optionalText(formData, "relatedTrade")
      });
    }

    revalidateEvidence();
    return state("success", "Draft metadata saved with its current version.");
  } catch (error) {
    return failure(error);
  }
}

export async function uploadWorkerEvidenceFileAction(
  _previousState: WorkerEvidenceActionState,
  formData: FormData
): Promise<WorkerEvidenceActionState> {
  const recordId = text(formData, "recordId").trim();
  const versionId = text(formData, "versionId").trim();
  const expectedActiveAttachmentId = optionalText(
    formData,
    "expectedActiveAttachmentId"
  );
  const upload = formData.get("file");
  if (!recordId || !versionId) {
    return state("error", "The evidence file form is stale. Reload and try again.");
  }
  if (!(upload instanceof File) || upload.size < 1) {
    return state("error", "Choose a file to upload.", { file: "A file is required." });
  }
  if (upload.size > SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES) {
    return state("error", "The file is too large. Worker evidence is limited to 10 MB.", {
      file: "Maximum file size is 10 MB."
    });
  }

  try {
    const principal = await workerPrincipal();
    const record = await evidenceService().findCurrent(principal, recordId);
    if (record.currentVersion.versionId !== versionId) {
      throw new WorkerEvidenceConflictError();
    }

    let attachmentKind: WorkerEvidenceAttachmentKind;
    if (record.kind === "qualification") {
      attachmentKind =
        text(formData, "attachmentKind") === "supporting_evidence"
          ? "supporting_evidence"
          : "primary_certificate";
    } else if (record.kind === "experience") {
      attachmentKind = "experience_evidence";
    } else if (record.kind === "employment") {
      attachmentKind = "employment_evidence";
    } else {
      attachmentKind = "skill_evidence";
    }

    const result = await attachmentService().uploadAndBind(principal, {
      recordId,
      versionId,
      attachmentKind,
      expectedActiveAttachmentId,
      originalFilename: upload.name,
      declaredMime: upload.type,
      bytes: new Uint8Array(await upload.arrayBuffer())
    });
    revalidateEvidence();
    if ("candidateId" in result) {
      return state(
        "success",
        "File uploaded and queued for security scanning. It is not attached yet; use Check scan status after the scan completes."
      );
    }
    return state(
      "success",
      attachmentKind === "primary_certificate"
        ? "Certificate uploaded, security-scanned and bound to this qualification version."
        : "Evidence file uploaded, security-scanned and bound to this exact record version."
    );
  } catch (error) {
    return failure(error);
  }
}

export async function finalizeWorkerEvidenceFileCandidateAction(
  _previousState: WorkerEvidenceActionState,
  formData: FormData
): Promise<WorkerEvidenceActionState> {
  const candidateId = text(formData, "candidateId").trim();
  if (!candidateId) {
    return state("error", "The pending file state is stale. Reload and try again.");
  }
  try {
    const principal = await workerPrincipal();
    const finalized = await attachmentService().finalizePendingCandidate(
      principal,
      candidateId
    );
    revalidateEvidence();
    return state(
      "success",
      "leavingLetterId" in finalized
        ? "Security scan passed and the leaving letter is now attached to this employment."
        : "Security scan passed and the evidence file is now attached to this exact record version."
    );
  } catch (error) {
    return failure(error);
  }
}

export async function submitWorkerEvidenceAction(
  _previousState: WorkerEvidenceActionState,
  formData: FormData
): Promise<WorkerEvidenceActionState> {
  const recordId = text(formData, "recordId").trim();
  const expectedRevision = positiveInteger(formData, "expectedRevision");
  if (!recordId || expectedRevision === null) {
    return state("error", "The evidence state is stale. Reload and try again.");
  }
  try {
    const principal = await workerPrincipal();
    await evidenceService().submit(principal, recordId, expectedRevision);
    revalidateEvidence();
    return state("success", "Evidence version submitted. Its accepted history is now immutable.");
  } catch (error) {
    return failure(error);
  }
}

export async function startWorkerEvidenceRevisionAction(
  _previousState: WorkerEvidenceActionState,
  formData: FormData
): Promise<WorkerEvidenceActionState> {
  const recordId = text(formData, "recordId").trim();
  const expectedRevision = positiveInteger(formData, "expectedRevision");
  if (!recordId || expectedRevision === null) {
    return state("error", "The evidence state is stale. Reload and try again.");
  }
  try {
    const principal = await workerPrincipal();
    await evidenceService().startRevision(principal, recordId, expectedRevision);
    revalidateEvidence();
    return state(
      "success",
      "A new editable version was created. The submitted version remains preserved in history."
    );
  } catch (error) {
    return failure(error);
  }
}

export async function endWorkerEmploymentAction(
  _previousState: WorkerEvidenceActionState,
  formData: FormData
): Promise<WorkerEvidenceActionState> {
  const recordId = text(formData, "recordId").trim();
  const expectedRevision = positiveInteger(formData, "expectedRevision");
  const endDate = text(formData, "endDate").trim();
  if (!recordId || expectedRevision === null || !endDate) {
    return state("error", "Employment end date and current record version are required.");
  }
  try {
    const principal = await workerPrincipal();
    await evidenceService().endEmployment(
      principal,
      recordId,
      expectedRevision,
      endDate,
      optionalText(formData, "endReason")
    );
    revalidateEvidence();
    return state("success", "Employment ended. The previous submitted employment remains in history.");
  } catch (error) {
    return failure(error);
  }
}

export async function inactivateWorkerSkillAction(
  _previousState: WorkerEvidenceActionState,
  formData: FormData
): Promise<WorkerEvidenceActionState> {
  const recordId = text(formData, "recordId").trim();
  const expectedRevision = positiveInteger(formData, "expectedRevision");
  if (!recordId || expectedRevision === null) {
    return state("error", "The skill state is stale. Reload and try again.");
  }
  try {
    const principal = await workerPrincipal();
    await evidenceService().markSkillInactive(principal, recordId, expectedRevision);
    revalidateEvidence();
    return state("success", "Skill marked inactive without deleting its history.");
  } catch (error) {
    return failure(error);
  }
}

export async function uploadWorkerLeavingLetterAction(
  _previousState: WorkerEvidenceActionState,
  formData: FormData
): Promise<WorkerEvidenceActionState> {
  const recordId = text(formData, "recordId").trim();
  const versionId = text(formData, "versionId").trim();
  const expectedActiveLeavingLetterId = optionalText(
    formData,
    "expectedActiveLeavingLetterId"
  );
  const upload = formData.get("file");
  if (!recordId || !versionId) {
    return state("error", "The leaving letter form is stale. Reload and try again.");
  }
  if (!(upload instanceof File) || upload.size < 1) {
    return state("error", "Choose a leaving letter file.", {
      file: "A file is required."
    });
  }
  if (upload.size > SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES) {
    return state("error", "The leaving letter is too large. Files are limited to 10 MB.", {
      file: "Maximum file size is 10 MB."
    });
  }

  try {
    const principal = await workerPrincipal();
    const result = await attachmentService().uploadLeavingLetter(principal, {
      recordId,
      versionId,
      expectedActiveLeavingLetterId,
      originalFilename: upload.name,
      declaredMime: upload.type,
      bytes: new Uint8Array(await upload.arrayBuffer())
    });
    revalidateEvidence();
    if ("candidateId" in result) {
      return state(
        "success",
        "Leaving letter uploaded and queued for security scanning. The current accepted letter remains unchanged until the scan passes."
      );
    }
    return state(
      "success",
      expectedActiveLeavingLetterId
        ? "Leaving letter replacement scanned and attached safely; the previous letter remains in history."
        : "Leaving letter uploaded, security-scanned and bound to this ended employment."
    );
  } catch (error) {
    return failure(error);
  }
}
