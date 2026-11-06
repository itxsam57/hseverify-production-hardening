import "server-only";
import type {AuthorizationPrincipal} from "../authorization/authorization-context-domain";
import {getDatabaseClient,type DatabaseClient} from "../database/database";

export class WorkerAssuranceCaseAccessError extends Error{
 constructor(){super("The assurance case is unavailable.");this.name="WorkerAssuranceCaseAccessError";}
}
export type WorkerAssuranceCase=Readonly<{
 caseId:string;status:string;nextAction:string;credentialReference:string|null;updatedAt:string;
}>;
export async function findWorkerAssuranceCase(
 principal:AuthorizationPrincipal,caseId:string,database?:DatabaseClient
):Promise<WorkerAssuranceCase|null>{
 if(principal.activeRole!=="worker" || principal.accountStatus!=="active" || principal.tenantMembership!==null)throw new WorkerAssuranceCaseAccessError();
 if(!/^assurance_case_[A-Za-z0-9_-]{24}$/.test(caseId))return null;
 const db=database??await getDatabaseClient();
 const result=await db.query<{case_id:string;case_status:string;next_action:string;credential_reference:string|null;updated_at:string|Date}>(
  "SELECT cases.case_id,cases.case_status,cases.next_action,cases.credential_reference,cases.updated_at "+
  "FROM assurance_cases cases JOIN auth_sessions sessions ON sessions.account_id=cases.worker_account_id "+
  "JOIN auth_accounts accounts ON accounts.account_id=sessions.account_id AND accounts.account_status='active' "+
  "JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role='worker' "+
  "WHERE cases.case_id=$1 AND cases.worker_account_id=$2 AND sessions.session_id=$3 AND sessions.active_role='worker' "+
   "AND sessions.revoked_at IS NULL AND sessions.expires_at>CURRENT_TIMESTAMP",[caseId,principal.accountId,principal.sessionId]);
 const row=result.rows[0];
 return row?Object.freeze({caseId:row.case_id,status:row.case_status,nextAction:row.next_action,
  credentialReference:row.credential_reference,updatedAt:new Date(row.updated_at).toISOString()}):null;
}
