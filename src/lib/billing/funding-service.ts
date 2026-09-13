import "server-only";
import { runTenantScopedCommand } from "../authorization/tenant-scoped-command-guard";
import type { DatabaseClient } from "../database/database";
import type { TenantPermissionPrincipal } from "../authorization/tenant-scoped-resource-domain";
import { fundingId, positiveCredits, type FundingRequest } from "./funding-domain";

export class FundingService {
 constructor(private readonly database:DatabaseClient){}
 async request(principal:TenantPermissionPrincipal<"company.billing.manage">,input:{workerLinkId:string;creditUnits:number;idempotencyKey:string},now=new Date()):Promise<FundingRequest>{
  return runTenantScopedCommand({database:this.database,principal,permission:"company.billing.manage",now,operation:async({database,scope})=>{
   const existing=await database.query<any>(`SELECT funding_request_id,worker_link_id,status,credit_units,reserved_credit_units,created_at,updated_at FROM funding_requests WHERE tenant_id=$1 AND idempotency_key=$2`,[scope.tenantId,input.idempotencyKey]);
   if(existing.rows[0]) return map(existing.rows[0]);
   const id=fundingId(),time=now.toISOString();
   await database.query(`INSERT INTO funding_requests(funding_request_id,tenant_id,worker_link_id,requested_by_account_id,status,credit_units,idempotency_key,created_at,updated_at) VALUES($1,$2,$3,$4,'REQUESTED',$5,$6,$7,$7)`,[id,scope.tenantId,input.workerLinkId,scope.accountId,positiveCredits(input.creditUnits),input.idempotencyKey,time]);
   return {fundingRequestId:id,workerLinkId:input.workerLinkId,status:"REQUESTED",creditUnits:input.creditUnits,reservedCreditUnits:0,createdAt:time,updatedAt:time};
  }});
 }
 async decide(principal:TenantPermissionPrincipal<"company.billing.manage">,id:string,approved:boolean,now=new Date()):Promise<void>{
  return runTenantScopedCommand({database:this.database,principal,permission:"company.billing.manage",now,operation:async({database,scope})=>{await database.query(`UPDATE funding_requests SET status=$3,reserved_credit_units=CASE WHEN $3='APPROVED' THEN credit_units ELSE 0 END,updated_at=$4 WHERE tenant_id=$1 AND funding_request_id=$2 AND status='REQUESTED'`,[scope.tenantId,id,approved?"APPROVED":"REJECTED",now.toISOString()]);}});
 }
}
function map(r:any):FundingRequest{return {fundingRequestId:r.funding_request_id,workerLinkId:r.worker_link_id,status:r.status,creditUnits:Number(r.credit_units),reservedCreditUnits:Number(r.reserved_credit_units),createdAt:new Date(r.created_at).toISOString(),updatedAt:new Date(r.updated_at).toISOString()};}
