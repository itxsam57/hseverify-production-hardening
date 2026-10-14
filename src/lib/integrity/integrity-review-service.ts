import "server-only";
import {transitionIntegrityReviewCase} from "../assurance/assurance-case-progression-service";
import {objectiveAssessmentResult} from "../assessment-attempt/assessment-submission-progression-service";
import { requireLiveReviewActor } from "../review/review-calibration-authority";
import { requireRecentSessionMfa } from "../auth/recent-mfa-service";
import { AuthAccessRepository } from "../auth/auth-access-repository";
import {requireWrittenAttemptEligibility} from "../scoring/written-scoring-authority";
import { createIdentifier } from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";

export class IntegrityReviewConflictError extends Error {}
export class IntegrityReviewInputError extends Error {}

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


  async listEscalations(principal: AuthorizationPrincipal) {
    return this.database.transaction(async database=>{
      await requireLiveReviewActor(database,principal,"admin");
      const result=await database.query<{review_id:string;attempt_id:string;case_id:string;worker_name:string;revision:number;disposition:string;reason:string;event_count:number;events:{type:string;classification:string;state:string;providerState:string|null;at:string}[]}>(`SELECT r.review_id,r.attempt_id,r.case_id,a.display_name AS worker_name,d.revision,d.disposition,d.reason,
        (SELECT COUNT(*)::integer FROM integrity_capture_events WHERE attempt_id=r.attempt_id) AS event_count,
        (SELECT jsonb_agg(jsonb_build_object('type',event_type,'classification',classification,'state',state,'providerState',provider_state,'at',occurred_at) ORDER BY occurred_at,event_id) FROM integrity_capture_events WHERE attempt_id=r.attempt_id) AS events
        FROM written_score_reviews r JOIN assurance_cases c ON c.case_id=r.case_id AND c.assessment_reference=r.attempt_id
        JOIN auth_accounts a ON a.account_id=c.worker_account_id
        JOIN LATERAL(SELECT * FROM assessment_integrity_dispositions WHERE attempt_id=r.attempt_id ORDER BY revision DESC LIMIT 1)d ON TRUE
        WHERE r.status='DRAFT' AND c.case_status='Review pending' AND c.owner_kind='admin'
          AND d.disposition IN ('CONCERN_CONFIRMED','UNABLE','ESCALATE') ORDER BY d.created_at LIMIT 250`);
      return result.rows;
    });
  }

  async returnEscalation(principal: AuthorizationPrincipal, input:{reviewId:string;expectedRevision:number;expectedEventCount:number;reason:string}) {
    const reason=input.reason.trim();
    if(reason.length<5 || reason.length>4000 || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision<1 || input.expectedRevision>=2147483647 || !Number.isSafeInteger(input.expectedEventCount) || input.expectedEventCount<1)throw new IntegrityReviewInputError("A valid reason and current integrity history are required.");
    return this.database.transaction(async database=>{
      await requireLiveReviewActor(database,principal,"admin",true);
      const clock=await database.query<{now:string|Date}>("SELECT clock_timestamp() AS now");
      await requireRecentSessionMfa(principal,new AuthAccessRepository(database),new Date(clock.rows[0].now));
      const source=await database.query<{case_id:string;attempt_id:string;reviewer_account_id:string;tenant_id:string}>(`SELECT case_id,attempt_id,reviewer_account_id,tenant_id FROM written_score_reviews WHERE review_id=$1`,[input.reviewId]);
      const review=source.rows[0];if(!review)throw new Error("Integrity escalation is unavailable.");
      const cases=await database.query(`SELECT 1 FROM assurance_cases WHERE case_id=$1 AND assessment_reference=$2 AND owner_kind='admin' AND case_status='Review pending' AND closed_at IS NULL FOR UPDATE`,[review.case_id,review.attempt_id]);
      const attempt=await database.query(`SELECT 1 FROM assessment_attempts WHERE attempt_id=$1 AND case_id=$2 AND status IN ('SUBMITTED','AUTO_SUBMITTED') FOR UPDATE`,[review.attempt_id,review.case_id]);
      const draft=await database.query(`SELECT 1 FROM written_score_reviews WHERE review_id=$1 AND status='DRAFT' FOR UPDATE`,[input.reviewId]);
      const latest=await database.query<{revision:number;disposition:string}>(`SELECT revision,disposition FROM assessment_integrity_dispositions WHERE attempt_id=$1 ORDER BY revision DESC LIMIT 1`,[review.attempt_id]);
      const count=await database.query<{count:number}>(`SELECT COUNT(*)::integer AS count FROM integrity_capture_events WHERE attempt_id=$1`,[review.attempt_id]);
      if(!cases.rows[0] || !attempt.rows[0] || !draft.rows[0] || latest.rows[0]?.revision!==input.expectedRevision || !["CONCERN_CONFIRMED","UNABLE","ESCALATE"].includes(latest.rows[0]?.disposition??"") || count.rows[0]?.count!==input.expectedEventCount)throw new IntegrityReviewConflictError("Integrity escalation changed. Reload before returning it.");
      const currentClock=await database.query<{now:string|Date}>("SELECT clock_timestamp() AS now");
      await requireRecentSessionMfa(principal,new AuthAccessRepository(database),new Date(currentClock.rows[0].now));
      const id=createIdentifier("integrity_disposition");
      await database.query(`INSERT INTO assessment_integrity_dispositions(disposition_id,attempt_id,review_id,case_id,reviewer_account_id,revision,disposition,reason,reviewed_event_count,actor_account_id,actor_role)
        VALUES($1,$2,$3,$4,$5,$6,'REVIEW_REQUIRED',$7,$8,$9,'admin')`,[id,review.attempt_id,input.reviewId,review.case_id,review.reviewer_account_id,input.expectedRevision+1,reason,input.expectedEventCount,principal.accountId]);
      await transitionIntegrityReviewCase(database,{caseId:review.case_id,tenantId:review.tenant_id,owner:"reviewer",nextAction:"Assigned calibrated reviewer must reconsider the retained integrity history and Admin reason.",actor:{accountId:principal.accountId,role:"admin"},now:new Date(currentClock.rows[0].now)});
      await database.query("SELECT platform_enqueue_assurance_event_notifications($1,$2)",["integrity.returned","integrity:"+id]);
      await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedAuditActor(principal),{action:"assurance_case.status.changed",outcome:"succeeded",target:{type:"resource",reference:review.case_id},metadata:{integrityDispositionId:id,revision:input.expectedRevision+1,disposition:"REVIEW_REQUIRED"}});
      return id;
    });
  }

  async list(principal: AuthorizationPrincipal) {
    return this.database.transaction(async database => {
      await liveReviewer(database,principal);
      const result=await database.query<{review_id:string;attempt_id:string;case_id:string;event_count:number|string;disposition:string|null;reason:string|null;revision:number|null;reviewed_event_count:number|null;events:{type:string;classification:string;state:string;providerState:string|null;at:string}[];history:{revision:number;disposition:string;reason:string;role:string}[]}>(
        `SELECT r.review_id,r.attempt_id,r.case_id,COUNT(e.event_id) AS event_count,d.disposition,d.reason,d.revision,d.reviewed_event_count,
         (SELECT jsonb_agg(jsonb_build_object('type',event_type,'classification',classification,'state',state,'providerState',provider_state,'at',occurred_at) ORDER BY occurred_at,event_id) FROM integrity_capture_events WHERE attempt_id=r.attempt_id) AS events,
         (SELECT jsonb_agg(jsonb_build_object('revision',revision,'disposition',disposition,'reason',reason,'role',actor_role) ORDER BY revision) FROM assessment_integrity_dispositions WHERE attempt_id=r.attempt_id) AS history
         FROM written_score_reviews r JOIN integrity_capture_events e ON e.attempt_id=r.attempt_id
         LEFT JOIN LATERAL(SELECT * FROM assessment_integrity_dispositions WHERE attempt_id=r.attempt_id ORDER BY revision DESC LIMIT 1) d ON TRUE
         WHERE r.reviewer_account_id=$1 AND r.status IN ('DRAFT','FINAL')
         GROUP BY r.review_id,r.attempt_id,r.case_id,d.disposition,d.reason,d.revision,d.reviewed_event_count
         HAVING BOOL_OR(e.classification<>'GREEN' OR e.state='DEGRADED' OR e.provider_state IN ('DEGRADED','UNAVAILABLE'))`,[principal.accountId]);
      return result.rows;
    });
  }

  async resolve(principal: AuthorizationPrincipal, input: {reviewId: string; disposition: string; reason: string; expectedEventCount: number; expectedRevision?: number}) {
    const reason = input.reason.trim();
    const expectedRevision=input.expectedRevision??0;
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=2147483647)throw new IntegrityReviewInputError("Integrity revision is invalid.");
    if (!INTEGRITY_DISPOSITIONS.includes(input.disposition as typeof INTEGRITY_DISPOSITIONS[number]) || reason.length<5 || reason.length>4000 || !Number.isSafeInteger(input.expectedEventCount) || input.expectedEventCount<1) throw new IntegrityReviewInputError("A valid reasoned integrity disposition is required.");
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
      if (Number(count.rows[0]?.count)!==input.expectedEventCount) throw new IntegrityReviewConflictError("Integrity history changed. Reload before deciding.");
      const latest=await database.query<{revision:number;reviewed_event_count:number;disposition:string}>(`SELECT revision,reviewed_event_count,disposition FROM assessment_integrity_dispositions WHERE attempt_id=$1 ORDER BY revision DESC LIMIT 1`,[source.attempt_id]);
      if((latest.rows[0]?.revision??0)!==expectedRevision || (latest.rows[0] && latest.rows[0].disposition!=="REVIEW_REQUIRED" && Number(latest.rows[0].reviewed_event_count)>=input.expectedEventCount))throw new IntegrityReviewConflictError("Integrity disposition changed or this evidence was already reviewed. Reload before deciding.");
      const id=createIdentifier("integrity_disposition");
      await database.query(`INSERT INTO assessment_integrity_dispositions(disposition_id,attempt_id,review_id,case_id,reviewer_account_id,revision,disposition,reason,reviewed_event_count,actor_account_id,actor_role) VALUES($1,$2,$3,$4,$5,$9,$6,$7,$8,$5,'verifier')`,[id,source.attempt_id,input.reviewId,source.case_id,principal.accountId,input.disposition,reason,input.expectedEventCount,expectedRevision+1]);
      if(input.disposition==="CLEAR"){
        const result=await objectiveAssessmentResult(database,source.attempt_id,source.case_id);
        if(result)await database.query(`UPDATE written_score_reviews SET score=$2,decision=$3,reason=$4,draft_revision=draft_revision+1 WHERE review_id=$1 AND status='DRAFT'`,[input.reviewId,result.score,result.decision,"Objective answers scored against the pinned key and published pass mark after reasoned human integrity clearance."]);
      }
      if (input.disposition!=="CLEAR") {
        await transitionIntegrityReviewCase(database,{caseId:source.case_id,tenantId:source.tenant_id,owner:"admin",nextAction:"Admin must review the retained integrity disposition before this case can advance.",actor:{accountId:principal.accountId,role:"verifier"},now:new Date()});
      }
      if(input.disposition!=="CLEAR")await database.query("SELECT platform_enqueue_assurance_event_notifications($1,$2)",["integrity.escalated","integrity:"+id]);
      await liveReviewer(database,principal);
      await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedAuditActor(principal),{action:"assurance_case.status.changed",outcome:"succeeded",target:{type:"resource",reference:source.case_id},metadata:{integrityDispositionId:id,attemptId:source.attempt_id,disposition:input.disposition,revision:expectedRevision+1}});
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
  if (row.disposition==="REVIEW_REQUIRED") return "reviewer";
  if (row.disposition!=="CLEAR") return "admin";
  return Number(row.reviewed_event_count)===Number(row.event_count) ? null : "reviewer";
}
