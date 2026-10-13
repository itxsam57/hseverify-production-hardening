"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { WrittenScoringService } from "@/lib/scoring/written-scoring-service";
import { getDatabaseClient } from "@/lib/database/database";
import { WrittenScoringAssistanceService } from "@/lib/scoring/written-scoring-assistance-service";

function text(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function finalizeWrittenScoreAction(form: FormData) {
  const actor = await requirePlatformPermission({ expectedRole: "verifier", permission: "verification.assigned.decide" });
  await new WrittenScoringService(await getDatabaseClient(),actor).finalizeAndAdvance({
    reviewId: text(form, "reviewId"),
    reviewerAccountId: actor.accountId,
    tenantId: actor.tenantMembership?.tenantId,
    assessorVisible: form.get("assessorVisible") === "on",
  });
  revalidatePath("/verifier/reviews");
  revalidatePath("/verifier/reviews/scoring");
}

export async function addWrittenScoreRubricMarkAction(form: FormData) {
  const actor = await requirePlatformPermission({ expectedRole: "verifier", permission: "verification.assigned.decide" });
  await new WrittenScoringService(await getDatabaseClient(),actor).addRubricMark({
    reviewId: text(form, "reviewId"),
    criterion: text(form, "criterion"),
    mark: Number(text(form, "mark")),
    reviewerAccountId: actor.accountId,
  });
  revalidatePath("/verifier/reviews/scoring");
}


export async function saveWrittenScoreDecisionAction(form: FormData) {
  const actor = await requirePlatformPermission({
    expectedRole: "verifier",
    permission: "verification.assigned.decide"
  });
  await new WrittenScoringService(await getDatabaseClient(),actor).saveDraftDecision({
    reviewId: text(form, "reviewId"),
    reviewerAccountId: actor.accountId,
    tenantId: actor.tenantMembership?.tenantId,
    score: Number(text(form, "score")),
    decision: text(form, "decision"),
    reason: text(form, "reason")
  });
  revalidatePath("/verifier/reviews/scoring");
}


export async function generateWrittenScoringAssistanceAction(form: FormData) {
  const actor = await requirePlatformPermission({
    expectedRole: "verifier",
    permission: "verification.assigned.decide"
  });
  await new WrittenScoringAssistanceService().generate({
    reviewId: text(form, "reviewId"),
    reviewerAccountId: actor.accountId
  });
  revalidatePath("/verifier/reviews/scoring");
}

export async function reviewWrittenScoringAssistanceAction(form: FormData) {
  const actor = await requirePlatformPermission({
    expectedRole: "verifier",
    permission: "verification.assigned.decide"
  });
  const decision = text(form, "guidanceDecision");
  if (decision !== "ACCEPTED_AS_GUIDANCE" && decision !== "REJECTED") {
    throw new Error("AI guidance decision is invalid.");
  }
  await new WrittenScoringAssistanceService().reviewGuidance({
    assistanceId: text(form, "assistanceId"),
    reviewerAccountId: actor.accountId,
    decision,
    reason: text(form, "guidanceReason")
  });
  revalidatePath("/verifier/reviews/scoring");
}
