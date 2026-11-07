"use server";

import { redirect } from "next/navigation";

import { AssessmentAttemptAnswerInputError } from "@/lib/assessment-attempt/assessment-attempt-domain";
import { AssessmentAttemptDraftInputError } from "@/lib/assessment-attempt/assessment-attempt-draft-domain";
import {
  AssessmentAttemptAccessError,
  AssessmentAttemptConflictError,
  AssessmentAttemptInputError,
  getAssessmentAttemptService
} from "@/lib/assessment-attempt/assessment-attempt-service";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { readAssessmentAccessContext } from "@/lib/assessment-attempt/assessment-device-cookie";

export type AssessmentAnswerActionState = Readonly<{
  status: "idle" | "error" | "conflict";
  message: string;
}>;

export type AssessmentDraftConflictSnapshot = Readonly<{
  value: string | boolean | null;
  revision: number;
  updatedAt: string;
}>;

export type AssessmentDraftActionResult =
  | Readonly<{
      status: "saved";
      revision: number;
      updatedAt: string;
    }>
  | Readonly<{
      status: "conflict";
      message: string;
      serverDraft: AssessmentDraftConflictSnapshot | null;
    }>
  | Readonly<{
      status: "error";
      message: string;
    }>;

function state(
  status: AssessmentAnswerActionState["status"],
  message: string
): AssessmentAnswerActionState {
  return Object.freeze({ status, message });
}

function positiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalPositiveInteger(value: string): number | null | undefined {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function saveAssessmentDraftAction(
  formData: FormData
): Promise<AssessmentDraftActionResult> {
  const rawAttemptId = formData.get("attemptId");
  const rawPosition = formData.get("position");
  const rawDraftPayload = formData.get("draftPayload");
  const rawExpectedRevision = formData.get("expectedRevision");
  const rawClientGeneratedMutationKey = formData.get("clientGeneratedMutationKey");

  const attemptId = typeof rawAttemptId === "string" ? rawAttemptId.trim() : "";
  const position = positiveInteger(typeof rawPosition === "string" ? rawPosition : "");
  const draftPayload = typeof rawDraftPayload === "string" ? rawDraftPayload : "";
  const expectedRevision =
    typeof rawExpectedRevision === "string"
      ? optionalPositiveInteger(rawExpectedRevision)
      : undefined;
  const clientGeneratedMutationKey =
    typeof rawClientGeneratedMutationKey === "string"
      ? rawClientGeneratedMutationKey
      : "";

  if (
    !attemptId ||
    position === null ||
    !draftPayload ||
    expectedRevision === undefined ||
    !clientGeneratedMutationKey
  ) {
    return Object.freeze({
      status: "error" as const,
      message: "This draft could not be saved. Reload the current question and try again."
    });
  }

  let draftValue: unknown;
  try {
    draftValue = JSON.parse(draftPayload) as unknown;
  } catch {
    return Object.freeze({
      status: "error" as const,
      message: "This draft could not be saved. Reload the current question and try again."
    });
  }

  try {
    const principal = await requirePlatformPermission({
      expectedRole: "worker",
      permission: "worker.assessments.read"
    });
    const service = await getAssessmentAttemptService();
    const accessContext = await readAssessmentAccessContext();

    try {
      const saved = await service.saveCurrentDraft(
        principal,
        {
          attemptId,
          position,
          value: draftValue,
          expectedRevision,
          mutationKey: clientGeneratedMutationKey
        },
        new Date(),
        accessContext
      );
      return Object.freeze({
        status: "saved" as const,
        revision: saved.revision,
        updatedAt: saved.updatedAt
      });
    } catch (error) {
      if (!(error instanceof AssessmentAttemptConflictError)) throw error;

      let serverDraft: AssessmentDraftConflictSnapshot | null = null;
      try {
        const current = await service.getOwnedView(principal, attemptId, new Date(), accessContext);
        if (
          current.currentQuestion !== null &&
          current.currentDraft !== null &&
          current.currentQuestion.position === position
        ) {
          serverDraft = Object.freeze({
            value: current.currentDraft.value,
            revision: current.currentDraft.revision,
            updatedAt: current.currentDraft.updatedAt
          });
        }
      } catch (readError) {
        if (
          !(readError instanceof AssessmentAttemptAccessError) &&
          !(readError instanceof AssessmentAttemptConflictError) &&
          !(readError instanceof AssessmentAttemptInputError)
        ) {
          throw readError;
        }
      }

      return Object.freeze({
        status: "conflict" as const,
        message: "This draft changed in another tab. Choose which version to keep.",
        serverDraft
      });
    }
  } catch (error) {
    if (
      error instanceof AssessmentAttemptDraftInputError ||
      error instanceof AssessmentAttemptInputError
    ) {
      return Object.freeze({
        status: "error" as const,
        message: "This draft could not be saved. Reload the current question and try again."
      });
    }
    if (error instanceof AssessmentAttemptAccessError) {
      return Object.freeze({
        status: "error" as const,
        message: "This assessment is no longer available in the current session."
      });
    }
    throw error;
  }
}

export async function submitAssessmentAnswerAction(
  _previousState: AssessmentAnswerActionState,
  formData: FormData
): Promise<AssessmentAnswerActionState> {
  const rawAttemptId = formData.get("attemptId");
  const rawPosition = formData.get("position");
  const rawAnswer = formData.get("answer");
  const attemptId = typeof rawAttemptId === "string" ? rawAttemptId.trim() : "";
  const position = positiveInteger(typeof rawPosition === "string" ? rawPosition : "");
  const encodedAnswer = typeof rawAnswer === "string" ? rawAnswer : "";

  if (!attemptId || position === null || !encodedAnswer) {
    return state("error", "This assessment question is stale. Reload it and try again.");
  }

  let answer: unknown;
  try {
    answer = JSON.parse(encodedAnswer) as unknown;
  } catch {
    return state("error", "Enter a valid answer before continuing.");
  }

  try {
    const principal = await requirePlatformPermission({
      expectedRole: "worker",
      permission: "worker.assessments.read"
    });
    const accessContext = await readAssessmentAccessContext();
    await (
      await getAssessmentAttemptService()
    ).submitCurrentAnswer(
      principal,
      { attemptId, position, answer },
      new Date(),
      accessContext
    );
  } catch (error) {
    if (error instanceof AssessmentAttemptConflictError) {
      return state(
        "conflict",
        "This assessment changed in another request. Reload the current question before continuing."
      );
    }
    if (
      error instanceof AssessmentAttemptAnswerInputError ||
      error instanceof AssessmentAttemptInputError
    ) {
      return state("error", "Enter a valid answer before continuing.");
    }
    if (error instanceof AssessmentAttemptAccessError) {
      return state("error", "This assessment is no longer available in the current session.");
    }
    throw error;
  }

  redirect(`/worker/assessments/${attemptId}`);
}

export async function interruptAssessmentAction(
  attemptIdInput: string,
  reasonInput: "emergency_exit" | "technical_issue" | "connection_lost" = "emergency_exit",
  detailInput = ""
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; message: string }>> {
  try {
    const principal = await requirePlatformPermission({
      expectedRole: "worker",
      permission: "worker.assessments.read"
    });
    const accessContext = await readAssessmentAccessContext();
    await (await getAssessmentAttemptService()).interrupt(
      principal,
      attemptIdInput,
      accessContext,
      {
        reason: reasonInput,
        detail: detailInput.trim().slice(0, 1000) || null
      }
    );
    return Object.freeze({ ok: true as const });
  } catch (error) {
    if (
      error instanceof AssessmentAttemptAccessError ||
      error instanceof AssessmentAttemptConflictError ||
      error instanceof AssessmentAttemptInputError
    ) {
      return Object.freeze({ ok: false as const, message: error.message });
    }
    throw error;
  }
}


export type AssessmentProgressionActionState = Readonly<{
  status: "idle" | "error";
  message: string;
}>;

export type AssessmentReviewActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
}>;

function progressionError(error: unknown): AssessmentProgressionActionState {
  if (
    error instanceof AssessmentAttemptAccessError ||
    error instanceof AssessmentAttemptConflictError ||
    error instanceof AssessmentAttemptInputError
  ) {
    return Object.freeze({ status: "error" as const, message: error.message });
  }
  throw error;
}

export async function advanceAssessmentSectionAction(
  _previousState: AssessmentProgressionActionState,
  formData: FormData
): Promise<AssessmentProgressionActionState> {
  const attemptId = String(formData.get("attemptId") ?? "").trim();
  try {
    const principal = await requirePlatformPermission({
      expectedRole: "worker",
      permission: "worker.assessments.read"
    });
    const accessContext = await readAssessmentAccessContext();
    await (await getAssessmentAttemptService()).advanceSection(
      principal,
      attemptId,
      accessContext
    );
  } catch (error) {
    return progressionError(error);
  }
  redirect(`/worker/assessments/${attemptId}`);
}

export async function finalizeAssessmentAction(
  _previousState: AssessmentProgressionActionState,
  formData: FormData
): Promise<AssessmentProgressionActionState> {
  const attemptId = String(formData.get("attemptId") ?? "").trim();
  try {
    const principal = await requirePlatformPermission({
      expectedRole: "worker",
      permission: "worker.assessments.read"
    });
    const accessContext = await readAssessmentAccessContext();
    await (await getAssessmentAttemptService()).finalizeAssessment(
      principal,
      attemptId,
      accessContext
    );
  } catch (error) {
    return progressionError(error);
  }
  redirect(`/worker/assessments/${attemptId}`);
}

export async function reviseAssessmentAnswerAction(
  _previousState: AssessmentReviewActionState,
  formData: FormData
): Promise<AssessmentReviewActionState> {
  const attemptId = String(formData.get("attemptId") ?? "").trim();
  const position = positiveInteger(String(formData.get("position") ?? ""));
  const encodedAnswer = String(formData.get("answer") ?? "");
  if (!attemptId || position === null || !encodedAnswer) {
    return Object.freeze({ status: "error" as const, message: "Review answer is stale. Reload and try again." });
  }
  let answer: unknown;
  try {
    answer = JSON.parse(encodedAnswer) as unknown;
  } catch {
    return Object.freeze({ status: "error" as const, message: "Enter a valid answer." });
  }
  try {
    const principal = await requirePlatformPermission({
      expectedRole: "worker",
      permission: "worker.assessments.read"
    });
    const accessContext = await readAssessmentAccessContext();
    await (await getAssessmentAttemptService()).reviseCommittedAnswer(
      principal,
      { attemptId, position, answer },
      accessContext
    );
    return Object.freeze({
      status: "success" as const,
      message: "Answer revision saved. The original committed answer remains in history."
    });
  } catch (error) {
    if (
      error instanceof AssessmentAttemptAnswerInputError ||
      error instanceof AssessmentAttemptAccessError ||
      error instanceof AssessmentAttemptConflictError ||
      error instanceof AssessmentAttemptInputError
    ) {
      return Object.freeze({ status: "error" as const, message: error.message });
    }
    throw error;
  }
}

export async function setAssessmentReviewFlagAction(formData: FormData): Promise<never> {
  const attemptId = String(formData.get("attemptId") ?? "").trim();
  const position = positiveInteger(String(formData.get("position") ?? ""));
  const flagged = String(formData.get("flagged") ?? "") === "yes";
  if (!attemptId || position === null) {
    redirect("/worker/available-assessments");
  }
  try {
    const principal = await requirePlatformPermission({
      expectedRole: "worker",
      permission: "worker.assessments.read"
    });
    const accessContext = await readAssessmentAccessContext();
    await (await getAssessmentAttemptService()).setReviewFlag(
      principal,
      { attemptId, position, flagged },
      accessContext
    );
  } catch (error) {
    if (
      error instanceof AssessmentAttemptAccessError ||
      error instanceof AssessmentAttemptConflictError ||
      error instanceof AssessmentAttemptInputError
    ) {
      redirect(
        `/worker/assessments/${attemptId}/review/${position}?error=${encodeURIComponent(error.message)}`
      );
    }
    throw error;
  }
  redirect(`/worker/assessments/${attemptId}/review/${position}`);
}

export async function startApprovedAssessmentBreakAction(input:unknown):Promise<Readonly<{ok:true}>|Readonly<{ok:false;message:string}>> {
 if(!input||typeof input!=="object"||Array.isArray(input))return Object.freeze({ok:false as const,message:"Approved break input is invalid."});
 const value=input as Record<string,unknown>;
 if(Object.keys(value).some(key=>!["attemptId","durationSeconds","mutationKey"].includes(key))||typeof value.attemptId!=="string"||typeof value.durationSeconds!=="number"||typeof value.mutationKey!=="string")return Object.freeze({ok:false as const,message:"Approved break input fields are invalid."});
 try {
  const principal=await requirePlatformPermission({expectedRole:"worker",permission:"worker.assessments.read"});
  const accessContext=await readAssessmentAccessContext();
  await (await getAssessmentAttemptService()).startApprovedBreak(principal,{attemptId:value.attemptId,durationSeconds:value.durationSeconds,mutationKey:value.mutationKey},accessContext);
  return Object.freeze({ok:true as const});
 }catch(error){
  if(error instanceof AssessmentAttemptAccessError||error instanceof AssessmentAttemptConflictError||error instanceof AssessmentAttemptInputError)return Object.freeze({ok:false as const,message:error.message});
  throw error;
 }
}
