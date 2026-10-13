"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import {
  CredentialAppealReviewAuthorizationError,
  APPEAL_OUTCOME_ACTIONS,
  type AppealOutcomeAction
} from "@/lib/credential/credential-appeals-domain";
import { AppealFollowupAccessError, AppealFollowupConflictError, CredentialAppealFollowupService } from "@/lib/credential/credential-appeal-followup-service";
import { CredentialAppealsRepository } from "@/lib/credential/credential-appeals-repository";
import { CredentialAppealsService } from "@/lib/credential/credential-appeals-service";
import { CredentialRenewalInputError } from "@/lib/credential/credential-renewal-service";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function reviewCredentialAppealAction(formData: FormData): Promise<void> {
  const principal = await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const appealId = text(formData, "appealId");
  const status = text(formData, "status");
  const versionText = text(formData, "expectedVersion");
  const expectedVersion = Number(versionText);
  if (!/^[1-9]\d*$/.test(versionText) || !Number.isSafeInteger(expectedVersion) || expectedVersion > 2147483647) {
    redirect("/admin/appeals?error=conflict");
  }
  const reason = text(formData, "reason");
  const outcomeAction = text(formData, "outcomeAction") as AppealOutcomeAction;

  if (status !== "under_review" && status !== "accepted" && status !== "rejected") {
    redirect("/admin/appeals?error=status");
  }
  if (reason.length < 10) {
    redirect("/admin/appeals?error=reason");
  }
  if (!APPEAL_OUTCOME_ACTIONS.includes(outcomeAction)) {
    redirect("/admin/appeals?error=action");
  }
  if (status !== "accepted" && outcomeAction !== "none") {
    redirect("/admin/appeals?error=action");
  }

  const repository = new CredentialAppealsRepository();
  const appeal = await repository.find(appealId);
  if (!appeal) redirect("/admin/appeals?error=missing");
  if (appeal.version !== expectedVersion || (appeal.status !== "submitted" && appeal.status !== "under_review")) {
    redirect("/admin/appeals?error=conflict");
  }

  try {
    await new CredentialAppealsService().reviewOutcome(appeal, {
    status,
    reviewerId: principal.accountId,
    reason,
    outcomeAction
    });
  } catch (error) {
    if (error instanceof CredentialAppealReviewAuthorizationError) redirect("/admin/appeals?error=independence");
    if (error instanceof Error && error.message === "Appeal update conflict.") redirect("/admin/appeals?error=conflict");
    if (error instanceof Error && error.message.includes("Required appeal followup")) redirect("/admin/appeals?error=followup");
    if (error instanceof CredentialRenewalInputError) redirect("/admin/appeals?error=renewal");
    throw error;
  }

  revalidatePath("/admin/appeals");
  revalidatePath("/worker/appeals");
  revalidatePath("/worker/passport");
  revalidatePath("/worker/dashboard");
  redirect("/admin/appeals?status=updated");
}
export async function requestCredentialAppealFollowupAction(formData:FormData):Promise<void>{
 const principal=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const appealId=text(formData,"appealId"),raw=text(formData,"expectedVersion"),expectedVersion=Number(raw),kind=text(formData,"kind");
 if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(expectedVersion)||expectedVersion>2147483646)redirect("/admin/appeals?error=conflict");
 if(kind!=="evidence"&&kind!=="interview")redirect("/admin/appeals?error=action");
 const reason=text(formData,"reason");if(reason.length<10||reason.length>4000)redirect("/admin/appeals?error=reason");
 try{await new CredentialAppealFollowupService().request({principal,appealId,expectedVersion,kind,reason});}
 catch(error){
  if(error instanceof AppealFollowupConflictError)redirect("/admin/appeals?error=conflict");
  if(error instanceof AppealFollowupAccessError || error instanceof CredentialAppealReviewAuthorizationError)redirect("/admin/appeals?error=independence");
  throw error;
 }
 revalidatePath("/admin/appeals");revalidatePath("/worker/appeals");revalidatePath("/worker/interviews");revalidatePath("/admin/assessor-matching");redirect("/admin/appeals?status=updated");
}
