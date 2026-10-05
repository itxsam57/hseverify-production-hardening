"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { PrivacyOperationsService } from "@/lib/privacy/privacy-operations-service";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
function yes(formData: FormData, key: string): boolean {
  return text(formData, key) === "yes";
}

export async function reviewAccommodationAction(formData: FormData): Promise<void> {
  const principal = await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const decision = text(formData, "decision");
  if (decision !== "APPROVED" && decision !== "DECLINED") {
    throw new Error("Accommodation decision is invalid.");
  }
  await new PrivacyOperationsService().reviewAccommodation({
    accommodationId: text(formData, "accommodationId"),
    reviewerAccountId: principal.accountId,
    decision,
    reason: text(formData, "reason"),
    caseId: decision === "APPROVED" ? text(formData, "caseId") : null,
    adjustment: decision === "APPROVED"
      ? {
          timeMultiplier: Number(text(formData, "timeMultiplier") || "1"),
          extraBreakMinutes: Number(text(formData, "extraBreakMinutes") || "0"),
          screenReader: yes(formData, "screenReader"),
          captions: yes(formData, "captions"),
          interpreter: yes(formData, "interpreter"),
          reducedMotion: yes(formData, "reducedMotion")
        }
      : undefined
  });
  revalidatePath("/admin/privacy");
  revalidatePath("/worker/privacy");
  revalidatePath("/worker/accessibility");
}

export async function reviewPrivacyRequestAction(formData: FormData): Promise<void> {
  const principal = await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" });
  const decision = text(formData, "decision");
  if (decision !== "PROCESSING" && decision !== "REJECTED" && decision !== "COMPLETED") throw new Error("Privacy request decision is invalid.");
  await new PrivacyOperationsService().reviewRequest({
    requestId: text(formData, "requestId"), expectedStatus: text(formData, "expectedStatus"),
    reviewerAccountId: principal.accountId, decision, reason: text(formData, "reason")
  });
  revalidatePath("/admin/privacy");
  revalidatePath("/worker/privacy");
  revalidatePath("/worker/share-links");
}
