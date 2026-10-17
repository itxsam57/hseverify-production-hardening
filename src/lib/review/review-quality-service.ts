import "server-only";
import {randomInt} from "node:crypto";
import {createIdentifier} from "../auth/auth-domain";
import type {AuthorizationPrincipal} from "../authorization/authorization-context-domain";
import {bindTrustedAuditActor} from "../audit/audit-domain";
import {DatabaseAuditRepository} from "../audit/audit-repository";
import type {DatabaseClient} from "../database/database";
import {EvidenceReviewAccessError,EvidenceReviewConflictError} from "./evidence-review-domain";
import {requireLiveReviewActor} from "./review-calibration-authority";
import {reviewQualityPolicy,ReviewQualityInputError} from "./review-quality-domain";
import {reviewerCapacity} from "./reviewer-capacity";

export type ReviewQualitySelection={task_id:string;source_version_id:string;framework_version_id:string;policy_snapshot_id:string|null;required_by_policy:boolean;sampling_percent:number;sample_draw:number;sampled:boolean};
export async function qualitySchema(database:DatabaseClient):Promise<boolean>{
 return Boolean((await database.query<{relation:string|null}>("SELECT to_regclass('evidence_review_quality_selections') AS relation")).rows[0]?.relation);
}
export async function ensureQualitySelection(database:DatabaseClient,taskId:string):Promise<ReviewQualitySelection|null>{
 if(!(await qualitySchema(database)))return null;
 const current=(await database.query<ReviewQualitySelection>("SELECT * FROM evidence_review_quality_selections WHERE task_id=$1",[taskId])).rows[0];
 const scope=(await database.query<{source_version_id:string;framework_version_id:string;snapshot_id:string|null;effective_value_json:Record<string,unknown>|null}>(`SELECT tasks.source_version_id,binding.framework_version_id,snapshots.snapshot_id,snapshots.effective_value_json
  FROM evidence_review_tasks tasks JOIN LATERAL(SELECT framework_version_id,case_snapshot_id FROM evidence_review_framework_bindings WHERE task_id=tasks.task_id ORDER BY binding_sequence DESC LIMIT 1)binding ON TRUE
  LEFT JOIN assurance_case_policy_snapshots snapshots ON snapshots.snapshot_id=binding.case_snapshot_id WHERE tasks.task_id=$1`,[taskId])).rows[0];
 if(!scope)throw new EvidenceReviewConflictError("Authoritative review quality scope is unavailable.");
 if(current){
  if(current.source_version_id!==scope.source_version_id||current.framework_version_id!==scope.framework_version_id||current.policy_snapshot_id!==scope.snapshot_id)throw new EvidenceReviewConflictError("Review quality scope changed; Admin must resolve this retained review.");
  return current;
 }
 const policy=reviewQualityPolicy(scope.effective_value_json??{}),draw=randomInt(100);
 await database.query(`INSERT INTO evidence_review_quality_selections(task_id,source_version_id,framework_version_id,policy_snapshot_id,required_by_policy,sampling_percent,sample_draw,sampled)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[taskId,scope.source_version_id,scope.framework_version_id,scope.snapshot_id,policy.requireSecond,policy.samplingPercent,draw,draw<policy.samplingPercent]);
 return {task_id:taskId,source_version_id:scope.source_version_id,framework_version_id:scope.framework_version_id,policy_snapshot_id:scope.snapshot_id,required_by_policy:policy.requireSecond,sampling_percent:policy.samplingPercent,sample_draw:draw,sampled:draw<policy.samplingPercent};
}
export async function secondReviewRequired(database:DatabaseClient,selection:ReviewQualitySelection):Promise<boolean>{
 return selection.required_by_policy||selection.sampled||Boolean((await database.query("SELECT 1 FROM evidence_review_quality_requirements WHERE task_id=$1 AND source_version_id=$2",[selection.task_id,selection.source_version_id])).rows[0]);
}
export async function reviewQualityView(database:DatabaseClient,taskId:string):Promise<{required:boolean;stage:"initial"|"independent"|"adjudication";samplingPending:boolean}|null>{
 if(!(await qualitySchema(database)))return null;
 const info=(await database.query<{required_by_policy:boolean|null;sampled:boolean|null;manual:boolean;effective_value_json:Record<string,unknown>|null}>(`SELECT selections.required_by_policy,selections.sampled,requirements.task_id IS NOT NULL AS manual,snapshots.effective_value_json
  FROM evidence_review_tasks tasks LEFT JOIN evidence_review_quality_selections selections USING(task_id)
  LEFT JOIN evidence_review_quality_requirements requirements USING(task_id)
  LEFT JOIN LATERAL(SELECT case_snapshot_id FROM evidence_review_framework_bindings WHERE task_id=tasks.task_id ORDER BY binding_sequence DESC LIMIT 1)binding ON TRUE
  LEFT JOIN assurance_case_policy_snapshots snapshots ON snapshots.snapshot_id=binding.case_snapshot_id WHERE tasks.task_id=$1`,[taskId])).rows[0];
 if(!info)return null;
 const policy=reviewQualityPolicy(info.effective_value_json??{});
 const rounds=(await database.query<{count:number}>(`SELECT COUNT(*)::integer AS count FROM evidence_review_quality_rounds rounds WHERE rounds.task_id=$1 AND NOT EXISTS(SELECT 1 FROM evidence_review_conflicts conflicts WHERE conflicts.task_id=rounds.task_id AND conflicts.verifier_account_id=rounds.verifier_account_id)`,[taskId])).rows[0].count;
 return {required:info.manual||info.required_by_policy===true||info.sampled===true||policy.requireSecond,stage:rounds===0?"initial":rounds===1?"independent":"adjudication",samplingPending:info.sampled===null&&policy.samplingPercent>0};
}
export class ReviewQualityService{
 constructor(private readonly database:DatabaseClient){}
 async requireSecond(principal:AuthorizationPrincipal,input:{taskId:string;reason:string}):Promise<void>{
  const reason=input.reason.trim();if(reason.length<5||reason.length>2000)throw new ReviewQualityInputError("A selection reason between 5 and 2000 characters is required.");
  await this.database.transaction(async database=>{
   await requireLiveReviewActor(database,principal,"admin",true);
   const task=(await database.query<{source_version_id:string}>("SELECT source_version_id FROM evidence_review_tasks WHERE task_id=$1 AND task_status='QUEUED' FOR UPDATE",[input.taskId])).rows[0];
   if(!task)throw new EvidenceReviewConflictError("Select a current unclaimed queued review.");
   const id=createIdentifier("quality_requirement");
   const inserted=await database.query("INSERT INTO evidence_review_quality_requirements(requirement_id,task_id,source_version_id,reason,selected_by_account_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(task_id) DO NOTHING",[id,input.taskId,task.source_version_id,reason,principal.accountId]);
   if(inserted.affectedRows!==1)throw new EvidenceReviewConflictError("This review already requires independent second verification.");
   await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedAuditActor(principal),{action:"assurance_case.status.changed",outcome:"succeeded",target:{type:"resource",reference:input.taskId},metadata:{qualityRequirementId:id,reason}});
  });
 }
 async setCapacity(principal:AuthorizationPrincipal,input:{accountId:string;maxOpenReviews:number;expectedRevision:number;reason:string}):Promise<void>{
  const reason=input.reason.trim();
  if(!Number.isInteger(input.maxOpenReviews)||input.maxOpenReviews<1||input.maxOpenReviews>250||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||reason.length<5||reason.length>2000)throw new ReviewQualityInputError("Select a capacity from 1 to 250 and give a reason.");
  await this.database.transaction(async database=>{
   await requireLiveReviewActor(database,principal,"admin",true);
   // Enrollment completion/cancellation holds these rows before touching the account.
   // Serialize here too so an unfinished identity cannot acquire retained history.
   await database.query("SELECT flow_id FROM auth_staff_enrollment_flows WHERE account_id=$1 ORDER BY flow_id FOR UPDATE",[input.accountId]);
   const verifier=(await database.query(`SELECT 1 FROM auth_account_roles roles JOIN auth_accounts accounts USING(account_id)
    WHERE roles.account_id=$1 AND roles.role='verifier' AND accounts.account_status='active'
      AND NOT EXISTS(SELECT 1 FROM auth_staff_enrollment_flows flows WHERE flows.account_id=accounts.account_id AND flows.current_step<>'complete')
    FOR NO KEY UPDATE OF accounts,roles`,[input.accountId])).rows[0];
   if(!verifier)throw new EvidenceReviewAccessError();
   const current=await reviewerCapacity(database,input.accountId,true);
   if(!current||current.revision!==input.expectedRevision)throw new EvidenceReviewConflictError("Reviewer capacity changed; reload before saving.");
   const id=createIdentifier("review_capacity");
   await database.query("INSERT INTO reviewer_capacity_revisions(capacity_id,account_id,max_open_reviews,reason,recorded_by_account_id) VALUES($1,$2,$3,$4,$5)",[id,input.accountId,input.maxOpenReviews,reason,principal.accountId]);
   await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedAuditActor(principal),{action:"assurance_case.status.changed",outcome:"succeeded",target:{type:"resource",reference:input.accountId},metadata:{reviewCapacityId:id,maxOpenReviews:input.maxOpenReviews,reason}});
  });
 }
 async list(principal:AuthorizationPrincipal){
  await requireLiveReviewActor(this.database,principal,"admin");
  const tasks=(await this.database.query<{task_id:string;case_id:string|null;evidence_kind:string;task_status:string;source_version_id:string;selected:boolean}>(`SELECT tasks.task_id,tasks.case_id,tasks.evidence_kind,tasks.task_status,tasks.source_version_id,
   (requirements.task_id IS NOT NULL OR COALESCE(selections.required_by_policy OR selections.sampled,FALSE)) AS selected
   FROM evidence_review_tasks tasks LEFT JOIN evidence_review_quality_requirements requirements USING(task_id)
   LEFT JOIN evidence_review_quality_selections selections USING(task_id)
   WHERE tasks.task_status IN ('QUEUED','ASSIGNED','ESCALATED') ORDER BY tasks.created_at,tasks.task_id LIMIT 100`)).rows;
  const rounds=(await this.database.query<{task_id:string;round_no:number;outcome:string;reason:string;verifier_account_id:string}>(`SELECT rounds.task_id,rounds.round_no,rounds.outcome,rounds.reason,rounds.verifier_account_id FROM evidence_review_quality_rounds rounds JOIN evidence_review_tasks tasks USING(task_id) WHERE rounds.task_id=ANY($1::text[]) ORDER BY rounds.task_id,rounds.round_no`,[tasks.map(task=>task.task_id)])).rows;
  const accounts=(await this.database.query<{account_id:string;display_name:string}>(`SELECT accounts.account_id,accounts.display_name FROM auth_accounts accounts JOIN auth_account_roles roles USING(account_id) WHERE accounts.account_status='active' AND roles.role='verifier' AND NOT EXISTS(SELECT 1 FROM auth_staff_enrollment_flows flows WHERE flows.account_id=accounts.account_id AND flows.current_step<>'complete') ORDER BY accounts.display_name,accounts.account_id`)).rows;
  const reviewers=[];
  for(const account of accounts)reviewers.push({...account,capacity:await reviewerCapacity(this.database,account.account_id)});
  return {tasks:tasks.map(task=>({...task,rounds:rounds.filter(round=>round.task_id===task.task_id)})),reviewers};
 }
}
