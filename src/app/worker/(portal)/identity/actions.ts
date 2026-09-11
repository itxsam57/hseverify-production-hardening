"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import {
  INITIAL_WORKER_IDENTITY_ACTION_STATE,
  type WorkerIdentityActionState
} from "@/lib/identity/worker-identity-action-state";
import { WorkerIdentityCorrectionConflictError } from "@/lib/identity/worker-identity-correction-domain";
import { getWorkerIdentityCorrectionService } from "@/lib/identity/worker-identity-correction-service";
import {
  WorkerIdentityContactVerificationRequiredError,
  type WorkerIdentityDraftInput
} from "@/lib/identity/worker-identity-draft-domain";
import { getWorkerIdentityDraftService } from "@/lib/identity/worker-identity-draft-service";
import {
  WorkerIdentityEvidenceConflictError,
  WorkerIdentityEvidenceUnavailableError,
  isWorkerIdentityDocumentType,
  isWorkerIdentityEvidencePurpose,
  type WorkerIdentityDocumentType,
  type WorkerIdentityEvidencePurpose
} from "@/lib/identity/worker-identity-evidence-domain";
import { getWorkerIdentityEvidenceService } from "@/lib/identity/worker-identity-evidence-service";
import {
  WorkerIdentityAccessDeniedError,
  WorkerIdentityConflictError,
  WorkerIdentityContractError,
  WorkerIdentityNotFoundError
} from "@/lib/identity/worker-identity-domain";
import {
  settleLocalWorkerIdentityAutomatedChecks,
  settleLocalWorkerIdentityFileScan
} from "@/lib/identity/worker-identity-local-processing-service";
import { getWorkerIdentityService } from "@/lib/identity/worker-identity-service";
import { getWorkerIdentityCheckService } from "@/lib/identity/worker-identity-check-service";
import {
  SecureFileAccessDeniedError,
  SecureFileReservationConflictError
} from "@/lib/secure-files/secure-file-domain";
import { getSecureFileScanService } from "@/lib/secure-files/secure-file-scan-service";
import { getSecureFileService } from "@/lib/secure-files/secure-file-service";
import {
  SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES,
  SecureFileUploadValidationError,
  createTrustedSecureFileUploadPolicy
} from "@/lib/secure-files/secure-file-upload-domain";
import { getSecureFileUploadService } from "@/lib/secure-files/secure-file-upload-service";

function revalidateIdentity(): void {
  revalidatePath("/worker/identity");
  revalidatePath("/worker/dashboard");
}

function state(
  status: WorkerIdentityActionState["status"],
  message: string,
  fieldErrors: Readonly<Record<string, string>> = {}
): WorkerIdentityActionState {
  return Object.freeze({ status, message, fieldErrors: Object.freeze(fieldErrors) });
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function optionalText(formData: FormData, name: string): string | null {
  const value = text(formData, name).trim();
  return value.length === 0 ? null : value;
}

function integer(formData: FormData, name: string): number | null {
  const value = text(formData, name);
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function identityFailure(error: unknown): WorkerIdentityActionState {
  if (
    error instanceof WorkerIdentityConflictError ||
    error instanceof WorkerIdentityEvidenceConflictError ||
    error instanceof WorkerIdentityCorrectionConflictError ||
    error instanceof SecureFileReservationConflictError
  ) {
    return state(
      "conflict",
      "Your identity changed in another request. The latest state has been reloaded; review it before trying again."
    );
  }
  if (error instanceof WorkerIdentityContactVerificationRequiredError) {
    return state(
      "error",
      "Verified email and phone are required before identity details can be saved."
    );
  }
  if (
    error instanceof WorkerIdentityAccessDeniedError ||
    error instanceof SecureFileAccessDeniedError
  ) {
    return state(
      "error",
      "Your current session no longer has permission to change this identity. Sign in again if the session expired."
    );
  }
  if (error instanceof WorkerIdentityEvidenceUnavailableError) {
    return state(
      "error",
      "The selected evidence is not safely available. Upload a clean supported file and try again."
    );
  }
  if (error instanceof SecureFileUploadValidationError) {
    return state(
      "error",
      error.reason === "oversize"
        ? "The file is too large. Identity evidence is limited to 10 MB per file."
        : "The file could not be accepted safely. Use a genuine PDF, PNG or JPEG that matches its filename and file type."
    );
  }
  if (error instanceof WorkerIdentityContractError) {
    return state("error", error.message);
  }
  if (error instanceof WorkerIdentityNotFoundError) {
    return state(
      "error",
      "The Worker identity record is unavailable. Reload the page and try again."
    );
  }
  return state(
    "error",
    "The identity request could not be completed safely. No accepted identity history was overwritten."
  );
}

async function workerPrincipal() {
  return requirePortalAuthorization("worker");
}

export async function saveWorkerIdentityDraftAction(
  _previousState: WorkerIdentityActionState = INITIAL_WORKER_IDENTITY_ACTION_STATE,
  formData: FormData
): Promise<WorkerIdentityActionState> {
  const expectedDraftRevision = integer(formData, "expectedDraftRevision");
  const hasDraft = text(formData, "hasDraft") === "true";
  if (hasDraft && expectedDraftRevision === null) {
    return state("error", "The identity form is stale. Reload the page and try again.");
  }

  const input: WorkerIdentityDraftInput = {
    legalFirstName: optionalText(formData, "legalFirstName"),
    legalLastName: optionalText(formData, "legalLastName"),
    previousLegalName: optionalText(formData, "previousLegalName"),
    dateOfBirth: optionalText(formData, "dateOfBirth"),
    nationality: optionalText(formData, "nationality"),
    countryOfResidence: optionalText(formData, "countryOfResidence")
  };

  try {
    const principal = await workerPrincipal();
    await getWorkerIdentityDraftService().save(
      principal,
      input,
      hasDraft ? expectedDraftRevision : null
    );
    revalidateIdentity();
    return state("success", "Identity details saved.");
  } catch (error) {
    return identityFailure(error);
  }
}

export async function submitWorkerIdentityAction(
  _previousState: WorkerIdentityActionState,
  formData: FormData
): Promise<WorkerIdentityActionState> {
  const expectedLockVersion = integer(formData, "expectedLockVersion");
  if (expectedLockVersion === null) {
    return state("error", "The identity form is stale. Reload the page and try again.");
  }
  try {
    const principal = await workerPrincipal();
    await getWorkerIdentityService().submit(principal, expectedLockVersion);
    revalidateIdentity();
    return state(
      "success",
      "Identity submitted. Automated checks can now be scheduled."
    );
  } catch (error) {
    return identityFailure(error);
  }
}

export async function withdrawWorkerIdentityAction(
  _previousState: WorkerIdentityActionState,
  formData: FormData
): Promise<WorkerIdentityActionState> {
  const expectedLockVersion = integer(formData, "expectedLockVersion");
  if (expectedLockVersion === null) {
    return state("error", "The identity state is stale. Reload and try again.");
  }
  try {
    const principal = await workerPrincipal();
    await getWorkerIdentityService().withdraw(principal, expectedLockVersion);
    revalidateIdentity();
    return state("success", "Identity submission withdrawn before review began.");
  } catch (error) {
    return identityFailure(error);
  }
}

export async function uploadWorkerIdentityEvidenceAction(
  _previousState: WorkerIdentityActionState,
  formData: FormData
): Promise<WorkerIdentityActionState> {
  const purposeValue = text(formData, "purpose");
  if (!isWorkerIdentityEvidencePurpose(purposeValue)) {
    return state("error", "The evidence purpose is invalid.");
  }
  const purpose: WorkerIdentityEvidencePurpose = purposeValue;
  const expectedActiveBindingId = optionalText(formData, "expectedActiveBindingId");
  const upload = formData.get("file");
  if (!(upload instanceof File) || upload.size < 1) {
    return state("error", "Choose a file to upload.", {
      file: "A file is required."
    });
  }
  if (upload.size > SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES) {
    return state(
      "error",
      "The file is too large. Identity evidence is limited to 10 MB.",
      { file: "Maximum file size is 10 MB." }
    );
  }

  let documentType: WorkerIdentityDocumentType | null = null;
  let documentNumber: string | null = null;
  let issueDate: string | null = null;
  let expiryDate: string | null = null;
  if (purpose === "identity_document") {
    const documentTypeValue = text(formData, "documentType");
    if (!isWorkerIdentityDocumentType(documentTypeValue)) {
      return state("error", "Select a valid identity document type.", {
        documentType: "Document type is required."
      });
    }
    documentType = documentTypeValue;
    documentNumber = optionalText(formData, "documentNumber");
    issueDate = optionalText(formData, "issueDate");
    expiryDate = optionalText(formData, "expiryDate");
    if (!documentNumber) {
      return state("error", "Enter the identity document number.", {
        documentNumber: "Document number is required."
      });
    }
  }

  try {
    const principal = await workerPrincipal();
    const identity = await getWorkerIdentityService().ensureDraft(principal);
    if (identity.currentVersion.versionStatus !== "draft") {
      throw new WorkerIdentityConflictError(
        "Submitted identity evidence cannot be replaced. Start an authorized correction after verification."
      );
    }

    const files = getSecureFileService();
    const reservation = await files.reserveForPrincipal({
      principal,
      businessReference: [
        "identity-evidence",
        identity.currentVersion.identityVersionId,
        purpose,
        randomBytes(10).toString("hex")
      ].join(":"),
      displayFilename: upload.name
    });

    const policy = createTrustedSecureFileUploadPolicy({
      policyKey: `worker.identity.${purpose}`,
      allowedKinds:
        purpose === "identity_document" ? ["pdf", "png", "jpeg"] : ["png", "jpeg"],
      maxBytes: SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES
    });
    await getSecureFileUploadService().quarantineForPrincipal({
      principal,
      policy,
      fileId: reservation.file.fileId,
      originalFilename: upload.name,
      declaredMime: upload.type,
      bytes: new Uint8Array(await upload.arrayBuffer())
    });
    await getSecureFileScanService().scheduleForPrincipal({
      principal,
      fileRef: reservation.file.fileId
    });
    await settleLocalWorkerIdentityFileScan(principal, reservation.file.fileId);

    const scanned = await files.findForPrincipal(principal, reservation.file.fileId);
    if (!scanned || scanned.lifecycleStatus !== "available") {
      return state(
        "error",
        scanned?.lifecycleStatus === "unsafe"
          ? "The uploaded file failed malware safety checks and was not attached."
          : "The file is quarantined for security scanning. It cannot be attached until the scan completes successfully."
      );
    }

    await getWorkerIdentityEvidenceService().bind(
      principal,
      {
        purpose,
        secureFileId: scanned.fileId,
        documentType,
        documentNumber,
        issueDate,
        expiryDate
      },
      expectedActiveBindingId
    );
    revalidateIdentity();
    return state(
      "success",
      "Evidence uploaded, security-scanned and attached to this identity version."
    );
  } catch (error) {
    return identityFailure(error);
  }
}

export async function scheduleWorkerIdentityChecksAction(
  _previousState: WorkerIdentityActionState,
  _formData: FormData
): Promise<WorkerIdentityActionState> {
  try {
    const principal = await workerPrincipal();
    await getWorkerIdentityCheckService().scheduleOwn(principal);
    await settleLocalWorkerIdentityAutomatedChecks(principal);
    revalidateIdentity();
    return state(
      "success",
      "Automated identity checks were scheduled. These checks assist review and do not make the final verification decision."
    );
  } catch (error) {
    return identityFailure(error);
  }
}

export async function requestWorkerIdentityCorrectionAction(
  _previousState: WorkerIdentityActionState,
  formData: FormData
): Promise<WorkerIdentityActionState> {
  const expectedLockVersion = integer(formData, "expectedLockVersion");
  const reason = text(formData, "reason");
  if (expectedLockVersion === null) {
    return state(
      "error",
      "The verified identity state is stale. Reload and try again."
    );
  }
  try {
    const principal = await workerPrincipal();
    await getWorkerIdentityCorrectionService().requestOwn(principal, {
      reason,
      expectedLockVersion
    });
    revalidateIdentity();
    return state(
      "success",
      "Correction version created. The verified version remains preserved in history while you prepare the correction."
    );
  } catch (error) {
    return identityFailure(error);
  }
}

export async function submitWorkerIdentityCorrectionAction(
  _previousState: WorkerIdentityActionState,
  formData: FormData
): Promise<WorkerIdentityActionState> {
  const expectedLockVersion = integer(formData, "expectedLockVersion");
  if (expectedLockVersion === null) {
    return state("error", "The correction state is stale. Reload and try again.");
  }
  try {
    const principal = await workerPrincipal();
    await getWorkerIdentityCorrectionService().submitOwn(principal, expectedLockVersion);
    revalidateIdentity();
    return state(
      "success",
      "Correction version submitted. Existing verified history remains unchanged until an authorized decision is recorded."
    );
  } catch (error) {
    return identityFailure(error);
  }
}
