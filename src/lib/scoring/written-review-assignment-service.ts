import "server-only";
import {requireRecentSessionMfa,RECENT_MFA_ERROR} from "../auth/recent-mfa-service";
import {AuthAccessRepository} from "../auth/auth-access-repository";
import { createIdentifier } from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import { createAssuranceActionId, createAssuranceTimelineEventId } from "../assurance/assurance-order-domain";
import { AssuranceOrderRepository } from "../assurance/assurance-order-repository";
import type { DatabaseClient } from "../database/database";
import { requireLiveReviewActor } from "../review/review-calibration-authority";
import {eligibleWrittenReviewers} from "./written-review-eligibility";
import {objectiveAssessmentResult} from "../assessment-attempt/assessment-submission-progression-service";
import {assessmentRequiresIntegrityReview} from "../integrity/integrity-review-service";
import { requireWrittenAttemptEligibility } from "./written-scoring-authority";

export class WrittenReviewAssignmentError extends Error {}
type PendingRow = {case_id:string;attempt_id:string;tenant_id:string;order_id:string;worker_account_id:string;worker_name:string;blueprint_version_id:string;review_id:string|null;reviewer_account_id:string|null;draft_revision:number|null;score:number|null;decision:string|null;reason:string|null};
const PENDING_SQL = `SELECT cases.case_id,cases.tenant_id,cases.order_id,cases.worker_account_id,accounts.display_name worker_name,
 attempts.attempt_id,attempts.blueprint_version_id,reviews.review_id,reviews.reviewer_account_id,reviews.draft_revision,reviews.score,reviews.decision,reviews.reason
 FROM assurance_cases cases JOIN assessment_attempts attempts ON attempts.attempt_id=cases.assessment_reference AND attempts.case_id=cases.case_id AND attempts.worker_account_id=cases.worker_account_id
 JOIN auth_accounts accounts ON accounts.account_id=cases.worker_account_id
 LEFT JOIN written_score_reviews reviews ON reviews.attempt_id=attempts.attempt_id AND reviews.case_id=cases.case_id
 WHERE cases.case_status='Review pending' AND cases.closed_at IS NULL AND attempts.status IN ('SUBMITTED','AUTO_SUBMITTED')
 AND (reviews.review_id IS NULL OR reviews.status='DRAFT')`;

export class WrittenReviewAssignmentService {
 constructor(private readonly database:DatabaseClient) {}
 async list(principal:AuthorizationPrincipal) {
  await requireLiveReviewActor(this.database,principal,"admin");
  const rows=await this.database.query<PendingRow>(PENDING_SQL+" ORDER BY cases.updated_at,cases.case_id LIMIT 100");
  const pending=[];
  for(const row of rows.rows){
   const candidates=await eligibleWrittenReviewers(this.database,row.case_id,row.attempt_id);
   pending.push({caseId:row.case_id,workerName:row.worker_name,reviewId:row.review_id,reviewerAccountId:row.reviewer_account_id,revision:row.draft_revision??0,candidates});
  }
  return pending;
 }
 async assign(principal:AuthorizationPrincipal,input:{caseId:string;reviewerAccountId:string;expectedReviewId:string|null;expectedRevision:number;reason:string}):Promise<string>{
  const reason=input.reason.trim();
  if(reason.length<5||reason.length>2000||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>=2147483647)throw new WrittenReviewAssignmentError("A reason and current review revision are required.");
  return this.database.transaction(async database=>{
   await requireLiveReviewActor(database,principal,"admin",true);
   const currentClock=(await database.query<{now:string|Date}>("SELECT clock_timestamp() AS now")).rows[0];
   try{await requireRecentSessionMfa(principal,new AuthAccessRepository(database),new Date(currentClock.now));}catch(error){if(error instanceof Error && error.message===RECENT_MFA_ERROR)throw new WrittenReviewAssignmentError("Sign in again with MFA before assigning a review.");throw error;}
   const row=(await database.query<PendingRow>(PENDING_SQL+" AND cases.case_id=$1 FOR UPDATE OF cases,attempts",[input.caseId])).rows[0];
   if(!row)throw new WrittenReviewAssignmentError("Pending assessment review is unavailable.");
   if(row.review_id)await database.query("SELECT review_id FROM written_score_reviews WHERE review_id=$1 FOR UPDATE",[row.review_id]);
   const current=(await database.query<PendingRow>(PENDING_SQL+" AND cases.case_id=$1",[input.caseId])).rows[0];
   if(!current||current.review_id!==input.expectedReviewId||(current.draft_revision??0)!==input.expectedRevision)throw new WrittenReviewAssignmentError("Review changed; reload before assigning.");
   if(current.reviewer_account_id===input.reviewerAccountId)throw new WrittenReviewAssignmentError("This reviewer is already assigned.");
   const candidates=await eligibleWrittenReviewers(database,row.case_id,row.attempt_id);
   if(!candidates.some(candidate=>candidate.accountId===input.reviewerAccountId))throw new WrittenReviewAssignmentError("Select a current calibrated independent reviewer.");
   const lockedReviewer=await database.query("SELECT accounts.account_id FROM auth_accounts accounts JOIN auth_account_roles roles USING(account_id) WHERE accounts.account_id=$1 AND accounts.account_status='active' AND roles.role='verifier' FOR UPDATE OF accounts,roles",[input.reviewerAccountId]);
   if(!lockedReviewer.rows[0])throw new WrittenReviewAssignmentError("Selected reviewer is no longer available.");
   await requireWrittenAttemptEligibility(database,input.reviewerAccountId,row.attempt_id,row.case_id,row.tenant_id);
   const reviewId=row.review_id??createIdentifier("written_score");
   const integrity=(await database.query<{disposition:string;reviewed_event_count:number;event_count:number}>(`SELECT disposition,reviewed_event_count,(SELECT COUNT(*)::integer FROM integrity_capture_events WHERE attempt_id=$1) AS event_count FROM assessment_integrity_dispositions WHERE attempt_id=$1 ORDER BY revision DESC LIMIT 1`,[row.attempt_id])).rows[0];
   const cleared=!(await assessmentRequiresIntegrityReview(database,row.attempt_id))||(integrity?.disposition==="CLEAR"&&Number(integrity.reviewed_event_count)===Number(integrity.event_count));
   const objective=cleared?await objectiveAssessmentResult(database,row.attempt_id,row.case_id):null;
   if(row.review_id){
    await database.query(`UPDATE written_score_reviews SET reviewer_account_id=$2,score=$4,decision=$5,reason=$3,draft_revision=draft_revision+1 WHERE review_id=$1 AND status='DRAFT'`,[reviewId,input.reviewerAccountId,reason,objective?.score??null,objective?.decision??null]);
   }else{
    await database.query(`INSERT INTO written_score_reviews(review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,reason,status) VALUES($1,$2,$3,$4,$5,$6,NULL,NULL,$7,'DRAFT')`,[reviewId,row.tenant_id,row.case_id,row.attempt_id,input.reviewerAccountId,row.blueprint_version_id,reason]);
   }
   // Reassignment never clears a retained integrity escalation or its Admin ownership.
   const concern=await database.query<{disposition:string}>(`SELECT disposition FROM assessment_integrity_dispositions WHERE attempt_id=$1 ORDER BY revision DESC LIMIT 1`,[row.attempt_id]);
   const escalated=["CONCERN_CONFIRMED","UNABLE","ESCALATE"].includes(concern.rows[0]?.disposition??"");
   const now=new Date().toISOString(),owner=escalated?"admin":"reviewer",nextAction=escalated?"Admin must resolve the retained integrity escalation.":"Assigned verifier must score the submitted assessment.";
   await database.query("UPDATE assurance_cases SET owner_kind=$2,next_action=$3,updated_at=$4 WHERE case_id=$1",[row.case_id,owner,nextAction,now]);
   await database.query("UPDATE assurance_action_items SET action_status='resolved',updated_at=$2 WHERE case_id=$1 AND action_status<>'resolved'",[row.case_id,now]);
   const repository=new AssuranceOrderRepository(database);
   await repository.insertAction({actionId:createAssuranceActionId(),tenantId:row.tenant_id,orderId:row.order_id,caseId:row.case_id,workerAccountId:row.worker_account_id,severity:"warning",reason:nextAction,dueAt:null,owner,allowedAction:"open_case",deepLink:`/company/assurance-orders/${row.order_id}#${row.case_id}`,statutory:false,now});
   await repository.insertTimeline({eventId:createAssuranceTimelineEventId(),tenantId:row.tenant_id,orderId:row.order_id,caseId:row.case_id,eventType:"assessment_review_assigned",fromStatus:"Review pending",toStatus:"Review pending",owner,nextAction,actorAccountId:principal.accountId,actorRole:"admin",now});
   const markFloor=(await database.query<{floor:string}>("SELECT COALESCE(MAX(mark_sequence),0)::text AS floor FROM written_score_rubric_marks WHERE review_id=$1",[reviewId])).rows[0].floor;
   const assignmentAudit=await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedAuditActor(principal),{action:"assurance_case.status.changed",outcome:"succeeded",target:{type:"resource",reference:row.case_id},metadata:{assessmentReviewAssignment:reviewId,marksBeforeAssignment:markFloor,reviewerAccountId:input.reviewerAccountId,previousReviewerAccountId:row.reviewer_account_id,previousScore:row.score,previousDecision:row.decision,previousReason:row.reason,reason}});
   await database.query("SELECT platform_enqueue_assurance_event_notifications($1,$2)",["assessment.review.assigned","scoring:"+assignmentAudit.auditEventId]);
   await requireLiveReviewActor(database,principal,"admin",true);
   const finalClock=(await database.query<{now:string|Date}>("SELECT clock_timestamp() AS now")).rows[0];
   try{await requireRecentSessionMfa(principal,new AuthAccessRepository(database),new Date(finalClock.now));}catch(error){if(error instanceof Error && error.message===RECENT_MFA_ERROR)throw new WrittenReviewAssignmentError("Sign in again with MFA before assigning a review.");throw error;}
   return reviewId;
  });
 }
}
