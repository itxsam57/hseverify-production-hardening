export type AssessmentEligibilityRequirements = Readonly<{
  qualificationCategories?: readonly string[];
  qualificationTitles?: readonly string[];
  experienceRoleTitles?: readonly string[];
  minimumExperienceMonths?: number;
  countriesOfResidence?: readonly string[];
  verifiedTrades?: readonly string[];
}>;

export type AssessmentEligibilityPolicy = Readonly<{
  assessmentWaitingPeriodDays?: number;
  assessmentAttemptLimit?: number;
  assessmentEligibility?: AssessmentEligibilityRequirements;
}>;

export class AssessmentEligibilityPolicyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssessmentEligibilityPolicyInputError";
  }
}

function normalizeRequirements(value: unknown): AssessmentEligibilityRequirements {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AssessmentEligibilityPolicyInputError("assessmentEligibility must be a configured requirements object.");
  }
  const input = value as Record<string, unknown>;
  const listFields = ["qualificationCategories", "qualificationTitles", "experienceRoleTitles", "countriesOfResidence", "verifiedTrades"] as const;
  const allowed = new Set<string>([...listFields, "minimumExperienceMonths"]);
  if (!Object.keys(input).length || Object.keys(input).some(key => !allowed.has(key))) {
    throw new AssessmentEligibilityPolicyInputError("assessmentEligibility has missing or unsupported requirement fields.");
  }
  const result: Record<string, readonly string[] | number> = {};
  for (const field of listFields) {
    const list = input[field];
    if (list === undefined) continue;
    if (!Array.isArray(list) || !list.length || list.length > 50 ||
        list.some(item => typeof item !== "string" || !item.trim() || item.trim().length > (field === "verifiedTrades" ? 160 : 240))) {
      throw new AssessmentEligibilityPolicyInputError(field + " must be a nonempty bounded list of evidence labels.");
    }
    const labels = (list as string[]).map(item => item.trim());
    if (new Set(labels.map(item => item.toLowerCase())).size !== labels.length) {
      throw new AssessmentEligibilityPolicyInputError(field + " must not contain duplicate evidence labels.");
    }
    result[field] = Object.freeze(labels);
  }
  const months = input.minimumExperienceMonths;
  if (months !== undefined) {
    if (typeof months !== "number" || !Number.isSafeInteger(months) || months < 0) {
      throw new AssessmentEligibilityPolicyInputError("minimumExperienceMonths must be a nonnegative safe integer calendar month count.");
    }
    result.minimumExperienceMonths = months;
  }
  return Object.freeze(result);
}

// Absent fields retain the published legacy policy; no eligibility rule is invented.
export function normalizeAssessmentEligibilityPolicyFields(
  policy: Readonly<Record<string, unknown>>
): AssessmentEligibilityPolicy {
  const waiting = policy.assessmentWaitingPeriodDays;
  const limit = policy.assessmentAttemptLimit;
  if (waiting !== undefined && (typeof waiting !== "number" ||
      !Number.isSafeInteger(waiting) || waiting < 0 ||
      !Number.isSafeInteger(waiting * 86_400_000))) {
    throw new AssessmentEligibilityPolicyInputError(
      "assessmentWaitingPeriodDays must be a nonnegative safe integer day count."
    );
  }
  if (limit !== undefined && (typeof limit !== "number" ||
      !Number.isSafeInteger(limit) || limit < 1)) {
    throw new AssessmentEligibilityPolicyInputError(
      "assessmentAttemptLimit must be a positive safe integer."
    );
  }
  return Object.freeze({
    ...(waiting === undefined ? {} : {assessmentWaitingPeriodDays: waiting as number}),
    ...(limit === undefined ? {} : {assessmentAttemptLimit: limit as number}),
    ...(policy.assessmentEligibility === undefined ? {} : {
      assessmentEligibility: normalizeRequirements(policy.assessmentEligibility)
    })
  });
}
