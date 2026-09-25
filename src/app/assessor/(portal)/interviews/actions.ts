"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { advanceAfterInterviewRecommendation } from "@/lib/assurance/assurance-case-progression-service";
import { getDatabaseClient } from "@/lib/database/database";
import { InterviewSchedulingService } from "@/lib/interview/interview-scheduling-service";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function score(formData: FormData, key: string): number | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 5) {
    throw new Error("Interview scores must be whole numbers from zero to five.");
  }
  return value;
}

function consoleInput(formData: FormData) {
  const interviewSessionId = text(formData, "interviewSessionId");
  const interviewRequestId = text(formData, "interviewRequestId");
  if (!interviewSessionId || !interviewRequestId) {
    throw new Error("Interview session is required.");
  }
  return {
    interviewSessionId,
    interviewRequestId,
    notes: text(formData, "notes"),
    technicalKnowledge: score(formData, "technicalKnowledge"),
    safetyAwareness: score(formData, "safetyAwareness"),
    comments: text(formData, "comments") || null,
    recommendation: text(formData, "recommendation") || null
  };
}

export async function saveInterviewConsoleAction(formData: FormData): Promise<void> {
  const input = consoleInput(formData);
  const actor = await requirePlatformPermission({
    expectedRole: "assessor",
    permission: "interview.assigned.manage"
  });
  const service = new InterviewSchedulingService(await getDatabaseClient());
  const request = await service.getAssignedInterview({
    assessorAccountId: actor.accountId,
    interviewRequestId: input.interviewRequestId
  });

  await service.saveConsoleState({
    tenantId: request.tenantId,
    interviewSessionId: input.interviewSessionId,
    interviewRequestId: input.interviewRequestId,
    notes: input.notes ? [{ content: input.notes, authorAccountId: actor.accountId }] : [],
    scorecard: {
      technicalKnowledge: input.technicalKnowledge,
      safetyAwareness: input.safetyAwareness,
      comments: input.comments
    },
    recommendation: input.recommendation,
    submitted: false,
    updatedAt: new Date().toISOString()
  });
  revalidatePath(`/assessor/interviews/${input.interviewRequestId}`);
}

export async function submitInterviewConsoleAction(formData: FormData): Promise<void> {
  const input = consoleInput(formData);
  if (input.recommendation !== "PASS" && input.recommendation !== "FAIL") {
    throw new Error("A PASS or FAIL recommendation is required before final submission.");
  }
  if (input.technicalKnowledge === null || input.safetyAwareness === null) {
    throw new Error("Both interview scores are required before final submission.");
  }
  const recommendation: "PASS" | "FAIL" = input.recommendation;

  const actor = await requirePlatformPermission({
    expectedRole: "assessor",
    permission: "interview.assigned.manage"
  });
  const now = new Date();
  const database = await getDatabaseClient();
  await database.transaction(async (transaction) => {
    const service = new InterviewSchedulingService(transaction);
    const request = await service.getAssignedInterview({
      assessorAccountId: actor.accountId,
      interviewRequestId: input.interviewRequestId
    });

    await service.saveConsoleState({
      tenantId: request.tenantId,
      interviewSessionId: input.interviewSessionId,
      interviewRequestId: input.interviewRequestId,
      notes: input.notes ? [{ content: input.notes, authorAccountId: actor.accountId }] : [],
      scorecard: {
        technicalKnowledge: input.technicalKnowledge,
        safetyAwareness: input.safetyAwareness,
        comments: input.comments
      },
      recommendation,
      submitted: true,
      updatedAt: now.toISOString()
    });
    await service.completeInterview({
      tenantId: request.tenantId,
      request,
      assessorAccountId: actor.accountId
    });
    await advanceAfterInterviewRecommendation(transaction, {
      caseId: request.caseId,
      tenantId: request.tenantId,
      recommendation,
      actor: { accountId: actor.accountId, role: "assessor" },
      now
    });
  });

  revalidatePath("/assessor/interviews");
  revalidatePath(`/assessor/interviews/${input.interviewRequestId}`);
}

export async function scheduleInterviewAction(formData: FormData): Promise<void> {
  const interviewRequestId = text(formData, "interviewRequestId");
  const scheduledAt = text(formData, "scheduledAt");
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
