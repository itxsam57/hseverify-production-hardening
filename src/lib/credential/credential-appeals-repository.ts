import "server-only";

import { getDatabaseClient } from "../database/database";
import type { DatabaseClient } from "../database/database";
import { CredentialAppealReviewAuthorizationError } from "./credential-appeals-domain";
import type { AppealOutcomeAction, CredentialAppeal } from "./credential-appeals-domain";

type AppealRow = {
  appeal_id: string;
  credential_id: string;
  worker_id: string;
  reason: string;
  evidence: unknown;
  status: CredentialAppeal["status"];
  version: number;
  created_at: string;
  reviewer_account_id: string | null;
  review_reason: string | null;
  outcome_action: AppealOutcomeAction | null;
  reviewed_at: string | null;
};

function evidence(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapAppeal(row: AppealRow): CredentialAppeal {
  return Object.freeze({
    appealId: row.appeal_id,
    credentialId: row.credential_id,
    workerId: row.worker_id,
    reason: row.reason,
    evidence: Object.freeze(evidence(row.evidence)),
    status: row.status,
    version: Number(row.version),
    createdAt: new Date(row.created_at).toISOString(),
    reviewerAccountId: row.reviewer_account_id,
    reviewReason: row.review_reason,
    outcomeAction: row.outcome_action,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null
  });
}

const SELECT = `SELECT appeal_id,credential_id,worker_id,reason,evidence,status,version,created_at,
                       reviewer_account_id,review_reason,outcome_action,reviewed_at
                  FROM credential_appeals`;

export class CredentialAppealsRepository {
  constructor(private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  // Account IDs and permanent Worker IDs are different namespaces. Resolve both
  // ownership and decision provenance at the persisted boundary before review.
  async assertIndependentReviewer(appeal: CredentialAppeal, reviewerId: string): Promise<void> {
    const client = await this.clientPromise;
    if (!reviewerId || reviewerId !== reviewerId.trim()) {
      throw new CredentialAppealReviewAuthorizationError("An authenticated independent reviewer is required.");
    }
    const account = await client.query<{ worker_reference: string | null }>(
      `SELECT account.worker_reference FROM auth_accounts account
        WHERE account.account_id=$1 AND account.account_status='active'
          AND EXISTS (SELECT 1 FROM auth_account_roles role
                       WHERE role.account_id=account.account_id AND role.role='admin')
        FOR SHARE OF account`,
      [reviewerId]
    );
    if (account.rows.length !== 1) throw new CredentialAppealReviewAuthorizationError("An authorized authenticated reviewer is required.");
    if (reviewerId === appeal.workerId || account.rows[0].worker_reference === appeal.workerId) {
      throw new CredentialAppealReviewAuthorizationError("Appeal requires an independent reviewer of its own credential.");
    }
    const source = await client.query<{ worker_account_id: string; permanent_worker_id: string }>(
      `SELECT cases.worker_account_id,cases.permanent_worker_id
         FROM assurance_cases cases JOIN credential_issuances credential
           ON credential.credential_id=cases.credential_reference
          AND credential.worker_id=cases.permanent_worker_id
        WHERE cases.credential_reference=$1 AND credential.worker_id=$2
        FOR SHARE OF cases,credential`,
      [appeal.credentialId, appeal.workerId]
    );
    if (source.rows.length !== 1) throw new CredentialAppealReviewAuthorizationError("Independent review requires valid credential ownership provenance.");
    if (source.rows[0].worker_account_id === reviewerId) {
      throw new CredentialAppealReviewAuthorizationError("Appeal requires an independent reviewer of its own credential.");
    }
    const conflict = await client.query(
      `SELECT 1 FROM assurance_case_timeline_events event JOIN assurance_cases cases
           ON cases.case_id=event.case_id AND cases.tenant_id=event.tenant_id
        WHERE cases.credential_reference=$1 AND event.actor_account_id=$2
          AND event.event_type IN ('decision_recorded','decision_override_applied')
        LIMIT 1`,
      [appeal.credentialId, reviewerId]
    );
    if (conflict.rows.length) throw new CredentialAppealReviewAuthorizationError("Appeal requires an independent reviewer outside the original decision.");
  }

  async save(appeal: CredentialAppeal) {
    const client = await this.clientPromise;
    await client.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO credential_appeals (
           appeal_id,credential_id,worker_id,reason,evidence,status,version,created_at,updated_at,
           reviewer_account_id,review_reason,outcome_action,reviewed_at
         ) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$8,$9,$10,$11,$12)`,
        [
          appeal.appealId,
          appeal.credentialId,
          appeal.workerId,
          appeal.reason,
          JSON.stringify(appeal.evidence),
          appeal.status,
          appeal.version,
          appeal.createdAt,
          appeal.reviewerAccountId,
          appeal.reviewReason,
          appeal.outcomeAction,
          appeal.reviewedAt
        ]
      );
      await transaction.query(
        `INSERT INTO credential_appeal_events(
           appeal_id,version,status,changed_at,reviewer_account_id,review_reason,outcome_action
         ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          appeal.appealId,
          appeal.version,
          appeal.status,
          appeal.createdAt,
          appeal.reviewerAccountId,
          appeal.reviewReason,
          appeal.outcomeAction
        ]
      );
    });
    return appeal;
  }

  async updateStatus(appeal: CredentialAppeal): Promise<CredentialAppeal> {
    const client = await this.clientPromise;
    const changedAt = appeal.reviewedAt ?? new Date().toISOString();
    await client.transaction(async (transaction) => {
      const result = await transaction.query<{ appeal_id: string }>(
        `UPDATE credential_appeals
            SET status=$2,version=$3,updated_at=$4,
                reviewer_account_id=$5,review_reason=$6,outcome_action=$7,reviewed_at=$8
          WHERE appeal_id=$1 AND version=$9
          RETURNING appeal_id`,
        [
          appeal.appealId,
          appeal.status,
          appeal.version,
          changedAt,
          appeal.reviewerAccountId,
          appeal.reviewReason,
          appeal.outcomeAction,
          appeal.reviewedAt,
          appeal.version - 1
        ]
      );
      if (result.rows.length !== 1) throw new Error("Appeal update conflict.");
      await transaction.query(
        `INSERT INTO credential_appeal_events(
           appeal_id,version,status,changed_at,reviewer_account_id,review_reason,outcome_action
         ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          appeal.appealId,
          appeal.version,
          appeal.status,
          changedAt,
          appeal.reviewerAccountId,
          appeal.reviewReason,
          appeal.outcomeAction
        ]
      );
    });
    return appeal;
  }

  async find(appealId: string): Promise<CredentialAppeal | null> {
    const client = await this.clientPromise;
    const result = await client.query<AppealRow>(
      `${SELECT} WHERE appeal_id=$1`,
      [appealId]
    );
    return result.rows[0] ? mapAppeal(result.rows[0]) : null;
  }

  async listForWorker(workerId: string): Promise<CredentialAppeal[]> {
    const client = await this.clientPromise;
    const result = await client.query<AppealRow>(
      `${SELECT} WHERE worker_id=$1 ORDER BY created_at DESC,appeal_id DESC`,
      [workerId]
    );
    return result.rows.map(mapAppeal);
  }

  async listAll(): Promise<CredentialAppeal[]> {
    const client = await this.clientPromise;
    const result = await client.query<AppealRow>(
      `${SELECT} ORDER BY
         CASE status WHEN 'submitted' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END,
         created_at ASC,appeal_id ASC`
    );
    return result.rows.map(mapAppeal);
  }

  async findOpenForCredential(credentialId: string): Promise<CredentialAppeal | null> {
    const client = await this.clientPromise;
    const result = await client.query<AppealRow>(
      `${SELECT}
         WHERE credential_id=$1 AND status IN ('submitted','under_review')
         ORDER BY created_at DESC LIMIT 1`,
      [credentialId]
    );
    return result.rows[0] ? mapAppeal(result.rows[0]) : null;
  }
}