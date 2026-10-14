import "server-only";
import type {AuthorizationPrincipal} from "../authorization/authorization-context-domain";
import {requireLiveWrittenReviewer,requireWrittenAttemptEligibility,WrittenScoringAccessError} from "./written-scoring-authority";
import { loadAssignedReviewQuestions } from "./assessment-review-source";
import { createIdentifier } from "../auth/auth-domain";
import type { DatabaseClient } from "../database/database";
import { advanceAfterAssessmentReview } from "../assurance/assurance-case-progression-service";
import { normalizeWrittenScore, normalizeWrittenScoreDecision } from "./written-scoring-domain";

type ScoringReviewRow = {
  review_id:string; tenant_id:string; case_id:string; attempt_id:string;
  reviewer_account_id:string; rubric_version:string; score:number|null;
  decision:"PASS"|"FAIL"|"CHANGES_REQUESTED"|null; reason:string; status:string;
  draft_revision:number;
  created_at:string|Date;
};

export class WrittenScoringService {
  constructor(private readonly database: DatabaseClient,private readonly actor?:AuthorizationPrincipal,private readonly insideTransaction=false) {}

  private async requireReviewOwner(reviewId:string,reviewerAccountId:string,tenantId?:string) {
    await requireLiveWrittenReviewer(this.database,this.actor,reviewerAccountId);
    const result=await this.database.query<{review_id:string;attempt_id:string;case_id:string;tenant_id:string;rubric_version:string;draft_revision:number}>(`SELECT review_id,attempt_id,case_id,tenant_id,rubric_version,draft_revision FROM written_score_reviews WHERE review_id=$1 AND reviewer_account_id=$2 AND ($3::text IS NULL OR tenant_id=$3) FOR UPDATE`,[reviewId,reviewerAccountId,tenantId??null]);
    const row=result.rows[0];if(!row)throw new WrittenScoringAccessError("Reviewer does not own this scoring review.");
    await requireWrittenAttemptEligibility(this.database,reviewerAccountId,row.attempt_id,row.case_id,row.tenant_id);
    const pinned=await this.database.query(`SELECT 1 FROM assessment_attempts WHERE attempt_id=$1 AND blueprint_version_id=$2`,[row.attempt_id,row.rubric_version]);
    if(!pinned.rows[0])throw new WrittenScoringAccessError("Written scoring rubric source is unavailable.");
    await requireLiveWrittenReviewer(this.database,this.actor,reviewerAccountId);
    return row;
  }

  private validateIdentity(input: {tenantId: string; caseId: string; attemptId: string; reviewerAccountId: string}) {
    if (!input.tenantId.startsWith("tenant_")) throw new Error("Invalid tenant scope.");
    if (!input.caseId.startsWith("assurance_case_")) throw new Error("Invalid assurance case scope.");
    if (!input.attemptId.trim() || !input.reviewerAccountId.trim()) throw new Error("Missing scoring actor scope.");
  }

  async publish(input: {tenantId:string;caseId:string;attemptId:string;reviewerAccountId:string;rubricVersion:string;score:unknown;decision:unknown;reason:string}): Promise<void> {
    if(!this.insideTransaction)return this.database.transaction(database=>new WrittenScoringService(database,this.actor,true).publish(input));
    await requireLiveWrittenReviewer(this.database,this.actor,input.reviewerAccountId);
    await requireWrittenAttemptEligibility(this.database,input.reviewerAccountId,input.attemptId,input.caseId,input.tenantId);
    this.validateIdentity(input);
    const score=normalizeWrittenScore(input.score);
    const decision=normalizeWrittenScoreDecision(input.decision);
    const reason=input.reason.trim();
    if (!input.rubricVersion.trim()) throw new Error("Rubric version is required.");
    if(reason.length<5||reason.length>4000) throw new Error("Invalid scoring reason.");
    await this.database.query(`INSERT INTO written_score_reviews(review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,reason,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT')`,[createIdentifier("written_score"),input.tenantId,input.caseId,input.attemptId,input.reviewerAccountId,input.rubricVersion,score,decision,reason]);
  }

  async addCalibration(input: {reviewId:string;reviewerAccountId:string;tenantId:string;note:string}): Promise<void> {
    if(!this.insideTransaction)return this.database.transaction(database=>new WrittenScoringService(database,this.actor,true).addCalibration(input));
    if (!input.reviewId.startsWith("written_score_")) throw new Error("Invalid review scope.");
    if (!input.reviewerAccountId.trim()) throw new Error("Missing reviewer scope.");
    const note = input.note.trim();
    if (note.length < 5 || note.length > 4000) throw new Error("Invalid calibration note.");
    await this.requireReviewOwner(input.reviewId, input.reviewerAccountId, input.tenantId);
    await this.database.query(`INSERT INTO scoring_calibration_events(calibration_id,review_id,reviewer_account_id,calibration_note) VALUES($1,$2,$3,$4)`, [createIdentifier("score_calibration"), input.reviewId, input.reviewerAccountId, note]);
  }

  private revision(value:number|undefined):number {
    const expected=value??0;if(!Number.isSafeInteger(expected)||expected<0||expected>2147483646)throw new Error("Invalid scoring revision.");return expected;
  }
  private async pinnedCriteria(reviewId:string,reviewerAccountId:string){
    const questions=(await loadAssignedReviewQuestions(this.database,reviewerAccountId,[reviewId])).get(reviewId)??[];
    const written=questions.filter(question=>question.questionType==="SHORT_TEXT"||question.questionType==="LONG_TEXT");
    if(written.length===0||written.some(question=>question.rubricCriteria.length===0))throw new Error("Every written question needs an authoritative pinned rubric.");
    return written.flatMap(question=>question.rubricCriteria.map((criterion,index)=>({key:`Q${question.position}:C${index}`,description:criterion.description,points:criterion.points})));
  }
  private async computedScore(reviewId:string,reviewerAccountId:string):Promise<number>{
    const criteria=await this.pinnedCriteria(reviewId,reviewerAccountId);
    const marks=await this.database.query<{criterion:string;mark:number;mark_reason:string|null}>(`SELECT DISTINCT ON(criterion) criterion,mark,mark_reason FROM written_score_rubric_marks WHERE review_id=$1 AND reviewer_account_id=$2 ORDER BY criterion,mark_sequence DESC`,[reviewId,reviewerAccountId]);
    let earned=0,total=0;
    for(const criterion of criteria){const mark=marks.rows.find(row=>row.criterion===criterion.key);if(!mark?.mark_reason||mark.mark_reason.trim().length<5)throw new Error("Every pinned rubric criterion requires a reasoned mark.");earned+=criterion.points*mark.mark/100;total+=criterion.points;}
    return Math.round(earned/total*100);
  }
  async addRubricMark(input:{reviewId:string;criterion:string;mark:unknown;reason?:string;reviewerAccountId:string;tenantId?:string;expectedRevision?:number}):Promise<void>{
    return this.database.transaction(async database=>{
      const service=new WrittenScoringService(database,this.actor,true);
      const owner=await service.requireReviewOwner(input.reviewId,input.reviewerAccountId,input.tenantId);
      const locked=await database.query<{status:string}>(`SELECT status FROM written_score_reviews WHERE review_id=$1`,[input.reviewId]);
      if(locked.rows[0]?.status!=="DRAFT")throw new Error("Only an assigned draft review may receive rubric marks; finalized evidence is locked.");
      if(owner.draft_revision!==service.revision(input.expectedRevision))throw new Error("Scoring history changed; reload before saving.");
      const criterion=input.criterion.trim();const mark=normalizeWrittenScore(input.mark);const reason=input.reason?.trim()??"";
      if(reason.length<5||reason.length>4000)throw new Error("Every criterion needs a marking reason.");
      if(!(await service.pinnedCriteria(input.reviewId,input.reviewerAccountId)).some(row=>row.key===criterion))throw new Error("Mark criterion does not match the authoritative pinned rubric.");
      await requireLiveWrittenReviewer(database,this.actor,input.reviewerAccountId);
      await database.query(`INSERT INTO written_score_rubric_marks(mark_id,review_id,reviewer_account_id,criterion,mark,mark_reason) VALUES($1,$2,$3,$4,$5,$6)`,[createIdentifier("rubric_mark"),input.reviewId,input.reviewerAccountId,criterion,mark,reason]);
      await database.query(`UPDATE written_score_reviews SET draft_revision=draft_revision+1,score=NULL,decision=NULL WHERE review_id=$1`,[input.reviewId]);
    });
  }

  async recordConflict(input: {reviewId:string;reviewerAccountId:string;tenantId:string;reason:string}): Promise<void> {
    if(!this.insideTransaction)return this.database.transaction(database=>new WrittenScoringService(database,this.actor,true).recordConflict(input));
    if (!input.reviewId.startsWith("written_score_")) throw new Error("Invalid review scope.");
    const reason = input.reason.trim();
    if (!input.reviewerAccountId.trim() || reason.length < 5 || reason.length > 4000) throw new Error("Invalid conflict declaration.");
    await this.requireReviewOwner(input.reviewId, input.reviewerAccountId, input.tenantId);
    await this.database.query(`INSERT INTO scoring_conflict_declarations(conflict_id,review_id,reviewer_account_id,reason) VALUES($1,$2,$3,$4)`, [createIdentifier("score_conflict"), input.reviewId, input.reviewerAccountId, reason]);
  }

  async finalize(input: {reviewId: string; reviewerAccountId: string; tenantId?: string; assessorVisible?: boolean}): Promise<{review_id:string;status:string}|undefined> {
    if(!this.insideTransaction)return this.database.transaction(database=>new WrittenScoringService(database,this.actor,true).finalize(input));
    if (!input.reviewId.startsWith("written_score_")) throw new Error("Invalid review scope.");
    if (!input.reviewerAccountId.trim()) throw new Error("Missing reviewer scope.");
    if (input.assessorVisible !== undefined && typeof input.assessorVisible !== "boolean") throw new Error("Invalid comment visibility.");
    await this.requireReviewOwner(input.reviewId, input.reviewerAccountId, input.tenantId);
    const result = await this.database.query(
      `UPDATE written_score_reviews SET status='FINAL'${input.assessorVisible === true ? ",assessor_visible=TRUE" : ""} WHERE review_id=$1 AND reviewer_account_id=$2 AND status='DRAFT' AND NOT EXISTS (SELECT 1 FROM scoring_conflict_declarations WHERE review_id=$1 AND reviewer_account_id=$2) RETURNING review_id`,
      [input.reviewId, input.reviewerAccountId]
    );
    if (!result.rows[0]) throw new Error("Review cannot be finalized by this reviewer.");
    const finalReview = await this.database.query<{review_id:string;status:string}>(
      `SELECT review_id,status FROM written_score_reviews WHERE review_id=$1 AND reviewer_account_id=$2 AND status='FINAL'`,
      [input.reviewId, input.reviewerAccountId]
    );
    return finalReview.rows[0];
  }


  async saveDraftDecision(input: {
    reviewId: string;
    reviewerAccountId: string;
    tenantId?: string;
    score?: unknown;
    expectedRevision?:number;
    decision: unknown;
    reason: string;
  }): Promise<{review_id:string;tenant_id:string;case_id:string;score:number;decision:"PASS"|"FAIL"|"CHANGES_REQUESTED";reason:string}> {
    if(!this.insideTransaction)return this.database.transaction(database=>new WrittenScoringService(database,this.actor,true).saveDraftDecision(input));
    if (!input.reviewId.startsWith("written_score_")) throw new Error("Invalid review scope.");
    if (!input.reviewerAccountId.trim()) throw new Error("Missing reviewer scope.");
    const decision = normalizeWrittenScoreDecision(input.decision);
    const reason = input.reason.trim();
    if (reason.length < 5 || reason.length > 4000) throw new Error("Invalid scoring reason.");
    const owner=await this.requireReviewOwner(input.reviewId,input.reviewerAccountId,input.tenantId);
    if(owner.draft_revision!==this.revision(input.expectedRevision))throw new Error("Scoring history changed; reload before saving.");
    const score=await this.computedScore(input.reviewId,input.reviewerAccountId);
    const result = await this.database.query<{ review_id:string; tenant_id:string; case_id:string; score:number; decision:"PASS"|"FAIL"|"CHANGES_REQUESTED"; reason:string }>(
      input.tenantId
        ? `UPDATE written_score_reviews
             SET score=$4,decision=$5,reason=$6,draft_revision=draft_revision+1
           WHERE review_id=$1 AND reviewer_account_id=$2 AND tenant_id=$3 AND status='DRAFT'
           RETURNING review_id,tenant_id,case_id,score,decision,reason`
        : `UPDATE written_score_reviews
             SET score=$3,decision=$4,reason=$5,draft_revision=draft_revision+1
           WHERE review_id=$1 AND reviewer_account_id=$2 AND status='DRAFT'
           RETURNING review_id,tenant_id,case_id,score,decision,reason`,
      input.tenantId
        ? [input.reviewId,input.reviewerAccountId,input.tenantId,score,decision,reason]
        : [input.reviewId,input.reviewerAccountId,score,decision,reason]
    );
    if (!result.rows[0]) throw new Error("Draft scoring decision could not be saved.");
    return result.rows[0];
  }

  async finalizeAndAdvance(input: {
    reviewId: string;
    reviewerAccountId: string;
    tenantId?: string;
    assessorVisible?: boolean;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    return this.database.transaction(async (database) => {
      const service = new WrittenScoringService(database,this.actor,true);
      await service.finalize(input);
      const result = await database.query<{ tenant_id:string; case_id:string; decision:"PASS"|"FAIL"|"CHANGES_REQUESTED" }>(
        input.tenantId
          ? `SELECT tenant_id,case_id,decision
               FROM written_score_reviews
              WHERE review_id=$1 AND reviewer_account_id=$2 AND tenant_id=$3 AND status='FINAL'`
          : `SELECT tenant_id,case_id,decision
               FROM written_score_reviews
              WHERE review_id=$1 AND reviewer_account_id=$2 AND status='FINAL'`,
        input.tenantId
          ? [input.reviewId,input.reviewerAccountId,input.tenantId]
          : [input.reviewId,input.reviewerAccountId]
      );
      const finalReview = result.rows[0];
      if (!finalReview?.decision) throw new Error("Final scoring decision is unavailable.");
      await advanceAfterAssessmentReview(database, {
        caseId: finalReview.case_id,
        tenantId: finalReview.tenant_id,
        decision: finalReview.decision,
        actor: { accountId: input.reviewerAccountId, role: "verifier" },
        now
      });
      return finalReview;
    });
  }

  async amendFinal(input: {reviewId:string; reviewerAccountId:string; tenantId?: string; score:unknown; decision:unknown; reason:string}): Promise<{originalReviewId:string;replacementReviewId:string}> {
    if(!this.insideTransaction)return this.database.transaction(database=>new WrittenScoringService(database,this.actor,true).amendFinal(input));
    if (!input.reviewId.startsWith("written_score_")) throw new Error("Invalid review scope.");
    if (!input.reviewerAccountId.trim()) throw new Error("Missing reviewer scope.");
    const score = normalizeWrittenScore(input.score);
    const decision = normalizeWrittenScoreDecision(input.decision);
    const reason = input.reason.trim();
    if (reason.length < 5 || reason.length > 4000) throw new Error("Invalid amendment reason.");
    return this.database.transaction(async database => {
    await new WrittenScoringService(database,this.actor,true).requireReviewOwner(input.reviewId,input.reviewerAccountId,input.tenantId);
    const existing = await database.query<{tenant_id:string;case_id:string;attempt_id:string;rubric_version:string;draft_revision:number}>(
      input.tenantId
        ? `SELECT tenant_id,case_id,attempt_id,rubric_version FROM written_score_reviews WHERE review_id=$1 AND reviewer_account_id=$2 AND tenant_id=$3 AND status='FINAL' FOR UPDATE`
        : `SELECT tenant_id,case_id,attempt_id,rubric_version FROM written_score_reviews WHERE review_id=$1 AND reviewer_account_id=$2 AND status='FINAL' FOR UPDATE`,
      input.tenantId ? [input.reviewId, input.reviewerAccountId, input.tenantId] : [input.reviewId, input.reviewerAccountId]
    );
    if (!existing.rows[0]) throw new Error("Only the final reviewer may amend a review.");
    await database.query(`UPDATE written_score_reviews SET status='SUPERSEDED' WHERE review_id=$1`, [input.reviewId]);
    const replacementId = createIdentifier("written_score");
    await database.query(`INSERT INTO written_score_reviews(review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,reason,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'FINAL')`, [replacementId, existing.rows[0].tenant_id, existing.rows[0].case_id, existing.rows[0].attempt_id, input.reviewerAccountId, existing.rows[0].rubric_version, score, decision, reason]);
    await database.query(`INSERT INTO written_score_amendments(amendment_id,original_review_id,replacement_review_id,reviewer_account_id,reason) VALUES($1,$2,$3,$4,$5)`, [createIdentifier("score_amendment"),input.reviewId,replacementId,input.reviewerAccountId,reason]);
    return { originalReviewId:input.reviewId, replacementReviewId:replacementId };
    });
  }

  async findFinalForAttempt(attemptId:string, tenantId?:string) {
    const result = tenantId
      ? await this.database.query(`SELECT review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,reason,status,created_at FROM written_score_reviews WHERE attempt_id=$1 AND tenant_id=$2 AND status='FINAL'`, [attemptId, tenantId])
      : await this.database.query(`SELECT review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,reason,status,created_at FROM written_score_reviews WHERE attempt_id=$1 AND status='FINAL'`, [attemptId]);
    return result.rows[0] ?? null;
  }

  async listReviewQueue(input:{tenantId?:string;reviewerAccountId?:string}):Promise<(ScoringReviewRow & {questions:readonly import("./assessment-review-source").AssessmentReviewQuestion[];rubricMarks:readonly Readonly<{criterion:string;mark:number;reason:string}>[];canReview:boolean;unavailableReason:string|null})[]> {
    if(!this.insideTransaction)return this.database.transaction(database=>new WrittenScoringService(database,this.actor,true).listReviewQueue(input));
    const reviewerAccountId=input.reviewerAccountId;
    if(!reviewerAccountId)throw new WrittenScoringAccessError("Actual reviewer scope is required.");
    await requireLiveWrittenReviewer(this.database,this.actor,reviewerAccountId);
    const result=await this.database.query<ScoringReviewRow>(`SELECT review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,reason,status,draft_revision,created_at FROM written_score_reviews WHERE reviewer_account_id=$1 AND ($2::text IS NULL OR tenant_id=$2) ORDER BY created_at DESC,review_id DESC LIMIT 250`,[reviewerAccountId,input.tenantId??null]);
    const rows=[];
    for(const review of result.rows){
      let unavailableReason:string|null=null;
      try{await this.requireReviewOwner(review.review_id,reviewerAccountId,review.tenant_id);}catch(error){if(!(error instanceof WrittenScoringAccessError))throw error;unavailableReason=error.message;}
      const questions=unavailableReason?[]:(await loadAssignedReviewQuestions(this.database,reviewerAccountId,[review.review_id])).get(review.review_id)??[];
      const marks=await this.database.query<{criterion:string;mark:number;mark_reason:string}>(`SELECT DISTINCT ON(criterion) criterion,mark,mark_reason FROM written_score_rubric_marks WHERE review_id=$1 AND reviewer_account_id=$2 ORDER BY criterion,mark_sequence DESC`,[review.review_id,reviewerAccountId]);
      const rubricMarks=Object.freeze(marks.rows.map(mark=>Object.freeze({criterion:mark.criterion,mark:Number(mark.mark),reason:mark.mark_reason})));
      rows.push({...review,questions,rubricMarks,canReview:unavailableReason===null,unavailableReason});
    }
    await requireLiveWrittenReviewer(this.database,this.actor,reviewerAccountId);
    return rows;
  }
}
