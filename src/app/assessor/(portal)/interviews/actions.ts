"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { InterviewSchedulingService } from "@/lib/interview/interview-scheduling-service";

export async function saveInterviewConsoleAction(formData: FormData): Promise<void> {
  const interviewSessionId = String(formData.get("interviewSessionId") ?? "").trim();
  const interviewRequestId = String(formData.get("interviewRequestId") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const recommendation = String(formData.get("recommendation") ?? "").trim() || null;
  if (!interviewSessionId || !interviewRequestId) throw new Error("Interview session is required.");

  const actor = await requirePlatformPermission({ expectedRole: "assessor", permission: "interview.assigned.manage" });
  const service = new InterviewSchedulingService(await getDatabaseClient());
  const request = await service.getAssignedInterview({
    assessorAccountId: actor.accountId,
    interviewRequestId
  });

  await service.saveConsoleState({
    tenantId: request.tenantId,
    interviewSessionId,
    interviewRequestId,
    notes: notes ? [{ content: notes, authorAccountId: actor.accountId }] : [],
    scorecard: {
      technicalKnowledge: Number(formData.get("technicalKnowledge")) || null,
      safetyAwareness: Number(formData.get("safetyAwareness")) || null,
      comments: String(formData.get("comments") ?? "").trim() || null
    },
    recommendation,
    submitted: false,
    updatedAt: new Date().toISOString()
  });
  revalidatePath(`/assessor/interviews/${interviewRequestId}`);
}

export async function scheduleInterviewAction(formData: FormData): Promise<void> {
  const interviewRequestId = String(formData.get("interviewRequestId") ?? "").trim();
  const scheduledAt = String(formData.get("scheduledAt") ?? "").trim();
  if (!interviewRequestId || !scheduledAt) throw new Error("Interview schedule is required.");

  const actor = await requirePlatformPermission({
    expectedRole: "assessor",
    permission: "interview.assigned.manage"
  });
  const service = new InterviewSchedulingService(await getDatabaseClient());
  const request = await service.getAssignedInterview({
    assessorAccountId: actor.accountId,
    interviewRequestId
  });

  await service.scheduleInterview({ tenantId: request.tenantId, request, scheduledAt });
  revalidatePath("/assessor/interviews");
}
