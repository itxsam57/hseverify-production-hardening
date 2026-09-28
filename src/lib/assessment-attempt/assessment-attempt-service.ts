import "server-only";

import { createIdentifier } from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { evaluatePlatformPermission } from "../authorization/authorization-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import { AssessmentCatalogueEligibilityService } from "../assessment-catalogue/assessment-catalogue-eligibility-service";
import { AssessmentFormGenerationService } from "../assessment-generation/assessment-form-generation-service";
import { AssessmentDeliverySettingsService } from "../assessment-generation/assessment-delivery-settings-service";
import type { AssessmentDeliverySettings } from "../assessment-generation/assessment-delivery-settings";
import {
  createAssuranceTimelineEventId,
  type AssuranceCaseStatus
} from "../assurance/assurance-order-domain";
import { completeSubmittedAssessment } from "./assessment-submission-progression-service";
import { AssuranceOrderRepository } from "../assurance/assurance-order-repository";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  AssessmentAttemptAccessError,
  AssessmentAttemptConflictError,
  AssessmentAttemptInputError,
  createAssessmentAnswerId,
  createAssessmentAttemptId,
  normalizeAssessmentAnswer,
  normalizeAssessmentAttemptReference,
  type AssessmentAttemptClientDraft,
  type AssessmentAttemptRecord,
  type AssessmentReviewQuestionView,
  type NormalizedAssessmentAnswer
} from "./assessment-attempt-domain";
import { normalizeAssessmentDraft } from "./assessment-attempt-draft-domain";
import type { AssessmentAccessContext } from "./assessment-device-cookie";
import {
  AssessmentAttemptRepository,
  type AssessmentAttemptDraftSnapshot,
  type OwnedInProgressAssessmentAttempt,
  type OwnedInterruptedAssessmentAttempt,
  type PinnedAssessmentAttemptItem
} from "./assessment-attempt-repository";

export {
  AssessmentAttemptAccessError,
  AssessmentAttemptConflictError,
  AssessmentAttemptInputError
} from "./assessment-attempt-domain";

export type CurrentAssessmentQuestion = Readonly<{
  attemptId: string;
  position: number;
  questionCount: number;
  questionId: string;
  questionVersionId: string;
  questionType: PinnedAssessmentAttemptItem["questionType"];
  prompt: string;
  options: readonly string[] | null;
  domainReference: string;
  difficulty: PinnedAssessmentAttemptItem["difficulty"];
  tags: readonly string[];
}>;

export type AssessmentAttemptView = Readonly<{
  attempt: AssessmentAttemptRecord;
  currentQuestion: CurrentAssessmentQuestion | null;
  currentDraft: AssessmentAttemptClientDraft | null;
  submitted: boolean;
  progressionMode: AssessmentDeliverySettings["progressionMode"];
  reviewablePositions: readonly number[];
  flaggedPositions: readonly number[];
  awaitingSectionAdvance: boolean;
  awaitingFinalSubmit: boolean;
  sectionTitle: string | null;
}>;

type OwnedCaseRow = {
  case_id: string;
  order_id: string;
  tenant_id: string;
  worker_account_id: string;
  case_status: AssuranceCaseStatus;
};

const CASE_ID_PATTERN = /^assurance_case_[A-Za-z0-9_-]{24}$/;
const CATALOGUE_VERSION_ID_PATTERN = /^catalogue_version_[A-Za-z0-9_-]{24}$/;
const QUESTION_VERSION_ID_PATTERN = /^question_version_[A-Za-z0-9_-]{24}$/;
const DRAFT_MUTATION_KEY_PATTERN = /^.{16,160}$/;

async function assertLiveWorker(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  now: Date
): Promise<void> {
  const decision = evaluatePlatformPermission({
    role: principal.activeRole,
    permission: "worker.assessments.read"
  });
  if (
    principal.activeRole !== "worker" ||
    principal.accountStatus !== "active" ||
    !decision.allowed ||
    principal.tenantMembership !== null
  ) {
    throw new AssessmentAttemptAccessError();
  }

  const current = await database.query<{ session_id: string }>(
    `SELECT s.session_id
     FROM auth_sessions s
     JOIN auth_accounts a ON a.account_id=s.account_id
     JOIN auth_account_roles r
       ON r.account_id=a.account_id
      AND r.role='worker'
     WHERE s.session_id=$1
       AND s.account_id=$2
       AND s.active_role='worker'
       AND s.revoked_at IS NULL
       AND s.expires_at > $3
       AND a.account_status='active'
     LIMIT 1`,
    [principal.sessionId, principal.accountId, now.toISOString()]
  );
  if (current.rows[0]?.session_id !== principal.sessionId) {
    throw new AssessmentAttemptAccessError();
  }
}

async function assertAttemptBinding(
  repository: AssessmentAttemptRepository,
  attempt: AssessmentAttemptRecord,
  principal: AuthorizationPrincipal,
  access: AssessmentAccessContext | null | undefined,
  now: Date
): Promise<void> {
  const binding = await repository.findBinding(attempt.attemptId);
  if (!binding) return;
  if (
    !access ||
    binding.workerAccountId !== principal.accountId ||
    binding.deviceTokenHash !== access.deviceTokenHash ||
    binding.securityContextHash !== access.securityContextHash
  ) {
    throw new AssessmentAttemptAccessError(
      "This assessment is bound to another authorized device context."
    );
  }
  if (binding.currentAuthSessionId !== principal.sessionId) {
    await repository.refreshBindingSession({
      attemptId: attempt.attemptId,
      workerAccountId: principal.accountId,
      authSessionId: principal.sessionId,
      now: now.toISOString()
    });
  }
}

function currentQuestion(
  attempt: AssessmentAttemptRecord,
  item: PinnedAssessmentAttemptItem
): CurrentAssessmentQuestion {
  if (item.position !== attempt.currentPosition) {
    throw new AssessmentAttemptConflictError("Assessment question position is inconsistent.");
  }
  return Object.freeze({
    attemptId: attempt.attemptId,
    position: item.position,
    questionCount: attempt.questionCount,
    questionId: item.questionId,
    questionVersionId: item.questionVersionId,
    questionType: item.questionType,
    prompt: item.prompt,
    options: item.options,
    domainReference: item.domainReference,
    difficulty: item.difficulty,
    tags: item.tags
  });
}

function currentDraft(
  draft: AssessmentAttemptDraftSnapshot
): AssessmentAttemptClientDraft {
  return Object.freeze({
    value:
      draft.questionType === "TRUE_FALSE"
        ? draft.value.booleanValue
        : draft.value.textValue,
    revision: draft.revision,
    updatedAt: draft.updatedAt
  });
}

type AssessmentSectionScope = Readonly<{
  index: number;
  title: string;
  startPosition: number;
  endPosition: number;
}>;

function sectionForPosition(
  delivery: AssessmentDeliverySettings,
  position: number
): AssessmentSectionScope | null {
  if (delivery.progressionMode !== "SECTION_REVIEW") return null;
  let startPosition = 1;
  for (const [index, section] of delivery.sections.entries()) {
    if (position <= section.endPosition) {
      return Object.freeze({
        index: index + 1,
        title: section.title,
        startPosition,
        endPosition: section.endPosition
      });
    }
    startPosition = section.endPosition + 1;
  }
  return null;
}

async function view(
  repository: AssessmentAttemptRepository,
  attempt: AssessmentAttemptRecord
): Promise<AssessmentAttemptView> {
  const delivery = await new AssessmentDeliverySettingsService(
    Promise.resolve(repository.database)
  ).get(attempt.blueprintVersionId);

  const flagRows = await repository.database.query<{ position: number | string }>(
    `SELECT position
       FROM assessment_candidate_flags
      WHERE attempt_id=$1 AND worker_account_id=$2 AND flagged=TRUE
      ORDER BY position`,
    [attempt.attemptId, attempt.workerAccountId]
  );
  const flaggedPositions = Object.freeze(flagRows.rows.map((row) => Number(row.position)));

  if (attempt.status === "SUBMITTED") {
    return Object.freeze({
      attempt,
      currentQuestion: null,
      currentDraft: null,
      submitted: true,
      progressionMode: delivery.progressionMode,
      reviewablePositions: Object.freeze([]),
      flaggedPositions,
      awaitingSectionAdvance: false,
      awaitingFinalSubmit: false,
      sectionTitle: null
    });
  }
  if (attempt.status !== "IN_PROGRESS") {
    throw new AssessmentAttemptConflictError("Assessment must be resumed through its recovery workflow.");
  }

  const committedCurrent = await repository.findCommittedAnswer(
    attempt.workerAccountId,
    attempt.attemptId,
    attempt.currentPosition
  );
  const section = sectionForPosition(delivery, attempt.currentPosition);

  const committedPositions = await repository.database.query<{ position: number | string }>(
    `SELECT position
       FROM assessment_attempt_answers
      WHERE attempt_id=$1
      ORDER BY position`,
    [attempt.attemptId]
  );
  let reviewablePositions = committedPositions.rows
    .map((row) => Number(row.position))
    .filter((position) => position <= attempt.currentPosition);

  if (delivery.progressionMode === "STRICT") {
    reviewablePositions = [];
  } else if (delivery.progressionMode === "SECTION_REVIEW") {
    if (!section) {
      throw new AssessmentAttemptConflictError("Assessment section configuration is unavailable.");
    }
    reviewablePositions = reviewablePositions.filter(
      (position) => position >= section.startPosition && position <= section.endPosition
    );
  }

  const frozenReviewable = Object.freeze(reviewablePositions);

  if (committedCurrent) {
    const isFinal = attempt.currentPosition === attempt.questionCount;
    if (isFinal && delivery.progressionMode !== "STRICT") {
      return Object.freeze({
        attempt,
        currentQuestion: null,
        currentDraft: null,
        submitted: false,
        progressionMode: delivery.progressionMode,
        reviewablePositions: frozenReviewable,
        flaggedPositions,
        awaitingSectionAdvance: false,
        awaitingFinalSubmit: true,
        sectionTitle: section?.title ?? null
      });
    }
    if (
      delivery.progressionMode === "SECTION_REVIEW" &&
      section &&
      section.endPosition === attempt.currentPosition
    ) {
      return Object.freeze({
        attempt,
        currentQuestion: null,
        currentDraft: null,
        submitted: false,
        progressionMode: delivery.progressionMode,
        reviewablePositions: frozenReviewable,
        flaggedPositions,
        awaitingSectionAdvance: true,
        awaitingFinalSubmit: false,
        sectionTitle: section.title
      });
    }
    throw new AssessmentAttemptConflictError("Assessment progression state is inconsistent.");
  }

  const item = await repository.loadCurrentPinnedItem(
    attempt.workerAccountId,
    attempt.attemptId
  );
  if (!item) {
    throw new AssessmentAttemptConflictError("The current assessment question is unavailable.");
  }
  const draft = await repository.findCurrentDraft(attempt, item);
  return Object.freeze({
    attempt,
    currentQuestion: currentQuestion(attempt, item),
    currentDraft: draft === null ? null : currentDraft(draft),
    submitted: false,
    progressionMode: delivery.progressionMode,
    reviewablePositions: frozenReviewable,
    flaggedPositions,
    awaitingSectionAdvance: false,
    awaitingFinalSubmit: false,
    sectionTitle: section?.title ?? null
  });
}

function sameNormalizedAnswer(
  left: NormalizedAssessmentAnswer,
  right: NormalizedAssessmentAnswer
): boolean {
  return (
    left.textValue === right.textValue &&
    left.booleanValue === right.booleanValue &&
    left.numericValue === right.numericValue
  );
}

function normalizeDraftExpectedRevision(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AssessmentAttemptInputError("Assessment draft revision is invalid.");
  }
  return value;
}

function normalizeDraftMutationKey(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !DRAFT_MUTATION_KEY_PATTERN.test(value)
  ) {
    throw new AssessmentAttemptInputError("Assessment draft mutation reference is invalid.");
  }
  return value;
}


type ReviewAnswerRow = {
  answer_id: string;
  position: number | string;
  question_type: PinnedAssessmentAttemptItem["questionType"];
  prompt: string;
  options_json: unknown;
  domain_reference: string;
  difficulty: PinnedAssessmentAttemptItem["difficulty"];
  tags_json: unknown;
  text_value: string | null;
  boolean_value: boolean | null;
  numeric_value: number | string | null;
  revision_count: number | string;
  flagged: boolean;
};

function stringArray(value: unknown): readonly string[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      throw new AssessmentAttemptConflictError("Stored assessment question options are invalid.");
    }
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new AssessmentAttemptConflictError("Stored assessment question options are invalid.");
  }
  return Object.freeze([...(parsed as string[])]);
}

function effectiveReviewValue(row: ReviewAnswerRow): string | boolean | number {
  if (row.question_type === "TRUE_FALSE") {
    if (typeof row.boolean_value !== "boolean") {
      throw new AssessmentAttemptConflictError("Stored assessment answer is invalid.");
    }
    return row.boolean_value;
  }
  if (row.question_type === "INTEGER" || row.question_type === "DECIMAL") {
    if (row.numeric_value === null) {
      throw new AssessmentAttemptConflictError("Stored assessment answer is invalid.");
    }
    const numeric = Number(row.numeric_value);
    if (!Number.isFinite(numeric)) {
      throw new AssessmentAttemptConflictError("Stored assessment answer is invalid.");
    }
    return numeric;
  }
  if (row.text_value === null) {
    throw new AssessmentAttemptConflictError("Stored assessment answer is invalid.");
  }
  return row.text_value;
}

async function reviewAnswerRow(
  database: DatabaseClient,
  attemptId: string,
  position: number
): Promise<ReviewAnswerRow | null> {
  const result = await database.query<ReviewAnswerRow>(
    `SELECT answers.answer_id,answers.position,versions.question_type,versions.prompt,
            versions.options_json,versions.domain_reference,versions.difficulty,versions.tags_json,
            COALESCE(latest.text_value,answers.text_value) AS text_value,
            COALESCE(latest.boolean_value,answers.boolean_value) AS boolean_value,
            COALESCE(latest.numeric_value,answers.numeric_value) AS numeric_value,
            COALESCE(latest.revision_no,0) AS revision_count,
            COALESCE(flags.flagged,FALSE) AS flagged
       FROM assessment_attempt_answers AS answers
       JOIN assessment_attempts AS attempts ON attempts.attempt_id=answers.attempt_id
       JOIN generated_assessment_form_items AS items
         ON items.form_id=attempts.form_id AND items.position=answers.position
       JOIN assessment_question_versions AS versions
         ON versions.question_id=items.question_id
        AND versions.question_version_id=items.question_version_id
       LEFT JOIN LATERAL (
         SELECT revisions.revision_no,revisions.text_value,revisions.boolean_value,revisions.numeric_value
           FROM assessment_answer_revisions AS revisions
          WHERE revisions.attempt_id=answers.attempt_id
            AND revisions.answer_id=answers.answer_id
            AND revisions.position=answers.position
          ORDER BY revisions.revision_no DESC
          LIMIT 1
       ) AS latest ON TRUE
       LEFT JOIN assessment_candidate_flags AS flags
         ON flags.attempt_id=answers.attempt_id AND flags.position=answers.position
      WHERE answers.attempt_id=$1 AND answers.position=$2
      LIMIT 1`,
    [attemptId, position]
  );
  return result.rows[0] ?? null;
}

async function assertReviewablePosition(
  database: DatabaseClient,
  attempt: AssessmentAttemptRecord,
  position: number
): Promise<Readonly<{
  delivery: AssessmentDeliverySettings;
  section: AssessmentSectionScope | null;
  row: ReviewAnswerRow;
}>> {
  if (!Number.isSafeInteger(position) || position < 1 || position > attempt.currentPosition) {
    throw new AssessmentAttemptInputError("Review question position is invalid.");
  }
  const delivery = await new AssessmentDeliverySettingsService(
    Promise.resolve(database)
  ).get(attempt.blueprintVersionId);
  if (delivery.progressionMode === "STRICT") {
    throw new AssessmentAttemptAccessError("This assessment uses Strict Progression.");
  }
  const section = sectionForPosition(delivery, attempt.currentPosition);
  if (
    delivery.progressionMode === "SECTION_REVIEW" &&
    (!section || position < section.startPosition || position > section.endPosition)
  ) {
    throw new AssessmentAttemptAccessError(
      "That question belongs to a section that is no longer open for review."
    );
  }
  const row = await reviewAnswerRow(database, attempt.attemptId, position);
  if (!row) {
    throw new AssessmentAttemptConflictError("That question has not been committed yet.");
  }
  return Object.freeze({ delivery, section, row });
}

export class AssessmentAttemptService {
  constructor(private readonly database: DatabaseClient) {}

  async begin(
    principal: AuthorizationPrincipal,
    input: {
      caseId: string;
      catalogueVersionId: string;
      precheckId?: string;
      accessContext?: AssessmentAccessContext;
    },
    now = new Date()
  ): Promise<AssessmentAttemptView> {
    const caseId = input.caseId.trim();
    const catalogueVersionId = input.catalogueVersionId.trim();
    if (
      !CASE_ID_PATTERN.test(caseId) ||
      !CATALOGUE_VERSION_ID_PATTERN.test(catalogueVersionId)
    ) {
      throw new AssessmentAttemptInputError("Assessment selection reference is invalid.");
    }

    return this.database.transaction(async (database) => {
      await assertLiveWorker(database, principal, now);

      const caseResult = await database.query<OwnedCaseRow>(
        `SELECT case_id,order_id,tenant_id,worker_account_id,case_status
         FROM assurance_cases
         WHERE case_id=$1 AND worker_account_id=$2
         FOR UPDATE`,
        [caseId, principal.accountId]
      );
      const assuranceCase = caseResult.rows[0];
      if (!assuranceCase) throw new AssessmentAttemptAccessError();

      const repository = new AssessmentAttemptRepository(database);
      const existing = await repository.findByCaseCatalogueOwned(
        principal.accountId,
        caseId,
        catalogueVersionId
      );
      let replacementAuthorization: {
        authorizationId: string;
        reviewId: string;
        approvedByAccountId: string;
        reason: string;
      } | null = null;

      if (existing) {
        if (existing.status === "IN_PROGRESS") {
          if (assuranceCase.case_status !== "Assessment in progress") {
            throw new AssessmentAttemptConflictError();
          }
          if (input.accessContext) {
            await assertAttemptBinding(repository, existing, principal, input.accessContext, now);
          }
          return view(repository, existing);
        }

        if (existing.status !== "REPLACED" || assuranceCase.case_status !== "Assessment pending") {
          throw new AssessmentAttemptConflictError();
        }

        const authorization = await database.query<{
          authorization_id: string;
          recovery_review_id: string;
          approved_by_account_id: string;
          reason: string;
        }>(
          `SELECT authorization_id,recovery_review_id,approved_by_account_id,reason
             FROM assessment_replacement_authorizations
            WHERE original_attempt_id=$1
              AND status='APPROVED'
              AND replacement_form_id IS NULL
            FOR UPDATE`,
          [existing.attemptId]
        );
        const approved = authorization.rows[0];
        if (!approved) {
          throw new AssessmentAttemptAccessError("No approved replacement is available for this assessment.");
        }
        if (!input.precheckId || !input.accessContext) {
          throw new AssessmentAttemptAccessError(
            "Approved replacement assessments require a fresh pre-assessment check."
          );
        }
        replacementAuthorization = {
          authorizationId: approved.authorization_id,
          reviewId: approved.recovery_review_id,
          approvedByAccountId: approved.approved_by_account_id,
          reason: approved.reason
        };
      } else if (assuranceCase.case_status !== "Assessment pending") {
        throw new AssessmentAttemptAccessError();
      }

      const available = await new AssessmentCatalogueEligibilityService(database)
        .findAvailableForCase(principal, caseId, now);
      const selected = available.find(
        (entry) => entry.catalogueVersionId === catalogueVersionId
      );
      if (!selected) throw new AssessmentAttemptAccessError();

      if (input.precheckId || input.accessContext) {
        if (!input.precheckId || !input.accessContext) {
          throw new AssessmentAttemptAccessError("Assessment precheck context is incomplete.");
        }
        const precheck = await database.query<{ precheck_id: string }>(
          `SELECT precheck_id
             FROM assessment_precheck_records
            WHERE precheck_id=$1
              AND case_id=$2
              AND worker_account_id=$3
              AND catalogue_version_id=$4
              AND blueprint_version_id=$5
              AND auth_session_id=$6
              AND device_token_hash=$7
              AND passed=TRUE
              AND expires_at>$8
            FOR UPDATE`,
          [
            input.precheckId,
            caseId,
            principal.accountId,
            catalogueVersionId,
            selected.blueprintVersionId,
            principal.sessionId,
            input.accessContext.deviceTokenHash,
            now.toISOString()
          ]
        );
        if (!precheck.rows[0]) {
          throw new AssessmentAttemptAccessError("Assessment prechecks have expired or no longer match this assessment.");
        }
      }

      const formGenerator = new AssessmentFormGenerationService(database);
      const form =
        replacementAuthorization && existing
          ? await formGenerator.generateReplacementForCase(
              principal,
              {
                caseId,
                blueprintVersionId: selected.blueprintVersionId,
                replacesFormId: existing.formId
              },
              now
            )
          : await formGenerator.generateForCase(
              principal,
              {
                caseId,
                blueprintVersionId: selected.blueprintVersionId
              },
              now
            );

      const alreadyForForm = await repository.findByForm(principal.accountId, form.formId);
      if (alreadyForForm) return view(repository, alreadyForForm);

      const created = await repository.insertAttempt({
        attemptId: createAssessmentAttemptId(),
        caseId,
        workerAccountId: principal.accountId,
        catalogueVersionId,
        blueprintVersionId: selected.blueprintVersionId,
        formId: form.formId,
        questionCount: form.questionCount,
        now: now.toISOString()
      });
      if (input.accessContext) {
        await repository.insertBinding({
          attemptId: created.attemptId,
          workerAccountId: principal.accountId,
          deviceTokenHash: input.accessContext.deviceTokenHash,
          authSessionId: principal.sessionId,
          securityContextHash: input.accessContext.securityContextHash,
          now: now.toISOString()
        });
      }

      if (replacementAuthorization && existing) {
        const consumed = await database.query(
          `UPDATE assessment_replacement_authorizations
              SET status='CONSUMED',replacement_form_id=$2,consumed_at=$3
            WHERE authorization_id=$1
              AND original_attempt_id=$4
              AND status='APPROVED'
              AND replacement_form_id IS NULL`,
          [
            replacementAuthorization.authorizationId,
            form.formId,
            now.toISOString(),
            existing.attemptId
          ]
        );
        if (consumed.affectedRows !== 1) {
          throw new AssessmentAttemptConflictError("Replacement authorization was already consumed.");
        }
        await database.query(
          `INSERT INTO assessment_attempt_replacements(
             replacement_id,original_attempt_id,replacement_attempt_id,
             original_form_id,replacement_form_id,approved_by_account_id,reason,created_at
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            createIdentifier("assessment_replacement"),
            existing.attemptId,
            created.attemptId,
            existing.formId,
            form.formId,
            replacementAuthorization.approvedByAccountId,
            replacementAuthorization.reason,
            now.toISOString()
          ]
        );
      }

      const transitioned = await database.query(
        `UPDATE assurance_cases
         SET case_status='Assessment in progress',
             owner_kind='worker',
             next_action='Complete the assessment for this Assurance Case.',
             assessment_reference=$3,
             updated_at=$4
         WHERE case_id=$1
           AND worker_account_id=$2
           AND case_status='Assessment pending'`,
        [caseId, principal.accountId, created.attemptId, now.toISOString()]
      );
      if (transitioned.affectedRows !== 1) {
        throw new AssessmentAttemptConflictError();
      }

      await new AssuranceOrderRepository(database).insertTimeline({
        eventId: createAssuranceTimelineEventId(),
        tenantId: assuranceCase.tenant_id,
        orderId: assuranceCase.order_id,
        caseId,
        eventType: "assessment_attempt_started",
        fromStatus: "Assessment pending",
        toStatus: "Assessment in progress",
        owner: "worker",
        nextAction: "Complete the assessment for this Assurance Case.",
        actorAccountId: principal.accountId,
        actorRole: principal.activeRole,
        now: now.toISOString()
      });

      await new DatabaseAuditRepository(Promise.resolve(database)).append(
        bindTrustedAuditActor(principal),
        {
          action: "assessment.attempt.started",
          outcome: "succeeded",
          target: { type: "resource", reference: created.attemptId },
          metadata: {
            caseId,
            catalogueVersionId,
            blueprintVersionId: created.blueprintVersionId,
            formId: created.formId,
            questionCount: created.questionCount,
            replacementOfAttemptId: replacementAuthorization && existing ? existing.attemptId : null
          }
        }
      );
      if (replacementAuthorization && existing) {
        await new DatabaseAuditRepository(Promise.resolve(database)).append(
          bindTrustedAuditActor(principal),
          {
            action: "assessment.attempt.replaced",
            outcome: "succeeded",
            target: { type: "resource", reference: created.attemptId },
            metadata: {
              reviewId: replacementAuthorization.reviewId,
              originalAttemptId: existing.attemptId,
              originalFormId: existing.formId,
              replacementFormId: form.formId,
              caseId
            }
          }
        );
      }

      return view(repository, created);
    });
  }

  async getOwnedView(
    principal: AuthorizationPrincipal,
    attemptReference: string,
    now = new Date(),
    accessContext?: AssessmentAccessContext | null
  ): Promise<AssessmentAttemptView> {
    const attemptId = normalizeAssessmentAttemptReference(attemptReference);
    return this.database.transaction(async (database) => {
      await assertLiveWorker(database, principal, now);
      const repository = new AssessmentAttemptRepository(database);
      const attempt = await repository.findOwned(principal.accountId, attemptId);
      if (!attempt) throw new AssessmentAttemptAccessError();
      await assertAttemptBinding(repository, attempt, principal, accessContext, now);
      return view(repository, attempt);
    });
  }

  async listOwnedInProgress(
    principal: AuthorizationPrincipal,
    now = new Date()
  ): Promise<readonly OwnedInProgressAssessmentAttempt[]> {
    return this.database.transaction(async (database) => {
      await assertLiveWorker(database, principal, now);
      return new AssessmentAttemptRepository(database).listOwnedInProgress(
        principal.accountId
      );
    });
  }

  async listOwnedInterrupted(
    principal: AuthorizationPrincipal,
    now = new Date()
  ): Promise<readonly OwnedInterruptedAssessmentAttempt[]> {
    return this.database.transaction(async (database) => {
      await assertLiveWorker(database, principal, now);
      return new AssessmentAttemptRepository(database).listOwnedInterrupted(
        principal.accountId
      );
    });
  }

  async interrupt(
    principal: AuthorizationPrincipal,
    attemptReference: string,
    accessContext: AssessmentAccessContext | null,
    input: { reason: "emergency_exit" | "connection_lost" | "device_changed" | "browser_closed" | "technical_issue" | "permission_lost" | "session_expired"; detail?: string | null },
    now = new Date()
  ): Promise<void> {
    const attemptId = normalizeAssessmentAttemptReference(attemptReference);
    await this.database.transaction(async (database) => {
      await assertLiveWorker(database, principal, now);
      const repository = new AssessmentAttemptRepository(database);
      const attempt = await repository.lockOwned(principal.accountId, attemptId);
      if (!attempt) throw new AssessmentAttemptAccessError();
      await assertAttemptBinding(repository, attempt, principal, accessContext, now);
      if (attempt.status === "INTERRUPTED") return;
      if (attempt.status !== "IN_PROGRESS") throw new AssessmentAttemptConflictError();
      const interrupted = await repository.markInterrupted({
        workerAccountId: principal.accountId,
        attemptId,
        reason: input.reason,
        detail: input.detail?.trim().slice(0, 1000) || null,
        now: now.toISOString()
      });
      if (!interrupted) throw new AssessmentAttemptConflictError();
      await new DatabaseAuditRepository(Promise.resolve(database)).append(
        bindTrustedAuditActor(principal),
        {
          action: "assessment.attempt.interrupted",
          outcome: "succeeded",
          target: { type: "resource", reference: attemptId },
          metadata: {
            caseId: interrupted.caseId,
            reason: input.reason,
            position: interrupted.currentPosition,
            questionCount: interrupted.questionCount
          }
        }
      );
    });
  }

  async resume(
    principal: AuthorizationPrincipal,
    attemptReference: string,
    accessContext: AssessmentAccessContext | null,
    now = new Date()
  ): Promise<AssessmentAttemptView> {
    const attemptId = normalizeAssessmentAttemptReference(attemptReference);
    return this.database.transaction(async (database) => {
      await assertLiveWorker(database, principal, now);
      const repository = new AssessmentAttemptRepository(database);
      const attempt = await repository.lockOwned(principal.accountId, attemptId);
      if (!attempt) throw new AssessmentAttemptAccessError();
      await assertAttemptBinding(repository, attempt, principal, accessContext, now);
      if (attempt.status === "IN_PROGRESS") return view(repository, attempt);
      if (attempt.status !== "INTERRUPTED") throw new AssessmentAttemptConflictError();
      const resumed = await repository.resumeInterrupted({
        workerAccountId: principal.accountId,
        attemptId,
        now: now.toISOString()
      });
      if (!resumed) throw new AssessmentAttemptConflictError();
      await new DatabaseAuditRepository(Promise.resolve(database)).append(
        bindTrustedAuditActor(principal),
        {
          action: "assessment.attempt.resumed",
          outcome: "succeeded",
          target: { type: "resource", reference: attemptId },
          metadata: {
            caseId: resumed.caseId,
            position: resumed.currentPosition,
            questionCount: resumed.questionCount
          }
        }
      );
      return view(repository, resumed);
    });
  }

  async saveCurrentDraft(
    principal: AuthorizationPrincipal,
    input: {
      attemptId: string;
      position: number;
      questionVersionId: string;
      value: unknown;
      expectedRevision: number | null;
      mutationKey: string;
    },
    now = new Date(),
    accessContext?: AssessmentAccessContext | null
  ): Promise<AssessmentAttemptDraftSnapshot> {
    const attemptId = normalizeAssessmentAttemptReference(input.attemptId);
    if (!Number.isSafeInteger(input.position) || input.position < 1) {
      throw new AssessmentAttemptInputError("Assessment position is invalid.");
    }
    const questionVersionId = input.questionVersionId.trim();
    if (!QUESTION_VERSION_ID_PATTERN.test(questionVersionId)) {
      throw new AssessmentAttemptInputError("Assessment question reference is invalid.");
    }
    const expectedRevision = normalizeDraftExpectedRevision(input.expectedRevision);
    const mutationKey = normalizeDraftMutationKey(input.mutationKey);

    return this.database.transaction(async (database) => {
      await assertLiveWorker(database, principal, now);
      const repository = new AssessmentAttemptRepository(database);
      const locked = await repository.lockOwned(principal.accountId, attemptId);
      if (!locked) throw new AssessmentAttemptAccessError();
      await assertAttemptBinding(repository, locked, principal, accessContext, now);
      if (locked.status !== "IN_PROGRESS") {
        throw new AssessmentAttemptConflictError();
      }

      const item = await repository.loadCurrentPinnedItem(principal.accountId, attemptId);
      if (!item) {
        throw new AssessmentAttemptConflictError("The current assessment question is unavailable.");
      }
      if (
        input.position !== locked.currentPosition ||
        item.position !== locked.currentPosition ||
        questionVersionId !== item.questionVersionId
      ) {
        throw new AssessmentAttemptConflictError();
      }

      const committed = await repository.findCommittedAnswer(
        principal.accountId,
        attemptId,
        locked.currentPosition
      );
      if (committed) {
        throw new AssessmentAttemptConflictError();
      }

      const normalized = normalizeAssessmentDraft(
        item.questionType,
        input.value,
        item.options
      );
      const saved = await repository.saveCurrentDraftCompareAndSwap({
        attempt: locked,
        item,
        value: normalized,
        expectedRevision,
        mutationKey,
        now: now.toISOString()
      });
      if (saved.kind !== "saved") {
        throw new AssessmentAttemptConflictError();
      }
      return saved.draft;
    });
  }

  async submitCurrentAnswer(
    principal: AuthorizationPrincipal,
    input: {
      attemptId: string;
      position: number;
      questionVersionId: string;
      answer: unknown;
    },
    now = new Date(),
    accessContext?: AssessmentAccessContext | null
  ): Promise<AssessmentAttemptView> {
    const attemptId = normalizeAssessmentAttemptReference(input.attemptId);
    if (!Number.isSafeInteger(input.position) || input.position < 1) {
      throw new AssessmentAttemptInputError("Assessment position is invalid.");
    }
    const questionVersionId = input.questionVersionId.trim();
    if (!QUESTION_VERSION_ID_PATTERN.test(questionVersionId)) {
      throw new AssessmentAttemptInputError("Assessment question reference is invalid.");
    }

    return this.database.transaction(async (database) => {
      await assertLiveWorker(database, principal, now);
      const repository = new AssessmentAttemptRepository(database);
      const locked = await repository.lockOwned(principal.accountId, attemptId);
      if (!locked) throw new AssessmentAttemptAccessError();
      await assertAttemptBinding(repository, locked, principal, accessContext, now);

      const committed = await repository.findCommittedAnswer(
        principal.accountId,
        attemptId,
        input.position
      );
      if (committed) {
        if (committed.questionVersionId !== questionVersionId) {
          throw new AssessmentAttemptConflictError();
        }
        const replay = normalizeAssessmentAnswer(
          committed.questionType,
          input.answer,
          committed.options
        );
        if (!sameNormalizedAnswer(committed.value, replay)) {
          throw new AssessmentAttemptConflictError();
        }
        return view(repository, locked);
      }

      if (locked.status !== "IN_PROGRESS") {
        throw new AssessmentAttemptConflictError();
      }

      const item = await repository.loadCurrentPinnedItem(principal.accountId, attemptId);
      if (!item) {
        throw new AssessmentAttemptConflictError("The current assessment question is unavailable.");
      }
      if (
        input.position !== locked.currentPosition ||
        item.position !== locked.currentPosition ||
        questionVersionId !== item.questionVersionId
      ) {
        throw new AssessmentAttemptConflictError();
      }

      const normalized = normalizeAssessmentAnswer(
        item.questionType,
        input.answer,
        item.options
      );
      await repository.insertCommittedAnswer({
        answerId: createAssessmentAnswerId(),
        attempt: locked,
        item,
        value: normalized,
        now: now.toISOString()
      });
      await repository.deleteCurrentDraft(locked, item);

      const delivery = await new AssessmentDeliverySettingsService(
        Promise.resolve(database)
      ).get(locked.blueprintVersionId);

      if (locked.currentPosition < locked.questionCount) {
        const section = sectionForPosition(delivery, locked.currentPosition);
        if (
          delivery.progressionMode === "SECTION_REVIEW" &&
          section?.endPosition === locked.currentPosition
        ) {
          return view(repository, locked);
        }
        const advanced = await repository.advancePosition(
          principal.accountId,
          attemptId,
          locked.currentPosition,
          now.toISOString()
        );
        if (!advanced) throw new AssessmentAttemptConflictError();
        return view(repository, advanced);
      }

      if (delivery.progressionMode !== "STRICT") {
        return view(repository, locked);
      }

      return this.finalizeSubmittedAttempt(
        database,
        repository,
        principal,
        locked,
        now
      );
    });
  }

  async getReviewQuestion(
    principal: AuthorizationPrincipal,
    attemptReference: string,
    position: number,
    accessContext: AssessmentAccessContext | null,
    now = new Date()
  ): Promise<AssessmentReviewQuestionView> {
    const attemptId = normalizeAssessmentAttemptReference(attemptReference);
    return this.database.transaction(async (database) => {
      await assertLiveWorker(database, principal, now);
      const repository = new AssessmentAttemptRepository(database);
      const attempt = await repository.lockOwned(principal.accountId, attemptId);
      if (!attempt || attempt.status !== "IN_PROGRESS") {
        throw new AssessmentAttemptAccessError();
      }
      await assertAttemptBinding(repository, attempt, principal, accessContext, now);
      const { delivery, section, row } = await assertReviewablePosition(
        database,
        attempt,
        position
      );
      return Object.freeze({
        attemptId,
        position,
        questionCount: attempt.questionCount,
        questionType: row.question_type,
        prompt: row.prompt,
        options: row.options_json === null ? null : stringArray(row.options_json),
        domainReference: row.domain_reference,
        difficulty: row.difficulty,
        value: effectiveReviewValue(row),
        flagged: Boolean(row.flagged),
        revisionCount: Number(row.revision_count),
        progressionMode: delivery.progressionMode as "CONTROLLED_REVIEW" | "SECTION_REVIEW",
        sectionTitle: section?.title ?? null
      });
    });
  }

  async reviseCommittedAnswer(
    principal: AuthorizationPrincipal,
    input: {
      attemptId: string;
      position: number;
      answer: unknown;
    },
    accessContext: AssessmentAccessContext | null,
    now = new Date()
  ): Promise<void> {
    const attemptId = normalizeAssessmentAttemptReference(input.attemptId);
    await this.database.transaction(async (database) => {
      await assertLiveWorker(database, principal, now);
      const repository = new AssessmentAttemptRepository(database);
      const attempt = await repository.lockOwned(principal.accountId, attemptId);
      if (!attempt || attempt.status !== "IN_PROGRESS") {
        throw new AssessmentAttemptAccessError();
      }
      await assertAttemptBinding(repository, attempt, principal, accessContext, now);
      const { row } = await assertReviewablePosition(database, attempt, input.position);
      const normalized = normalizeAssessmentAnswer(
        row.question_type,
        input.answer,
        row.options_json === null ? null : stringArray(row.options_json)
      );
      const nextRevision = Number(row.revision_count) + 1;
      await database.query(
        `INSERT INTO assessment_answer_revisions(
           revision_id,attempt_id,answer_id,position,revision_no,
           text_value,boolean_value,numeric_value,revised_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          createIdentifier("assessment_revision"),
          attemptId,
          row.answer_id,
          input.position,
          nextRevision,
          normalized.textValue,
          normalized.booleanValue,
          normalized.numericValue,
          now.toISOString()
        ]
      );
    });
  }

  async setReviewFlag(
    principal: AuthorizationPrincipal,
    input: { attemptId: string; position: number; flagged: boolean },
    accessContext: AssessmentAccessContext | null,
    now = new Date()
  ): Promise<void> {
    const attemptId = normalizeAssessmentAttemptReference(input.attemptId);
    await this.database.transaction(async (database) => {
      await assertLiveWorker(database, principal, now);
      const repository = new AssessmentAttemptRepository(database);
      const attempt = await repository.lockOwned(principal.accountId, attemptId);
      if (!attempt || attempt.status !== "IN_PROGRESS") throw new AssessmentAttemptAccessError();
      await assertAttemptBinding(repository, attempt, principal, accessContext, now);
      await assertReviewablePosition(database, attempt, input.position);
      await database.query(
        `INSERT INTO assessment_candidate_flags(
           flag_id,attempt_id,worker_account_id,position,flagged,created_at
         ) VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(attempt_id,position)
         DO UPDATE SET flagged=EXCLUDED.flagged`,
        [
          createIdentifier("assessment_flag"),
          attemptId,
          principal.accountId,
          input.position,
          input.flagged,
          now.toISOString()
        ]
      );
    });
  }

  async advanceSection(
    principal: AuthorizationPrincipal,
    attemptReference: string,
    accessContext: AssessmentAccessContext | null,
    now = new Date()
  ): Promise<AssessmentAttemptView> {
    const attemptId = normalizeAssessmentAttemptReference(attemptReference);
    return this.database.transaction(async (database) => {
      await assertLiveWorker(database, principal, now);
      const repository = new AssessmentAttemptRepository(database);
      const attempt = await repository.lockOwned(principal.accountId, attemptId);
      if (!attempt || attempt.status !== "IN_PROGRESS") throw new AssessmentAttemptAccessError();
      await assertAttemptBinding(repository, attempt, principal, accessContext, now);
      const delivery = await new AssessmentDeliverySettingsService(
        Promise.resolve(database)
      ).get(attempt.blueprintVersionId);
      const section = sectionForPosition(delivery, attempt.currentPosition);
      if (
        delivery.progressionMode !== "SECTION_REVIEW" ||
        !section ||
        section.endPosition !== attempt.currentPosition ||
        attempt.currentPosition >= attempt.questionCount
      ) {
        throw new AssessmentAttemptConflictError("This assessment is not at a section review gate.");
      }
      const committed = await repository.findCommittedAnswer(
        principal.accountId,
        attemptId,
        attempt.currentPosition
      );
      if (!committed) throw new AssessmentAttemptConflictError();
      await database.query(
        `INSERT INTO assessment_section_locks(
           attempt_id,section_index,start_position,end_position,locked_at
         ) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(attempt_id,section_index) DO NOTHING`,
        [
          attemptId,
          section.index,
          section.startPosition,
          section.endPosition,
          now.toISOString()
        ]
      );
      const advanced = await repository.advancePosition(
        principal.accountId,
        attemptId,
        attempt.currentPosition,
        now.toISOString()
      );
      if (!advanced) throw new AssessmentAttemptConflictError();
      return view(repository, advanced);
    });
  }

  async finalizeAssessment(
    principal: AuthorizationPrincipal,
    attemptReference: string,
    accessContext: AssessmentAccessContext | null,
    now = new Date()
  ): Promise<AssessmentAttemptView> {
    const attemptId = normalizeAssessmentAttemptReference(attemptReference);
    return this.database.transaction(async (database) => {
      await assertLiveWorker(database, principal, now);
      const repository = new AssessmentAttemptRepository(database);
      const attempt = await repository.lockOwned(principal.accountId, attemptId);
      if (!attempt || attempt.status !== "IN_PROGRESS") throw new AssessmentAttemptAccessError();
      await assertAttemptBinding(repository, attempt, principal, accessContext, now);
      const delivery = await new AssessmentDeliverySettingsService(
        Promise.resolve(database)
      ).get(attempt.blueprintVersionId);
      if (delivery.progressionMode === "STRICT") {
        throw new AssessmentAttemptConflictError("Strict Progression submits with the final answer.");
      }
      const count = await database.query<{ count: number | string }>(
        "SELECT count(*) AS count FROM assessment_attempt_answers WHERE attempt_id=$1",
        [attemptId]
      );
      if (Number(count.rows[0]?.count ?? 0) !== attempt.questionCount) {
        throw new AssessmentAttemptConflictError("Every assessment question must be answered before final submission.");
      }
      if (delivery.progressionMode === "SECTION_REVIEW") {
        const section = sectionForPosition(delivery, attempt.currentPosition);
        if (!section || section.endPosition !== attempt.questionCount) {
          throw new AssessmentAttemptConflictError("Final assessment section is inconsistent.");
        }
        await database.query(
          `INSERT INTO assessment_section_locks(
             attempt_id,section_index,start_position,end_position,locked_at
           ) VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(attempt_id,section_index) DO NOTHING`,
          [attemptId,section.index,section.startPosition,section.endPosition,now.toISOString()]
        );
      }
      return this.finalizeSubmittedAttempt(database, repository, principal, attempt, now);
    });
  }

  private async finalizeSubmittedAttempt(
    database: DatabaseClient,
    repository: AssessmentAttemptRepository,
    principal: AuthorizationPrincipal,
    attempt: AssessmentAttemptRecord,
    now: Date
  ): Promise<AssessmentAttemptView> {
    const submitted = await repository.markSubmitted(
      principal.accountId,
      attempt.attemptId,
      attempt.currentPosition,
      now.toISOString()
    );
    if (!submitted) throw new AssessmentAttemptConflictError();

    const caseResult = await database.query<OwnedCaseRow>(
      `SELECT case_id,order_id,tenant_id,worker_account_id,case_status
         FROM assurance_cases
        WHERE case_id=$1 AND worker_account_id=$2
        LIMIT 1`,
      [submitted.caseId, principal.accountId]
    );
    const assuranceCase = caseResult.rows[0];
    if (!assuranceCase || assuranceCase.case_status !== "Assessment in progress") {
      throw new AssessmentAttemptConflictError();
    }

    await new AssuranceOrderRepository(database).insertTimeline({
      eventId: createAssuranceTimelineEventId(),
      tenantId: assuranceCase.tenant_id,
      orderId: assuranceCase.order_id,
      caseId: submitted.caseId,
      eventType: "assessment_attempt_submitted",
      fromStatus: "Assessment in progress",
      toStatus: "Assessment in progress",
      owner: "worker",
      nextAction: null,
      actorAccountId: principal.accountId,
      actorRole: principal.activeRole,
      now: now.toISOString()
    });

    await new DatabaseAuditRepository(Promise.resolve(database)).append(
      bindTrustedAuditActor(principal),
      {
        action: "assessment.attempt.submitted",
        outcome: "succeeded",
        target: { type: "resource", reference: submitted.attemptId },
        metadata: {
          caseId: submitted.caseId,
          catalogueVersionId: submitted.catalogueVersionId,
          blueprintVersionId: submitted.blueprintVersionId,
          formId: submitted.formId,
          position: submitted.currentPosition,
          questionCount: submitted.questionCount
        }
      }
    );

    await completeSubmittedAssessment(database, {
      caseId: submitted.caseId,
      attemptId: submitted.attemptId,
      blueprintVersionId: submitted.blueprintVersionId,
      actor: { accountId: principal.accountId, role: principal.activeRole },
      now
    });

    return view(repository, submitted);
  }
}

let service: AssessmentAttemptService | null = null;

export async function getAssessmentAttemptService(): Promise<AssessmentAttemptService> {
  service ??= new AssessmentAttemptService(await getDatabaseClient());
  return service;
}