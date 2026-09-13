import "server-only";
import { createIdentifier } from "../auth/auth-domain";
import type { DatabaseClient } from "../database/database";
import { normalizeWrittenScore, normalizeWrittenScoreDecision } from "./written-scoring-domain";

export class WrittenScoringService {
  constructor(private readonly database: DatabaseClient) {}

  private async requireReviewOwner(reviewId: string, reviewerAccountId: string, tenantId?: string) {
    const result = await this.database.query<{review_id:string}>(
      tenantId
        ? `SELECT review_id FROM written_score_reviews WHERE review_id=$1 AND reviewer_account_id=$2 AND tenant_id=$3 LIMIT 1`
        : `SELECT review_id FROM written_score_reviews WHERE review_id=$1 AND reviewer_account_id=$2 LIMIT 1`,
      tenantId ? [reviewId, reviewerAccountId, tenantId] : [reviewId, reviewerAccountId]
    );
    if (!result.rows[0]) throw new Error("Reviewer does not own this scoring review.");
  }

  private validateIdentity(input: {tenantId: string; caseId: string; attemptId: string; reviewerAccountId: string}) {
    if (!input.tenantId.startsWith("tenant_")) throw new Error("Invalid tenant scope.");
    if (!input.caseId.startsWith("assurance_case_")) throw new Error("Invalid assurance case scope.");
    if (!input.attemptId.trim() || !input.reviewerAccountId.trim()) throw new Error("Missing scoring actor scope.");
  }

  async publish(input: {tenantId:string;caseId:string;attemptId:string;reviewerAccountId:string;rubricVersion:string;score:unknown;decision:unknown;reason:string}) {
    this.validateIdentity(input);
    const score=normalizeWrittenScore(input.score);
    const decision=normalizeWrittenScoreDecision(input.decision);
    const reason=input.reason.trim();
    if (!input.rubricVersion.trim()) throw new Error("Rubric version is required.");
    if(reason.length<5||reason.length>4000) throw new Error("Invalid scoring reason.");
    await this.database.query(`INSERT INTO written_score_reviews(review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,reason,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT')`,[createIdentifier("written_score"),input.tenantId,input.caseId,input.attemptId,input.reviewerAccountId,input.rubricVersion,score,decision,reason]);
  }

  async addCalibration(input: {reviewId:string;reviewerAccountId:string;tenantId:string;note:string}) {
    if (!input.reviewId.startsWith("written_score_")) throw new Error("Invalid review scope.");
    if (!input.reviewerAccountId.trim()) throw new Error("Missing reviewer scope.");
    const note = input.note.trim();
    if (note.length < 5 || note.length > 4000) throw new Error("Invalid calibration note.");
    await this.requireReviewOwner(input.reviewId, input.reviewerAccountId, input.tenantId);
    await this.database.query(`INSERT INTO scoring_calibration_events(calibration_id,review_id,reviewer_account_id,calibration_note) VALUES($1,$2,$3,$4)`, [createIdentifier("score_calibration"), input.reviewId, input.reviewerAccountId, note]);
  }

  async addRubricMark(input: {reviewId:string;criterion:string;mark:unknown;reviewerAccountId:string;tenantId:string}) {
    if (!input.reviewId.startsWith("written_score_")) throw new Error("Invalid review scope.");
    if (!input.reviewerAccountId.trim()) throw new Error("Missing reviewer scope.");
    const criterion = input.criterion.trim();
    const mark = normalizeWrittenScore(input.mark);
    if (criterion.length < 2 || criterion.length > 180) throw new Error("Invalid rubric criterion.");
    await this.requireReviewOwner(input.reviewId, input.reviewerAccountId, input.tenantId);
    await this.database.query(`INSERT INTO written_score_rubric_marks(mark_id,review_id,reviewer_account_id,criterion,mark) VALUES($1,$2,$3,$4,$5)`, [createIdentifier("rubric_mark"), input.reviewId, input.reviewerAccountId, criterion, mark]);
  }

  async recordConflict(input: {reviewId:string;reviewerAccountId:string;tenantId:string;reason:string}) {
    if (!input.reviewId.startsWith("written_score_")) throw new Error("Invalid review scope.");
    const reason = input.reason.trim();
    if (!input.reviewerAccountId.trim() || reason.length < 5 || reason.length > 4000) throw new Error("Invalid conflict declaration.");
    await this.requireReviewOwner(input.reviewId, input.reviewerAccountId, input.tenantId);
    await this.database.query(`INSERT INTO scoring_conflict_declarations(conflict_id,review_id,reviewer_account_id,reason) VALUES($1,$2,$3,$4)`, [createIdentifier("score_conflict"), input.reviewId, input.reviewerAccountId, reason]);
  }

  async finalize(input: {reviewId: string; reviewerAccountId: string; tenantId?: string}) {
    if (!input.reviewId.startsWith("written_score_")) throw new Error("Invalid review scope.");
    if (!input.reviewerAccountId.trim()) throw new Error("Missing reviewer scope.");
    await this.requireReviewOwner(input.reviewId, input.reviewerAccountId, input.tenantId);
    const result = await this.database.query(
      `UPDATE written_score_reviews SET status='FINAL' WHERE review_id=$1 AND reviewer_account_id=$2 AND status='DRAFT' AND NOT EXISTS (SELECT 1 FROM scoring_conflict_declarations WHERE review_id=$1 AND reviewer_account_id=$2) RETURNING review_id`,
      [input.reviewId, input.reviewerAccountId]
    );
    if (!result.rows[0]) throw new Error("Review cannot be finalized by this reviewer.");
    const finalReview = await this.database.query(
      `SELECT review_id,status FROM written_score_reviews WHERE review_id=$1 AND reviewer_account_id=$2 AND status='FINAL'`,
      [input.reviewId, input.reviewerAccountId]
    );
    return finalReview.rows[0];
  }

  async amendFinal(input: {reviewId:string; reviewerAccountId:string; tenantId?: string; score:unknown; decision:unknown; reason:string}) {
    if (!input.reviewId.startsWith("written_score_")) throw new Error("Invalid review scope.");
    if (!input.reviewerAccountId.trim()) throw new Error("Missing reviewer scope.");
    const score = normalizeWrittenScore(input.score);
    const decision = normalizeWrittenScoreDecision(input.decision);
    const reason = input.reason.trim();
    if (reason.length < 5 || reason.length > 4000) throw new Error("Invalid amendment reason.");
    const existing = await this.database.query<{tenant_id:string;case_id:string;attempt_id:string;rubric_version:string}>(
      input.tenantId
        ? `SELECT tenant_id,case_id,attempt_id,rubric_version FROM written_score_reviews WHERE review_id=$1 AND reviewer_account_id=$2 AND tenant_id=$3 AND status='FINAL'`
        : `SELECT tenant_id,case_id,attempt_id,rubric_version FROM written_score_reviews WHERE review_id=$1 AND reviewer_account_id=$2 AND status='FINAL'`,
      input.tenantId ? [input.reviewId, input.reviewerAccountId, input.tenantId] : [input.reviewId, input.reviewerAccountId]
    );
    if (!existing.rows[0]) throw new Error("Only the final reviewer may amend a review.");
    await this.database.query(`UPDATE written_score_reviews SET status='SUPERSEDED' WHERE review_id=$1`, [input.reviewId]);
    await this.database.query(`INSERT INTO written_score_reviews(review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,reason,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'FINAL')`, [createIdentifier("written_score"), existing.rows[0].tenant_id, existing.rows[0].case_id, existing.rows[0].attempt_id, input.reviewerAccountId, existing.rows[0].rubric_version, score, decision, reason]);
  }

  async findFinalForAttempt(attemptId:string, tenantId?:string) {
    const result = tenantId
      ? await this.database.query(`SELECT review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,reason,status,created_at FROM written_score_reviews WHERE attempt_id=$1 AND tenant_id=$2 AND status='FINAL'`, [attemptId, tenantId])
      : await this.database.query(`SELECT review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,reason,status,created_at FROM written_score_reviews WHERE attempt_id=$1 AND status='FINAL'`, [attemptId]);
    return result.rows[0] ?? null;
  }

  async listReviewQueue(input: {tenantId:string; reviewerAccountId?:string}) {
    if (!input.tenantId.startsWith("tenant_")) throw new Error("Invalid tenant scope.");
    const result = input.reviewerAccountId
      ? await this.database.query(
          `SELECT review_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,status,created_at
           FROM written_score_reviews
           WHERE tenant_id=$1 AND reviewer_account_id=$2 AND status IN ('DRAFT','FINAL')
           ORDER BY created_at DESC`,
          [input.tenantId, input.reviewerAccountId]
        )
      : await this.database.query(
          `SELECT review_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,status,created_at
           FROM written_score_reviews
           WHERE tenant_id=$1 AND status='DRAFT'
           ORDER BY created_at DESC`,
          [input.tenantId]
        );
    return result.rows;
  }
}
