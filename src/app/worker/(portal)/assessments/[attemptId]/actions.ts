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
  const rawQuestionVersionId = formData.get("questionVersionId");
  const rawDraftPayload = formData.get("draftPayload");
  const rawExpectedRevision = formData.get("expectedRevision");
  const rawClientGeneratedMutationKey = formData.get("clientGeneratedMutationKey");

  const attemptId = typeof rawAttemptId === "string" ? rawAttemptId.trim() : "";
  const position = positiveInteger(typeof rawPosition === "string" ? rawPosition : "");
  const questionVersionId =
    typeof rawQuestionVersionId === "string" ? rawQuestionVersionId.trim() : "";
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
    !questionVersionId ||
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

    try {
      const saved = await service.saveCurrentDraft(principal, {
        attemptId,
        position,
        questionVersionId,
        value: draftValue,
        expectedRevision,
        mutationKey: clientGeneratedMutationKey
      });
      return Object.freeze({
        status: "saved" as const,
        revision: saved.revision,
        updatedAt: saved.updatedAt
      });
    } catch (error) {
      if (!(error instanceof AssessmentAttemptConflictError)) throw error;

      let serverDraft: AssessmentDraftConflictSnapshot | null = null;
      try {
        const current = await service.getOwnedView(principal, attemptId);
        if (
          current.currentQuestion !== null &&
          current.currentDraft !== null &&
          current.currentQuestion.position === position &&
          current.currentQuestion.questionVersionId === questionVersionId
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
  const rawQuestionVersionId = formData.get("questionVersionId");
  const rawAnswer = formData.get("answer");
  const attemptId = typeof rawAttemptId === "string" ? rawAttemptId.trim() : "";
  const position = positiveInteger(typeof rawPosition === "string" ? rawPosition : "");
  const questionVersionId =
    typeof rawQuestionVersionId === "string" ? rawQuestionVersionId.trim() : "";
  const encodedAnswer = typeof rawAnswer === "string" ? rawAnswer : "";

  if (!attemptId || position === null || !questionVersionId || !encodedAnswer) {
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
    await (
      await getAssessmentAttemptService()
    ).submitCurrentAnswer(
      principal,
      { attemptId, position, questionVersionId, answer }
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
