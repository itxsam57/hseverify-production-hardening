import "server-only";
import { createIdentifier } from "../auth/auth-domain";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import { CaseAccommodationService } from "./case-accommodation-service";

type SupportActor = Readonly<{ accountId: string; sessionId: string; activeRole: string }>;
export type InterviewSupportKind = "CAPTION" | "INTERPRETATION";
export type InterviewSupportMessage = Readonly<{ messageId: string; kind: InterviewSupportKind; sourceText: string; translatedText: string | null; createdAt: string }>;
export type InterviewSupportView = Readonly<{
 role: "worker" | "assessor"; approved: boolean; sourceLanguage: string; targetLanguage: string | null;
 channels: readonly InterviewSupportKind[]; canPublish: boolean; blockedReason: string | null;
 messages: readonly InterviewSupportMessage[];
}>;
export class InterviewSupportError extends Error {
 constructor(message: string, readonly status: 400 | 401 | 403 | 409 = 403) { super(message); this.name = "InterviewSupportError"; }
}
type RequestRow = { interview_request_id: string; tenant_id: string; case_id: string; worker_account_id: string; assessor_account_id: string | null; status: string; language: string; case_worker: string; case_tenant: string; case_interview_reference: string | null; case_status: string };
type RuntimeRow = { interview_session_id: string; status: string; started_at: string | Date | null };
type SnapshotRow = { interview_session_id: string; interview_request_id: string; case_id: string; tenant_id: string; worker_account_id: string; assessor_account_id: string; captions: boolean; interpreter: boolean; source_language: string; target_language: string | null; accommodation_ids: unknown };
type MessageRow = { message_id: string; kind: InterviewSupportKind; source_text: string; translated_text: string | null; created_at: string | Date; actor_account_id: string };
const iso = (value: string | Date) => new Date(value).toISOString();
function languages(value: unknown): string[] {
 const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
 return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string").map(v => v.trim().toLowerCase()) : [];
}
function text(value: unknown): string {
 if (typeof value !== "string" || value.trim().length < 2 || value.length > 2000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) throw new InterviewSupportError("Support text must contain between 2 and 2000 plain text characters.",400);
 return value.trim();
}
function input(value: unknown): { kind: InterviewSupportKind; sourceText: string; translatedText: string | null; mutationKey: string } {
 if (!value || typeof value !== "object" || Array.isArray(value)) throw new InterviewSupportError("Support input is invalid.",400);
 const v = value as Record<string,unknown>;
 if (Object.keys(v).some(k => !["kind","sourceText","translatedText","mutationKey"].includes(k)) || (v.kind !== "CAPTION" && v.kind !== "INTERPRETATION") || typeof v.mutationKey !== "string" || !/^[A-Za-z0-9_-]{16,160}$/.test(v.mutationKey)) throw new InterviewSupportError("Support input fields are invalid.",400);
 if (v.kind === "CAPTION" && v.translatedText !== undefined && v.translatedText !== null) throw new InterviewSupportError("Caption input cannot add an interpretation field.",400);
 return {kind:v.kind,sourceText:text(v.sourceText),translatedText:v.kind === "INTERPRETATION" ? text(v.translatedText) : null,mutationKey:v.mutationKey};
}
async function authorize(db: DatabaseClient, actor: SupportActor, id: string, now: Date) {
 if (!["worker","assessor"].includes(actor.activeRole) || !id || id.length > 200) throw new InterviewSupportError("Interview support access is unavailable.");
 const live = await db.query(
  "SELECT sessions.session_id FROM auth_sessions sessions JOIN auth_accounts accounts ON accounts.account_id=sessions.account_id JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role=sessions.active_role WHERE sessions.session_id=$1 AND sessions.account_id=$2 AND sessions.active_role=$3 AND sessions.revoked_at IS NULL AND sessions.expires_at>$4 AND accounts.account_status='active' FOR SHARE OF sessions,accounts,roles",
  [actor.sessionId,actor.accountId,actor.activeRole,now.toISOString()]);
 if (!live.rows[0]) throw new InterviewSupportError("The current interview support session is unavailable.",401);
 const request = (await db.query<RequestRow>(
  "SELECT r.interview_request_id,r.tenant_id,r.case_id,r.worker_account_id,r.assessor_account_id,r.status,r.language,c.worker_account_id AS case_worker,c.tenant_id AS case_tenant,c.interview_reference AS case_interview_reference,c.case_status FROM interview_requests r JOIN assurance_cases c ON c.case_id=r.case_id WHERE r.interview_request_id=$1 FOR UPDATE OF r,c",[id])).rows[0];
 if (!request || request.case_worker !== request.worker_account_id || request.case_tenant !== request.tenant_id || request.case_interview_reference !== id || request.case_status !== 'Interview pending' ||
  (actor.activeRole === "worker" ? request.worker_account_id !== actor.accountId : request.assessor_account_id !== actor.accountId)) throw new InterviewSupportError("Interview support ownership or assignment is unavailable.");
 const runtime = (await db.query<RuntimeRow>("SELECT interview_session_id,status,started_at FROM interview_runtime_sessions WHERE interview_request_id=$1 FOR UPDATE",[id])).rows[0] ?? null;
 const snapshot = runtime ? (await db.query<SnapshotRow>("SELECT * FROM interview_accommodation_support_snapshots WHERE interview_session_id=$1",[runtime.interview_session_id])).rows[0] ?? null : null;
 if (snapshot && (snapshot.interview_request_id !== id || snapshot.case_id !== request.case_id || snapshot.tenant_id !== request.tenant_id || snapshot.worker_account_id !== request.worker_account_id || snapshot.assessor_account_id !== request.assessor_account_id)) throw new InterviewSupportError("The frozen interview support assignment changed.",409);
 const approved = snapshot ? null : await new CaseAccommodationService(Promise.resolve(db)).resolveForWorker(request.case_id,request.worker_account_id,runtime?.started_at ? new Date(runtime.started_at) : now);
 const captions = snapshot?.captions ?? approved!.adjustment.captions, interpreter = snapshot?.interpreter ?? approved!.adjustment.interpreter;
 const sourceLanguage = snapshot?.source_language ?? request.language;
 const profile = (await db.query<{primary_language: string | null}>("SELECT profile_document->'personal'->>'primaryLanguage' AS primary_language FROM worker_profiles WHERE worker_sub=$1 FOR SHARE",[request.worker_account_id])).rows[0];
 const targetLanguage = snapshot ? snapshot.target_language : profile?.primary_language?.trim() ?? null;
 const human = (await db.query<{languages: unknown; profile_status: string}>(
  "SELECT p.languages,p.profile_status FROM assessor_assignment_profiles p JOIN auth_accounts a ON a.account_id=p.assessor_account_id JOIN auth_account_roles roles ON roles.account_id=a.account_id AND roles.role='assessor' WHERE p.assessor_account_id=$1 AND a.account_status='active' FOR SHARE OF p,a,roles",[request.assessor_account_id])).rows[0];
 const capability = human?.profile_status === "ACTIVE" ? languages(human.languages) : [];
 const sourceCapable = Boolean(sourceLanguage && sourceLanguage !== "*" && capability.includes(sourceLanguage.trim().toLowerCase()));
 const targetCapable = Boolean(targetLanguage && targetLanguage !== "*" && capability.includes(targetLanguage.trim().toLowerCase()));
 const channels: InterviewSupportKind[] = [];
 if (captions && sourceCapable) channels.push("CAPTION");
 if (interpreter && sourceCapable && targetCapable) channels.push("INTERPRETATION");
 let blockedReason: string | null = null;
 if (!captions && !interpreter) blockedReason = "This case has no approved caption or interpretation support.";
 else if (!runtime || runtime.status !== "ACTIVE" || !["ASSIGNED","WAITING_ROOM"].includes(request.status)) blockedReason = "Manual support opens only while the assigned interview is ACTIVE.";
 else if (channels.length === 0) blockedReason = "The assigned Assessor has no active exact language capability for this approved support.";
 else if (interpreter && !channels.includes("INTERPRETATION")) blockedReason = "Interpretation is unavailable: the assigned Assessor needs active capability in both languages.";
 return {request,runtime,snapshot,captions,interpreter,sourceLanguage,targetLanguage,accommodationIds:snapshot?.accommodation_ids ?? approved!.accommodationIds,channels,blockedReason,
  active:Boolean(runtime?.status === "ACTIVE" && ["ASSIGNED","WAITING_ROOM"].includes(request.status))};
}
function message(row: MessageRow): InterviewSupportMessage {
 return Object.freeze({messageId:row.message_id,kind:row.kind,sourceText:row.source_text,translatedText:row.translated_text,createdAt:iso(row.created_at)});
}
export class InterviewAccommodationSupportService {
 constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}
 async read(actor: SupportActor, requestId: string, now = new Date()): Promise<InterviewSupportView> {
  const database = await this.databasePromise;
  return database.transaction(async db => {
   const a = await authorize(db,actor,requestId,now);
   const rows = a.runtime ? (await db.query<MessageRow>("SELECT message_id,kind,source_text,translated_text,created_at,actor_account_id FROM interview_accommodation_support_messages WHERE interview_session_id=$1 ORDER BY sequence_no DESC LIMIT 100",[a.runtime.interview_session_id])).rows.reverse() : [];
   return Object.freeze({role:actor.activeRole as "worker" | "assessor",approved:a.captions || a.interpreter,sourceLanguage:a.sourceLanguage,targetLanguage:a.targetLanguage,channels:Object.freeze(a.channels),canPublish:actor.activeRole === "assessor" && a.active && a.channels.length > 0,blockedReason:a.blockedReason,messages:Object.freeze(rows.map(message))});
  });
 }
 async publish(actor: SupportActor, requestId: string, value: unknown, now = new Date()): Promise<InterviewSupportMessage> {
  const v = input(value), database = await this.databasePromise;
  return database.transaction(async db => {
   const a = await authorize(db,actor,requestId,now);
   if (actor.activeRole !== "assessor") throw new InterviewSupportError("Only the assigned Assessor may publish human support.");
   if (!a.active || !a.runtime) throw new InterviewSupportError(a.blockedReason ?? "Interview is not ACTIVE.",409);
   if (!a.channels.includes(v.kind)) throw new InterviewSupportError(a.blockedReason ?? "This support channel is not approved for the current human language capability.",409);
   if (!a.snapshot) await db.query(
    "INSERT INTO interview_accommodation_support_snapshots(interview_session_id,interview_request_id,case_id,tenant_id,worker_account_id,assessor_account_id,captions,interpreter,source_language,target_language,accommodation_ids,snapshotted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)",
    [a.runtime.interview_session_id,requestId,a.request.case_id,a.request.tenant_id,a.request.worker_account_id,a.request.assessor_account_id,a.captions,a.interpreter,a.sourceLanguage,a.targetLanguage,JSON.stringify(a.accommodationIds),now.toISOString()]);
   const retry = (await db.query<MessageRow>("SELECT message_id,kind,source_text,translated_text,created_at,actor_account_id FROM interview_accommodation_support_messages WHERE interview_session_id=$1 AND mutation_key=$2",[a.runtime.interview_session_id,v.mutationKey])).rows[0];
   if (retry) {
    if (retry.actor_account_id !== actor.accountId || retry.kind !== v.kind || retry.source_text !== v.sourceText || retry.translated_text !== v.translatedText) throw new InterviewSupportError("The human support request changed; use a new mutation reference.",409);
    return message(retry);
   }
   const row = (await db.query<MessageRow>(
    "INSERT INTO interview_accommodation_support_messages(message_id,interview_session_id,actor_account_id,auth_session_id,kind,source_text,translated_text,mutation_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING message_id,kind,source_text,translated_text,created_at,actor_account_id",
    [createIdentifier("interview_support"),a.runtime.interview_session_id,actor.accountId,actor.sessionId,v.kind,v.sourceText,v.translatedText,v.mutationKey,now.toISOString()])).rows[0];
   return message(row);
  });
 }
}
