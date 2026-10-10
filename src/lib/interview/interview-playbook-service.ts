import "server-only";

import { createIdentifier } from "@/lib/auth/auth-domain";
import type { AuthorizationPrincipal } from "@/lib/authorization/authorization-context-domain";
import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";
import { eligibleInterviewQuestions, InterviewPolicyInputError, normalizeInterviewPolicy,
  validateInterviewPolicyScorecard, type InterviewQuestionKind, type InterviewSelectionContext,
  type InterviewPolicyScorecard } from "./interview-policy-domain";
import { loadPinnedInterviewPolicy, selectApprovedInterviewQuestions } from "./interview-policy-service";

export type InterviewPlaybookQuestion = Readonly<{
  questionId: string;
  kind: InterviewQuestionKind;
  templateId?: string;
  scoringGuidance?: string;
  source: string;
  prompt: string;
  topic: string | null;
  mandatory: boolean;
}>;

export type InterviewQuestionSetView = Readonly<{
  questionSetId: string;
  interviewRequestId: string;
  versionNo: number;
  questions: readonly InterviewPlaybookQuestion[];
  sourceContext: Readonly<Record<string, unknown>>;
  createdAt: string;
}>;

export class InterviewPlaybookAccessError extends Error {
  constructor(message = "Interview playbook access is denied.") {
    super(message);
    this.name = "InterviewPlaybookAccessError";
  }
}

export class InterviewPlaybookInputError extends Error {
  constructor(message = "Interview playbook input is invalid.") {
    super(message);
    this.name = "InterviewPlaybookInputError";
  }
}

function parseQuestions(value: unknown): readonly InterviewPlaybookQuestion[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed) as unknown; } catch { return Object.freeze([]); }
  }
  if (!Array.isArray(parsed)) return Object.freeze([]);
  return Object.freeze(parsed.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (
      typeof row.questionId !== "string" ||
      typeof row.kind !== "string" ||
      !["MANDATORY","RANDOM","WEAK_AREA","HIGH_RISK","INTEGRITY","FOLLOW_UP"].includes(row.kind) ||
      typeof row.source !== "string" ||
      typeof row.prompt !== "string"
    ) return [];
    return [Object.freeze({
      questionId: row.questionId,
      kind: row.kind as InterviewPlaybookQuestion["kind"],
      ...(typeof row.templateId === "string" ? { templateId: row.templateId } : {}),
      ...(typeof row.scoringGuidance === "string" ? { scoringGuidance: row.scoringGuidance } : {}),
      source: row.source,
      prompt: row.prompt,
      topic: typeof row.topic === "string" ? row.topic : null,
      mandatory: Boolean(row.mandatory)
    })];
  }));
}

function parseObject(value: unknown): Readonly<Record<string, unknown>> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.freeze({ ...(value as Record<string, unknown>) });
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.freeze({ ...(parsed as Record<string, unknown>) })
        : Object.freeze({});
    } catch {
      return Object.freeze({});
    }
  }
  return Object.freeze({});
}

type PlaybookRequestRow = {
  interview_request_id: string;
  tenant_id: string;
  case_id: string;
  worker_account_id: string;
  assessor_account_id: string | null;
  trade_scope: string | null;
  qualification_scope: string | null;
  risk_level: InterviewSelectionContext["riskLevel"];
  language: string;
  jurisdiction: string;
  status: string;
};

async function openAssignedRequestForUpdate(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  interviewRequestId: string
): Promise<PlaybookRequestRow> {
  const preliminary = await database.query<{
    tenant_id: string; case_id: string; assessor_account_id: string | null;
  }>(
    "SELECT tenant_id,case_id,assessor_account_id FROM interview_requests WHERE interview_request_id=$1",
    [interviewRequestId]
  );
  const owned = preliminary.rows[0];
  if (!owned || owned.assessor_account_id !== principal.accountId) {
    throw new InterviewPlaybookAccessError();
  }

  // Match recommendation/replacement case-first locking, then recheck ownership.
  const cases = await database.query<{ case_status: string; interview_reference: string | null }>(
    "SELECT case_status,interview_reference FROM assurance_cases WHERE case_id=$1 AND tenant_id=$2 FOR UPDATE",
    [owned.case_id, owned.tenant_id]
  );
  const requests = await database.query<PlaybookRequestRow>(
    `SELECT interview_request_id,tenant_id,case_id,worker_account_id,
            assessor_account_id,trade_scope,qualification_scope,risk_level,language,jurisdiction,status
       FROM interview_requests WHERE interview_request_id=$1 FOR UPDATE`,
    [interviewRequestId]
  );
  const request = requests.rows[0];
  if (!request || request.assessor_account_id !== principal.accountId) {
    throw new InterviewPlaybookAccessError();
  }
  if (
    request.tenant_id !== owned.tenant_id || request.case_id !== owned.case_id ||
    !["ASSIGNED", "WAITING_ROOM"].includes(request.status) ||
    cases.rows[0]?.case_status !== "Interview pending" ||
    cases.rows[0].interview_reference !== interviewRequestId
  ) {
    throw new InterviewPlaybookInputError("Interview is closed.");
  }

  const sessions = await database.query<{ status: string }>(
    "SELECT status FROM interview_runtime_sessions WHERE tenant_id=$1 AND interview_request_id=$2 FOR UPDATE",
    [request.tenant_id, interviewRequestId]
  );
  const drafts = await database.query<{ submitted: boolean }>(
    "SELECT submitted FROM interview_console_drafts WHERE tenant_id=$1 AND interview_request_id=$2 FOR UPDATE",
    [request.tenant_id, interviewRequestId]
  );
  if (
    sessions.rows.some((row) => ["ENDED", "NO_SHOW"].includes(row.status)) ||
    drafts.rows.some((row) => row.submitted)
  ) {
    throw new InterviewPlaybookInputError("Interview is closed.");
  }
  return request;
}

async function latestSet(
  database: DatabaseClient,
  tenantId: string,
  interviewRequestId: string
): Promise<InterviewQuestionSetView | null> {
  const result = await database.query<{
    question_set_id: string;
    interview_request_id: string;
    version_no: number | string;
    source_context_json: unknown;
    questions_json: unknown;
    created_at: string | Date;
  }>(
    `SELECT question_set_id,interview_request_id,version_no,
            source_context_json,questions_json,created_at
       FROM interview_question_sets
      WHERE tenant_id=$1 AND interview_request_id=$2
      ORDER BY version_no DESC
      LIMIT 1`,
    [tenantId, interviewRequestId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return Object.freeze({
    questionSetId: row.question_set_id,
    interviewRequestId: row.interview_request_id,
    versionNo: Number(row.version_no),
    sourceContext: parseObject(row.source_context_json),
    questions: parseQuestions(row.questions_json),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString()
  });
}

async function validateFrozenPlaybook(
  database: DatabaseClient, tenantId: string, caseId: string, set: InterviewQuestionSetView
): Promise<void> {
  const pinned = await loadPinnedInterviewPolicy(database, tenantId, caseId);
  if (!pinned.policy) {
    if (set.sourceContext.policyMode === "CONFIGURED") throw new InterviewPolicyInputError("Interview frozen policy does not belong to this case.");
    return;
  }
  if (set.sourceContext.policyMode !== "CONFIGURED" ||
      set.sourceContext.caseId !== caseId ||
      set.sourceContext.policySnapshotId !== pinned.snapshotId ||
      set.sourceContext.policyVersionId !== pinned.policyVersionId ||
      JSON.stringify(normalizeInterviewPolicy(set.sourceContext.interviewPolicy)) !== JSON.stringify(pinned.policy)) {
    throw new InterviewPolicyInputError("Interview frozen policy reference is inconsistent.");
  }
  const selection = parseObject(set.sourceContext.selectionContext) as InterviewSelectionContext;
  const requests = await database.query<PlaybookRequestRow>(
    "SELECT interview_request_id,tenant_id,case_id,worker_account_id,assessor_account_id,trade_scope,qualification_scope,risk_level,language,jurisdiction,status FROM interview_requests WHERE tenant_id=$1 AND interview_request_id=$2 AND case_id=$3",
    [tenantId,set.interviewRequestId,caseId]);
  const request = requests.rows[0];
  if (!request || set.sourceContext.workerAccountId !== request.worker_account_id ||
      selection.tradeScope !== request.trade_scope || selection.qualificationScope !== request.qualification_scope ||
      selection.riskLevel !== request.risk_level || selection.language !== request.language || selection.jurisdiction !== request.jurisdiction ||
      !Array.isArray(selection.weakTopics) || typeof selection.writtenWeakness !== "boolean" ||
      typeof selection.hasIntegrityFlags !== "boolean" || !Number.isInteger(selection.previousAttemptCount)) {
    throw new InterviewPolicyInputError("Interview frozen case context is inconsistent.");
  }
  for (const key of ["tradeScope","qualificationScope","riskLevel","language","jurisdiction"] as const) {
    if (pinned.policy.context && key in pinned.policy.context && pinned.policy.context[key] !== selection[key]) {
      throw new InterviewPolicyInputError("Interview context differs from the case-pinned policy.");
    }
  }
  const initial = selectApprovedInterviewQuestions(pinned.policy, selection, set.interviewRequestId, pinned.snapshotId!);
  const approved = eligibleInterviewQuestions(pinned.policy, selection);
  const expectedIds = initial.map(q => q.templateId);
  const initialQuestions = set.questions.filter(q => q.kind !== "FOLLOW_UP");
  if (JSON.stringify(initialQuestions.map(q => q.templateId)) !== JSON.stringify(expectedIds) ||
      JSON.stringify(set.sourceContext.selectedTemplateIds) !== JSON.stringify(set.questions.map(q => q.templateId)) ||
      new Set(set.questions.map(q => q.questionId)).size !== set.questions.length ||
      new Set(set.questions.map(q => q.templateId)).size !== set.questions.length) {
    throw new InterviewPolicyInputError("Interview approved question selection is inconsistent.");
  }
  for (const question of set.questions) {
    const template = approved.find(t => t.templateId === question.templateId);
    if (!template || question.source !== "effective_policy" || question.kind !== template.kind ||
        question.prompt !== template.prompt || question.topic !== template.topic ||
        question.scoringGuidance !== template.scoringGuidance ||
        question.mandatory !== ["MANDATORY", "HIGH_RISK"].includes(template.kind)) {
      throw new InterviewPolicyInputError("Interview question differs from its approved frozen template.");
    }
  }
}

export async function validateInterviewFrozenScorecard(
  database: DatabaseClient, tenantId: string, caseId: string, interviewRequestId: string,
  scorecard: unknown, complete = false
): Promise<InterviewPolicyScorecard | null> {
  const pinned = await loadPinnedInterviewPolicy(database, tenantId, caseId);
  if (!pinned.policy) return null;
  const set = await latestSet(database, tenantId, interviewRequestId);
  if (!set) throw new InterviewPolicyInputError("Create the approved interview question set before saving the scorecard.");
  await validateFrozenPlaybook(database, tenantId, caseId, set);
  return validateInterviewPolicyScorecard(scorecard, set, pinned.policy, complete);
}

export class InterviewPlaybookService {
  constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async getAssigned(
    principal: AuthorizationPrincipal,
    interviewRequestId: string
  ): Promise<InterviewQuestionSetView | null> {
    if (principal.activeRole !== "assessor" || principal.accountStatus !== "active") {
      throw new InterviewPlaybookAccessError();
    }
    const database = await this.databasePromise;
    const request = await database.query<{ tenant_id: string; assessor_account_id: string | null }>(
      "SELECT tenant_id,assessor_account_id FROM interview_requests WHERE interview_request_id=$1 LIMIT 1",
      [interviewRequestId]
    );
    const row = request.rows[0];
    if (!row || row.assessor_account_id !== principal.accountId) {
      throw new InterviewPlaybookAccessError();
    }
    return latestSet(database, row.tenant_id, interviewRequestId);
  }

  async ensure(
    principal: AuthorizationPrincipal,
    interviewRequestId: string,
    now = new Date()
  ): Promise<InterviewQuestionSetView> {
    if (principal.activeRole !== "assessor" || principal.accountStatus !== "active") {
      throw new InterviewPlaybookAccessError();
    }
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const request = await openAssignedRequestForUpdate(tx, principal, interviewRequestId);
      const existing = await latestSet(tx, request.tenant_id, interviewRequestId);
      if (existing) { await validateFrozenPlaybook(tx, request.tenant_id, request.case_id, existing); return existing; }

      const weakAreas = await tx.query<{ domain_reference: string; count: number | string }>(
        `SELECT versions.domain_reference,COUNT(*)::int AS count
           FROM assessment_attempts AS attempts
           JOIN generated_assessment_form_items AS items ON items.form_id=attempts.form_id
           JOIN assessment_question_versions AS versions
             ON versions.question_id=items.question_id
            AND versions.question_version_id=items.question_version_id
           JOIN assessment_attempt_answers AS answers
             ON answers.attempt_id=attempts.attempt_id
            AND answers.position=items.position
           LEFT JOIN LATERAL (
             SELECT revisions.text_value,revisions.boolean_value,revisions.numeric_value
               FROM assessment_answer_revisions AS revisions
              WHERE revisions.attempt_id=answers.attempt_id
                AND revisions.answer_id=answers.answer_id
                AND revisions.position=answers.position
              ORDER BY revisions.revision_no DESC LIMIT 1
           ) AS latest ON TRUE
          WHERE attempts.case_id=$1
            AND attempts.status IN ('SUBMITTED','AUTO_SUBMITTED')
            AND versions.question_type IN ('MULTIPLE_CHOICE','TRUE_FALSE','INTEGER','DECIMAL')
            AND NOT (
              CASE versions.question_type
                WHEN 'MULTIPLE_CHOICE' THEN
                  COALESCE(latest.text_value,answers.text_value) =
                  COALESCE(versions.answer_key_json->>'value','')
                WHEN 'TRUE_FALSE' THEN
                  COALESCE(latest.boolean_value,answers.boolean_value) =
                  (versions.answer_key_json->>'value')::boolean
                ELSE
                  COALESCE(latest.numeric_value,answers.numeric_value) =
                  (versions.answer_key_json->>'value')::numeric
              END
            )
          GROUP BY versions.domain_reference
          ORDER BY COUNT(*) DESC,versions.domain_reference
          LIMIT 5`,
        [request.case_id]
      );

      const integrity = await tx.query<{ classification: string; event_type: string; count: number | string }>(
        `SELECT events.classification,events.event_type,COUNT(*)::int AS count
           FROM integrity_capture_events AS events
           JOIN assessment_attempts AS attempts ON attempts.attempt_id=events.attempt_id
          WHERE attempts.case_id=$1 AND events.classification IN ('YELLOW','RED')
          GROUP BY events.classification,events.event_type
          ORDER BY CASE events.classification WHEN 'RED' THEN 0 ELSE 1 END,COUNT(*) DESC
          LIMIT 5`,
        [request.case_id]
      );

      const written = await tx.query<{ decision: string; score: number | string; reason: string }>(
        `SELECT decision,score,reason
           FROM written_score_reviews
          WHERE case_id=$1 AND status='FINAL'
          ORDER BY created_at DESC LIMIT 1`,
        [request.case_id]
      );
      const attempts = await tx.query<{ count: number | string }>(
        "SELECT COUNT(*)::int AS count FROM assessment_attempts WHERE case_id=$1",
        [request.case_id]
      );

      let questions: InterviewPlaybookQuestion[] = [
        {
          questionId: createIdentifier("interview_question"),
          kind: "MANDATORY",
          source: "platform",
          prompt: "Describe the task, hazard controls and stop-work conditions you would apply before starting a high-risk job.",
          topic: request.trade_scope,
          mandatory: true
        },
        {
          questionId: createIdentifier("interview_question"),
          kind: "MANDATORY",
          source: "platform",
          prompt: "Give an example of a situation where you would stop work, escalate the risk and only resume after controls were verified.",
          topic: "safety judgement",
          mandatory: true
        }
      ];

      for (const area of weakAreas.rows) {
        questions.push({
          questionId: createIdentifier("interview_question"),
          kind: "WEAK_AREA",
          source: "assessment",
          prompt: `Explain how you would apply ${area.domain_reference} in a real work scenario and how you would verify the controls are effective.`,
          topic: area.domain_reference,
          mandatory: false
        });
      }
      for (const flag of integrity.rows) {
        questions.push({
          questionId: createIdentifier("interview_question"),
          kind: "INTEGRITY",
          source: "integrity",
          prompt: "Describe any technical, environmental or interruption issue during your assessment that could help the Assessor interpret the recorded integrity timeline accurately.",
          topic: flag.event_type,
          mandatory: false
        });
        break;
      }
      if (written.rows[0]?.decision === "CHANGES_REQUESTED" || Number(written.rows[0]?.score ?? 100) < 70) {
        questions.push({
          questionId: createIdentifier("interview_question"),
          kind: "WEAK_AREA",
          source: "written_review",
          prompt: "Revisit the reasoning in your written response and explain the controls, assumptions and safety consequences you would apply in practice.",
          topic: "written reasoning",
          mandatory: false
        });
      }

      const pinned = await loadPinnedInterviewPolicy(tx, request.tenant_id, request.case_id);
      const selectionContext: InterviewSelectionContext = {
        tradeScope: request.trade_scope, qualificationScope: request.qualification_scope,
        riskLevel: request.risk_level, language: request.language, jurisdiction: request.jurisdiction,
        weakTopics: weakAreas.rows.map(row => row.domain_reference),
        writtenWeakness: written.rows[0]?.decision === "CHANGES_REQUESTED" || Number(written.rows[0]?.score ?? 100) < 70,
        hasIntegrityFlags: integrity.rows.length > 0,
        previousAttemptCount: Number(attempts.rows[0]?.count ?? 0)
      };
      if (pinned.policy && pinned.snapshotId) {
        const selected = selectApprovedInterviewQuestions(pinned.policy, selectionContext, interviewRequestId, pinned.snapshotId);
        questions = selected.map(template => ({
          questionId: createIdentifier("interview_question"), templateId: template.templateId,
          kind: template.kind, source: "effective_policy", prompt: template.prompt,
          topic: template.topic, mandatory: ["MANDATORY", "HIGH_RISK"].includes(template.kind),
          ...(template.scoringGuidance ? { scoringGuidance: template.scoringGuidance } : {})
        }));
      }
      const sourceContext = {
        policyMode: pinned.policy ? "CONFIGURED" : "LEGACY",
        policySnapshotId: pinned.snapshotId,
        policyVersionId: pinned.policyVersionId,
        ...(pinned.policy ? {
          interviewPolicy: pinned.policy, selectionContext,
          selectedTemplateIds: questions.map(q => q.templateId),
          legacyContextFields: ["tradeScope","qualificationScope","riskLevel","language","jurisdiction"].filter(key => !(key in (pinned.policy?.context ?? {})))
        } : {}),
        caseId: request.case_id,
        workerAccountId: request.worker_account_id,
        tradeScope: request.trade_scope,
        qualificationScope: request.qualification_scope,
        riskLevel: request.risk_level,
        previousAttemptCount: Number(attempts.rows[0]?.count ?? 0),
        weakAreas: weakAreas.rows.map((row) => ({
          domainReference: row.domain_reference,
          incorrectCount: Number(row.count)
        })),
        integrityFlags: integrity.rows.map((row) => ({
          classification: row.classification,
          eventType: row.event_type,
          count: Number(row.count)
        })),
        writtenReview: written.rows[0] ?? null
      };

      const questionSetId = createIdentifier("interview_questions");
      await tx.query(
        `INSERT INTO interview_question_sets(
           question_set_id,tenant_id,interview_request_id,version_no,
           source_context_json,questions_json,created_by_account_id,created_at
         ) VALUES($1,$2,$3,1,$4::jsonb,$5::jsonb,$6,$7)`,
        [
          questionSetId,
          request.tenant_id,
          interviewRequestId,
          JSON.stringify(sourceContext),
          JSON.stringify(questions),
          principal.accountId,
          now.toISOString()
        ]
      );
      const created = await latestSet(tx, request.tenant_id, interviewRequestId);
      if (!created) throw new InterviewPlaybookInputError("Interview question set could not be created.");
      return created;
    });
  }

  async addFollowUp(
    principal: AuthorizationPrincipal,
    interviewRequestId: string,
    promptInput: string,
    now = new Date()
  ): Promise<InterviewQuestionSetView> {
    if (principal.activeRole !== "assessor" || principal.accountStatus !== "active") {
      throw new InterviewPlaybookAccessError();
    }
    const prompt = promptInput.trim().replace(/\s+/g, " ");
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const row = await openAssignedRequestForUpdate(tx, principal, interviewRequestId);
      const current = await latestSet(tx, row.tenant_id, interviewRequestId);
      if (!current) throw new InterviewPlaybookInputError("Create the interview playbook before adding follow-ups.");
      await validateFrozenPlaybook(tx, row.tenant_id, row.case_id, current);
      const policy = current.sourceContext.policyMode === "CONFIGURED"
        ? normalizeInterviewPolicy(current.sourceContext.interviewPolicy) : null;
      const approved = policy ? eligibleInterviewQuestions(policy, current.sourceContext.selectionContext as InterviewSelectionContext)
        .find(q => q.kind === "FOLLOW_UP" && q.templateId === prompt) : null;
      if (policy && (!approved || current.questions.some(q => q.templateId === approved.templateId))) {
        throw new InterviewPlaybookInputError("Choose an unused approved follow-up template for this case.");
      }
      if (!policy && (prompt.length < 10 || prompt.length > 1000)) {
        throw new InterviewPlaybookInputError("Follow-up question must contain between 10 and 1000 characters.");
      }
      const questions = [
        ...current.questions,
        Object.freeze({
          questionId: createIdentifier("interview_question"),
          kind: "FOLLOW_UP" as const,
          source: approved ? "effective_policy" : "assessor",
          prompt: approved?.prompt ?? prompt,
          topic: approved?.topic ?? null,
          mandatory: false,
          ...(approved ? { templateId: approved.templateId, ...(approved.scoringGuidance ? { scoringGuidance: approved.scoringGuidance } : {}) } : {})
        })
      ];
      await tx.query(
        `INSERT INTO interview_question_sets(
           question_set_id,tenant_id,interview_request_id,version_no,
           source_context_json,questions_json,created_by_account_id,created_at
         ) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
        [
          createIdentifier("interview_questions"),
          row.tenant_id,
          interviewRequestId,
          current.versionNo + 1,
          JSON.stringify({ ...current.sourceContext, ...(policy ? { selectedTemplateIds: questions.map(q => q.templateId) } : {}) }),
          JSON.stringify(questions),
          principal.accountId,
          now.toISOString()
        ]
      );
      const updated = await latestSet(tx, row.tenant_id, interviewRequestId);
      if (!updated) throw new InterviewPlaybookInputError();
      return updated;
    });
  }
}

let service: InterviewPlaybookService | null = null;
export function getInterviewPlaybookService(): InterviewPlaybookService {
  service ??= new InterviewPlaybookService();
  return service;
}
