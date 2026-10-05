import "server-only";
import type { DatabaseClient } from "../database/database";

export type AssessmentReviewQuestion = Readonly<{
  position: number;
  questionType: string;
  prompt: string;
  answered: boolean;
  response: string | null;
  expectedAnswer: string | number | boolean | null;
  rubric: unknown;
  rubricCriteria: readonly Readonly<{description: string; points: number}>[];
}>;

type QuestionRow = {
  review_id: string; position: number | string; question_type: string; prompt: string;
  answered: boolean; text_value: string | null; boolean_value: boolean | null;
  numeric_value: string | number | null; answer_key_json: unknown; rubric_json: unknown;
};

export async function loadAssignedReviewQuestions(
  database: DatabaseClient, reviewerAccountId: string, reviewIds: readonly string[]
): Promise<Map<string, readonly AssessmentReviewQuestion[]>> {
  if (!reviewerAccountId.trim()) throw new Error("Assigned reviewer scope is required.");
  const grouped = new Map<string, AssessmentReviewQuestion[]>();
  if (reviewIds.length === 0) return grouped;
  const result = await database.query<QuestionRow>(
    `SELECT reviews.review_id,items.position,versions.question_type,versions.prompt,
            versions.answer_key_json,versions.rubric_json,
            answers.answer_id IS NOT NULL AS answered,
            CASE WHEN latest.revision_no IS NOT NULL THEN latest.text_value ELSE answers.text_value END AS text_value,
            CASE WHEN latest.revision_no IS NOT NULL THEN latest.boolean_value ELSE answers.boolean_value END AS boolean_value,
            CASE WHEN latest.revision_no IS NOT NULL THEN latest.numeric_value ELSE answers.numeric_value END AS numeric_value
       FROM written_score_reviews reviews
       JOIN assessment_attempts attempts ON attempts.attempt_id=reviews.attempt_id AND attempts.case_id=reviews.case_id
       JOIN assurance_cases cases ON cases.case_id=attempts.case_id AND cases.tenant_id=reviews.tenant_id
       JOIN generated_assessment_form_items items ON items.form_id=attempts.form_id
       JOIN assessment_question_versions versions ON versions.question_id=items.question_id AND versions.question_version_id=items.question_version_id
       LEFT JOIN assessment_attempt_answers answers ON answers.attempt_id=attempts.attempt_id AND answers.position=items.position AND answers.question_version_id=items.question_version_id
       LEFT JOIN LATERAL (
         SELECT revision_no,text_value,boolean_value,numeric_value FROM assessment_answer_revisions
          WHERE attempt_id=answers.attempt_id AND answer_id=answers.answer_id AND position=answers.position
          ORDER BY revision_no DESC LIMIT 1
       ) latest ON TRUE
      WHERE reviews.reviewer_account_id=$1 AND reviews.review_id=ANY($2::text[])
        AND attempts.status IN ('SUBMITTED','AUTO_SUBMITTED')
      ORDER BY reviews.review_id,items.position`,[reviewerAccountId,reviewIds]
  );
  for (const row of result.rows) {
    const rubric = typeof row.rubric_json === "string" ? JSON.parse(row.rubric_json) : row.rubric_json;
    const rawCriteria = rubric && typeof rubric === "object" && "criteria" in rubric ? rubric.criteria : [];
    const rubricCriteria = Array.isArray(rawCriteria) ? rawCriteria.flatMap(item => {
      if (!item || typeof item !== "object" || typeof item.description !== "string" ||
          typeof item.points !== "number" || !Number.isFinite(item.points) || item.points <= 0) return [];
      return [{description:item.description,points:item.points}];
    }) : [];
    const response = row.text_value ?? (row.boolean_value === null ? null : String(row.boolean_value)) ??
      (row.numeric_value === null ? null : String(row.numeric_value));
    const key = row.answer_key_json;
    const question = Object.freeze({position:Number(row.position),questionType:row.question_type,
      prompt:row.prompt,answered:row.answered,response,
      expectedAnswer:typeof key === "string" || typeof key === "number" || typeof key === "boolean" ? key : null,
      rubric,rubricCriteria:Object.freeze(rubricCriteria)});
    const questions = grouped.get(row.review_id) ?? [];
    questions.push(question);grouped.set(row.review_id,questions);
  }
  return grouped;
}
