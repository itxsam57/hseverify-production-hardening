import "server-only";
import type {AuthorizationPrincipal} from "../authorization/authorization-context-domain";
import {getDatabaseClient,type DatabaseClient} from "../database/database";
import {createIdentifier} from "../auth/auth-domain";
import {AuthAccessRepository} from "../auth/auth-access-repository";
import {requireRecentSessionMfa} from "../auth/recent-mfa-service";
import {CaseAppealAccessError,CaseAppealConflictError} from "./case-appeal-service";

type RequestRow={request_id:string;appeal_id:string;appeal_version:number;reason:string;requested_by_account_id:string;
 created_at:Date|string;response_version:number|null;response_reason:string|null;response_actor:string|null};
export type CaseAppealEvidenceRequest=Readonly<{requestId:string;appealId:string;requestVersion:number;
 reason:string;requestedByAccountId:string;createdAt:string;responded:boolean;responseVersion:number|null;
 responseReason:string|null;responseActor:string|null}>;
type AppealRow={appeal_id:string;case_id:string;tenant_id:string;worker_account_id:string;decision_id:string;
 status:string;version:number;reviewer_account_id:string|null;review_reason:string|null};
function id(value:string){return /^case_appeal_[A-Za-z0-9_-]{24}$/.test(value);}
function validVersion(value:number){return Number.isSafeInteger(value)&&value>=1&&value<2147483646;}
function admin(p:AuthorizationPrincipal){if(p.activeRole!=="admin"||p.accountStatus!=="active"||p.tenantMembership!==null)throw new CaseAppealAccessError();}
function worker(p:AuthorizationPrincipal){if(p.activeRole!=="worker"||p.accountStatus!=="active"||p.tenantMembership!==null)throw new CaseAppealAccessError();}
function text(value:string){const s=value.trim();if(s.length<10||s.length>4000)throw new CaseAppealConflictError("Followup reason must contain 10 to 4000 characters.");return s;}
async function independent(tx:DatabaseClient,actor:AuthorizationPrincipal,appeal:AppealRow){
 const result=await tx.query<{account_id:string|null;override_actor:string|null}>(`
 SELECT (SELECT event.actor_account_id FROM assurance_case_timeline_events event
  WHERE event.case_id=cases.case_id AND event.tenant_id=cases.tenant_id
   AND event.event_type='decision_recorded' ORDER BY event.occurred_at DESC LIMIT 1) AS account_id,
 (SELECT override.actor_reference FROM platform_decision_overrides override
  WHERE override.decision_id=cases.decision_reference ORDER BY override.created_at DESC LIMIT 1) AS override_actor
 FROM assurance_cases cases JOIN platform_decisions decision
 ON decision.decision_id=cases.decision_reference AND decision.tenant_id=cases.tenant_id AND decision.case_id=cases.case_id
 WHERE cases.case_id=$1 AND cases.tenant_id=$2 AND cases.worker_account_id=$3
 AND cases.decision_reference=$4 AND cases.case_status='Rejected' AND cases.credential_reference IS NULL
 AND decision.state='REJECTED' FOR UPDATE OF cases`,
 [appeal.case_id,appeal.tenant_id,appeal.worker_account_id,appeal.decision_id]);
 const first=result.rows[0];if(!first?.account_id||[appeal.worker_account_id,first.account_id,first.override_actor].includes(actor.accountId))throw new CaseAppealAccessError();
}
async function current(tx:DatabaseClient,appealId:string):Promise<AppealRow>{
 const rows=await tx.query<AppealRow>(`SELECT appeal_id,case_id,tenant_id,worker_account_id,decision_id,status,
 version,reviewer_account_id,review_reason FROM assurance_case_appeals WHERE appeal_id=$1 FOR UPDATE`,[appealId]);
 if(!rows.rows[0])throw new CaseAppealAccessError();return rows.rows[0];
}
async function append(tx:DatabaseClient,input:{appealId:string;version:number;actorId:string;reason:string;status:string;at:string}){
 await tx.query(`INSERT INTO assurance_case_appeal_events(appeal_id,version,status,actor_account_id,reason,occurred_at)
 VALUES($1,$2,$3,$4,$5,$6)`,[input.appealId,input.version,input.status,input.actorId,input.reason,input.at]);
}
function map(row:RequestRow):CaseAppealEvidenceRequest{return Object.freeze({
 requestId:row.request_id,appealId:row.appeal_id,requestVersion:Number(row.appeal_version),
 reason:row.reason,requestedByAccountId:row.requested_by_account_id,
 createdAt:new Date(row.created_at).toISOString(),responded:row.response_version!==null,
 responseVersion:row.response_version===null?null:Number(row.response_version),
 responseReason:row.response_reason,responseActor:row.response_actor
});}
export class CaseAppealEvidenceFollowupService{
 constructor(private readonly databasePromise:Promise<DatabaseClient>=getDatabaseClient()){}
 async listInterviews(principal:AuthorizationPrincipal,appealId:string):Promise<readonly {interviewRequestId:string;reason:string;requestedAt:string;assessorId:string|null;status:string;recommendation:string|null}[]>{
  if(!id(appealId))throw new CaseAppealAccessError();
  if(principal.activeRole==="worker")worker(principal);else admin(principal);
  const db=await this.databasePromise;
  const owner=await db.query<{worker_account_id:string}>("SELECT worker_account_id FROM assurance_case_appeals WHERE appeal_id=$1",[appealId]);
  if(owner.rows.length!==1||(principal.activeRole==="worker"&&owner.rows[0].worker_account_id!==principal.accountId))throw new CaseAppealAccessError();
  const rows=await db.query<{interview_request_id:string;reason:string;created_at:Date|string;assessor_account_id:string|null;status:string;recommendation:string|null}>(`
   SELECT current_request.interview_request_id,link.reason,link.created_at,
    current_request.assessor_account_id,current_request.status,outcome.recommendation
   FROM assurance_case_appeal_interview_requests link
   JOIN LATERAL (
     WITH RECURSIVE chain AS(
       SELECT root.interview_request_id,root.replaces_interview_request_id,root.assessor_account_id,root.status,0 AS depth
       FROM interview_requests root WHERE root.interview_request_id=link.interview_request_id
       UNION ALL
       SELECT replacement.interview_request_id,replacement.replaces_interview_request_id,
         replacement.assessor_account_id,replacement.status,chain.depth+1
       FROM interview_requests replacement JOIN chain ON replacement.replaces_interview_request_id=chain.interview_request_id
     )
     SELECT * FROM chain ORDER BY depth DESC LIMIT 1
   ) current_request ON true
   LEFT JOIN assurance_case_appeal_interview_outcomes outcome ON outcome.interview_request_id=link.interview_request_id
   WHERE link.appeal_id=$1 ORDER BY link.appeal_version`,[appealId]);
  return Object.freeze(rows.rows.map(row=>Object.freeze({interviewRequestId:row.interview_request_id,reason:row.reason,
   requestedAt:new Date(row.created_at).toISOString(),assessorId:row.assessor_account_id,status:row.status,
   recommendation:row.recommendation})));
 }
 async requestInterview(principal:AuthorizationPrincipal,input:{appealId:string;expectedVersion:number;reason:string}):Promise<{interviewRequestId:string;assessorId:string|null}>{
  admin(principal);if(!id(input.appealId))throw new CaseAppealAccessError();
  if(!validVersion(input.expectedVersion))throw new CaseAppealConflictError("Appeal version changed. Reload.");
  const reason=text(input.reason),db=await this.databasePromise;
  return db.transaction(async tx=>{
   const a=await current(tx,input.appealId);
   if(a.version!==input.expectedVersion||!["submitted","under_review"].includes(a.status))throw new CaseAppealConflictError("Appeal version changed. Reload.");
   if(a.reviewer_account_id&&a.reviewer_account_id!==principal.accountId)throw new CaseAppealAccessError();
   await independent(tx,principal,a);
   const pendingEvidence=await tx.query(`SELECT 1 FROM assurance_case_appeal_evidence_requests request WHERE request.appeal_id=$1
    AND NOT EXISTS(SELECT 1 FROM assurance_case_appeal_evidence_responses response WHERE response.request_id=request.request_id) LIMIT 1`,[a.appeal_id]);
   const pendingInterview=await tx.query(`SELECT 1 FROM assurance_case_appeal_interview_requests request WHERE request.appeal_id=$1
    AND NOT EXISTS(SELECT 1 FROM assurance_case_appeal_interview_outcomes response WHERE response.interview_request_id=request.interview_request_id) LIMIT 1`,[a.appeal_id]);
   if(pendingEvidence.rows.length||pendingInterview.rows.length)throw new CaseAppealConflictError("Resolve the current appeal followup before requesting another.");
   await requireRecentSessionMfa(principal,new AuthAccessRepository(tx),new Date());
   const now=new Date().toISOString(),version=a.version+1;
   const {InterviewSchedulingService}=await import("../interview/interview-scheduling-service");
   const {InterviewAssignmentService}=await import("../interview/interview-assignment-service");
   const scheduling=new InterviewSchedulingService(tx);
   let interview=await scheduling.requestAdditionalInterview({tenantId:a.tenant_id,caseId:a.case_id,workerAccountId:a.worker_account_id,requestedAt:now,timezone:"UTC"});
   const assignment=await new InterviewAssignmentService(tx).evaluateAndPersist(interview.interviewRequestId,new Date(now));
   if(assignment.selectedAssessorAccountId)interview=await scheduling.assignInterview({tenantId:a.tenant_id,request:interview,assessorAccountId:assignment.selectedAssessorAccountId});
   const updated=await tx.query(`UPDATE assurance_case_appeals SET status='under_review',version=$2,reviewer_account_id=$3,
    review_reason=$4,reviewed_at=$5,updated_at=$5 WHERE appeal_id=$1 AND version=$6
    AND status IN ('submitted','under_review') RETURNING appeal_id`,[a.appeal_id,version,principal.accountId,reason,now,a.version]);
   if(updated.rows.length!==1)throw new CaseAppealConflictError("Appeal version changed. Reload.");
   await append(tx,{appealId:a.appeal_id,version,actorId:principal.accountId,reason,status:"under_review",at:now});
   await tx.query(`INSERT INTO assurance_case_appeal_interview_requests(appeal_id,appeal_version,interview_request_id,requested_by_account_id,reason,created_at)
    VALUES($1,$2,$3,$4,$5,$6)`,[a.appeal_id,version,interview.interviewRequestId,principal.accountId,reason,now]);
   return {interviewRequestId:interview.interviewRequestId,assessorId:interview.assessorAccountId};
  });
 }
 async respondInterview(principal:AuthorizationPrincipal,input:{interviewRequestId:string;recommendationEventId:string}):Promise<void>{
  if(principal.activeRole!=="assessor"||principal.accountStatus!=="active"||principal.tenantMembership!==null)throw new CaseAppealAccessError();
  const db=await this.databasePromise;
  await db.transaction(async tx=>{
   const {findAppealInterviewContext}=await import("../credential/appeal-interview-context");
   const context=await findAppealInterviewContext(tx,input.interviewRequestId,true);
   if(!context||context.kind!=="case")throw new CaseAppealConflictError("The rejected-case appeal interview is unavailable or already completed.");
   const a=await current(tx,context.appeal_id);
   if(a.status!=="under_review"||!a.reviewer_account_id||a.version!==context.appeal_version)throw new CaseAppealConflictError("Appeal version changed. Reload.");
   const old=await tx.query<{interview_request_id:string;requested_by_account_id:string}>(`SELECT interview_request_id,requested_by_account_id FROM assurance_case_appeal_interview_requests
    WHERE appeal_id=$1 AND interview_request_id=$2`,[a.appeal_id,context.followup_request_id]);
   if(old.rows.length!==1||old.rows[0].requested_by_account_id!==a.reviewer_account_id)throw new CaseAppealAccessError();
   const verified=await tx.query<{recommendation:string;scorecard:Record<string,unknown>}>(`
    SELECT recommendation.recommendation,draft.scorecard FROM interview_recommendation_events recommendation
    JOIN interview_requests interview ON interview.interview_request_id=recommendation.interview_request_id
      AND interview.status='COMPLETED' AND interview.assessor_account_id=recommendation.assessor_account_id
    JOIN interview_runtime_sessions runtime ON runtime.interview_request_id=interview.interview_request_id
      AND runtime.status='ENDED'
    JOIN interview_console_drafts draft ON draft.interview_request_id=interview.interview_request_id
      AND draft.tenant_id=interview.tenant_id AND draft.submitted=TRUE
      AND draft.recommendation=recommendation.recommendation
    WHERE recommendation.event_id=$1 AND recommendation.interview_request_id=$2
      AND recommendation.assessor_account_id=$3 AND recommendation.tenant_id=$4
      AND recommendation.case_id=$5 FOR SHARE OF recommendation,interview,runtime,draft`,
    [input.recommendationEventId,input.interviewRequestId,principal.accountId,context.tenant_id,context.case_id]);
   if(verified.rows.length!==1)throw new CaseAppealAccessError();
   const data=verified.rows[0],reason=typeof data.scorecard.comments==="string"&&data.scorecard.comments.trim().length>=10?
    data.scorecard.comments.trim():"Independent Assessor recorded the completed interview recommendation.";
   const now=new Date().toISOString(),version=a.version+1;
   const updated=await tx.query(`UPDATE assurance_case_appeals SET version=$2,updated_at=$3 WHERE appeal_id=$1
    AND version=$4 AND status='under_review' RETURNING appeal_id`,[a.appeal_id,version,now,a.version]);
   if(updated.rows.length!==1)throw new CaseAppealConflictError("Appeal version changed. Reload.");
   await append(tx,{appealId:a.appeal_id,version,actorId:principal.accountId,reason,status:"under_review",at:now});
   await tx.query(`INSERT INTO assurance_case_appeal_interview_outcomes(interview_request_id,appeal_id,appeal_version,
     recommendation_event_id,assessor_account_id,recommendation,reason,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [context.followup_request_id,a.appeal_id,version,input.recommendationEventId,principal.accountId,data.recommendation,reason,now]);
  });
 }
 async list(principal:AuthorizationPrincipal,appealId:string):Promise<readonly CaseAppealEvidenceRequest[]>{
  if(!id(appealId))throw new CaseAppealAccessError();
  if(principal.activeRole==="worker")worker(principal);else admin(principal);
  const db=await this.databasePromise;
  const owner=await db.query<{worker_account_id:string}>(`SELECT worker_account_id FROM assurance_case_appeals WHERE appeal_id=$1`,[appealId]);
  if(owner.rows.length!==1||(principal.activeRole==="worker"&&owner.rows[0].worker_account_id!==principal.accountId))throw new CaseAppealAccessError();
  const rows=await db.query<RequestRow>(`SELECT req.request_id,req.appeal_id,req.appeal_version,req.reason,req.requested_by_account_id,req.created_at,
    response.appeal_version AS response_version,response.reason AS response_reason,response.responded_by_account_id AS response_actor
    FROM assurance_case_appeal_evidence_requests req LEFT JOIN assurance_case_appeal_evidence_responses response ON response.request_id=req.request_id
    WHERE req.appeal_id=$1 ORDER BY req.appeal_version,req.request_id`,[appealId]);
  return Object.freeze(rows.rows.map(map));
 }
 async request(principal:AuthorizationPrincipal,input:{appealId:string;expectedVersion:number;reason:string}):Promise<CaseAppealEvidenceRequest>{
  admin(principal);if(!id(input.appealId))throw new CaseAppealAccessError();
  if(!validVersion(input.expectedVersion))throw new CaseAppealConflictError("Appeal version changed. Reload.");const reason=text(input.reason);
  const db=await this.databasePromise;
  return db.transaction(async tx=>{
   const a=await current(tx,input.appealId);
   if(a.version!==input.expectedVersion||!["submitted","under_review"].includes(a.status))throw new CaseAppealConflictError("Appeal version changed. Reload.");
   if(a.reviewer_account_id&&a.reviewer_account_id!==principal.accountId)throw new CaseAppealAccessError();
   await independent(tx,principal,a);
   const pending=await tx.query(`SELECT 1 FROM assurance_case_appeal_evidence_requests req
    WHERE req.appeal_id=$1 AND NOT EXISTS(SELECT 1 FROM assurance_case_appeal_evidence_responses response WHERE response.request_id=req.request_id) LIMIT 1`,[a.appeal_id]);
   if(pending.rows.length)throw new CaseAppealConflictError("Resolve the existing evidence request first.");
   await requireRecentSessionMfa(principal,new AuthAccessRepository(tx),new Date());
   const now=new Date().toISOString(),version=a.version+1,requestId=createIdentifier("case_followup");
   const updated=await tx.query(`UPDATE assurance_case_appeals SET status='under_review',version=$2,reviewer_account_id=$3,
     review_reason=$4,reviewed_at=$5,updated_at=$5 WHERE appeal_id=$1 AND version=$6
     AND status IN ('submitted','under_review') RETURNING appeal_id`,[a.appeal_id,version,principal.accountId,reason,now,a.version]);
   if(updated.rows.length!==1)throw new CaseAppealConflictError("Appeal version changed. Reload.");
   await append(tx,{appealId:a.appeal_id,version,actorId:principal.accountId,reason,status:"under_review",at:now});
   await tx.query(`INSERT INTO assurance_case_appeal_evidence_requests(request_id,appeal_id,appeal_version,reason,requested_by_account_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6)`,[requestId,a.appeal_id,version,reason,principal.accountId,now]);
   return {requestId,appealId:a.appeal_id,requestVersion:version,reason,requestedByAccountId:principal.accountId,
    createdAt:now,responded:false,responseVersion:null,responseReason:null,responseActor:null};
  });
 }
 async respond(principal:AuthorizationPrincipal,input:{appealId:string;requestId:string;expectedVersion:number;reason:string;evidenceRecordIds:readonly string[]}):Promise<void>{
  worker(principal);if(!id(input.appealId)||!/^case_followup_[A-Za-z0-9_-]{24}$/.test(input.requestId))throw new CaseAppealAccessError();
  if(!validVersion(input.expectedVersion))throw new CaseAppealConflictError("Appeal version changed. Reload.");
  const reason=text(input.reason),ids=input.evidenceRecordIds;
  if(ids.length<1||ids.length>10||new Set(ids).size!==ids.length)throw new CaseAppealConflictError("Select 1 to 10 distinct scanned evidence records.");
  const db=await this.databasePromise;
  await db.transaction(async tx=>{
   const a=await current(tx,input.appealId);
   if(a.worker_account_id!==principal.accountId)throw new CaseAppealAccessError();
   if(a.version!==input.expectedVersion||a.status!=="under_review"||!a.reviewer_account_id)throw new CaseAppealConflictError("Appeal version changed. Reload.");
   const pending=await tx.query(`SELECT 1 FROM assurance_case_appeal_evidence_requests request WHERE request.request_id=$1 AND request.appeal_id=$2
    AND NOT EXISTS(SELECT 1 FROM assurance_case_appeal_evidence_responses response WHERE response.request_id=request.request_id)
    FOR SHARE OF request`,[input.requestId,a.appeal_id]);
   if(pending.rows.length!==1)throw new CaseAppealConflictError("Evidence request was already answered or is unavailable.");
   const files:{recordId:string;versionId:string;fileId:string;sha:string;size:number}[]=[];
   for(const recordId of ids){
    const r=await tx.query<{record_id:string;version_id:string;file_id:string;content_sha256:string;byte_size:string|number}>(`
     SELECT record.record_id,version.version_id,files.file_id,files.content_sha256,files.byte_size
     FROM worker_evidence_records record JOIN worker_evidence_versions version ON
      version.version_id=record.current_version_id AND version.record_id=record.record_id AND version.version_status='submitted'
     JOIN worker_evidence_attachments attachment ON attachment.record_id=record.record_id AND attachment.version_id=version.version_id
       AND attachment.superseded_at IS NULL
     JOIN platform_secure_files files ON files.file_id=attachment.secure_file_id
      AND files.owner_account_id=record.worker_account_id AND files.owner_role='worker'
      AND files.lifecycle_status='available' AND files.content_sha256~'^[0-9a-f]{64}$' AND files.byte_size>0
     WHERE record.record_id=$1 AND record.worker_account_id=$2 AND record.lifecycle_status<>'inactive'
     FOR SHARE OF record,version,attachment,files`,[recordId,principal.accountId]);
    if(r.rows.length<1||r.rows.length>10)throw new CaseAppealAccessError();
    for(const row of r.rows)files.push({recordId:row.record_id,versionId:row.version_id,fileId:row.file_id,sha:row.content_sha256,size:Number(row.byte_size)});
   }
   if(files.length>20||new Set(files.map(x=>x.fileId)).size!==files.length)throw new CaseAppealConflictError("Select distinct, valid supporting scanned files.");
   const already=await tx.query<{file_id:string}>(`SELECT file_id FROM assurance_case_appeal_evidence WHERE appeal_id=$1`,[a.appeal_id]);
   const seen=new Set(already.rows.map(row=>row.file_id));
   if(files.some(file=>seen.has(file.fileId)))throw new CaseAppealConflictError("Submit new evidence files not already attached to this appeal.");
   const at=new Date().toISOString(),version=a.version+1;
   const updated=await tx.query(`UPDATE assurance_case_appeals SET version=$2,updated_at=$3 WHERE appeal_id=$1 AND version=$4 AND status='under_review' RETURNING appeal_id`,[a.appeal_id,version,at,a.version]);
   if(updated.rows.length!==1)throw new CaseAppealConflictError("Appeal version changed. Reload.");
   await append(tx,{appealId:a.appeal_id,version,actorId:principal.accountId,reason,status:"under_review",at});
   await tx.query(`INSERT INTO assurance_case_appeal_evidence_responses(request_id,appeal_id,appeal_version,reason,responded_by_account_id,created_at)
    VALUES($1,$2,$3,$4,$5,$6)`,[input.requestId,a.appeal_id,version,reason,principal.accountId,at]);
   for(const file of files){
    await tx.query(`INSERT INTO assurance_case_appeal_evidence(appeal_id,record_id,version_id,file_id,content_sha256,byte_size,request_id,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
     [a.appeal_id,file.recordId,file.versionId,file.fileId,file.sha,file.size,input.requestId,at]);
   }
  });
 }
}
