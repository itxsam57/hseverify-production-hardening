import "server-only";
import type {DatabaseClient} from "../database/database";

export class CaseAppealReassessmentSourceAccessError extends Error {
 constructor(){super("The selected accepted case appeal is unavailable for reassessment.");}
}
export type CaseAppealReassessmentSource=Readonly<{
 sourceCaseAppealId:string;sourceCaseAppealVersion:number;sourceCaseId:string;tenantId:string;
 frameworkId:string;decisionId:string;workerAccountId:string;permanentWorkerId:string;workerLinkId:string;
}>;
export async function resolveCaseAppealReassessmentSource(database:DatabaseClient,input:{
 sourceCaseAppealId:string;workerAccountId:string;permanentWorkerId:string;frameworkId?:string;
 sourceCaseAppealVersion?:number;workerLinkId?:string;lock?:boolean;
}):Promise<CaseAppealReassessmentSource>{
 const id=input.sourceCaseAppealId.trim();
 if(!/^case_appeal_[A-Za-z0-9_-]{24}$/.test(id))throw new CaseAppealReassessmentSourceAccessError();
 const result=await database.query<{
  appeal_id:string;version:number;case_id:string;tenant_id:string;framework_id:string;
  decision_id:string;worker_account_id:string;permanent_worker_id:string;worker_link_id:string;
 }>(`SELECT appeal.appeal_id,appeal.version,cases.case_id,cases.tenant_id,pin.framework_id,
    appeal.decision_id,cases.worker_account_id,cases.permanent_worker_id,cases.worker_link_id
    FROM assurance_case_appeals appeal JOIN assurance_cases cases ON cases.case_id=appeal.case_id
      AND cases.tenant_id=appeal.tenant_id AND cases.worker_account_id=appeal.worker_account_id
    JOIN assurance_case_policy_snapshots pin ON pin.case_id=cases.case_id AND pin.tenant_id=cases.tenant_id
    JOIN platform_decisions decision ON decision.decision_id=appeal.decision_id
      AND decision.case_id=cases.case_id AND decision.tenant_id=cases.tenant_id
    WHERE appeal.appeal_id=$1 AND appeal.worker_account_id=$2 AND cases.worker_account_id=$2
      AND cases.permanent_worker_id=$3 AND cases.case_status='Rejected'
      AND cases.decision_reference=appeal.decision_id AND cases.credential_reference IS NULL
      AND decision.state='REJECTED' AND appeal.status='accepted'
      AND appeal.reviewer_account_id IS NOT NULL AND appeal.reviewed_at IS NOT NULL
      AND EXISTS(SELECT 1 FROM assurance_case_appeal_events history WHERE history.appeal_id=appeal.appeal_id
       AND history.version=appeal.version AND history.status='accepted'
       AND history.actor_account_id=appeal.reviewer_account_id AND history.occurred_at=appeal.reviewed_at)
      AND ($4::integer IS NULL OR appeal.version=$4)
      AND ($5::text IS NULL OR pin.framework_id=$5)
      ${input.lock?"FOR UPDATE OF appeal,cases":""}`,
      [id,input.workerAccountId,input.permanentWorkerId,input.sourceCaseAppealVersion??null,input.frameworkId??null]);
 if(result.rows.length!==1)throw new CaseAppealReassessmentSourceAccessError();
 const row=result.rows[0];
 let workerLinkId=row.worker_link_id;
 if(row.tenant_id!=="tenant_independent_worker_scope"){
  const links=await database.query<{link_id:string}>(`SELECT links.link_id FROM company_worker_links links
    JOIN platform_tenants tenants ON tenants.tenant_id=links.tenant_id AND tenants.tenant_status='active'
    WHERE links.tenant_id=$1 AND links.worker_account_id=$2 AND links.permanent_worker_id=$3
      AND links.link_status='active' AND ($4::text IS NULL OR links.link_id=$4)
    ORDER BY links.activated_at DESC,links.link_id LIMIT 1 ${input.lock?"FOR UPDATE OF links,tenants":""}`,
    [row.tenant_id,input.workerAccountId,input.permanentWorkerId,input.workerLinkId??null]);
  if(!links.rows[0])throw new CaseAppealReassessmentSourceAccessError();
  workerLinkId=links.rows[0].link_id;
 }else if(input.workerLinkId&&input.workerLinkId!==workerLinkId)throw new CaseAppealReassessmentSourceAccessError();
 return Object.freeze({
  sourceCaseAppealId:row.appeal_id,sourceCaseAppealVersion:Number(row.version),sourceCaseId:row.case_id,
  tenantId:row.tenant_id,frameworkId:row.framework_id,decisionId:row.decision_id,
  workerAccountId:row.worker_account_id,permanentWorkerId:row.permanent_worker_id,workerLinkId
 });
}
export async function bindCaseAppealReassessmentSource(db:DatabaseClient,applicationId:string,source:CaseAppealReassessmentSource,createdAt:string):Promise<void>{
 await db.query(`INSERT INTO worker_case_appeal_reassessment_sources(application_id,source_case_appeal_id,
  source_case_appeal_version,source_case_id,source_tenant_id,source_framework_id,source_decision_id,
  worker_account_id,permanent_worker_id,worker_link_id,created_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  [applicationId,source.sourceCaseAppealId,source.sourceCaseAppealVersion,source.sourceCaseId,source.tenantId,
   source.frameworkId,source.decisionId,source.workerAccountId,source.permanentWorkerId,source.workerLinkId,createdAt]);
}
export async function recheckCaseAppealReassessmentSource(db:DatabaseClient,applicationId:string,input:{
 sourceCaseAppealId:string;workerAccountId:string;permanentWorkerId:string;frameworkId:string;
}):Promise<CaseAppealReassessmentSource>{
 const frozen=await db.query<{source_case_appeal_version:number;source_case_id:string;source_tenant_id:string;
  source_decision_id:string;worker_link_id:string}>(`
 SELECT * FROM worker_case_appeal_reassessment_sources
 WHERE application_id=$1 AND source_case_appeal_id=$2 AND worker_account_id=$3`,
 [applicationId,input.sourceCaseAppealId,input.workerAccountId]);
 const stored=frozen.rows[0];if(!stored)throw new CaseAppealReassessmentSourceAccessError();
 const now=await resolveCaseAppealReassessmentSource(db,{...input,sourceCaseAppealVersion:Number(stored.source_case_appeal_version),workerLinkId:stored.worker_link_id,lock:true});
 if(stored.source_case_id!==now.sourceCaseId||stored.source_tenant_id!==now.tenantId||stored.source_decision_id!==now.decisionId)
  throw new CaseAppealReassessmentSourceAccessError();
 return now;
}
