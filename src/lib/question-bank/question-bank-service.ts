import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  QuestionBankAccessError,
  QuestionBankConflictError,
  QuestionBankInputError,
  createQuestionId,
  createQuestionVersionId,
  normalizeQuestionReference,
  normalizeQuestionVersion,
  type NormalizedQuestionVersion,
  type QuestionStatus,
  type QuestionVersionInput,
  type StoredQuestion,
  type StoredQuestionVersion,
  type WrittenRubric,
  type QuestionAnswerKey,
  type QuestionType,
  type QuestionDifficulty
} from "./question-bank-domain";

type QuestionRow = {
  question_id: string;
  question_reference: string;
  question_status: QuestionStatus;
  current_version_id: string | null;
  current_content_fingerprint: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type VersionRow = {
  question_version_id: string;
  question_id: string;
  version_no: number | string;
  question_type: QuestionType;
  prompt: string;
  options_json: unknown;
  answer_key_json: unknown;
  rubric_json: unknown;
  framework_id: string;
  domain_reference: string;
  difficulty: QuestionDifficulty;
  tags_json: unknown;
  content_fingerprint: string;
  created_at: string | Date;
};

type QuestionAdminJoinRow = QuestionRow &
  VersionRow & {
    version_created_at: string | Date;
  };

const iso = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function jsonContainer(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("[") || trimmed.startsWith("{"))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new QuestionBankConflictError("Stored question JSON is invalid.");
  }
}

function stringArray(value: unknown): readonly string[] {
  const parsed = jsonContainer(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new QuestionBankConflictError("Stored question options/tags are invalid.");
  }
  return Object.freeze(parsed as string[]);
}

function answer(value: unknown, questionType: QuestionType): QuestionAnswerKey {
  if (questionType === "MULTIPLE_CHOICE" && typeof value === "string") {
    return value;
  }
  if (questionType === "TRUE_FALSE" && typeof value === "boolean") {
    return value;
  }
  if (
    (questionType === "INTEGER" || questionType === "DECIMAL") &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }
  throw new QuestionBankConflictError("Stored question answer key is invalid.");
}

function rubric(value: unknown): WrittenRubric | null {
  if (value === null || value === undefined) return null;
  const parsed = jsonContainer(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new QuestionBankConflictError("Stored question rubric is invalid.");
  }
  return parsed as WrittenRubric;
}

function toQuestion(row: QuestionRow): StoredQuestion {
  if (!row.current_version_id || !row.current_content_fingerprint) {
    throw new QuestionBankConflictError("Question current-version pointer is incomplete.");
  }
  return Object.freeze({
    questionId: row.question_id,
    questionReference: row.question_reference,
    questionStatus: row.question_status,
    currentVersionId: row.current_version_id,
    currentContentFingerprint: row.current_content_fingerprint,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  });
}

function toVersion(row: VersionRow): StoredQuestionVersion {
  return Object.freeze({
    questionVersionId: row.question_version_id,
    questionId: row.question_id,
    versionNo: Number(row.version_no),
    questionType: row.question_type,
    prompt: row.prompt,
    options: row.options_json === null ? null : stringArray(row.options_json),
    answerKey:
      row.answer_key_json === null
        ? null
        : answer(row.answer_key_json, row.question_type),
    rubric: rubric(row.rubric_json),
    frameworkId: row.framework_id,
    domainReference: row.domain_reference,
    difficulty: row.difficulty,
    tags: stringArray(row.tags_json),
    contentFingerprint: row.content_fingerprint,
    createdAt: iso(row.created_at)
  });
}

async function liveAdmin(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  now: Date
): Promise<void> {
  if (principal.activeRole !== "admin" || principal.accountStatus !== "active") {
    throw new QuestionBankAccessError();
  }
  const row = await database.query(
    `SELECT 1
     FROM auth_sessions s
     JOIN auth_accounts a ON a.account_id=s.account_id
     JOIN auth_account_roles r ON r.account_id=a.account_id AND r.role='admin'
     WHERE s.session_id=$1
       AND s.account_id=$2
       AND s.active_role='admin'
       AND s.revoked_at IS NULL
       AND s.expires_at>$3
       AND a.account_status='active'
     FOR UPDATE OF s,a`,
    [principal.sessionId, principal.accountId, now.toISOString()]
  );
  if (!row.rows[0]) throw new QuestionBankAccessError();
}

async function frameworkId(database: DatabaseClient, reference: string): Promise<string> {
  const row = await database.query<{ framework_id: string }>(
    `SELECT framework_id
     FROM assurance_frameworks
     WHERE framework_reference=$1 AND framework_status='ACTIVE'`,
    [reference]
  );
  if (!row.rows[0]) throw new QuestionBankInputError("Assessment framework is unavailable.");
  return row.rows[0].framework_id;
}

async function appendAudit(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  action:
    | "assessment.question.created"
    | "assessment.question.revised"
    | "assessment.question.status.changed",
  reference: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await new DatabaseAuditRepository(Promise.resolve(database)).append(
    bindTrustedAuditActor(principal),
    {
      action,
      outcome: "succeeded",
      target: { type: "resource", reference },
      metadata
    }
  );
}

async function insertVersion(
  database: DatabaseClient,
  questionId: string,
  versionNo: number,
  normalized: NormalizedQuestionVersion,
  framework: string,
  principal: AuthorizationPrincipal,
  now: Date
): Promise<string> {
  const id = createQuestionVersionId();
  await database.query(
    `INSERT INTO assessment_question_versions(
       question_version_id,question_id,version_no,question_type,prompt,
       options_json,answer_key_json,rubric_json,framework_id,domain_reference,
       difficulty,tags_json,content_fingerprint,created_by_account_id,created_at
     ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12::jsonb,$13,$14,$15)`,
    [
      id,
      questionId,
      versionNo,
      normalized.questionType,
      normalized.prompt,
      normalized.options === null ? null : JSON.stringify(normalized.options),
      normalized.answerKey === null ? null : JSON.stringify(normalized.answerKey),
      normalized.rubric === null ? null : JSON.stringify(normalized.rubric),
      framework,
      normalized.domainReference,
      normalized.difficulty,
      JSON.stringify(normalized.tags),
      normalized.contentFingerprint,
      principal.accountId,
      now.toISOString()
    ]
  );
  return id;
}

function conflict(error: unknown): never {
  if (error && typeof error === "object" && (error as { code?: unknown }).code === "23505") {
    throw new QuestionBankConflictError(
      "Question reference or active semantic content already exists."
    );
  }
  throw error;
}

export type QuestionAdminListItem = Readonly<{
  question: StoredQuestion;
  version: StoredQuestionVersion;
}>;

export class QuestionBankService {
  constructor(private readonly database: DatabaseClient) {}

  async createQuestion(
    principal: AuthorizationPrincipal,
    input: { questionReference: string; version: QuestionVersionInput },
    now = new Date()
  ): Promise<QuestionAdminListItem> {
    const reference = normalizeQuestionReference(input.questionReference);
    const normalized = normalizeQuestionVersion(input.version);
    try {
      return await this.database.transaction(async (database) => {
        await liveAdmin(database, principal, now);
        const framework = await frameworkId(database, normalized.frameworkReference);
        const questionId = createQuestionId();
        await database.query(
          `INSERT INTO assessment_questions(
             question_id,question_reference,question_status,created_by_account_id,created_at,updated_at
           ) VALUES($1,$2,'INACTIVE',$3,$4,$4)`,
          [questionId, reference, principal.accountId, now.toISOString()]
        );
        const versionId = await insertVersion(
          database,
          questionId,
          1,
          normalized,
          framework,
          principal,
          now
        );
        const updated = await database.query<QuestionRow>(
          `UPDATE assessment_questions
           SET current_version_id=$2,
               current_content_fingerprint=$3,
               question_status='ACTIVE',
               updated_at=$4
           WHERE question_id=$1
           RETURNING question_id,question_reference,question_status,current_version_id,
                     current_content_fingerprint,created_at,updated_at`,
          [questionId, versionId, normalized.contentFingerprint, now.toISOString()]
        );
        const version = await this.findVersionRow(database, versionId);
        if (!updated.rows[0] || !version) throw new QuestionBankConflictError();
        await appendAudit(database, principal, "assessment.question.created", questionId, {
          questionType: normalized.questionType,
          versionNo: 1
        });
        return Object.freeze({
          question: toQuestion(updated.rows[0]),
          version: toVersion(version)
        });
      });
    } catch (error) {
      return conflict(error);
    }
  }

  async reviseQuestion(
    principal: AuthorizationPrincipal,
    input: {
      questionId: string;
      expectedCurrentVersionId: string;
      version: QuestionVersionInput;
    },
    now = new Date()
  ): Promise<QuestionAdminListItem> {
    const normalized = normalizeQuestionVersion(input.version);
    const questionId = input.questionId.trim();
    const expected = input.expectedCurrentVersionId.trim();
    if (
      !/^assessment_question_[A-Za-z0-9_-]{24}$/.test(questionId) ||
      !/^question_version_[A-Za-z0-9_-]{24}$/.test(expected)
    ) {
      throw new QuestionBankInputError("Question revision reference is invalid.");
    }
    try {
      return await this.database.transaction(async (database) => {
        await liveAdmin(database, principal, now);
        const current = await database.query<QuestionRow>(
          `SELECT question_id,question_reference,question_status,current_version_id,
                  current_content_fingerprint,created_at,updated_at
           FROM assessment_questions
           WHERE question_id=$1
           FOR UPDATE`,
          [questionId]
        );
        const row = current.rows[0];
        if (!row) throw new QuestionBankAccessError();
        if (row.current_version_id !== expected) {
          throw new QuestionBankConflictError("Question was revised by another writer.");
        }
        const next = await database.query<{ version_no: number | string }>(
          `SELECT COALESCE(MAX(version_no),0)+1 AS version_no
           FROM assessment_question_versions
           WHERE question_id=$1`,
          [questionId]
        );
        const framework = await frameworkId(database, normalized.frameworkReference);
        const versionNo = Number(next.rows[0]?.version_no ?? 1);
        const versionId = await insertVersion(
          database,
          questionId,
          versionNo,
          normalized,
          framework,
          principal,
          now
        );
        const updated = await database.query<QuestionRow>(
          `UPDATE assessment_questions
           SET current_version_id=$2,current_content_fingerprint=$3,updated_at=$4
           WHERE question_id=$1 AND current_version_id=$5
           RETURNING question_id,question_reference,question_status,current_version_id,
                     current_content_fingerprint,created_at,updated_at`,
          [
            questionId,
            versionId,
            normalized.contentFingerprint,
            now.toISOString(),
            expected
          ]
        );
        if (!updated.rows[0]) {
          throw new QuestionBankConflictError("Question was revised by another writer.");
        }
        const version = await this.findVersionRow(database, versionId);
        if (!version) throw new QuestionBankConflictError();
        await appendAudit(database, principal, "assessment.question.revised", questionId, {
          questionType: normalized.questionType,
          versionNo
        });
        return Object.freeze({
          question: toQuestion(updated.rows[0]),
          version: toVersion(version)
        });
      });
    } catch (error) {
      return conflict(error);
    }
  }

  async setStatus(
    principal: AuthorizationPrincipal,
    questionId: string,
    status: QuestionStatus,
    now = new Date()
  ): Promise<StoredQuestion> {
    if (
      !/^assessment_question_[A-Za-z0-9_-]{24}$/.test(questionId) ||
      !(["ACTIVE", "INACTIVE"] as const).includes(status)
    ) {
      throw new QuestionBankInputError();
    }
    try {
      return await this.database.transaction(async (database) => {
        await liveAdmin(database, principal, now);
        const updated = await database.query<QuestionRow>(
          `UPDATE assessment_questions
           SET question_status=$2,updated_at=$3
           WHERE question_id=$1 AND current_version_id IS NOT NULL
           RETURNING question_id,question_reference,question_status,current_version_id,
                     current_content_fingerprint,created_at,updated_at`,
          [questionId, status, now.toISOString()]
        );
        if (!updated.rows[0]) throw new QuestionBankAccessError();
        await appendAudit(
          database,
          principal,
          "assessment.question.status.changed",
          questionId,
          { questionStatus: status }
        );
        return toQuestion(updated.rows[0]);
      });
    } catch (error) {
      return conflict(error);
    }
  }

  async listQuestions(
    principal: AuthorizationPrincipal
  ): Promise<readonly QuestionAdminListItem[]> {
    if (principal.activeRole !== "admin") throw new QuestionBankAccessError();
    const rows = await this.database.query<QuestionAdminJoinRow>(
      `SELECT q.question_id,q.question_reference,q.question_status,q.current_version_id,
              q.current_content_fingerprint,q.created_at,q.updated_at,
              v.question_version_id,v.version_no,v.question_type,v.prompt,v.options_json,
              v.answer_key_json,v.rubric_json,v.framework_id,v.domain_reference,v.difficulty,
              v.tags_json,v.content_fingerprint,v.created_at AS version_created_at
       FROM assessment_questions q
       JOIN assessment_question_versions v ON v.question_version_id=q.current_version_id
       ORDER BY q.updated_at DESC,q.question_id`
    );
    return Object.freeze(
      rows.rows.map((row) =>
        Object.freeze({
          question: toQuestion(row),
          version: toVersion({ ...row, created_at: row.version_created_at } as VersionRow)
        })
      )
    );
  }

  private async findVersionRow(
    database: DatabaseClient,
    id: string
  ): Promise<VersionRow | null> {
    const row = await database.query<VersionRow>(
      `SELECT question_version_id,question_id,version_no,question_type,prompt,
              options_json,answer_key_json,rubric_json,framework_id,domain_reference,
              difficulty,tags_json,content_fingerprint,created_at
       FROM assessment_question_versions
       WHERE question_version_id=$1`,
      [id]
    );
    return row.rows[0] ?? null;
  }
}

export async function getQuestionBankService(): Promise<QuestionBankService> {
  return new QuestionBankService(await getDatabaseClient());
}
