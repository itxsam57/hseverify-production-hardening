import "server-only";

import { createIdentifier } from "@/lib/auth/auth-domain";
import type { AuthorizationPrincipal } from "@/lib/authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "@/lib/audit/audit-domain";
import { DatabaseAuditRepository } from "@/lib/audit/audit-repository";
import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";
import { AssessmentAttemptRepository } from "@/lib/assessment-attempt/assessment-attempt-repository";
import { normalizeAssessmentAttemptReference } from "@/lib/assessment-attempt/assessment-attempt-domain";

export type AssessmentRecoveryReviewStatus =
  | "QUEUED"
  | "CLAIMED"
  | "APPROVED_REPLACEMENT"
  | "RESUME_ALLOWED";

export type AssessmentRecoveryQueueItem = Readonly<{
  reviewId: string;
  attemptId: string;
  caseId: string;
  workerAccountId: string;
  workerName: string;
  catalogueTitle: string;
  currentPosition: number;
  questionCount: number;
  requestReason: string;
  interruptionReason: string | null;
  interruptedAt: string | null;
  status: AssessmentRecoveryReviewStatus;
  claimedByAccountId: string | null;
  claimedByName: string | null;
  createdAt: string;
}>;

export class AssessmentRecoveryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssessmentRecoveryInputError";
  }
}

export class AssessmentRecoveryAccessError extends Error {
  constructor(message = "Assessment recovery could not be accessed.") {
    super(message);
    this.name = "AssessmentRecoveryAccessError";
  }
}

export class AssessmentRecoveryConflictError extends Error {
  constructor(message = "Assessment recovery state changed. Reload and try again.") {
    super(message);
    this.name = "AssessmentRecoveryConflictError";
  }
}

function reason(value: string, label: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 10 || normalized.length > 2000) {
    throw new AssessmentRecoveryInputError(`${label} must contain between 10 and 2000 characters.`);
  }
  return normalized;
}

function assertWorker(principal: AuthorizationPrincipal): void {
  if (
    principal.activeRole !== "worker" ||
    principal.accountStatus !== "active" ||
    principal.tenantMembership !== null
  ) {
    throw new AssessmentRecoveryAccessError();
  }
}

function assertVerifier(principal: AuthorizationPrincipal): void {
  if (principal.activeRole !== "verifier" || principal.accountStatus !== "active") {
    throw new AssessmentRecoveryAccessError();
  }
}

function iso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class AssessmentRecoveryService {
  constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async requestReview(
    principal: AuthorizationPrincipal,
    attemptReference: string,
    requestReason: string,
    now = new Date()
  ): Promise<string> {
    assertWorker(principal);
    const attemptId = normalizeAssessmentAttemptReference(attemptReference);
    const normalizedReason = reason(requestReason, "Recovery reason");
    const database = await this.databasePromise;

    return database.transaction(async (tx) => {
      const repository = new AssessmentAttemptRepository(tx);
      const attempt = await repository.lockOwned(principal.accountId, attemptId);
      if (!attempt) throw new AssessmentRecoveryAccessError();

      const existing = await tx.query<{ review_id: string; review_status: AssessmentRecoveryReviewStatus }>(
        `SELECT review_id,review_status
           FROM assessment_recovery_reviews
          WHERE attempt_id=$1
          FOR UPDATE`,
        [attemptId]
      );
      if (existing.rows[0]) return existing.rows[0].review_id;

      if (attempt.status !== "INTERRUPTED") {
        throw new AssessmentRecoveryConflictError(
          "Only an interrupted assessment can be sent for recovery review."
        );
      }

      const changed = await repository.markReviewRequired(
        principal.accountId,
        attemptId,
        now.toISOString()
      );
      if (!changed) throw new AssessmentRecoveryConflictError();

      const reviewId = createIdentifier("assessment_recovery");
      await tx.query(
        `INSERT INTO assessment_recovery_reviews(
           review_id,attempt_id,worker_account_id,request_reason,review_status,created_at
         ) VALUES($1,$2,$3,$4,'QUEUED',$5)`,
        [reviewId, attemptId, principal.accountId, normalizedReason, now.toISOString()]
      );

      const caseUpdate = await tx.query(
        `UPDATE assurance_cases
            SET case_status='Review pending',
                owner_kind='reviewer',
                next_action='Verifier must review the interrupted assessment recovery request.',
                updated_at=$3
          WHERE case_id=$1
            AND worker_account_id=$2
            AND case_status='Assessment in progress'`,
        [attempt.caseId, principal.accountId, now.toISOString()]
      );
      if (caseUpdate.affectedRows !== 1) {
        throw new AssessmentRecoveryConflictError("Assurance Case is not in the expected assessment state.");
      }

      await new DatabaseAuditRepository(Promise.resolve(tx)).append(
        bindTrustedAuditActor(principal),
        {
          action: "assessment.recovery.requested",
          outcome: "succeeded",
          target: { type: "resource", reference: reviewId },
          metadata: {
            attemptId,
            caseId: attempt.caseId,
            position: attempt.currentPosition,
            questionCount: attempt.questionCount
          }
        }
      );
      return reviewId;
    });
  }

  async listQueue(
    principal: AuthorizationPrincipal
  ): Promise<readonly AssessmentRecoveryQueueItem[]> {
    assertVerifier(principal);
    const database = await this.databasePromise;
    const result = await database.query<{
      review_id: string;
      attempt_id: string;
      case_id: string;
      worker_account_id: string;
      worker_name: string;
      catalogue_title: string;
      current_position: number | string;
      question_count: number | string;
      request_reason: string;
      interruption_reason: string | null;
      interrupted_at: string | Date | null;
      review_status: AssessmentRecoveryReviewStatus;
      claimed_by_account_id: string | null;
      claimed_by_name: string | null;
      created_at: string | Date;
    }>(
      `SELECT reviews.review_id,reviews.attempt_id,attempts.case_id,reviews.worker_account_id,
              worker.display_name AS worker_name,catalogue.title AS catalogue_title,
              attempts.current_position,attempts.question_count,reviews.request_reason,
              interruption.reason AS interruption_reason,
              interruption.occurred_at AS interrupted_at,
              reviews.review_status,reviews.claimed_by_account_id,
              claimant.display_name AS claimed_by_name,reviews.created_at
         FROM assessment_recovery_reviews AS reviews
         JOIN assessment_attempts AS attempts ON attempts.attempt_id=reviews.attempt_id
         JOIN auth_accounts AS worker ON worker.account_id=reviews.worker_account_id
         JOIN assessment_catalogue_versions AS catalogue
           ON catalogue.catalogue_version_id=attempts.catalogue_version_id
         LEFT JOIN auth_accounts AS claimant ON claimant.account_id=reviews.claimed_by_account_id
         LEFT JOIN LATERAL (
           SELECT reason,occurred_at
             FROM assessment_interruption_events
            WHERE attempt_id=reviews.attempt_id
            ORDER BY occurred_at DESC,interruption_id DESC
            LIMIT 1
         ) AS interruption ON TRUE
        WHERE reviews.review_status IN ('QUEUED','CLAIMED')
          AND (
            reviews.claimed_by_account_id IS NULL OR
            reviews.claimed_by_account_id=$1
          )
        ORDER BY
          CASE WHEN reviews.claimed_by_account_id=$1 THEN 0 ELSE 1 END,
          reviews.created_at,
          reviews.review_id`,
      [principal.accountId]
    );
    return Object.freeze(result.rows.map((row) => Object.freeze({
      reviewId: row.review_id,
      attemptId: row.attempt_id,
      caseId: row.case_id,
      workerAccountId: row.worker_account_id,
      workerName: row.worker_name,
      catalogueTitle: row.catalogue_title,
      currentPosition: Number(row.current_position),
      questionCount: Number(row.question_count),
      requestReason: row.request_reason,
      interruptionReason: row.interruption_reason,
      interruptedAt: iso(row.interrupted_at),
      status: row.review_status,
      claimedByAccountId: row.claimed_by_account_id,
      claimedByName: row.claimed_by_name,
      createdAt: iso(row.created_at) ?? new Date(0).toISOString()
    })));
  }

  async claim(
    principal: AuthorizationPrincipal,
    reviewIdInput: string,
    now = new Date()
  ): Promise<void> {
    assertVerifier(principal);
    const reviewId = reviewIdInput.trim();
    if (!/^assessment_recovery_[A-Za-z0-9_-]{24}$/.test(reviewId)) {
      throw new AssessmentRecoveryInputError("Recovery review reference is invalid.");
    }
    const database = await this.databasePromise;
    await database.transaction(async (tx) => {
      const row = await tx.query<{ worker_account_id: string; review_status: AssessmentRecoveryReviewStatus }>(
        `SELECT worker_account_id,review_status
           FROM assessment_recovery_reviews
          WHERE review_id=$1
          FOR UPDATE`,
        [reviewId]
      );
      const review = row.rows[0];
      if (!review || review.worker_account_id === principal.accountId) {
        throw new AssessmentRecoveryAccessError();
      }
      if (review.review_status !== "QUEUED") {
        throw new AssessmentRecoveryConflictError();
      }
      const result = await tx.query(
        `UPDATE assessment_recovery_reviews
            SET review_status='CLAIMED',claimed_by_account_id=$2,claimed_at=$3
          WHERE review_id=$1 AND review_status='QUEUED'`,
        [reviewId, principal.accountId, now.toISOString()]
      );
      if (result.affectedRows !== 1) throw new AssessmentRecoveryConflictError();
    });
  }

  async decide(
    principal: AuthorizationPrincipal,
    reviewIdInput: string,
    decision: "APPROVE_REPLACEMENT" | "ALLOW_RESUME",
    decisionReason: string,
    now = new Date()
  ): Promise<void> {
    assertVerifier(principal);
    const reviewId = reviewIdInput.trim();
    if (!/^assessment_recovery_[A-Za-z0-9_-]{24}$/.test(reviewId)) {
      throw new AssessmentRecoveryInputError("Recovery review reference is invalid.");
    }
    if (decision !== "APPROVE_REPLACEMENT" && decision !== "ALLOW_RESUME") {
      throw new AssessmentRecoveryInputError("Recovery decision is invalid.");
    }
    const normalizedReason = reason(decisionReason, "Decision reason");
    const database = await this.databasePromise;

    await database.transaction(async (tx) => {
      const reviewResult = await tx.query<{
        attempt_id: string;
        worker_account_id: string;
        review_status: AssessmentRecoveryReviewStatus;
        claimed_by_account_id: string | null;
      }>(
        `SELECT attempt_id,worker_account_id,review_status,claimed_by_account_id
           FROM assessment_recovery_reviews
          WHERE review_id=$1
          FOR UPDATE`,
        [reviewId]
      );
      const review = reviewResult.rows[0];
      if (
        !review ||
        review.worker_account_id === principal.accountId ||
        review.review_status !== "CLAIMED" ||
        review.claimed_by_account_id !== principal.accountId
      ) {
        throw new AssessmentRecoveryAccessError();
      }

      const repository = new AssessmentAttemptRepository(tx);
      const attempt = await repository.lockOwned(review.worker_account_id, review.attempt_id);
      if (!attempt || attempt.status !== "REVIEW_REQUIRED") {
        throw new AssessmentRecoveryConflictError();
      }

      if (decision === "APPROVE_REPLACEMENT") {
        const replaced = await repository.markReplaced(
          review.worker_account_id,
          review.attempt_id,
          now.toISOString()
        );
        if (!replaced) throw new AssessmentRecoveryConflictError();

        const authorizationId = createIdentifier("replacement_auth");
        await tx.query(
          `INSERT INTO assessment_replacement_authorizations(
             authorization_id,recovery_review_id,original_attempt_id,
             approved_by_account_id,reason,status,created_at
           ) VALUES($1,$2,$3,$4,$5,'APPROVED',$6)`,
          [
            authorizationId,
            reviewId,
            review.attempt_id,
            principal.accountId,
            normalizedReason,
            now.toISOString()
          ]
        );
        await tx.query(
          `UPDATE assessment_recovery_reviews
              SET review_status='APPROVED_REPLACEMENT',
                  decision_reason=$2,decided_at=$3
            WHERE review_id=$1`,
          [reviewId, normalizedReason, now.toISOString()]
        );
        const caseUpdate = await tx.query(
          `UPDATE assurance_cases
              SET case_status='Assessment pending',
                  owner_kind='worker',
                  next_action='Complete pre-assessment checks for the approved replacement assessment.',
                  assessment_reference=NULL,
                  updated_at=$3
            WHERE case_id=$1 AND worker_account_id=$2 AND case_status='Review pending'`,
          [attempt.caseId, review.worker_account_id, now.toISOString()]
        );
        if (caseUpdate.affectedRows !== 1) throw new AssessmentRecoveryConflictError();

        await new DatabaseAuditRepository(Promise.resolve(tx)).append(
          bindTrustedAuditActor(principal),
          {
            action: "assessment.replacement.approved",
            outcome: "succeeded",
            target: { type: "resource", reference: authorizationId },
            metadata: {
              reviewId,
              originalAttemptId: review.attempt_id,
              caseId: attempt.caseId
            }
          }
        );
        return;
      }

      const resumedState = await tx.query(
        `UPDATE assessment_attempts
            SET status='INTERRUPTED',updated_at=$3
          WHERE attempt_id=$1 AND worker_account_id=$2 AND status='REVIEW_REQUIRED'`,
        [review.attempt_id, review.worker_account_id, now.toISOString()]
      );
      if (resumedState.affectedRows !== 1) throw new AssessmentRecoveryConflictError();

      await tx.query(
        `UPDATE assessment_recovery_reviews
            SET review_status='RESUME_ALLOWED',
                decision_reason=$2,decided_at=$3
          WHERE review_id=$1`,
        [reviewId, normalizedReason, now.toISOString()]
      );
      const caseUpdate = await tx.query(
        `UPDATE assurance_cases
            SET case_status='Assessment in progress',
                owner_kind='worker',
                next_action='Resume the interrupted assessment from its bound device context.',
                assessment_reference=$3,
                updated_at=$4
          WHERE case_id=$1 AND worker_account_id=$2 AND case_status='Review pending'`,
        [attempt.caseId, review.worker_account_id, review.attempt_id, now.toISOString()]
      );
      if (caseUpdate.affectedRows !== 1) throw new AssessmentRecoveryConflictError();
    });
  }
}

let service: AssessmentRecoveryService | null = null;
export function getAssessmentRecoveryService(): AssessmentRecoveryService {
  service ??= new AssessmentRecoveryService();
  return service;
}
