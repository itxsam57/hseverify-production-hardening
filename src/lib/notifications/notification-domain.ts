import { createHash } from "node:crypto";

import {
  AUTH_ROLES,
  ROLE_HOME_PATHS,
  createIdentifier,
  type AuthRole
} from "../auth/auth-domain";
import type { OutboxJobRecord } from "../outbox/outbox-domain";

export const NOTIFICATION_TYPES = ["platform.foundation.ready"] as const;
export const NOTIFICATION_TARGETS = ["portal.dashboard"] as const;
export const NOTIFICATION_SCHEMA_VERSION = 1 as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationTarget = (typeof NOTIFICATION_TARGETS)[number];

export type FoundationNotificationMetadata = Readonly<{
  fixtureRef: string;
}>;

export type NotificationMetadataByType = Readonly<{
  "platform.foundation.ready": FoundationNotificationMetadata;
}>;

export type NotificationRecord = Readonly<{
  sequence: number;
  notificationId: string;
  notificationType: NotificationType;
  schemaVersion: typeof NOTIFICATION_SCHEMA_VERSION;
  sourceJobId: string;
  projectionKey: string;
  recipientAccountId: string;
  recipientRole: AuthRole;
  tenantId: string | null;
  membershipId: string | null;
  title: string;
  body: string;
  metadata: FoundationNotificationMetadata;
  target: NotificationTarget;
  targetReference: string | null;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type NotificationQueryOptions = Readonly<{
  beforeSequence?: number | null;
  limit?: number;
}>;

export class NotificationContractError extends Error {
  constructor(message = "The notification contract is invalid.") {
    super(message);
    this.name = "NotificationContractError";
  }
}

export class NotificationAccessDeniedError extends Error {
  constructor() {
    super("The notification could not be accessed.");
    this.name = "NotificationAccessDeniedError";
  }
}

const SAFE_REFERENCE = /^[A-Za-z0-9_./:@-]+$/;

export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === "string" &&
    NOTIFICATION_TYPES.includes(value as NotificationType)
  );
}

export function isNotificationTarget(value: unknown): value is NotificationTarget {
  return (
    typeof value === "string" &&
    NOTIFICATION_TARGETS.includes(value as NotificationTarget)
  );
}

export function isNotificationRole(value: unknown): value is AuthRole {
  return typeof value === "string" && AUTH_ROLES.includes(value as AuthRole);
}

export function createNotificationId(): string {
  return createIdentifier("notification");
}

export function normalizeNotificationId(value: string): string | null {
  const normalized = value.trim();
  return /^notification_[A-Za-z0-9_-]{24}$/.test(normalized)
    ? normalized
    : null;
}

export function normalizeNotificationLimit(value: number | undefined): number {
  if (value === undefined) return 25;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new NotificationContractError(
      "Notification query limit must be between 1 and 100."
    );
  }
  return value;
}

export function normalizeNotificationCursor(
  value: number | null | undefined
): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new NotificationContractError("Notification cursor is invalid.");
  }
  return value;
}

export function normalizeFoundationNotificationMetadata(
  value: unknown
): FoundationNotificationMetadata {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new NotificationContractError(
      "Notification metadata must be a plain object."
    );
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  if (keys.length !== 1 || keys[0] !== "fixtureRef") {
    throw new NotificationContractError("Notification metadata schema is invalid.");
  }
  const fixtureRef = (value as Record<string, unknown>).fixtureRef;
  if (
    typeof fixtureRef !== "string" ||
    fixtureRef.length < 1 ||
    fixtureRef.length > 200 ||
    !SAFE_REFERENCE.test(fixtureRef)
  ) {
    throw new NotificationContractError("Notification fixture reference is invalid.");
  }
  return Object.freeze({ fixtureRef });
}

export function normalizeNotificationMetadata<T extends NotificationType>(
  notificationType: T,
  value: unknown
): NotificationMetadataByType[T] {
  if (!isNotificationType(notificationType)) {
    throw new NotificationContractError("Unknown notification type.");
  }
  let normalized: FoundationNotificationMetadata;
  switch (notificationType) {
    case "platform.foundation.ready":
      normalized = normalizeFoundationNotificationMetadata(value);
      break;
    default:
      throw new NotificationContractError(
        "No fixed notification metadata schema is registered."
      );
  }
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > 2_048) {
    throw new NotificationContractError("Notification metadata is too large.");
  }
  return normalized as NotificationMetadataByType[T];
}

export function notificationContent(notificationType: NotificationType): Readonly<{
  title: string;
  body: string;
  target: NotificationTarget;
  targetReference: null;
}> {
  switch (notificationType) {
    case "platform.foundation.ready":
      return Object.freeze({
        title: "Notification foundation ready",
        body: "This persisted notification verifies the current portal notification channel.",
        target: "portal.dashboard",
        targetReference: null
      });
  }
}

export function deriveNotificationProjectionKey(input: {
  jobId: string;
  notificationType: NotificationType;
  recipientAccountId: string;
  recipientRole: AuthRole;
  tenantId: string | null;
}): string {
  if (!/^job_[A-Za-z0-9_-]{24}$/.test(input.jobId)) {
    throw new NotificationContractError("Notification source job is invalid.");
  }
  if (!isNotificationType(input.notificationType)) {
    throw new NotificationContractError("Unknown notification type.");
  }
  if (!isNotificationRole(input.recipientRole)) {
    throw new NotificationContractError("Notification recipient role is invalid.");
  }
  if (input.recipientAccountId.trim().length < 1) {
    throw new NotificationContractError("Notification recipient is invalid.");
  }
  return createHash("sha256")
    .update(
      [
        input.jobId,
        input.notificationType,
        input.recipientAccountId,
        input.recipientRole,
        input.tenantId ?? "platform"
      ].join(":"),
      "utf8"
    )
    .digest("hex");
}

export function assertNotificationProjectionJob(
  job: OutboxJobRecord
): OutboxJobRecord & Readonly<{ jobType: "notification.portal.foundation" }> {
  if (
    job.jobType !== "notification.portal.foundation" ||
    job.enqueuedByAccountId.trim().length < 1 ||
    !isNotificationRole(job.enqueuedByRole) ||
    ((job.tenantId === null) !== (job.membershipId === null)) ||
    (job.enqueuedByRole === "company" && job.tenantId === null) ||
    (job.enqueuedByRole !== "company" && job.tenantId !== null)
  ) {
    throw new NotificationContractError(
      "Outbox job cannot project a notification."
    );
  }
  return job as OutboxJobRecord & Readonly<{
    jobType: "notification.portal.foundation";
  }>;
}

export function resolveNotificationHref(input: {
  role: AuthRole;
  target: NotificationTarget;
  targetReference: string | null;
}): string {
  if (!isNotificationRole(input.role) || !isNotificationTarget(input.target)) {
    throw new NotificationContractError("Notification target is invalid.");
  }
  if (input.targetReference !== null) {
    throw new NotificationContractError(
      "The dashboard notification target does not accept a reference."
    );
  }
  switch (input.target) {
    case "portal.dashboard":
      return ROLE_HOME_PATHS[input.role];
  }
}

export function notificationListPath(role: AuthRole): string {
  if (!isNotificationRole(role)) {
    throw new NotificationContractError("Notification role is invalid.");
  }
  return `/${role}/notifications`;
}
