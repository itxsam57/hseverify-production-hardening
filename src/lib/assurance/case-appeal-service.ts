import "server-only";
import type {AuthorizationPrincipal} from "../authorization/authorization-context-domain";
import {createIdentifier} from "../auth/auth-domain";
import {AuthAccessRepository} from "../auth/auth-access-repository";
import {requireRecentSessionMfa} from "../auth/recent-mfa-service";
import {getDatabaseClient,type DatabaseClient} from "../database/database";
import {getServerEnvironment} from "../config/server-environment";
import {authorizeSecureFileAccessCore,readSecureFileAccessCore,type SecureFileAccessLookup} from "../secure-files/secure-file-access-core";
import {createRuntimePrivateObjectStorage} from "../secure-files/private-object-storage";
import {secureFileFromRow,type SecureFileRow} from "../secure-files/secure-file-repository";
import {appendSecureFileAccessAudit} from "../secure-files/secure-file-access-audit";
import {DatabaseAuditRepository} from "../audit/audit-repository";

export class CaseAppealConflictError extends Error {}
export class CaseAppealAccessError extends Error {
  constructor(){super("The selected case appeal is unavailable.");}
}
export type CaseAppealEvidence=Readonly<{recordId:string;versionId:string;fileId:string;sha256:string;byteSize:number}>;
type AppealStatus="submitted"|"under_review"|"accepted"|"rejected"|"withdrawn";
export type CaseAppeal=Readonly<{
 appealId:string;caseId:string;tenantId:string;workerAccountId:string;decisionId:string;
 grounds:string;status:AppealStatus;version:number;reviewerAccountId:string|null;
 reviewReason:string|null;reviewedAt:string|null;createdAt:string;
}>;
type AppealRow={appeal_id:string;case_id:string;tenant_id:string;worker_account_id:string;decision_id:string;
 grounds:string;status:AppealStatus;version:number;reviewer_account_id:string|null;review_reason:string|null;
 reviewed_at:Date|string|null;created_at:Date|string};
const columns="appeal_id,case_id,tenant_id,worker_account_id,decision_id,grounds,status,version,reviewer_account_id,review_reason,reviewed_at,created_at";
function map(row:AppealRow):CaseAppeal{return Object.freeze({
 appealId:row.appeal_id,caseId:row.case_id,tenantId:row.tenant_id,workerAccountId:row.worker_account_id,decisionId:row.decision_id,
 grounds:row.grounds,status:row.status,version:Number(row.version),reviewerAccountId:row.reviewer_account_id,
 reviewReason:row.review_reason,reviewedAt:row.reviewed_at?new Date(row.reviewed_at).toISOString():null,
 createdAt:new Date(row.created_at).toISOString()
});}
function worker(p:AuthorizationPrincipal){if(p.activeRole!=="worker"||p.accountStatus!=="active"||p.tenantMembership!==null)throw new CaseAppealAccessError();}
function admin(p:AuthorizationPrincipal){if(p.activeRole!=="admin"||p.accountStatus!=="active"||p.tenantMembership!==null)throw new CaseAppealAccessError();}
function validId(v:string){return /^assurance_case_[A-Za-z0-9_-]{24}$/.test(v);}
function validAppeal(v:string){return /^case_appeal_[A-Za-z0-9_-]{24}$/.test(v);}
export class CaseAppealService {
 constructor(private readonly databasePromise:Promise<DatabaseClient>=getDatabaseClient()){}
 async listForWorker(principal:AuthorizationPrincipal):Promise<readonly CaseAppeal[]>{
  worker(principal);const db=await this.databasePromise;
  const r=await db.query<AppealRow>(`SELECT ${columns} FROM assurance_case_appeals WHERE worker_account_id=$1 ORDER BY created_at DESC,appeal_id DESC LIMIT 100`,[principal.accountId]);
  return Object.freeze(r.rows.map(map));
 }
 async listForAdmin(principal:AuthorizationPrincipal):Promise<readonly CaseAppeal[]>{
  admin(principal);const db=await this.databasePromise;
  const r=await db.query<AppealRow>(`SELECT ${columns} FROM assurance_case_appeals ORDER BY CASE status WHEN 'submitted' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END,created_at ASC,appeal_id LIMIT 150`);
  return Object.freeze(r.rows.map(map));
 }
 async submit(principal:AuthorizationPrincipal,input:{caseId:string;grounds:string;evidenceRecordIds?:readonly string[]}):Promise<CaseAppeal>{
  worker(principal);if(!validId(input.caseId))throw new CaseAppealAccessError();
  const grounds=input.grounds.trim();if(grounds.length<10||grounds.length>4000)throw new CaseAppealConflictError("Provide appeal grounds between 10 and 4000 characters.");
  const recordIds=input.evidenceRecordIds??[];
  if(recordIds.length>10||new Set(recordIds).size!==recordIds.length||recordIds.some(id=>!/^evidence_record_[A-Za-z0-9_-]{24}$/.test(id)&&!/^worker_evidence_record_[A-Za-z0-9_-]{1,100}$/.test(id)))
   throw new CaseAppealConflictError("Select at most ten distinct owned supporting evidence records.");
  const db=await this.databasePromise;
  return db.transaction(async tx=>{
   const r=await tx.query<{case_id:string;tenant_id:string;worker_account_id:string;decision_reference:string}>(`
    SELECT cases.case_id,cases.tenant_id,cases.worker_account_id,cases.decision_reference
    FROM assurance_cases cases JOIN platform_decisions decision
      ON decision.decision_id=cases.decision_reference AND decision.tenant_id=cases.tenant_id AND decision.case_id=cases.case_id
    WHERE cases.case_id=$1 AND cases.worker_account_id=$2 AND cases.case_status='Rejected'
      AND cases.credential_reference IS NULL AND decision.state='REJECTED'
    FOR UPDATE OF cases`,[input.caseId,principal.accountId]);
   const source=r.rows[0];if(!source)throw new CaseAppealAccessError();
   const exists=await tx.query("SELECT 1 FROM assurance_case_appeals WHERE case_id=$1 AND status IN ('submitted','under_review') LIMIT 1",[input.caseId]);
   if(exists.rows.length)throw new CaseAppealConflictError("An appeal is already open for this case.");
   const now=(await tx.query<{now:Date|string}>("SELECT clock_timestamp() AS now")).rows[0].now;
   const iso=new Date(now).toISOString(),appealId=createIdentifier("case_appeal");
   const saved=await tx.query<AppealRow>(`INSERT INTO assurance_case_appeals
    (appeal_id,case_id,tenant_id,worker_account_id,decision_id,grounds,status,version,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,'submitted',1,$7,$7) RETURNING ${columns}`,
    [appealId,source.case_id,source.tenant_id,principal.accountId,source.decision_reference,grounds,iso]);
   for(const recordId of recordIds){
    const selected=await tx.query<{record_id:string;version_id:string;file_id:string;content_sha256:string;byte_size:number|string}>(`
      SELECT records.record_id,versions.version_id,files.file_id,files.content_sha256,files.byte_size
      FROM worker_evidence_records records JOIN worker_evidence_versions versions
        ON versions.record_id=records.record_id AND versions.version_id=records.current_version_id
       AND versions.version_status='submitted'
      JOIN worker_evidence_attachments attachments ON attachments.record_id=records.record_id
       AND attachments.version_id=versions.version_id AND attachments.superseded_at IS NULL
      JOIN platform_secure_files files ON files.file_id=attachments.secure_file_id
        AND files.owner_account_id=records.worker_account_id AND files.owner_role='worker'
        AND files.lifecycle_status='available' AND files.content_sha256 ~ '^[0-9a-f]{64}$'
        AND files.byte_size>0
      WHERE records.record_id=$1 AND records.worker_account_id=$2 AND records.lifecycle_status<>'inactive'
      FOR SHARE OF records,versions,attachments,files`,[recordId,principal.accountId]);
    if(!selected.rows.length||selected.rows.length>10)throw new CaseAppealAccessError();
    for(const item of selected.rows){
      await tx.query(`INSERT INTO assurance_case_appeal_evidence
        (appeal_id,record_id,version_id,file_id,content_sha256,byte_size,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [appealId,item.record_id,item.version_id,item.file_id,item.content_sha256,item.byte_size,iso]);
    }
   }
   await tx.query(`INSERT INTO assurance_case_appeal_events(appeal_id,version,status,actor_account_id,reason,occurred_at)
    VALUES($1,1,'submitted',$2,$3,$4)`,[appealId,principal.accountId,grounds,iso]);
   return map(saved.rows[0]);
  });
 }
  async listEvidence(principal:AuthorizationPrincipal,appealId:string):Promise<readonly CaseAppealEvidence[]>{
    if(!validAppeal(appealId))throw new CaseAppealAccessError();
    const db=await this.databasePromise;
    await this.assertEvidenceReader(db,principal,appealId);
    const result=await db.query<{record_id:string;version_id:string;file_id:string;content_sha256:string;byte_size:number|string}>(`
      SELECT record_id,version_id,file_id,content_sha256,byte_size FROM assurance_case_appeal_evidence
      WHERE appeal_id=$1 ORDER BY record_id,file_id`,[appealId]);
    return Object.freeze(result.rows.map(row=>Object.freeze({
      recordId:row.record_id,versionId:row.version_id,fileId:row.file_id,
      sha256:row.content_sha256,byteSize:Number(row.byte_size)
    })));
  }
  private async assertEvidenceReader(db:DatabaseClient,principal:AuthorizationPrincipal,appealId:string):Promise<void>{
    if(principal.activeRole==="worker"){
      worker(principal);
      const r=await db.query("SELECT 1 FROM assurance_case_appeals WHERE appeal_id=$1 AND worker_account_id=$2",[appealId,principal.accountId]);
      if(r.rows.length!==1)throw new CaseAppealAccessError();
      return;
    }
    admin(principal);
    const r=await db.query<{
      worker_account_id:string;actor_account_id:string|null;override_actor:string|null
    }>(`SELECT appeal.worker_account_id,
      (SELECT event.actor_account_id FROM assurance_case_timeline_events event
       WHERE event.case_id=appeal.case_id AND event.tenant_id=appeal.tenant_id AND event.event_type='decision_recorded'
       ORDER BY event.occurred_at DESC LIMIT 1) AS actor_account_id,
      (SELECT override.actor_reference FROM platform_decision_overrides override
       WHERE override.decision_id=appeal.decision_id ORDER BY override.created_at DESC LIMIT 1) AS override_actor
      FROM assurance_case_appeals appeal JOIN assurance_cases cases ON cases.case_id=appeal.case_id
       AND cases.tenant_id=appeal.tenant_id AND cases.decision_reference=appeal.decision_id
      WHERE appeal.appeal_id=$1 AND cases.case_status='Rejected' AND cases.credential_reference IS NULL`,[appealId]);
    const row=r.rows[0];
    if(!row?.actor_account_id||[row.worker_account_id,row.actor_account_id,row.override_actor].includes(principal.accountId))throw new CaseAppealAccessError();
  }
  async previewEvidence(principal:AuthorizationPrincipal,appealId:string,fileId:string){
    admin(principal);
    if(!validAppeal(appealId))throw new CaseAppealAccessError();
    const db=await this.databasePromise;
    const lookup:SecureFileAccessLookup={findForPrincipal:async(actor,ref)=>db.transaction(async tx=>{
      await this.assertEvidenceReader(tx,actor,appealId);
      const r=await tx.query<SecureFileRow>(`
        SELECT files.* FROM assurance_case_appeal_evidence snapshot
        JOIN assurance_case_appeals appeal ON appeal.appeal_id=snapshot.appeal_id
        JOIN worker_evidence_records record ON record.record_id=snapshot.record_id
         AND record.worker_account_id=appeal.worker_account_id
        JOIN worker_evidence_versions version ON version.version_id=snapshot.version_id
         AND version.record_id=record.record_id
        JOIN worker_evidence_attachments attachment ON attachment.record_id=record.record_id
         AND attachment.version_id=version.version_id AND attachment.secure_file_id=snapshot.file_id
        JOIN platform_secure_files files ON files.file_id=attachment.secure_file_id
         AND files.owner_account_id=appeal.worker_account_id AND files.owner_role='worker'
         AND files.tenant_id IS NULL AND files.membership_id IS NULL AND files.lifecycle_status='available'
         AND files.content_sha256=snapshot.content_sha256 AND files.byte_size=snapshot.byte_size
        WHERE snapshot.appeal_id=$1 AND snapshot.file_id=$2`,[appealId,ref]);
      return r.rows.length===1?secureFileFromRow(r.rows[0]):null;
    })};
    const env=getServerEnvironment(),audit=new DatabaseAuditRepository(Promise.resolve(db));
    const granted=await authorizeSecureFileAccessCore({principal,fileRef:fileId,purpose:"preview",signingSecret:env.sessionSecret,repository:lookup});
    await appendSecureFileAccessAudit({principal,action:"secure_file.access.authorized",fileRef:fileId,purpose:"preview",expiresAt:granted.expiresAt,repository:audit});
    const content=await readSecureFileAccessCore({principal,token:granted.token,expectedPurpose:"preview",signingSecret:env.sessionSecret,
      repository:lookup,storage:createRuntimePrivateObjectStorage(env.appEnvironment)});
    if(!await lookup.findForPrincipal(principal,fileId))throw new CaseAppealAccessError();
    await appendSecureFileAccessAudit({principal,action:"secure_file.access.served",fileRef:fileId,purpose:"preview",
      byteSize:content.bytes.byteLength,repository:audit});
    return content;
  }
 async review(principal:AuthorizationPrincipal,input:{appealId:string;version:number;status:"under_review"|"accepted"|"rejected";reason:string}):Promise<CaseAppeal>{
  admin(principal);
  if(!validAppeal(input.appealId))throw new CaseAppealAccessError();
  if(!Number.isSafeInteger(input.version)||input.version<1||input.version>2147483646)throw new CaseAppealConflictError("Appeal history changed. Reload before reviewing.");
  const reason=input.reason.trim();if(reason.length<10||reason.length>4000)throw new CaseAppealConflictError("Reasoned appeal outcome must contain 10 to 4000 characters.");
  const db=await this.databasePromise;
  return db.transaction(async tx=>{
   const selected=await tx.query<AppealRow>(`SELECT ${columns} FROM assurance_case_appeals WHERE appeal_id=$1 FOR UPDATE`,[input.appealId]);
   const current=selected.rows[0];
   if(!current)throw new CaseAppealAccessError();
   if(current.version!==input.version||!["submitted","under_review"].includes(current.status))throw new CaseAppealConflictError("Appeal history changed. Reload before reviewing.");
   if(input.status!=="under_review"){
     const pending=await tx.query(`SELECT 1 FROM assurance_case_appeal_evidence_requests request WHERE request.appeal_id=$1
       AND NOT EXISTS(SELECT 1 FROM assurance_case_appeal_evidence_responses response WHERE response.request_id=request.request_id) LIMIT 1`,[input.appealId]);
     if(pending.rows.length)throw new CaseAppealConflictError("Worker must respond to the requested evidence before final review.");
   }
   if(input.status!=="under_review"){
     const interview=await tx.query(`SELECT 1 FROM assurance_case_appeal_interview_requests request WHERE request.appeal_id=$1
       AND NOT EXISTS(SELECT 1 FROM assurance_case_appeal_interview_outcomes result WHERE result.interview_request_id=request.interview_request_id) LIMIT 1`,[input.appealId]);
     if(interview.rows.length)throw new CaseAppealConflictError("The assigned Assessor must complete the requested interview before final review.");
   }
   const original=await tx.query<{worker_account_id:string;actor_account_id:string|null;override_actor:string|null}>(`
    SELECT cases.worker_account_id,
      (SELECT event.actor_account_id FROM assurance_case_timeline_events event
       WHERE event.case_id=cases.case_id AND event.tenant_id=cases.tenant_id
         AND event.event_type='decision_recorded' ORDER BY event.occurred_at DESC LIMIT 1) AS actor_account_id,
      (SELECT overrides.actor_reference FROM platform_decision_overrides overrides
       WHERE overrides.decision_id=cases.decision_reference ORDER BY overrides.created_at DESC LIMIT 1) AS override_actor
    FROM assurance_cases cases JOIN platform_decisions original_decision ON
      original_decision.decision_id=cases.decision_reference
      AND original_decision.case_id=cases.case_id AND original_decision.tenant_id=cases.tenant_id
    WHERE cases.case_id=$1 AND cases.tenant_id=$2 AND cases.worker_account_id=$3
      AND cases.decision_reference=$4 AND cases.case_status='Rejected' AND cases.credential_reference IS NULL
      AND original_decision.state='REJECTED'
    FOR UPDATE OF cases`,[current.case_id,current.tenant_id,current.worker_account_id,current.decision_id]);
   if(!original.rows[0]||!original.rows[0].actor_account_id)throw new CaseAppealAccessError();
   if([original.rows[0].worker_account_id,original.rows[0].actor_account_id,original.rows[0].override_actor].includes(principal.accountId))
    throw new CaseAppealAccessError();
   const actor=await tx.query(`SELECT 1 FROM auth_accounts accounts JOIN auth_account_roles roles USING(account_id)
     WHERE accounts.account_id=$1 AND accounts.account_status='active' AND roles.role='admin' FOR SHARE OF accounts`,[principal.accountId]);
   if(!actor.rows.length)throw new CaseAppealAccessError();
   await requireRecentSessionMfa(principal,new AuthAccessRepository(tx),new Date((await tx.query<{now:Date|string}>("SELECT clock_timestamp() AS now")).rows[0].now));
   const iso=new Date().toISOString(),version=input.version+1;
   const updated=await tx.query<AppealRow>(`UPDATE assurance_case_appeals
       SET status=$2,version=$3,reviewer_account_id=$4,review_reason=$5,reviewed_at=$6,updated_at=$6
       WHERE appeal_id=$1 AND version=$7 AND status IN ('submitted','under_review') RETURNING ${columns}`,
       [input.appealId,input.status,version,principal.accountId,reason,iso,input.version]);
   if(!updated.rows.length)throw new CaseAppealConflictError("Appeal history changed. Reload before reviewing.");
   await tx.query(`INSERT INTO assurance_case_appeal_events(appeal_id,version,status,actor_account_id,reason,occurred_at)
     VALUES($1,$2,$3,$4,$5,$6)`,[input.appealId,version,input.status,principal.accountId,reason,iso]);
   return map(updated.rows[0]);
  });
 }
}
