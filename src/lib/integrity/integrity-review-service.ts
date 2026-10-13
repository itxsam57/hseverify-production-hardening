import "server-only";
import {requireWrittenAttemptEligibility} from "../scoring/written-scoring-authority";
import { createIdentifier } from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";

export async function assessmentRequiresIntegrityReview(database: DatabaseClient, attemptId: string): Promise<boolean> {
  const result = await database.query<{ requires_review: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM integrity_capture_events
       WHERE attempt_id=$1 AND (classification<>'GREEN' OR state='DEGRADED'
         OR provider_state IN ('DEGRADED','UNAVAILABLE'))) AS requires_review`, [attemptId]);
  return result.rows[0]?.requires_review === true;
}

export async function assertIntegrityDispositionClear(database: DatabaseClient, attemptId: string): Promise<void> {
  if (!(await assessmentRequiresIntegrityReview(database, attemptId))) return;
  const result = await database.query<{ disposition: string; reviewed_event_count: number | string; event_count: number | string }>(
    `SELECT dispositions.disposition,dispositions.reviewed_event_count,
            (SELECT COUNT(*) FROM integrity_capture_events WHERE attempt_id=$1) AS event_count
       FROM assessment_integrity_dispositions AS dispositions
      WHERE attempt_id=$1 ORDER BY revision DESC LIMIT 1`, [attemptId]);
  const row = result.rows[0];
  if (!row || row.disposition !== "CLEAR" || Number(row.reviewed_event_count) !== Number(row.event_count)) {
    throw new Error("Integrity concerns require a current reasoned human clearance before this attempt can advance.");
  }
}

export const INTEGRITY_DISPOSITIONS = ["CLEAR", "CONCERN_CONFIRMED", "UNABLE", "ESCALATE"] as const;

async function liveReviewer(database: DatabaseClient, principal: AuthorizationPrincipal): Promise<void> {
  if (principal.activeRole !== "verifier" || principal.accountStatus !== "active" || principal.tenantMembership !== null) throw new Error("Assigned verifier authority is required.");
  const result = await database.query(`SELECT 1 FROM auth_sessions s
    JOIN auth_accounts a ON a.account_id=s.account_id
    JOIN auth_account_roles r ON r.account_id=a.account_id AND r.role='verifier'
    WHERE s.session_id=$1 AND s.account_id=$2 AND s.active_role='verifier'
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND a.account_status='active'
    FOR UPDATE OF s,a`, [principal.sessionId, principal.accountId]);
  if (!result.rows[0]) throw new Error("Assigned verifier authority is no longer current.");
}

export class IntegrityReviewService {
  constructor(private readonly database: DatabaseClient) {}

  async list(principal: AuthorizationPrincipal) {
    return this.database.transaction(async database => {
      await liveReviewer(database,principal);
      const result=await database.query<{review_id:string;attempt_id:string;case_id:string;event_count:number|string;disposition:string|null;reason:string|null}>(
        `SELECT r.review_id,r.attempt_id,r.case_id,COUNT(e.event_id) AS event_count,d.disposition,d.reason
         FROM written_score_reviews r JOIN integrity_capture_events e ON e.attempt_id=r.attempt_id
         LEFT JOIN assessment_integrity_dispositions d ON d.attempt_id=r.attempt_id
         WHERE r.reviewer_account_id=$1 AND r.status IN ('DRAFT','FINAL')
         GROUP BY r.review_id,r.attempt_id,r.case_id,d.disposition,d.reason
         HAVING BOOL_OR(e.classification<>'GREEN' OR e.state='DEGRADED' OR e.provider_state IN ('DEGRADED','UNAVAILABLE'))`,[principal.accountId]);
      return result.rows;
    });
  }

  async resolve(principal: AuthorizationPrincipal, input: {reviewId: string; disposition: string; reason: string; expectedEventCount: number}) {
    const reason = input.reason.trim();
    if (!INTEGRITY_DISPOSITIONS.includes(input.disposition as typeof INTEGRITY_DISPOSITIONS[number]) || reason.length<5 || reason.length>4000 || !Number.isSafeInteger(input.expectedEventCount) || input.expectedEventCount<1) throw new Error("A valid reasoned integrity disposition is required.");
    return this.database.transaction(async (database) => {
      await liveReviewer(database,principal);
      const scope = await database.query<{case_id:string;attempt_id:string;tenant_id:string}>(`SELECT case_id,attempt_id,tenant_id FROM written_score_reviews WHERE review_id=$1 AND reviewer_account_id=$2`, [input.reviewId,principal.accountId]);
      const source=scope.rows[0];
      if (!source) throw new Error("This integrity review is not assigned to you.");
      const cases=await database.query<{owner_kind:string;case_status:string}>(`SELECT owner_kind,case_status FROM assurance_cases WHERE case_id=$1 FOR UPDATE`,[source.case_id]);
      const current=await database.query<{attempt_id:string;status:string}>(`SELECT attempt_id,status FROM assessment_attempts WHERE case_id=$1 ORDER BY created_at DESC,attempt_id DESC LIMIT 1 FOR UPDATE`,[source.case_id]);
      if (cases.rows[0]?.case_status!=="Review pending" || cases.rows[0]?.owner_kind!=="reviewer" || current.rows[0]?.attempt_id!==source.attempt_id || !["SUBMITTED","AUTO_SUBMITTED"].includes(current.rows[0]?.status ?? "")) throw new Error("The integrity review source is no longer current.");
      const review=await database.query(`SELECT 1 FROM written_score_reviews WHERE review_id=$1 AND reviewer_account_id=$2 AND status='DRAFT' AND NOT EXISTS(SELECT 1 FROM scoring_conflict_declarations WHERE review_id=$1 AND reviewer_account_id=$2) FOR UPDATE`,[input.reviewId,principal.accountId]);
      await requireWrittenAttemptEligibility(database,principal.accountId,source.attempt_id,source.case_id,source.tenant_id);
      if (!review.rows[0] || !(await assessmentRequiresIntegrityReview(database,source.attempt_id))) throw new Error("This attempt has no unresolved assigned integrity concern.");
      const count=await database.query<{count:number|string}>(`SELECT COUNT(*) AS count FROM integrity_capture_events WHERE attempt_id=$1`,[source.attempt_id]);
      if (Number(count.rows[0]?.count)!==input.expectedEventCount) throw new Error("Integrity history changed. Reload before deciding.");
      const id=createIdentifier("integrity_disposition");
      await database.query(`INSERT INTO assessment_integrity_dispositions(disposition_id,attempt_id,review_id,case_id,reviewer_account_id,revision,disposition,reason,reviewed_event_count) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)`,[id,source.attempt_id,input.reviewId,source.case_id,principal.accountId,input.disposition,reason,input.expectedEventCount]);
      if (input.disposition!=="CLEAR") {
        await database.query(`UPDATE assurance_cases SET owner_kind='admin',next_action='Admin must review the retained integrity disposition before this case can advance.',updated_at=clock_timestamp() WHERE case_id=$1`,[source.case_id]);
      }
      await liveReviewer(database,principal);
      await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedAuditActor(principal),{action:"assurance_case.status.changed",outcome:"succeeded",target:{type:"resource",reference:source.case_id},metadata:{integrityDispositionId:id,attemptId:source.attempt_id,disposition:input.disposition}});
      return id;
    });
  }
}

export async function currentCaseIntegrityBlocker(database: DatabaseClient, caseId: string): Promise<"admin" | "reviewer" | null> {
  const source=await database.query<{attempt_id:string}>(`SELECT a.attempt_id FROM assurance_cases c JOIN assessment_attempts a ON a.attempt_id=c.assessment_reference AND a.case_id=c.case_id AND a.worker_account_id=c.worker_account_id WHERE c.case_id=$1 AND a.status IN ('SUBMITTED','AUTO_SUBMITTED')`,[caseId]);
  const attemptId=source.rows[0]?.attempt_id;
  if (!attemptId || !(await assessmentRequiresIntegrityReview(database,attemptId))) return null;
  const result=await database.query<{disposition:string;reviewed_event_count:number|string;event_count:number|string}>(`SELECT d.disposition,d.reviewed_event_count,(SELECT COUNT(*) FROM integrity_capture_events WHERE attempt_id=$1) AS event_count FROM assessment_integrity_dispositions d WHERE attempt_id=$1 ORDER BY revision DESC LIMIT 1`,[attemptId]);
  const row=result.rows[0];
  if (!row) return "reviewer";
  if (row.disposition!=="CLEAR") return "admin";
  return Number(row.reviewed_event_count)===Number(row.event_count) ? null : "reviewer";
}
