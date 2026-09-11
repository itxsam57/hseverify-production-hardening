import { randomUUID } from "node:crypto";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";

export const WORKER_EVIDENCE_RECORD_KINDS = [
  "qualification",
  "experience",
  "employment",
  "skill"
] as const;
export type WorkerEvidenceRecordKind = (typeof WORKER_EVIDENCE_RECORD_KINDS)[number];

export type WorkerEvidenceLifecycleStatus = "active" | "ended" | "inactive";
export type WorkerEvidenceVersionStatus = "draft" | "submitted" | "superseded";

export const WORKER_SKILL_ASSURANCE_STATUSES = [
  "self_declared",
  "evidence_verified",
  "competency_assessed"
] as const;
export type WorkerSkillAssuranceStatus =
  (typeof WORKER_SKILL_ASSURANCE_STATUSES)[number];

export type QualificationDetails = Readonly<{
  title: string | null;
  category: string | null;
  issuingOrganization: string | null;
  learningProvider: string | null;
  certificateNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  level: string | null;
  country: string | null;
  verificationUrl: string | null;
  declarationAccepted: boolean;
}>;

export type ExperienceDetails = Readonly<{
  companyName: string | null;
  roleTitle: string | null;
  duties: string | null;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "current" | "ended";
}>;

export type EmploymentDetails = Readonly<{
  companyName: string | null;
  roleTitle: string | null;
  duties: string | null;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "current" | "ended";
  endReason: string | null;
}>;

export type SkillDetails = Readonly<{
  skillName: string | null;
  category: string | null;
  proficiencyClaim: string | null;
  experienceMonths: number | null;
  relatedTrade: string | null;
  assuranceStatus: WorkerSkillAssuranceStatus;
}>;

export type WorkerEvidenceDetails =
  | QualificationDetails
  | ExperienceDetails
  | EmploymentDetails
  | SkillDetails;

export type WorkerEvidenceVersion<Details extends WorkerEvidenceDetails = WorkerEvidenceDetails> =
  Readonly<{
    versionId: string;
    versionNumber: number;
    revision: number;
    status: WorkerEvidenceVersionStatus;
    supersedesVersionId: string | null;
    createdAt: string;
    updatedAt: string;
    submittedAt: string | null;
    details: Details;
  }>;

export type WorkerEvidenceRecord<Details extends WorkerEvidenceDetails = WorkerEvidenceDetails> =
  Readonly<{
    recordId: string;
    workerAccountId: string;
    kind: WorkerEvidenceRecordKind;
    lifecycleStatus: WorkerEvidenceLifecycleStatus;
    createdAt: string;
    updatedAt: string;
    currentVersion: WorkerEvidenceVersion<Details>;
  }>;

export type QualificationDraftInput = Readonly<{
  recordId: string;
  expectedRevision: number;
  title: string | null;
  category: string | null;
  issuingOrganization: string | null;
  learningProvider: string | null;
  certificateNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  level: string | null;
  country: string | null;
  verificationUrl: string | null;
  declarationAccepted: boolean;
}>;

export type ExperienceDraftInput = Readonly<{
  recordId: string;
  expectedRevision: number;
  companyName: string | null;
  roleTitle: string | null;
  duties: string | null;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "current" | "ended";
}>;

export type EmploymentDraftInput = Readonly<{
  recordId: string;
  expectedRevision: number;
  companyName: string | null;
  roleTitle: string | null;
  duties: string | null;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "current" | "ended";
  endReason: string | null;
}>;

export type WorkerSkillDraftInput = Readonly<{
  recordId: string;
  expectedRevision: number;
  skillName: string | null;
  category: string | null;
  proficiencyClaim: string | null;
  experienceMonths: number | null;
  relatedTrade: string | null;
}>;

export class WorkerEvidenceNotFoundError extends Error {
  constructor() {
    super("Worker evidence record is unavailable.");
    this.name = "WorkerEvidenceNotFoundError";
  }
}

export class WorkerEvidenceConflictError extends Error {
  constructor(message = "Worker evidence changed in another session. Refresh and try again.") {
    super(message);
    this.name = "WorkerEvidenceConflictError";
  }
}

export class WorkerEvidenceContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerEvidenceContractError";
  }
}

export class WorkerEvidenceAttachmentUnavailableError extends Error {
  constructor(message = "Worker evidence file is not available for attachment.") {
    super(message);
    this.name = "WorkerEvidenceAttachmentUnavailableError";
  }
}

export function assertWorkerEvidencePrincipal(
  principal: AuthorizationPrincipal
): AuthorizationPrincipal & { activeRole: "worker" } {
  if (principal.activeRole !== "worker" || principal.accountStatus !== "active") {
    throw new WorkerEvidenceNotFoundError();
  }
  return principal as AuthorizationPrincipal & { activeRole: "worker" };
}

export function createWorkerEvidenceId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function normalizeOptionalText(
  value: string | null | undefined,
  maxLength = 500
): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") || null;
  if (normalized && normalized.length > maxLength) {
    throw new WorkerEvidenceContractError("Worker evidence text is too long.");
  }
  return normalized;
}

export function normalizeOptionalMultiline(
  value: string | null | undefined,
  maxLength = 4000
): string | null {
  const normalized = value?.trim() || null;
  if (normalized && normalized.length > maxLength) {
    throw new WorkerEvidenceContractError("Worker evidence details are too long.");
  }
  return normalized;
}

export function normalizeOptionalDate(value: string | null | undefined): string | null {
  const normalized = value?.trim() || null;
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new WorkerEvidenceContractError("Use a valid calendar date.");
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new WorkerEvidenceContractError("Use a valid calendar date.");
  }
  return normalized;
}

export function assertDateRange(startDate: string | null, endDate: string | null): void {
  if (startDate && endDate && endDate < startDate) {
    throw new WorkerEvidenceContractError("End date cannot be before start date.");
  }
}

export function normalizeVerificationUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim() || null;
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
    return parsed.toString();
  } catch {
    throw new WorkerEvidenceContractError("Verification URL must use HTTP or HTTPS.");
  }
}
