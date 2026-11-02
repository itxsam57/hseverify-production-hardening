import "server-only";
import {getServerEnvironment} from "../config/server-environment";
import {authorizeSecureFileAccessCore,readSecureFileAccessCore,type SecureFileAccessLookup} from "../secure-files/secure-file-access-core";
import {createRuntimePrivateObjectStorage} from "../secure-files/private-object-storage";
import {secureFileFromRow,type SecureFileRow} from "../secure-files/secure-file-repository";
import {SecureFileAccessDeniedError} from "../secure-files/secure-file-access-domain";
import {appendSecureFileAccessAudit} from "../secure-files/secure-file-access-audit";
import type {AuthorizationPrincipal} from "../authorization/authorization-context-domain";
import type {DatabaseClient} from "../database/database";
import {bindTrustedAuditActor} from "../audit/audit-domain";
import {DatabaseAuditRepository} from "../audit/audit-repository";
import {AuthAccessRepository} from "../auth/auth-access-repository";
import {requireRecentSessionMfa,RECENT_MFA_ERROR} from "../auth/recent-mfa-service";
import {requireLiveReviewActor} from "../review/review-calibration-authority";
import {WorkerIdentityEligibilityService} from "./worker-identity-eligibility-service";
import {DatabaseWorkerIdentityEligibilityRepository} from "./worker-identity-eligibility-repository";
import {isWorkerIdentityDuplicateDisposition,WorkerIdentityEligibilityConflictError} from "./worker-identity-eligibility-domain";

type Comparison={identity_id:string;identity_version_id:string;legal_first_name:string;legal_last_name:string;date_of_birth:string;document_type:string|null;document_suffix:string|null;masked_email:string;phone_suffix:string;file_id:string|null};
export class DuplicateIdentityReviewError extends Error {}
export class DuplicateIdentityReviewService{
 constructor(private readonly database:DatabaseClient){}
 async list(principal:AuthorizationPrincipal){
  await requireLiveReviewActor(this.database,principal,"admin");
  const rows=(await this.database.query<{identity_id:string;identity_version_id:string;worker_account_id:string;display_name:string;check_id:string;revision:number;disposition:string|null}>(`SELECT identities.identity_id,versions.identity_version_id,identities.worker_account_id,accounts.display_name,checks.check_id,COALESCE(dispositions.disposition_sequence,0)::integer AS revision,dispositions.disposition
   FROM worker_identities identities JOIN auth_accounts accounts ON accounts.account_id=identities.worker_account_id
   JOIN worker_identity_versions versions ON versions.identity_id=identities.identity_id AND versions.version_number=identities.current_version_number AND versions.version_status='submitted'
   JOIN LATERAL(SELECT * FROM worker_identity_duplicate_checks WHERE identity_version_id=versions.identity_version_id ORDER BY check_sequence DESC LIMIT 1)checks ON checks.check_status='review_required'
   LEFT JOIN LATERAL(SELECT disposition,disposition_sequence FROM worker_identity_duplicate_dispositions WHERE check_id=checks.check_id ORDER BY disposition_sequence DESC LIMIT 1)dispositions ON TRUE
   WHERE identities.lifecycle_status='verified' AND NOT EXISTS(SELECT 1 FROM worker_identity_worker_ids issued WHERE issued.identity_id=identities.identity_id)
   ORDER BY checks.created_at,identities.identity_id LIMIT 100`)).rows;
  const checks=rows.map(r=>r.check_id);
  const signals=(await this.database.query<{check_id:string;candidate_identity_id:string;candidate_identity_version_id:string;signal_type:string;signal_strength:string}>("SELECT check_id,candidate_identity_id,candidate_identity_version_id,signal_type,signal_strength FROM worker_identity_duplicate_signals WHERE check_id=ANY($1::text[]) ORDER BY check_id,signal_type,candidate_identity_id",[checks])).rows;
  const history=(await this.database.query<{check_id:string;disposition:string;disposition_sequence:number;reason_code:string;reason:string|null;actor_account_id:string|null}>(`SELECT history.check_id,history.disposition,history.disposition_sequence,history.reason_code,audit.metadata->>'reason' AS reason,audit.actor_account_id FROM worker_identity_duplicate_dispositions history LEFT JOIN LATERAL(SELECT metadata,actor_account_id FROM platform_audit_events WHERE metadata->>'dispositionId'=history.disposition_id ORDER BY audit_sequence DESC LIMIT 1)audit ON TRUE WHERE history.check_id=ANY($1::text[]) ORDER BY history.check_id,history.disposition_sequence`,[checks])).rows;
  const versions=[...new Set([...rows.map(row=>row.identity_version_id),...signals.map(signal=>signal.candidate_identity_version_id)])];
  const facts=(await this.database.query<Comparison>(`SELECT versions.identity_id,versions.identity_version_id,drafts.legal_first_name,drafts.legal_last_name,drafts.date_of_birth::text,evidence.document_type,right(evidence.document_number,4) AS document_suffix,left(drafts.verified_email_normalized,1)||'***@'||split_part(drafts.verified_email_normalized,'@',2) AS masked_email,right(drafts.verified_phone_e164,4) AS phone_suffix,files.file_id
   FROM worker_identity_versions versions JOIN worker_identity_version_drafts drafts USING(identity_version_id)
   LEFT JOIN LATERAL(SELECT document_type,document_number,secure_file_id FROM worker_identity_evidence_bindings WHERE identity_version_id=versions.identity_version_id AND purpose='identity_document' AND binding_status='active' ORDER BY created_at DESC,binding_id DESC LIMIT 1)evidence ON TRUE
   LEFT JOIN platform_secure_files files ON files.file_id=evidence.secure_file_id AND files.lifecycle_status='available'
   WHERE versions.identity_version_id=ANY($1::text[])`,[versions])).rows;
  return rows.map(row=>({...row,signals:signals.filter(signal=>signal.check_id===row.check_id),history:history.filter(h=>h.check_id===row.check_id),comparison:facts.filter(fact=>fact.identity_version_id===row.identity_version_id||signals.some(signal=>signal.check_id===row.check_id&&signal.candidate_identity_version_id===fact.identity_version_id))}));
 }
 async preview(principal:AuthorizationPrincipal,checkId:string,identityVersionId:string){
  const lookup:SecureFileAccessLookup={findForPrincipal:async(actor,fileId)=>{
   const rows=await this.list(actor),review=rows.find(row=>row.check_id===checkId),fact=review?.comparison.find(item=>item.identity_version_id===identityVersionId&&item.file_id===fileId);
   if(!fact)return null;
   await requireRecentSessionMfa(actor,new AuthAccessRepository(this.database));
   const files=await this.database.query<SecureFileRow>(`SELECT files.* FROM worker_identity_versions versions JOIN worker_identities identities USING(identity_id)
    JOIN worker_identity_evidence_bindings bindings ON bindings.identity_version_id=versions.identity_version_id AND bindings.worker_account_id=identities.worker_account_id AND bindings.purpose='identity_document' AND bindings.binding_status='active'
    JOIN platform_secure_files files ON files.file_id=bindings.secure_file_id AND files.owner_account_id=identities.worker_account_id AND files.owner_role='worker' AND files.tenant_id IS NULL AND files.membership_id IS NULL AND files.lifecycle_status='available'
    WHERE versions.identity_version_id=$1 AND files.file_id=$2`,[identityVersionId,fileId]);
   return files.rows[0]?secureFileFromRow(files.rows[0]):null;
  }};
  const review=(await this.list(principal)).find(row=>row.check_id===checkId),fileId=review?.comparison.find(fact=>fact.identity_version_id===identityVersionId)?.file_id;
  if(!fileId)throw new SecureFileAccessDeniedError();
  const environment=getServerEnvironment(),repository=new DatabaseAuditRepository(Promise.resolve(this.database));
  const issued=await authorizeSecureFileAccessCore({principal,fileRef:fileId,purpose:"preview",signingSecret:environment.sessionSecret,repository:lookup});
  await appendSecureFileAccessAudit({principal,action:"secure_file.access.authorized",fileRef:fileId,purpose:"preview",expiresAt:issued.expiresAt,repository});
  const content=await readSecureFileAccessCore({principal,token:issued.token,expectedPurpose:"preview",signingSecret:environment.sessionSecret,repository:lookup,storage:createRuntimePrivateObjectStorage(environment.appEnvironment)});
  if(!await lookup.findForPrincipal(principal,fileId))throw new SecureFileAccessDeniedError();
  await appendSecureFileAccessAudit({principal,action:"secure_file.access.served",fileRef:fileId,purpose:"preview",byteSize:content.bytes.byteLength,repository});return content;
 }
 async decide(principal:AuthorizationPrincipal,input:{identityId:string;identityVersionId:string;checkId:string;expectedRevision:number;disposition:unknown;reason:string}):Promise<void>{
  const reason=input.reason.trim();
  if(reason.length<5||reason.length>2000||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!isWorkerIdentityDuplicateDisposition(input.disposition))throw new DuplicateIdentityReviewError("Choose a valid outcome and give a review reason between 5 and 2000 characters.");
  const disposition=input.disposition;
  await this.database.transaction(async database=>{
   await requireLiveReviewActor(database,principal,"admin",true);
   const requireMfa=async()=>{const clock=(await database.query<{now:string|Date}>("SELECT clock_timestamp() AS now")).rows[0];try{await requireRecentSessionMfa(principal,new AuthAccessRepository(database),new Date(clock.now));}catch(error){if(error instanceof Error&&error.message===RECENT_MFA_ERROR)throw new DuplicateIdentityReviewError("Sign in again with MFA before resolving duplicate identity eligibility.");throw error;}};
   await requireMfa();
   const identity=(await database.query<{identity_version_id:string}>(`SELECT versions.identity_version_id FROM worker_identities identities JOIN worker_identity_versions versions ON versions.identity_id=identities.identity_id AND versions.version_number=identities.current_version_number
    WHERE identities.identity_id=$1 AND identities.lifecycle_status='verified' AND versions.version_status='submitted'
    AND NOT EXISTS(SELECT 1 FROM worker_identity_worker_ids issued WHERE issued.identity_id=identities.identity_id) FOR UPDATE OF identities,versions`,[input.identityId])).rows[0];
   if(!identity||identity.identity_version_id!==input.identityVersionId)throw new DuplicateIdentityReviewError("Identity history changed; reload before reviewing.");
   const check=(await database.query<{check_id:string;check_status:string}>("SELECT check_id,check_status FROM worker_identity_duplicate_checks WHERE identity_id=$1 AND identity_version_id=$2 ORDER BY check_sequence DESC LIMIT 1 FOR UPDATE",[input.identityId,input.identityVersionId])).rows[0];
   if(!check||check.check_id!==input.checkId||check.check_status!=="review_required")throw new DuplicateIdentityReviewError("Duplicate check changed; reload before reviewing.");
   const revision=(await database.query<{revision:number}>("SELECT COALESCE(MAX(disposition_sequence),0)::integer AS revision FROM worker_identity_duplicate_dispositions WHERE check_id=$1",[input.checkId])).rows[0].revision;
   if(revision!==input.expectedRevision)throw new DuplicateIdentityReviewError("Duplicate review changed; reload before saving.");
   const eligibility=new WorkerIdentityEligibilityService(new DatabaseWorkerIdentityEligibilityRepository(Promise.resolve(database)));
   try{
    const result=await eligibility.recordDisposition({checkId:input.checkId,disposition,reasonCode:"staff_"+disposition});
    if(disposition==="continue")await eligibility.issuePermanentWorkerId(input.identityId);
    await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedAuditActor(principal),{action:"worker_identity.duplicate.disposition.recorded",outcome:"succeeded",target:{type:"worker_identity",reference:input.identityId},metadata:{duplicateReviewCheckId:input.checkId,dispositionId:result.dispositionId,disposition,revision:result.dispositionSequence,reason}});
   }catch(error){if(error instanceof WorkerIdentityEligibilityConflictError)throw new DuplicateIdentityReviewError(error.message);throw error;}
   await requireLiveReviewActor(database,principal,"admin",true);await requireMfa();
  });
 }
}
