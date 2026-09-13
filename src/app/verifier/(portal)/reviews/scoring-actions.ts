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
  await new WrittenScoringService(await getDatabaseClient()).finalize({
    reviewId: text(form, "reviewId"),
    reviewerAccountId: actor.accountId,
    tenantId: actor.tenantMembership?.tenantId,
  });
  revalidatePath("/verifier/reviews");
}

export async function addWrittenScoreRubricMarkAction(form: FormData) {
  const actor = await requirePlatformPermission({ expectedRole: "verifier", permission: "verification.assigned.decide" });
  const tenantId = actor.tenantMembership?.tenantId;
  if (!tenantId) throw new Error("Tenant context required.");
  await new WrittenScoringService(await getDatabaseClient()).addRubricMark({
    reviewId: text(form, "reviewId"),
    criterion: text(form, "criterion"),
    mark: Number(text(form, "mark")),
    reviewerAccountId: actor.accountId,
    tenantId,
  });
  revalidatePath("/verifier/reviews/scoring");
}
