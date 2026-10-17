import "server-only";
import type { DatabaseClient } from "../database/database";

export class AssessmentReassessmentSourceAccessError extends Error {
  constructor() { super("The selected reassessment appeal is unavailable."); this.name = "AssessmentReassessmentSourceAccessError"; }
}
export type AssessmentReassessmentSource = Readonly<{
  sourceAppealId: string; sourceAppealVersion: number; sourceCaseId: string; tenantId: string;
  frameworkId: string; credentialId: string; decisionId: string; workerAccountId: string;
  permanentWorkerId: string; workerLinkId: string;
}>;
export async function resolveAssessmentReassessmentSource(database: DatabaseClient, input: {
  sourceAppealId: string; workerAccountId: string; permanentWorkerId: string;
  frameworkId?: string; sourceAppealVersion?: number; workerLinkId?: string; lock?: boolean;
}): Promise<AssessmentReassessmentSource> {
  const appealId=input.sourceAppealId.trim();
  if (!/^appeal_[A-Za-z0-9_-]{1,160}$/.test(appealId)) throw new AssessmentReassessmentSourceAccessError();
  const result=await database.query<{
    appeal_id:string;version:number;case_id:string;tenant_id:string;framework_id:string;
    credential_reference:string;decision_reference:string;worker_account_id:string;permanent_worker_id:string;worker_link_id:string;
  }>(`SELECT appeal.appeal_id,appeal.version,cases.case_id,cases.tenant_id,snapshot.framework_id,
       cases.credential_reference,cases.decision_reference,cases.worker_account_id,cases.permanent_worker_id,cases.worker_link_id
      FROM credential_appeals appeal
      JOIN assurance_cases cases ON cases.credential_reference=appeal.credential_id
       AND cases.permanent_worker_id=appeal.worker_id
      JOIN assurance_case_policy_snapshots snapshot ON snapshot.case_id=cases.case_id AND snapshot.tenant_id=cases.tenant_id
      JOIN platform_decisions decision ON decision.decision_id=cases.decision_reference AND decision.case_id=cases.case_id
       AND decision.tenant_id=cases.tenant_id
      JOIN credential_issuances credential ON credential.credential_id=appeal.credential_id AND credential.worker_id=appeal.worker_id
     WHERE appeal.appeal_id=$1 AND appeal.worker_id=$2 AND cases.worker_account_id=$3
       AND appeal.status='accepted' AND appeal.outcome_action='reassessment'
       AND appeal.reviewer_account_id IS NOT NULL AND appeal.reviewed_at IS NOT NULL
       AND credential.status<>'revoked' AND decision.state<>'REVOKED'
       AND ($4::int IS NULL OR appeal.version=$4)
       AND ($5::text IS NULL OR snapshot.framework_id=$5)
       AND EXISTS(SELECT 1 FROM credential_appeal_events event WHERE event.appeal_id=appeal.appeal_id
         AND event.version=appeal.version AND event.status='accepted' AND event.outcome_action='reassessment'
         AND event.reviewer_account_id=appeal.reviewer_account_id AND event.changed_at=appeal.reviewed_at)
       AND NOT EXISTS(SELECT 1 FROM credential_appeals later WHERE later.credential_id=appeal.credential_id
         AND later.status='accepted' AND later.appeal_id<>appeal.appeal_id AND later.reviewed_at>=appeal.reviewed_at)
       AND NOT EXISTS(SELECT 1 FROM credential_replacements replacement WHERE replacement.old_credential_id=appeal.credential_id)
       AND EXISTS(SELECT 1 FROM living_record_competencies competency JOIN living_record_versions version
         ON version.competency_id=competency.competency_id
        WHERE competency.source_credential_id=appeal.credential_id AND version.status='reassessment_required'
          AND version.version=(SELECT MAX(latest.version) FROM living_record_versions latest WHERE latest.competency_id=competency.competency_id))
       ${input.lock ? "FOR UPDATE OF appeal,cases,credential" : ""}`,
    [appealId,input.permanentWorkerId,input.workerAccountId,input.sourceAppealVersion??null,input.frameworkId??null]);
  if(result.rows.length!==1) throw new AssessmentReassessmentSourceAccessError();
  const row=result.rows[0];
  let workerLinkId=row.worker_link_id;
  if(row.tenant_id!=="tenant_independent_worker_scope") {
    const links=await database.query<{link_id:string}>(`SELECT links.link_id FROM company_worker_links links
      JOIN platform_tenants tenant ON tenant.tenant_id=links.tenant_id AND tenant.tenant_status='active'
      WHERE links.tenant_id=$1 AND links.worker_account_id=$2 AND links.permanent_worker_id=$3
        AND links.link_status='active' AND ($4::text IS NULL OR links.link_id=$4)
      ORDER BY links.activated_at DESC,links.link_id LIMIT 1 ${input.lock ? "FOR UPDATE OF links,tenant" : ""}`,
      [row.tenant_id,input.workerAccountId,input.permanentWorkerId,input.workerLinkId??null]);
    if(!links.rows[0]) throw new AssessmentReassessmentSourceAccessError();
    workerLinkId=links.rows[0].link_id;
  } else if(input.workerLinkId && input.workerLinkId!==workerLinkId) throw new AssessmentReassessmentSourceAccessError();
  return Object.freeze({sourceAppealId:row.appeal_id,sourceAppealVersion:Number(row.version),sourceCaseId:row.case_id,
    tenantId:row.tenant_id,frameworkId:row.framework_id,credentialId:row.credential_reference,decisionId:row.decision_reference,
    workerAccountId:row.worker_account_id,permanentWorkerId:row.permanent_worker_id,workerLinkId});
}
export async function bindAssessmentReassessmentSource(database:DatabaseClient,applicationId:string,source:AssessmentReassessmentSource,createdAt:string) {
  await database.query(`INSERT INTO worker_assessment_reassessment_sources(application_id,source_appeal_id,source_appeal_version,
    source_case_id,source_tenant_id,source_framework_id,source_credential_id,source_decision_id,
    worker_account_id,permanent_worker_id,worker_link_id,actor_account_id,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$9,$12)`,
    [applicationId,source.sourceAppealId,source.sourceAppealVersion,source.sourceCaseId,source.tenantId,source.frameworkId,
     source.credentialId,source.decisionId,source.workerAccountId,source.permanentWorkerId,source.workerLinkId,createdAt]);
}
export async function recheckAssessmentReassessmentSource(database:DatabaseClient,applicationId:string,input:{
  sourceAppealId:string;workerAccountId:string;permanentWorkerId:string;frameworkId:string;
}) {
  const frozen=await database.query<{source_appeal_version:number;worker_link_id:string;source_case_id:string;source_credential_id:string;source_decision_id:string;source_tenant_id:string}>(
    "SELECT * FROM worker_assessment_reassessment_sources WHERE application_id=$1 AND source_appeal_id=$2 AND worker_account_id=$3",
    [applicationId,input.sourceAppealId,input.workerAccountId]);
  const saved=frozen.rows[0];if(!saved) throw new AssessmentReassessmentSourceAccessError();
  const current=await resolveAssessmentReassessmentSource(database,{...input,sourceAppealVersion:Number(saved.source_appeal_version),workerLinkId:saved.worker_link_id,lock:true});
  if(current.sourceCaseId!==saved.source_case_id||current.credentialId!==saved.source_credential_id||
     current.decisionId!==saved.source_decision_id||current.tenantId!==saved.source_tenant_id) throw new AssessmentReassessmentSourceAccessError();
  return current;
}
