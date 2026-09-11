import type {
  CompanyRegistrationCodeStatus,
  CompanyWorkerInvitationStatus,
  CompanyWorkerLinkSource,
  CompanyWorkerLinkStatus,
  CompanyWorkforcePaymentResponsibility
} from "./company-workforce-domain";

export type CompanyWorkerInvitationView = Readonly<{
  invitationId: string;
  email: string;
  status: CompanyWorkerInvitationStatus;
  siteId: string | null;
  siteName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  paymentResponsibility: CompanyWorkforcePaymentResponsibility;
  assessmentReference: string | null;
  resendCount: number;
  resendAvailableAt: string;
  expiresAt: string;
  createdAt: string;
}>;

export type CompanyRegistrationCodeView = Readonly<{
  codeId: string;
  status: CompanyRegistrationCodeStatus;
  usageLimit: number;
  usageCount: number;
  siteId: string | null;
  siteName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  paymentResponsibility: CompanyWorkforcePaymentResponsibility;
  assessmentReference: string | null;
  expiresAt: string;
  createdAt: string;
}>;

export type CompanyWorkerLinkView = Readonly<{
  linkId: string;
  workerAccountId: string;
  workerEmail: string;
  permanentWorkerId: string | null;
  source: CompanyWorkerLinkSource;
  status: CompanyWorkerLinkStatus;
  siteId: string | null;
  siteName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  paymentResponsibility: CompanyWorkforcePaymentResponsibility;
  assessmentReference: string | null;
  workerAcceptedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
}>;

export type CompanyWorkforceOverview = Readonly<{
  invitations: readonly CompanyWorkerInvitationView[];
  codes: readonly CompanyRegistrationCodeView[];
  links: readonly CompanyWorkerLinkView[];
}>;
