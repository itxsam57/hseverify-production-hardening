"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getCompanyApplicationSecureFileService } from "@/lib/company/company-application-secure-file-service";
import {
  CompanyVerificationAccessDeniedError,
  CompanyVerificationConflictError,
  CompanyVerificationContractError,
  CompanyVerificationNotFoundError,
  CompanyVerificationNotReadyError,
  type CompanySize
} from "@/lib/company/company-verification-domain";
import { getCompanyVerificationService } from "@/lib/company/company-verification-service";
import {
  SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES,
  SecureFileUploadValidationError,
  createTrustedSecureFileUploadPolicy
} from "@/lib/secure-files/secure-file-upload-domain";
import {
  SecureFileAccessDeniedError,
  SecureFileReservationConflictError
} from "@/lib/secure-files/secure-file-domain";

export type CompanyVerificationActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message: string | null;
  fieldErrors: Readonly<Record<string, string>>;
}>;

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

function state(
  status: CompanyVerificationActionState["status"],
  message: string,
  fieldErrors: Readonly<Record<string, string>> = {}
): CompanyVerificationActionState {
  return Object.freeze({ status, message, fieldErrors: Object.freeze({ ...fieldErrors }) });
}

function failure(error: unknown): CompanyVerificationActionState {
  if (
    error instanceof CompanyVerificationConflictError ||
    error instanceof SecureFileReservationConflictError
  ) {
    return state(
      "conflict",
      error instanceof CompanyVerificationConflictError
        ? error.message
        : "The Company verification record changed in another request. The latest state has been reloaded."
    );
  }
  if (error instanceof CompanyVerificationNotReadyError) {
    return state("error", error.message);
  }
  if (
    error instanceof CompanyVerificationAccessDeniedError ||
    error instanceof SecureFileAccessDeniedError
  ) {
    return state(
      "error",
      "Your current session is not authorized to change this Company verification record."
    );
  }
  if (error instanceof SecureFileUploadValidationError) {
    return state(
      "error",
      error.reason === "oversize"
        ? "The Company evidence file is too large. Maximum size is 10 MB."
        : "The Company evidence file could not be accepted safely. Use a genuine PDF, PNG or JPEG matching its filename and MIME type."
    );
  }
  if (error instanceof CompanyVerificationContractError) {
    return state("error", error.message);
  }
  if (error instanceof CompanyVerificationNotFoundError) {
    return state("error", "The Company verification case is unavailable. Sign in again if your session changed.");
  }
  return state(
    "error",
    "The Company verification request could not be completed safely. No submitted Company history was overwritten."
  );
}

function refresh(): void {
  revalidatePath("/company/settings/profile");
  revalidatePath("/company/dashboard");
}

async function companyPrincipal() {
  return requirePortalAuthorization("company");
}

export async function saveCompanyVerificationDraftAction(
  _previousState: CompanyVerificationActionState,
  formData: FormData
): Promise<CompanyVerificationActionState> {
  const expectedDraftRevision = integer(formData, "expectedDraftRevision");
  if (expectedDraftRevision === null) {
    return state("conflict", "The Company form is stale. Reload it before saving.");
  }
  try {
    const principal = await companyPrincipal();
    await getCompanyVerificationService().saveDraft({
      principal,
      expectedDraftRevision,
      draft: {
        legalName: optionalText(formData, "legalName"),
        tradingName: optionalText(formData, "tradingName"),
        registrationNumber: optionalText(formData, "registrationNumber"),
        country: optionalText(formData, "country"),
        industry: optionalText(formData, "industry"),
        companySize: optionalText(formData, "companySize") as CompanySize | null,
        website: optionalText(formData, "website"),
        authorizedRepresentative: optionalText(formData, "authorizedRepresentative"),
        businessPhone: optionalText(formData, "businessPhone")
      }
    });
    refresh();
    return state("success", "Company details saved.");
  } catch (error) {
    return failure(error);
  }
}

export async function uploadCompanyVerificationEvidenceAction(
  _previousState: CompanyVerificationActionState,
  formData: FormData
): Promise<CompanyVerificationActionState> {
  const upload = formData.get("file");
  if (!(upload instanceof File) || upload.size < 1) {
    return state("error", "Choose a Company evidence file.", { file: "A file is required." });
  }
  if (upload.size > SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES) {
    return state("error", "The Company evidence file is too large.", { file: "Maximum file size is 10 MB." });
  }
  const evidenceLabel = text(formData, "evidenceLabel");
  const expectedActiveBindingId = optionalText(formData, "expectedActiveBindingId");

  try {
    const principal = await companyPrincipal();
    const verification = getCompanyVerificationService();
    const snapshot = await verification.loadOwn(principal);
    if (snapshot.currentVersion.versionStatus !== "draft") {
      throw new CompanyVerificationConflictError("Submitted Company evidence cannot be replaced.");
    }
    const files = getCompanyApplicationSecureFileService();
    const reservation = await files.reserve({
      principal,
      businessReference: [
        "company-verification",
        snapshot.currentVersion.versionId,
        randomBytes(10).toString("hex")
      ].join(":"),
      displayFilename: upload.name
    });
    const policy = createTrustedSecureFileUploadPolicy({
      policyKey: "company.verification.evidence",
      allowedKinds: ["pdf", "png", "jpeg"],
      maxBytes: SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES
    });
    await files.quarantine({
      principal,
      policy,
      fileId: reservation.file.fileId,
      originalFilename: upload.name,
      declaredMime: upload.type,
      bytes: new Uint8Array(await upload.arrayBuffer())
    });
    await files.scheduleScan({ principal, fileId: reservation.file.fileId });
    await files.settleLocalScan(principal, reservation.file.fileId);
    const scanned = await files.find(principal, reservation.file.fileId);
    if (!scanned || scanned.lifecycleStatus !== "available") {
      return state(
        "error",
        scanned?.lifecycleStatus === "unsafe"
          ? "The uploaded Company evidence failed malware safety checks and was not attached."
          : "The Company evidence is still quarantined for security scanning and cannot be attached yet."
      );
    }
    await verification.bindEvidence({
      principal,
      secureFileId: scanned.fileId,
      evidenceLabel,
      expectedActiveBindingId
    });
    refresh();
    return state("success", "Company evidence uploaded, security-scanned and attached to this verification version.");
  } catch (error) {
    return failure(error);
  }
}

export async function submitCompanyVerificationAction(
  _previousState: CompanyVerificationActionState,
  formData: FormData
): Promise<CompanyVerificationActionState> {
  const expectedLockVersion = integer(formData, "expectedLockVersion");
  if (expectedLockVersion === null) return state("conflict", "The Company status is stale. Reload and try again.");
  try {
    const principal = await companyPrincipal();
    await getCompanyVerificationService().submit({ principal, expectedLockVersion });
    refresh();
    return state("success", "Company verification submitted. Submitted details and evidence are now immutable.");
  } catch (error) {
    return failure(error);
  }
}

export async function withdrawCompanyVerificationAction(
  _previousState: CompanyVerificationActionState,
  formData: FormData
): Promise<CompanyVerificationActionState> {
  const expectedLockVersion = integer(formData, "expectedLockVersion");
  if (expectedLockVersion === null) return state("conflict", "The Company status is stale. Reload and try again.");
  try {
    const principal = await companyPrincipal();
    await getCompanyVerificationService().withdraw({ principal, expectedLockVersion });
    refresh();
    return state("success", "Company verification was withdrawn before review began. Audit and anti-fraud history was retained.");
  } catch (error) {
    return failure(error);
  }
}

export async function startCompanyVerificationCorrectionAction(
  _previousState: CompanyVerificationActionState,
  formData: FormData
): Promise<CompanyVerificationActionState> {
  const expectedLockVersion = integer(formData, "expectedLockVersion");
  if (expectedLockVersion === null) return state("conflict", "The Company status is stale. Reload and try again.");
  try {
    const principal = await companyPrincipal();
    await getCompanyVerificationService().startCorrection({ principal, expectedLockVersion });
    refresh();
    return state("success", "A new Company verification version was created. Earlier submitted history remains unchanged.");
  } catch (error) {
    return failure(error);
  }
}
