import { createHash } from "node:crypto";

import { createIdentifier, type AuthRole } from "../auth/auth-domain";
import {
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_SCHEMA_VERSION,
  normalizeOutboxPayload,
  type OutboxJobRecord,
  type TrustedOutboxLease
} from "../outbox/outbox-domain";

export const EMAIL_DELIVERY_TYPES = ["platform.foundation.email"] as const;
export const EMAIL_DELIVERY_STATUSES = [
  "queued",
  "processing",
  "retry_wait",
  "delivered",
  "terminal_failed"
] as const;
export const EMAIL_ATTEMPT_OUTCOMES = [
  "running",
  "delivered",
  "retryable_failure",
  "terminal_failure",
  "lease_expired"
] as const;
export const EMAIL_ADAPTER_KEYS = ["local_test"] as const;

export const EMAIL_DELIVERY_SCHEMA_VERSION = 1 as const;

const SAFE_CODE = /^[a-z0-9][a-z0-9._-]*$/;
const SAFE_REFERENCE = /^[A-Za-z0-9_./:@-]+$/;
const FORBIDDEN_PERSISTED_TEXT =
  /(password|passcode|otp|totp|token|secret|cookie|authorization|credential)/i;

export type EmailDeliveryType = (typeof EMAIL_DELIVERY_TYPES)[number];
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];
export type EmailAttemptOutcome = (typeof EMAIL_ATTEMPT_OUTCOMES)[number];
export type EmailAdapterKey = (typeof EMAIL_ADAPTER_KEYS)[number];

export type FoundationEmailDeliveryPayload = Readonly<{
  fixtureRef: string;
}>;

export type EmailDeliveryOutboxJob = Omit<OutboxJobRecord, "jobType" | "payload"> &
  Readonly<{
    jobType: "email.delivery.foundation";
    payload: FoundationEmailDeliveryPayload;
  }>;

export type EmailDeliveryRecord = Readonly<{
  sequence: number;
  deliveryId: string;
  deliveryType: EmailDeliveryType;
  schemaVersion: typeof EMAIL_DELIVERY_SCHEMA_VERSION;
  sourceJobId: string;
  deliveryKey: string;
  recipientAccountId: string;
  recipientRole: AuthRole;
  tenantId: string | null;
  membershipId: string | null;
  recipientAddressHash: string;
  status: EmailDeliveryStatus;
  attemptCount: number;
  lastResultCode: string | null;
  lastResultSummary: string | null;
  deliveredAt: string | null;
  terminalFailedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type EmailDeliveryAttemptRecord = Readonly<{
  sequence: number;
  emailAttemptId: string;
  deliveryId: string;
  sourceJobId: string;
  sourceOutboxAttemptId: string;
  attemptNumber: number;
  workerId: string;
  leaseId: string;
  adapterKey: EmailAdapterKey;
  dispatchKey: string;
  outcome: EmailAttemptOutcome;
  resultCode: string | null;
  resultSummary: string | null;
  providerReferenceHash: string | null;
  startedAt: string;
  finishedAt: string | null;
}>;

export type EmailDeliveryAttemptPreparation =
  | Readonly<{
      kind: "already_delivered";
      delivery: EmailDeliveryRecord;
    }>
  | Readonly<{
      kind: "already_terminal";
      delivery: EmailDeliveryRecord;
    }>
  | Readonly<{
      kind: "attempt";
      created: boolean;
      delivery: EmailDeliveryRecord;
      attempt: EmailDeliveryAttemptRecord;
      recipientAddress: string;
    }>;

export type EmailAdapterInput = Readonly<{
  deliveryId: string;
  fixtureRef: string;
  recipientAddress: string;
  attemptNumber: number;
  dispatchKey: string;
}>;

export type EmailAdapterResult =
  | Readonly<{
      kind: "delivered";
      code: string;
      summary: string;
      providerReference: string;
    }>
  | Readonly<{
      kind: "retryable";
      code: string;
      summary: string;
    }>
  | Readonly<{
      kind: "terminal";
      code: string;
      summary: string;
    }>;

export class EmailDeliveryContractError extends Error {
  constructor(message = "The email delivery contract is invalid.") {
    super(message);
    this.name = "EmailDeliveryContractError";
  }
}

export class EmailDeliveryAccessDeniedError extends Error {
  constructor() {
    super("Email delivery access denied.");
    this.name = "EmailDeliveryAccessDeniedError";
  }
}

export function isEmailDeliveryType(value: unknown): value is EmailDeliveryType {
  return (
    typeof value === "string" &&
    EMAIL_DELIVERY_TYPES.includes(value as EmailDeliveryType)
  );
}

export function isEmailDeliveryStatus(value: unknown): value is EmailDeliveryStatus {
  return (
    typeof value === "string" &&
    EMAIL_DELIVERY_STATUSES.includes(value as EmailDeliveryStatus)
  );
}

export function isEmailAttemptOutcome(value: unknown): value is EmailAttemptOutcome {
  return (
    typeof value === "string" &&
    EMAIL_ATTEMPT_OUTCOMES.includes(value as EmailAttemptOutcome)
  );
}

export function isEmailAdapterKey(value: unknown): value is EmailAdapterKey {
  return (
    typeof value === "string" &&
    EMAIL_ADAPTER_KEYS.includes(value as EmailAdapterKey)
  );
}

export function createEmailDeliveryId(): string {
  return createIdentifier("email_delivery");
}

export function createEmailAttemptId(): string {
  return createIdentifier("email_attempt");
}

export function assertEmailDeliveryJob(
  job: OutboxJobRecord
): EmailDeliveryOutboxJob {
  if (
    job.jobType !== "email.delivery.foundation" ||
    job.schemaVersion !== OUTBOX_SCHEMA_VERSION
  ) {
    throw new EmailDeliveryContractError(
      "Email delivery requires the registered fixed outbox job type."
    );
  }
  const payload = normalizeOutboxPayload(
    "email.delivery.foundation",
    job.payload
  ) as FoundationEmailDeliveryPayload;
  return Object.freeze({ ...job, jobType: "email.delivery.foundation" as const, payload });
}

export function deriveEmailDeliveryKey(job: EmailDeliveryOutboxJob): string {
  return createHash("sha256")
    .update(
      `email-delivery:${EMAIL_DELIVERY_SCHEMA_VERSION}:${job.jobId}:${job.enqueuedByAccountId}:${job.enqueuedByRole}:${job.tenantId ?? "platform"}`,
      "utf8"
    )
    .digest("hex");
}

export function hashEmailRecipientAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 320 ||
    !normalized.includes("@") ||
    /[\r\n]/.test(normalized)
  ) {
    throw new EmailDeliveryContractError("Trusted email recipient address is invalid.");
  }
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function deriveEmailDispatchKey(
  deliveryId: string,
  lease: TrustedOutboxLease
): string {
  const normalizedDelivery = normalizeEmailDeliveryId(deliveryId);
  if (!normalizedDelivery) {
    throw new EmailDeliveryContractError("Email delivery identifier is invalid.");
  }
  return createHash("sha256")
    .update(
      `email-dispatch:${EMAIL_DELIVERY_SCHEMA_VERSION}:${normalizedDelivery}:${lease.attemptNumber}`,
      "utf8"
    )
    .digest("hex");
}

export function hashProviderReference(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 240 ||
    !SAFE_REFERENCE.test(normalized)
  ) {
    throw new EmailDeliveryContractError("Provider reference is invalid.");
  }
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function normalizeEmailResultText(input: {
  code: string;
  summary: string;
}): Readonly<{ code: string; summary: string }> {
  const code = input.code.trim().toLowerCase();
  const summary = input.summary.trim();
  if (
    code.length < 2 ||
    code.length > 120 ||
    !SAFE_CODE.test(code) ||
    summary.length < 1 ||
    summary.length > 240 ||
    FORBIDDEN_PERSISTED_TEXT.test(summary)
  ) {
    throw new EmailDeliveryContractError(
      "Email delivery result is not safe to persist."
    );
  }
  return Object.freeze({ code, summary });
}

export function normalizeEmailAdapterResult(
  result: EmailAdapterResult
): EmailAdapterResult {
  const safe = normalizeEmailResultText(result);
  if (result.kind === "delivered") {
    const providerReference = result.providerReference.trim();
    if (
      providerReference.length < 1 ||
      providerReference.length > 240 ||
      !SAFE_REFERENCE.test(providerReference)
    ) {
      throw new EmailDeliveryContractError("Provider reference is invalid.");
    }
    return Object.freeze({
      kind: "delivered" as const,
      ...safe,
      providerReference
    });
  }
  if (result.kind === "retryable" || result.kind === "terminal") {
    return Object.freeze({ kind: result.kind, ...safe });
  }
  throw new EmailDeliveryContractError("Unknown email adapter result.");
}

export function normalizeEmailDeliveryId(value: string): string | null {
  const normalized = value.trim();
  return /^email_delivery_[A-Za-z0-9_-]{24}$/.test(normalized)
    ? normalized
    : null;
}

export function normalizeEmailDeliveryLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new EmailDeliveryContractError(
      "Email delivery query limit must be between 1 and 100."
    );
  }
  return value;
}

export function normalizeEmailDeliveryCursor(
  value: number | null | undefined
): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new EmailDeliveryContractError("Email delivery cursor is invalid.");
  }
  return value;
}

export function isFinalEmailAttempt(attemptNumber: number): boolean {
  if (
    !Number.isInteger(attemptNumber) ||
    attemptNumber < 1 ||
    attemptNumber > OUTBOX_MAX_ATTEMPTS
  ) {
    throw new EmailDeliveryContractError("Email attempt number is invalid.");
  }
  return attemptNumber === OUTBOX_MAX_ATTEMPTS;
}
