import "server-only";

import { createHash } from "node:crypto";
import { createIdentifier } from "../auth/auth-domain";
import { getDatabaseClient, type DatabaseClient } from "../database/database";

export type ScoringAssistanceStatus =
  | "GENERATED"
  | "ACCEPTED_AS_GUIDANCE"
  | "REJECTED"
  | "STALE";

export type ScoringAiProviderStatus = Readonly<{
  mode: "disabled" | "sandbox";
  available: boolean;
  provider: "none" | "sandbox";
  reason: string;
}>;

export type WrittenScoringSuggestion = Readonly<{
  testingOnly: boolean;
  overallScoreSuggestion: number;
  criteria: readonly Readonly<{
    questionPosition: number;
    criterion: string;
    suggestedPercent: number;
    rationale: string;
  }>[];
  reviewNotes: readonly string[];
}>;

export type StoredScoringAssistance = Readonly<{
  assistanceId: string;
  reviewId: string;
  attemptId: string;
  providerKey: string;
  modelReference: string;
  inputSha256: string;
  suggestion: WrittenScoringSuggestion;
  status: ScoringAssistanceStatus;
  reviewerAccountId: string | null;
  reviewerReason: string | null;
  generatedAt: string;
  reviewedAt: string | null;
}>;

type SourceRow = {
  position: number | string;
  prompt: string;
  rubric_json: unknown;
  text_value: string;
};

type AssistanceRow = {
  assistance_id: string;
  review_id: string;
  attempt_id: string;
  provider_key: string;
  model_reference: string;
  input_sha256: string;
  suggestion_json: unknown;
  status: ScoringAssistanceStatus;
  reviewer_account_id: string | null;
  reviewer_reason: string | null;
  generated_at: string | Date;
  reviewed_at: string | Date | null;
};

export class WrittenScoringAssistanceUnavailableError extends Error {
  constructor(message = "AI scoring assistance is not configured for this environment.") {
    super(message);
    this.name = "WrittenScoringAssistanceUnavailableError";
  }
}
export class WrittenScoringAssistanceAccessError extends Error {
  constructor(message = "Scoring assistance is unavailable for this reviewer.") {
    super(message);
    this.name = "WrittenScoringAssistanceAccessError";
  }
}
export class WrittenScoringAssistanceConflictError extends Error {
  constructor(message = "Scoring assistance state changed. Reload and try again.") {
    super(message);
    this.name = "WrittenScoringAssistanceConflictError";
  }
}

function iso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function parsedObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}
function toStored(row: AssistanceRow): StoredScoringAssistance {
  return Object.freeze({
    assistanceId: row.assistance_id,
    reviewId: row.review_id,
    attemptId: row.attempt_id,
    providerKey: row.provider_key,
    modelReference: row.model_reference,
    inputSha256: row.input_sha256,
    suggestion: Object.freeze(parsedObject(row.suggestion_json)) as WrittenScoringSuggestion,
    status: row.status,
    reviewerAccountId: row.reviewer_account_id,
    reviewerReason: row.reviewer_reason,
    generatedAt: iso(row.generated_at) as string,
    reviewedAt: iso(row.reviewed_at)
  });
}

export function getScoringAiProviderStatus(): ScoringAiProviderStatus {
  const mode = process.env.HSE_SCORING_AI_MODE?.trim().toLowerCase();
  if (mode === "sandbox") {
    return Object.freeze({
      mode: "sandbox",
      available: true,
      provider: "sandbox",
      reason: "Sandbox guidance is enabled for testing only. It is not a production AI provider."
    });
  }
  return Object.freeze({
    mode: "disabled",
    available: false,
    provider: "none",
    reason: "No production AI scoring provider is configured. Human scoring remains fully available."
  });
}

function rubricCriteria(value: unknown): Array<{ description: string; points: number }> {
  const rubric = parsedObject(value);
  if (!Array.isArray(rubric.criteria)) return [];
  return rubric.criteria.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as { description?: unknown; points?: unknown };
    const description = typeof row.description === "string" ? row.description.trim() : "";
    const points = Number(row.points);
    if (!description || !Number.isFinite(points) || points <= 0) return [];
    return [{ description, points }];
  });
}

function sandboxSuggestion(rows: readonly SourceRow[]): WrittenScoringSuggestion {
  const criteria: Array<{
    questionPosition: number;
    criterion: string;
    suggestedPercent: number;
    rationale: string;
  }> = [];
  let totalWords = 0;
  let totalCriteria = 0;

  for (const row of rows) {
    const wordCount = row.text_value.trim().split(/\s+/).filter(Boolean).length;
    totalWords += wordCount;
    const rubric = rubricCriteria(row.rubric_json);
    totalCriteria += rubric.length;
    const completeness = Math.max(35, Math.min(90, 45 + Math.floor(wordCount / 8)));
    for (const item of rubric) {
      criteria.push({
        questionPosition: Number(row.position),
        criterion: item.description,
        suggestedPercent: completeness,
        rationale:
          "Sandbox-only heuristic based on response completeness. A human reviewer must evaluate technical correctness against the rubric."
      });
    }
  }

  const overall = rows.length === 0
    ? 0
    : Math.max(35, Math.min(90, 45 + Math.floor(totalWords / Math.max(8, rows.length * 8))));
  return Object.freeze({
    testingOnly: true,
    overallScoreSuggestion: overall,
    criteria: Object.freeze(criteria.map((item) => Object.freeze(item))),
    reviewNotes: Object.freeze([
      "Sandbox guidance only — not a production AI assessment.",
      "Human reviewer remains the sole scoring authority.",
      totalCriteria > 0
        ? "Compare each response against the exact versioned rubric before saving a score."
        : "No structured rubric criteria were available in the sandbox source."
    ])
  });
}

async function reviewForUpdate(
  database: DatabaseClient,
  reviewId: string,
  reviewerAccountId: string
): Promise<{ review_id: string; attempt_id: string; status: string }> {
  const result = await database.query<{ review_id: string; attempt_id: string; status: string }>(
    `SELECT review_id,attempt_id,status
       FROM written_score_reviews
      WHERE review_id=$1 AND reviewer_account_id=$2
      FOR UPDATE`,
    [reviewId, reviewerAccountId]
  );
  const review = result.rows[0];
  if (!review) throw new WrittenScoringAssistanceAccessError();
  if (review.status !== "DRAFT") {
    throw new WrittenScoringAssistanceConflictError(
      "AI guidance can be generated only while the written review is still a draft."
    );
  }
  return review;
}

async function sourceForAttempt(database: DatabaseClient, attemptId: string): Promise<SourceRow[]> {
  const result = await database.query<SourceRow>(
    `SELECT answers.position,versions.prompt,versions.rubric_json,answers.text_value
       FROM assessment_attempt_answers answers
       JOIN assessment_question_versions versions
         ON versions.question_version_id=answers.question_version_id
        AND versions.question_id=answers.question_id
      WHERE answers.attempt_id=$1
        AND answers.question_type IN ('SHORT_TEXT','LONG_TEXT')
      ORDER BY answers.position`,
    [attemptId]
  );
  return result.rows;
}

async function nextEventVersion(database: DatabaseClient, assistanceId: string): Promise<number> {
  const result = await database.query<{ next_version: number | string }>(
    `SELECT COALESCE(MAX(event_version),0)+1 AS next_version
       FROM written_scoring_assistance_events
      WHERE assistance_id=$1`,
    [assistanceId]
  );
  return Number(result.rows[0]?.next_version ?? 1);
}

export class WrittenScoringAssistanceService {
  constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async generate(input: {
    reviewId: string;
    reviewerAccountId: string;
    now?: Date;
  }): Promise<StoredScoringAssistance> {
    const provider = getScoringAiProviderStatus();
    if (!provider.available || provider.mode !== "sandbox") {
      throw new WrittenScoringAssistanceUnavailableError(provider.reason);
    }
    const now = input.now ?? new Date();
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const review = await reviewForUpdate(tx, input.reviewId, input.reviewerAccountId);
      const source = await sourceForAttempt(tx, review.attempt_id);
      if (source.length === 0) {
        throw new WrittenScoringAssistanceConflictError(
          "No submitted written answers are available for AI guidance."
        );
      }
      const inputSha256 = createHash("sha256")
        .update(JSON.stringify(source))
        .digest("hex");

      const current = await tx.query<AssistanceRow>(
        `SELECT *
           FROM written_scoring_assistance
          WHERE review_id=$1 AND input_sha256=$2 AND status='GENERATED'
          ORDER BY generated_at DESC
          LIMIT 1`,
        [review.review_id, inputSha256]
      );
      if (current.rows[0]) return toStored(current.rows[0]);

      const stale = await tx.query<{ assistance_id: string }>(
        `UPDATE written_scoring_assistance
            SET status='STALE',reviewer_account_id=$2,
                reviewer_reason='Source changed before guidance was reviewed.',
                reviewed_at=$3
          WHERE review_id=$1 AND status='GENERATED'
          RETURNING assistance_id`,
        [review.review_id, input.reviewerAccountId, now.toISOString()]
      );
      for (const row of stale.rows) {
        const version = await nextEventVersion(tx, row.assistance_id);
        await tx.query(
          `INSERT INTO written_scoring_assistance_events(
             assistance_id,event_version,event_type,actor_account_id,reason,occurred_at
           ) VALUES($1,$2,'STALE',$3,$4,$5)`,
          [
            row.assistance_id,
            version,
            input.reviewerAccountId,
            "Source changed before guidance was reviewed.",
            now.toISOString()
          ]
        );
      }

      const assistanceId = createIdentifier("scoring_assist");
      const suggestion = sandboxSuggestion(source);
      const inserted = await tx.query<AssistanceRow>(
        `INSERT INTO written_scoring_assistance(
           assistance_id,review_id,attempt_id,provider_key,model_reference,input_sha256,
           suggestion_json,status,generated_at
         ) VALUES($1,$2,$3,'sandbox','sandbox-written-guidance-v1',$4,$5::jsonb,'GENERATED',$6)
         RETURNING *`,
        [
          assistanceId,
          review.review_id,
          review.attempt_id,
          inputSha256,
          JSON.stringify(suggestion),
          now.toISOString()
        ]
      );
      await tx.query(
        `INSERT INTO written_scoring_assistance_events(
           assistance_id,event_version,event_type,actor_account_id,reason,occurred_at
         ) VALUES($1,1,'GENERATED',$2,NULL,$3)`,
        [assistanceId, input.reviewerAccountId, now.toISOString()]
      );
      return toStored(inserted.rows[0]);
    });
  }

  async reviewGuidance(input: {
    assistanceId: string;
    reviewerAccountId: string;
    decision: "ACCEPTED_AS_GUIDANCE" | "REJECTED";
    reason: string;
    now?: Date;
  }): Promise<StoredScoringAssistance> {
    const reason = input.reason.trim();
    if (reason.length < 5 || reason.length > 2000) {
      throw new WrittenScoringAssistanceConflictError(
        "AI guidance review reason must be between 5 and 2000 characters."
      );
    }
    const now = input.now ?? new Date();
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const found = await tx.query<AssistanceRow & { owner_reviewer: string; review_status: string }>(
        `SELECT assistance.*,reviews.reviewer_account_id AS owner_reviewer,
                reviews.status AS review_status
           FROM written_scoring_assistance assistance
           JOIN written_score_reviews reviews ON reviews.review_id=assistance.review_id
          WHERE assistance.assistance_id=$1
          FOR UPDATE OF assistance,reviews`,
        [input.assistanceId]
      );
      const row = found.rows[0];
      if (!row || row.owner_reviewer !== input.reviewerAccountId) {
        throw new WrittenScoringAssistanceAccessError();
      }
      if (row.review_status !== "DRAFT" || row.status !== "GENERATED") {
        throw new WrittenScoringAssistanceConflictError();
      }
      const updated = await tx.query<AssistanceRow>(
        `UPDATE written_scoring_assistance
            SET status=$2,reviewer_account_id=$3,reviewer_reason=$4,reviewed_at=$5
          WHERE assistance_id=$1 AND status='GENERATED'
          RETURNING *`,
        [
          input.assistanceId,
          input.decision,
          input.reviewerAccountId,
          reason,
          now.toISOString()
        ]
      );
      if (!updated.rows[0]) throw new WrittenScoringAssistanceConflictError();
      const version = await nextEventVersion(tx, input.assistanceId);
      await tx.query(
        `INSERT INTO written_scoring_assistance_events(
           assistance_id,event_version,event_type,actor_account_id,reason,occurred_at
         ) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          input.assistanceId,
          version,
          input.decision,
          input.reviewerAccountId,
          reason,
          now.toISOString()
        ]
      );
      return toStored(updated.rows[0]);
    });
  }

  async listForReviewer(reviewerAccountId: string): Promise<readonly StoredScoringAssistance[]> {
    const database = await this.databasePromise;
    const result = await database.query<AssistanceRow>(
      `SELECT assistance.*
         FROM written_scoring_assistance assistance
         JOIN written_score_reviews reviews ON reviews.review_id=assistance.review_id
        WHERE reviews.reviewer_account_id=$1
        ORDER BY assistance.generated_at DESC`,
      [reviewerAccountId]
    );
    return Object.freeze(result.rows.map(toStored));
  }
}
