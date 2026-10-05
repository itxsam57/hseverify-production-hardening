import "server-only";

import { createIdentifier } from "../auth/auth-domain";
import {
  advanceAfterObjectiveAssessment,
  queueAssessmentReviewCase
} from "../assurance/assurance-case-progression-service";
import type { DatabaseClient } from "../database/database";

type ObjectiveAnswerRow = {
  position: number | string;
  question_type:
    | "MULTIPLE_CHOICE"
    | "TRUE_FALSE"
    | "SHORT_TEXT"
    | "LONG_TEXT"
    | "INTEGER"
    | "DECIMAL";
  answer_key_json: unknown;
  text_value: string | null;
  boolean_value: boolean | null;
  numeric_value: number | string | null;
};

type ProgressionActor = Readonly<{
  accountId: string;
  role: string;
}>;

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function reviewOrchestrationAvailable(
  database: DatabaseClient
): Promise<boolean> {
  const result = await database.query<{ column_name: string; is_nullable: string }>(
    `SELECT column_name,is_nullable
       FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name='written_score_reviews'
        AND column_name IN ('score','decision')`
  );
  return (
    result.rows.length === 2 &&
    result.rows.every((row) => row.is_nullable === "YES")
  );
}

async function activeVerifier(
  database: DatabaseClient
): Promise<string | null> {
  const result = await database.query<{ account_id: string }>(
    `SELECT accounts.account_id
       FROM auth_accounts AS accounts
       JOIN auth_account_roles AS roles
         ON roles.account_id=accounts.account_id
        AND roles.role='verifier'
       LEFT JOIN written_score_reviews AS reviews
         ON reviews.reviewer_account_id=accounts.account_id
        AND reviews.status='DRAFT'
      WHERE accounts.account_status='active'
      GROUP BY accounts.account_id
      ORDER BY COUNT(reviews.review_id) ASC,accounts.account_id ASC
      LIMIT 1`
  );
  return result.rows[0]?.account_id ?? null;
}

function objectiveAnswerCorrect(row: ObjectiveAnswerRow): boolean {
  const key = row.answer_key_json;
  switch (row.question_type) {
    case "MULTIPLE_CHOICE":
      return typeof key === "string" && row.text_value === key;
    case "TRUE_FALSE":
      return typeof key === "boolean" && row.boolean_value === key;
    case "INTEGER":
    case "DECIMAL":
      return (
        typeof key === "number" &&
        row.numeric_value !== null &&
        Number(row.numeric_value) === key
      );
    default:
      return false;
  }
}

async function pinnedFormAnswerRows(
  database: DatabaseClient,
  attemptId: string
): Promise<readonly ObjectiveAnswerRow[]> {
  const result = await database.query<ObjectiveAnswerRow>(
    `SELECT items.position,versions.question_type,versions.answer_key_json,
            COALESCE(latest.text_value,answers.text_value) AS text_value,
            COALESCE(latest.boolean_value,answers.boolean_value) AS boolean_value,
            COALESCE(latest.numeric_value,answers.numeric_value) AS numeric_value
       FROM assessment_attempts AS attempts
       JOIN generated_assessment_form_items AS items
         ON items.form_id=attempts.form_id
       JOIN assessment_question_versions AS versions
         ON versions.question_id=items.question_id
        AND versions.question_version_id=items.question_version_id
       LEFT JOIN assessment_attempt_answers AS answers
         ON answers.attempt_id=attempts.attempt_id
        AND answers.position=items.position
        AND answers.question_version_id=items.question_version_id
       LEFT JOIN LATERAL (
         SELECT revisions.text_value,revisions.boolean_value,revisions.numeric_value
           FROM assessment_answer_revisions AS revisions
          WHERE revisions.attempt_id=answers.attempt_id
            AND revisions.answer_id=answers.answer_id
            AND revisions.position=answers.position
          ORDER BY revisions.revision_no DESC
          LIMIT 1
       ) AS latest ON TRUE
      WHERE attempts.attempt_id=$1
      ORDER BY items.position`,
    [attemptId]
  );
  return result.rows;
}

async function effectivePassMark(
  database: DatabaseClient,
  caseId: string
): Promise<number | null> {
  const result = await database.query<{ effective_value_json: unknown }>(
    `SELECT effective_value_json
       FROM assurance_case_policy_snapshots
      WHERE case_id=$1
      LIMIT 1`,
    [caseId]
  );
  const passMark = jsonObject(result.rows[0]?.effective_value_json).pass_mark;
  return (
    typeof passMark === "number" &&
    Number.isInteger(passMark) &&
    passMark >= 0 &&
    passMark <= 100
  )
    ? passMark
    : null;
}

async function caseTenant(
  database: DatabaseClient,
  caseId: string
): Promise<string> {
  const result = await database.query<{ tenant_id: string; case_status: string }>(
    `SELECT tenant_id,case_status
       FROM assurance_cases
      WHERE case_id=$1
      FOR UPDATE`,
    [caseId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Assurance Case was not found for assessment progression.");
  }
  if (row.case_status !== "Assessment in progress") {
    throw new Error("Assessment submission no longer matches the Assurance Case state.");
  }
  return row.tenant_id;
}

async function queueHumanReview(
  database: DatabaseClient,
  input: Readonly<{
    caseId: string;
    attemptId: string;
    blueprintVersionId: string;
    actor: ProgressionActor;
    now: Date;
  }>
): Promise<void> {
  const tenantId = await caseTenant(database, input.caseId);
  const reviewerAccountId = await activeVerifier(database);
  if (reviewerAccountId) {
    await database.query(
      `INSERT INTO written_score_reviews(
         review_id,tenant_id,case_id,attempt_id,reviewer_account_id,
         rubric_version,score,decision,reason,status,created_at
       ) VALUES($1,$2,$3,$4,$5,$6,NULL,NULL,$7,'DRAFT',$8)
       ON CONFLICT DO NOTHING`,
      [
        createIdentifier("written_score"),
        tenantId,
        input.caseId,
        input.attemptId,
        reviewerAccountId,
        input.blueprintVersionId,
        "Assessment submission is awaiting verifier scoring.",
        input.now.toISOString()
      ]
    );
  }
  await queueAssessmentReviewCase(database, {
    caseId: input.caseId,
    reviewerAccountId,
    actor: input.actor,
    now: input.now
  });
}

export async function completeSubmittedAssessment(
  database: DatabaseClient,
  input: Readonly<{
    caseId: string;
    attemptId: string;
    blueprintVersionId: string;
    actor: ProgressionActor;
    now: Date;
  }>
): Promise<void> {
  if (!(await reviewOrchestrationAvailable(database))) return;

  await caseTenant(database, input.caseId);
  const rows = await pinnedFormAnswerRows(database, input.attemptId);
  if (rows.length === 0) {
    throw new Error("Submitted assessment has no pinned form items.");
  }

  const hasWritten = rows.some(
    (item) =>
      item.question_type === "SHORT_TEXT" ||
      item.question_type === "LONG_TEXT"
  );
  const passMark = await effectivePassMark(database, input.caseId);

  if (hasWritten || passMark === null) {
    await queueHumanReview(database, input);
    return;
  }

  const tenantId = await caseTenant(database, input.caseId);
  const correct = rows.filter(objectiveAnswerCorrect).length;
  const score = Math.round((correct / rows.length) * 100);
  const decision = score >= passMark ? "PASS" : "FAIL";

  await database.query(
    `INSERT INTO written_score_reviews(
       review_id,tenant_id,case_id,attempt_id,reviewer_account_id,
       rubric_version,score,decision,reason,status,created_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'FINAL',$10)
     ON CONFLICT DO NOTHING`,
    [
      createIdentifier("written_score"),
      tenantId,
      input.caseId,
      input.attemptId,
      "system:auto-score",
      `objective:${input.blueprintVersionId}`,
      score,
      decision,
      `Objective assessment auto-scored against pinned answer keys and pass mark ${passMark}.`,
      input.now.toISOString()
    ]
  );

  await advanceAfterObjectiveAssessment(database, {
    caseId: input.caseId,
    decision,
    actor: input.actor,
    now: input.now
  });
}
