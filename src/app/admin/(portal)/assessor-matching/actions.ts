"use server";

import { redirect } from "next/navigation";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import {
  getInterviewAssignmentService,
  InterviewAssignmentInputError
} from "@/lib/interview/interview-assignment-service";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
function list(formData: FormData, name: string): string[] {
  return text(formData, name)
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
}
function redirectError(error: unknown): never {
  const message = error instanceof InterviewAssignmentInputError
    ? error.message
    : "Assessor matching operation could not be completed.";
  redirect(`/admin/assessor-matching?error=${encodeURIComponent(message)}`);
}
async function admin() {
  return requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
}

export async function saveAssessorMatchingProfileAction(formData: FormData): Promise<never> {
  try {
    const principal = await admin();
    let availability: Record<string, unknown> = {};
    const unavailableUntil = text(formData, "unavailableUntil");
    const weekdays = list(formData, "availableWeekdays")
      .map(Number)
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
    if (unavailableUntil) availability.unavailableUntil = new Date(unavailableUntil).toISOString();
    if (weekdays.length) availability.availableWeekdays = weekdays;
    availability.unavailable = text(formData, "unavailable") === "yes";

    await (await getInterviewAssignmentService()).upsertProfile(principal, {
      assessorAccountId: text(formData, "assessorAccountId"),
      tradeScopes: list(formData, "tradeScopes"),
      qualificationScopes: list(formData, "qualificationScopes"),
      languages: list(formData, "languages"),
      jurisdictions: list(formData, "jurisdictions"),
      riskLevels: list(formData, "riskLevels"),
      availability,
      maxActiveInterviews: Number(text(formData, "maxActiveInterviews") || "8"),
      status: text(formData, "status") === "PAUSED" ? "PAUSED" : "ACTIVE"
    });
  } catch (error) {
    redirectError(error);
  }
  redirect("/admin/assessor-matching?result=profile-saved");
}

export async function runAssessorMatchingAction(formData: FormData): Promise<never> {
  try {
    const principal = await admin();
    const result = await (await getInterviewAssignmentService()).matchAndAssign(
      principal,
      text(formData, "interviewRequestId")
    );
    redirect(
      `/admin/assessor-matching?result=${encodeURIComponent(
        result.selectedAssessorAccountId ? "assigned" : "no-eligible-assessor"
      )}`
    );
  } catch (error) {
    redirectError(error);
  }
}
