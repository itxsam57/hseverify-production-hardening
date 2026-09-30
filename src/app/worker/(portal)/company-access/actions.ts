"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getServerEnvironment } from "@/lib/config/server-environment";
import { getDatabaseClient } from "@/lib/database/database";
import type { WorkerCompanyAccessActionState } from "@/lib/company/company-workforce-action-state";
import {
  CompanyWorkforceAccessError,
  CompanyWorkforceConflictError,
  CompanyWorkforceSecretError
} from "@/lib/company/company-workforce-domain";
import {
  clearCompanyWorkforceRegistrationBinding,
  readCompanyWorkforceRegistrationBinding
} from "@/lib/company/company-workforce-registration-binding";
import { CompanyWorkforceRegistrationService } from "@/lib/company/company-workforce-registration-service";
import { CompanyWorkforceService } from "@/lib/company/company-workforce-service";
import { ConsentRecordService } from "@/lib/privacy/consent-record-service";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function state(
  status: WorkerCompanyAccessActionState["status"],
  message: string
): WorkerCompanyAccessActionState {
  return Object.freeze({ status, message });
}

function failure(error: unknown): WorkerCompanyAccessActionState {
  if (error instanceof CompanyWorkforceConflictError) {
    return state("conflict", error.message);
  }
  if (error instanceof CompanyWorkforceSecretError) {
    return state("error", "That Company registration code is invalid, expired, revoked, or no longer available.");
  }
  if (error instanceof CompanyWorkforceAccessError) {
    return state("error", "That Company access change is not available to the current Worker account.");
  }
  return state("error", "The Company access change could not be completed safely.");
}

async function services(): Promise<{
  workforce: CompanyWorkforceService;
  registration: CompanyWorkforceRegistrationService;
}> {
  const database = await getDatabaseClient();
  const environment = getServerEnvironment();
  return {
    workforce: new CompanyWorkforceService(database, environment.authPepper),
    registration: new CompanyWorkforceRegistrationService(database, environment.authPepper)
  };
}

function refresh(): void {
  revalidatePath("/worker/company-access");
  revalidatePath("/worker/dashboard");
}

export async function redeemCompanyRegistrationCodeAction(
  _previous: WorkerCompanyAccessActionState,
  formData: FormData
): Promise<WorkerCompanyAccessActionState> {
  try {
    const principal = await requirePortalAuthorization("worker");
    const { workforce } = await services();
    const link = await workforce.redeemRegistrationCode(principal, text(formData, "registrationCode"));
    await new ConsentRecordService().grant({
      workerId: principal.accountId,
      actorAccountId: principal.accountId,
      consentType: "company_data_sharing",
      purpose: "Share Worker assurance data with the verified Company joined through a registration code.",
      withdrawalRule: "FUTURE_PROCESSING_ONLY",
      metadata: { tenantId: link.tenantId, linkId: link.linkId, source: "code" }
    });
    refresh();
    return state("success", "Company registration code accepted. Your Worker identity remains independent and the Company link is active.");
  } catch (error) {
    return failure(error);
  }
}

export async function acceptCompanyWorkerLinkAction(
  _previous: WorkerCompanyAccessActionState,
  formData: FormData
): Promise<WorkerCompanyAccessActionState> {
  try {
    const principal = await requirePortalAuthorization("worker");
    const { workforce } = await services();
    const link = await workforce.acceptWorkerLink(principal, text(formData, "linkId"));
    await new ConsentRecordService().grant({
      workerId: principal.accountId,
      actorAccountId: principal.accountId,
      consentType: "company_data_sharing",
      purpose: "Share Worker assurance data with the verified Company after explicit Worker approval.",
      withdrawalRule: "FUTURE_PROCESSING_ONLY",
      metadata: { tenantId: link.tenantId, linkId: link.linkId, source: "permanent_worker_id" }
    });
    refresh();
    return state("success", "Company link accepted.");
  } catch (error) {
    return failure(error);
  }
}

export async function completePreparedCompanyInvitationAction(): Promise<void> {
  const principal = await requirePortalAuthorization("worker");
  const binding = await readCompanyWorkforceRegistrationBinding();
  if (!binding || binding.kind !== "invitation" || binding.registrationTokenHash !== null) {
    redirect("/worker/company-access?status=handoff-unavailable");
  }
  try {
    const { registration } = await services();
    const link = await registration.completePreparedInvitation(principal, binding.resourceId);
    await new ConsentRecordService().grant({
      workerId: principal.accountId,
      actorAccountId: principal.accountId,
      consentType: "company_data_sharing",
      purpose: "Share Worker assurance data with the verified Company linked through the accepted invitation.",
      withdrawalRule: "FUTURE_PROCESSING_ONLY",
      metadata: { tenantId: link.tenantId, linkId: link.linkId, source: "invitation" }
    });
    await clearCompanyWorkforceRegistrationBinding();
  } catch {
    redirect("/worker/company-access?status=handoff-unavailable");
  }
  redirect("/worker/company-access?status=linked");
}

export async function completeCompanyWorkforceRegistrationAction(): Promise<void> {
  const principal = await requirePortalAuthorization("worker");
  const binding = await readCompanyWorkforceRegistrationBinding();
  if (!binding || !binding.registrationTokenHash) {
    redirect("/worker/company-access?status=handoff-unavailable");
  }
  try {
    const { registration } = await services();
    const link = await registration.completeBinding(principal, {
      kind: binding.kind,
      resourceId: binding.resourceId,
      registrationTokenHash: binding.registrationTokenHash
    });
    await new ConsentRecordService().grant({
      workerId: principal.accountId,
      actorAccountId: principal.accountId,
      consentType: "company_data_sharing",
      purpose: "Share Worker assurance data with the verified Company completed through the registration flow.",
      withdrawalRule: "FUTURE_PROCESSING_ONLY",
      metadata: { tenantId: link.tenantId, linkId: link.linkId, source: binding.kind }
    });
    await clearCompanyWorkforceRegistrationBinding();
  } catch {
    redirect("/worker/company-access?status=handoff-unavailable");
  }
  redirect("/worker/company-access?status=linked");
}
