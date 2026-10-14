import "server-only";

import { pinAssuranceCasePolicySnapshot } from "../policy/effective-policy-service";
import { createIdentifier } from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import { EvidenceReviewAccessError, EvidenceReviewConflictError, EvidenceReviewInputError } from "./evidence-review-domain";
import { listReviewFrameworkRevisions, requireLiveReviewActor } from "./review-calibration-authority";

export class EvidenceReviewFrameworkService {
 constructor(private readonly databasePromise:Promise<DatabaseClient>=getDatabaseClient()) {}
 async listFrameworks(principal:AuthorizationPrincipal) {
  const db=await this.databasePromise;await requireLiveReviewActor(db,principal,"admin");return listReviewFrameworkRevisions(db);
 }
 async listPolicies(principal:AuthorizationPrincipal) {
  const db=await this.databasePromise;await requireLiveReviewActor(db,principal,"admin");
  return (await db.query<{policy_reference:string;framework_id:string;framework_reference:string}>(`SELECT DISTINCT packs.policy_reference,packs.framework_id,frameworks.framework_reference FROM assurance_policy_packs packs JOIN assurance_frameworks frameworks USING(framework_id) JOIN assurance_policy_versions versions USING(policy_id) WHERE frameworks.framework_status='ACTIVE' AND packs.policy_status='ACTIVE' AND versions.version_status='PUBLISHED' AND versions.effective_from<=clock_timestamp() AND (versions.effective_to IS NULL OR versions.effective_to>clock_timestamp()) ORDER BY packs.policy_reference`)).rows;
 }
 async listTasks(principal:AuthorizationPrincipal) {
  const db=await this.databasePromise;await requireLiveReviewActor(db,principal,"admin");
  const result=await db.query<{task_id:string;evidence_kind:string;task_status:string;case_id:string|null;pinned_framework_version_id:string|null;binding_id:string|null;framework_version_id:string|null;framework_reference:string|null;version_no:number|null;reason:string|null}>(`SELECT tasks.task_id,tasks.evidence_kind,tasks.task_status,tasks.case_id,pinned.framework_version_id pinned_framework_version_id,bindings.binding_id,bindings.framework_version_id,revisions.framework_reference,revisions.version_no,bindings.reason
   FROM evidence_review_tasks tasks LEFT JOIN LATERAL(SELECT revisions.framework_version_id FROM assurance_case_policy_snapshots snapshots JOIN LATERAL(SELECT r.framework_version_id FROM assurance_framework_revisions r WHERE r.framework_id=snapshots.framework_id AND r.effective_from<=snapshots.reference_time ORDER BY r.effective_from DESC,r.version_no DESC LIMIT 1) revisions ON TRUE WHERE snapshots.case_id=tasks.case_id AND snapshots.tenant_id=tasks.tenant_id) pinned ON TRUE LEFT JOIN LATERAL(SELECT * FROM evidence_review_framework_bindings WHERE task_id=tasks.task_id ORDER BY binding_sequence DESC LIMIT 1) bindings ON TRUE
   LEFT JOIN assurance_framework_revisions revisions USING(framework_id,framework_version_id)
   WHERE tasks.task_status IN ('QUEUED','ASSIGNED') ORDER BY (bindings.binding_id IS NULL) DESC,tasks.created_at,tasks.task_id LIMIT 250`);
  return result.rows;
 }
 async bind(principal:AuthorizationPrincipal,input:{taskId:string;frameworkVersionId:string;reason:string;expectedBindingId:string|null;policyReference?:string|null},now=new Date()):Promise<string> {
  const reason=input.reason.trim();if(reason.length<5||reason.length>2000)throw new EvidenceReviewInputError();
  const db=await this.databasePromise;
  return db.transaction(async tx=>{
   await requireLiveReviewActor(tx,principal,"admin",true);
   const tasks=await tx.query<{case_id:string|null;tenant_id:string|null;task_status:string}>(`SELECT case_id,tenant_id,task_status FROM evidence_review_tasks WHERE task_id=$1 FOR UPDATE`,[input.taskId]);
   const task=tasks.rows[0];if(!task)throw new EvidenceReviewAccessError();
   if(task.task_status!=="QUEUED")throw new EvidenceReviewConflictError("Only an unclaimed queued task can change framework applicability.");
   const current=await tx.query<{binding_id:string}>(`SELECT binding_id FROM evidence_review_framework_bindings WHERE task_id=$1 ORDER BY binding_sequence DESC LIMIT 1`,[input.taskId]);
   if((current.rows[0]?.binding_id??null)!==input.expectedBindingId)throw new EvidenceReviewConflictError("Task binding changed; reload before resolving applicability.");
   const revisions=await tx.query<{framework_id:string;framework_version_id:string}>(`SELECT revisions.framework_id,revisions.framework_version_id FROM assurance_framework_revisions revisions
    JOIN assurance_frameworks frameworks USING(framework_id) WHERE revisions.framework_version_id=$1 AND frameworks.framework_status='ACTIVE' AND revisions.effective_from<=$2 FOR SHARE OF frameworks`,[input.frameworkVersionId,now.toISOString()]);
   const revision=revisions.rows[0];if(!revision)throw new EvidenceReviewConflictError("Select an available authoritative framework revision.");
   let snapshotId:string|null=null;
   if(task.case_id){
    const snapshots=await tx.query<{snapshot_id:string;framework_id:string;framework_version_id:string}>(`SELECT snapshots.snapshot_id,snapshots.framework_id,revisions.framework_version_id
     FROM assurance_case_policy_snapshots snapshots LEFT JOIN LATERAL(SELECT framework_version_id FROM assurance_framework_revisions revisions
      WHERE revisions.framework_id=snapshots.framework_id AND revisions.effective_from<=snapshots.reference_time ORDER BY revisions.effective_from DESC,revisions.version_no DESC LIMIT 1) revisions ON TRUE
     WHERE snapshots.case_id=$1 AND snapshots.tenant_id=$2`,[task.case_id,task.tenant_id]);
    const snapshot=snapshots.rows[0];
    if(!snapshot){
     const context=(await tx.query<{assessment_framework_references:string[];effective_policy_reference:string|null}>(`SELECT orders.assessment_framework_references,orders.effective_policy_reference FROM assurance_cases cases JOIN assurance_orders orders ON orders.order_id=cases.order_id AND orders.tenant_id=cases.tenant_id WHERE cases.case_id=$1 AND cases.tenant_id=$2 AND cases.closed_at IS NULL AND cases.assessment_reference IS NULL AND cases.case_status IN ('Evidence pending','Review pending') FOR UPDATE OF cases FOR SHARE OF orders`,[task.case_id,task.tenant_id])).rows[0];
     if(!context)throw new EvidenceReviewAccessError();
     const selected=(await tx.query<{framework_reference:string}>("SELECT framework_reference FROM assurance_framework_revisions WHERE framework_version_id=$1",[revision.framework_version_id])).rows[0];
     const refs=Array.isArray(context.assessment_framework_references)?context.assessment_framework_references:[];
     if(refs.length && !refs.includes(selected.framework_reference))throw new EvidenceReviewConflictError("Selected review framework must respect the Company's assessment framework selection.");
     const policyReference=input.policyReference?.trim()||null;
     if(!policyReference || (context.effective_policy_reference && context.effective_policy_reference!==policyReference))throw new EvidenceReviewConflictError("Select the applicable published policy; retain the Company's policy selection when present.");
     await pinAssuranceCasePolicySnapshot(tx,{caseId:task.case_id,tenantId:task.tenant_id!,frameworkReferences:[selected.framework_reference],policyReference,referenceTime:now,actorAccountId:principal.accountId,actorPrincipal:principal});
     const established=(await tx.query<{snapshot_id:string;framework_id:string;framework_version_id:string;policy_reference:string}>(`SELECT snapshots.snapshot_id,snapshots.framework_id,revisions.framework_version_id,packs.policy_reference FROM assurance_case_policy_snapshots snapshots JOIN assurance_policy_packs packs USING(policy_id) JOIN LATERAL(SELECT framework_version_id FROM assurance_framework_revisions WHERE framework_id=snapshots.framework_id AND effective_from<=snapshots.reference_time ORDER BY effective_from DESC,version_no DESC LIMIT 1) revisions ON TRUE WHERE snapshots.case_id=$1 AND snapshots.tenant_id=$2`,[task.case_id,task.tenant_id])).rows[0];
     if(!established || established.framework_version_id!==revision.framework_version_id || established.policy_reference!==policyReference)throw new EvidenceReviewConflictError("Selected framework revision must match the applicable policy snapshot.");
     snapshotId=established.snapshot_id;
    }
    if(snapshot && (snapshot.framework_id!==revision.framework_id || snapshot.framework_version_id!==revision.framework_version_id))throw new EvidenceReviewConflictError("The review binding must respect the case's pinned framework revision.");
    snapshotId=snapshot?.snapshot_id??snapshotId;
   }
   const id=createIdentifier("review_binding");
   await tx.query(`INSERT INTO evidence_review_framework_bindings(binding_id,task_id,framework_id,framework_version_id,case_snapshot_id,supersedes_binding_id,reason,bound_by_account_id,bound_by_session_id,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,input.taskId,revision.framework_id,revision.framework_version_id,snapshotId,input.expectedBindingId,reason,principal.accountId,principal.sessionId,now.toISOString()]);
   await new DatabaseAuditRepository(Promise.resolve(tx)).append(bindTrustedAuditActor(principal),{action:"evidence_review.framework.bound",outcome:"succeeded",target:{type:"resource",reference:input.taskId},metadata:{bindingId:id,frameworkId:revision.framework_id,frameworkVersionId:revision.framework_version_id,caseSnapshotId:snapshotId,supersedesBindingId:input.expectedBindingId}});
   return id;
  });
 }
 async recordRevision(principal:AuthorizationPrincipal,input:{frameworkId:string;title:string;effectiveFrom:Date},now=new Date()):Promise<string> {
  const title=input.title.trim();if(title.length<2||title.length>200||!Number.isFinite(input.effectiveFrom.getTime()))throw new EvidenceReviewInputError();
  const db=await this.databasePromise;return db.transaction(async tx=>{
   await requireLiveReviewActor(tx,principal,"admin",true);
   const frameworks=await tx.query<{framework_reference:string}>(`SELECT framework_reference FROM assurance_frameworks WHERE framework_id=$1 AND framework_status='ACTIVE' FOR UPDATE`,[input.frameworkId]);
   if(!frameworks.rows[0])throw new EvidenceReviewAccessError();
   const previous=await tx.query<{version_no:number;effective_from:string|Date}>(`SELECT version_no,effective_from FROM assurance_framework_revisions WHERE framework_id=$1 ORDER BY version_no DESC LIMIT 1`,[input.frameworkId]);
   if(previous.rows[0] && input.effectiveFrom<=new Date(previous.rows[0].effective_from))throw new EvidenceReviewConflictError("A new revision must start after the preceding revision.");
   const snapshots=await tx.query(`SELECT 1 FROM assurance_case_policy_snapshots WHERE framework_id=$1 AND reference_time>=$2 LIMIT 1`,[input.frameworkId,input.effectiveFrom.toISOString()]);
   if(snapshots.rows[0])throw new EvidenceReviewConflictError("A new revision cannot change the framework revision at an existing case snapshot reference time.");
   // Do not backdate revisions into already-bound task applicability.
   const bindings=await tx.query(`SELECT 1 FROM evidence_review_framework_bindings WHERE framework_id=$1 LIMIT 1`,[input.frameworkId]);
   if(bindings.rows[0] && input.effectiveFrom<now)throw new EvidenceReviewConflictError("Framework revisions with retained bindings cannot be backdated.");
   const id=createIdentifier("framework_revision");
   await tx.query(`INSERT INTO assurance_framework_revisions(framework_version_id,framework_id,version_no,framework_reference,title,effective_from,recorded_by_account_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,input.frameworkId,Number(previous.rows[0]?.version_no??0)+1,frameworks.rows[0].framework_reference,title,input.effectiveFrom.toISOString(),principal.accountId,now.toISOString()]);
   await new DatabaseAuditRepository(Promise.resolve(tx)).append(bindTrustedAuditActor(principal),{action:"framework.revision.recorded",outcome:"succeeded",target:{type:"resource",reference:input.frameworkId},metadata:{frameworkVersionId:id}});
   return id;
  });
 }
}
let service:EvidenceReviewFrameworkService|null=null;
export function getEvidenceReviewFrameworkService(){service??=new EvidenceReviewFrameworkService();return service;}
