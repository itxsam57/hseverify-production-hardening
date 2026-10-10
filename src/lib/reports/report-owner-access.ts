import "server-only";
import type {AuthorizationPrincipal} from "../authorization/authorization-context-domain";
import type {DatabaseClient} from "../database/database";
import {ReportAccessError} from "./report-delivery-domain";
export type WorkerReportPrincipal=AuthorizationPrincipal;
export async function runWorkerReportCommand<Result>(
 database:DatabaseClient,principal:WorkerReportPrincipal,operation:(database:DatabaseClient)=>Promise<Result>
):Promise<Result>{
 if(principal.activeRole!=="worker" || principal.tenantMembership || !principal.accountId || !principal.sessionId)throw new ReportAccessError();
 return database.transaction(async locked=>{
  const found=await locked.query(`SELECT accounts.account_id FROM auth_accounts accounts
   JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role='worker'
   JOIN auth_sessions sessions ON sessions.account_id=accounts.account_id AND sessions.session_id=$2 AND sessions.active_role='worker'
   WHERE accounts.account_id=$1 AND accounts.account_status='active' AND accounts.email_verified_at IS NOT NULL
    AND sessions.revoked_at IS NULL AND sessions.expires_at>clock_timestamp()
   FOR UPDATE OF accounts,roles,sessions`,[principal.accountId,principal.sessionId]);
  if(found.rows.length!==1)throw new ReportAccessError();
  return operation(locked);
 });
}
export async function resolveReportWorkerId(database:DatabaseClient,accountId:string):Promise<string>{
 const found=await database.query<{worker_reference:string|null;permanent_worker_id:string|null}>(
  `SELECT accounts.worker_reference,worker_ids.permanent_worker_id FROM auth_accounts accounts
   LEFT JOIN worker_identity_worker_ids worker_ids ON worker_ids.worker_account_id=accounts.account_id
   WHERE accounts.account_id=$1 ORDER BY worker_ids.issued_at DESC LIMIT 2`,[accountId]);
 if(found.rows.length!==1)throw new ReportAccessError();
 const row=found.rows[0],workerId=row.permanent_worker_id??row.worker_reference;
 if(!workerId)throw new ReportAccessError();
 const owner=await database.query("SELECT worker_account_id FROM worker_identity_worker_ids WHERE permanent_worker_id=$1 AND worker_account_id<>$2 LIMIT 1",[workerId,accountId]);
 if(owner.rows.length)throw new ReportAccessError();
 return workerId;
}
