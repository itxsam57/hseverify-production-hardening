import {
  AUTH_ROLES,
  createIdentifier,
  type AuthRole
} from "../auth/auth-domain";
import type {
  AuthorizationPrincipal,
  TenantAuthorizationPrincipal
} from "../authorization/authorization-context-domain";
import {
  evaluatePlatformPermission,
  evaluateTenantPermission
} from "../authorization/authorization-domain";

export const AUDIT_ACTIONS = [
  "authentication.registration.started",
  "authentication.otp.issued",
  "authentication.otp.failed",
  "authentication.otp.verified",
  "authentication.password.created",
  "authentication.password_reset.requested",
  "authentication.password_reset.completed",
  "authentication.login.failed",
  "authentication.login.succeeded",
  "authentication.logout",
  "authentication.session.revoked",
  "authentication.account.locked",
  "authentication.account.unlocked",
  "authentication.invitation.created",
  "authentication.invitation.accepted",
  "authentication.mfa.enrolled",
  "authentication.mfa.failed",
  "authentication.mfa.succeeded",
  "authorization.access.denied",
  "outbox.job.enqueued",
  "outbox.job.claimed",
  "outbox.job.lease_reclaimed",
  "outbox.job.succeeded",
  "outbox.job.retry_scheduled",
  "outbox.job.terminal_failed",
  "notification.projected",
  "notification.read",
  "notification.deep_link.denied",
  "email.delivery.queued",
  "email.delivery.attempt.started",
  "email.delivery.delivered",
  "email.delivery.retry_scheduled",
  "email.delivery.terminal_failed",
  "secure_file.quarantined",
  "secure_file.scan.queued",
  "secure_file.scan.available",
  "secure_file.scan.unsafe",
  "secure_file.scan.failed",
  "secure_file.access.authorized",
  "secure_file.access.served",
  "worker_identity.created",
  "worker_identity.status.changed",
  "worker_identity.duplicate.evaluated",
  "worker_identity.duplicate.disposition.recorded",
  "worker_identity.worker_id.issued",
  "company_verification.updated",
  "company_verification.evidence.bound",
  "company_verification.submitted",
  "company_verification.withdrawn",
  "company_verification.status.changed",
  "company_organization.created",
  "company_organization.updated",
  "company_organization.archived",
  "company_organization.restored",
  "company_team.invitation.created",
  "company_team.invitation.revoked",
  "company_team.membership.updated",
  "company_team.membership.suspended",
  "company_team.membership.reactivated",
  "company_team.membership.revoked",
  "company_workforce.invitation.created",
  "company_workforce.invitation.resent",
  "company_workforce.invitation.revoked",
  "company_workforce.invitation.accepted",
  "company_workforce.code.created",
  "company_workforce.code.revoked",
  "company_workforce.code.redeemed",
  "company_workforce.link.requested",
  "company_workforce.link.accepted",
  "company_workforce.link.revoked",
  "worker_evidence.record.created",
  "worker_evidence.draft.saved",
  "worker_evidence.file.attached",
  "worker_evidence.file.replaced",
  "worker_evidence.version.submitted",
  "worker_evidence.revision.started",
  "worker_evidence.employment.ended",
  "worker_evidence.skill.inactivated",
  "worker_evidence.leaving_letter.attached",
  "worker_evidence.leaving_letter.replaced",
  "public_verification.concern.received",
  "assurance_order.created",
  "assurance_order.updated",
  "assurance_order.validated",
  "assurance_order.submitted",
  "assurance_order.cancelled",
  "assurance_case.created",
  "assurance_case.status.changed",
  "assurance_action.created",
  "assurance_action.assigned",
  "assurance_action.acknowledged",
  "assurance_action.snoozed",
  "assessment.question.created",
  "assessment.question.revised",
  "assessment.question.status.changed",
  "assessment.blueprint.created",
  "assessment.blueprint.revised",
  "assessment.blueprint.status.changed",
  "assessment.form.generated",
  "assessment.catalogue.created",
  "assessment.catalogue.revised",
  "assessment.catalogue.status.changed",
  "assessment.attempt.started",
  "assessment.attempt.submitted"
] as const;

export const AUDIT_OUTCOMES = ["succeeded", "denied", "failed"] as const;

export const AUDIT_TARGET_TYPES = [
  "account",
  "authentication",
  "session",
  "invitation",
  "mfa_factor",
  "portal",
  "tenant",
  "membership",
  "resource",
  "job",
  "notification",
  "email_delivery",
  "secure_file",
  "worker_identity",
  "company_verification",
  "platform"
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export type AuditTarget = Readonly<{
  type: AuditTargetType;
  reference: string | null;
}>;

export type AuditEventRecord = Readonly<{
  sequence: number;
  auditEventId: string;
  sourceKind: "native" | "auth_security_event";
  sourceEventId: string | null;
  actorAccountId: string | null;
  actorRole: AuthRole | null;
  actorTenantId: string | null;
  actorMembershipId: string | null;
  action: AuditAction;
  outcome: AuditOutcome;
  reason: string | null;
  target: AuditTarget;
  requestFingerprintHash: string | null;
  metadata: Readonly<Record<string, unknown>>;
  occurredAt: string;
  recordedAt: string;
}>;

const TRUSTED_AUDIT_ACTOR = Symbol("trusted-audit-actor");
const TRUSTED_AUDIT_ACTORS = new WeakSet<object>();
const PLATFORM_AUDIT_READ = Symbol("platform-audit-read");

export type TrustedUserAuditActor = Readonly<{
  kind: "user";
  accountId: string;
  sessionId: string;
  activeRole: AuthRole;
  tenantId: string | null;
  membershipId: string | null;
  systemComponent: null;
  [TRUSTED_AUDIT_ACTOR]: true;
}>;

export type TrustedSystemAuditActor = Readonly<{
  kind: "system";
  accountId: null;
  sessionId: null;
  activeRole: null;
  tenantId: string | null;
  membershipId: string | null;
  systemComponent: "outbox-worker" | "public-verification-intake";
  [TRUSTED_AUDIT_ACTOR]: true;
}>;

export type TrustedAuditActor =
  | TrustedUserAuditActor
  | TrustedSystemAuditActor;

export type PlatformAuditReadPrincipal = AuthorizationPrincipal &
  Readonly<{
    authorizedPlatformPermission: "platform.security.read";
    [PLATFORM_AUDIT_READ]: true;
  }>;

export type PlatformAuditReadScope = Readonly<{
  accountId: string;
  sessionId: string;
  activeRole: "admin" | "root";
}>;

export class AuditContractError extends Error {
  constructor(message = "The audit contract is invalid.") {
    super(message);
    this.name = "AuditContractError";
  }
}

export class AuditReadDeniedError extends Error {
  constructor() {
    super("The audit records could not be accessed.");
    this.name = "AuditReadDeniedError";
  }
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function isAuthRole(value: unknown): value is AuthRole {
  return (
    typeof value === "string" &&
    AUTH_ROLES.includes(value as AuthRole)
  );
}

function createTrustedUserAuditActor(
  principal: AuthorizationPrincipal
): TrustedUserAuditActor {
  const membership = principal.tenantMembership;
  const actor = Object.freeze({
    kind: "user" as const,
    accountId: principal.accountId,
    sessionId: principal.sessionId,
    activeRole: principal.activeRole,
    tenantId: membership?.tenantId ?? null,
    membershipId: membership?.membershipId ?? null,
    systemComponent: null,
    [TRUSTED_AUDIT_ACTOR]: true as const
  });
  TRUSTED_AUDIT_ACTORS.add(actor);
  return actor;
}

export function createAuditEventId(): string {
  return createIdentifier("audit");
}

export function isAuditAction(value: unknown): value is AuditAction {
  return (
    typeof value === "string" &&
    AUDIT_ACTIONS.includes(value as AuditAction)
  );
}

export function isAuditOutcome(value: unknown): value is AuditOutcome {
  return (
    typeof value === "string" &&
    AUDIT_OUTCOMES.includes(value as AuditOutcome)
  );
}

export function isAuditTargetType(value: unknown): value is AuditTargetType {
  return (
    typeof value === "string" &&
    AUDIT_TARGET_TYPES.includes(value as AuditTargetType)
  );
}

export function bindTrustedAuditActor(
  principal: AuthorizationPrincipal
): TrustedUserAuditActor {
  if (
    principal.accountStatus !== "active" ||
    !nonEmpty(principal.accountId) ||
    !nonEmpty(principal.sessionId) ||
    !isAuthRole(principal.activeRole)
  ) {
    throw new AuditContractError("Trusted actor context is invalid.");
  }

  const membership = principal.tenantMembership;
  if (principal.activeRole === "company") {
    if (
      !membership ||
      membership.tenantStatus !== "active" ||
      membership.status !== "active" ||
      !nonEmpty(membership.tenantId) ||
      !nonEmpty(membership.membershipId)
    ) {
      throw new AuditContractError("Trusted Company actor context is invalid.");
    }
  } else if (membership !== null) {
    throw new AuditContractError("Non-Company audit actor has tenant context.");
  }

  return createTrustedUserAuditActor(principal);
}

export function bindTrustedCompanyApplicationAuditActor(
  principal: AuthorizationPrincipal
): TrustedUserAuditActor {
  const membership = principal.tenantMembership;
  if (
    principal.accountStatus !== "active" ||
    principal.activeRole !== "company" ||
    !nonEmpty(principal.accountId) ||
    !nonEmpty(principal.sessionId) ||
    !membership ||
    membership.status !== "active" ||
    (membership.tenantStatus !== "pending" && membership.tenantStatus !== "active") ||
    (membership.role !== "owner" && membership.role !== "admin") ||
    !nonEmpty(membership.tenantId) ||
    !nonEmpty(membership.membershipId)
  ) {
    throw new AuditContractError("Trusted Company application actor context is invalid.");
  }
  return createTrustedUserAuditActor(principal);
}

export function bindTrustedSystemAuditActor(
  component: "outbox-worker" | "public-verification-intake",
  context: Readonly<{
    tenantId: string | null;
    membershipId: string | null;
  }> = { tenantId: null, membershipId: null }
): TrustedSystemAuditActor {
  if (
    (component !== "outbox-worker" &&
     component !== "public-verification-intake") ||
    ((context.tenantId === null) !== (context.membershipId === null)) ||
    (context.tenantId !== null && !nonEmpty(context.tenantId)) ||
    (context.membershipId !== null && !nonEmpty(context.membershipId))
  ) {
    throw new AuditContractError("Trusted system actor is invalid.");
  }
  const actor = Object.freeze({
    kind: "system" as const,
    accountId: null,
    sessionId: null,
    activeRole: null,
    tenantId: context.tenantId,
    membershipId: context.membershipId,
    systemComponent: component,
    [TRUSTED_AUDIT_ACTOR]: true as const
  });
  TRUSTED_AUDIT_ACTORS.add(actor);
  return actor;
}

export function assertTrustedAuditActor(
  actor: TrustedAuditActor
): TrustedAuditActor {
  if (
    !actor ||
    actor[TRUSTED_AUDIT_ACTOR] !== true ||
    !TRUSTED_AUDIT_ACTORS.has(actor)
  ) {
    throw new AuditContractError("Trusted actor context is invalid.");
  }

  if (actor.kind === "system") {
    if (
      actor.accountId !== null ||
      actor.sessionId !== null ||
      actor.activeRole !== null ||
      ((actor.tenantId === null) !== (actor.membershipId === null)) ||
      (actor.tenantId !== null && !nonEmpty(actor.tenantId)) ||
      (actor.membershipId !== null && !nonEmpty(actor.membershipId)) ||
      (actor.systemComponent !== "outbox-worker" &&
       actor.systemComponent !== "public-verification-intake")
    ) {
      throw new AuditContractError("Trusted system actor context is invalid.");
    }
    return actor;
  }

  if (
    actor.kind !== "user" ||
    !nonEmpty(actor.accountId) ||
    !nonEmpty(actor.sessionId) ||
    !isAuthRole(actor.activeRole) ||
    actor.systemComponent !== null ||
    ((actor.tenantId === null) !== (actor.membershipId === null))
  ) {
    throw new AuditContractError("Trusted actor context is invalid.");
  }
  return actor;
}

export function bindPlatformAuditReadPrincipal(
  principal: AuthorizationPrincipal
): PlatformAuditReadPrincipal {
  const decision = evaluatePlatformPermission({
    role: principal.activeRole,
    permission: "platform.security.read"
  });
  if (
    !decision.allowed ||
    principal.accountStatus !== "active" ||
    (principal.activeRole !== "admin" && principal.activeRole !== "root") ||
    principal.tenantMembership !== null ||
    !nonEmpty(principal.accountId) ||
    !nonEmpty(principal.sessionId)
  ) {
    throw new AuditReadDeniedError();
  }

  return Object.freeze({
    ...principal,
    authorizedPlatformPermission: "platform.security.read" as const,
    [PLATFORM_AUDIT_READ]: true as const
  });
}

export function derivePlatformAuditReadScope(
  principal: PlatformAuditReadPrincipal
): PlatformAuditReadScope {
  if (
    principal[PLATFORM_AUDIT_READ] !== true ||
    principal.authorizedPlatformPermission !== "platform.security.read" ||
    principal.accountStatus !== "active" ||
    (principal.activeRole !== "admin" && principal.activeRole !== "root") ||
    !nonEmpty(principal.accountId) ||
    !nonEmpty(principal.sessionId)
  ) {
    throw new AuditReadDeniedError();
  }

  return Object.freeze({
    accountId: principal.accountId,
    sessionId: principal.sessionId,
    activeRole: principal.activeRole
  });
}

export function assertTenantAuditReadPrincipal(
  principal: TenantAuthorizationPrincipal
): void {
  const membership = principal.tenantMembership;
  const decision = evaluateTenantPermission({
    context: principal,
    resourceTenantId: membership.tenantId,
    permission: "company.audit.read"
  });
  if (!decision.allowed) throw new AuditReadDeniedError();
}

export function normalizeAuditReason(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 2 ||
    normalized.length > 120 ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(normalized)
  ) {
    throw new AuditContractError("Audit reason must be a non-sensitive key.");
  }
  return normalized;
}

export function normalizeAuditTarget(value: AuditTarget): AuditTarget {
  if (!isAuditTargetType(value.type)) {
    throw new AuditContractError("Unknown audit target type.");
  }
  if (value.reference === null) {
    return Object.freeze({ type: value.type, reference: null });
  }
  const reference = value.reference.trim();
  if (
    reference.length < 1 ||
    reference.length > 240 ||
    !/^[A-Za-z0-9_./:@-]+$/.test(reference)
  ) {
    throw new AuditContractError("Audit target reference is invalid.");
  }
  return Object.freeze({ type: value.type, reference });
}

const FORBIDDEN_METADATA_KEY =
  /(password|passcode|otp|token|secret|cookie|authorization|csrf|credential)/i;
const MAX_METADATA_BYTES = 8_192;
const MAX_METADATA_DEPTH = 5;
const MAX_ARRAY_ITEMS = 25;
const MAX_STRING_LENGTH = 1_000;

function normalizeJsonValue(value: unknown, depth: number): unknown {
  if (depth > MAX_METADATA_DEPTH) {
    throw new AuditContractError("Audit metadata nesting is too deep.");
  }
  if (
    value === null ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AuditContractError("Audit metadata number is invalid.");
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      throw new AuditContractError("Audit metadata string is too long.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new AuditContractError("Audit metadata array is too large.");
    }
    return Object.freeze(
      value.map((item) => normalizeJsonValue(item, depth + 1))
    );
  }
  if (
    !value ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new AuditContractError("Audit metadata must be JSON-safe.");
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (
      key.length < 1 ||
      key.length > 80 ||
      FORBIDDEN_METADATA_KEY.test(key)
    ) {
      throw new AuditContractError("Audit metadata contains a forbidden key.");
    }
    result[key] = normalizeJsonValue(
      (value as Record<string, unknown>)[key],
      depth + 1
    );
  }
  return Object.freeze(result);
}

export function normalizeAuditMetadata(
  value: unknown = {}
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuditContractError("Audit metadata must be a JSON object.");
  }
  const normalized = normalizeJsonValue(value, 0);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new AuditContractError("Audit metadata must be a JSON object.");
  }
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, "utf8") > MAX_METADATA_BYTES) {
    throw new AuditContractError("Audit metadata exceeds the 8 KB limit.");
  }
  return normalized as Readonly<Record<string, unknown>>;
}

export function normalizeAuditLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new AuditContractError("Audit query limit must be between 1 and 100.");
  }
  return value;
}

export function normalizeAuditCursor(
  value: number | null | undefined
): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AuditContractError("Audit cursor is invalid.");
  }
  return value;
}
