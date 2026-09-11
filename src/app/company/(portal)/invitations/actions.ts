"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { getServerEnvironment } from "@/lib/config/server-environment";
import type { CompanyWorkforceActionState } from "@/lib/company/company-workforce-action-state";
import {
  CompanyWorkforceAccessError,
  CompanyWorkforceConflictError,
  CompanyWorkforceInputError,
  type CompanyWorkforcePaymentResponsibility
} from "@/lib/company/company-workforce-domain";
import { CompanyWorkforceService } from "@/lib/company/company-workforce-service";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function payment(value: string): CompanyWorkforcePaymentResponsibility | null {
  return value === "company" || value === "worker" ? value : null;
}

function state(
  status: CompanyWorkforceActionState["status"],
  message: string,
  extra: Partial<Pick<CompanyWorkforceActionState, "invitationPath" | "registrationCode" | "bulkResults">> = {}
): CompanyWorkforceActionState {
  return Object.freeze({
    status,
    message,
    invitationPath: extra.invitationPath ?? null,
    registrationCode: extra.registrationCode ?? null,
    bulkResults: extra.bulkResults ?? Object.freeze([])
  });
}

function failure(error: unknown): CompanyWorkforceActionState {
  if (error instanceof CompanyWorkforceConflictError) return state("conflict", error.message);
  if (error instanceof CompanyWorkforceInputError) return state("error", error.message);
  if (error instanceof CompanyWorkforceAccessError) {
    return state("error", "Your current Company access cannot complete that workforce change.");
  }
  return state("error", "The Company workforce change could not be completed safely.");
}

function refresh(): void {
  revalidatePath("/company/invitations");
  revalidatePath("/company/dashboard");
}

async function workforceService(): Promise<CompanyWorkforceService> {
  const environment = getServerEnvironment();
  return new CompanyWorkforceService(await getDatabaseClient(), environment.authPepper);
}

function defaults(formData: FormData) {
  const responsibility = payment(text(formData, "paymentResponsibility"));
  if (!responsibility) throw new CompanyWorkforceInputError("Choose who pays for future assessment orders.");
  return {
    siteId: text(formData, "siteId") || null,
    departmentId: text(formData, "departmentId") || null,
    paymentResponsibility: responsibility,
    assessmentReference: text(formData, "assessmentReference") || null
  } as const;
}

function csvEmails(value: string): readonly string[] {
  const lines = value.replaceAll("\r\n", "\n").split("\n");
  const emails: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const firstCell = line.split(",", 1)[0]?.trim() ?? "";
    if (!firstCell) continue;
    if (emails.length === 0 && firstCell.toLowerCase() === "email") continue;
    emails.push(firstCell);
  }
  if (emails.length === 0) throw new CompanyWorkforceInputError("Add at least one Worker email to the CSV list.");
  if (emails.length > 500) throw new CompanyWorkforceInputError("Bulk invitation is limited to 500 rows at a time.");
  return Object.freeze(emails);
}

export async function inviteWorkerAction(
  _previous: CompanyWorkforceActionState,
  formData: FormData
): Promise<CompanyWorkforceActionState> {
  try {
    const principal = await requireCurrentTenantPermission("company.workforce.manage");
    const invitation = await (await workforceService()).inviteWorker(principal, {
      email: text(formData, "email"),
      ...defaults(formData)
    });
    refresh();
    return state("success", "Worker invitation created. Share this invitation link with the intended Worker.", {
      invitationPath: invitation.invitationPath
    });
  } catch (error) {
    return failure(error);
  }
}

export async function bulkInviteWorkersAction(
  _previous: CompanyWorkforceActionState,
  formData: FormData
): Promise<CompanyWorkforceActionState> {
  try {
    const principal = await requireCurrentTenantPermission("company.workforce.manage");
    const rowDefaults = defaults(formData);
    const emails = csvEmails(text(formData, "csv"));
    const results = await (await workforceService()).bulkInviteWorkers(
      principal,
      emails.map((email) => ({ email, ...rowDefaults }))
    );
    const created = results.filter((result) => result.status === "created").length;
    const failed = results.length - created;
    refresh();
    return state(
      failed === 0 ? "success" : "conflict",
      `${created} Worker invitation${created === 1 ? "" : "s"} created; ${failed} row${failed === 1 ? "" : "s"} need attention.`,
      { bulkResults: results }
    );
  } catch (error) {
    return failure(error);
  }
}

export async function resendWorkerInvitationAction(
  _previous: CompanyWorkforceActionState,
  formData: FormData
): Promise<CompanyWorkforceActionState> {
  try {
    const principal = await requireCurrentTenantPermission("company.workforce.manage");
    const invitation = await (await workforceService()).resendInvitation(
      principal,
      text(formData, "invitationId")
    );
    refresh();
    return state("success", "Invitation refreshed. The previous link no longer works.", {
      invitationPath: invitation.invitationPath
    });
  } catch (error) {
    return failure(error);
  }
}

export async function revokeWorkerInvitationAction(
  _previous: CompanyWorkforceActionState,
  formData: FormData
): Promise<CompanyWorkforceActionState> {
  try {
    const principal = await requireCurrentTenantPermission("company.workforce.manage");
    await (await workforceService()).revokeInvitation(principal, text(formData, "invitationId"));
    refresh();
    return state("success", "Worker invitation revoked.");
  } catch (error) {
    return failure(error);
  }
}

export async function createCompanyRegistrationCodeAction(
  _previous: CompanyWorkforceActionState,
  formData: FormData
): Promise<CompanyWorkforceActionState> {
  try {
    const principal = await requireCurrentTenantPermission("company.workforce.manage");
    const usageLimit = Number(text(formData, "usageLimit"));
    const expiresAt = text(formData, "expiresAt");
    const code = await (await workforceService()).createRegistrationCode(principal, {
      usageLimit,
      expiresAt: new Date(expiresAt).toISOString(),
      ...defaults(formData)
    });
    refresh();
    return state("success", "Company registration code created. Copy it now; the stored value cannot reveal it later.", {
      registrationCode: code.registrationCode
    });
  } catch (error) {
    return failure(error);
  }
}

export async function revokeCompanyRegistrationCodeAction(
  _previous: CompanyWorkforceActionState,
  formData: FormData
): Promise<CompanyWorkforceActionState> {
  try {
    const principal = await requireCurrentTenantPermission("company.workforce.manage");
    await (await workforceService()).revokeRegistrationCode(principal, text(formData, "codeId"));
    refresh();
    return state("success", "Company registration code revoked.");
  } catch (error) {
    return failure(error);
  }
}

export async function requestPermanentWorkerLinkAction(
  _previous: CompanyWorkforceActionState,
  formData: FormData
): Promise<CompanyWorkforceActionState> {
  try {
    const principal = await requireCurrentTenantPermission("company.workforce.manage");
    await (await workforceService()).requestPermanentWorkerLink(
      principal,
      text(formData, "permanentWorkerId"),
      { email: text(formData, "email"), ...defaults(formData) }
    );
    refresh();
    return state("success", "Worker link request created. The matching Worker must accept it before the link becomes active.");
  } catch (error) {
    return failure(error);
  }
}
