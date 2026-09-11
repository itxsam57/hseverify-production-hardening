import type { QuestionType } from "../question-bank/question-bank-domain";

export type AssessmentDraftValue = string | boolean | null;

export type NormalizedAssessmentDraft = Readonly<{
  textValue: string | null;
  booleanValue: boolean | null;
}>;

export class AssessmentAttemptDraftInputError extends Error {
  constructor(message = "The current draft is invalid.") {
    super(message);
    this.name = "AssessmentAttemptDraftInputError";
  }
}

function codePointLength(value: string): number {
  return [...value].length;
}

function requireStringWithin(value: unknown, maximumCodePoints: number): string {
  if (typeof value !== "string" || codePointLength(value) > maximumCodePoints) {
    throw new AssessmentAttemptDraftInputError();
  }
  return value;
}

export function normalizeAssessmentDraft(
  questionType: QuestionType,
  rawValue: unknown,
  options: readonly string[] | null
): NormalizedAssessmentDraft {
  if (questionType === "MULTIPLE_CHOICE") {
    if (!Array.isArray(options) || options.some((option) => typeof option !== "string")) {
      throw new AssessmentAttemptDraftInputError();
    }
    if (rawValue === null) {
      return Object.freeze({ textValue: null, booleanValue: null });
    }
    if (typeof rawValue !== "string" || !options.includes(rawValue)) {
      throw new AssessmentAttemptDraftInputError();
    }
    return Object.freeze({ textValue: rawValue, booleanValue: null });
  }

  if (questionType === "TRUE_FALSE") {
    if (rawValue === null) {
      return Object.freeze({ textValue: null, booleanValue: null });
    }
    if (typeof rawValue !== "boolean") {
      throw new AssessmentAttemptDraftInputError();
    }
    return Object.freeze({ textValue: null, booleanValue: rawValue });
  }

  if (questionType === "SHORT_TEXT") {
    return Object.freeze({
      textValue: requireStringWithin(rawValue, 2_000),
      booleanValue: null
    });
  }

  if (questionType === "LONG_TEXT") {
    return Object.freeze({
      textValue: requireStringWithin(rawValue, 20_000),
      booleanValue: null
    });
  }

  if (questionType === "INTEGER" || questionType === "DECIMAL") {
    return Object.freeze({
      textValue: requireStringWithin(rawValue, 128),
      booleanValue: null
    });
  }

  throw new AssessmentAttemptDraftInputError();
}
