import "server-only";

import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import type {
  QuestionDifficulty,
  QuestionType
} from "../question-bank/question-bank-domain";

type FormRow = {
  form_id: string;
  case_id: string;
  blueprint_version_id: string;
  question_count: number | string;
};

type DeliveryItemRow = {
  position: number | string;
  question_id: string;
  question_version_id: string;
  question_type: QuestionType;
  prompt: string;
  options_json: unknown;
  domain_reference: string;
  difficulty: QuestionDifficulty;
  tags_json: unknown;
};

export type AssessmentFormDeliveryItem = Readonly<{
  position: number;
  questionId: string;
  questionVersionId: string;
  questionType: QuestionType;
  prompt: string;
  options: readonly string[] | null;
  domainReference: string;
  difficulty: QuestionDifficulty;
  tags: readonly string[];
}>;

export type AssessmentFormDelivery = Readonly<{
  formId: string;
  caseId: string;
  blueprintVersionId: string;
  items: readonly AssessmentFormDeliveryItem[];
}>;

function strings(value: unknown, label: string): readonly string[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error(`Stored assessment form ${label} is invalid.`);
    }
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(`Stored assessment form ${label} is invalid.`);
  }
  return Object.freeze(parsed as string[]);
}

function validFormId(value: string): boolean {
  return /^assessment_form_[A-Za-z0-9_-]{24}$/.test(value);
}

export class AssessmentFormDeliveryService {
  constructor(private readonly database: DatabaseClient) {}

  async getForm(formIdInput: string): Promise<AssessmentFormDelivery | null> {
    const formId = formIdInput.trim();
    if (!validFormId(formId)) return null;

    const formResult = await this.database.query<FormRow>(
      `SELECT form_id,case_id,blueprint_version_id,question_count
       FROM generated_assessment_forms
       WHERE form_id=$1`,
      [formId]
    );
    const form = formResult.rows[0];
    if (!form) return null;

    const itemResult = await this.database.query<DeliveryItemRow>(
      `SELECT i.position,i.question_id,i.question_version_id,
              v.question_type,v.prompt,v.options_json,
              v.domain_reference,v.difficulty,v.tags_json
       FROM generated_assessment_form_items i
       JOIN assessment_question_versions v
         ON v.question_version_id=i.question_version_id
        AND v.question_id=i.question_id
       WHERE i.form_id=$1
       ORDER BY i.position`,
      [formId]
    );
    const questionCount = Number(form.question_count);
    if (
      !Number.isSafeInteger(questionCount) ||
      questionCount < 1 ||
      itemResult.rows.length !== questionCount
    ) {
      throw new Error("Stored assessment form item count is inconsistent.");
    }

    const items = Object.freeze(
      itemResult.rows.map((row, index) => {
        const position = Number(row.position);
        if (!Number.isSafeInteger(position) || position !== index + 1) {
          throw new Error("Stored assessment form order is invalid.");
        }
        return Object.freeze({
          position,
          questionId: row.question_id,
          questionVersionId: row.question_version_id,
          questionType: row.question_type,
          prompt: row.prompt,
          options:
            row.options_json === null
              ? null
              : strings(row.options_json, "question options"),
          domainReference: row.domain_reference,
          difficulty: row.difficulty,
          tags: strings(row.tags_json, "question tags")
        });
      })
    );

    return Object.freeze({
      formId: form.form_id,
      caseId: form.case_id,
      blueprintVersionId: form.blueprint_version_id,
      items
    });
  }
}

export async function getAssessmentFormDeliveryService(): Promise<AssessmentFormDeliveryService> {
  return new AssessmentFormDeliveryService(await getDatabaseClient());
}
