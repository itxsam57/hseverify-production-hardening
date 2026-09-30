import "server-only";

import { createIdentifier } from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { getDatabaseClient, type DatabaseClient } from "../database/database";

export type CaseReplaySnapshot = Readonly<{
  caseId: string;
  generatedAt: string;
  sections: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
}>;

const HIDDEN_KEYS = new Set([
  "object_key",
  "ingest_key_hash",
  "signature",
  "qr_payload",
  "encrypted_secret",
  "token_hash",
  "csrf_token_hash",
  "password_hash"
]);

function safeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (HIDDEN_KEYS.has(key)) continue;
      output[key] = safeValue(item);
    }
    return output;
  }
  return value;
}
function safeRows(rows: readonly Record<string, unknown>[]): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(rows.map((row) => Object.freeze(safeValue(row) as Record<string, unknown>)));
}
async function rows(
  database: DatabaseClient,
  sql: string,
  caseId: string
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const result = await database.query<Record<string, unknown>>(sql, [caseId]);
  return safeRows(result.rows);
}

export class CaseReplayAccessError extends Error {
  constructor(message = "Case Replay access is denied.") {
    super(message);
    this.name = "CaseReplayAccessError";
  }
}

export class CaseReplayService {
  constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async replay(
    principal: AuthorizationPrincipal,
    caseIdInput: string,
    purposeInput: string,
    now = new Date()
  ): Promise<CaseReplaySnapshot> {
    if (
      principal.accountStatus !== "active" ||
      (principal.activeRole !== "admin" && principal.activeRole !== "root")
    ) {
      throw new CaseReplayAccessError();
    }
    const caseId = caseIdInput.trim();
    const purpose = purposeInput.trim();
    if (!/^assurance_case_[A-Za-z0-9_-]{24}$/.test(caseId)) {
      throw new CaseReplayAccessError("Case Replay case reference is invalid.");
    }
    if (purpose.length < 5 || purpose.length > 1000) {
      throw new CaseReplayAccessError("Case Replay purpose must be between 5 and 1000 characters.");
    }

    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const caseRows = await rows(
        tx,
        `SELECT cases.*,orders.order_name,orders.order_reference,orders.interview_required,
                orders.credential_target,orders.effective_policy_reference
           FROM assurance_cases cases
           JOIN assurance_orders orders
             ON orders.order_id=cases.order_id AND orders.tenant_id=cases.tenant_id
          WHERE cases.case_id=$1`,
        caseId
      );
      if (caseRows.length !== 1) throw new CaseReplayAccessError("Case Replay case was not found.");

      const [
        timeline, policy, accommodations, evidenceTasks, evidenceDecisions, prechecks, attempts,
        questions, answers, revisions, interruptions, recovery, integritySessions, integrityEvents,
        scoringReviews, scoringMarks, scoringAssistance, interviews, interviewQuestionSets,
        interviewDrafts, interviewRuntime, interviewEvents, recordings, decisions, overrides,
        credentials, credentialHistory, appeals, appealHistory, certifications, certificationEvents,
        livingRecords
      ] = await Promise.all([
        rows(tx, "SELECT * FROM assurance_case_timeline_events WHERE case_id=$1 ORDER BY occurred_at,timeline_event_id", caseId),
        rows(tx, "SELECT * FROM assurance_case_policy_snapshots WHERE case_id=$1 ORDER BY resolved_at,snapshot_id", caseId),
        rows(tx, "SELECT * FROM assurance_case_accommodation_overlays WHERE case_id=$1 ORDER BY approved_at,overlay_id", caseId),
        rows(tx, "SELECT * FROM evidence_review_tasks WHERE case_id=$1 ORDER BY created_at,task_id", caseId),
        rows(tx, `SELECT decisions.* FROM evidence_review_decisions decisions JOIN evidence_review_tasks tasks ON tasks.task_id=decisions.task_id WHERE tasks.case_id=$1 ORDER BY decisions.decided_at,decisions.decision_id`, caseId),
        rows(tx, "SELECT * FROM assessment_precheck_records WHERE case_id=$1 ORDER BY created_at,precheck_id", caseId),
        rows(tx, "SELECT * FROM assessment_attempts WHERE case_id=$1 ORDER BY created_at,attempt_id", caseId),
        rows(tx, `SELECT items.form_id,items.form_item_id,items.position,items.question_id,
                         items.question_version_id,versions.version_no,versions.question_type,
                         versions.prompt,versions.options_json,items.option_order_json,versions.rubric_json,
                         versions.framework_id,versions.domain_reference,versions.difficulty,
                         versions.tags_json,versions.created_at
                    FROM generated_assessment_form_items items
                    JOIN generated_assessment_forms forms ON forms.form_id=items.form_id
                    JOIN assessment_question_versions versions
                      ON versions.question_id=items.question_id
                     AND versions.question_version_id=items.question_version_id
                   WHERE forms.case_id=$1
                   ORDER BY items.form_id,items.position`, caseId),
        rows(tx, `SELECT answers.* FROM assessment_attempt_answers answers JOIN assessment_attempts attempts ON attempts.attempt_id=answers.attempt_id WHERE attempts.case_id=$1 ORDER BY answers.attempt_id,answers.position`, caseId),
        rows(tx, `SELECT revisions.* FROM assessment_answer_revisions revisions JOIN assessment_attempts attempts ON attempts.attempt_id=revisions.attempt_id WHERE attempts.case_id=$1 ORDER BY revisions.attempt_id,revisions.position,revisions.revision_no`, caseId),
        rows(tx, `SELECT events.* FROM assessment_interruption_events events JOIN assessment_attempts attempts ON attempts.attempt_id=events.attempt_id WHERE attempts.case_id=$1 ORDER BY events.occurred_at,events.interruption_id`, caseId),
        rows(tx, `SELECT recovery.* FROM assessment_recovery_reviews recovery JOIN assessment_attempts attempts ON attempts.attempt_id=recovery.attempt_id WHERE attempts.case_id=$1 ORDER BY recovery.created_at,recovery.review_id`, caseId),
        rows(tx, "SELECT * FROM assessment_integrity_sessions WHERE case_id=$1 ORDER BY started_at,attempt_id", caseId),
        rows(tx, "SELECT * FROM integrity_capture_events WHERE case_id=$1 ORDER BY occurred_at,event_id", caseId),
        rows(tx, "SELECT * FROM written_score_reviews WHERE case_id=$1 ORDER BY created_at,review_id", caseId),
        rows(tx, `SELECT marks.* FROM written_score_rubric_marks marks JOIN written_score_reviews reviews ON reviews.review_id=marks.review_id WHERE reviews.case_id=$1 ORDER BY marks.created_at,marks.mark_id`, caseId),
        rows(tx, `SELECT assistance.* FROM written_scoring_assistance assistance JOIN written_score_reviews reviews ON reviews.review_id=assistance.review_id WHERE reviews.case_id=$1 ORDER BY assistance.generated_at,assistance.assistance_id`, caseId),
        rows(tx, "SELECT * FROM interview_requests WHERE case_id=$1 ORDER BY requested_at,interview_request_id", caseId),
        rows(tx, `SELECT sets.* FROM interview_question_sets sets JOIN interview_requests requests ON requests.tenant_id=sets.tenant_id AND requests.interview_request_id=sets.interview_request_id WHERE requests.case_id=$1 ORDER BY sets.created_at,sets.question_set_id`, caseId),
        rows(tx, `SELECT drafts.* FROM interview_console_drafts drafts JOIN interview_requests requests ON requests.tenant_id=drafts.tenant_id AND requests.interview_request_id=drafts.interview_request_id WHERE requests.case_id=$1 ORDER BY drafts.updated_at,drafts.interview_session_id`, caseId),
        rows(tx, `SELECT sessions.* FROM interview_runtime_sessions sessions JOIN interview_requests requests ON requests.tenant_id=sessions.tenant_id AND requests.interview_request_id=sessions.interview_request_id WHERE requests.case_id=$1 ORDER BY sessions.updated_at,sessions.interview_session_id`, caseId),
        rows(tx, `SELECT events.* FROM interview_runtime_events events JOIN interview_runtime_sessions sessions ON sessions.interview_session_id=events.interview_session_id JOIN interview_requests requests ON requests.tenant_id=sessions.tenant_id AND requests.interview_request_id=sessions.interview_request_id WHERE requests.case_id=$1 ORDER BY events.occurred_at,events.event_id`, caseId),
        rows(tx, "SELECT * FROM recording_assets WHERE case_id=$1 ORDER BY created_at,recording_asset_id", caseId),
        rows(tx, "SELECT * FROM platform_decisions WHERE case_id=$1 ORDER BY created_at,decision_id", caseId),
        rows(tx, `SELECT overrides.* FROM platform_decision_overrides overrides JOIN platform_decisions decisions ON decisions.decision_id=overrides.decision_id WHERE decisions.case_id=$1 ORDER BY overrides.created_at,overrides.override_id`, caseId),
        rows(tx, `SELECT credentials.* FROM credential_issuances credentials JOIN assurance_cases cases ON cases.credential_reference=credentials.credential_id WHERE cases.case_id=$1`, caseId),
        rows(tx, `SELECT history.* FROM credential_lifecycle_events history JOIN assurance_cases cases ON cases.credential_reference=history.credential_id WHERE cases.case_id=$1 ORDER BY history.version`, caseId),
        rows(tx, `SELECT appeals.* FROM credential_appeals appeals JOIN assurance_cases cases ON cases.credential_reference=appeals.credential_id WHERE cases.case_id=$1 ORDER BY appeals.created_at,appeals.appeal_id`, caseId),
        rows(tx, `SELECT history.* FROM credential_appeal_events history JOIN credential_appeals appeals ON appeals.appeal_id=history.appeal_id JOIN assurance_cases cases ON cases.credential_reference=appeals.credential_id WHERE cases.case_id=$1 ORDER BY history.version`, caseId),
        rows(tx, `SELECT records.* FROM certification_records records JOIN assurance_cases cases ON cases.credential_reference=records.credential_id WHERE cases.case_id=$1 ORDER BY records.created_at,records.certification_id`, caseId),
        rows(tx, `SELECT events.* FROM certification_record_events events JOIN certification_records records ON records.certification_id=events.certification_id JOIN assurance_cases cases ON cases.credential_reference=records.credential_id WHERE cases.case_id=$1 ORDER BY events.created_at,events.event_id`, caseId),
        rows(tx, `SELECT living.* FROM living_record_versions living JOIN assurance_cases cases ON cases.credential_reference=living.source_credential_id WHERE cases.case_id=$1 ORDER BY living.version`, caseId)
      ]);

      await tx.query(
        `INSERT INTO case_replay_access_events(
           replay_event_id,case_id,actor_account_id,actor_role,purpose,accessed_at
         ) VALUES($1,$2,$3,$4,$5,$6)`,
        [createIdentifier("case_replay"),caseId,principal.accountId,principal.activeRole,purpose,now.toISOString()]
      );

      return Object.freeze({
        caseId,
        generatedAt: now.toISOString(),
        sections: Object.freeze({
          case: caseRows,timeline,policy,accommodations,evidenceTasks,evidenceDecisions,
          assessmentPrechecks: prechecks,assessmentAttempts: attempts,assessmentQuestions: questions,
          assessmentAnswers: answers,assessmentAnswerRevisions: revisions,
          assessmentInterruptions: interruptions,assessmentRecovery: recovery,integritySessions,
          integrityEvents,scoringReviews,scoringMarks,scoringAssistance,interviews,
          interviewQuestionSets,interviewDrafts,interviewRuntime,interviewEvents,recordings,
          decisions,decisionOverrides: overrides,credentials,credentialHistory,appeals,
          appealHistory,certifications,certificationEvents,livingRecords
        })
      });
    });
  }
}
