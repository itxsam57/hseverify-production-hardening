"use server";

import { redirect } from "next/navigation";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getAssessmentAttemptService } from "@/lib/assessment-attempt/assessment-attempt-service";

export async function beginAssessmentAction(formData: FormData): Promise<never> {
  const rawCaseId = formData.get("caseId");
  const rawCatalogueVersionId = formData.get("catalogueVersionId");
  const caseId = typeof rawCaseId === "string" ? rawCaseId.trim() : "";
  const catalogueVersionId =
    typeof rawCatalogueVersionId === "string" ? rawCatalogueVersionId.trim() : "";

  const principal = await requirePlatformPermission({
    expectedRole: "worker",
    permission: "worker.assessments.read"
  });
  const result = await (
    await getAssessmentAttemptService()
  ).begin(principal, { caseId, catalogueVersionId });

  redirect(`/worker/assessments/${result.attempt.attemptId}`);
}
