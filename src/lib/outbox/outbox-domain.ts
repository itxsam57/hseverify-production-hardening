import { createHash } from "node:crypto";

import { createIdentifier, type AuthRole } from "../auth/auth-domain";
import {
  assertTrustedAuditActor,
  type TrustedAuditActor
} from "../audit/audit-domain";

export const OUTBOX_JOB_TYPES = [
  "platform.foundation.noop",
  "notification.portal.foundation",
  "email.delivery.foundation",
  "secure_file.scan",
  "worker_identity.automated_checks"
] as const;
export const OUTBOX_JOB_STATUSES = [
  "pending",
  "leased",
  "retry_wait",
  "succeeded",
  "terminal_failed"
] as const;
export const OUTBOX_ATTEMPT_OUTCOMES = [
  "running",
  "succeeded",
  "retry_scheduled",
  "terminal_failed",
  "lease_expired"
] as const;

export type OutboxJobType = (typeof OUTBOX_JOB_TYPES)[number];
export type OutboxJobStatus = (typeof OUTBOX_JOB_STATUSES)[number];
export type OutboxAttemptOutcome =
  (typeof OUTBOX_ATTEMPT_OUTCOMES)[number];

export const OUTBOX_SCHEMA_VERSION = 1 as const;
export const OUTBOX_MAX_ATTEMPTS = 5 as const;
export const OUTBOX_LEASE_SECONDS = 60 as const;
export const OUTBOX_RETRY_DELAYS_SECONDS = [5, 30, 120, 600] as const;

const TRUSTED_OUTBOX_WORKER = Symbol("trusted-outbox-worker");
const TRUSTED_OUTBOX_LEASE = Symbol("trusted-outbox-lease");
const TRUSTED_OUTBOX_WORKERS = new WeakSet<object>();
const TRUSTED_OUTBOX_LEASES = new WeakSet<object>();
const SAFE_REFERENCE = /^[A-Za-z0-9_./:@-]+$/;
const SAFE_KEY = /^[a-z0-9][a-z0-9._-]*$/;
const FORBIDDEN_PAYLOAD_KEY =
  /(password|passcode|otp|totp|token|secret|cookie|authorization|csrf|credential|document|attachment|body|content|passport|cnic|national.?id|email|phone|address|birth|name)/i;

export type TrustedOutboxWorker = Readonly<{
  workerId: string;
  component: "outbox-worker";
  [TRUSTED_OUTBOX_WORKER]: true;
}>;

export type TrustedOutboxLease = Readonly<{
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  workerId: string;
  leaseId: string;
  leaseExpiresAt: string;
  [TRUSTED_OUTBOX_LEASE]: true;
}>;

export type FoundationNoopPayload = Readonly<{
  probeRef: string;
}>;

export type PortalFoundationNotificationPayload = Readonly<{
  fixtureRef: string;
}>;

export type FoundationEmailDeliveryPayload = Readonly<{
  fixtureRef: string;
}>;

export type SecureFileScanPayload = Readonly<{
  fileRef: string;
  generation: number;
}>;

export type WorkerIdentityAutomatedChecksPayload = Readonly<{
  identityRef: string;
  versionRef: string;
}>;

export type OutboxPayloadByType = Readonly<{
  "platform.foundation.noop": FoundationNoopPayload;
  "notification.portal.foundation": PortalFoundationNotificationPayload;
  "email.delivery.foundation": FoundationEmailDeliveryPayload;
  "secure_file.scan": SecureFileScanPayload;
  "worker_identity.automated_checks": WorkerIdentityAutomatedChecksPayload;
}>;

export type OutboxPayload = OutboxPayloadByType[OutboxJobType];

export type OutboxJobRecord = Readonly<{
  sequence: number;
  jobId: string;
  jobType: OutboxJobType;
  schemaVersion: typeof OUTBOX_SCHEMA_VERSION;
  idempotencyKey: string;
  payload: OutboxPayload;
  enqueuedByAccountId: string;
  enqueuedByRole: AuthRole;
  tenantId: string | null;
  membershipId: string | null;
  status: OutboxJobStatus;
  attemptCount: number;
  maxAttempts: typeof OUTBOX_MAX_ATTEMPTS;
  nextAttemptAt: string;
  leaseId: string | null;
  workerId: string | null;
  leaseExpiresAt: string | null;
  succeededAt: string | null;
  terminalFailedAt: string | null;
  lastErrorCode: string | null;
  lastErrorSummary: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type OutboxAttemptRecord = Readonly<{
  sequence: number;
  attemptId: string;
  jobId: string;
  attemptNumber: number;
  workerId: string;
  leaseId: string;
  outcome: OutboxAttemptOutcome;
  errorCode: string | null;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
  nextAttemptAt: string | null;
}>;

export type EnqueueOutboxJobInput<T extends OutboxJobType = OutboxJobType> =
  Readonly<{
    jobType: T;
    businessKey: string;
    payload: OutboxPayloadByType[T];
  }>;

export type OutboxFailure = Readonly<{
  code: string;
  summary: string;
}>;

export type OutboxHandlerResult =
  | Readonly<{ kind: "succeeded" }>
  | Readonly<{ kind: "retryable"; failure: OutboxFailure }>
  | Readonly<{ kind: "terminal"; failure: OutboxFailure }>;

export class OutboxContractError extends Error {
  constructor(message = "The outbox contract is invalid.") {
    super(message);
    this.name = "OutboxContractError";
  }
}

export class RequiredOutboxMissingError extends Error {
  constructor() {
    super("The accepted state change did not enqueue its required outbox work.");
    this.name = "RequiredOutboxMissingError";
  }
}

export class StaleOutboxLeaseError extends Error {
  constructor() {
    super("The outbox lease is stale or no longer owned by this worker.");
    this.name = "StaleOutboxLeaseError";
  }
}

export function isOutboxJobType(value: unknown): value is OutboxJobType {
  return (
    typeof value === "string" &&
    OUTBOX_JOB_TYPES.includes(value as OutboxJobType)
  );
}

export function isOutboxJobStatus(value: unknown): value is OutboxJobStatus {
  return (
    typeof value === "string" &&
    OUTBOX_JOB_STATUSES.includes(value as OutboxJobStatus)
  );
}

export function isOutboxAttemptOutcome(
  value: unknown
): value is OutboxAttemptOutcome {
  return (
    typeof value === "string" &&
    OUTBOX_ATTEMPT_OUTCOMES.includes(value as OutboxAttemptOutcome)
  );
}

export function createOutboxJobId(): string {
  return createIdentifier("job");
}

export function createOutboxAttemptId(): string {
  return createIdentifier("attempt");
}

export function createOutboxLeaseId(): string {
  return createIdentifier("lease");
}

export function createTrustedOutboxWorker(): TrustedOutboxWorker {
  const worker = Object.freeze({
    workerId: createIdentifier("outbox_worker"),
    component: "outbox-worker" as const,
    [TRUSTED_OUTBOX_WORKER]: true as const
  });
  TRUSTED_OUTBOX_WORKERS.add(worker);
  return worker;
}

export function assertTrustedOutboxWorker(
  worker: TrustedOutboxWorker
): TrustedOutboxWorker {
  if (
    !worker ||
    worker[TRUSTED_OUTBOX_WORKER] !== true ||
    !TRUSTED_OUTBOX_WORKERS.has(worker) ||
    worker.component !== "outbox-worker" ||
    !/^outbox_worker_[A-Za-z0-9_-]{24}$/.test(worker.workerId)
  ) {
    throw new OutboxContractError("Trusted outbox worker is invalid.");
  }
  return worker;
}

export function createTrustedOutboxLease(input: {
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  workerId: string;
  leaseId: string;
  leaseExpiresAt: string;
}): TrustedOutboxLease {
  if (
    !/^job_[A-Za-z0-9_-]{24}$/.test(input.jobId) ||
    !/^attempt_[A-Za-z0-9_-]{24}$/.test(input.attemptId) ||
    !/^lease_[A-Za-z0-9_-]{24}$/.test(input.leaseId) ||
    !/^outbox_worker_[A-Za-z0-9_-]{24}$/.test(input.workerId) ||
    !Number.isInteger(input.attemptNumber) ||
    input.attemptNumber < 1 ||
    input.attemptNumber > OUTBOX_MAX_ATTEMPTS ||
    Number.isNaN(Date.parse(input.leaseExpiresAt))
  ) {
    throw new OutboxContractError("Trusted outbox lease is invalid.");
  }
  const lease = Object.freeze({
    ...input,
    [TRUSTED_OUTBOX_LEASE]: true as const
  });
  TRUSTED_OUTBOX_LEASES.add(lease);
  return lease;
}

export function assertTrustedOutboxLease(
  lease: TrustedOutboxLease
): TrustedOutboxLease {
  if (
    !lease ||
    lease[TRUSTED_OUTBOX_LEASE] !== true ||
    !TRUSTED_OUTBOX_LEASES.has(lease)
  ) {
    throw new StaleOutboxLeaseError();
  }
  return lease;
}

export function normalizeOutboxBusinessKey(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 240 ||
    !SAFE_REFERENCE.test(normalized)
  ) {
    throw new OutboxContractError("Outbox business key is invalid.");
  }
  return normalized;
}

export function deriveOutboxIdempotencyKey(
  jobType: OutboxJobType,
  businessKey: string,
  trustedScopeReference: string
): string {
  if (!isOutboxJobType(jobType)) {
    throw new OutboxContractError("Unknown outbox job type.");
  }
  const normalized = normalizeOutboxBusinessKey(businessKey);
  const scope = normalizeOutboxBusinessKey(trustedScopeReference);
  return createHash("sha256")
    .update(
      `${jobType}:${OUTBOX_SCHEMA_VERSION}:${scope}:${normalized}`,
      "utf8"
    )
    .digest("hex");
}

function normalizeSingleReferencePayload(
  value: unknown,
  property: "probeRef" | "fixtureRef",
  label: string
): Readonly<Record<"probeRef" | "fixtureRef", string>> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new OutboxContractError("Outbox payload must be a plain object.");
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  if (
    keys.length !== 1 ||
    keys[0] !== property ||
    keys.some((key) => FORBIDDEN_PAYLOAD_KEY.test(key))
  ) {
    throw new OutboxContractError("Outbox payload schema is invalid.");
  }
  const reference = (value as Record<string, unknown>)[property];
  if (
    typeof reference !== "string" ||
    reference.length < 1 ||
    reference.length > 200 ||
    !SAFE_REFERENCE.test(reference)
  ) {
    throw new OutboxContractError(`Outbox ${label} reference is invalid.`);
  }
  return Object.freeze({ [property]: reference }) as Readonly<
    Record<"probeRef" | "fixtureRef", string>
  >;
}

function normalizeFoundationNoopPayload(
  value: unknown
): FoundationNoopPayload {
  const normalized = normalizeSingleReferencePayload(value, "probeRef", "probe");
  return Object.freeze({ probeRef: normalized.probeRef });
}

function normalizePortalNotificationPayload(
  value: unknown
): PortalFoundationNotificationPayload {
  const normalized = normalizeSingleReferencePayload(value, "fixtureRef", "fixture");
  return Object.freeze({ fixtureRef: normalized.fixtureRef });
}

function normalizeFoundationEmailPayload(
  value: unknown
): FoundationEmailDeliveryPayload {
  const normalized = normalizeSingleReferencePayload(value, "fixtureRef", "fixture");
  return Object.freeze({ fixtureRef: normalized.fixtureRef });
}

function normalizeSecureFileScanPayload(value: unknown): SecureFileScanPayload {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new OutboxContractError("Secure file scan payload must be a plain object.");
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "fileRef" ||
    keys[1] !== "generation" ||
    keys.some((key) => FORBIDDEN_PAYLOAD_KEY.test(key))
  ) {
    throw new OutboxContractError("Secure file scan payload schema is invalid.");
  }
  const fileRef = (value as Record<string, unknown>).fileRef;
  const generation = (value as Record<string, unknown>).generation;
  if (
    typeof fileRef !== "string" ||
    !/^secure_file_[A-Za-z0-9_-]{24}$/.test(fileRef) ||
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    generation > 1_000_000
  ) {
    throw new OutboxContractError("Secure file scan payload is invalid.");
  }
  return Object.freeze({ fileRef, generation });
}

function normalizeWorkerIdentityAutomatedChecksPayload(
  value: unknown
): WorkerIdentityAutomatedChecksPayload {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new OutboxContractError("Worker identity automated-check payload must be a plain object.");
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "identityRef" ||
    keys[1] !== "versionRef" ||
    keys.some((key) => FORBIDDEN_PAYLOAD_KEY.test(key))
  ) {
    throw new OutboxContractError("Worker identity automated-check payload schema is invalid.");
  }
  const identityRef = (value as Record<string, unknown>).identityRef;
  const versionRef = (value as Record<string, unknown>).versionRef;
  if (
    typeof identityRef !== "string" ||
    !/^worker_identity_[A-Za-z0-9_-]{24}$/.test(identityRef) ||
    typeof versionRef !== "string" ||
    !/^identity_version_[A-Za-z0-9_-]{24}$/.test(versionRef)
  ) {
    throw new OutboxContractError("Worker identity automated-check payload is invalid.");
  }
  return Object.freeze({ identityRef, versionRef });
}

export function normalizeOutboxPayload<T extends OutboxJobType>(
  jobType: T,
  value: unknown
): OutboxPayloadByType[T] {
  if (!isOutboxJobType(jobType)) {
    throw new OutboxContractError("Unknown outbox job type.");
  }
  let normalized: OutboxPayload;
  switch (jobType) {
    case "platform.foundation.noop":
      normalized = normalizeFoundationNoopPayload(value);
      break;
    case "notification.portal.foundation":
      normalized = normalizePortalNotificationPayload(value);
      break;
    case "email.delivery.foundation":
      normalized = normalizeFoundationEmailPayload(value);
      break;
    case "secure_file.scan":
      normalized = normalizeSecureFileScanPayload(value);
      break;
    case "worker_identity.automated_checks":
      normalized = normalizeWorkerIdentityAutomatedChecksPayload(value);
      break;
    default:
      throw new OutboxContractError("No fixed payload schema is registered.");
  }
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, "utf8") > 8_192) {
    throw new OutboxContractError("Outbox payload exceeds the 8 KB limit.");
  }
  return normalized as OutboxPayloadByType[T];
}

export function normalizeOutboxFailure(
  value: OutboxFailure
): OutboxFailure {
  const code = value.code.trim().toLowerCase();
  const summary = value.summary.trim();
  if (
    code.length < 2 ||
    code.length > 120 ||
    !SAFE_KEY.test(code) ||
    summary.length < 1 ||
    summary.length > 240 ||
    /(password|passcode|otp|totp|token|secret|cookie|authorization|credential)/i
      .test(summary)
  ) {
    throw new OutboxContractError("Outbox failure is not safe to persist.");
  }
  return Object.freeze({ code, summary });
}

export function retryDelaySeconds(attemptNumber: number): number {
  if (
    !Number.isInteger(attemptNumber) ||
    attemptNumber < 1 ||
    attemptNumber >= OUTBOX_MAX_ATTEMPTS
  ) {
    throw new OutboxContractError("Outbox retry attempt is invalid.");
  }
  return OUTBOX_RETRY_DELAYS_SECONDS[attemptNumber - 1];
}

export function assertOutboxEnqueueActor(
  actor: TrustedAuditActor
): TrustedAuditActor {
  const trusted = assertTrustedAuditActor(actor);
  if (trusted.kind !== "user") {
    throw new OutboxContractError("Outbox enqueue requires a trusted user actor.");
  }
  return trusted;
}

export function normalizeOutboxJobReference(value: string): string | null {
  const normalized = value.trim();
  return /^job_[A-Za-z0-9_-]{24}$/.test(normalized)
    ? normalized
    : null;
}

export function normalizeOutboxLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new OutboxContractError("Outbox query limit must be between 1 and 100.");
  }
  return value;
}

export function normalizeOutboxCursor(
  value: number | null | undefined
): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new OutboxContractError("Outbox cursor is invalid.");
  }
  return value;
}
