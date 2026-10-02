"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { WorkerAssessmentApplicationConflictError, getWorkerAssessmentApplicationService } from "@/lib/assessment-catalogue/worker-assessment-application-service";
import { BillingService } from "@/lib/billing/billing-service";
import { getDatabaseClient } from "@/lib/database/database";

function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function integer(data: FormData, name: string): number {
  return Number.parseInt(text(data, name), 10);
}

async function billingService(): Promise<BillingService> {
  return new BillingService(await getDatabaseClient());
}

function refresh(): void {
  revalidatePath("/company/billing");
  revalidatePath("/company/action-centre");
  revalidatePath("/worker/assessment-applications");
  revalidatePath("/worker/available-assessments");
}

export async function createCreditCheckout(formData: FormData): Promise<void> {
  const principal = await requireCurrentTenantPermission("company.billing.manage");
  await (await billingService()).createCreditCheckout(principal, {
    idempotencyKey: text(formData, "idempotencyKey"),
    creditUnits: integer(formData, "creditUnits"),
    amountMinor: integer(formData, "amountMinor"),
    currency: text(formData, "currency")
  });
  refresh();
}

export async function completeSandboxCreditCheckout(formData: FormData): Promise<void> {
  const principal = await requireCurrentTenantPermission("company.billing.manage");
  await (await billingService()).completeSandboxCheckout(
    principal,
    text(formData, "checkoutId")
  );
  refresh();
}

export async function requestRefund(formData: FormData): Promise<void> {
  const principal = await requireCurrentTenantPermission("company.billing.manage");
  await (await billingService()).requestRefund(principal, {
    invoiceId: text(formData, "invoiceId"),
    idempotencyKey: text(formData, "idempotencyKey"),
    amountMinor: integer(formData, "amountMinor")
  });
  refresh();
}

export async function runReconciliation(): Promise<void> {
  const principal = await requireCurrentTenantPermission("company.billing.manage");
  await (await billingService()).runReconciliation(principal);
  refresh();
}

async function decideWorkerFunding(formData: FormData, approved: boolean): Promise<void> {
  const principal = await requireCurrentTenantPermission("company.billing.manage");
  try {
    await (await getWorkerAssessmentApplicationService()).decideCompanyFunding(principal, {
      fundingRequestId: text(formData, "fundingRequestId"), approved
    });
  } catch (error) {
    if (error instanceof WorkerAssessmentApplicationConflictError) redirect(`/company/billing?fundingError=${encodeURIComponent(error.message)}`);
    throw error;
  }
  refresh();
  redirect("/company/billing");
}

export async function approveWorkerAssessmentFunding(formData: FormData): Promise<void> {
  await decideWorkerFunding(formData, true);
}

export async function rejectWorkerAssessmentFunding(formData: FormData): Promise<void> {
  await decideWorkerFunding(formData, false);
}