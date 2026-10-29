import "server-only";
import { evaluateWorkerAssessmentHistory } from "../assessment-catalogue/assessment-eligibility-policy-service";

import { runTenantScopedCommand } from "../authorization/tenant-scoped-command-guard";
import { deriveTrustedTenantScope, type TenantPermissionPrincipal } from "../authorization/tenant-scoped-resource-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import { pinAssuranceCasePolicySnapshot, validateAssurancePolicySelection, resolveEffectivePolicy } from "../policy/effective-policy-service";
import {
  ASSURANCE_ORDER_MANAGE_PERMISSION, ASSURANCE_ORDER_READ_PERMISSION,
  AssuranceOrderAccessError, AssuranceOrderConflictError, AssuranceOrderInputError, AssuranceOrderNotFoundError,
  createAssuranceActionId, createAssuranceCaseId, createAssuranceOrderId, createAssuranceTargetId, createAssuranceTimelineEventId,
  normalizeAssuranceFundingMethod, normalizeAssuranceOrderDraft, normalizeAssuranceReference,
  type AssuranceFundingMethod, type AssuranceOrderDraftInput, type AssuranceOrderManagePrincipal, type AssuranceOrderReadPrincipal,
  type AssuranceOrderRecord, type AssuranceOrderWorkerRecord, type AssuranceValidationResult,
  type AssuranceCaseStatus, type AssurancePendingOwner
} from "./assurance-order-domain";
import { EffectivePolicyConflictError } from "../policy/effective-policy-domain";
import { AssuranceOrderRepository } from "./assurance-order-repository";

const companyOrdersManage = "company.orders.manage" as const;

// runTenantScopedCommand is the transaction boundary for every mutating M2.01
// state transition: tenant scope, live authorization, writes, timeline and audit
// either commit together or roll back together.
type ActiveLinkRow={link_id:string;tenant_id:string;worker_account_id:string;permanent_worker_id:string|null;link_status:string;site_id:string|null;department_id:string|null;payment_responsibility:string};
function known(error:unknown):boolean { return error instanceof AssuranceOrderInputError || error instanceof AssuranceOrderAccessError || error instanceof AssuranceOrderConflictError || error instanceof AssuranceOrderNotFoundError; }
function uniqueViolation(error:unknown):boolean { return Boolean(error && typeof error==="object" && (error as {code?:unknown}).code==="23505"); }

async function assertVerifiedCompany(database:DatabaseClient,tenantId:string):Promise<void>{
  const r=await database.query<{case_status:string}>(`SELECT cases.case_status FROM company_verification_cases AS cases JOIN platform_tenants AS tenants ON tenants.tenant_id=cases.tenant_id WHERE cases.tenant_id=$1 AND tenants.tenant_status='active' FOR UPDATE OF cases,tenants`,[tenantId]);
  if(r.rows[0]?.case_status!=="verified") throw new AssuranceOrderAccessError();
}
async function assertActiveUnit(database:DatabaseClient,tenantId:string,siteId:string|null,departmentId:string|null):Promise<readonly string[]>{
  const errors:string[]=[];
  if(siteId){const r=await database.query(`SELECT 1 FROM company_sites WHERE tenant_id=$1 AND site_id=$2 AND site_status='active'`,[tenantId,siteId]); if(!r.rows[0]) errors.push("Selected site is not active for this Company.");}
  if(departmentId){const r=await database.query(`SELECT 1 FROM company_departments WHERE tenant_id=$1 AND department_id=$2 AND department_status='active'`,[tenantId,departmentId]); if(!r.rows[0]) errors.push("Selected department is not active for this Company.");}
  return Object.freeze(errors);
}
async function activeLink(database:DatabaseClient,tenantId:string,linkId:string,lock=false):Promise<ActiveLinkRow|null>{
  const r=await database.query<ActiveLinkRow>(`SELECT link_id,tenant_id,worker_account_id,permanent_worker_id,link_status,site_id,department_id,payment_responsibility FROM company_worker_links WHERE tenant_id=$1 AND link_id=$2${lock?" FOR UPDATE":""}`,[tenantId,linkId]);
  const row=r.rows[0]; return row && row.link_status==="active" ? row : null;
}

async function currentPermanentWorkerId(database:DatabaseClient,workerAccountId:string):Promise<string|null>{
  const result=await database.query<{permanent_worker_id:string}>(
    `SELECT ids.permanent_worker_id
       FROM worker_identity_worker_ids AS ids
       JOIN worker_identities AS identities
         ON identities.identity_id=ids.identity_id
        AND identities.worker_account_id=ids.worker_account_id
      WHERE ids.worker_account_id=$1
        AND identities.lifecycle_status='verified'
      ORDER BY ids.issued_at DESC
      LIMIT 2`,
    [workerAccountId]
  );
  if(result.rows.length>1) throw new AssuranceOrderConflictError("Permanent Worker ID ownership is not unique.");
  return result.rows[0]?.permanent_worker_id??null;
}
async function initialCaseStateForWorker(
  database:DatabaseClient,
  order:AssuranceOrderRecord,
  workerAccountId:string
):Promise<Readonly<{status:AssuranceCaseStatus;owner:AssurancePendingOwner;nextAction:string;permanentWorkerId:string|null}>>{
  const permanentWorkerId=await currentPermanentWorkerId(database,workerAccountId);
  if(!permanentWorkerId){
    return Object.freeze({
      status:"Identity pending" as const,
      owner:"worker" as const,
      nextAction:"Complete or correct the Worker identity requirements for this assurance case.",
      permanentWorkerId:null
    });
  }
  if(order.requestedIdentityChecks.length>0||order.requestedEvidenceChecks.length>0){
    return Object.freeze({
      status:"Evidence pending" as const,
      owner:"worker" as const,
      nextAction:"Submit or complete the evidence requested for this Assurance Case.",
      permanentWorkerId
    });
  }
  if(order.assessmentFrameworkReferences.length>0){
    return Object.freeze({
      status:"Assessment pending" as const,
      owner:"background_job" as const,
      nextAction:"Assessment eligibility is ready for the Worker.",
      permanentWorkerId
    });
  }
  if(order.interviewRequired){
    return Object.freeze({
      status:"Interview pending" as const,
      owner:"background_job" as const,
      nextAction:"Create and assign the required interview.",
      permanentWorkerId
    });
  }
  return Object.freeze({
    status:"Decision pending" as const,
    owner:"background_job" as const,
    nextAction:"Evaluate the Assurance Case for a final decision.",
    permanentWorkerId
  });
}
async function workerAssessmentPolicyReason(database:DatabaseClient,order:AssuranceOrderRecord,workerAccountId:string,now:Date):Promise<string|null>{
  if(!order.effectivePolicyReference||order.assessmentFrameworkReferences.length===0)return null;
  try {
    const policy=await resolveEffectivePolicy(database,{tenantId:order.tenantId,frameworkReferences:order.assessmentFrameworkReferences,policyReference:order.effectivePolicyReference,referenceTime:now});
    const decision=await evaluateWorkerAssessmentHistory(database,{workerAccountId,frameworkId:policy.frameworkId,policyValues:policy.effectiveValue,now,lockWorker:true});
    return decision.eligibilityReason;
  } catch(error) {
    if(error instanceof EffectivePolicyConflictError)return error.message;
    throw error;
  }
}
async function audit(database:DatabaseClient,principal:AssuranceOrderManagePrincipal,action:Parameters<DatabaseAuditRepository["append"]>[1]["action"],reference:string,metadata:Record<string,unknown>={}):Promise<void>{
  await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedAuditActor(principal),{action,outcome:"succeeded",target:{type:"resource",reference},metadata});
}

export class AssuranceOrderService {
  constructor(private readonly database:DatabaseClient) {}

  async createDraft(principal:AssuranceOrderManagePrincipal,input:AssuranceOrderDraftInput,now=new Date()):Promise<AssuranceOrderRecord>{
    const draft=normalizeAssuranceOrderDraft(input); const nowIso=now.toISOString();
    try{return await runTenantScopedCommand({database:this.database,principal,permission:companyOrdersManage,now,operation:async({database,scope})=>{
      await assertVerifiedCompany(database,scope.tenantId); const repository=new AssuranceOrderRepository(database);
      const created=await repository.insertDraft({orderId:createAssuranceOrderId(),tenantId:scope.tenantId,membershipId:scope.membershipId,draft,now:nowIso});
      await repository.insertTimeline({eventId:createAssuranceTimelineEventId(),tenantId:scope.tenantId,orderId:created.orderId,caseId:null,eventType:"order_created",fromStatus:null,toStatus:"DRAFT",owner:"company",nextAction:"Add workers, then validate the Assurance Order.",actorAccountId:scope.accountId,actorRole:"company",now:nowIso});
      await audit(database,principal,"assurance_order.created",created.orderId,{orderStatus:"DRAFT"}); return created;
    }});}catch(error){if(uniqueViolation(error)) throw new AssuranceOrderConflictError("An active Assurance Order already uses that reference."); if(known(error)) throw error; throw new AssuranceOrderAccessError();}
  }

  async saveDraft(principal:AssuranceOrderManagePrincipal,orderId:string,input:AssuranceOrderDraftInput,now=new Date()):Promise<AssuranceOrderRecord>{
    const id=normalizeAssuranceReference(orderId,"assurance_order"); if(!id) throw new AssuranceOrderInputError("Assurance Order reference is invalid.");
    const draft=normalizeAssuranceOrderDraft(input); const nowIso=now.toISOString();
    return runTenantScopedCommand({database:this.database,principal,permission:ASSURANCE_ORDER_MANAGE_PERMISSION,now,operation:async({database,scope})=>{
      await assertVerifiedCompany(database,scope.tenantId); const repository=new AssuranceOrderRepository(database); const locked=await repository.lockOrder(scope.tenantId,id); if(!locked) throw new AssuranceOrderNotFoundError();
      const saved=await repository.updateDraft(scope.tenantId,id,draft,nowIso); if(!saved) throw new AssuranceOrderConflictError("Only an unsubmitted Assurance Order can be edited.");
      await audit(database,principal,"assurance_order.updated",id,{scopeVersion:saved.scopeVersion}); return saved;
    }});
  }

  async addWorkerTarget(principal:AssuranceOrderManagePrincipal,orderId:string,workerLinkId:string,fundingMethod:AssuranceFundingMethod,now=new Date()):Promise<AssuranceOrderWorkerRecord>{
    const id=normalizeAssuranceReference(orderId,"assurance_order"); if(!id) throw new AssuranceOrderInputError("Assurance Order reference is invalid.");
    const linkReference=workerLinkId.trim(); if(linkReference.length<8||linkReference.length>96) throw new AssuranceOrderInputError("Worker link is invalid.");
    const funding=normalizeAssuranceFundingMethod(fundingMethod); const nowIso=now.toISOString();
    try{return await runTenantScopedCommand({database:this.database,principal,permission:ASSURANCE_ORDER_MANAGE_PERMISSION,now,operation:async({database,scope})=>{
      await assertVerifiedCompany(database,scope.tenantId); const repository=new AssuranceOrderRepository(database); const order=await repository.lockOrder(scope.tenantId,id); if(!order) throw new AssuranceOrderNotFoundError();
      if(!["DRAFT","VALIDATION_FAILED","READY"].includes(order.orderStatus)) throw new AssuranceOrderConflictError("Submitted Assurance Order scope cannot be changed.");
      const link=await activeLink(database,scope.tenantId,linkReference,true); if(!link) throw new AssuranceOrderAccessError();
      const resolvedPermanentWorkerId=await currentPermanentWorkerId(database,link.worker_account_id);
      const added=await repository.insertTarget({targetId:createAssuranceTargetId(),orderId:id,tenantId:scope.tenantId,workerLinkId:link.link_id,workerAccountId:link.worker_account_id,permanentWorkerId:resolvedPermanentWorkerId??link.permanent_worker_id,siteId:link.site_id,departmentId:link.department_id,fundingMethod:funding,now:nowIso});
      await database.query(`UPDATE assurance_orders SET order_status='DRAFT',validation_errors='[]'::jsonb,scope_version=scope_version+1,updated_at=$3 WHERE tenant_id=$1 AND order_id=$2`,[scope.tenantId,id,nowIso]);
      await audit(database,principal,"assurance_order.updated",id,{change:"worker_target_added"}); return added;
    }});}catch(error){if(uniqueViolation(error)) throw new AssuranceOrderConflictError("That Worker is already included in this Assurance Order."); if(known(error)) throw error; throw new AssuranceOrderAccessError();}
  }

  async removeWorkerTarget(principal:AssuranceOrderManagePrincipal,orderId:string,targetId:string,now=new Date()):Promise<void>{
    const id=normalizeAssuranceReference(orderId,"assurance_order"); const target=normalizeAssuranceReference(targetId,"assurance_target"); if(!id||!target) throw new AssuranceOrderInputError("Assurance target reference is invalid.");
    await runTenantScopedCommand({database:this.database,principal,permission:ASSURANCE_ORDER_MANAGE_PERMISSION,now,operation:async({database,scope})=>{ const repository=new AssuranceOrderRepository(database); const order=await repository.lockOrder(scope.tenantId,id); if(!order) throw new AssuranceOrderNotFoundError(); if(!["DRAFT","VALIDATION_FAILED","READY"].includes(order.orderStatus)) throw new AssuranceOrderConflictError("Submitted Assurance Order scope cannot be changed."); const removed=await repository.deleteTarget(scope.tenantId,id,target); if(!removed) throw new AssuranceOrderNotFoundError(); await database.query(`UPDATE assurance_orders SET order_status='DRAFT',validation_errors='[]'::jsonb,scope_version=scope_version+1,updated_at=$3 WHERE tenant_id=$1 AND order_id=$2`,[scope.tenantId,id,now.toISOString()]); await audit(database,principal,"assurance_order.updated",id,{change:"worker_target_removed"}); }});
  }

  async validateOrder(principal:AssuranceOrderManagePrincipal,orderId:string,now=new Date()):Promise<AssuranceValidationResult>{
    const id=normalizeAssuranceReference(orderId,"assurance_order"); if(!id) throw new AssuranceOrderInputError("Assurance Order reference is invalid.");
    return runTenantScopedCommand({database:this.database,principal,permission:ASSURANCE_ORDER_MANAGE_PERMISSION,now,operation:async({database,scope})=>{
      await assertVerifiedCompany(database,scope.tenantId); const repository=new AssuranceOrderRepository(database); const order=await repository.lockOrder(scope.tenantId,id); if(!order) throw new AssuranceOrderNotFoundError(); if(!["DRAFT","VALIDATION_FAILED","READY"].includes(order.orderStatus)) throw new AssuranceOrderConflictError("Submitted Assurance Order cannot be revalidated as a draft.");
      const errors:string[]=[...(await assertActiveUnit(database,scope.tenantId,order.siteId,order.departmentId))]; const targets=await repository.listTargets(scope.tenantId,id,true); const targetResults:{targetId:string;eligible:boolean;reason:string|null}[]=[];
      if(targets.length===0) errors.push("Add at least one active linked Worker before validation.");
      for(const target of targets){ const live=await activeLink(database,scope.tenantId,target.workerLinkId,true); const reason=!live?"Worker link is no longer active for this Company.":await workerAssessmentPolicyReason(database,order,target.workerAccountId,now); targetResults.push({targetId:target.targetId,eligible:reason===null,reason}); if(reason) errors.push(`${target.workerAccountId}: ${reason}`); }
      errors.push(...await validateAssurancePolicySelection(database,{tenantId:scope.tenantId,frameworkReferences:order.assessmentFrameworkReferences,policyReference:order.effectivePolicyReference,referenceTime:now}));
      // Positive final decisions issue the retained credential target through the credential engine.
      // interviewRequired remains an explicit M2.01 boundary field; Interview scheduling is integrated through M2.11+ without changing the M2.01 order boundary.
      if(order.deadline && Date.parse(order.deadline)<=now.getTime()) errors.push("Assurance Order deadline must be in the future.");
      const normalized=Object.freeze([...new Set(errors)]); const ready=normalized.length===0; const updated=await repository.recordValidation({tenantId:scope.tenantId,orderId:id,ready,errors:normalized,targetResults,now:now.toISOString()}); if(!updated) throw new AssuranceOrderConflictError();
      await repository.insertTimeline({eventId:createAssuranceTimelineEventId(),tenantId:scope.tenantId,orderId:id,caseId:null,eventType:"order_validated",fromStatus:order.orderStatus,toStatus:ready?"READY":"VALIDATION_FAILED",owner:"company",nextAction:ready?"Submit the validated Assurance Order.":"Resolve every validation error and validate again.",actorAccountId:scope.accountId,actorRole:"company",now:now.toISOString()});
      await audit(database,principal,"assurance_order.validated",id,{ready,errorCount:normalized.length}); return Object.freeze({ready,errors:normalized});
    }});
  }

  async submitOrder(principal:AssuranceOrderManagePrincipal,orderId:string,now=new Date()):Promise<readonly import("./assurance-order-domain").AssuranceCaseRecord[]>{
    const id=normalizeAssuranceReference(orderId,"assurance_order"); if(!id) throw new AssuranceOrderInputError("Assurance Order reference is invalid."); const nowIso=now.toISOString();
    return runTenantScopedCommand({database:this.database,principal,permission:ASSURANCE_ORDER_MANAGE_PERMISSION,now,operation:async({database,scope})=>{
      await assertVerifiedCompany(database,scope.tenantId); const repository=new AssuranceOrderRepository(database); const order=await repository.lockOrder(scope.tenantId,id); if(!order) throw new AssuranceOrderNotFoundError(); if(order.orderStatus!=="READY") throw new AssuranceOrderConflictError("Only a READY Assurance Order can be submitted.");
      const targets=await repository.listTargets(scope.tenantId,id,true); if(targets.length===0||targets.some(t=>t.targetStatus!=="eligible")) throw new AssuranceOrderConflictError("Assurance Order eligibility changed; validate again.");
      for(const target of targets){ if(!await activeLink(database,scope.tenantId,target.workerLinkId,true)) throw new AssuranceOrderConflictError("A Worker link changed; validate the Assurance Order again."); }
      const policyErrors=await validateAssurancePolicySelection(database,{tenantId:scope.tenantId,frameworkReferences:order.assessmentFrameworkReferences,policyReference:order.effectivePolicyReference,referenceTime:now});if(policyErrors.length>0)throw new AssuranceOrderConflictError(`Effective policy changed; validate again. ${policyErrors.join(" ")}`);

      for(const target of targets){const reason=await workerAssessmentPolicyReason(database,order,target.workerAccountId,now);if(reason)throw new AssuranceOrderConflictError(reason);}

      // The worker target rows are part of submitted scope. Move them to their
      // terminal submitted target state while the parent order is still READY;
      // only then activate the database immutability guard by submitting the
      // parent. The surrounding transaction rolls this entire sequence back if
      // case/timeline/action creation fails later in the command.
      for(const target of targets){
        const updatedTarget=await database.query(`UPDATE assurance_order_workers SET target_status='submitted',updated_at=$3 WHERE tenant_id=$1 AND target_id=$2 AND target_status='eligible'`,[scope.tenantId,target.targetId,nowIso]);
        if(updatedTarget.affectedRows!==1) throw new AssuranceOrderConflictError("Assurance Order eligibility changed; validate again.");
      }
      const submitted=await repository.markSubmitted(scope.tenantId,id,nowIso); if(!submitted) throw new AssuranceOrderConflictError("Assurance Order was already submitted or changed.");
      await repository.insertTimeline({eventId:createAssuranceTimelineEventId(),tenantId:scope.tenantId,orderId:id,caseId:null,eventType:"order_submitted",fromStatus:"READY",toStatus:"SUBMITTED",owner:null,nextAction:null,actorAccountId:scope.accountId,actorRole:"company",now:nowIso});
      for(const target of targets){
        const initial=await initialCaseStateForWorker(database,order,target.workerAccountId);
        const resolvedTarget=Object.freeze({...target,permanentWorkerId:initial.permanentWorkerId??target.permanentWorkerId});
        if(resolvedTarget.permanentWorkerId!==target.permanentWorkerId){
          await database.query(
            `UPDATE assurance_order_workers
                SET permanent_worker_id=$3,updated_at=$4
              WHERE tenant_id=$1 AND target_id=$2`,
            [scope.tenantId,target.targetId,resolvedTarget.permanentWorkerId,nowIso]
          );
        }
        const created=await repository.insertCase({caseId:createAssuranceCaseId(),target:resolvedTarget,status:initial.status,owner:initial.owner,nextAction:initial.nextAction,now:nowIso});
        if(!created) throw new AssuranceOrderConflictError("Duplicate Assurance Case creation was prevented.");
        await pinAssuranceCasePolicySnapshot(database,{caseId:created.caseId,tenantId:scope.tenantId,frameworkReferences:order.assessmentFrameworkReferences,policyReference:order.effectivePolicyReference,referenceTime:now,actorAccountId:scope.accountId,actorPrincipal:principal});
        await repository.insertTimeline({eventId:createAssuranceTimelineEventId(),tenantId:scope.tenantId,orderId:id,caseId:created.caseId,eventType:"case_created",fromStatus:null,toStatus:created.caseStatus,owner:created.owner,nextAction:created.nextAction,actorAccountId:scope.accountId,actorRole:"company",now:nowIso});
        if(initial.owner!=="background_job"){
          const item=await repository.insertAction({actionId:createAssuranceActionId(),tenantId:scope.tenantId,orderId:id,caseId:created.caseId,workerAccountId:created.workerAccountId,severity:"warning",reason:initial.nextAction,dueAt:submitted.deadline,owner:initial.owner,allowedAction:"open_case",deepLink:`/company/assurance-orders/${id}#${created.caseId}`,statutory:false,now:nowIso});
          if(!item) throw new AssuranceOrderConflictError("Initial Assurance Action could not be created exactly once.");
          await audit(database,principal,"assurance_action.created",item.actionId,{owner:item.owner});
        }
        await audit(database,principal,"assurance_case.created",created.caseId,{caseStatus:created.caseStatus,permanentWorkerId:created.permanentWorkerId});
      }
      await audit(database,principal,"assurance_order.submitted",id,{workerCount:targets.length}); return repository.listCases(scope.tenantId,id);
    }});
  }

  async cancelDraft(principal:AssuranceOrderManagePrincipal,orderId:string,now=new Date()):Promise<void>{ await this.cancel(principal,orderId,false,now); }
  async cancelSubmittedOrder(principal:AssuranceOrderManagePrincipal,orderId:string,now=new Date()):Promise<void>{ await this.cancel(principal,orderId,true,now); }
  private async cancel(
    principal: AssuranceOrderManagePrincipal,
    orderId: string,
    submitted: boolean,
    now: Date
  ): Promise<void> {
    const id=normalizeAssuranceReference(orderId,"assurance_order");
    if(!id) throw new AssuranceOrderInputError("Assurance Order reference is invalid.");
    await runTenantScopedCommand({
      database:this.database,principal,permission:ASSURANCE_ORDER_MANAGE_PERMISSION,now,
      operation:async({database,scope})=>{
        const repository=new AssuranceOrderRepository(database);
        const order=await repository.lockOrder(scope.tenantId,id);
        if(!order) throw new AssuranceOrderNotFoundError();
        const allowed=submitted?["SUBMITTED","PARTIALLY_FUNDED","ACTIVE"]:["DRAFT","VALIDATION_FAILED","READY"];
        if(!allowed.includes(order.orderStatus)) throw new AssuranceOrderConflictError("Assurance Order cannot be cancelled from its current state.");
        const cases=submitted?await repository.listCases(scope.tenantId,id):[];
        // Orders can be ACTIVE while one Worker has already received a final
        // decision. Cancellation must never rewrite that outcome to Closed
        // or leave an issued credential inconsistent with the case timeline.
        if(cases.some(item=>
          ["Approved","Conditionally approved","Rejected"].includes(item.caseStatus)
          || item.decisionReference!==null || item.credentialReference!==null
        )) throw new AssuranceOrderConflictError(
          "This Assurance Order has finalized Worker decisions or credentials and cannot be cancelled."
        );
        const nowIso=now.toISOString();
        await database.query(
          "UPDATE assurance_orders SET order_status='CANCELLED',cancelled_at=$3,updated_at=$3 WHERE tenant_id=$1 AND order_id=$2",
          [scope.tenantId,id,nowIso]
        );
        if(submitted) {
          for(const item of cases) {
            if(item.caseStatus==="Closed") continue;
            await database.query(
              "UPDATE assurance_cases SET case_status='Closed',owner_kind=NULL,next_action=NULL,closed_at=$3,updated_at=$3 WHERE tenant_id=$1 AND case_id=$2",
              [scope.tenantId,item.caseId,nowIso]
            );
            await repository.insertTimeline({
              eventId:createAssuranceTimelineEventId(),tenantId:scope.tenantId,orderId:id,
              caseId:item.caseId,eventType:"case_cancelled",fromStatus:item.caseStatus,
              toStatus:"Closed",owner:null,nextAction:null,actorAccountId:scope.accountId,
              actorRole:"company",now:nowIso
            });
            await audit(database,principal,"assurance_case.status.changed",item.caseId,{caseStatus:"Closed"});
          }
          await database.query(
            "UPDATE assurance_action_items SET action_status='resolved',updated_at=$3 WHERE tenant_id=$1 AND order_id=$2 AND action_status<>'resolved'",
            [scope.tenantId,id,nowIso]
          );
        }
        await repository.insertTimeline({
          eventId:createAssuranceTimelineEventId(),tenantId:scope.tenantId,orderId:id,
          caseId:null,eventType:"order_cancelled",fromStatus:order.orderStatus,
          toStatus:"CANCELLED",owner:null,nextAction:null,actorAccountId:scope.accountId,
          actorRole:"company",now:nowIso
        });
        await audit(database,principal,"assurance_order.cancelled",id,{submitted});
      }
    });
  }

  async listOrders(principal:AssuranceOrderReadPrincipal):Promise<readonly AssuranceOrderRecord[]>{ if(principal.authorizedTenantPermission!==ASSURANCE_ORDER_READ_PERMISSION) throw new AssuranceOrderAccessError(); const scope=deriveTrustedTenantScope(principal as TenantPermissionPrincipal<"company.orders.read">); return new AssuranceOrderRepository(this.database).listOrders(scope.tenantId); }
  async findOrder(principal:AssuranceOrderReadPrincipal,orderId:string):Promise<AssuranceOrderRecord|null>{ const id=normalizeAssuranceReference(orderId,"assurance_order"); if(!id) return null; const scope=deriveTrustedTenantScope(principal); return new AssuranceOrderRepository(this.database).findOrder(scope.tenantId,id); }
  async listCases(principal:AssuranceOrderReadPrincipal,orderId:string){ const id=normalizeAssuranceReference(orderId,"assurance_order"); if(!id) return Object.freeze([]); const scope=deriveTrustedTenantScope(principal); return new AssuranceOrderRepository(this.database).listCases(scope.tenantId,id); }
  async listInterviewSchedules(principal:AssuranceOrderReadPrincipal,orderId:string):Promise<Readonly<Record<string,string>>> {
    const id=normalizeAssuranceReference(orderId,"assurance_order");
    if(!id) return Object.freeze({});
    return runTenantScopedCommand({database:this.database,principal,permission:ASSURANCE_ORDER_READ_PERMISSION,
      operation:async({database,scope})=>{
        const result=await database.query<{case_id:string;scheduled_at:string|Date}>(
          `SELECT DISTINCT ON (requests.case_id) requests.case_id,requests.scheduled_at
           FROM interview_requests requests JOIN assurance_cases cases
             ON cases.case_id=requests.case_id AND cases.tenant_id=requests.tenant_id
           WHERE cases.tenant_id=$1 AND cases.order_id=$2 AND requests.scheduled_at IS NOT NULL
             AND requests.status IN ('ASSIGNED','WAITING_ROOM')
           ORDER BY requests.case_id,requests.requested_at DESC,requests.interview_request_id DESC`,
          [scope.tenantId,id]);
        const live=await database.query<{session_id:string}>(
          "SELECT session_id FROM auth_sessions WHERE session_id=$1 AND account_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()",
          [scope.sessionId,scope.accountId]);
        if(!live.rows[0]) throw new AssuranceOrderAccessError();
        return Object.freeze(Object.fromEntries(result.rows.map(row=>[row.case_id,new Date(row.scheduled_at).toISOString()])));
      }});
  }

}