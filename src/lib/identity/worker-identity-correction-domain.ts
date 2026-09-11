import { randomBytes } from "node:crypto";

import { WorkerIdentityContractError } from "./worker-identity-domain";

export const WORKER_IDENTITY_CORRECTION_DECISIONS = [
  "accepted",
  "rejected"
] as const;

export type WorkerIdentityCorrectionDecision =
  (typeof WORKER_IDENTITY_CORRECTION_DECISIONS)[number];

export type WorkerIdentityCorrectionRecord = Readonly<{
  correctionRequestId: string;
  identityId: string;
  correctionVersionId: string;
  parentVersionId: string;
  requestedByAccountId: string;
  reason: string;
  requestedAt: string;
  submittedAt: string | null;
  decision: WorkerIdentityCorrectionDecision | null;
  decisionReasonCode: string | null;
  decidedAt: string | null;
}>;

export class WorkerIdentityCorrectionConflictError extends Error {
  constructor(message = "The Worker identity correction changed before this operation completed.") {
    super(message);
    this.name = "WorkerIdentityCorrectionConflictError";
  }
}

export class WorkerIdentityCorrectionNotFoundError extends Error {
  constructor() {
    super("The Worker identity correction is unavailable.");
    this.name = "WorkerIdentityCorrectionNotFoundError";
  }
}

const TRUSTED_CORRECTION_AUTHORITY = Symbol("trusted-worker-identity-correction-authority");
const TRUSTED_CORRECTION_AUTHORITIES = new WeakSet<object>();

export type TrustedWorkerIdentityCorrectionAuthority = Readonly<{
  component: "identity-assurance";
  [TRUSTED_CORRECTION_AUTHORITY]: true;
}>;

export function createTrustedWorkerIdentityCorrectionAuthority(): TrustedWorkerIdentityCorrectionAuthority {
  const authority = Object.freeze({
    component: "identity-assurance" as const,
    [TRUSTED_CORRECTION_AUTHORITY]: true as const
  });
  TRUSTED_CORRECTION_AUTHORITIES.add(authority);
  return authority;
}

export function assertTrustedWorkerIdentityCorrectionAuthority(
  authority: TrustedWorkerIdentityCorrectionAuthority
): TrustedWorkerIdentityCorrectionAuthority {
  if (!TRUSTED_CORRECTION_AUTHORITIES.has(authority)) {
    throw new WorkerIdentityCorrectionConflictError(
      "Worker identity correction decision authority is invalid."
    );
  }
  return authority;
}

export function createWorkerIdentityCorrectionRequestId(): string {
  return `identity_correction_${randomBytes(18).toString("base64url")}`;
}

export function createWorkerIdentityCorrectionDecisionId(): string {
  return `correction_decision_${randomBytes(18).toString("base64url")}`;
}

export function createWorkerIdentityCorrectionEvidenceOriginId(): string {
  return `correction_evidence_${randomBytes(18).toString("base64url")}`;
}

export function normalizeWorkerIdentityCorrectionRequestReference(value: string): string {
  const normalized = value.trim();
  if (!/^identity_correction_[A-Za-z0-9_-]{24}$/.test(normalized)) {
    throw new WorkerIdentityContractError("Identity correction request reference is invalid.");
  }
  return normalized;
}

export function normalizeWorkerIdentityCorrectionReason(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length < 20 ||
    trimmed.length > 1000 ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    throw new WorkerIdentityContractError(
      "Identity correction reason must be between 20 and 1000 characters and contain no control characters."
    );
  }
  return trimmed.replace(/ {2,}/g, " ");
}

export function normalizeWorkerIdentityCorrectionReasonCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,79}$/.test(normalized)) {
    throw new WorkerIdentityContractError("Identity correction decision reason code is invalid.");
  }
  return normalized;
}

export function isWorkerIdentityCorrectionDecision(
  value: unknown
): value is WorkerIdentityCorrectionDecision {
  return (
    typeof value === "string" &&
    WORKER_IDENTITY_CORRECTION_DECISIONS.includes(
      value as WorkerIdentityCorrectionDecision
    )
  );
}
