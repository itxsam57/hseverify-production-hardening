import { randomBytes } from "node:crypto";

import { normalizeSecureFileReference } from "../secure-files/secure-file-domain";
import { WorkerIdentityContractError } from "./worker-identity-domain";

export const WORKER_IDENTITY_EVIDENCE_PURPOSES = [
  "identity_document",
  "profile_photo",
  "selfie"
] as const;

export const WORKER_IDENTITY_DOCUMENT_TYPES = [
  "passport",
  "national_id",
  "residence_permit"
] as const;

export type WorkerIdentityEvidencePurpose =
  (typeof WORKER_IDENTITY_EVIDENCE_PURPOSES)[number];
export type WorkerIdentityDocumentType =
  (typeof WORKER_IDENTITY_DOCUMENT_TYPES)[number];

export type WorkerIdentityEvidenceBindingInput = Readonly<{
  purpose: WorkerIdentityEvidencePurpose;
  secureFileId: string;
  documentType: WorkerIdentityDocumentType | null;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
}>;

export type WorkerIdentityEvidenceBindingRecord = Readonly<{
  bindingId: string;
  identityVersionId: string;
  purpose: WorkerIdentityEvidencePurpose;
  secureFileId: string;
  documentType: WorkerIdentityDocumentType | null;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  status: "active" | "superseded";
  supersedesBindingId: string | null;
  createdAt: string;
  supersededAt: string | null;
}>;

export class WorkerIdentityEvidenceConflictError extends Error {
  constructor(
    message = "The Worker identity evidence changed before this operation completed."
  ) {
    super(message);
    this.name = "WorkerIdentityEvidenceConflictError";
  }
}

export class WorkerIdentityEvidenceUnavailableError extends Error {
  constructor() {
    super("The selected identity evidence is not available for binding.");
    this.name = "WorkerIdentityEvidenceUnavailableError";
  }
}

export function createWorkerIdentityEvidenceBindingId(): string {
  return `identity_evidence_${randomBytes(18).toString("base64url")}`;
}

export function normalizeWorkerIdentityEvidenceBindingReference(
  value: string | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new WorkerIdentityContractError("Identity evidence binding reference is invalid.");
  }
  const normalized = value.trim();
  if (!/^identity_evidence_[A-Za-z0-9_-]{24}$/.test(normalized)) {
    throw new WorkerIdentityContractError("Identity evidence binding reference is invalid.");
  }
  return normalized;
}

export function isWorkerIdentityEvidencePurpose(
  value: unknown
): value is WorkerIdentityEvidencePurpose {
  return (
    typeof value === "string" &&
    WORKER_IDENTITY_EVIDENCE_PURPOSES.includes(
      value as WorkerIdentityEvidencePurpose
    )
  );
}

export function isWorkerIdentityDocumentType(
  value: unknown
): value is WorkerIdentityDocumentType {
  return (
    typeof value === "string" &&
    WORKER_IDENTITY_DOCUMENT_TYPES.includes(value as WorkerIdentityDocumentType)
  );
}

function normalizeDocumentNumber(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    normalized.length < 3 ||
    normalized.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new WorkerIdentityContractError("Identity document number is invalid.");
  }
  return normalized;
}

function normalizeOptionalDate(value: string | null, label: string): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new WorkerIdentityContractError(`${label} is invalid.`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new WorkerIdentityContractError(`${label} is invalid.`);
  }
  return normalized;
}

export function normalizeWorkerIdentityEvidenceBindingInput(
  input: WorkerIdentityEvidenceBindingInput
): WorkerIdentityEvidenceBindingInput {
  if (!isWorkerIdentityEvidencePurpose(input.purpose)) {
    throw new WorkerIdentityContractError("Identity evidence purpose is invalid.");
  }
  const secureFileId = normalizeSecureFileReference(input.secureFileId);
  if (!secureFileId) {
    throw new WorkerIdentityContractError("Secure identity evidence reference is invalid.");
  }

  if (input.purpose !== "identity_document") {
    if (
      input.documentType !== null ||
      input.documentNumber !== null ||
      input.issueDate !== null ||
      input.expiryDate !== null
    ) {
      throw new WorkerIdentityContractError(
        "Photo and selfie evidence cannot carry identity-document metadata."
      );
    }
    return Object.freeze({
      purpose: input.purpose,
      secureFileId,
      documentType: null,
      documentNumber: null,
      issueDate: null,
      expiryDate: null
    });
  }

  if (!isWorkerIdentityDocumentType(input.documentType)) {
    throw new WorkerIdentityContractError("Identity document type is invalid.");
  }
  if (input.documentNumber === null) {
    throw new WorkerIdentityContractError("Identity document number is required.");
  }
  const documentNumber = normalizeDocumentNumber(input.documentNumber);
  const issueDate = normalizeOptionalDate(
    input.issueDate,
    "Identity document issue date"
  );
  const expiryDate = normalizeOptionalDate(
    input.expiryDate,
    "Identity document expiry date"
  );
  if (issueDate !== null && expiryDate !== null && issueDate > expiryDate) {
    throw new WorkerIdentityContractError(
      "Identity document issue date cannot be after its expiry date."
    );
  }

  return Object.freeze({
    purpose: input.purpose,
    secureFileId,
    documentType: input.documentType,
    documentNumber,
    issueDate,
    expiryDate
  });
}
