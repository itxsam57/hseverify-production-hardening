import "server-only";
import { createIdentifier } from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import { CaseAccommodationService } from "../privacy/case-accommodation-service";
import { AssessmentAttemptConflictError,AssessmentAttemptInputError,type AssessmentAttemptRecord } from "./assessment-attempt-domain";
export type AssessmentBreakView=Readonly<{active:boolean;endsAt:string|null;remainingSeconds:number;remainingAllowanceSeconds:number;approvedAllowanceSeconds:number}>;
type BreakRow={phase_index:number|string;duration_seconds:number|string;started_at:string|Date;ends_at:string|Date;mutation_key:string};
async function hasSchema(db:DatabaseClient){return Boolean((await db.query<{name:string|null}>("SELECT to_regclass('assessment_attempt_accommodations')::text AS name")).rows[0]?.name);}
export async function snapshotAssessmentBreakAllowance(db:DatabaseClient,attempt:AssessmentAttemptRecord,now:Date){
 // Immutable historical migration-ceiling schemas have no break capability.
 if(!await hasSchema(db))return null;
 const approved=await new CaseAccommodationService(Promise.resolve(db)).resolveForWorker(attempt.caseId,attempt.workerAccountId);
 await db.query("INSERT INTO assessment_attempt_accommodations(attempt_id,case_id,worker_account_id,accommodation_ids,extra_break_seconds,snapshotted_at) VALUES($1,$2,$3,$4::jsonb,$5,$6)",[attempt.attemptId,attempt.caseId,attempt.workerAccountId,JSON.stringify(approved.accommodationIds),approved.adjustment.extraBreakMinutes*60,now.toISOString()]);
 return approved;
}
export async function readAssessmentBreakState(db:DatabaseClient,attempt:AssessmentAttemptRecord,now:Date,phaseIndex?:number):Promise<Readonly<{view:AssessmentBreakView|null;phaseExtensionSeconds:number;activeRemainingSeconds:number}>>{
 const empty=Object.freeze({view:null,phaseExtensionSeconds:0,activeRemainingSeconds:0});
 if(attempt.status==="SUBMITTED"||attempt.status==="AUTO_SUBMITTED"||!await hasSchema(db))return empty;
 const policy=(await db.query<{extra_break_seconds:number|string}>("SELECT extra_break_seconds FROM assessment_attempt_accommodations WHERE attempt_id=$1 AND case_id=$2 AND worker_account_id=$3",[attempt.attemptId,attempt.caseId,attempt.workerAccountId])).rows[0];
 if(!policy||Number(policy.extra_break_seconds)===0)return empty;
 const rows=(await db.query<BreakRow>("SELECT phase_index,duration_seconds,started_at,ends_at,mutation_key FROM assessment_accommodation_breaks WHERE attempt_id=$1 AND worker_account_id=$2 ORDER BY started_at,break_id",[attempt.attemptId,attempt.workerAccountId])).rows;
 const reserved=rows.reduce((sum,row)=>sum+Number(row.duration_seconds),0),active=rows.find(row=>new Date(row.started_at).getTime()<=now.getTime()&&new Date(row.ends_at).getTime()>now.getTime());
 const activeRemainingSeconds=active?Math.max(0,Math.ceil((new Date(active.ends_at).getTime()-now.getTime())/1000)):0;
 return Object.freeze({view:Object.freeze({active:Boolean(active),endsAt:active?new Date(active.ends_at).toISOString():null,remainingSeconds:activeRemainingSeconds,remainingAllowanceSeconds:Math.max(0,Number(policy.extra_break_seconds)-reserved),approvedAllowanceSeconds:Number(policy.extra_break_seconds)}),phaseExtensionSeconds:phaseIndex===undefined?0:rows.filter(row=>Number(row.phase_index)===phaseIndex).reduce((sum,row)=>sum+Number(row.duration_seconds),0),activeRemainingSeconds});
}
export async function reserveAssessmentBreak(db:DatabaseClient,attempt:AssessmentAttemptRecord,principal:AuthorizationPrincipal,input:Readonly<{durationSeconds:number;mutationKey:string}>,phaseIndex:number,now:Date){
 if(!Number.isSafeInteger(input.durationSeconds)||input.durationSeconds<1||input.durationSeconds>3600||typeof input.mutationKey!=="string"||input.mutationKey.length<16||input.mutationKey.length>160)throw new AssessmentAttemptInputError("Choose a valid approved break duration.");
 const policy=(await db.query<{extra_break_seconds:number|string}>("SELECT extra_break_seconds FROM assessment_attempt_accommodations WHERE attempt_id=$1 AND case_id=$2 AND worker_account_id=$3",[attempt.attemptId,attempt.caseId,principal.accountId])).rows[0];
 if(!policy||Number(policy.extra_break_seconds)<1)throw new AssessmentAttemptConflictError("This attempt has no approved break allowance.");
 const retry=(await db.query<BreakRow>("SELECT phase_index,duration_seconds,started_at,ends_at,mutation_key FROM assessment_accommodation_breaks WHERE attempt_id=$1 AND mutation_key=$2 AND worker_account_id=$3",[attempt.attemptId,input.mutationKey,principal.accountId])).rows[0];
 if(retry){if(Number(retry.duration_seconds)!==input.durationSeconds||Number(retry.phase_index)!==phaseIndex)throw new AssessmentAttemptConflictError("The approved break request changed; reload before continuing.");return;}
 const state=await readAssessmentBreakState(db,attempt,now,phaseIndex);
 if(state.view?.active)throw new AssessmentAttemptConflictError("An approved break is already active.");
 if(!state.view||input.durationSeconds>state.view.remainingAllowanceSeconds)throw new AssessmentAttemptConflictError("This break exceeds the remaining approved allowance.");
 await db.query("INSERT INTO assessment_accommodation_breaks(break_id,attempt_id,worker_account_id,auth_session_id,phase_index,mutation_key,duration_seconds,started_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[createIdentifier("assessment_break"),attempt.attemptId,principal.accountId,principal.sessionId,phaseIndex,input.mutationKey,input.durationSeconds,now.toISOString(),new Date(now.getTime()+input.durationSeconds*1000).toISOString()]);
}
