import { createIdentifier } from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";

export const WORKER_IDENTITY_SCHEMA_VERSION = 1 as const;

export const WORKER_IDENTITY_STATUSES = [
  "draft",
  "submitted",
  "automated_checks",
  "manual_review",
  "more_info",
  "rejected",
  "escalated",
  "verified",
  "correction_pending",
  "expired_document",
  "suspended",
  "reinstated",
  "closed",
  "withdrawn"
] as const;

export type WorkerIdentityStatus =
  (typeof WORKER_IDENTITY_STATUSES)[number];

export const WORKER_IDENTITY_VERSION_KINDS = ["initial", "correction"] as const;
export type WorkerIdentityVersionKind =
  (typeof WORKER_IDENTITY_VERSION_KINDS)[number];

export const WORKER_IDENTITY_VERSION_STATUSES = ["draft", "submitted"] as const;
export type WorkerIdentityVersionStatus =
  (typeof WORKER_IDENTITY_VERSION_STATUSES)[number];

const TRANSITIONS: Readonly<Record<WorkerIdentityStatus, readonly WorkerIdentityStatus[]>> = {
  draft: ["submitted"],
  submitted: ["automated_checks", "withdrawn"],
  automated_checks: ["manual_review", "more_info", "rejected"],
  manual_review: ["verified", "more_info", "rejected", "escalated"],
  more_info: ["manual_review"],
  rejected: [],
  escalated: [],
  verified: ["correction_pending", "expired_document", "suspended"],
  correction_pending: ["verified"],
  expired_document: [],
  suspended: ["verified", "reinstated", "closed"],
  reinstated: [],
  closed: [],
  withdrawn: []
};

export type WorkerIdentityRecord = Readonly<{
  identityId: string;
  workerAccountId: string;
  schemaVersion: typeof WORKER_IDENTITY_SCHEMA_VERSION;
  lifecycleStatus: WorkerIdentityStatus;
  currentVersionNumber: number;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}>;

export type WorkerIdentityVersionRecord = Readonly<{
  identityVersionId: string;
  identityId: string;
  versionNumber: number;
  parentVersionId: string | null;
  versionKind: WorkerIdentityVersionKind;
  versionStatus: WorkerIdentityVersionStatus;
  createdByAccountId: string;
  createdAt: string;
  submittedAt: string | null;
}>;

export type WorkerIdentitySnapshot = Readonly<{
  identity: WorkerIdentityRecord;
  currentVersion: WorkerIdentityVersionRecord;
}>;

export class WorkerIdentityContractError extends Error {
  constructor(message = "Worker identity data is invalid.") {
    super(message);
    this.name = "WorkerIdentityContractError";
  }
}

export class WorkerIdentityAccessDeniedError extends Error {
  constructor() {
    super("The Worker identity could not be accessed.");
    this.name = "WorkerIdentityAccessDeniedError";
  }
}

export class WorkerIdentityNotFoundError extends Error {
  constructor() {
    super("The Worker identity does not exist.");
    this.name = "WorkerIdentityNotFoundError";
  }
}

export class WorkerIdentityConflictError extends Error {
  constructor(message = "The Worker identity changed before this action completed.") {
    super(message);
    this.name = "WorkerIdentityConflictError";
  }
}

export class WorkerIdentityTransitionError extends Error {
  constructor(message = "The Worker identity transition is not permitted.") {
    super(message);
    this.name = "WorkerIdentityTransitionError";
  }
}

export function isWorkerIdentityStatus(value: unknown): value is WorkerIdentityStatus {
  return (
    typeof value === "string" &&
    WORKER_IDENTITY_STATUSES.includes(value as WorkerIdentityStatus)
  );
}

export function isWorkerIdentityVersionKind(
  value: unknown
): value is WorkerIdentityVersionKind {
  return (
    typeof value === "string" &&
    WORKER_IDENTITY_VERSION_KINDS.includes(value as WorkerIdentityVersionKind)
  );
}

export function isWorkerIdentityVersionStatus(
  value: unknown
): value is WorkerIdentityVersionStatus {
  return (
    typeof value === "string" &&
    WORKER_IDENTITY_VERSION_STATUSES.includes(value as WorkerIdentityVersionStatus)
  );
}

export function isWorkerIdentityTransitionAllowed(
  from: WorkerIdentityStatus,
  to: WorkerIdentityStatus
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertWorkerIdentityTransition(
  from: WorkerIdentityStatus,
  to: WorkerIdentityStatus
): void {
  if (!isWorkerIdentityTransitionAllowed(from, to)) {
    throw new WorkerIdentityTransitionError(
      `Worker identity transition ${from} -> ${to} is not permitted.`
    );
  }
}

export function assertWorkerSelfTransition(
  from: WorkerIdentityStatus,
  to: WorkerIdentityStatus
): void {
  const allowed =
    (from === "draft" && to === "submitted") ||
    (from === "submitted" && to === "withdrawn");
  if (!allowed) {
    throw new WorkerIdentityTransitionError(
      "The Worker cannot perform this identity transition."
    );
  }
  assertWorkerIdentityTransition(from, to);
}

export function assertWorkerIdentityPrincipal(
  principal: AuthorizationPrincipal
): AuthorizationPrincipal & Readonly<{ activeRole: "worker" }> {
  if (
    principal.accountStatus !== "active" ||
    principal.activeRole !== "worker" ||
    principal.tenantMembership !== null ||
    principal.accountId.trim().length < 1 ||
    principal.sessionId.trim().length < 1
  ) {
    throw new WorkerIdentityAccessDeniedError();
  }
  return principal as AuthorizationPrincipal & Readonly<{ activeRole: "worker" }>;
}

export function normalizeWorkerIdentityReference(value: string): string {
  const normalized = value.trim();
  if (!/^worker_identity_[A-Za-z0-9_-]{24}$/.test(normalized)) {
    throw new WorkerIdentityContractError("Worker identity reference is invalid.");
  }
  return normalized;
}

export function normalizeWorkerIdentityVersionReference(value: string): string {
  const normalized = value.trim();
  if (!/^identity_version_[A-Za-z0-9_-]{24}$/.test(normalized)) {
    throw new WorkerIdentityContractError("Worker identity version reference is invalid.");
  }
  return normalized;
}

export function createWorkerIdentityId(): string {
  return createIdentifier("worker_identity");
}

export function createWorkerIdentityVersionId(): string {
  return createIdentifier("identity_version");
}

export function normalizeWorkerIdentityLockVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new WorkerIdentityContractError("Worker identity lock version is invalid.");
  }
  return value;
}

export function normalizeWorkerIdentityVersionNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new WorkerIdentityContractError("Worker identity version number is invalid.");
  }
  return value;
}
