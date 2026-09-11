import { createIdentifier } from "../auth/auth-domain";
import {
  QUESTION_DIFFICULTIES,
  QUESTION_TYPES,
  type QuestionDifficulty,
  type QuestionType
} from "../question-bank/question-bank-domain";

export const BLUEPRINT_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type BlueprintStatus = (typeof BLUEPRINT_STATUSES)[number];

export type BlueprintSelector = Readonly<{
  count: number;
  questionType?: QuestionType;
  domainReference?: string;
  difficulty?: QuestionDifficulty;
  tagsAll: readonly string[];
}>;

export type BlueprintVersionInput = Readonly<{
  title: string;
  frameworkReference: string;
  selectors: readonly unknown[];
}>;

export type NormalizedBlueprintVersion = Readonly<{
  title: string;
  frameworkReference: string;
  selectors: readonly BlueprintSelector[];
  totalCount: number;
}>;

export class AssessmentBlueprintInputError extends Error {
  constructor(message = "Assessment blueprint input is invalid.") {
    super(message);
    this.name = "AssessmentBlueprintInputError";
  }
}

export class AssessmentBlueprintAccessError extends Error {
  constructor(message = "The assessment blueprint could not be accessed.") {
    super(message);
    this.name = "AssessmentBlueprintAccessError";
  }
}

export class AssessmentBlueprintConflictError extends Error {
  constructor(message = "Assessment blueprint state changed or conflicts with another blueprint.") {
    super(message);
    this.name = "AssessmentBlueprintConflictError";
  }
}

export const createBlueprintId = (): string => createIdentifier("assessment_blueprint");
export const createBlueprintVersionId = (): string => createIdentifier("blueprint_version");
export const createAssessmentFormId = (): string => createIdentifier("assessment_form");
export const createAssessmentFormItemId = (): string => createIdentifier("assessment_form_item");

export function normalizeBlueprintReference(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (
    normalized.length < 2 ||
    normalized.length > 120 ||
    !/^[A-Z0-9][A-Z0-9._:/-]*$/.test(normalized)
  ) {
    throw new AssessmentBlueprintInputError("Blueprint reference is invalid.");
  }
  return normalized;
}

function normalizeTitle(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 200) {
    throw new AssessmentBlueprintInputError("Blueprint title is invalid.");
  }
  return normalized;
}

function normalizeFrameworkReference(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (
    normalized.length < 2 ||
    normalized.length > 120 ||
    !/^[A-Z0-9][A-Z0-9._:/-]*$/.test(normalized)
  ) {
    throw new AssessmentBlueprintInputError("Blueprint framework reference is invalid.");
  }
  return normalized;
}

function normalizeOptionalDomain(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new AssessmentBlueprintInputError("Blueprint selector domainReference is invalid.");
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 160) {
    throw new AssessmentBlueprintInputError("Blueprint selector domainReference is invalid.");
  }
  return normalized;
}

function normalizeSelectorTags(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    throw new AssessmentBlueprintInputError("Blueprint selector tagsAll is invalid.");
  }
  const normalizedTags = value.map((tag) => tag.trim().toLowerCase());
  if (
    normalizedTags.some(
      (tag) =>
        tag.length < 1 ||
        tag.length > 60 ||
        !/^[a-z0-9][a-z0-9 _./:-]*$/.test(tag)
    ) ||
    new Set(normalizedTags).size !== normalizedTags.length ||
    normalizedTags.length > 24
  ) {
    throw new AssessmentBlueprintInputError(
      "Blueprint selector tagsAll must contain unique valid tags."
    );
  }
  return Object.freeze([...normalizedTags].sort());
}

function normalizeSelector(value: unknown, index: number): BlueprintSelector {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AssessmentBlueprintInputError(`Blueprint selector ${index + 1} is invalid.`);
  }
  const raw = value as Record<string, unknown>;
  const allowed = new Set([
    "count",
    "questionType",
    "domainReference",
    "difficulty",
    "tagsAll"
  ]);
  const unknown = Object.keys(raw).find((key) => !allowed.has(key));
  if (unknown) {
    throw new AssessmentBlueprintInputError(`Unknown blueprint selector field: ${unknown}.`);
  }

  const count = typeof raw.count === "number" ? raw.count : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    throw new AssessmentBlueprintInputError(
      `Blueprint selector ${index + 1} count must be an integer from 1 to 100.`
    );
  }

  let questionType: QuestionType | undefined;
  if (raw.questionType !== undefined) {
    if (
      typeof raw.questionType !== "string" ||
      !QUESTION_TYPES.includes(raw.questionType as QuestionType)
    ) {
      throw new AssessmentBlueprintInputError(
        `Blueprint selector ${index + 1} questionType is invalid.`
      );
    }
    questionType = raw.questionType as QuestionType;
  }

  let difficulty: QuestionDifficulty | undefined;
  if (raw.difficulty !== undefined) {
    if (
      typeof raw.difficulty !== "string" ||
      !QUESTION_DIFFICULTIES.includes(raw.difficulty as QuestionDifficulty)
    ) {
      throw new AssessmentBlueprintInputError(
        `Blueprint selector ${index + 1} difficulty is invalid.`
      );
    }
    difficulty = raw.difficulty as QuestionDifficulty;
  }

  const domainReference = normalizeOptionalDomain(raw.domainReference);
  const tagsAll = normalizeSelectorTags(raw.tagsAll);
  return Object.freeze({
    count,
    ...(questionType ? { questionType } : {}),
    ...(domainReference ? { domainReference } : {}),
    ...(difficulty ? { difficulty } : {}),
    tagsAll
  });
}

export function normalizeBlueprintVersion(
  input: BlueprintVersionInput
): NormalizedBlueprintVersion {
  if (!Array.isArray(input.selectors) || input.selectors.length < 1 || input.selectors.length > 500) {
    throw new AssessmentBlueprintInputError("Blueprint requires 1 to 500 selectors.");
  }
  const selectors = input.selectors.map(normalizeSelector);
  const totalCount = selectors.reduce((sum, selector) => sum + selector.count, 0);
  if (totalCount > 500) {
    throw new AssessmentBlueprintInputError("Blueprint total question count cannot exceed 500.");
  }
  return Object.freeze({
    title: normalizeTitle(input.title),
    frameworkReference: normalizeFrameworkReference(input.frameworkReference),
    selectors: Object.freeze(selectors),
    totalCount
  });
}
