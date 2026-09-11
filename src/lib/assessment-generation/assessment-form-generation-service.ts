import "server-only";

import { randomBytes } from "node:crypto";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import type { QuestionDifficulty, QuestionType } from "../question-bank/question-bank-domain";
import {
  createAssessmentFormId,
  createAssessmentFormItemId,
  type BlueprintSelector
} from "./assessment-blueprint-domain";
import {
  allocateBlueprintCandidates,
  type AssessmentSelectionCandidate
} from "./assessment-selector-matching";

export class AssessmentFormGenerationError extends Error {
  constructor(message = "Assessment form could not be generated safely.") {
    super(message);
    this.name = "AssessmentFormGenerationError";
  }
}

type CaseRow = {
  case_id: string;
  worker_account_id: string;
  tenant_id: string;
  case_status: string;
  snapshot_framework_id: string | null;
};

type BlueprintVersionRow = {
  blueprint_version_id: string;
  blueprint_id: string;
  framework_id: string;
  selectors_json: unknown;
  blueprint_status: string;
};

type CandidateRow = {
  question_id: string;
  question_version_id: string;
  question_type: QuestionType;
  domain_reference: string;
  difficulty: QuestionDifficulty;
  tags_json: unknown;
};

type FormRow = {
  form_id: string;
  case_id: string;
  worker_account_id: string;
  blueprint_version_id: string;
  question_count: number | string;
  generated_at: string | Date;
};

type ItemRow = {
  form_item_id: string;
  form_id: string;
  position: number | string;
  question_id: string;
  question_version_id: string;
};

export type GeneratedAssessmentFormItem = Readonly<{
  formItemId: string;
  position: number;
  questionId: string;
  questionVersionId: string;
}>;

export type GeneratedAssessmentForm = Readonly<{
  formId: string;
  caseId: string;
  workerAccountId: string;
  blueprintVersionId: string;
  questionCount: number;
  generatedAt: string;
  items: readonly GeneratedAssessmentFormItem[];
}>;

const iso = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function validCaseId(value: string): boolean {
  return /^assurance_case_[A-Za-z0-9_-]{24}$/.test(value);
}

function validBlueprintVersionId(value: string): boolean {
  return /^blueprint_version_[A-Za-z0-9_-]{24}$/.test(value);
}

function parseJsonArray(value: unknown, label: string): readonly unknown[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new AssessmentFormGenerationError(`Stored ${label} JSON is invalid.`);
    }
  }
  if (!Array.isArray(parsed)) {
    throw new AssessmentFormGenerationError(`Stored ${label} is invalid.`);
  }
  return parsed;
}

function parseSelectors(value: unknown): readonly BlueprintSelector[] {
  const rows = parseJsonArray(value, "blueprint selectors");
  if (rows.length < 1 || rows.length > 500) {
    throw new AssessmentFormGenerationError("Stored blueprint selectors are invalid.");
  }
  return Object.freeze(
    rows.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new AssessmentFormGenerationError("Stored blueprint selector is invalid.");
      }
      const selector = value as Partial<BlueprintSelector>;
      if (!Number.isSafeInteger(selector.count) || (selector.count ?? 0) < 1 || (selector.count ?? 0) > 100) {
        throw new AssessmentFormGenerationError("Stored blueprint selector count is invalid.");
      }
      if (!Array.isArray(selector.tagsAll) || selector.tagsAll.some((tag) => typeof tag !== "string")) {
        throw new AssessmentFormGenerationError("Stored blueprint selector tags are invalid.");
      }
      return Object.freeze({
        count: selector.count as number,
        ...(selector.questionType ? { questionType: selector.questionType } : {}),
        ...(selector.domainReference ? { domainReference: selector.domainReference } : {}),
        ...(selector.difficulty ? { difficulty: selector.difficulty } : {}),
        tagsAll: Object.freeze([...(selector.tagsAll as readonly string[])])
      });
    })
  );
}

function parseTags(value: unknown): readonly string[] {
  const parsed = parseJsonArray(value, "question tags");
  if (parsed.some((tag) => typeof tag !== "string")) {
    throw new AssessmentFormGenerationError("Stored question tags are invalid.");
  }
  return parsed as readonly string[];
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && (error as { code?: unknown }).code === "23505"
  );
}

export class AssessmentFormGenerationService {
  constructor(private readonly database: DatabaseClient) {}

  async generateForCase(
    principal: AuthorizationPrincipal,
    input: { caseId: string; blueprintVersionId: string },
    now = new Date()
  ): Promise<GeneratedAssessmentForm> {
    const caseId = input.caseId.trim();
    const blueprintVersionId = input.blueprintVersionId.trim();
    if (!validCaseId(caseId) || !validBlueprintVersionId(blueprintVersionId)) {
      throw new AssessmentFormGenerationError("Assessment form reference is invalid.");
    }
    const actor = bindTrustedAuditActor(principal);

    const existing = await this.loadFormByCaseBlueprint(
      this.database,
      caseId,
      blueprintVersionId
    );
    if (existing) return existing;

    try {
      return await this.database.transaction(async (database) => {
        const insideExisting = await this.loadFormByCaseBlueprint(
          database,
          caseId,
          blueprintVersionId
        );
        if (insideExisting) return insideExisting;

        const caseResult = await database.query<CaseRow>(
          `SELECT c.case_id,c.worker_account_id,c.tenant_id,c.case_status,
                  s.framework_id AS snapshot_framework_id
           FROM assurance_cases c
           LEFT JOIN assurance_case_policy_snapshots s ON s.case_id=c.case_id
           WHERE c.case_id=$1`,
          [caseId]
        );
        const caseRow = caseResult.rows[0];
        if (!caseRow) throw new AssessmentFormGenerationError("Assurance Case is unavailable.");
        if (caseRow.case_status !== "Assessment pending") {
          throw new AssessmentFormGenerationError("Assurance Case is not ready for form generation.");
        }
        if (!caseRow.snapshot_framework_id) {
          throw new AssessmentFormGenerationError("Assurance Case has no locked effective-policy framework.");
        }

        const blueprintResult = await database.query<BlueprintVersionRow>(
          `SELECT v.blueprint_version_id,v.blueprint_id,v.framework_id,v.selectors_json,
                  b.blueprint_status
           FROM assessment_blueprint_versions v
           JOIN assessment_blueprints b ON b.blueprint_id=v.blueprint_id
           WHERE v.blueprint_version_id=$1`,
          [blueprintVersionId]
        );
        const blueprint = blueprintResult.rows[0];
        if (!blueprint || blueprint.blueprint_status !== "ACTIVE") {
          throw new AssessmentFormGenerationError("Assessment blueprint is unavailable.");
        }
        if (blueprint.framework_id !== caseRow.snapshot_framework_id) {
          throw new AssessmentFormGenerationError(
            "Assessment blueprint does not match the Assurance Case framework."
          );
        }
        const selectors = parseSelectors(blueprint.selectors_json);

        const priorResult = await database.query<{ question_id: string }>(
          `SELECT DISTINCT i.question_id
           FROM generated_assessment_forms f
           JOIN generated_assessment_form_items i ON i.form_id=f.form_id
           WHERE f.worker_account_id=$1`,
          [caseRow.worker_account_id]
        );
        const excluded = new Set(priorResult.rows.map((row) => row.question_id));

        const candidatesResult = await database.query<CandidateRow>(
          `SELECT q.question_id,v.question_version_id,v.question_type,
                  v.domain_reference,v.difficulty,v.tags_json
           FROM assessment_questions q
           JOIN assessment_question_versions v
             ON v.question_version_id=q.current_version_id
            AND v.question_id=q.question_id
           WHERE q.question_status='ACTIVE'
             AND v.framework_id=$1
           ORDER BY q.question_id,v.question_version_id`,
          [blueprint.framework_id]
        );

        const nonceHex = randomBytes(32).toString("hex");
        const candidates: AssessmentSelectionCandidate[] = candidatesResult.rows
          .filter((candidate) => !excluded.has(candidate.question_id))
          .map((candidate) =>
            Object.freeze({
              questionId: candidate.question_id,
              questionVersionId: candidate.question_version_id,
              questionType: candidate.question_type,
              domainReference: candidate.domain_reference,
              difficulty: candidate.difficulty,
              tags: Object.freeze([...parseTags(candidate.tags_json)])
            })
          );
        const allocation = allocateBlueprintCandidates(selectors, candidates, nonceHex);
        if (!allocation) {
          throw new AssessmentFormGenerationError(
            "Assessment blueprint has insufficient unseen question capacity for a complete non-repeating form."
          );
        }
        const selected = allocation.map((entry) => entry.candidate);
        if (selected.length < 1 || selected.length > 500) {
          throw new AssessmentFormGenerationError("Generated assessment form size is invalid.");
        }

        const formId = createAssessmentFormId();
        await database.query(
          `INSERT INTO generated_assessment_forms(
             form_id,case_id,worker_account_id,blueprint_version_id,
             generation_nonce_hex,question_count,generated_at
           ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            formId,
            caseId,
            caseRow.worker_account_id,
            blueprintVersionId,
            nonceHex,
            selected.length,
            now.toISOString()
          ]
        );
        for (const [index, candidate] of selected.entries()) {
          await database.query(
            `INSERT INTO generated_assessment_form_items(
               form_item_id,form_id,position,question_id,question_version_id,created_at
             ) VALUES($1,$2,$3,$4,$5,$6)`,
            [
              createAssessmentFormItemId(),
              formId,
              index + 1,
              candidate.questionId,
              candidate.questionVersionId,
              now.toISOString()
            ]
          );
        }

        await new DatabaseAuditRepository(Promise.resolve(database)).append(actor, {
          action: "assessment.form.generated",
          outcome: "succeeded",
          target: { type: "resource", reference: formId },
          metadata: {
            caseId,
            blueprintVersionId,
            frameworkId: blueprint.framework_id,
            questionCount: selected.length
          }
        });
        const generated = await this.loadForm(database, formId);
        if (!generated) throw new AssessmentFormGenerationError();
        return generated;
      });
    } catch (error) {
      if (error instanceof AssessmentFormGenerationError) throw error;
      if (isUniqueViolation(error)) {
        const winner = await this.loadFormByCaseBlueprint(
          this.database,
          caseId,
          blueprintVersionId
        );
        if (winner) return winner;
        throw new AssessmentFormGenerationError(
          "Assessment exposure changed during generation. Generate a fresh non-repeating form."
        );
      }
      throw error;
    }
  }

  private async loadFormByCaseBlueprint(
    database: DatabaseClient,
    caseId: string,
    blueprintVersionId: string
  ): Promise<GeneratedAssessmentForm | null> {
    const result = await database.query<{ form_id: string }>(
      `SELECT form_id
       FROM generated_assessment_forms
       WHERE case_id=$1 AND blueprint_version_id=$2`,
      [caseId, blueprintVersionId]
    );
    const formId = result.rows[0]?.form_id;
    return formId ? this.loadForm(database, formId) : null;
  }

  private async loadForm(
    database: DatabaseClient,
    formId: string
  ): Promise<GeneratedAssessmentForm | null> {
    const formResult = await database.query<FormRow>(
      `SELECT form_id,case_id,worker_account_id,blueprint_version_id,question_count,generated_at
       FROM generated_assessment_forms
       WHERE form_id=$1`,
      [formId]
    );
    const form = formResult.rows[0];
    if (!form) return null;
    const itemResult = await database.query<ItemRow>(
      `SELECT form_item_id,form_id,position,question_id,question_version_id
       FROM generated_assessment_form_items
       WHERE form_id=$1
       ORDER BY position`,
      [formId]
    );
    const items = Object.freeze(
      itemResult.rows.map((item) =>
        Object.freeze({
          formItemId: item.form_item_id,
          position: Number(item.position),
          questionId: item.question_id,
          questionVersionId: item.question_version_id
        })
      )
    );
    const questionCount = Number(form.question_count);
    if (items.length !== questionCount) {
      throw new AssessmentFormGenerationError("Generated assessment form item count is inconsistent.");
    }
    return Object.freeze({
      formId: form.form_id,
      caseId: form.case_id,
      workerAccountId: form.worker_account_id,
      blueprintVersionId: form.blueprint_version_id,
      questionCount,
      generatedAt: iso(form.generated_at),
      items
    });
  }
}

export async function getAssessmentFormGenerationService(): Promise<AssessmentFormGenerationService> {
  return new AssessmentFormGenerationService(await getDatabaseClient());
}
