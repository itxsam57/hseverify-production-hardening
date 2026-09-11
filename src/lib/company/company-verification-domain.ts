import { createHash } from "node:crypto";

import { createIdentifier, normalizeEmail, normalizePhone } from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { evaluatePlatformPermission } from "../authorization/authorization-domain";

export const COMPANY_VERIFICATION_CASE_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "verified",
  "rejected",
  "withdrawn"
] as const;

export const COMPANY_VERIFICATION_VERSION_STATUSES = [
  "draft",
  "submitted",
  "changes_requested",
  "verified",
  "rejected",
  "withdrawn"
] as const;

export const COMPANY_SIZES = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001+"
] as const;

export type CompanyVerificationCaseStatus =
  (typeof COMPANY_VERIFICATION_CASE_STATUSES)[number];
export type CompanyVerificationVersionStatus =
  (typeof COMPANY_VERIFICATION_VERSION_STATUSES)[number];
export type CompanySize = (typeof COMPANY_SIZES)[number];

export type CompanyVerificationDraftInput = Readonly<{
  legalName: string | null;
  tradingName: string | null;
  registrationNumber: string | null;
  country: string | null;
  industry: string | null;
  companySize: CompanySize | null;
  website: string | null;
  authorizedRepresentative: string | null;
  businessPhone: string | null;
}>;

export type NormalizedCompanyVerificationDraft = Readonly<{
  legalName: string | null;
  tradingName: string | null;
  registrationNumber: string | null;
  country: string | null;
  industry: string | null;
  companySize: CompanySize | null;
  website: string | null;
  authorizedRepresentative: string | null;
  businessPhone: string | null;
}>;

export type CompanyVerificationCaseRecord = Readonly<{
  caseId: string;
  tenantId: string;
  ownerAccountId: string;
  currentVersionId: string;
  caseStatus: CompanyVerificationCaseStatus;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  verifiedAt: string | null;
  rejectedAt: string | null;
  withdrawnAt: string | null;
}>;

export type CompanyVerificationVersionRecord = Readonly<{
  versionId: string;
  caseId: string;
  versionNumber: number;
  parentVersionId: string | null;
  versionStatus: CompanyVerificationVersionStatus;
  draftRevision: number;
  legalName: string | null;
  tradingName: string | null;
  registrationNumber: string | null;
  country: string | null;
  industry: string | null;
  companySize: CompanySize | null;
  website: string | null;
  authorizedRepresentative: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  termsAcceptedAt: string | null;
  privacyAcceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  terminalAt: string | null;
}>;

export type CompanyVerificationEvidenceRecord = Readonly<{
  bindingId: string;
  caseId: string;
  versionId: string;
  secureFileId: string;
  evidenceLabel: string;
  status: "active" | "superseded";
  replacedBindingId: string | null;
  createdAt: string;
  supersededAt: string | null;
}>;

export type CompanyVerificationSnapshot = Readonly<{
  case: CompanyVerificationCaseRecord;
  currentVersion: CompanyVerificationVersionRecord;
  evidence: readonly CompanyVerificationEvidenceRecord[];
  duplicateStatus: "not_checked" | "clear" | "similar_found" | "registration_conflict";
}>;

export class CompanyVerificationContractError extends Error {
  constructor(message = "The Company verification details are invalid.") {
    super(message);
    this.name = "CompanyVerificationContractError";
  }
}

export class CompanyVerificationAccessDeniedError extends Error {
  constructor() {
    super("The Company verification record could not be accessed.");
    this.name = "CompanyVerificationAccessDeniedError";
  }
}

export class CompanyVerificationConflictError extends Error {
  constructor(message = "The Company verification record changed before this request completed.") {
    super(message);
    this.name = "CompanyVerificationConflictError";
  }
}

export class CompanyVerificationNotReadyError extends Error {
  constructor(
    readonly requirements: readonly string[],
    message: string
  ) {
    super(message);
    this.name = "CompanyVerificationNotReadyError";
  }
}

export class CompanyVerificationNotFoundError extends Error {
  constructor() {
    super("The Company verification record is unavailable.");
    this.name = "CompanyVerificationNotFoundError";
  }
}

function normalizeText(
  value: string | null,
  label: string,
  minimum: number,
  maximum: number
): string | null {
  if (value === null) return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return null;
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new CompanyVerificationContractError(
      `${label} must contain between ${minimum} and ${maximum} characters.`
    );
  }
  return normalized;
}

export function normalizeCompanyLegalName(value: string | null): string | null {
  return normalizeText(value, "Legal name", 2, 180);
}

export function normalizeCompanyTradingName(value: string | null): string | null {
  return normalizeText(value, "Trading name", 2, 180);
}

export function normalizeCompanyRegistrationNumber(value: string | null): string | null {
  const normalized = normalizeText(value, "Registration number", 2, 120);
  if (normalized === null) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._\/-]*$/u.test(normalized)) {
    throw new CompanyVerificationContractError("Registration number contains unsupported characters.");
  }
  return normalized;
}

export function normalizeCompanyCountry(value: string | null): string | null {
  return normalizeText(value, "Country", 2, 120);
}

export function normalizeCompanyIndustry(value: string | null): string | null {
  return normalizeText(value, "Industry", 2, 160);
}

export function normalizeCompanyRepresentative(value: string | null): string | null {
  return normalizeText(value, "Authorized representative", 2, 160);
}

export function normalizeCompanySize(value: string | null): CompanySize | null {
  if (value === null || value.trim().length === 0) return null;
  if (!COMPANY_SIZES.includes(value as CompanySize)) {
    throw new CompanyVerificationContractError("Select a valid Company size.");
  }
  return value as CompanySize;
}

export function normalizeCompanyWebsite(value: string | null): string | null {
  if (value === null || value.trim().length === 0) return null;
  const normalized = value.trim();
  if (normalized.length > 240) {
    throw new CompanyVerificationContractError("Website is too long.");
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new CompanyVerificationContractError("Enter a valid Company website URL.");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname) {
    throw new CompanyVerificationContractError("Enter a valid HTTP or HTTPS Company website URL.");
  }
  url.hash = "";
  return url.toString();
}

export function normalizeCompanyBusinessPhone(value: string | null): string | null {
  if (value === null || value.trim().length === 0) return null;
  try {
    return normalizePhone(value);
  } catch (error) {
    throw new CompanyVerificationContractError(
      error instanceof Error ? error.message : "Enter a valid business phone number."
    );
  }
}

export function normalizeCompanyVerificationDraft(
  input: CompanyVerificationDraftInput
): NormalizedCompanyVerificationDraft {
  return Object.freeze({
    legalName: normalizeCompanyLegalName(input.legalName),
    tradingName: normalizeCompanyTradingName(input.tradingName),
    registrationNumber: normalizeCompanyRegistrationNumber(input.registrationNumber),
    country: normalizeCompanyCountry(input.country),
    industry: normalizeCompanyIndustry(input.industry),
    companySize: normalizeCompanySize(input.companySize),
    website: normalizeCompanyWebsite(input.website),
    authorizedRepresentative: normalizeCompanyRepresentative(input.authorizedRepresentative),
    businessPhone: normalizeCompanyBusinessPhone(input.businessPhone)
  });
}

export function normalizeCompanyBusinessEmail(value: string): string {
  try {
    return normalizeEmail(value);
  } catch {
    throw new CompanyVerificationContractError("Verified Company email is invalid.");
  }
}

export function createCompanyVerificationCaseId(): string {
  return createIdentifier("company_verification");
}

export function createCompanyVerificationVersionId(): string {
  return createIdentifier("company_verification_version");
}

export function createCompanyEvidenceBindingId(): string {
  return createIdentifier("company_evidence");
}

export function createCompanyDuplicateSignalId(): string {
  return createIdentifier("company_duplicate");
}

export function normalizeCompanyEvidenceLabel(value: string): string {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 100) {
    throw new CompanyVerificationContractError("Evidence label must contain between 2 and 100 characters.");
  }
  return normalized;
}

export function normalizeCompanyNameFingerprint(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function companyRegistrationFingerprint(input: {
  country: string;
  registrationNumber: string;
}): string {
  return createHash("sha256")
    .update("hse-company-registration-v1\u0000")
    .update(input.country.normalize("NFKC").trim().toLowerCase())
    .update("\u0000")
    .update(input.registrationNumber.normalize("NFKC").trim().toLowerCase())
    .digest("hex");
}

const COMPANY_VERIFICATION_MANAGER = Symbol("company-verification-manager");
const COMPANY_VERIFICATION_MANAGERS = new WeakSet<object>();

export type CompanyVerificationManager = Readonly<{
  accountId: string;
  sessionId: string;
  tenantId: string;
  membershipId: string;
  membershipRole: "owner" | "admin";
  tenantStatus: "pending" | "active";
  verifiedEmail: string;
  [COMPANY_VERIFICATION_MANAGER]: true;
}>;

export function bindCompanyVerificationManager(
  principal: AuthorizationPrincipal
): CompanyVerificationManager {
  const membership = principal.tenantMembership;
  if (
    principal.accountStatus !== "active" ||
    principal.activeRole !== "company" ||
    !principal.accountId ||
    !principal.sessionId ||
    !membership ||
    membership.status !== "active" ||
    (membership.tenantStatus !== "pending" && membership.tenantStatus !== "active") ||
    (membership.role !== "owner" && membership.role !== "admin") ||
    !membership.tenantId ||
    !membership.membershipId
  ) {
    throw new CompanyVerificationAccessDeniedError();
  }
  const manager = Object.freeze({
    accountId: principal.accountId,
    sessionId: principal.sessionId,
    tenantId: membership.tenantId,
    membershipId: membership.membershipId,
    membershipRole: membership.role,
    tenantStatus: membership.tenantStatus,
    verifiedEmail: normalizeCompanyBusinessEmail(principal.email),
    [COMPANY_VERIFICATION_MANAGER]: true as const
  });
  COMPANY_VERIFICATION_MANAGERS.add(manager);
  return manager;
}

export function assertCompanyVerificationManager(
  manager: CompanyVerificationManager
): CompanyVerificationManager {
  if (
    !manager ||
    manager[COMPANY_VERIFICATION_MANAGER] !== true ||
    !COMPANY_VERIFICATION_MANAGERS.has(manager) ||
    !manager.accountId ||
    !manager.sessionId ||
    !manager.tenantId ||
    !manager.membershipId ||
    (manager.membershipRole !== "owner" && manager.membershipRole !== "admin") ||
    (manager.tenantStatus !== "pending" && manager.tenantStatus !== "active")
  ) {
    throw new CompanyVerificationAccessDeniedError();
  }
  return manager;
}

const COMPANY_VERIFICATION_DECIDER = Symbol("company-verification-decider");
const COMPANY_VERIFICATION_DECIDERS = new WeakSet<object>();

export type CompanyVerificationDecider = Readonly<{
  accountId: string;
  sessionId: string;
  role: "admin" | "root";
  [COMPANY_VERIFICATION_DECIDER]: true;
}>;

export function bindCompanyVerificationDecider(
  principal: AuthorizationPrincipal
): CompanyVerificationDecider {
  const permission = evaluatePlatformPermission({
    role: principal.activeRole,
    permission: "platform.tenants.manage"
  });
  if (
    !permission.allowed ||
    principal.accountStatus !== "active" ||
    principal.tenantMembership !== null ||
    (principal.activeRole !== "admin" && principal.activeRole !== "root") ||
    !principal.accountId ||
    !principal.sessionId
  ) {
    throw new CompanyVerificationAccessDeniedError();
  }
  const decider = Object.freeze({
    accountId: principal.accountId,
    sessionId: principal.sessionId,
    role: principal.activeRole,
    [COMPANY_VERIFICATION_DECIDER]: true as const
  });
  COMPANY_VERIFICATION_DECIDERS.add(decider);
  return decider;
}

export function assertCompanyVerificationDecider(
  decider: CompanyVerificationDecider
): CompanyVerificationDecider {
  if (
    !decider ||
    decider[COMPANY_VERIFICATION_DECIDER] !== true ||
    !COMPANY_VERIFICATION_DECIDERS.has(decider) ||
    !decider.accountId ||
    !decider.sessionId ||
    (decider.role !== "admin" && decider.role !== "root")
  ) {
    throw new CompanyVerificationAccessDeniedError();
  }
  return decider;
}
