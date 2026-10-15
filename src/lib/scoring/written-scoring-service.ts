import "server-only";
import {reviewerCapacity} from "../review/reviewer-capacity";
import {assertIntegrityDispositionClear} from "../integrity/integrity-review-service";
import {objectiveAssessmentResult} from "../assessment-attempt/assessment-submission-progression-service";
import type {AuthorizationPrincipal} from "../authorization/authorization-context-domain";
import {requireLiveWrittenReviewer,requireWrittenAttemptEligibility,WrittenScoringAccessError} from "./written-scoring-authority";
import { loadAssignedReviewQuestions } from "./assessment-review-source";
import { createIdentifier } from "../auth/auth-domain";
import type { DatabaseClient } from "../database/database";
import {bindTrustedAuditActor} from "../audit/audit-domain";
import {DatabaseAuditRepository} from "../audit/audit-repository";
import { returnWrittenScoringCase, advanceAfterAssessmentReview } from "../assurance/assurance-case-progression-service";
import { normalizeWrittenScore, normalizeWrittenScoreDecision } from "./written-scoring-domain";

type ScoringReviewRow = {
  review_id:string; tenant_id:string; case_id:string; attempt_id:string;
  reviewer_account_id:string; rubric_version:string; score:number|null;
  decision:"PASS"|"FAIL"|"CHANGES_REQUESTED"|null; reason:string; status:string;
  draft_revision:number;
  created_at:string|Date;
};

export class ScoringRecoveryError extends Error {}

export class WrittenScoringService {
  constructor(private readonly database: DatabaseClient,private readonly actor?:AuthorizationPrincipal,private readonly insideTransaction=false) {}

  private async requireReviewOwner(reviewId:string,reviewerAccountId:string,tenantId?:string) {
    await requireLiveWrittenReviewer(this.database,this.actor,reviewerAccountId);
    const result=await this.database.query<{review_id:string;attempt_id:string;case_id:string;tenant_id:string;rubric_version:string;draft_revision:number}>(`SELECT review_id,attempt_id,case_id,tenant_id,rubric_version,draft_revision FROM written_score_reviews WHERE review_id=$1 AND reviewer_account_id=$2 AND ($3::text IS NULL OR tenant_id=$3)`,[reviewId,reviewerAccountId,tenantId??null]);
    const row=result.rows[0];if(!row)throw new WrittenScoringAccessError("Reviewer does not own this scoring review.");
    const conflict=await this.database.query("SELECT 1 FROM scoring_conflict_declarations WHERE review_id=$1 AND reviewer_account_id=$2",[reviewId,reviewerAccountId]);
    if(conflict.rows[0])throw new WrittenScoringAccessError("A declared conflict removes written scoring authority.");
    await requireWrittenAttemptEligibility(this.database,reviewerAccountId,row.attempt_id,row.case_id,row.tenant_id);
    const locked=await this.database.query<typeof row>(`SELECT review_id,attempt_id,case_id,tenant_id,rubric_version,draft_revision FROM written_score_reviews WHERE review_id=$1 AND reviewer_account_id=$2 AND ($3::text IS NULL OR tenant_id=$3) FOR UPDATE`,[reviewId,reviewerAccountId,tenantId??null]);
    const current=locked.rows[0];
    if(!current || current.attempt_id!==row.attempt_id || current.case_id!==row.case_id || current.tenant_id!==row.tenant_id || current.rubric_version!==row.rubric_version)throw new WrittenScoringAccessError("Scoring source changed during review.");

    const pinned=await this.database.query(`SELECT 1 FROM assessment_attempts WHERE attempt_id=$1 AND blueprint_version_id=$2`,[row.attempt_id,row.rubric_version]);
    if(!pinned.rows[0])throw new WrittenScoringAccessError("Written scoring rubric source is unavailable.");
    await requireLiveWrittenReviewer(this.database,this.actor,reviewerAccountId);
    return current;
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
    const marks=await this.database.query<{criterion:string;mark:number;mark_reason:string|null}>(`SELECT DISTINCT ON(criterion) criterion,mark,mark_reason FROM written_score_rubric_marks WHERE review_id=$1 AND reviewer_account_id=$2 AND mark_sequence>COALESCE((SELECT (events.metadata->>'marksBeforeAssignment')::bigint FROM platform_audit_events events WHERE events.action_key='assurance_case.status.changed' AND events.metadata->>'assessmentReviewAssignment'=$1 ORDER BY events.audit_sequence DESC LIMIT 1),0) ORDER BY criterion,mark_sequence DESC`,[reviewId,reviewerAccountId]);
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

  async recordConflict(input: {reviewId:string;reviewerAccountId:string;tenantId?:string;reason:string;expectedRevision?:number}): Promise<void> {
    if(!this.insideTransaction)return this.database.transaction(database=>new WrittenScoringService(database,this.actor,true).recordConflict(input));
    const reason=input.reason.trim();
    if(!input.reviewId.startsWith("written_score_")||reason.length<5||reason.length>4000)throw new ScoringRecoveryError("A valid conflict reason is required.");
    const owner=await this.requireReviewOwner(input.reviewId,input.reviewerAccountId,input.tenantId);
    const row=(await this.database.query<{status:string;case_status:string}>("SELECT review.status,cases.case_status FROM written_score_reviews review JOIN assurance_cases cases ON cases.case_id=review.case_id WHERE review.review_id=$1",[input.reviewId])).rows[0];
    if(row?.status!=="DRAFT"||row.case_status!=="Review pending"||owner.draft_revision!==this.revision(input.expectedRevision))throw new ScoringRecoveryError("Scoring history changed; only the current draft may declare a conflict.");
    const conflictId=createIdentifier("score_conflict");
    await this.database.query("INSERT INTO scoring_conflict_declarations(conflict_id,review_id,reviewer_account_id,reason) VALUES($1,$2,$3,$4)",[conflictId,input.reviewId,input.reviewerAccountId,reason]);
    await this.database.query("UPDATE written_score_reviews SET draft_revision=draft_revision+1 WHERE review_id=$1",[input.reviewId]);
    await returnWrittenScoringCase(this.database,{caseId:owner.case_id,tenantId:owner.tenant_id,owner:"admin",nextAction:"Admin must assign an independent calibrated Verifier after the declared scoring conflict and resolve any retained concerns.",eventType:"assessment_scoring_conflict",actor:{accountId:input.reviewerAccountId,role:"verifier"},now:new Date()});
    await new DatabaseAuditRepository(Promise.resolve(this.database)).append(bindTrustedAuditActor(this.actor!),{action:"assurance_case.status.changed",outcome:"succeeded",target:{type:"resource",reference:owner.case_id},metadata:{scoringConflictId:conflictId,reviewId:input.reviewId,reason}});
  }

  async beginAmendment(input:{reviewId:string;reviewerAccountId:string;tenantId?:string;reason:string}):Promise<{originalReviewId:string;replacementReviewId:string}>{
    if(!this.insideTransaction)return this.database.transaction(database=>new WrittenScoringService(database,this.actor,true).beginAmendment(input));
    const reason=input.reason.trim();
    if(reason.length<5||reason.length>4000)throw new ScoringRecoveryError("An amendment reason is required.");
    const owner=await this.requireReviewOwner(input.reviewId,input.reviewerAccountId,input.tenantId);
    try{await assertIntegrityDispositionClear(this.database,owner.attempt_id);}catch(error){
      if(error instanceof Error && error.message==="Integrity concerns require a current reasoned human clearance before this attempt can advance.")throw new ScoringRecoveryError(error.message);
      throw error;
    }
    const row=(await this.database.query<{status:string;case_status:string}>("SELECT review.status,cases.case_status FROM written_score_reviews review JOIN assurance_cases cases ON cases.case_id=review.case_id WHERE review.review_id=$1",[input.reviewId])).rows[0];
    if(row?.status!=="FINAL"||!["Review pending","Decision pending","Reassessment required","Interview pending"].includes(row.case_status))throw new ScoringRecoveryError("Only the current final written review can start an amendment.");
    try{await this.pinnedCriteria(input.reviewId,input.reviewerAccountId);}catch(error){
      if(error instanceof Error && error.message==="Every written question needs an authoritative pinned rubric.")throw new ScoringRecoveryError(error.message);
      throw error;
    }
    const capacity=await reviewerCapacity(this.database,input.reviewerAccountId,true);
    if(capacity && capacity.open>=capacity.limit)throw new ScoringRecoveryError("The reviewer workload limit is reached. Complete another review before starting an amendment.");
    await returnWrittenScoringCase(this.database,{caseId:owner.case_id,tenantId:owner.tenant_id,owner:"reviewer",nextAction:"The assigned Verifier must freshly mark every pinned rubric criterion and explicitly finalize the retained scoring amendment.",eventType:"assessment_scoring_amendment",actor:{accountId:input.reviewerAccountId,role:"verifier"},now:new Date()});
    await this.database.query("UPDATE written_score_reviews SET status='SUPERSEDED' WHERE review_id=$1",[input.reviewId]);
    const replacementId=createIdentifier("written_score"),amendmentId=createIdentifier("score_amendment");
    await this.database.query("INSERT INTO written_score_reviews(review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,reason,status) VALUES($1,$2,$3,$4,$5,$6,NULL,NULL,$7,'DRAFT')",[replacementId,owner.tenant_id,owner.case_id,owner.attempt_id,input.reviewerAccountId,owner.rubric_version,reason]);
    await this.database.query("INSERT INTO written_score_amendments(amendment_id,original_review_id,replacement_review_id,reviewer_account_id,reason) VALUES($1,$2,$3,$4,$5)",[amendmentId,input.reviewId,replacementId,input.reviewerAccountId,reason]);
    await new DatabaseAuditRepository(Promise.resolve(this.database)).append(bindTrustedAuditActor(this.actor!),{action:"assurance_case.status.changed",outcome:"succeeded",target:{type:"resource",reference:owner.case_id},metadata:{scoringAmendmentId:amendmentId,originalReviewId:input.reviewId,replacementReviewId:replacementId,reason}});
    return {originalReviewId:input.reviewId,replacementReviewId:replacementId};
  }

  async finalize(input: {reviewId: string; reviewerAccountId: string; tenantId?: string; assessorVisible?: boolean}): Promise<{review_id:string;status:string}|undefined> {
    if(!this.insideTransaction)return this.database.transaction(database=>new WrittenScoringService(database,this.actor,true).finalize(input));
    if (!input.reviewId.startsWith("written_score_")) throw new Error("Invalid review scope.");
    if (!input.reviewerAccountId.trim()) throw new Error("Missing reviewer scope.");
    if (input.assessorVisible !== undefined && typeof input.assessorVisible !== "boolean") throw new Error("Invalid comment visibility.");
    const owner=await this.requireReviewOwner(input.reviewId, input.reviewerAccountId, input.tenantId);
    await assertIntegrityDispositionClear(this.database,owner.attempt_id);
    const objective=await objectiveAssessmentResult(this.database,owner.attempt_id,owner.case_id);
    if(objective){
      const saved=await this.database.query<{score:number|null;decision:string|null}>(`SELECT score,decision FROM written_score_reviews WHERE review_id=$1`,[input.reviewId]);
      if(saved.rows[0]?.score!==objective.score || saved.rows[0]?.decision!==objective.decision)throw new Error("Objective score must match pinned answers and the published pass mark.");
    }
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

  async listReviewQueue(input:{tenantId?:string;reviewerAccountId?:string}):Promise<(ScoringReviewRow & {questions:readonly import("./assessment-review-source").AssessmentReviewQuestion[];rubricMarks:readonly Readonly<{criterion:string;mark:number;reason:string}>[];canReview:boolean;canAmend:boolean;unavailableReason:string|null})[]> {
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
      if(!unavailableReason && questions.length>0 && questions.every(question=>question.questionType!=="SHORT_TEXT" && question.questionType!=="LONG_TEXT") && !(await objectiveAssessmentResult(this.database,review.attempt_id,review.case_id))){
        unavailableReason="Published pass mark is unavailable for this objective assessment. Admin must resolve the case policy before finalization.";
      }
      const marks=await this.database.query<{criterion:string;mark:number;mark_reason:string}>(`SELECT DISTINCT ON(criterion) criterion,mark,mark_reason FROM written_score_rubric_marks WHERE review_id=$1 AND reviewer_account_id=$2 AND mark_sequence>COALESCE((SELECT (events.metadata->>'marksBeforeAssignment')::bigint FROM platform_audit_events events WHERE events.action_key='assurance_case.status.changed' AND events.metadata->>'assessmentReviewAssignment'=$1 ORDER BY events.audit_sequence DESC LIMIT 1),0) ORDER BY criterion,mark_sequence DESC`,[review.review_id,reviewerAccountId]);
      const rubricMarks=Object.freeze(marks.rows.map(mark=>Object.freeze({criterion:mark.criterion,mark:Number(mark.mark),reason:mark.mark_reason})));
      const canAmend=review.status==="FINAL" && unavailableReason===null && questions.some(question=>question.questionType==="SHORT_TEXT"||question.questionType==="LONG_TEXT") && Boolean((await this.database.query(`SELECT 1 FROM assurance_cases cases WHERE cases.case_id=$1 AND cases.closed_at IS NULL AND (cases.case_status IN ('Review pending','Decision pending','Reassessment required') OR (cases.case_status='Interview pending' AND EXISTS(SELECT 1 FROM interview_requests requests WHERE requests.interview_request_id=cases.interview_reference AND requests.case_id=cases.case_id AND requests.status='REQUESTED' AND requests.assessor_account_id IS NULL AND NOT EXISTS(SELECT 1 FROM interview_runtime_sessions sessions WHERE sessions.interview_request_id=requests.interview_request_id))))`,[review.case_id])).rows[0]);
      rows.push({...review,questions,rubricMarks,canReview:unavailableReason===null,canAmend,unavailableReason});
    }
    await requireLiveWrittenReviewer(this.database,this.actor,reviewerAccountId);
    return rows;
  }
}
