import { createIdentifier } from "../auth/auth-domain";
import type { TenantPermissionPrincipal } from "../authorization/tenant-scoped-resource-domain";

export const ASSURANCE_ORDER_READ_PERMISSION = "company.orders.read" as const;
export const ASSURANCE_ORDER_MANAGE_PERMISSION = "company.orders.manage" as const;

export type AssuranceOrderReadPrincipal = TenantPermissionPrincipal<
  typeof ASSURANCE_ORDER_READ_PERMISSION
>;
export type AssuranceOrderManagePrincipal = TenantPermissionPrincipal<
  typeof ASSURANCE_ORDER_MANAGE_PERMISSION
>;

export const ASSURANCE_ORDER_STATUSES = Object.freeze([
  "DRAFT",
  "VALIDATION_FAILED",
  "READY",
  "SUBMITTED",
  "PARTIALLY_FUNDED",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
  "CLOSED"
] as const);
export type AssuranceOrderStatus = (typeof ASSURANCE_ORDER_STATUSES)[number];

export const ASSURANCE_CASE_STATUSES = Object.freeze([
  "Created",
  "Awaiting worker acceptance",
  "Identity pending",
  "Evidence pending",
  "Funding pending",
  "Assessment pending",
  "Assessment in progress",
  "Review pending",
  "Interview pending",
  "Decision pending",
  "Approved",
  "Conditionally approved",
  "Reassessment required",
  "Rejected",
  "Suspended",
  "Closed"
] as const);
export type AssuranceCaseStatus = (typeof ASSURANCE_CASE_STATUSES)[number];

export const ASSURANCE_PENDING_OWNERS = Object.freeze([
  "worker",
  "company",
  "reviewer",
  "assessor",
  "admin",
  "payment",
  "background_job"
] as const);
export type AssurancePendingOwner = (typeof ASSURANCE_PENDING_OWNERS)[number];

export const ASSURANCE_ACTION_SEVERITIES = Object.freeze([
  "info",
  "warning",
  "critical"
] as const);
export type AssuranceActionSeverity = (typeof ASSURANCE_ACTION_SEVERITIES)[number];

export const ASSURANCE_ACTION_STATUSES = Object.freeze([
  "open",
  "acknowledged",
  "snoozed",
  "resolved"
] as const);
export type AssuranceActionStatus = (typeof ASSURANCE_ACTION_STATUSES)[number];

export const ASSURANCE_FUNDING_METHODS = Object.freeze([
  "company",
  "worker"
] as const);
export type AssuranceFundingMethod = (typeof ASSURANCE_FUNDING_METHODS)[number];

export type AssuranceOrderDraftInput = Readonly<{
  orderName: string;
  orderReference: string;
  siteId: string | null;
  departmentId: string | null;
  requestedIdentityChecks: readonly string[];
  requestedEvidenceChecks: readonly string[];
  assessmentFrameworkReferences: readonly string[];
  interviewRequired: boolean;
  credentialTarget: string | null;
  deadline: string | null;
  effectivePolicyReference: string | null;
  companyNotes: string | null;
  purchaseOrderReference: string | null;
}>;

export type NormalizedAssuranceOrderDraft = AssuranceOrderDraftInput;

export type AssuranceOrderRecord = Readonly<{
  orderId: string;
  tenantId: string;
  createdByMembershipId: string;
  orderName: string;
  orderReference: string;
  siteId: string | null;
  departmentId: string | null;
  requestedIdentityChecks: readonly string[];
  requestedEvidenceChecks: readonly string[];
  assessmentFrameworkReferences: readonly string[];
  interviewRequired: boolean;
  credentialTarget: string | null;
  deadline: string | null;
  effectivePolicyReference: string | null;
  companyNotes: string | null;
  purchaseOrderReference: string | null;
  orderStatus: AssuranceOrderStatus;
  validationErrors: readonly string[];
  scopeVersion: number;
  submittedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type AssuranceOrderWorkerRecord = Readonly<{
  targetId: string;
  orderId: string;
  tenantId: string;
  workerLinkId: string;
  workerAccountId: string;
  permanentWorkerId: string | null;
  siteId: string | null;
  departmentId: string | null;
  fundingMethod: AssuranceFundingMethod;
  targetStatus: "draft" | "eligible" | "ineligible" | "submitted" | "cancelled";
  validationReason: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type AssuranceCaseRecord = Readonly<{
  caseId: string;
  orderId: string;
  targetId: string;
  tenantId: string;
  workerLinkId: string;
  workerAccountId: string;
  permanentWorkerId: string | null;
  caseStatus: AssuranceCaseStatus;
  owner: AssurancePendingOwner | null;
  nextAction: string | null;
  evidenceReference: string | null;
  assessmentReference: string | null;
  integrityReference: string | null;
  reviewReference: string | null;
  interviewReference: string | null;
  decisionReference: string | null;
  credentialReference: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}>;

export type AssuranceActionItemRecord = Readonly<{
  actionId: string;
  tenantId: string;
  orderId: string;
  caseId: string | null;
  workerAccountId: string | null;
  severity: AssuranceActionSeverity;
  reason: string;
  dueAt: string | null;
  owner: AssurancePendingOwner;
  internalOwnerMembershipId: string | null;
  allowedAction: string;
  deepLink: string;
  statutory: boolean;
  actionStatus: AssuranceActionStatus;
  acknowledgedAt: string | null;
  snoozedUntil: string | null;
  snoozeReason: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type AssuranceValidationResult = Readonly<{
  ready: boolean;
  errors: readonly string[];
}>;

export class AssuranceOrderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssuranceOrderInputError";
  }
}
export class AssuranceOrderAccessError extends Error {
  constructor() {
    super("The Assurance Order could not be accessed.");
    this.name = "AssuranceOrderAccessError";
  }
}
export class AssuranceOrderConflictError extends Error {
  constructor(message = "The Assurance Order changed. Reload and try again.") {
    super(message);
    this.name = "AssuranceOrderConflictError";
  }
}
export class AssuranceOrderNotFoundError extends Error {
  constructor() {
    super("The Assurance Order could not be found.");
    this.name = "AssuranceOrderNotFoundError";
  }
}

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;

function normalizeText(value: string, label: string, min: number, max: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    normalized.length < min ||
    normalized.length > max ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new AssuranceOrderInputError(`${label} must contain ${min} to ${max} safe characters.`);
  }
  return normalized;
}

function normalizeOptionalText(
  value: string | null | undefined,
  label: string,
  max: number
): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  if (!normalized) return null;
  if (normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AssuranceOrderInputError(`${label} exceeds ${max} safe characters.`);
  }
  return normalized;
}

function normalizeReferenceList(
  value: readonly string[],
  label: string,
  maxItems = 50
): readonly string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new AssuranceOrderInputError(`${label} contains too many items.`);
  }
  const normalized = value.map((item) => item.trim()).filter(Boolean);
  if (normalized.some((item) => item.length > 120 || !SAFE_REFERENCE.test(item))) {
    throw new AssuranceOrderInputError(`${label} contains an invalid reference.`);
  }
  return Object.freeze([...new Set(normalized)].sort());
}

function normalizeDeadline(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new AssuranceOrderInputError("Deadline is invalid.");
  }
  return date.toISOString();
}

export function normalizeAssuranceOrderDraft(
  input: AssuranceOrderDraftInput
): NormalizedAssuranceOrderDraft {
  return Object.freeze({
    orderName: normalizeText(input.orderName, "Order name", 2, 160),
    orderReference: normalizeText(input.orderReference, "Order reference", 1, 120),
    siteId: normalizeOptionalText(input.siteId, "Site reference", 80),
    departmentId: normalizeOptionalText(input.departmentId, "Department reference", 80),
    requestedIdentityChecks: normalizeReferenceList(
      input.requestedIdentityChecks,
      "Requested identity checks"
    ),
    requestedEvidenceChecks: normalizeReferenceList(
      input.requestedEvidenceChecks,
      "Requested evidence checks"
    ),
    assessmentFrameworkReferences: normalizeReferenceList(
      input.assessmentFrameworkReferences,
      "Assessment frameworks"
    ),
    interviewRequired: Boolean(input.interviewRequired),
    credentialTarget: normalizeOptionalText(input.credentialTarget, "Credential target", 160),
    deadline: normalizeDeadline(input.deadline),
    effectivePolicyReference: normalizeOptionalText(
      input.effectivePolicyReference,
      "Effective policy reference",
      160
    ),
    companyNotes: normalizeOptionalText(input.companyNotes, "Company notes", 4000),
    purchaseOrderReference: normalizeOptionalText(
      input.purchaseOrderReference,
      "Purchase order reference",
      160
    )
  });
}

export function normalizeAssuranceFundingMethod(value: string): AssuranceFundingMethod {
  if (!ASSURANCE_FUNDING_METHODS.includes(value as AssuranceFundingMethod)) {
    throw new AssuranceOrderInputError("Funding method must be Company or Worker.");
  }
  return value as AssuranceFundingMethod;
}

export function normalizeAssuranceReference(
  value: string,
  prefix: "assurance_order" | "assurance_target" | "assurance_case" | "assurance_action" | "assurance_event"
): string | null {
  const normalized = value.trim();
  return new RegExp(`^${prefix}_[A-Za-z0-9_-]{24}$`).test(normalized)
    ? normalized
    : null;
}

export function createAssuranceOrderId(): string {
  return createIdentifier("assurance_order");
}
export function createAssuranceTargetId(): string {
  return createIdentifier("assurance_target");
}
export function createAssuranceCaseId(): string {
  return createIdentifier("assurance_case");
}
export function createAssuranceActionId(): string {
  return createIdentifier("assurance_action");
}
export function createAssuranceTimelineEventId(): string {
  return createIdentifier("assurance_event");
}

export function initialCaseState(): Readonly<{
  status: AssuranceCaseStatus;
  owner: AssurancePendingOwner;
  nextAction: string;
}> {
  return Object.freeze({
    status: "Identity pending",
    owner: "worker",
    nextAction: "Complete or correct the Worker identity requirements for this assurance case."
  });
}
