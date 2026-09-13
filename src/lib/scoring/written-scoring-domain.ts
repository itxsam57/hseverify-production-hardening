export const WRITTEN_SCORE_DECISIONS = ["PASS","FAIL","CHANGES_REQUESTED"] as const;
export type WrittenScoreDecision = (typeof WRITTEN_SCORE_DECISIONS)[number];
export const WRITTEN_SCORE_STATUSES = ["DRAFT","FINAL","SUPERSEDED"] as const;
export class WrittenScoreInputError extends Error {}
export function normalizeWrittenScore(score: unknown): number {
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 100) throw new WrittenScoreInputError("Score must be between 0 and 100.");
  return score;
}
export function normalizeWrittenScoreDecision(value: unknown): WrittenScoreDecision {
  if (typeof value !== "string" || !WRITTEN_SCORE_DECISIONS.includes(value as WrittenScoreDecision)) throw new WrittenScoreInputError("Unknown scoring decision.");
  return value as WrittenScoreDecision;
}

export function requireScoringCriterion(input: unknown): {criterion: string; mark: number} {
  if (!input || typeof input !== "object") throw new WrittenScoreInputError("Criterion is required.");
  const value = input as {criterion?: unknown; mark?: unknown};
  if (typeof value.criterion !== "string" || value.criterion.trim().length < 2) throw new WrittenScoreInputError("Invalid criterion.");
  if (typeof value.mark !== "number" || !Number.isInteger(value.mark) || value.mark < 0 || value.mark > 100) throw new WrittenScoreInputError("Invalid criterion mark.");
  return { criterion: value.criterion.trim(), mark: value.mark };
}
