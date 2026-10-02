"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import {
  APPEAL_OUTCOME_ACTIONS,
  type AppealOutcomeAction
} from "@/lib/credential/credential-appeals-domain";
import { CredentialAppealsRepository } from "@/lib/credential/credential-appeals-repository";
import { CredentialAppealsService } from "@/lib/credential/credential-appeals-service";

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

  await new CredentialAppealsService().reviewOutcome(appeal, {
    status,
    reviewerId: principal.accountId,
    reason,
    outcomeAction
  });

  revalidatePath("/admin/appeals");
  revalidatePath("/worker/appeals");
  revalidatePath("/worker/passport");
  revalidatePath("/worker/dashboard");
  redirect("/admin/appeals?status=updated");
}