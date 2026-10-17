import "server-only";

import { createHash } from "node:crypto";
import type { DatabaseClient } from "../database/database";
import { getServerEnvironment } from "../config/server-environment";
import { createRuntimePrivateObjectStorage, type PrivateObjectStorage } from "../secure-files/private-object-storage";
import { lockSharingAccount } from "./optional-sharing-restriction";
import type { WorkerProfileRecord } from "../worker/profile-domain";
import type { PrivacyRequestReviewRow } from "./privacy-operations-repository";

export type ContactCityCorrection = Readonly<{ scope: "profile_contact_city"; city: string; expectedProfileVersion: number }>;
export type RecordingDeletion = Readonly<{ scope: "expired_recording"; recordingAssetId: string }>;
export type PrivacyExecutionAuthority = { reviewerAccountId: string; reviewerSessionId?: string; reason: string; now: string };
type Subject = { requestId: string | null; retentionJobId: string | null; workerId: string; operationId: string; scope: string; targetId: string };
type RecordingRow = {
 recording_asset_id: string; worker_account_id: string; object_key: string; status: string;
 retention_until: string | Date; legal_hold: boolean; case_id: string; tenant_id: string | null;
 case_status: string; closed_at: string | Date | null;
};
type RequestRow = PrivacyRequestReviewRow;

function object(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A supported typed privacy scope is required.");
 return value as Record<string,unknown>;
}
export function normalizeContactCityCorrection(value: unknown): ContactCityCorrection {
 const change=object(value);
 if (change.scope !== "profile_contact_city" || Object.keys(change).some(key=>!["scope","city","expectedProfileVersion"].includes(key))) {
  throw new Error("Only the supported contact city correction scope is executable.");
 }
 if (typeof change.city !== "string" || change.city.trim().length < 2 || change.city.trim().length > 100 ||
     /[\u0000-\u001f\u007f]/.test(change.city) || !Number.isSafeInteger(change.expectedProfileVersion) || Number(change.expectedProfileVersion)<1) {
  throw new Error("Correction requires a city between 2 and 100 characters and the current profile version.");
 }
 return {scope:"profile_contact_city",city:change.city.trim(),expectedProfileVersion:Number(change.expectedProfileVersion)};
}
export function normalizeRecordingDeletion(value: unknown): RecordingDeletion {
 const deletion=object(value);
 if (deletion.scope !== "expired_recording" || Object.keys(deletion).some(key=>!["scope","recordingAssetId"].includes(key)) ||
     typeof deletion.recordingAssetId !== "string" || !/^recording_asset_[A-Za-z0-9_-]{24}$/.test(deletion.recordingAssetId)) {
  throw new Error("Only the supported expired recording deletion scope is executable.");
 }
 return {scope:"expired_recording",recordingAssetId:deletion.recordingAssetId};
}
export async function assertPrivacyAdmin(tx: DatabaseClient, input: PrivacyExecutionAuthority) {
 if (!input.reviewerSessionId) throw new Error("Privacy execution requires a fresh authorized Admin session.");
 // Keep lock acquisition consistent with notification and Worker report guards:
 // account -> role -> session. A multi-table FOR SHARE join can lock the session
 // before the account, deadlocking a concurrent notification read.
 const account = await tx.query(
  `SELECT account_id FROM auth_accounts
   WHERE account_id=$1 AND account_status='active'
   FOR SHARE`,
  [input.reviewerAccountId]);
 if (account.rows.length!==1) throw new Error("Privacy execution requires a fresh authorized Admin session.");
 const role = await tx.query(
  `SELECT account_id FROM auth_account_roles
   WHERE account_id=$1 AND role='admin'
   FOR SHARE`,
  [input.reviewerAccountId]);
 if (role.rows.length!==1) throw new Error("Privacy execution requires a fresh authorized Admin session.");
 const session = await tx.query(
  `SELECT session_id FROM auth_sessions
   WHERE account_id=$1 AND session_id=$2 AND active_role='admin'
    AND revoked_at IS NULL AND expires_at>$3::timestamptz
   FOR SHARE`,
  [input.reviewerAccountId,input.reviewerSessionId,input.now]);
 if (session.rows.length!==1) throw new Error("Privacy execution requires a fresh authorized Admin session.");
}
async function event(tx: DatabaseClient, subject: Subject, authority: PrivacyExecutionAuthority,
 eventType:"APPROVED"|"EXECUTED",before:Record<string,unknown>,after:Record<string,unknown>) {
 await tx.query(
  `INSERT INTO privacy_execution_events(operation_id,event_type,request_id,retention_job_id,worker_id,
   scope,target_id,actor_account_id,actor_session_id,reason,before_state,after_state,occurred_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)`,
  [subject.operationId,eventType,subject.requestId,subject.retentionJobId,subject.workerId,subject.scope,subject.targetId,
   authority.reviewerAccountId,authority.reviewerSessionId,authority.reason,JSON.stringify(before),JSON.stringify(after),authority.now]);
}
function operationId(kind: string, id: string, target: string) {
 return "privacy_execution_"+createHash("sha256").update(kind+"\0"+id+"\0"+target).digest("hex").slice(0,24);
}

export async function executeContactCityCorrection(tx:DatabaseClient,request:RequestRow,
 input:PrivacyExecutionAuthority & {approvedCorrection?:unknown}) {
 if(request.details.correction===undefined) throw new Error("This request requires its specific fulfilment operation before completion.");
 await assertPrivacyAdmin(tx,input);
 if(input.reviewerAccountId===request.worker_id) throw new Error("Correction requires an independent Admin approval.");
 const change=normalizeContactCityCorrection(request.details.correction);
 const approved=normalizeContactCityCorrection(input.approvedCorrection);
 if(JSON.stringify(change)!==JSON.stringify(approved)) throw new Error("Admin approval must match the exact Worker requested correction.");
 const result=await tx.query<{version:number;profile_document:WorkerProfileRecord}>(
  "SELECT version,profile_document FROM worker_profiles WHERE worker_sub=$1 FOR UPDATE",[request.worker_id]);
 const row=result.rows[0],profile=row?.profile_document;
 if(!row || !profile || profile.workerSub!==request.worker_id || !profile.contact || !Array.isArray(profile.audit) ||
    row.version!==change.expectedProfileVersion || profile.version!==row.version) {
  throw new Error("The owned profile version changed or is unavailable; submit a new correction.");
 }
 if(profile.contact.city===change.city) throw new Error("The requested city already matches the current profile.");
 const subject:Subject={requestId:request.request_id,retentionJobId:null,workerId:request.worker_id,
  operationId:operationId("correction",request.request_id,request.worker_id),scope:change.scope,targetId:request.worker_id};
 const before={city:profile.contact.city,profileVersion:row.version},after={city:change.city,profileVersion:row.version+1};
 await event(tx,subject,input,"APPROVED",before,after);
 const updated:WorkerProfileRecord={...profile,contact:{...profile.contact,city:change.city},version:row.version+1,updatedAt:input.now,
  audit:[...profile.audit,{id:subject.operationId,action:"section_saved",section:"contact",occurredAt:input.now,
   actorSub:input.reviewerAccountId,fromVersion:row.version,toVersion:row.version+1,changedFields:["contact.city"]}]};
 const saved=await tx.query(
  "UPDATE worker_profiles SET version=$2,profile_document=$3::jsonb,updated_at=$4 WHERE worker_sub=$1 AND version=$5 RETURNING worker_sub",
  [request.worker_id,updated.version,JSON.stringify(updated),input.now,row.version]);
 if(saved.rows.length!==1) throw new Error("The owned profile version changed.");
 await event(tx,subject,input,"EXECUTED",before,after);
 return {...request.details,fulfilment:{method:"profile_contact_city_amendment",executedAt:input.now,profileVersion:updated.version}};
}

async function lockedRecording(tx:DatabaseClient,assetId:string,workerId:string,now:string,tenantId?:string) {
 await lockSharingAccount(tx,workerId,true);
 // Serialize appeal creation/review with this irreversible storage boundary.
 await tx.query("LOCK TABLE credential_appeals IN SHARE MODE");
 const found=await tx.query<RecordingRow>(
  `SELECT assets.*,cases.case_status,cases.closed_at FROM recording_assets assets
   JOIN assurance_cases cases ON cases.case_id=assets.case_id AND cases.worker_account_id=assets.worker_account_id
   WHERE assets.recording_asset_id=$1 AND assets.worker_account_id=$2 FOR UPDATE OF assets,cases`,[assetId,workerId]);
 const row=found.rows[0];
 if(!row || (tenantId!==undefined && row.tenant_id!==tenantId)) throw new Error("Recording does not belong to the requested Worker and tenant scope.");
 if(row.legal_hold) throw new Error("Recording erasure is blocked by a legal hold.");
 if(new Date(row.retention_until).getTime()>new Date(now).getTime()) throw new Error("Recording erasure is blocked until its retention policy expires.");
 if(row.case_status!=="Closed" || !row.closed_at) throw new Error("Recording erasure is blocked while its case remains open.");
 const appeals=await tx.query(
  `SELECT appeal_id FROM credential_appeals appeals WHERE appeals.status NOT IN ('accepted','rejected','withdrawn') AND (
   appeals.worker_id=$1 OR EXISTS(SELECT 1 FROM auth_accounts accounts WHERE accounts.account_id=$1 AND
    accounts.worker_reference=appeals.worker_id) OR EXISTS(SELECT 1 FROM worker_identity_worker_ids ids
    WHERE ids.worker_account_id=$1 AND ids.permanent_worker_id=appeals.worker_id)) LIMIT 1`,[workerId]);
 if(appeals.rows.length) throw new Error("Recording erasure is blocked by an open appeal.");
 if(!["AVAILABLE","FAILED","PURGED"].includes(row.status)) throw new Error("Recording erasure is blocked while processing is active.");
 const shared=await tx.query("SELECT file_id FROM platform_secure_files WHERE object_key=$1 LIMIT 1",[row.object_key]);
 if(shared.rows.length) throw new Error("Recording erasure is blocked because the object has another retained owner.");
 return row;
}
async function revokeCapabilities(tx:DatabaseClient,workerId:string,now:string) {
 await tx.query("UPDATE auth_sessions SET revoked_at=$2,revocation_reason='privacy_recording_erasure' WHERE account_id=$1 AND revoked_at IS NULL",[workerId,now]);
 await tx.query(`UPDATE scoped_share_links links SET revoked_at=$2 WHERE links.revoked_at IS NULL AND EXISTS(
  SELECT 1 FROM auth_accounts accounts WHERE accounts.account_id=$1 AND (
   links.owner_worker_id=accounts.worker_reference OR EXISTS(SELECT 1 FROM worker_identity_worker_ids ids
    WHERE ids.worker_account_id=accounts.account_id AND ids.permanent_worker_id=links.owner_worker_id)))`,[workerId,now]);
}

export class PrivacyExecution {
 constructor(private readonly database:DatabaseClient,private readonly storage?:PrivateObjectStorage){}
 private objects() {return this.storage??createRuntimePrivateObjectStorage(getServerEnvironment().appEnvironment);}
 private async approveRecording(tx:DatabaseClient,subject:Subject,input:PrivacyExecutionAuthority,row:RecordingRow) {
 const previous=await tx.query<{before_state:Record<string,unknown>;after_state:Record<string,unknown>}>(
  "SELECT before_state,after_state FROM privacy_execution_events WHERE operation_id=$1 AND event_type='APPROVED'",[subject.operationId]);
 if(previous.rows[0]) {
  if(previous.rows[0].before_state.objectKey!==row.object_key) throw new Error("Approved recording target changed.");
  return previous.rows[0].before_state;
 }
 if(row.status==="PURGED") throw new Error("Recording is already purged without this operation's approval.");
 const before={status:row.status,recordingAssetId:row.recording_asset_id,objectKey:row.object_key,
  retentionUntil:new Date(row.retention_until).toISOString(),legalHold:false,caseStatus:row.case_status};
 await event(tx,subject,input,"APPROVED",before,{status:"PURGED",objectErased:true});
 return before;
 }
 private async erase(tx:DatabaseClient,subject:Subject,input:PrivacyExecutionAuthority,row:RecordingRow) {
 const approval=await tx.query<{before_state:Record<string,unknown>}>(
  "SELECT before_state FROM privacy_execution_events WHERE operation_id=$1 AND event_type='APPROVED'",[subject.operationId]);
 const before=approval.rows[0]?.before_state;
 if(!before || before.objectKey!==row.object_key) throw new Error("Recording erasure requires its exact durable approval.");
 const executed=await tx.query("SELECT operation_id FROM privacy_execution_events WHERE operation_id=$1 AND event_type='EXECUTED'",[subject.operationId]);
 if(executed.rows.length) {
  if(row.status!=="PURGED" || await this.objects().stat(row.object_key)!==null) throw new Error("Completed erasure no longer matches object absence.");
  return;
 }
 const objects=this.objects();
 await objects.delete(row.object_key);
 if(await objects.stat(row.object_key)!==null) throw new Error("Recording object erasure could not be verified.");
 await tx.query("UPDATE recording_assets SET status='PURGED' WHERE recording_asset_id=$1",[row.recording_asset_id]);
 await revokeCapabilities(tx,subject.workerId,input.now);
 await event(tx,subject,input,"EXECUTED",before,{status:"PURGED",objectErased:true,sessionsRevoked:true,shareLinksRevoked:true});
 }
 async eraseRequest(input:PrivacyExecutionAuthority & {
  requestId:string;reviewId:string;expectedStatus:string;approvedDeletion?:unknown
 }) {
 const approved=normalizeRecordingDeletion(input.approvedDeletion);
 const load=async(tx:DatabaseClient)=>{
  await assertPrivacyAdmin(tx,input);
  const found=await tx.query<RequestRow>("SELECT * FROM privacy_requests WHERE request_id=$1 FOR UPDATE",[input.requestId]);
  const request=found.rows[0];
  if(!request || request.request_type!=="deletion" || request.status!==input.expectedStatus || !["OPEN","PROCESSING"].includes(request.status)) {
   throw new Error("Privacy request changed or is unavailable for this decision.");
  }
  if(input.reviewerAccountId===request.worker_id) throw new Error("Deletion requires an independent Admin approval.");
  const deletion=normalizeRecordingDeletion(request.details.deletion);
  if(JSON.stringify(deletion)!==JSON.stringify(approved)) throw new Error("Admin approval must match the exact Worker requested deletion.");
  const subject:Subject={requestId:request.request_id,retentionJobId:null,workerId:request.worker_id,scope:deletion.scope,
   targetId:deletion.recordingAssetId,operationId:operationId("deletion",request.request_id,deletion.recordingAssetId)};
  const row=await lockedRecording(tx,deletion.recordingAssetId,request.worker_id,input.now);
  return {request,subject,row};
 };
 // Approval commits before touching storage. A storage/DB failure leaves this exact plan retryable.
 await this.database.transaction(async(tx)=>{const {subject,row}=await load(tx);await this.approveRecording(tx,subject,input,row);});
 return this.database.transaction(async(tx)=>{
  const {request,subject,row}=await load(tx);await this.erase(tx,subject,input,row);
  const details={...request.details,fulfilment:{method:"expired_recording_erasure",recordingAssetId:row.recording_asset_id,executedAt:input.now,
   retained:"Identity, case metadata, decisions and audit history remain retained."}};
  const updated=await tx.query<RequestRow>("UPDATE privacy_requests SET status='COMPLETED',details=$2::jsonb,completed_at=$3 WHERE request_id=$1 AND status=$4 RETURNING *",
   [request.request_id,JSON.stringify(details),input.now,input.expectedStatus]);
  if(!updated.rows[0]) throw new Error("Privacy request review conflicted with another decision.");
  await tx.query(`INSERT INTO privacy_request_reviews(review_id,request_id,reviewer_account_id,from_status,to_status,reason,reviewed_at)
   VALUES($1,$2,$3,$4,'COMPLETED',$5,$6)`,[input.reviewId,request.request_id,input.reviewerAccountId,request.status,input.reason,input.now]);
  return updated.rows[0];
 });
 }
 async executeRetention(input:PrivacyExecutionAuthority & {id:string;tenantId:string;status:string}) {
 const load=async(tx:DatabaseClient)=>{
  await assertPrivacyAdmin(tx,input);
  const jobs=await tx.query<{job_id:string;resource_type:string;retention_before:string|Date;status:string}>(
   "SELECT * FROM retention_jobs WHERE job_id=$1 AND tenant_id=$2 FOR UPDATE",[input.id,input.tenantId]);
  const job=jobs.rows[0];
  if(!job || job.status!=="PENDING") throw new Error("Retention job changed or is unavailable.");
  if(job.resource_type!=="expired_interview_recordings") throw new Error("Retention category requires a supported policy executor; no records were purged.");
  if(new Date(job.retention_before).getTime()>new Date(input.now).getTime()) throw new Error("Retention cutoff cannot be in the future.");
  const assets=await tx.query<RecordingRow>(`SELECT assets.* FROM recording_assets assets
   WHERE assets.tenant_id=$1 AND assets.purpose='INTERVIEW' AND assets.retention_until<=$2::timestamptz
    AND (assets.status<>'PURGED' OR EXISTS(SELECT 1 FROM privacy_execution_events
     WHERE retention_job_id=$3 AND target_id=assets.recording_asset_id)) ORDER BY assets.recording_asset_id`,
   [input.tenantId,job.retention_before,input.id]);
  const targets=[];
  for(const asset of assets.rows){
   const row=await lockedRecording(tx,asset.recording_asset_id,asset.worker_account_id,input.now,input.tenantId);
   targets.push({row,subject:{requestId:null,retentionJobId:input.id,workerId:row.worker_account_id,scope:"expired_recording",
    targetId:row.recording_asset_id,operationId:operationId("retention",input.id,row.recording_asset_id)} satisfies Subject});
  }
  return targets;
 };
 await this.database.transaction(async(tx)=>{for(const {row,subject} of await load(tx)) await this.approveRecording(tx,subject,input,row);});
 return this.database.transaction(async(tx)=>{
  const targets=await load(tx);
  for(const {row,subject} of targets) await this.erase(tx,subject,input,row);
  const result={method:"expired_interview_recordings",purgedRecordings:targets.length,executedAt:input.now,historyRetained:true};
  await tx.query("UPDATE retention_jobs SET status='COMPLETED',completed_at=$3,execution_result=$4::jsonb WHERE job_id=$1 AND tenant_id=$2 AND status='PENDING'",
   [input.id,input.tenantId,input.now,JSON.stringify(result)]);
  return {...input,status:"COMPLETED" as const,executionResult:result};
 });
 }
}
