"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
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
  try {
  await new PrivacyOperationsService().reviewRequest({
    requestId: text(formData, "requestId"), expectedStatus: text(formData, "expectedStatus"),
    reviewerAccountId: principal.accountId, reviewerSessionId:principal.sessionId, decision, reason: text(formData, "reason"),
    approvedCorrection: decision==="COMPLETED" && yes(formData,"approveExactScope") && text(formData,"correctionScope")==="profile_contact_city"
      ? {scope:"profile_contact_city",city:text(formData,"correctionCity"),expectedProfileVersion:Number(text(formData,"profileVersion"))}:undefined,
    approvedDeletion: decision==="COMPLETED" && yes(formData,"approveExactScope") && text(formData,"deletionScope")==="expired_recording"
      ? {scope:"expired_recording",recordingAssetId:text(formData,"recordingAssetId")}:undefined
  });
  revalidatePath("/admin/privacy");
  revalidatePath("/worker/privacy");
  revalidatePath("/worker/share-links");
  revalidatePath("/worker/profile");
  } catch(error) {
    const message=error instanceof Error && /scope|correction|profile|approval|Admin|Worker|recording|retention|hold|appeal|case|changed|unavailable/i.test(error.message)
      ? error.message.slice(0,240):"Privacy execution could not finish. The request remains open for review or retry.";
    redirect("/admin/privacy?privacyError="+encodeURIComponent(message));
  }
}

export async function scheduleRetentionAction(formData:FormData):Promise<void> {
  await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
  await new PrivacyOperationsService().scheduleRetention({id:randomUUID(),tenantId:text(formData,"tenantId"),
    resourceType:"expired_interview_recordings",before:text(formData,"retentionBefore")+"T00:00:00.000Z"});
  revalidatePath("/admin/privacy");
}

export async function executeRetentionAction(formData:FormData):Promise<void> {
  const principal=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
  try {
    if (!yes(formData,"approveRetention")) throw new Error("Retention execution requires explicit Admin approval.");
    await new PrivacyOperationsService().completeRetention({id:text(formData,"jobId"),tenantId:text(formData,"tenantId"),status:"PENDING",
      reviewerAccountId:principal.accountId,reviewerSessionId:principal.sessionId,reason:text(formData,"reason")});
  } catch(error) {
    const message=error instanceof Error && /Admin|policy|category|cutoff|hold|appeal|case|retention|Recording|changed|unavailable/i.test(error.message)
      ? error.message.slice(0,240):"Retention execution could not finish. The job remains pending for retry.";
    redirect("/admin/privacy?privacyError="+encodeURIComponent(message));
  }
  revalidatePath("/admin/privacy");
}
