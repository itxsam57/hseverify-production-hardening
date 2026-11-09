import "server-only";
import {getServerEnvironment} from "../config/server-environment";
import {authorizeSecureFileAccessCore,readSecureFileAccessCore,type SecureFileAccessLookup} from "../secure-files/secure-file-access-core";
import {createRuntimePrivateObjectStorage} from "../secure-files/private-object-storage";
import {secureFileFromRow,type SecureFileRow} from "../secure-files/secure-file-repository";
import {SecureFileAccessDeniedError} from "../secure-files/secure-file-access-domain";
import {appendSecureFileAccessAudit} from "../secure-files/secure-file-access-audit";
import {DatabaseAuditRepository} from "../audit/audit-repository";
import {findAppealInterviewContext} from "./appeal-interview-context";
import { randomBytes } from "node:crypto";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import { CredentialAppealsRepository } from "./credential-appeals-repository";
import type { CredentialAppeal } from "./credential-appeals-domain";
import { InterviewSchedulingService } from "../interview/interview-scheduling-service";
import { InterviewAssignmentService } from "../interview/interview-assignment-service";

export type AppealEvidence={recordId:string;versionId:string;files:{fileId:string;sha256:string;byteSize:number}[]};
export type AppealFollowup = {
 requestId: string; appealId: string; appealVersion: number; kind: "evidence"|"interview";
 reason: string; interviewRequestId: string|null; responded: boolean; responseReason: string|null;
 recommendation: string|null; evidence:AppealEvidence[];
};
export class AppealFollowupAccessError extends Error { constructor(){super("Appeal followup unavailable or forbidden.");} }
export class AppealFollowupConflictError extends Error { constructor(){super("Appeal update conflict.");} }
function reason(value:string):string { const text=value.trim(); if(text.length<10 || text.length>4000)throw new Error("Provide a reason between 10 and 4000 characters.");return text; }
function version(value:number):void { if(!Number.isSafeInteger(value)||value<1||value>2147483646)throw new AppealFollowupConflictError(); }
function eventId():string {return "appeal_followup_"+randomBytes(12).toString("hex");}
async function live(database:DatabaseClient,principal:AuthorizationPrincipal,role:"admin"|"worker"|"assessor"):Promise<()=>Promise<void>> {
 if(principal.activeRole!==role || principal.tenantMembership)throw new AppealFollowupAccessError();
 const account=await database.query<{account_id:string}>(`SELECT accounts.account_id FROM auth_accounts accounts JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role=$2 WHERE accounts.account_id=$1 AND accounts.account_status='active' FOR NO KEY UPDATE OF accounts FOR UPDATE OF roles`,[principal.accountId,role]);
 if(account.rows.length!==1)throw new AppealFollowupAccessError();
 const session=await database.query<{expires_at:string|Date;revoked_at:string|Date|null;active_role:string}>("SELECT expires_at,revoked_at,active_role FROM auth_sessions WHERE session_id=$1 AND account_id=$2 FOR UPDATE",[principal.sessionId,principal.accountId]);
 const check=async()=>{const clock=await database.query<{now:string|Date}>("SELECT clock_timestamp() AS now");const row=session.rows[0];if(!row || row.active_role!==role || row.revoked_at!==null || new Date(row.expires_at).getTime()<=new Date(clock.rows[0].now).getTime())throw new AppealFollowupAccessError();};
 await check();return check;
}
async function lockedAppeal(database:DatabaseClient,appealId:string,expectedVersion:number):Promise<CredentialAppeal>{
 version(expectedVersion);
 await database.query("SELECT appeal_id FROM credential_appeals WHERE appeal_id=$1 FOR UPDATE",[appealId]);
 const appeal=await new CredentialAppealsRepository(Promise.resolve(database)).find(appealId);
 if(!appeal)throw new AppealFollowupAccessError();
 if(appeal.version!==expectedVersion || !["submitted","under_review"].includes(appeal.status))throw new AppealFollowupConflictError();
 return appeal;
}
async function source(database:DatabaseClient,appealId:string){
 const result=await database.query<{case_id:string;tenant_id:string;worker_account_id:string;worker_id:string}>(`SELECT cases.case_id,cases.tenant_id,cases.worker_account_id,credential.worker_id FROM credential_appeals appeal JOIN credential_issuances credential ON credential.credential_id=appeal.credential_id AND credential.worker_id=appeal.worker_id JOIN assurance_cases cases ON cases.credential_reference=credential.credential_id AND cases.permanent_worker_id=credential.worker_id WHERE appeal.appeal_id=$1 FOR UPDATE OF cases FOR SHARE OF credential`,[appealId]);
 if(result.rows.length!==1)throw new AppealFollowupAccessError();return result.rows[0];
}
async function pending(database:DatabaseClient,appealId:string):Promise<boolean>{const rows=await database.query(`SELECT 1 FROM credential_appeal_followup_events request WHERE request.appeal_id=$1 AND request.event_type='requested' AND NOT EXISTS(SELECT 1 FROM credential_appeal_followup_events response WHERE response.request_id=request.event_id) LIMIT 1`,[appealId]);return rows.rows.length>0;}
async function append(database:DatabaseClient,input:{appeal:CredentialAppeal;principal:AuthorizationPrincipal;kind:"evidence"|"interview";reason:string;requestId?:string;interviewRequestId?:string|null;evidence?:unknown[];recommendation?:string|null}){
 const id=eventId();const at=new Date().toISOString();
 await database.query(`INSERT INTO credential_appeal_followup_events(event_id,appeal_id,appeal_version,event_type,request_id,kind,actor_account_id,reason,evidence,interview_request_id,recommendation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,[id,input.appeal.appealId,input.appeal.version+1,input.requestId ? input.kind==="evidence"?"evidence_submitted":"interview_submitted":"requested",input.requestId??null,input.kind,input.principal.accountId,input.reason,JSON.stringify(input.evidence??[]),input.interviewRequestId??null,input.recommendation??null]);
 await new CredentialAppealsRepository(Promise.resolve(database)).updateStatus({...input.appeal,status:"under_review",version:input.appeal.version+1,reviewedAt:at,...(input.principal.activeRole==="admin"?{reviewerAccountId:input.principal.accountId,reviewReason:input.reason,outcomeAction:"none" as const}:{})});
 return id;
}
export class CredentialAppealFollowupService {
 constructor(private readonly clientPromise:Promise<DatabaseClient>=getDatabaseClient()){}
 async request(input:{principal:AuthorizationPrincipal;appealId:string;expectedVersion:number;kind:"evidence"|"interview";reason:string}):Promise<AppealFollowup>{
  const text=reason(input.reason);if(!["evidence","interview"].includes(input.kind))throw new Error("Invalid appeal followup kind.");
  const db=await this.clientPromise;return db.transaction(async transaction=>{
   const check=await live(transaction,input.principal,"admin"),scope=await source(transaction,input.appealId);
   const appeal=await lockedAppeal(transaction,input.appealId,input.expectedVersion);
   await new CredentialAppealsRepository(Promise.resolve(transaction)).assertIndependentReviewer(appeal,input.principal.accountId);
   if(await pending(transaction,appeal.appealId))throw new AppealFollowupConflictError();
   let interviewRequestId:string|null=null;
   if(input.kind==="interview"){
    const service=new InterviewSchedulingService(transaction);let interview=await service.requestAdditionalInterview({tenantId:scope.tenant_id,caseId:scope.case_id,workerAccountId:scope.worker_account_id,requestedAt:new Date().toISOString(),timezone:"UTC"});
    const assignment=await new InterviewAssignmentService(transaction).evaluateAndPersist(interview.interviewRequestId,new Date());
    if(assignment.selectedAssessorAccountId)interview=await service.assignInterview({tenantId:scope.tenant_id,request:interview,assessorAccountId:assignment.selectedAssessorAccountId});
    interviewRequestId=interview.interviewRequestId;
   }
   const requestId=await append(transaction,{appeal,principal:input.principal,kind:input.kind,reason:text,interviewRequestId});await check();
   return {requestId,appealId:appeal.appealId,appealVersion:appeal.version+1,kind:input.kind,reason:text,interviewRequestId,responded:false,responseReason:null,recommendation:null,evidence:[]};
  });
 }
 async respondEvidence(input:{principal:AuthorizationPrincipal;appealId:string;requestId:string;expectedVersion:number;reason:string;evidence:readonly {recordId:string;versionId:string}[]}):Promise<void>{
  const text=reason(input.reason);const db=await this.clientPromise;return db.transaction(async transaction=>{
   const check=await live(transaction,input.principal,"worker"),scope=await source(transaction,input.appealId);
   if(scope.worker_account_id!==input.principal.accountId)throw new AppealFollowupAccessError();
   const appeal=await lockedAppeal(transaction,input.appealId,input.expectedVersion);
   const request=await transaction.query(`SELECT 1 FROM credential_appeal_followup_events request WHERE event_id=$1 AND appeal_id=$2 AND event_type='requested' AND kind='evidence' AND NOT EXISTS(SELECT 1 FROM credential_appeal_followup_events response WHERE response.request_id=request.event_id)`,[input.requestId,appeal.appealId]);
   if(request.rows.length!==1)throw new AppealFollowupConflictError();
   if(!input.evidence.length || input.evidence.length>20 || new Set(input.evidence.map(x=>x.recordId)).size!==input.evidence.length)throw new Error("Select between 1 and 20 current scanned evidence records.");
   const bindings:unknown[]=[];
   for(const item of input.evidence){
    const owned=await transaction.query(`SELECT records.record_id FROM worker_evidence_records records JOIN worker_evidence_versions versions ON versions.version_id=records.current_version_id AND versions.record_id=records.record_id WHERE records.record_id=$1 AND records.worker_account_id=$2 AND versions.version_id=$3 AND versions.version_status='submitted' AND records.lifecycle_status<>'inactive' FOR SHARE OF records,versions`,[item.recordId,input.principal.accountId,item.versionId]);
    if(owned.rows.length!==1)throw new AppealFollowupAccessError();
    const attachments=await transaction.query<{file_id:string;content_sha256:string;lifecycle_status:string;owner_account_id:string;owner_role:string;byte_size:number|string}>(`SELECT files.file_id,files.content_sha256,files.lifecycle_status,files.owner_account_id,files.owner_role,files.byte_size FROM worker_evidence_attachments attachments JOIN platform_secure_files files ON files.file_id=attachments.secure_file_id WHERE attachments.record_id=$1 AND attachments.version_id=$2 AND attachments.superseded_at IS NULL FOR SHARE OF attachments,files`,[item.recordId,item.versionId]);
    if(!attachments.rows.length || attachments.rows.some(file=>file.lifecycle_status!=="available" || file.owner_account_id!==input.principal.accountId || file.owner_role!=="worker" || !file.content_sha256 || Number(file.byte_size)<=0))throw new AppealFollowupAccessError();
    bindings.push({recordId:item.recordId,versionId:item.versionId,files:attachments.rows.map(file=>({fileId:file.file_id,sha256:file.content_sha256,byteSize:Number(file.byte_size)}))});
   }
   await append(transaction,{appeal,principal:input.principal,kind:"evidence",reason:text,requestId:input.requestId,evidence:bindings});await check();
  });
 }
 async respondInterview(input:{principal:AuthorizationPrincipal;interviewRequestId:string;recommendationEventId:string}):Promise<void>{
  const db=await this.clientPromise;return db.transaction(async transaction=>{
   const check=await live(transaction,input.principal,"assessor");
   const preliminary=await findAppealInterviewContext(transaction,input.interviewRequestId);if(!preliminary)throw new AppealFollowupConflictError();
   await transaction.query("SELECT case_id FROM assurance_cases WHERE case_id=$1 AND tenant_id=$2 FOR UPDATE",[preliminary.case_id,preliminary.tenant_id]);
   const context=await findAppealInterviewContext(transaction,input.interviewRequestId,true);if(!context)throw new AppealFollowupConflictError();
   const appeal=await lockedAppeal(transaction,context.appeal_id,Number(context.appeal_version));
   const result=await transaction.query<{recommendation:string;scorecard:Record<string,unknown>}>(`SELECT event.recommendation,draft.scorecard FROM interview_recommendation_events event
    JOIN interview_requests request ON request.interview_request_id=event.interview_request_id AND request.assessor_account_id=event.assessor_account_id AND request.status='COMPLETED'
    JOIN interview_runtime_sessions runtime ON runtime.interview_request_id=request.interview_request_id AND runtime.status='ENDED'
    JOIN interview_console_drafts draft ON draft.interview_request_id=request.interview_request_id AND draft.submitted=TRUE AND draft.recommendation=event.recommendation
    WHERE event.event_id=$1 AND event.interview_request_id=$2 AND event.assessor_account_id=$3 AND event.case_id=$4 AND event.tenant_id=$5 FOR SHARE OF event,request,runtime,draft`,[input.recommendationEventId,input.interviewRequestId,input.principal.accountId,context.case_id,context.tenant_id]);
   if(result.rows.length!==1)throw new AppealFollowupAccessError();
   const outcome=result.rows[0],comments=typeof outcome.scorecard.comments==="string"?outcome.scorecard.comments.trim():"",text=reason(comments.length<10?"Assessor response: "+comments:comments);
   await append(transaction,{appeal,principal:input.principal,kind:"interview",reason:text,requestId:context.followup_request_id,interviewRequestId:input.interviewRequestId,recommendation:outcome.recommendation});await check();
  });
 }
 async previewEvidence(principal:AuthorizationPrincipal,appealId:string,requestId:string,fileId:string){
  const db=await this.clientPromise;
  const lookup:SecureFileAccessLookup={findForPrincipal:async(actor,ref)=>db.transaction(async transaction=>{
   const check=await live(transaction,actor,"admin");
   const appeal=await new CredentialAppealsRepository(Promise.resolve(transaction)).find(appealId);
   if(!appeal)throw new AppealFollowupAccessError();
   await new CredentialAppealsRepository(Promise.resolve(transaction)).assertIndependentReviewer(appeal,actor.accountId);
   const files=await transaction.query<SecureFileRow>(`SELECT DISTINCT files.* FROM credential_appeal_followup_events response
    JOIN credential_appeal_followup_events request ON request.event_id=response.request_id AND request.appeal_id=response.appeal_id AND request.event_type='requested' AND request.kind='evidence'
    JOIN credential_appeals appeal ON appeal.appeal_id=response.appeal_id
    JOIN credential_issuances credential ON credential.credential_id=appeal.credential_id AND credential.worker_id=appeal.worker_id
    JOIN assurance_cases cases ON cases.credential_reference=credential.credential_id AND cases.permanent_worker_id=credential.worker_id
    CROSS JOIN LATERAL jsonb_array_elements(response.evidence) binding
    CROSS JOIN LATERAL jsonb_array_elements(binding->'files') frozen
    JOIN worker_evidence_records records ON records.record_id=binding->>'recordId' AND records.worker_account_id=cases.worker_account_id
    JOIN worker_evidence_versions versions ON versions.version_id=binding->>'versionId' AND versions.record_id=records.record_id
    JOIN worker_evidence_attachments attachments ON attachments.record_id=records.record_id AND attachments.version_id=versions.version_id AND attachments.secure_file_id=frozen->>'fileId'
    JOIN platform_secure_files files ON files.file_id=attachments.secure_file_id AND files.owner_account_id=cases.worker_account_id AND files.owner_role='worker' AND files.tenant_id IS NULL AND files.membership_id IS NULL AND files.lifecycle_status='available'
      AND files.content_sha256=frozen->>'sha256' AND files.byte_size::text=frozen->>'byteSize'
    WHERE response.appeal_id=$1 AND response.request_id=$2 AND response.event_type='evidence_submitted' AND response.actor_account_id=cases.worker_account_id AND files.file_id=$3`,[appealId,requestId,ref]);
   await check();return files.rows.length===1?secureFileFromRow(files.rows[0]):null;
  })};
  const environment=getServerEnvironment(),repository=new DatabaseAuditRepository(Promise.resolve(db));
  const issued=await authorizeSecureFileAccessCore({principal,fileRef:fileId,purpose:"preview",signingSecret:environment.sessionSecret,repository:lookup});
  await appendSecureFileAccessAudit({principal,action:"secure_file.access.authorized",fileRef:fileId,purpose:"preview",expiresAt:issued.expiresAt,repository});
  const content=await readSecureFileAccessCore({principal,token:issued.token,expectedPurpose:"preview",signingSecret:environment.sessionSecret,repository:lookup,storage:createRuntimePrivateObjectStorage(environment.appEnvironment)});
  if(!await lookup.findForPrincipal(principal,fileId))throw new SecureFileAccessDeniedError();
  await appendSecureFileAccessAudit({principal,action:"secure_file.access.served",fileRef:fileId,purpose:"preview",byteSize:content.bytes.byteLength,repository});return content;
 }
 async list(principal:AuthorizationPrincipal,appealId:string):Promise<AppealFollowup[]>{
  const db=await this.clientPromise;return db.transaction(async transaction=>{
   if(principal.activeRole!=="admin" && principal.activeRole!=="worker")throw new AppealFollowupAccessError();
   const check=await live(transaction,principal,principal.activeRole);
   const owned=await transaction.query(`SELECT 1 FROM credential_appeals appeal JOIN assurance_cases cases ON cases.credential_reference=appeal.credential_id AND cases.permanent_worker_id=appeal.worker_id WHERE appeal.appeal_id=$1 AND ($2='admin' OR cases.worker_account_id=$3)`,[appealId,principal.activeRole,principal.accountId]);
   if(owned.rows.length!==1)throw new AppealFollowupAccessError();
   const rows=await transaction.query<{event_id:string;appeal_version:number;kind:"evidence"|"interview";reason:string;interview_request_id:string|null;response_reason:string|null;recommendation:string|null;responded:boolean;evidence:AppealEvidence[]|null}>(`SELECT request.event_id,request.appeal_version,request.kind,request.reason,COALESCE(response.interview_request_id,current_interview.interview_request_id,request.interview_request_id) AS interview_request_id,response.reason AS response_reason,response.recommendation,response.evidence,response.event_id IS NOT NULL AS responded FROM credential_appeal_followup_events request LEFT JOIN credential_appeal_followup_events response ON response.request_id=request.event_id LEFT JOIN LATERAL(WITH RECURSIVE chain AS(SELECT interview_request_id FROM interview_requests WHERE interview_request_id=request.interview_request_id UNION SELECT successor.interview_request_id FROM interview_requests successor JOIN chain previous ON successor.replaces_interview_request_id=previous.interview_request_id) SELECT chain.interview_request_id FROM chain WHERE NOT EXISTS(SELECT 1 FROM interview_requests successor WHERE successor.replaces_interview_request_id=chain.interview_request_id) LIMIT 1)current_interview ON request.kind='interview' WHERE request.appeal_id=$1 AND request.event_type='requested' ORDER BY request.appeal_version`,[appealId]);await check();
   return rows.rows.map(row=>({requestId:row.event_id,appealId,appealVersion:Number(row.appeal_version),kind:row.kind,reason:row.reason,interviewRequestId:row.interview_request_id,responded:row.responded,responseReason:row.response_reason,recommendation:row.recommendation,evidence:row.evidence??[]}));
  });
 }
}
