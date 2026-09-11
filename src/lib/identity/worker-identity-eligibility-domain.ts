import { randomBytes } from "node:crypto";

export const WORKER_IDENTITY_DUPLICATE_SIGNAL_TYPES = [
  "verified_email_exact",
  "verified_phone_exact",
  "identity_document_exact",
  "legal_name_dob_exact"
] as const;

export const WORKER_IDENTITY_DUPLICATE_SIGNAL_STRENGTHS = [
  "high",
  "medium"
] as const;

export const WORKER_IDENTITY_DUPLICATE_CHECK_STATUSES = [
  "clear",
  "review_required"
] as const;

export const WORKER_IDENTITY_DUPLICATE_DISPOSITIONS = [
  "continue",
  "recover_existing_account",
  "duplicate_review",
  "block_worker_id"
] as const;

export type WorkerIdentityDuplicateSignalType =
  (typeof WORKER_IDENTITY_DUPLICATE_SIGNAL_TYPES)[number];
export type WorkerIdentityDuplicateSignalStrength =
  (typeof WORKER_IDENTITY_DUPLICATE_SIGNAL_STRENGTHS)[number];
export type WorkerIdentityDuplicateCheckStatus =
  (typeof WORKER_IDENTITY_DUPLICATE_CHECK_STATUSES)[number];
export type WorkerIdentityDuplicateDisposition =
  (typeof WORKER_IDENTITY_DUPLICATE_DISPOSITIONS)[number];

export type WorkerIdentityDuplicateFacts = Readonly<{
  identityId: string;
  identityVersionId: string;
  verifiedEmailNormalized: string;
  verifiedPhoneE164: string;
  legalFirstName: string;
  legalLastName: string;
  dateOfBirth: string;
  documentType: "passport" | "national_id" | "residence_permit";
  documentNumber: string;
}>;

export type WorkerIdentityDuplicateSignal = Readonly<{
  candidateIdentityId: string;
  candidateIdentityVersionId: string;
  signalType: WorkerIdentityDuplicateSignalType;
  strength: WorkerIdentityDuplicateSignalStrength;
}>;

export type WorkerIdentityDuplicateCheckRecord = Readonly<{
  checkId: string;
  identityId: string;
  identityVersionId: string;
  workerAccountId: string;
  checkSequence: number;
  checkStatus: WorkerIdentityDuplicateCheckStatus;
  createdAt: string;
}>;

export type WorkerIdentityDuplicateDispositionRecord = Readonly<{
  dispositionId: string;
  checkId: string;
  dispositionSequence: number;
  disposition: WorkerIdentityDuplicateDisposition;
  reasonCode: string;
  createdAt: string;
}>;

export type WorkerPermanentIdRecord = Readonly<{
  permanentWorkerId: string;
  identityId: string;
  identityVersionId: string;
  workerAccountId: string;
  issuedAt: string;
}>;

export type WorkerIdentityEligibilityStatus = Readonly<{
  duplicateStatus: WorkerIdentityDuplicateCheckStatus | "not_evaluated";
  latestDisposition: WorkerIdentityDuplicateDisposition | null;
  permanentWorkerId: string | null;
}>;

const TRUSTED_IDENTITY_ELIGIBILITY_AUTHORITY = Symbol(
  "trusted-worker-identity-eligibility-authority"
);
const TRUSTED_IDENTITY_ELIGIBILITY_AUTHORITIES = new WeakSet<object>();

export type TrustedWorkerIdentityEligibilityAuthority = Readonly<{
  component: "identity-assurance";
  [TRUSTED_IDENTITY_ELIGIBILITY_AUTHORITY]: true;
}>;

export class WorkerIdentityEligibilityContractError extends Error {
  constructor(message = "Worker identity eligibility data is invalid.") {
    super(message);
    this.name = "WorkerIdentityEligibilityContractError";
  }
}

export class WorkerIdentityEligibilityAuthorityError extends Error {
  constructor() {
    super("Worker identity eligibility authority is invalid.");
    this.name = "WorkerIdentityEligibilityAuthorityError";
  }
}

export class WorkerIdentityEligibilityConflictError extends Error {
  constructor(message = "Worker identity eligibility changed before this action completed.") {
    super(message);
    this.name = "WorkerIdentityEligibilityConflictError";
  }
}

export class WorkerIdentityWorkerIdBlockedError extends Error {
  constructor(message = "Permanent Worker ID issuance is not currently eligible.") {
    super(message);
    this.name = "WorkerIdentityWorkerIdBlockedError";
  }
}

export function createTrustedWorkerIdentityEligibilityAuthority(): TrustedWorkerIdentityEligibilityAuthority {
  const authority = Object.freeze({
    component: "identity-assurance" as const,
    [TRUSTED_IDENTITY_ELIGIBILITY_AUTHORITY]: true as const
  });
  TRUSTED_IDENTITY_ELIGIBILITY_AUTHORITIES.add(authority);
  return authority;
}

export function assertTrustedWorkerIdentityEligibilityAuthority(
  authority: TrustedWorkerIdentityEligibilityAuthority
): TrustedWorkerIdentityEligibilityAuthority {
  if (
    !authority ||
    authority.component !== "identity-assurance" ||
    !TRUSTED_IDENTITY_ELIGIBILITY_AUTHORITIES.has(authority)
  ) {
    throw new WorkerIdentityEligibilityAuthorityError();
  }
  return authority;
}

function opaque(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

export function createWorkerIdentityDuplicateCheckId(): string {
  return opaque("identity_duplicate_check");
}

export function createWorkerIdentityDuplicateSignalId(): string {
  return opaque("identity_duplicate_signal");
}

export function createWorkerIdentityDuplicateDispositionId(): string {
  return opaque("identity_duplicate_disposition");
}

export function createPermanentWorkerId(): string {
  return opaque("worker_id");
}

export function normalizeWorkerIdentityDuplicateCheckReference(value: string): string {
  const normalized = value.trim();
  if (!/^identity_duplicate_check_[A-Za-z0-9_-]{24}$/.test(normalized)) {
    throw new WorkerIdentityEligibilityContractError("Duplicate-check reference is invalid.");
  }
  return normalized;
}

export function normalizePermanentWorkerId(value: string): string {
  const normalized = value.trim();
  if (!/^worker_id_[A-Za-z0-9_-]{24}$/.test(normalized)) {
    throw new WorkerIdentityEligibilityContractError("Permanent Worker ID is invalid.");
  }
  return normalized;
}

export function normalizeWorkerIdentityDuplicateReasonCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 2 ||
    normalized.length > 120 ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(normalized)
  ) {
    throw new WorkerIdentityEligibilityContractError("Duplicate disposition reason code is invalid.");
  }
  return normalized;
}

export function isWorkerIdentityDuplicateDisposition(
  value: unknown
): value is WorkerIdentityDuplicateDisposition {
  return (
    typeof value === "string" &&
    WORKER_IDENTITY_DUPLICATE_DISPOSITIONS.includes(
      value as WorkerIdentityDuplicateDisposition
    )
  );
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string): string {
  return value.trim();
}

export function normalizeIdentityDocumentNumber(value: string): string {
  const normalized = value.normalize("NFKC").trim().toUpperCase().replace(/[\s-]+/g, "");
  if (normalized.length < 3 || normalized.length > 80 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new WorkerIdentityEligibilityContractError("Identity document number is invalid.");
  }
  return normalized;
}

export function normalizeIdentityLegalName(value: string): string {
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  if (normalized.length < 1 || normalized.length > 120 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new WorkerIdentityEligibilityContractError("Identity legal name is invalid.");
  }
  return normalized;
}

function sameLegalNameAndDob(
  target: WorkerIdentityDuplicateFacts,
  candidate: WorkerIdentityDuplicateFacts
): boolean {
  return (
    normalizeIdentityLegalName(target.legalFirstName) ===
      normalizeIdentityLegalName(candidate.legalFirstName) &&
    normalizeIdentityLegalName(target.legalLastName) ===
      normalizeIdentityLegalName(candidate.legalLastName) &&
    target.dateOfBirth === candidate.dateOfBirth
  );
}

export function evaluateWorkerIdentityDuplicateSignals(
  target: WorkerIdentityDuplicateFacts,
  candidates: readonly WorkerIdentityDuplicateFacts[]
): readonly WorkerIdentityDuplicateSignal[] {
  const signals: WorkerIdentityDuplicateSignal[] = [];
  const sortedCandidates = [...candidates].sort((left, right) =>
    left.identityId.localeCompare(right.identityId)
  );

  for (const candidate of sortedCandidates) {
    if (candidate.identityId === target.identityId) continue;
    const descriptors: readonly Readonly<{
      matched: boolean;
      signalType: WorkerIdentityDuplicateSignalType;
      strength: WorkerIdentityDuplicateSignalStrength;
    }>[] = [
      {
        matched:
          normalizeEmail(target.verifiedEmailNormalized) ===
          normalizeEmail(candidate.verifiedEmailNormalized),
        signalType: "verified_email_exact",
        strength: "high"
      },
      {
        matched:
          normalizePhone(target.verifiedPhoneE164) ===
          normalizePhone(candidate.verifiedPhoneE164),
        signalType: "verified_phone_exact",
        strength: "high"
      },
      {
        matched:
          target.documentType === candidate.documentType &&
          normalizeIdentityDocumentNumber(target.documentNumber) ===
            normalizeIdentityDocumentNumber(candidate.documentNumber),
        signalType: "identity_document_exact",
        strength: "high"
      },
      {
        matched: sameLegalNameAndDob(target, candidate),
        signalType: "legal_name_dob_exact",
        strength: "medium"
      }
    ];

    for (const descriptor of descriptors) {
      if (!descriptor.matched) continue;
      signals.push(
        Object.freeze({
          candidateIdentityId: candidate.identityId,
          candidateIdentityVersionId: candidate.identityVersionId,
          signalType: descriptor.signalType,
          strength: descriptor.strength
        })
      );
    }
  }

  return Object.freeze(signals);
}

export function duplicateCheckStatusFromSignals(
  signals: readonly WorkerIdentityDuplicateSignal[]
): WorkerIdentityDuplicateCheckStatus {
  return signals.length === 0 ? "clear" : "review_required";
}

export function dispositionAllowsPermanentWorkerId(
  checkStatus: WorkerIdentityDuplicateCheckStatus,
  latestDisposition: WorkerIdentityDuplicateDisposition | null
): boolean {
  if (checkStatus === "clear") return true;
  return latestDisposition === "continue";
}
