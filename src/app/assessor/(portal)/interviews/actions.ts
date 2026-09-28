"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { advanceAfterInterviewRecommendation } from "@/lib/assurance/assurance-case-progression-service";
import { getDatabaseClient } from "@/lib/database/database";
import { InterviewAssignmentService } from "@/lib/interview/interview-assignment-service";
import { InterviewRuntimeService } from "@/lib/interview/interview-runtime-service";
import {
  INTERVIEW_CONSOLE_RECOMMENDATIONS,
  type InterviewConsoleRecommendation
} from "@/lib/interview/interview-scheduling-domain";
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
    practicalReasoning: score(formData, "practicalReasoning"),
    safetyAwareness: score(formData, "safetyAwareness"),
    communication: score(formData, "communication"),
    consistencyWithWrittenAnswers: score(formData, "consistencyWithWrittenAnswers"),
    confidenceClarity: score(formData, "confidenceClarity"),
    tradeJudgment: score(formData, "tradeJudgment"),
    comments: text(formData, "comments") || null,
    recommendation: text(formData, "recommendation") || null
  };
}

function scorecard(input: ReturnType<typeof consoleInput>) {
  return {
    technicalKnowledge: input.technicalKnowledge,
    practicalReasoning: input.practicalReasoning,
    safetyAwareness: input.safetyAwareness,
    communication: input.communication,
    consistencyWithWrittenAnswers: input.consistencyWithWrittenAnswers,
    confidenceClarity: input.confidenceClarity,
    tradeJudgment: input.tradeJudgment,
    comments: input.comments
  };
}

function completeScorecard(input: ReturnType<typeof consoleInput>): boolean {
  return [
    input.technicalKnowledge,
    input.practicalReasoning,
    input.safetyAwareness,
    input.communication,
    input.consistencyWithWrittenAnswers,
    input.confidenceClarity,
    input.tradeJudgment
  ].every((value) => value !== null);
}

async function assessorActor() {
  return requirePlatformPermission({
    expectedRole: "assessor",
    permission: "interview.assigned.manage"
  });
}

function revalidateInterview(interviewRequestId: string): void {
  revalidatePath("/assessor/interviews");
  revalidatePath(`/assessor/interviews/${interviewRequestId}`);
}

export async function saveInterviewConsoleAction(formData: FormData): Promise<void> {
  const input = consoleInput(formData);
  const actor = await assessorActor();
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
    scorecard: scorecard(input),
    recommendation: input.recommendation,
    submitted: false,
    updatedAt: new Date().toISOString()
  });
  revalidateInterview(input.interviewRequestId);
}

export async function submitInterviewConsoleAction(formData: FormData): Promise<void> {
  const input = consoleInput(formData);
  if (
    !input.recommendation ||
    !INTERVIEW_CONSOLE_RECOMMENDATIONS.includes(
      input.recommendation as InterviewConsoleRecommendation
    )
  ) {
    throw new Error("A valid interview recommendation is required before final submission.");
  }
  if (!completeScorecard(input)) {
    throw new Error("Every interview score dimension is required before final submission.");
  }
  const recommendation = input.recommendation as InterviewConsoleRecommendation;

  const actor = await assessorActor();
  const now = new Date();
  const database = await getDatabaseClient();
  await database.transaction(async (transaction) => {
    const service = new InterviewSchedulingService(transaction);
    const request = await service.getAssignedInterview({
      assessorAccountId: actor.accountId,
      interviewRequestId: input.interviewRequestId
    });
    const runtime = await new InterviewRuntimeService(Promise.resolve(transaction)).view(
      actor,
      input.interviewRequestId
    );
    if (runtime.status !== "ENDED") {
      throw new Error("End the interview runtime before submitting the final recommendation.");
    }

    await service.saveConsoleState({
      tenantId: request.tenantId,
      interviewSessionId: input.interviewSessionId,
      interviewRequestId: input.interviewRequestId,
      notes: input.notes ? [{ content: input.notes, authorAccountId: actor.accountId }] : [],
      scorecard: scorecard(input),
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

  revalidateInterview(input.interviewRequestId);
}

export async function scheduleInterviewAction(formData: FormData): Promise<void> {
  const interviewRequestId = text(formData, "interviewRequestId");
  const scheduledAt = text(formData, "scheduledAt");
  if (!interviewRequestId || !scheduledAt) throw new Error("Interview schedule is required.");

  const actor = await assessorActor();
  const service = new InterviewSchedulingService(await getDatabaseClient());
  const request = await service.getAssignedInterview({
    assessorAccountId: actor.accountId,
    interviewRequestId
  });

  await service.scheduleInterview({ tenantId: request.tenantId, request, scheduledAt });
  revalidateInterview(interviewRequestId);
}

export async function declareInterviewConflictAction(formData: FormData): Promise<void> {
  const interviewRequestId = text(formData, "interviewRequestId");
  const reason = text(formData, "reason");
  if (!interviewRequestId) throw new Error("Interview request is required.");

  const actor = await assessorActor();
  const database = await getDatabaseClient();
  await database.transaction(async (transaction) => {
    await new InterviewAssignmentService(transaction).declareConflictAndRematch(
      actor,
      interviewRequestId,
      reason
    );
  });
  revalidateInterview(interviewRequestId);
}

export async function claimInterviewAction(formData: FormData): Promise<void> {
  const interviewRequestId = text(formData, "interviewRequestId");
  const actor = await assessorActor();
  await new InterviewRuntimeService().claim(actor, interviewRequestId);
  revalidateInterview(interviewRequestId);
}

export async function admitInterviewAction(formData: FormData): Promise<void> {
  const interviewRequestId = text(formData, "interviewRequestId");
  const actor = await assessorActor();
  await new InterviewRuntimeService().admit(actor, interviewRequestId);
  revalidateInterview(interviewRequestId);
}

export async function startInterviewAction(formData: FormData): Promise<void> {
  const interviewRequestId = text(formData, "interviewRequestId");
  const actor = await assessorActor();
  await new InterviewRuntimeService().start(actor, interviewRequestId);
  revalidateInterview(interviewRequestId);
}

export async function pauseInterviewAction(formData: FormData): Promise<void> {
  const interviewRequestId = text(formData, "interviewRequestId");
  const reason = text(formData, "pauseReason");
  const actor = await assessorActor();
  await new InterviewRuntimeService().pause(actor, interviewRequestId, reason);
  revalidateInterview(interviewRequestId);
}

export async function resumeInterviewAction(formData: FormData): Promise<void> {
  const interviewRequestId = text(formData, "interviewRequestId");
  const actor = await assessorActor();
  await new InterviewRuntimeService().resume(actor, interviewRequestId);
  revalidateInterview(interviewRequestId);
}

export async function reportAssessorInterviewTechnicalIssueAction(formData: FormData): Promise<void> {
  const interviewRequestId = text(formData, "interviewRequestId");
  const issue = text(formData, "issue");
  const actor = await assessorActor();
  await new InterviewRuntimeService().technicalIssue(actor, interviewRequestId, issue);
  revalidateInterview(interviewRequestId);
}

export async function markInterviewNoShowAction(formData: FormData): Promise<void> {
  const interviewRequestId = text(formData, "interviewRequestId");
  const actor = await assessorActor();
  await new InterviewRuntimeService().noShow(actor, interviewRequestId);
  revalidateInterview(interviewRequestId);
}

export async function endInterviewAction(formData: FormData): Promise<void> {
  const interviewRequestId = text(formData, "interviewRequestId");
  const actor = await assessorActor();
  await new InterviewRuntimeService().end(actor, interviewRequestId);
  revalidateInterview(interviewRequestId);
}
