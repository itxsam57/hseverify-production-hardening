import type { TenantPermissionPrincipal } from "../authorization/tenant-scoped-resource-domain";

export const COMPANY_WORKFORCE_MANAGE_PERMISSION = "company.workforce.manage" as const;
export type CompanyWorkforceManagePrincipal = TenantPermissionPrincipal<
  typeof COMPANY_WORKFORCE_MANAGE_PERMISSION
>;

export const COMPANY_WORKFORCE_PAYMENT_RESPONSIBILITIES = ["company", "worker"] as const;
export type CompanyWorkforcePaymentResponsibility =
  (typeof COMPANY_WORKFORCE_PAYMENT_RESPONSIBILITIES)[number];

export const COMPANY_WORKFORCE_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "revoked",
  "expired"
] as const;
export type CompanyWorkerInvitationStatus =
  (typeof COMPANY_WORKFORCE_INVITATION_STATUSES)[number];

export const COMPANY_REGISTRATION_CODE_STATUSES = [
  "active",
  "revoked",
  "expired",
  "exhausted"
] as const;
export type CompanyRegistrationCodeStatus =
  (typeof COMPANY_REGISTRATION_CODE_STATUSES)[number];

export const COMPANY_WORKER_LINK_STATUSES = [
  "pending_worker_acceptance",
  "active",
  "revoked"
] as const;
export type CompanyWorkerLinkStatus =
  (typeof COMPANY_WORKER_LINK_STATUSES)[number];

export const COMPANY_WORKER_LINK_SOURCES = [
  "invitation",
  "code",
  "permanent_worker_id"
] as const;
export type CompanyWorkerLinkSource =
  (typeof COMPANY_WORKER_LINK_SOURCES)[number];

export type CompanyWorkforceDefaults = Readonly<{
  siteId: string | null;
  departmentId: string | null;
  paymentResponsibility: CompanyWorkforcePaymentResponsibility;
  assessmentReference: string | null;
}>;

export type InviteWorkerInput = CompanyWorkforceDefaults & Readonly<{
  email: string;
}>;

export type BulkInviteWorkerRow = InviteWorkerInput & Readonly<{
  rowNumber: number;
}>;

export type CreateCompanyRegistrationCodeInput = CompanyWorkforceDefaults & Readonly<{
  usageLimit: number;
  expiresAt: string;
}>;

export type CompanyWorkerInvitationSecret = Readonly<{
  invitationId: string;
  invitationToken: string;
  invitationPath: string;
  expiresAt: string;
}>;

export type CompanyRegistrationCodeSecret = Readonly<{
  codeId: string;
  registrationCode: string;
  expiresAt: string;
  usageLimit: number;
}>;

export type BulkInviteWorkerResult = Readonly<{
  rowNumber: number;
  email: string;
  status: "created" | "error";
  invitationId: string | null;
  invitationPath: string | null;
  message: string | null;
}>;

export type CompanyWorkerLinkRecord = Readonly<{
  linkId: string;
  tenantId: string;
  workerAccountId: string;
  permanentWorkerId: string | null;
  source: CompanyWorkerLinkSource;
  status: CompanyWorkerLinkStatus;
  siteId: string | null;
  departmentId: string | null;
  paymentResponsibility: CompanyWorkforcePaymentResponsibility;
  assessmentReference: string | null;
  workerAcceptedAt: string | null;
  activatedAt: string | null;
  revokedAt: string | null;
}>;

export class CompanyWorkforceInputError extends Error {
  constructor(message = "The Company workforce request is invalid.") {
    super(message);
    this.name = "CompanyWorkforceInputError";
  }
}

export class CompanyWorkforceAccessError extends Error {
  constructor() {
    super("The Company workforce operation could not be completed.");
    this.name = "CompanyWorkforceAccessError";
  }
}

export class CompanyWorkforceConflictError extends Error {
  constructor(message = "The Company workforce operation could not be completed.") {
    super(message);
    this.name = "CompanyWorkforceConflictError";
  }
}

export class CompanyWorkforceSecretError extends Error {
  constructor() {
    super("The invitation or Company code is invalid or no longer available.");
    this.name = "CompanyWorkforceSecretError";
  }
}
