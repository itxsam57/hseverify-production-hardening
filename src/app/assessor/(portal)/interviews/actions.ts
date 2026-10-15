"use server";
import {requireLiveReviewActor} from "@/lib/review/review-calibration-authority";
import {findAppealInterviewContext} from "@/lib/credential/appeal-interview-context";
import {CredentialAppealFollowupService} from "@/lib/credential/credential-appeal-followup-service";

import { revalidatePath } from "next/cache";
import { redirect, notFound } from "next/navigation";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { advanceAfterInterviewRecommendation } from "@/lib/assurance/assurance-case-progression-service";
import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";
import { InterviewPolicyInputError } from "@/lib/interview/interview-policy-domain";
import { InterviewAssignmentService } from "@/lib/interview/interview-assignment-service";
import { InterviewRuntimeService, InterviewRuntimeConflictError, isCompleteInterviewScorecard } from "@/lib/interview/interview-runtime-service";
import { InterviewPlaybookAccessError, InterviewPlaybookInputError, validateInterviewFrozenScorecard, getInterviewPlaybookService } from "@/lib/interview/interview-playbook-service";
import {
  INTERVIEW_CONSOLE_RECOMMENDATIONS,
  InterviewSchedulingInputError,
  type InterviewConsoleRecommendation
} from "@/lib/interview/interview-scheduling-domain";
import { InterviewAssignmentAccessError, InterviewSchedulingService } from "@/lib/interview/interview-scheduling-service";
import { InterviewSchedulingRepository } from "@/lib/interview/interview-scheduling-repository";

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
    questionSetId: text(formData, "questionSetId"),
    questionSetVersion: Number(text(formData, "questionSetVersion")),
    coveredQuestionIds: formData.getAll("coveredQuestionId").map(value => String(value)),
    safetyFindings: [...formData.entries()].filter(([key, value]) => key.startsWith("safety:") && String(value).trim())
      .map(([key, value]) => ({
        criterionId: key.slice(7), status: String(value),
        comments: text(formData, "safetyComments:" + key.slice(7)) || null
      })),
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
    comments: input.comments,
    questionSetId: input.questionSetId,
    questionSetVersion: input.questionSetVersion,
    coveredQuestionIds: input.coveredQuestionIds,
    safetyFindings: input.safetyFindings
  };
}

function completeScorecard(input: ReturnType<typeof consoleInput>): boolean {
  return isCompleteInterviewScorecard(scorecard(input));
}

async function frozenScorecard(
  database: DatabaseClient, request: {tenantId:string;caseId:string;interviewRequestId:string},
  input: ReturnType<typeof consoleInput>, complete: boolean
) {
  const scores = scorecard(input);
  const frozen = await validateInterviewFrozenScorecard(database,request.tenantId,request.caseId,request.interviewRequestId,scores,complete);
  const runtime = await database.query<{status:string;interview_session_id:string}>(
    "SELECT status,interview_session_id FROM interview_runtime_sessions WHERE tenant_id=$1 AND interview_request_id=$2 FOR UPDATE",
    [request.tenantId,request.interviewRequestId]);
  if ((runtime.rows[0] || frozen || complete) &&
      runtime.rows[0]?.interview_session_id !== input.interviewSessionId) {
    throw new InterviewPolicyInputError("Interview session does not match the current runtime.");
  }
  if (!frozen) return scores;
  const saved = await database.query<{scorecard:Record<string,unknown>}>(
    "SELECT scorecard FROM interview_console_drafts WHERE tenant_id=$1 AND interview_request_id=$2 ORDER BY updated_at DESC LIMIT 1 FOR UPDATE",
    [request.tenantId,request.interviewRequestId]);
  if (runtime.rows[0]?.status === "ENDED") {
    const previous = await validateInterviewFrozenScorecard(database,request.tenantId,request.caseId,request.interviewRequestId,saved.rows[0]?.scorecard,true);
    if (JSON.stringify(previous) !== JSON.stringify(frozen)) {
      throw new InterviewPolicyInputError("Coverage and safety findings are frozen when the interview is ended.");
    }
  }
  if (complete && frozen.safetyFindings.some(finding => finding.status === "CONFIRMED") && input.recommendation !== "FAIL") {
    throw new InterviewPolicyInputError("A confirmed automatic-fail safety finding requires the Fail recommendation.");
  }
  return {...scores,...frozen,...(runtime.rows[0]?.status === "ENDED" ? {activeSeconds:saved.rows[0]?.scorecard.activeSeconds} : {})};
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

function consoleActionFailure(error: unknown, interviewRequestId: string): never {
  if (error instanceof InterviewAssignmentAccessError || error instanceof InterviewPlaybookAccessError) notFound();
  if (error instanceof InterviewPolicyInputError || error instanceof InterviewRuntimeConflictError ||
      (error instanceof InterviewPlaybookInputError && error.message !== "Interview is closed.")) {
    redirect("/assessor/interviews/" + encodeURIComponent(interviewRequestId) + "?consoleError=policy&consoleMessage=" + encodeURIComponent(error.message));
  }
  if (error instanceof InterviewSchedulingInputError ||
      (error instanceof InterviewPlaybookInputError && error.message === "Interview is closed.")) {
    redirect("/assessor/interviews/" + encodeURIComponent(interviewRequestId) + "?consoleError=closed");
  }
  throw error;
}

export async function saveInterviewConsoleAction(formData: FormData): Promise<void> {
  if (text(formData, "intent") === "submit") {
    return submitInterviewConsoleAction(formData);
  }
  const input = consoleInput(formData);
  const actor = await assessorActor();
  const database = await getDatabaseClient();
  try {
    await database.transaction(async(transaction)=>{
  const service = new InterviewSchedulingService(transaction);
  const preliminary = await service.getAssignedInterview({assessorAccountId:actor.accountId,interviewRequestId:input.interviewRequestId});
  const currentCase = await transaction.query<{case_status:string;interview_reference:string|null}>(
    "SELECT case_status,interview_reference FROM assurance_cases WHERE case_id=$1 AND tenant_id=$2 FOR UPDATE",
    [preliminary.caseId,preliminary.tenantId]);
  const appealContext=await findAppealInterviewContext(transaction,input.interviewRequestId,true);
  const request = await new InterviewSchedulingRepository(transaction).findByRequestIdForAssessor(input.interviewRequestId,actor.accountId,true);
  if (!request) throw new InterviewAssignmentAccessError();

  if (!["ASSIGNED","WAITING_ROOM"].includes(request.status) || (!appealContext && (currentCase.rows[0]?.case_status !== "Interview pending" ||
      currentCase.rows[0].interview_reference !== input.interviewRequestId))) throw new InterviewSchedulingInputError("Interview is closed.");
  await service.saveConsoleState({
    tenantId: request.tenantId,
    interviewSessionId: input.interviewSessionId,
    interviewRequestId: input.interviewRequestId,
    notes: input.notes ? [{ content: input.notes, authorAccountId: actor.accountId }] : [],
    scorecard: await frozenScorecard(transaction,request,input,false),
    recommendation: input.recommendation,
    submitted: false,
    updatedAt: new Date().toISOString()
  });
    });
  } catch (error) {
    consoleActionFailure(error, input.interviewRequestId);
  }
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
    throw new Error("Every interview score dimension and scorecard comments are required before final submission.");
  }
  const recommendation = input.recommendation as InterviewConsoleRecommendation;

  const actor = await assessorActor();
  const now = new Date();
  const database = await getDatabaseClient();
  try {
    await database.transaction(async (transaction) => {
    await requireLiveReviewActor(transaction,actor,"assessor",true);
    const service = new InterviewSchedulingService(transaction);
    const preliminary = await service.getAssignedInterview({
      assessorAccountId: actor.accountId,
      interviewRequestId: input.interviewRequestId
    });
    const caseLock = await transaction.query<{case_status:string;interview_reference:string|null}>(
      "SELECT case_status,interview_reference FROM assurance_cases WHERE case_id=$1 AND tenant_id=$2 FOR UPDATE",
      [preliminary.caseId,preliminary.tenantId]);
    const appealContext=await findAppealInterviewContext(transaction,input.interviewRequestId,true);
    const request = await new InterviewSchedulingRepository(transaction).findByRequestIdForAssessor(input.interviewRequestId,actor.accountId,true);
    if (!request || (!appealContext && (caseLock.rows[0]?.case_status !== "Interview pending" ||
        caseLock.rows[0].interview_reference !== input.interviewRequestId)) ||
        !["ASSIGNED","WAITING_ROOM"].includes(request.status)) {
      throw new InterviewSchedulingInputError("Only the current open interview can submit a recommendation.");
    }
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
      scorecard: await frozenScorecard(transaction,request,input,true),
      recommendation,
      submitted: true,
      updatedAt: now.toISOString()
    });
    await service.completeInterview({
      tenantId: request.tenantId,
      request,
      assessorAccountId: actor.accountId
    });
    if(!appealContext)await advanceAfterInterviewRecommendation(transaction, {
      caseId: request.caseId,
      tenantId: request.tenantId,
      recommendation,
      actor: { accountId: actor.accountId, role: "assessor" },
      now
    });
    const eventId = "interview_recommendation_" + crypto.randomUUID().replaceAll("-", "");
    await transaction.query(
      "INSERT INTO interview_recommendation_events(event_id,interview_request_id,tenant_id,case_id,assessor_account_id,recommendation) VALUES($1,$2,$3,$4,$5,$6)",
      [eventId,input.interviewRequestId,request.tenantId,request.caseId,actor.accountId,recommendation]
    );
    if(appealContext)await new CredentialAppealFollowupService(Promise.resolve(transaction)).respondInterview({principal:actor,interviewRequestId:input.interviewRequestId,recommendationEventId:eventId});
    else await transaction.query("SELECT platform_enqueue_assurance_event_notifications($1,$2)",["interview.recommended","recommendation:"+eventId]);
    });
  } catch (error) {
    consoleActionFailure(error, input.interviewRequestId);
  }

  revalidateInterview(input.interviewRequestId);
}


export async function requestReplacementInterviewAction(formData:FormData):Promise<void> {
  const actor=await assessorActor();
  const interviewRequestId=text(formData,"interviewRequestId");
  if(!interviewRequestId || interviewRequestId.length>200)notFound();
  const service=new InterviewSchedulingService(await getDatabaseClient());
  let replacement;
  try {
    replacement=await service.requestReplacementInterview({principal:actor,interviewRequestId,reason:text(formData,"replacementReason")});
  } catch(error) {
    if(error instanceof InterviewAssignmentAccessError)notFound();
    if(error instanceof InterviewSchedulingInputError)redirect("/assessor/interviews/"+encodeURIComponent(interviewRequestId)+"?recoveryError=invalid");
    throw error;
  }
  revalidateInterview(interviewRequestId);
  revalidateInterview(replacement.interviewRequestId);
  revalidatePath("/worker/interviews/"+interviewRequestId);
  revalidatePath("/worker/interviews/"+replacement.interviewRequestId);
  redirect("/assessor/interviews?recoverySaved=yes");
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

  try {
    await service.scheduleInterview({ principal: actor, tenantId: request.tenantId, request, scheduledAt,
      reminderAt: text(formData, "reminderAt"), rescheduleReason: text(formData, "rescheduleReason") });
  } catch (error) {
    if (error instanceof InterviewSchedulingInputError) redirect("/assessor/interviews?scheduleError=invalid");
    throw error;
  }
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
  await getInterviewPlaybookService().ensure(actor, interviewRequestId);
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
  try {
    await new InterviewRuntimeService().end(actor, interviewRequestId);
  } catch (error) {
    consoleActionFailure(error, interviewRequestId);
  }
  revalidateInterview(interviewRequestId);
}


export async function addInterviewFollowUpAction(formData: FormData): Promise<void> {
  const interviewRequestId = text(formData, "interviewRequestId");
  const prompt = text(formData, "prompt");
  const actor = await assessorActor();
  try {
    await getInterviewPlaybookService().addFollowUp(actor, interviewRequestId, prompt);
  } catch (error) {
    consoleActionFailure(error, interviewRequestId);
  }
  revalidateInterview(interviewRequestId);
}