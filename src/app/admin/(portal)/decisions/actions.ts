"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { DecisionEngineService } from "@/lib/decision/decision-engine-service";
import { createManualDecisionOverride } from "@/lib/decision/decision-engine-domain";

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function createDecisionAction(formData: FormData): Promise<void> {
  await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" });
  const service = new DecisionEngineService();
  await service.createAndRecord({
    tenantId: text(formData, "tenantId"),
    caseId: text(formData, "caseId"),
    state: text(formData, "state"),
    reasonCode: text(formData, "reasonCode"),
    explanation: text(formData, "explanation"),
    ruleVersion: text(formData, "ruleVersion"),
    inputReferences: text(formData, "inputReferences").split(",").map((value) => value.trim()).filter(Boolean)
  });
  revalidatePath("/admin/decisions");
}

export async function createDecisionOverrideAction(formData: FormData): Promise<void> {
  const principal = await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" });
  const service = new DecisionEngineService();
  await service.recordOverride(createManualDecisionOverride({
    decisionId: text(formData, "decisionId"),
    tenantId: text(formData, "tenantId"),
    previousState: text(formData, "previousState") as never,
    newState: text(formData, "newState") as never,
    reason: text(formData, "reason"),
    evidenceReference: text(formData, "evidenceReference"),
    confirmed: text(formData, "confirmed") === "true",
    mfaVerifiedAt: text(formData, "mfaVerifiedAt") || new Date().toISOString(),
    notificationRequired: true,
    actorReference: principal.accountId,
    createdAt: new Date().toISOString()
  }));
  revalidatePath("/admin/decisions");
}
