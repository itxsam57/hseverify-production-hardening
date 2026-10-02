"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import {
  getWorkerAssessmentApplicationService,
  WorkerAssessmentApplicationAccessError,
  WorkerAssessmentApplicationConflictError
} from "@/lib/assessment-catalogue/worker-assessment-application-service";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function errorPath(error: unknown): string {
  const message =
    error instanceof WorkerAssessmentApplicationAccessError ||
    error instanceof WorkerAssessmentApplicationConflictError
      ? error.message
      : "Assessment application could not be completed.";
  return "/worker/assessment-applications?error=" + encodeURIComponent(message);
}

async function workerPrincipal() {
  return requirePlatformPermission({
    expectedRole: "worker",
    permission: "worker.self.manage"
  });
}

export async function applyWorkerPayAction(formData: FormData): Promise<void> {
  const principal = await workerPrincipal();
  try {
    await (await getWorkerAssessmentApplicationService()).applyWorkerPay(
      principal,
      text(formData, "catalogueVersionId")
    );
  } catch (error) {
    redirect(errorPath(error));
  }
  revalidatePath("/worker/assessment-applications");
  redirect("/worker/assessment-applications?status=payment-required");
}

export async function confirmSandboxWorkerPaymentAction(formData: FormData): Promise<void> {
  const principal = await workerPrincipal();
  try {
    await (await getWorkerAssessmentApplicationService()).confirmSandboxWorkerPayment(
      principal,
      text(formData, "applicationId")
    );
  } catch (error) {
    redirect(errorPath(error));
  }
  revalidatePath("/worker/assessment-applications");
  revalidatePath("/worker/available-assessments");
  revalidatePath("/worker/dashboard");
  redirect("/worker/assessment-applications?status=case-created");
}

export async function requestCompanyFundingAction(formData: FormData): Promise<void> {
  const principal = await workerPrincipal();
  const combined = text(formData, "companyFunding");
  const separator = combined.indexOf("|");
  if (separator < 1) {
    redirect("/worker/assessment-applications?error=Select%20a%20Company%20funding%20relationship.");
  }
  try {
    await (await getWorkerAssessmentApplicationService()).requestCompanyFunding(principal, {
      catalogueVersionId: text(formData, "catalogueVersionId"),
      tenantId: combined.slice(0, separator),
      workerLinkId: combined.slice(separator + 1)
    });
  } catch (error) {
    redirect(errorPath(error));
  }
  revalidatePath("/worker/assessment-applications");
  redirect("/worker/assessment-applications?status=funding-requested");
}
