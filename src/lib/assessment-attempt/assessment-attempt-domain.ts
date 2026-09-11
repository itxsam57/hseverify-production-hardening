import { createIdentifier } from "../auth/auth-domain";
import type {
  QuestionDifficulty,
  QuestionType
} from "../question-bank/question-bank-domain";

export const ASSESSMENT_ATTEMPT_STATUSES = Object.freeze([
  "IN_PROGRESS",
  "SUBMITTED"
] as const);
export type AssessmentAttemptStatus = (typeof ASSESSMENT_ATTEMPT_STATUSES)[number];

export type AssessmentAttemptRecord = Readonly<{
  attemptId: string;
  caseId: string;
  workerAccountId: string;
  catalogueVersionId: string;
  blueprintVersionId: string;
  formId: string;
  status: AssessmentAttemptStatus;
  currentPosition: number;
  questionCount: number;
  startedAt: string;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type AssessmentAttemptClientQuestion = Readonly<{
  attemptId: string;
  position: number;
  questionCount: number;
  questionId: string;
  questionVersionId: string;
  questionType: QuestionType;
  prompt: string;
  options: readonly string[] | null;
  domainReference: string;
  difficulty: QuestionDifficulty;
  tags: readonly string[];
}>;

export type AssessmentAttemptClientDraft = Readonly<{
  value: string | boolean | null;
  revision: number;
  updatedAt: string;
}>;

export type AssessmentAttemptClientView = Readonly<{
  currentQuestion: AssessmentAttemptClientQuestion | null;
  currentDraft: AssessmentAttemptClientDraft | null;
  submitted: boolean;
}>;

export type AssessmentAnswerInput = string | boolean | number;

export type NormalizedAssessmentAnswer = Readonly<{
  textValue: string | null;
  booleanValue: boolean | null;
  numericValue: number | null;
}>;

export class AssessmentAttemptInputError extends Error {
  constructor(message = "Assessment attempt input is invalid.") {
    super(message);
    this.name = "AssessmentAttemptInputError";
  }
}

export class AssessmentAttemptAnswerInputError extends Error {
  constructor(message = "The current answer is invalid.") {
    super(message);
    this.name = "AssessmentAttemptAnswerInputError";
  }
}

export class AssessmentAttemptAccessError extends Error {
  constructor(message = "The assessment attempt could not be accessed.") {
    super(message);
    this.name = "AssessmentAttemptAccessError";
  }
}

export class AssessmentAttemptConflictError extends Error {
  constructor(message = "The assessment attempt changed. Reload and try again.") {
    super(message);
    this.name = "AssessmentAttemptConflictError";
  }
}

export const createAssessmentAttemptId = (): string => createIdentifier("assessment_attempt");
export const createAssessmentAnswerId = (): string => createIdentifier("assessment_answer");

export function normalizeAssessmentAttemptReference(value: string): string {
  const normalized = value.trim();
  if (!/^assessment_attempt_[A-Za-z0-9_-]{24}$/.test(normalized)) {
    throw new AssessmentAttemptInputError("Assessment attempt reference is invalid.");
  }
  return normalized;
}

function normalizedText(value: unknown, maximumCodePoints: number): string {
  if (typeof value !== "string") throw new AssessmentAttemptAnswerInputError();
  const normalized = value.trim();
  const codePointLength = [...normalized].length;
  if (codePointLength < 1 || codePointLength > maximumCodePoints) {
    throw new AssessmentAttemptAnswerInputError();
  }
  return normalized;
}

export function normalizeAssessmentAnswer(
  questionType: QuestionType,
  rawValue: unknown,
  options: readonly string[] | null
): NormalizedAssessmentAnswer {
  if (questionType === "MULTIPLE_CHOICE") {
    if (typeof rawValue !== "string" || !Array.isArray(options)) {
      throw new AssessmentAttemptAnswerInputError();
    }
    const value = rawValue.trim();
    if (!value || !options.includes(value)) throw new AssessmentAttemptAnswerInputError();
    return Object.freeze({ textValue: value, booleanValue: null, numericValue: null });
  }

  if (questionType === "TRUE_FALSE") {
    if (typeof rawValue !== "boolean") throw new AssessmentAttemptAnswerInputError();
    return Object.freeze({ textValue: null, booleanValue: rawValue, numericValue: null });
  }

  if (questionType === "SHORT_TEXT") {
    return Object.freeze({
      textValue: normalizedText(rawValue, 2_000),
      booleanValue: null,
      numericValue: null
    });
  }

  if (questionType === "LONG_TEXT") {
    return Object.freeze({
      textValue: normalizedText(rawValue, 20_000),
      booleanValue: null,
      numericValue: null
    });
  }

  if (questionType === "INTEGER") {
    if (typeof rawValue !== "number" || !Number.isSafeInteger(rawValue)) {
      throw new AssessmentAttemptAnswerInputError();
    }
    return Object.freeze({ textValue: null, booleanValue: null, numericValue: rawValue });
  }

  if (questionType === "DECIMAL") {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new AssessmentAttemptAnswerInputError();
    }
    return Object.freeze({ textValue: null, booleanValue: null, numericValue: rawValue });
  }

  throw new AssessmentAttemptAnswerInputError();
}
