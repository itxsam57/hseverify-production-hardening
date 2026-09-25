"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { WrittenScoringService } from "@/lib/scoring/written-scoring-service";
import { getDatabaseClient } from "@/lib/database/database";

function text(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function finalizeWrittenScoreAction(form: FormData) {
  const actor = await requirePlatformPermission({ expectedRole: "verifier", permission: "verification.assigned.decide" });
  await new WrittenScoringService(await getDatabaseClient()).finalizeAndAdvance({
    reviewId: text(form, "reviewId"),
    reviewerAccountId: actor.accountId,
    tenantId: actor.tenantMembership?.tenantId,
  });
  revalidatePath("/verifier/reviews");
  revalidatePath("/verifier/reviews/scoring");
}

export async function addWrittenScoreRubricMarkAction(form: FormData) {
  const actor = await requirePlatformPermission({ expectedRole: "verifier", permission: "verification.assigned.decide" });
  await new WrittenScoringService(await getDatabaseClient()).addRubricMark({
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
  await new WrittenScoringService(await getDatabaseClient()).saveDraftDecision({
    reviewId: text(form, "reviewId"),
    reviewerAccountId: actor.accountId,
    tenantId: actor.tenantMembership?.tenantId,
    score: Number(text(form, "score")),
    decision: text(form, "decision"),
    reason: text(form, "reason")
  });
  revalidatePath("/verifier/reviews/scoring");
}
