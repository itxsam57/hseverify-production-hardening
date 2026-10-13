import { createHash } from "node:crypto";

import {
  AUTH_ROLES,
  ROLE_HOME_PATHS,
  createIdentifier,
  type AuthRole
} from "../auth/auth-domain";
import { normalizeAssessmentFundingNotificationPayload, normalizeAccountSecurityNotificationPayload, type AccountSecurityNotificationPayload, type OutboxJobRecord, ASSURANCE_EVENT_TYPES, normalizeAssuranceEventNotificationPayload, type AssuranceEventType, type AssuranceFundingEventType } from "../outbox/outbox-domain";

export const ACCOUNT_SECURITY_NOTIFICATION_TYPES = {
  password_changed: "account.password.changed",
  password_reset_completed: "account.password.reset",
  mfa_replaced: "account.mfa.replaced",
  mfa_recovery_codes_rotated: "account.recovery_codes.rotated"
} as const;

export const NOTIFICATION_TYPES = ["platform.foundation.ready", "interview.scheduled", "interview.reminder", "assessment.funding.requested", "assessment.funding.approved", ...Object.values(ACCOUNT_SECURITY_NOTIFICATION_TYPES), ...ASSURANCE_EVENT_TYPES] as const;
<<<<<<< ours
export const NOTIFICATION_TARGETS = ["portal.dashboard", "account.security", "interview.record", "company.assurance.case", "company.billing.funding", "worker.assessment.case", "worker.evidence.record", "worker.identity.record", "worker.observation.record", "verifier.review.task", "admin.review.escalation", "worker.assurance.case", "worker.credential.record", "appeal.record"] as const;
=======
export const NOTIFICATION_TARGETS = ["portal.dashboard", "account.security", "interview.record", "company.assurance.case", "company.billing.funding", "worker.assessment.case", "worker.evidence.record", "worker.identity.record", "worker.observation.record", "verifier.review.task", "worker.assurance.case", "worker.credential.record", "appeal.record", "admin.interview.case"] as const;
>>>>>>> theirs
export const NOTIFICATION_SCHEMA_VERSION = 1 as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationTarget = (typeof NOTIFICATION_TARGETS)[number];

export type FoundationNotificationMetadata = Readonly<{
  fixtureRef: string;
}>;

export type NotificationMetadataByType = Readonly<Record<AssuranceEventType, Readonly<{eventRef:string}>> & {
  "platform.foundation.ready": FoundationNotificationMetadata;
  "interview.scheduled": Readonly<{eventRef:string}>;
  "interview.reminder": Readonly<{eventRef:string}>;
  "assessment.funding.requested": Readonly<{eventRef:string}>;
  "assessment.funding.approved": Readonly<{eventRef:string}>;
  "account.password.changed": AccountSecurityNotificationPayload;
  "account.password.reset": AccountSecurityNotificationPayload;
  "account.mfa.replaced": AccountSecurityNotificationPayload;
  "account.recovery_codes.rotated": AccountSecurityNotificationPayload;
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
  metadata: FoundationNotificationMetadata | AccountSecurityNotificationPayload;
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
  let normalized: FoundationNotificationMetadata | AccountSecurityNotificationPayload;
  switch (notificationType) {
    case "platform.foundation.ready":
      normalized = normalizeFoundationNotificationMetadata(value);
      break;
    case "assessment.funding.requested":
    case "assessment.funding.approved":
      normalized = normalizeAssessmentFundingNotificationPayload(value);
      break;
    case "interview.reminder":
    case "interview.scheduled":
    case "account.password.changed":
    case "account.password.reset":
    case "account.mfa.replaced":
    case "account.recovery_codes.rotated":
      normalized = normalizeAccountSecurityNotificationPayload(value);
      break;
    case "evidence.submitted":
    case "evidence.unable":
    case "evidence.escalated":
    case "evidence.returned":
    case "evidence.reviewed":
    case "evidence.additional.requested":
    case "interview.recommended":
    case "decision.recorded":
    case "credential.issued":
    case "appeal.submitted":
    case "appeal.updated":
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value)!==Object.prototype || Object.keys(value).length!==1 || !Object.hasOwn(value,"eventRef")) throw new NotificationContractError("Assurance notification metadata is invalid.");
      normalized = Object.freeze({eventRef:normalizeAssuranceEventNotificationPayload({eventType:notificationType,eventRef:(value as {eventRef:unknown}).eventRef}).eventRef});
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

export function accountSecurityNotificationType(eventType: string): NotificationType {
  if (!Object.hasOwn(ACCOUNT_SECURITY_NOTIFICATION_TYPES, eventType)) {
    throw new NotificationContractError("Security notification event is invalid.");
  }
  return ACCOUNT_SECURITY_NOTIFICATION_TYPES[eventType as keyof typeof ACCOUNT_SECURITY_NOTIFICATION_TYPES];
}

const SECURITY_CONTENT = {
  "account.password.changed": { title: "Password changed", body: "Your password was changed and other active sessions were revoked. Review your account security if you did not make this change." },
  "account.password.reset": { title: "Password reset", body: "Your password was reset and all previous sessions were revoked. Review your account security if you did not make this change." },
  "account.mfa.replaced": { title: "Authenticator replaced", body: "Your authenticator was replaced. Review your account security if you did not make this change." },
  "account.recovery_codes.rotated": { title: "Recovery codes replaced", body: "A new recovery-code set replaced your previous codes. Review your account security if you did not make this change." }
} as const;


export const ASSURANCE_EVENT_CONTENT: Readonly<Record<AssuranceEventType,{title:string;body:string}>> = Object.freeze({
  "evidence.submitted": {
    "title": "Evidence submitted",
    "body": "Open the record for the current status and next action."
  },
  "evidence.unable": {title:"Evidence could not be verified",body:"Open the record for the current status and next action."},
  "evidence.escalated": {title:"Evidence review escalated",body:"Open the record for the current status and next action."},
  "evidence.returned": {title:"Evidence returned to review",body:"Open the record for the current status and next action."},
  "evidence.reviewed": {
    "title": "Evidence review recorded",
    "body": "Open the record for the current status and next action."
  },
  "evidence.additional.requested": {
    "title": "Additional evidence requested",
    "body": "Open the record for the current status and next action."
  },
  "interview.recommended": { title: "Interview recommendation submitted", body: "Open the record for the current status and next action." },
  "decision.recorded": {
    "title": "Assurance decision recorded",
    "body": "Open the record for the current status and next action."
  },
  "credential.issued": {
    "title": "Credential issued",
    "body": "Open the record for the current status and next action."
  },
  "appeal.submitted": {
    "title": "Appeal submitted",
    "body": "Open the record for the current status and next action."
  },
  "appeal.updated": {
    "title": "Appeal review updated",
    "body": "Open the record for the current status and next action."
  }
});

export function assuranceEventEmailContent(type:AssuranceEventType|AssuranceFundingEventType):Readonly<{title:string;body:string}>{
 if(type==="assessment.funding.requested")return {title:"Assessment funding requested",body:"A linked Worker requested assessment funding. Open the Company billing request to approve or reject it."};
 if(type==="assessment.funding.approved")return {title:"Assessment funding approved",body:"Your Company approved assessment funding. Open your available assessment and complete the required pre-assessment checks."};
 if(!ASSURANCE_EVENT_TYPES.includes(type))throw new NotificationContractError();
 return ASSURANCE_EVENT_CONTENT[type];
}

function assuranceTarget(type:AssuranceEventType,context:{role:AuthRole;targetReference:string|null}):NotificationTarget{
 const roles:Readonly<Record<AssuranceEventType,readonly AuthRole[]>>={
  "evidence.submitted":["worker","verifier"],"evidence.unable":["worker"],"evidence.escalated":["worker","admin"],"evidence.returned":["worker","verifier"],"evidence.reviewed":["worker"],"evidence.additional.requested":["worker"],
  "interview.recommended":["worker","company","admin"],"decision.recorded":["worker","company"],"credential.issued":["worker"],"appeal.submitted":["worker","admin"],"appeal.updated":["worker"]
 };
 if(!roles[type].includes(context.role))throw new NotificationContractError("Assurance recipient role is invalid.");
 if(type==="evidence.escalated" && context.role==="admin")return "admin.review.escalation";
 if(type==="interview.recommended")return context.role==="company"?"company.assurance.case":context.role==="admin"?"admin.interview.case":"worker.assurance.case";
 if(type.startsWith("appeal."))return "appeal.record";
 if(type==="decision.recorded")return context.role==="company"?"company.assurance.case":"worker.assurance.case";
 if(type==="credential.issued")return "worker.credential.record";
 if(context.role==="verifier")return "verifier.review.task";
 if(context.targetReference?.startsWith("worker_identity_"))return "worker.identity.record";
 if(context.targetReference?.startsWith("supervisor_observation_"))return "worker.observation.record";
 return "worker.evidence.record";
}

export function notificationContent(notificationType: NotificationType, context?: {role: AuthRole; targetReference: string | null}): Readonly<{
  title: string;
  body: string;
  target: NotificationTarget;
  targetReference: string | null;
}> {
  switch (notificationType) {
    case "evidence.submitted":
    case "evidence.unable":
    case "evidence.escalated":
    case "evidence.returned":
    case "evidence.reviewed":
    case "evidence.additional.requested":
    case "interview.recommended":
    case "decision.recorded":
    case "credential.issued":
    case "appeal.submitted":
    case "appeal.updated":
    {
      if(!context)throw new NotificationContractError("Assurance notification target context is required.");
      const target=assuranceTarget(notificationType,context);
      resolveNotificationHref({role:context.role,target,targetReference:context.targetReference});
      return Object.freeze({...ASSURANCE_EVENT_CONTENT[notificationType],target,targetReference:context.targetReference});
    }
    case "assessment.funding.requested":
    case "assessment.funding.approved": {
      const requested = notificationType === "assessment.funding.requested";
      if (!context || context.role !== (requested ? "company" : "worker")) {
        throw new NotificationContractError("Funding notification target context is invalid.");
      }
      const target = requested ? "company.billing.funding" : "worker.assessment.case";
      resolveNotificationHref({ role: context.role, target, targetReference: context.targetReference });
      return Object.freeze({
        title: requested ? "Assessment funding requested" : "Assessment funding approved",
        body: requested
          ? "A linked Worker requested assessment funding. Open the Company billing request to approve or reject it."
          : "Your Company approved assessment funding. Open your available assessment and complete the required pre-assessment checks.",
        target,
        targetReference: context.targetReference
      });
    }
    case "interview.reminder":
    case "interview.scheduled": {
      if (!context) throw new NotificationContractError("Interview notification target context is required.");
      const target = context.role === "company" ? "company.assurance.case" : "interview.record";
      resolveNotificationHref({role:context.role,target,targetReference:context.targetReference});
      return Object.freeze({title:notificationType==="interview.reminder" ? "Interview reminder" : "Interview scheduled",
        body:notificationType==="interview.reminder" ? "Your interview is approaching. Open the record for the current time and preparation details." : "An interview has been scheduled. Open the record for the current time and preparation details.",
        target,targetReference:context.targetReference});
    }
    case "platform.foundation.ready":
      return Object.freeze({
        title: "Notification foundation ready",
        body: "This persisted notification verifies the current portal notification channel.",
        target: "portal.dashboard",
        targetReference: null
      });
    case "account.password.changed":
    case "account.password.reset":
    case "account.mfa.replaced":
    case "account.recovery_codes.rotated":
      return Object.freeze({ ...SECURITY_CONTENT[notificationType], target: "account.security", targetReference: null });
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
): OutboxJobRecord & Readonly<{ jobType: "notification.portal.foundation" | "notification.account.security"; enqueuedByAccountId: string; enqueuedByRole: AuthRole }> {
  if (
    !["notification.portal.foundation", "notification.account.security"].includes(job.jobType) ||
    typeof job.enqueuedByAccountId !== "string" ||
    job.enqueuedByAccountId.trim().length < 1 ||
    job.enqueuedBySystemComponent != null ||
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
    jobType: "notification.portal.foundation" | "notification.account.security";
    enqueuedByAccountId: string;
    enqueuedByRole: AuthRole;
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
  const recordReference = /^[A-Za-z0-9_-]{1,200}$/;
  if(input.target==="admin.interview.case"){
    const parts=input.targetReference?.split("#");
    if(input.role!=="admin" || parts?.length!==2 || !parts.every(value=>recordReference.test(value)))throw new NotificationContractError();
    return "/admin/decisions?tenantId="+encodeURIComponent(parts[0])+"&caseId="+encodeURIComponent(parts[1]);
  }
  if(input.target==="worker.evidence.record"){
    if(!["worker"].includes(input.role) || !input.targetReference || !/^evidence_record_[a-f0-9]{32}$/.test(input.targetReference))throw new NotificationContractError("Assurance record target is invalid.");
    return "/worker/evidence#"+encodeURIComponent(input.targetReference);
  }
  if(input.target==="worker.identity.record"){
    if(!["worker"].includes(input.role) || !input.targetReference || !/^worker_identity_[A-Za-z0-9_-]{24}$/.test(input.targetReference))throw new NotificationContractError("Assurance record target is invalid.");
    return "/worker/identity#"+encodeURIComponent(input.targetReference);
  }
  if(input.target==="worker.observation.record"){
    if(!["worker"].includes(input.role) || !input.targetReference || !/^supervisor_observation_[A-Za-z0-9_-]{24}$/.test(input.targetReference))throw new NotificationContractError("Assurance record target is invalid.");
    return "/worker/observations#"+encodeURIComponent(input.targetReference);
  }
  if(input.target==="admin.review.escalation"){
    if(input.role!=="admin" || !input.targetReference || !/^evidence_review_[A-Za-z0-9_-]{24}$/.test(input.targetReference))throw new NotificationContractError("Escalation record target is invalid.");
    return "/admin/operations/review-escalations#"+encodeURIComponent(input.targetReference);
  }
  if(input.target==="verifier.review.task"){
    if(!["verifier"].includes(input.role) || !input.targetReference || !/^evidence_review_[A-Za-z0-9_-]{24}$/.test(input.targetReference))throw new NotificationContractError("Assurance record target is invalid.");
    return "/verifier/reviews/"+encodeURIComponent(input.targetReference);
  }
  if(input.target==="worker.assurance.case"){
    if(!["worker"].includes(input.role) || !input.targetReference || !/^assurance_case_[A-Za-z0-9_-]{24}$/.test(input.targetReference))throw new NotificationContractError("Assurance record target is invalid.");
    return "/worker/assurance-cases/"+encodeURIComponent(input.targetReference);
  }
  if(input.target==="worker.credential.record"){
    if(!["worker"].includes(input.role) || !input.targetReference || !/^credential_id_[A-Za-z0-9_-]{1,160}$/.test(input.targetReference))throw new NotificationContractError("Assurance record target is invalid.");
    return "/worker/passport#"+encodeURIComponent(input.targetReference);
  }
  if(input.target==="appeal.record"){
    if(!["worker","admin"].includes(input.role) || !input.targetReference || !/^appeal_[A-Za-z0-9_-]{1,160}$/.test(input.targetReference))throw new NotificationContractError("Assurance record target is invalid.");
    return "/"+input.role+"/appeals#"+encodeURIComponent(input.targetReference);
  }
  if (input.target === "company.billing.funding") {
    if (input.role !== "company" || !input.targetReference ||
        !/^funding_[A-Za-z0-9_-]{24}$/.test(input.targetReference)) {
      throw new NotificationContractError("Company funding notification target is invalid.");
    }
    return "/company/billing#" + encodeURIComponent(input.targetReference);
  }
  if (input.target === "worker.assessment.case") {
    if (input.role !== "worker" || !input.targetReference ||
        !/^assurance_case_[A-Za-z0-9_-]{24}$/.test(input.targetReference)) {
      throw new NotificationContractError("Worker assessment notification target is invalid.");
    }
    return "/worker/available-assessments#" + encodeURIComponent(input.targetReference);
  }

  if (input.target === "interview.record") {
    if (!["worker","assessor"].includes(input.role) || !input.targetReference || !recordReference.test(input.targetReference)) {
      throw new NotificationContractError("Interview notification target is invalid.");
    }
    return "/"+input.role+"/interviews/"+encodeURIComponent(input.targetReference);
  }
  if (input.target === "company.assurance.case") {
    const references=input.targetReference?.split("#");
    if (input.role !== "company" || references?.length !== 2 || !references.every(value => recordReference.test(value))) {
      throw new NotificationContractError("Company interview notification target is invalid.");
    }
    return "/company/assurance-orders/"+encodeURIComponent(references[0])+"#"+encodeURIComponent(references[1]);
  }
  if (input.targetReference !== null) {
    throw new NotificationContractError(
      "The dashboard notification target does not accept a reference."
    );
  }
  switch (input.target) {
    case "portal.dashboard":
      return ROLE_HOME_PATHS[input.role];
    case "account.security":
      return "/account/security";
  }
}

export function notificationListPath(role: AuthRole): string {
  if (!isNotificationRole(role)) {
    throw new NotificationContractError("Notification role is invalid.");
  }
  return `/${role}/notifications`;
}
