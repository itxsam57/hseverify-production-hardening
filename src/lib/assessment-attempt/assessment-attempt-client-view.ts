import type {
  AssessmentAttemptClientDraft,
  AssessmentCandidateQuestion,
  AssessmentAttemptClientQuestion,
  AssessmentAttemptClientView
} from "./assessment-attempt-domain";

type AssessmentAttemptClientSource = Readonly<{
  accommodationBreak?: import("./assessment-accommodation-break").AssessmentBreakView | null;
  timing?: import("./assessment-attempt-timing").AssessmentTimingView | null;
  attempt: Readonly<{ attemptId: string }>;
  currentQuestion: AssessmentAttemptClientQuestion | null;
  currentDraft: AssessmentAttemptClientDraft | null;
  submitted: boolean;
  progressionMode: "STRICT" | "CONTROLLED_REVIEW" | "SECTION_REVIEW";
  reviewablePositions: readonly number[];
  flaggedPositions: readonly number[];
  awaitingSectionAdvance: boolean;
  awaitingFinalSubmit: boolean;
  sectionTitle: string | null;
}>;

function projectDraft(
  draft: AssessmentAttemptClientDraft
): AssessmentAttemptClientDraft {
  return Object.freeze({
    value: draft.value,
    revision: draft.revision,
    updatedAt: draft.updatedAt
  });
}

function projectQuestion(
  question: AssessmentAttemptClientQuestion
): AssessmentCandidateQuestion {
  return Object.freeze({
    attemptId: question.attemptId,
    position: question.position,
    questionCount: question.questionCount,
    questionType: question.questionType,
    prompt: question.prompt,
    options: question.options === null ? null : Object.freeze([...question.options]),
    domainReference: question.domainReference
  });
}

export function toAssessmentAttemptClientView(
  view: AssessmentAttemptClientSource
): AssessmentAttemptClientView {
  return Object.freeze({
    ...(view.accommodationBreak ? {accommodationBreak:Object.freeze({...view.accommodationBreak})} : {}),
    ...(view.timing ? { timing: Object.freeze({
      mode: view.timing.mode, phaseIndex: view.timing.phaseIndex,
      deadlineAt: view.timing.deadlineAt, remainingSeconds: view.timing.remainingSeconds,
      expired: view.timing.expired
    }) } : {}),
    attemptId: view.attempt.attemptId,
    currentQuestion:
      view.currentQuestion === null ? null : projectQuestion(view.currentQuestion),
    currentDraft: view.currentDraft === null ? null : projectDraft(view.currentDraft),
    submitted: view.submitted,
    progressionMode: view.progressionMode,
    reviewablePositions: Object.freeze([...view.reviewablePositions]),
    flaggedPositions: Object.freeze([...view.flaggedPositions]),
    awaitingSectionAdvance: view.awaitingSectionAdvance,
    awaitingFinalSubmit: view.awaitingFinalSubmit,
    sectionTitle: view.sectionTitle
  });
}
