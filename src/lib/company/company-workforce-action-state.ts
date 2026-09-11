import type { BulkInviteWorkerResult } from "./company-workforce-domain";

export type CompanyWorkforceActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message: string | null;
  invitationPath: string | null;
  registrationCode: string | null;
  bulkResults: readonly BulkInviteWorkerResult[];
}>;

export const INITIAL_COMPANY_WORKFORCE_ACTION_STATE: CompanyWorkforceActionState = Object.freeze({
  status: "idle",
  message: null,
  invitationPath: null,
  registrationCode: null,
  bulkResults: Object.freeze([])
});

export type WorkerCompanyInvitationActionState = Readonly<{
  error: string | null;
}>;

export const INITIAL_WORKER_COMPANY_INVITATION_ACTION_STATE: WorkerCompanyInvitationActionState = Object.freeze({
  error: null
});

export type WorkerCompanyAccessActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message: string | null;
}>;

export const INITIAL_WORKER_COMPANY_ACCESS_ACTION_STATE: WorkerCompanyAccessActionState = Object.freeze({
  status: "idle",
  message: null
});
