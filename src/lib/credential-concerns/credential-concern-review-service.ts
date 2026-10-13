import "server-only";

import { createHash } from "node:crypto";
import type { AuthorizationPrincipal } from "@/lib/authorization/authorization-context-domain";
import { evaluatePlatformPermission } from "@/lib/authorization/authorization-domain";
import { bindTrustedAuditActor } from "@/lib/audit/audit-domain";
import { DatabaseAuditRepository } from "@/lib/audit/audit-repository";
import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";
import { getServerEnvironment } from "@/lib/config/server-environment";
import { createRuntimePrivateObjectStorage, type PrivateObjectStorage } from "@/lib/secure-files/private-object-storage";

export class ConcernReviewAccessError extends Error {
 constructor() { super("Concern review access is unavailable."); this.name="ConcernReviewAccessError"; }
}
export class ConcernReviewInputError extends Error {
 constructor() { super("Check the review details."); this.name="ConcernReviewInputError"; }
}
export class ConcernReviewConflictError extends Error {
 constructor() { super("This concern changed. Reload before recording an amendment."); this.name="ConcernReviewConflictError"; }
}
const CONCERN=/^public_concern_[A-Za-z0-9_-]{24}$/;
const FILE=/^secure_file_[A-Za-z0-9_-]{24}$/;
const REQUEST=/^concern_review_[A-Za-z0-9_-]{24}$/;
export type ConcernReviewOutcome="reviewed_no_further_action" | "follow_up_needed";
export type ConcernReview=Readonly<{version:number;outcome:ConcernReviewOutcome;reason:string;methods:string;limitations:string;actorAccountId:string;createdAt:string}>;
export type ConcernDetail=Readonly<{
 concernId:string;category:string;description:string;contactName:string|null;contactEmail:string|null;contactPhone:string|null;createdAt:string;
 subject:Readonly<{kind:string;identifier:string;workerReference:string}>|null;
 reviews:readonly ConcernReview[];
 evidence:readonly Readonly<{fileId:string;filename:string;status:string;available:boolean}>[];
}>;
type ConcernRow={concern_id:string;category:string;description:string;contact_name:string|null;contact_email:string|null;contact_phone:string|null;created_at:string|Date;subject_kind:string|null;subject_identifier:string|null;worker_reference:string|null};
const iso=(value:string|Date)=>value instanceof Date?value.toISOString():new Date(value).toISOString();

async function requireLiveAdmin(db:DatabaseClient,principal:AuthorizationPrincipal):Promise<void> {
 if (principal.activeRole!=="admin" || principal.accountStatus!=="active" || principal.tenantMembership!==null ||
 !evaluatePlatformPermission({role:principal.activeRole,permission:"platform.operations.manage"}).allowed) throw new ConcernReviewAccessError();
 const rows=await db.query(`SELECT sessions.session_id FROM auth_sessions sessions
 JOIN auth_accounts accounts ON accounts.account_id=sessions.account_id
 JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role='admin'
 WHERE sessions.session_id=$1 AND sessions.account_id=$2 AND sessions.active_role='admin'
 AND sessions.revoked_at IS NULL AND sessions.expires_at>clock_timestamp() AND accounts.account_status='active'
 FOR SHARE OF sessions,accounts,roles`,[principal.sessionId,principal.accountId]);
 if (!rows.rows[0]) throw new ConcernReviewAccessError();
}
const SELECT=`SELECT concerns.concern_id,concerns.category,concerns.description,concerns.contact_name,concerns.contact_email,
 concerns.contact_phone,concerns.created_at,subjects.subject_kind,subjects.subject_identifier,subjects.worker_reference
 FROM public_verification_concerns concerns LEFT JOIN public_verification_concern_subjects subjects ON subjects.concern_id=concerns.concern_id`;

async function detail(db:DatabaseClient,id:string):Promise<ConcernDetail|null> {
 const row=(await db.query<ConcernRow>(SELECT+" WHERE concerns.concern_id=$1",[id])).rows[0];
 if (!row) return null;
 const reviews=await db.query<{version:number;outcome:ConcernReviewOutcome;reason:string;methods:string;limitations:string;actor_account_id:string;created_at:string|Date}>(
 "SELECT version,outcome,reason,methods,limitations,actor_account_id,created_at FROM public_verification_concern_reviews WHERE concern_id=$1 ORDER BY version",[id]);
 const evidence=await db.query<{secure_file_id:string;display_filename:string;lifecycle_status:string;candidate_status:string;owned:boolean}>(`SELECT candidates.secure_file_id,files.display_filename,files.lifecycle_status,candidates.candidate_status,
 (files.owner_account_id='account_public_concern_intake_system' AND files.owner_role='root' AND files.tenant_id IS NULL AND files.membership_id IS NULL) AS owned
 FROM public_verification_concern_evidence_candidates candidates JOIN platform_secure_files files ON files.file_id=candidates.secure_file_id
 WHERE candidates.concern_id=$1 ORDER BY candidates.created_at,candidates.candidate_id`,[id]);
 return Object.freeze({concernId:row.concern_id,category:row.category,description:row.description,contactName:row.contact_name,
 contactEmail:row.contact_email,contactPhone:row.contact_phone,createdAt:iso(row.created_at),
 subject:row.subject_kind&&row.subject_identifier&&row.worker_reference?Object.freeze({kind:row.subject_kind,identifier:row.subject_identifier,workerReference:row.worker_reference}):null,
 reviews:Object.freeze(reviews.rows.map(r=>Object.freeze({version:Number(r.version),outcome:r.outcome,reason:r.reason,methods:r.methods,limitations:r.limitations,actorAccountId:r.actor_account_id,createdAt:iso(r.created_at)}))),
 evidence:Object.freeze(evidence.rows.map(e=>Object.freeze({fileId:e.secure_file_id,filename:e.display_filename,status:e.lifecycle_status,available:e.owned&&e.candidate_status==="bound"&&e.lifecycle_status==="available"})))});
}

export class CredentialConcernReviewService {
 constructor(private readonly database:DatabaseClient,private readonly storage?:PrivateObjectStorage) {}
 async list(principal:AuthorizationPrincipal,page=1):Promise<Readonly<{items:readonly Readonly<{concernId:string;category:string;createdAt:string;linked:boolean;outcome:string|null}>[];page:number;hasNext:boolean}>> {
 if (!Number.isSafeInteger(page)||page<1||page>100000) throw new ConcernReviewInputError();
 return this.database.transaction(async db=>{
 await requireLiveAdmin(db,principal);
 const rows=await db.query<ConcernRow&{outcome:string|null}>(SELECT+` LEFT JOIN LATERAL (SELECT outcome FROM public_verification_concern_reviews WHERE concern_id=concerns.concern_id ORDER BY version DESC LIMIT 1) latest ON true
 ORDER BY concerns.created_at DESC,concerns.concern_id LIMIT 26 OFFSET $1`,[(page-1)*25]);
 return Object.freeze({items:Object.freeze(rows.rows.slice(0,25).map(r=>({concernId:r.concern_id,category:r.category,createdAt:iso(r.created_at),linked:r.subject_identifier!==null,outcome:r.outcome}))),page,hasNext:rows.rows.length>25});
 });
 }
 async get(principal:AuthorizationPrincipal,concernId:string):Promise<ConcernDetail|null> {
 if(!CONCERN.test(concernId)) throw new ConcernReviewInputError();
 return this.database.transaction(async db=>{await requireLiveAdmin(db,principal);return detail(db,concernId);});
 }
 async review(principal:AuthorizationPrincipal,input:{concernId:string;expectedVersion:number;requestId:string;outcome:unknown;reason:string;methods:string;limitations:string}):Promise<ConcernDetail> {
 if(!CONCERN.test(input.concernId)||!REQUEST.test(input.requestId)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0 ||
 !["reviewed_no_further_action","follow_up_needed"].includes(String(input.outcome))) throw new ConcernReviewInputError();
 for(const [value,max] of [[input.reason,4000],[input.methods,2000],[input.limitations,2000]] as const) {
 if(typeof value!=="string"||value!==value.trim()||value.length<10||value.length>max||/[\u0000-\u001f\u007f]/.test(value)) throw new ConcernReviewInputError();
 }
 return this.database.transaction(async db=>{
 await requireLiveAdmin(db,principal);
 if(!(await db.query("SELECT concern_id FROM public_verification_concerns WHERE concern_id=$1 FOR UPDATE",[input.concernId])).rows[0]) throw new ConcernReviewAccessError();
 const retry=(await db.query<{version:number;outcome:string;reason:string;methods:string;limitations:string;actor_account_id:string}>("SELECT version,outcome,reason,methods,limitations,actor_account_id FROM public_verification_concern_reviews WHERE concern_id=$1 AND request_id=$2",[input.concernId,input.requestId])).rows[0];
 if(retry) {
 if(Number(retry.version)!==input.expectedVersion+1||retry.outcome!==input.outcome||retry.reason!==input.reason||retry.methods!==input.methods||retry.limitations!==input.limitations||retry.actor_account_id!==principal.accountId) throw new ConcernReviewConflictError();
 return (await detail(db,input.concernId))!;
 }
 const version=Number((await db.query<{version:number}>("SELECT COALESCE(MAX(version),0) AS version FROM public_verification_concern_reviews WHERE concern_id=$1",[input.concernId])).rows[0].version);
 if(version!==input.expectedVersion) throw new ConcernReviewConflictError();
 await db.query(`INSERT INTO public_verification_concern_reviews(concern_id,version,outcome,reason,methods,limitations,actor_account_id,actor_session_id,request_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[input.concernId,version+1,input.outcome,input.reason,input.methods,input.limitations,principal.accountId,principal.sessionId,input.requestId]);
 await new DatabaseAuditRepository(Promise.resolve(db)).append(bindTrustedAuditActor(principal),{action:"public_verification.concern.reviewed",outcome:"succeeded",target:{type:"resource",reference:input.concernId},metadata:{version:version+1,reviewOutcome:input.outcome}});
 return (await detail(db,input.concernId))!;
 });
 }
 async readEvidence(principal:AuthorizationPrincipal,concernId:string,fileId:string):Promise<Readonly<{bytes:Uint8Array;mime:string;filename:string}>> {
 if(!CONCERN.test(concernId)||!FILE.test(fileId)||!this.storage) throw new ConcernReviewAccessError();
 return this.database.transaction(async db=>{
 await requireLiveAdmin(db,principal);
 const file=(await db.query<{object_key:string;display_filename:string;detected_mime:string;content_sha256:string;byte_size:number}>(`SELECT files.object_key,files.display_filename,files.detected_mime,files.content_sha256,files.byte_size
 FROM public_verification_concern_evidence_candidates candidates JOIN platform_secure_files files ON files.file_id=candidates.secure_file_id
 WHERE candidates.concern_id=$1 AND candidates.secure_file_id=$2 AND candidates.candidate_status='bound' AND files.lifecycle_status='available'
 AND files.owner_account_id='account_public_concern_intake_system' AND files.owner_role='root' AND files.tenant_id IS NULL AND files.membership_id IS NULL
 FOR SHARE OF candidates,files`,[concernId,fileId])).rows[0];
 if(!file) throw new ConcernReviewAccessError();
 const bytes=await this.storage!.read(file.object_key);
 if(!bytes||bytes.byteLength!==Number(file.byte_size)||createHash("sha256").update(bytes).digest("hex")!==file.content_sha256) throw new ConcernReviewAccessError();
 // Recheck current time after I/O while session/account/role locks remain held.
 await requireLiveAdmin(db,principal);
 await new DatabaseAuditRepository(Promise.resolve(db)).append(bindTrustedAuditActor(principal),{action:"public_verification.concern.evidence.served",outcome:"succeeded",target:{type:"resource",reference:concernId},metadata:{fileReference:fileId}});
 return Object.freeze({bytes,mime:file.detected_mime,filename:file.display_filename});
 });
 }
}
export async function getCredentialConcernReviewService(includeStorage=false):Promise<CredentialConcernReviewService> {
 const environment=getServerEnvironment();
 return new CredentialConcernReviewService(await getDatabaseClient(),includeStorage?createRuntimePrivateObjectStorage(environment.appEnvironment):undefined);
}
