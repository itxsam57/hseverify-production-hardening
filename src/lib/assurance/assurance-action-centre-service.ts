import "server-only";

import { runTenantScopedCommand } from "../authorization/tenant-scoped-command-guard";
import { deriveTrustedTenantScope } from "../authorization/tenant-scoped-resource-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import { ASSURANCE_ORDER_MANAGE_PERMISSION, ASSURANCE_ORDER_READ_PERMISSION, AssuranceOrderAccessError, AssuranceOrderConflictError, AssuranceOrderInputError, normalizeAssuranceReference, type AssuranceOrderManagePrincipal, type AssuranceOrderReadPrincipal, type AssuranceActionItemRecord } from "./assurance-order-domain";
import { AssuranceOrderRepository } from "./assurance-order-repository";

/**
 * Stable Company Action Centre projection. Every visible obligation must expose
 * why it exists, when it is due, who owns it, the exact allowed action and the
 * role-safe destination. Keeping the field vocabulary here prevents the UI from
 * inventing ambiguous generic work items.
 */
export const ASSURANCE_ACTION_CENTRE_FIELDS = Object.freeze([
  "severity",
  "reason",
  "dueAt",
  "owner",
  "allowedAction",
  "deepLink"
] as const);

function actionId(value:string):string{const normalized=normalizeAssuranceReference(value,"assurance_action"); if(!normalized) throw new AssuranceOrderInputError("Assurance Action reference is invalid."); return normalized;}
async function audit(database:DatabaseClient,principal:AssuranceOrderManagePrincipal,action:"assurance_action.assigned"|"assurance_action.acknowledged"|"assurance_action.snoozed",reference:string):Promise<void>{ await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedAuditActor(principal),{action,outcome:"succeeded",target:{type:"resource",reference},metadata:{source:"action_centre"}}); }

export class AssuranceActionCentreService {
  constructor(private readonly database:DatabaseClient){}
  async list(principal:AssuranceOrderReadPrincipal):Promise<readonly AssuranceActionItemRecord[]>{ if(principal.authorizedTenantPermission!==ASSURANCE_ORDER_READ_PERMISSION) throw new AssuranceOrderAccessError(); return new AssuranceOrderRepository(this.database).listActions(deriveTrustedTenantScope(principal).tenantId); }
  async assignOwner(principal:AssuranceOrderManagePrincipal,reference:string,membershipId:string,now=new Date()):Promise<void>{ const id=actionId(reference); const member=membershipId.trim(); if(member.length<8||member.length>96) throw new AssuranceOrderInputError("Internal owner is invalid."); await runTenantScopedCommand({database:this.database,principal,permission:ASSURANCE_ORDER_MANAGE_PERMISSION,now,operation:async({database,scope})=>{ const item=await database.query<{owner_kind:string}>(`SELECT owner_kind FROM assurance_action_items WHERE tenant_id=$1 AND action_id=$2 FOR UPDATE`,[scope.tenantId,id]); if(!item.rows[0]) throw new AssuranceOrderAccessError(); if(item.rows[0].owner_kind!=="company") throw new AssuranceOrderConflictError("Only a Company-owned action can be assigned internally."); const membership=await database.query(`SELECT 1 FROM auth_tenant_memberships WHERE tenant_id=$1 AND membership_id=$2 AND membership_status='active' FOR UPDATE`,[scope.tenantId,member]); if(!membership.rows[0]) throw new AssuranceOrderAccessError(); await database.query(`UPDATE assurance_action_items SET internal_owner_membership_id=$3,updated_at=$4 WHERE tenant_id=$1 AND action_id=$2`,[scope.tenantId,id,member,now.toISOString()]); await audit(database,principal,"assurance_action.assigned",id); }}); }
  async acknowledge(principal:AssuranceOrderManagePrincipal,reference:string,now=new Date()):Promise<void>{ const id=actionId(reference); await runTenantScopedCommand({database:this.database,principal,permission:ASSURANCE_ORDER_MANAGE_PERMISSION,now,operation:async({database,scope})=>{ const r=await database.query(`UPDATE assurance_action_items SET action_status='acknowledged',acknowledged_at=$3,snoozed_until=NULL,snooze_reason=NULL,updated_at=$3 WHERE tenant_id=$1 AND action_id=$2 AND action_status IN ('open','snoozed')`,[scope.tenantId,id,now.toISOString()]); if(r.affectedRows!==1) throw new AssuranceOrderConflictError("Action cannot be acknowledged from its current state."); await audit(database,principal,"assurance_action.acknowledged",id); }}); }
  async snooze(principal:AssuranceOrderManagePrincipal,reference:string,until:Date,reason:string,now=new Date()):Promise<void>{ const id=actionId(reference); const why=reason.trim().replace(/\s+/g," "); if(why.length<3||why.length>500||until.getTime()<=now.getTime()) throw new AssuranceOrderInputError("Snooze requires a future date and a reason."); await runTenantScopedCommand({database:this.database,principal,permission:ASSURANCE_ORDER_MANAGE_PERMISSION,now,operation:async({database,scope})=>{ const item=await database.query<{severity:string;statutory:boolean;action_status:string}>(`SELECT severity,statutory,action_status FROM assurance_action_items WHERE tenant_id=$1 AND action_id=$2 FOR UPDATE`,[scope.tenantId,id]); const row=item.rows[0]; if(!row) throw new AssuranceOrderAccessError(); if(row.severity!=="info"||row.statutory||row.action_status==="resolved") throw new AssuranceOrderConflictError("Only non-statutory informational actions can be snoozed."); await database.query(`UPDATE assurance_action_items SET action_status='snoozed',acknowledged_at=NULL,snoozed_until=$3,snooze_reason=$4,updated_at=$5 WHERE tenant_id=$1 AND action_id=$2`,[scope.tenantId,id,until.toISOString(),why,now.toISOString()]); await audit(database,principal,"assurance_action.snoozed",id); }}); }
}
