import "server-only";

import type { DatabaseClient } from "../database/database";
import type {
  AssuranceActionItemRecord,
  AssuranceCaseRecord,
  AssuranceOrderRecord,
  AssuranceOrderWorkerRecord,
  AssurancePendingOwner
} from "./assurance-order-domain";

type OrderRow = {
  order_id:string; tenant_id:string; created_by_membership_id:string; order_name:string; order_reference:string;
  site_id:string|null; department_id:string|null; requested_identity_checks:unknown; requested_evidence_checks:unknown;
  assessment_framework_references:unknown; interview_required:boolean; credential_target:string|null; deadline:string|Date|null;
  effective_policy_reference:string|null; company_notes:string|null; purchase_order_reference:string|null; order_status:AssuranceOrderRecord["orderStatus"];
  validation_errors:unknown; scope_version:number; submitted_at:string|Date|null; cancelled_at:string|Date|null; created_at:string|Date; updated_at:string|Date;
};
type TargetRow = {
  target_id:string; order_id:string; tenant_id:string; worker_link_id:string; worker_account_id:string; permanent_worker_id:string|null;
  site_id:string|null; department_id:string|null; funding_method:AssuranceOrderWorkerRecord["fundingMethod"];
  target_status:AssuranceOrderWorkerRecord["targetStatus"]; validation_reason:string|null; created_at:string|Date; updated_at:string|Date;
};
type CaseRow = {
  case_id:string; order_id:string; target_id:string; tenant_id:string; worker_link_id:string; worker_account_id:string; permanent_worker_id:string|null;
  case_status:AssuranceCaseRecord["caseStatus"]; owner_kind:AssurancePendingOwner|null; next_action:string|null;
  evidence_reference:string|null; assessment_reference:string|null; integrity_reference:string|null; review_reference:string|null;
  interview_reference:string|null; decision_reference:string|null; credential_reference:string|null; created_at:string|Date; updated_at:string|Date; closed_at:string|Date|null;
};
type ActionRow = {
  action_id:string; tenant_id:string; order_id:string; case_id:string|null; worker_account_id:string|null;
  severity:AssuranceActionItemRecord["severity"]; reason:string; due_at:string|Date|null; owner_kind:AssurancePendingOwner;
  internal_owner_membership_id:string|null; allowed_action:string; deep_link:string; statutory:boolean;
  action_status:AssuranceActionItemRecord["actionStatus"]; acknowledged_at:string|Date|null; snoozed_until:string|Date|null; snooze_reason:string|null;
  created_at:string|Date; updated_at:string|Date;
};

function iso(value:string|Date):string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function maybeIso(value:string|Date|null):string|null { return value === null ? null : iso(value); }
function jsonArray(value:unknown):readonly string[] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  return Object.freeze(Array.isArray(parsed) ? parsed.filter((item):item is string => typeof item === "string") : []);
}
function order(row:OrderRow):AssuranceOrderRecord { return Object.freeze({
  orderId:row.order_id, tenantId:row.tenant_id, createdByMembershipId:row.created_by_membership_id, orderName:row.order_name,
  orderReference:row.order_reference, siteId:row.site_id, departmentId:row.department_id,
  requestedIdentityChecks:jsonArray(row.requested_identity_checks), requestedEvidenceChecks:jsonArray(row.requested_evidence_checks),
  assessmentFrameworkReferences:jsonArray(row.assessment_framework_references), interviewRequired:row.interview_required,
  credentialTarget:row.credential_target, deadline:maybeIso(row.deadline), effectivePolicyReference:row.effective_policy_reference,
  companyNotes:row.company_notes, purchaseOrderReference:row.purchase_order_reference, orderStatus:row.order_status,
  validationErrors:jsonArray(row.validation_errors), scopeVersion:row.scope_version, submittedAt:maybeIso(row.submitted_at),
  cancelledAt:maybeIso(row.cancelled_at), createdAt:iso(row.created_at), updatedAt:iso(row.updated_at)
}); }
function target(row:TargetRow):AssuranceOrderWorkerRecord { return Object.freeze({
  targetId:row.target_id, orderId:row.order_id, tenantId:row.tenant_id, workerLinkId:row.worker_link_id,
  workerAccountId:row.worker_account_id, permanentWorkerId:row.permanent_worker_id, siteId:row.site_id, departmentId:row.department_id,
  fundingMethod:row.funding_method, targetStatus:row.target_status, validationReason:row.validation_reason,
  createdAt:iso(row.created_at), updatedAt:iso(row.updated_at)
}); }
function assuranceCase(row:CaseRow):AssuranceCaseRecord { return Object.freeze({
  caseId:row.case_id, orderId:row.order_id, targetId:row.target_id, tenantId:row.tenant_id, workerLinkId:row.worker_link_id,
  workerAccountId:row.worker_account_id, permanentWorkerId:row.permanent_worker_id, caseStatus:row.case_status, owner:row.owner_kind,
  nextAction:row.next_action, evidenceReference:row.evidence_reference, assessmentReference:row.assessment_reference,
  integrityReference:row.integrity_reference, reviewReference:row.review_reference, interviewReference:row.interview_reference,
  decisionReference:row.decision_reference, credentialReference:row.credential_reference, createdAt:iso(row.created_at),
  updatedAt:iso(row.updated_at), closedAt:maybeIso(row.closed_at)
}); }
function action(row:ActionRow):AssuranceActionItemRecord { return Object.freeze({
  actionId:row.action_id, tenantId:row.tenant_id, orderId:row.order_id, caseId:row.case_id, workerAccountId:row.worker_account_id,
  severity:row.severity, reason:row.reason, dueAt:maybeIso(row.due_at), owner:row.owner_kind,
  internalOwnerMembershipId:row.internal_owner_membership_id, allowedAction:row.allowed_action, deepLink:row.deep_link,
  statutory:row.statutory, actionStatus:row.action_status, acknowledgedAt:maybeIso(row.acknowledged_at), snoozedUntil:maybeIso(row.snoozed_until),
  snoozeReason:row.snooze_reason, createdAt:iso(row.created_at), updatedAt:iso(row.updated_at)
}); }

const ORDER_COLUMNS = `order_id,tenant_id,created_by_membership_id,order_name,order_reference,site_id,department_id,
requested_identity_checks,requested_evidence_checks,assessment_framework_references,interview_required,credential_target,deadline,
effective_policy_reference,company_notes,purchase_order_reference,order_status,validation_errors,scope_version,submitted_at,cancelled_at,created_at,updated_at`;
const TARGET_COLUMNS = `target_id,order_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,site_id,department_id,funding_method,target_status,validation_reason,created_at,updated_at`;
const CASE_COLUMNS = `case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,case_status,owner_kind,next_action,evidence_reference,assessment_reference,integrity_reference,review_reference,interview_reference,decision_reference,credential_reference,created_at,updated_at,closed_at`;
const ACTION_COLUMNS = `action_id,tenant_id,order_id,case_id,worker_account_id,severity,reason,due_at,owner_kind,internal_owner_membership_id,allowed_action,deep_link,statutory,action_status,acknowledged_at,snoozed_until,snooze_reason,created_at,updated_at`;

export class AssuranceOrderRepository {
  constructor(readonly database:DatabaseClient) {}

  async insertDraft(input:{orderId:string;tenantId:string;membershipId:string;draft:AssuranceOrderRecord extends never ? never : {orderName:string;orderReference:string;siteId:string|null;departmentId:string|null;requestedIdentityChecks:readonly string[];requestedEvidenceChecks:readonly string[];assessmentFrameworkReferences:readonly string[];interviewRequired:boolean;credentialTarget:string|null;deadline:string|null;effectivePolicyReference:string|null;companyNotes:string|null;purchaseOrderReference:string|null}; now:string}):Promise<AssuranceOrderRecord> {
    const result = await this.database.query<OrderRow>(`INSERT INTO assurance_orders (
      order_id,tenant_id,created_by_membership_id,order_name,order_reference,site_id,department_id,requested_identity_checks,
      requested_evidence_checks,assessment_framework_references,interview_required,credential_target,deadline,effective_policy_reference,
      company_notes,purchase_order_reference,order_status,validation_errors,scope_version,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13::timestamptz,$14,$15,$16,'DRAFT','[]'::jsonb,1,$17,$17)
    RETURNING ${ORDER_COLUMNS}`, [input.orderId,input.tenantId,input.membershipId,input.draft.orderName,input.draft.orderReference,input.draft.siteId,
      input.draft.departmentId,JSON.stringify(input.draft.requestedIdentityChecks),JSON.stringify(input.draft.requestedEvidenceChecks),
      JSON.stringify(input.draft.assessmentFrameworkReferences),input.draft.interviewRequired,input.draft.credentialTarget,input.draft.deadline,
      input.draft.effectivePolicyReference,input.draft.companyNotes,input.draft.purchaseOrderReference,input.now]);
    if (!result.rows[0]) throw new Error("Assurance Order draft was not persisted.");
    return order(result.rows[0]);
  }

  async lockOrder(tenantId:string, orderId:string):Promise<AssuranceOrderRecord|null> {
    const result = await this.database.query<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM assurance_orders WHERE tenant_id=$1 AND order_id=$2 FOR UPDATE`, [tenantId,orderId]);
    return result.rows[0] ? order(result.rows[0]) : null;
  }
  async findOrder(tenantId:string, orderId:string):Promise<AssuranceOrderRecord|null> {
    const result = await this.database.query<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM assurance_orders WHERE tenant_id=$1 AND order_id=$2`, [tenantId,orderId]);
    return result.rows[0] ? order(result.rows[0]) : null;
  }
  async listOrders(tenantId:string):Promise<readonly AssuranceOrderRecord[]> {
    const result = await this.database.query<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM assurance_orders WHERE tenant_id=$1 ORDER BY created_at DESC,order_id DESC LIMIT 250`, [tenantId]);
    return Object.freeze(result.rows.map(order));
  }
  async updateDraft(tenantId:string, orderId:string, draft:{orderName:string;orderReference:string;siteId:string|null;departmentId:string|null;requestedIdentityChecks:readonly string[];requestedEvidenceChecks:readonly string[];assessmentFrameworkReferences:readonly string[];interviewRequired:boolean;credentialTarget:string|null;deadline:string|null;effectivePolicyReference:string|null;companyNotes:string|null;purchaseOrderReference:string|null}, now:string):Promise<AssuranceOrderRecord|null> {
    const result = await this.database.query<OrderRow>(`UPDATE assurance_orders SET order_name=$3,order_reference=$4,site_id=$5,department_id=$6,
      requested_identity_checks=$7::jsonb,requested_evidence_checks=$8::jsonb,assessment_framework_references=$9::jsonb,interview_required=$10,
      credential_target=$11,deadline=$12::timestamptz,effective_policy_reference=$13,company_notes=$14,purchase_order_reference=$15,
      order_status='DRAFT',validation_errors='[]'::jsonb,scope_version=scope_version+1,updated_at=$16
      WHERE tenant_id=$1 AND order_id=$2 AND order_status IN ('DRAFT','VALIDATION_FAILED','READY') RETURNING ${ORDER_COLUMNS}`,
      [tenantId,orderId,draft.orderName,draft.orderReference,draft.siteId,draft.departmentId,JSON.stringify(draft.requestedIdentityChecks),
       JSON.stringify(draft.requestedEvidenceChecks),JSON.stringify(draft.assessmentFrameworkReferences),draft.interviewRequired,draft.credentialTarget,
       draft.deadline,draft.effectivePolicyReference,draft.companyNotes,draft.purchaseOrderReference,now]);
    return result.rows[0] ? order(result.rows[0]) : null;
  }
  async insertTarget(input:{targetId:string;orderId:string;tenantId:string;workerLinkId:string;workerAccountId:string;permanentWorkerId:string|null;siteId:string|null;departmentId:string|null;fundingMethod:"company"|"worker";now:string}):Promise<AssuranceOrderWorkerRecord> {
    const result=await this.database.query<TargetRow>(`INSERT INTO assurance_order_workers (target_id,order_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,site_id,department_id,funding_method,target_status,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$10) RETURNING ${TARGET_COLUMNS}`,
      [input.targetId,input.orderId,input.tenantId,input.workerLinkId,input.workerAccountId,input.permanentWorkerId,input.siteId,input.departmentId,input.fundingMethod,input.now]);
    if(!result.rows[0]) throw new Error("Assurance worker target was not persisted."); return target(result.rows[0]);
  }
  async listTargets(tenantId:string,orderId:string, lock=false):Promise<readonly AssuranceOrderWorkerRecord[]> {
    const result=await this.database.query<TargetRow>(`SELECT ${TARGET_COLUMNS} FROM assurance_order_workers WHERE tenant_id=$1 AND order_id=$2 ORDER BY created_at,target_id${lock?" FOR UPDATE":""}`,[tenantId,orderId]);
    return Object.freeze(result.rows.map(target));
  }
  async deleteTarget(tenantId:string,orderId:string,targetId:string):Promise<boolean> {
    const result=await this.database.query(`DELETE FROM assurance_order_workers WHERE tenant_id=$1 AND order_id=$2 AND target_id=$3`,[tenantId,orderId,targetId]); return result.affectedRows===1;
  }
  async recordValidation(input:{tenantId:string;orderId:string;ready:boolean;errors:readonly string[];targetResults:readonly {targetId:string;eligible:boolean;reason:string|null}[];now:string}):Promise<AssuranceOrderRecord|null> {
    for(const targetResult of input.targetResults){ await this.database.query(`UPDATE assurance_order_workers SET target_status=$4,validation_reason=$5,updated_at=$6 WHERE tenant_id=$1 AND order_id=$2 AND target_id=$3`,[input.tenantId,input.orderId,targetResult.targetId,targetResult.eligible?"eligible":"ineligible",targetResult.reason,input.now]); }
    const result=await this.database.query<OrderRow>(`UPDATE assurance_orders SET order_status=$3,validation_errors=$4::jsonb,updated_at=$5 WHERE tenant_id=$1 AND order_id=$2 AND order_status IN ('DRAFT','VALIDATION_FAILED','READY') RETURNING ${ORDER_COLUMNS}`,[input.tenantId,input.orderId,input.ready?"READY":"VALIDATION_FAILED",JSON.stringify(input.errors),input.now]);
    return result.rows[0]?order(result.rows[0]):null;
  }
  async markSubmitted(tenantId:string,orderId:string,now:string):Promise<AssuranceOrderRecord|null>{
    const result=await this.database.query<OrderRow>(`UPDATE assurance_orders SET order_status='SUBMITTED',submitted_at=$3,updated_at=$3 WHERE tenant_id=$1 AND order_id=$2 AND order_status='READY' RETURNING ${ORDER_COLUMNS}`,[tenantId,orderId,now]);
    return result.rows[0]?order(result.rows[0]):null;
  }
  async insertCase(input:{caseId:string;target:AssuranceOrderWorkerRecord;status:AssuranceCaseRecord["caseStatus"];owner:AssurancePendingOwner;nextAction:string;now:string}):Promise<AssuranceCaseRecord|null>{
    const r=await this.database.query<CaseRow>(`INSERT INTO assurance_cases (case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,case_status,owner_kind,next_action,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) ON CONFLICT (order_id,worker_account_id) DO NOTHING RETURNING ${CASE_COLUMNS}`,
      [input.caseId,input.target.orderId,input.target.targetId,input.target.tenantId,input.target.workerLinkId,input.target.workerAccountId,input.target.permanentWorkerId,input.status,input.owner,input.nextAction,input.now]);
    return r.rows[0]?assuranceCase(r.rows[0]):null;
  }
  async listCases(tenantId:string,orderId:string):Promise<readonly AssuranceCaseRecord[]>{ const r=await this.database.query<CaseRow>(`SELECT ${CASE_COLUMNS} FROM assurance_cases WHERE tenant_id=$1 AND order_id=$2 ORDER BY created_at,case_id`,[tenantId,orderId]); return Object.freeze(r.rows.map(assuranceCase)); }
  async insertTimeline(input:{eventId:string;tenantId:string;orderId:string;caseId:string|null;eventType:string;fromStatus:string|null;toStatus:string;owner:AssurancePendingOwner|null;nextAction:string|null;actorAccountId:string;actorRole:string;now:string}):Promise<void>{
    await this.database.query(`INSERT INTO assurance_case_timeline_events (timeline_event_id,tenant_id,order_id,case_id,event_type,from_status,to_status,owner_kind,next_action,actor_account_id,actor_role,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (timeline_event_id) DO NOTHING`,[input.eventId,input.tenantId,input.orderId,input.caseId,input.eventType,input.fromStatus,input.toStatus,input.owner,input.nextAction,input.actorAccountId,input.actorRole,input.now]);
  }
  async insertAction(input:{actionId:string;tenantId:string;orderId:string;caseId:string|null;workerAccountId:string|null;severity:"info"|"warning"|"critical";reason:string;dueAt:string|null;owner:AssurancePendingOwner;allowedAction:string;deepLink:string;statutory:boolean;now:string}):Promise<AssuranceActionItemRecord|null>{
    const r=await this.database.query<ActionRow>(`INSERT INTO assurance_action_items (action_id,tenant_id,order_id,case_id,worker_account_id,severity,reason,due_at,owner_kind,allowed_action,deep_link,statutory,action_status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open',$13,$13) ON CONFLICT (action_id) DO NOTHING RETURNING ${ACTION_COLUMNS}`,[input.actionId,input.tenantId,input.orderId,input.caseId,input.workerAccountId,input.severity,input.reason,input.dueAt,input.owner,input.allowedAction,input.deepLink,input.statutory,input.now]); return r.rows[0]?action(r.rows[0]):null;
  }
  async listActions(tenantId:string):Promise<readonly AssuranceActionItemRecord[]>{ const r=await this.database.query<ActionRow>(`SELECT ${ACTION_COLUMNS} FROM assurance_action_items WHERE tenant_id=$1 AND action_status IN ('open','acknowledged','snoozed') ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,due_at NULLS LAST,created_at`,[tenantId]); return Object.freeze(r.rows.map(action)); }
}
