"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { DecisionEngineService } from "@/lib/decision/decision-engine-service";
import {
  createManualDecisionOverride,
  DecisionInputError
} from "@/lib/decision/decision-engine-domain";

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

function safeDecisionError(error: unknown): string {
  if (error instanceof DecisionInputError) return error.message;
  if (error instanceof Error) {
    const allowed = new Set([
      "Assurance Case is not ready for a final decision.",
      "Sign in again with MFA before overriding a decision.",
      "Decision override target is outside the tenant boundary or does not exist.",
      "Decision override previous state does not match current decision state.",
      "Decision override target could not be resolved within the tenant boundary."
    ]);
    if (allowed.has(error.message)) return error.message;
  }
  return "Decision operation could not be completed.";
}

function decisionErrorPath(formData: FormData, message: string): string {
  const params = new URLSearchParams();
  const tenantId = text(formData, "tenantId").trim();
  const caseId = text(formData, "caseId").trim();
  if (tenantId) params.set("tenantId", tenantId);
  if (caseId) params.set("caseId", caseId);
  params.set("error", message);
  return `/admin/decisions?${params.toString()}`;
}

export async function createDecisionAction(formData: FormData): Promise<void> {
  const principal = await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const service = new DecisionEngineService();
  try {
    await service.createAndRecord({
      tenantId: text(formData, "tenantId"),
      caseId: text(formData, "caseId"),
      state: text(formData, "state"),
      reasonCode: text(formData, "reasonCode"),
      explanation: text(formData, "explanation"),
      ruleVersion: text(formData, "ruleVersion"),
      inputReferences: text(formData, "inputReferences")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      actorAccountId: principal.accountId
    });
  } catch (error) {
    redirect(decisionErrorPath(formData, safeDecisionError(error)));
  }
  revalidatePath("/admin/decisions");
}

export async function createDecisionOverrideAction(formData: FormData): Promise<void> {
  const principal = await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const service = new DecisionEngineService();
  try {
    await service.recordOverride(
      createManualDecisionOverride({
        decisionId: text(formData, "decisionId"),
        tenantId: text(formData, "tenantId"),
        previousState: text(formData, "previousState") as never,
        newState: text(formData, "newState") as never,
        reason: text(formData, "reason"),
        evidenceReference: text(formData, "evidenceReference"),
        confirmed: text(formData, "confirmed") === "true",
        mfaVerifiedAt: "pending-server-verification",
        notificationRequired: true,
        actorReference: principal.accountId,
        createdAt: new Date().toISOString()
      }),
      principal
    );
  } catch (error) {
    redirect(decisionErrorPath(formData, safeDecisionError(error)));
  }
  revalidatePath("/admin/decisions");
}
