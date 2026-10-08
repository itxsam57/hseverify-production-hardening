import "server-only";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";

import type { DatabaseClient } from "../database/database";
import { InterviewAssignmentService } from "./interview-assignment-service";
import { AssuranceOrderRepository } from "../assurance/assurance-order-repository";
import { createAssuranceActionId, createAssuranceTimelineEventId } from "../assurance/assurance-order-domain";
import {
  assignInterviewRequest,
  createInterviewRequest,
  scheduleInterviewRequest,
  normalizeInterviewScheduleTimestamp,
  moveInterviewToWaitingRoom,
  completeInterviewRequest,
  assertInterviewAssessorAccess,
  assertInterviewCaseOwnership,
  InterviewSchedulingInputError,
  type InterviewRequest
} from "./interview-scheduling-domain";
import { InterviewSchedulingRepository } from "./interview-scheduling-repository";

export class InterviewAssignmentAccessError extends Error {
  constructor() {
    super("Interview assignment was not found.");
    this.name = "InterviewAssignmentAccessError";
  }
}

export class InterviewWorkerAccessError extends Error {
  constructor() {
    super("Interview request was not found.");
    this.name = "InterviewWorkerAccessError";
  }
}

export class InterviewSchedulingService {
  constructor(private readonly database: DatabaseClient) {}

  async getAssessorAssignments(input: { assessorAccountId:string; query?:string }) {
    return new InterviewSchedulingRepository(this.database).findAssignedToAssessorAccount(
      input.assessorAccountId,
      input.query
    );
  }

  async getAssignedInterview(input: { assessorAccountId:string; interviewRequestId:string }) {
    const request = await new InterviewSchedulingRepository(this.database).findByRequestIdForAssessor(
      input.interviewRequestId,
      input.assessorAccountId
    );
    if (!request) throw new InterviewAssignmentAccessError();
    assertInterviewAssessorAccess(request, input.assessorAccountId);
    return request;
  }

  async getWorkerInterview(input: { workerAccountId:string; interviewRequestId:string }) {
    const request = await new InterviewSchedulingRepository(this.database).findByRequestIdForWorker(
      input.interviewRequestId,
      input.workerAccountId
    );
    if (!request) throw new InterviewWorkerAccessError();
    assertInterviewCaseOwnership(request, input.workerAccountId);
    return request;
  }


  async getWorkerReplacementInterviewId(input:{workerAccountId:string;interviewRequestId:string}):Promise<string|null> {
    const result=await this.database.query<{interview_request_id:string}>(
      `SELECT replacement.interview_request_id FROM interview_requests original
       JOIN interview_requests replacement ON replacement.replaces_interview_request_id=original.interview_request_id
       WHERE original.interview_request_id=$1 AND original.worker_account_id=$2 AND original.status='CANCELLED'`,
      [input.interviewRequestId,input.workerAccountId]);
    return result.rows[0]?.interview_request_id ?? null;
  }

  async setWorkerAvailability(input:{principal:AuthorizationPrincipal;interviewRequestId:string;availableFrom:string;availableUntil:string}):Promise<void> {
    const actor=bindTrustedAuditActor(input.principal);
    if(actor.activeRole!=="worker")throw new InterviewWorkerAccessError();
    const availableFrom=normalizeInterviewScheduleTimestamp(input.availableFrom),availableUntil=normalizeInterviewScheduleTimestamp(input.availableUntil);
    if(availableFrom>=availableUntil)throw new InterviewSchedulingInputError("Availability must end after it starts.");
    await this.database.transaction(async(transaction)=>{
      const account=await transaction.query<{account_id:string}>(
        `SELECT accounts.account_id FROM auth_accounts accounts JOIN auth_account_roles roles
         ON roles.account_id=accounts.account_id AND roles.role='worker'
         WHERE accounts.account_id=$1 AND accounts.account_status='active' FOR NO KEY UPDATE OF accounts FOR UPDATE OF roles`,[actor.accountId]);
      if(!account.rows[0])throw new InterviewWorkerAccessError();
      const live=await transaction.query<{active_role:string;expires_at:string|Date;revoked_at:string|Date|null}>(
        "SELECT active_role,expires_at,revoked_at FROM auth_sessions WHERE session_id=$1 AND account_id=$2 FOR UPDATE",[actor.sessionId,actor.accountId]);
      const request=await new InterviewSchedulingRepository(transaction).findByRequestIdForWorker(input.interviewRequestId,actor.accountId,true);
      if(!request)throw new InterviewWorkerAccessError();
      const session=live.rows[0];
      const requireLiveSession=async()=>{
        const clock=await transaction.query<{now:string|Date}>("SELECT clock_timestamp() AS now"),now=clock.rows[0]?.now;
        if(!session || session.active_role!=="worker" || session.revoked_at!==null || !now ||
          new Date(session.expires_at).getTime()<=new Date(now).getTime())throw new InterviewWorkerAccessError();
        return new Date(now).getTime();
      };
      const now=await requireLiveSession();
      if(new Date(availableUntil).getTime()<=now)throw new InterviewSchedulingInputError("Availability must include a future time.");
      if(!["REQUESTED","ASSIGNED"].includes(request.status))throw new InterviewSchedulingInputError("This interview no longer accepts availability changes.");
      const runtime=await transaction.query<{interview_session_id:string}>("SELECT interview_session_id FROM interview_runtime_sessions WHERE interview_request_id=$1 FOR UPDATE",[request.interviewRequestId]);
      if(runtime.rows[0])throw new InterviewSchedulingInputError("A claimed interview cannot change availability.");
      if(request.workerAvailability?.availableFrom===availableFrom && request.workerAvailability.availableUntil===availableUntil){await requireLiveSession();return;}
      await transaction.query("UPDATE interview_requests SET candidate_available_from=$2,candidate_available_until=$3 WHERE interview_request_id=$1",[request.interviewRequestId,availableFrom,availableUntil]);
      await new DatabaseAuditRepository(Promise.resolve(transaction)).append(actor,{
        action:"interview.availability.updated",outcome:"succeeded",target:{type:"resource",reference:request.interviewRequestId},
        metadata:{tenantRef:request.tenantId,caseRef:request.caseId,workerRef:actor.accountId,availableFrom,availableUntil,previousAvailability:request.workerAvailability}
      });
      await requireLiveSession();
    });
  }

  async enterWaitingRoom(input: { tenantId:string; request:InterviewRequest; workerAccountId:string }): Promise<InterviewRequest> {
    assertInterviewCaseOwnership(input.request, input.workerAccountId);
    if (input.request.status === "WAITING_ROOM") return input.request;
    return new InterviewSchedulingRepository(this.database).update(
      input.tenantId,
      moveInterviewToWaitingRoom(input.request)
    );
  }

  async requestInterview(input: { tenantId: string; caseId: string; workerAccountId: string; requestedAt: string; timezone?: string }): Promise<InterviewRequest> {
    const repository = new InterviewSchedulingRepository(this.database);
    const existing = await repository.findByCase(input.tenantId, input.caseId);
    if (existing) return existing;
    return repository.insert(input.tenantId, createInterviewRequest(input));
  }

  async requestAdditionalInterview(input: { tenantId: string; caseId: string; workerAccountId: string; requestedAt: string; timezone?: string }): Promise<InterviewRequest> {
    return new InterviewSchedulingRepository(this.database).insert(
      input.tenantId,
      createInterviewRequest(input)
    );
  }

  async assignInterview(input: { tenantId: string; request: InterviewRequest; assessorAccountId: string }): Promise<InterviewRequest> {
    if (input.request.assessorAccountId && input.request.assessorAccountId !== input.assessorAccountId.trim()) {
      throw new Error("Interview assessor assignment mismatch.");
    }
    return new InterviewSchedulingRepository(this.database).update(input.tenantId, assignInterviewRequest(input.request, input.assessorAccountId));
  }

  async scheduleInterview(input: { principal: AuthorizationPrincipal; tenantId: string; request: InterviewRequest; scheduledAt: string; reminderAt?: string; rescheduleReason?: string }): Promise<InterviewRequest> {
    const actor = bindTrustedAuditActor(input.principal);
    if (actor.activeRole !== "assessor") throw new InterviewAssignmentAccessError();
    return this.database.transaction(async (transaction) => {
      const account = await transaction.query<{account_id:string}>(
        `SELECT accounts.account_id FROM auth_accounts accounts JOIN auth_account_roles roles
         ON roles.account_id=accounts.account_id AND roles.role='assessor'
         WHERE accounts.account_id=$1 AND accounts.account_status='active' FOR NO KEY UPDATE OF accounts FOR UPDATE OF roles`,
        [actor.accountId]);
      if (!account.rows[0]) throw new InterviewAssignmentAccessError();
      const live = await transaction.query<{session_id:string;active_role:string;expires_at:string|Date;revoked_at:string|Date|null}>(
        "SELECT session_id,active_role,expires_at,revoked_at FROM auth_sessions WHERE session_id=$1 AND account_id=$2 FOR UPDATE",
        [actor.sessionId,actor.accountId]);
      const repository = new InterviewSchedulingRepository(transaction);
      const current = await repository.findByRequestIdForAssessor(input.request.interviewRequestId,actor.accountId,true);
      if (!current || current.tenantId !== input.tenantId) throw new InterviewAssignmentAccessError();
      const clock = await transaction.query<{now:string|Date}>("SELECT clock_timestamp() AS now");
      const session=live.rows[0],now=clock.rows[0]?.now;
      if (!session || session.active_role !== "assessor" || session.revoked_at !== null || !now ||
          new Date(session.expires_at).getTime() <= new Date(now).getTime()) throw new InterviewAssignmentAccessError();
      const next = scheduleInterviewRequest(current,input.scheduledAt,input.reminderAt,input.rescheduleReason);
      if (next === current) return current;
      if(current.workerAvailability && next.scheduledAt &&
         (next.scheduledAt<current.workerAvailability.availableFrom || next.scheduledAt>=current.workerAvailability.availableUntil)){
        throw new InterviewSchedulingInputError("Choose an interview time within the Worker availability window.");
      }
      const runtime = await transaction.query<{interview_session_id:string}>(
        "SELECT interview_session_id FROM interview_runtime_sessions WHERE interview_request_id=$1 FOR UPDATE",
        [current.interviewRequestId]);
      if (runtime.rows[0]) {
        throw new InterviewSchedulingInputError("An interview already claimed or in the waiting room cannot be rescheduled.");
      }
      const updated = await repository.update(current.tenantId,next);
      const event = await new DatabaseAuditRepository(Promise.resolve(transaction)).append(actor,{
        action: "interview.scheduled",outcome: "succeeded",
        target: {type: "resource",reference: current.interviewRequestId},
        metadata: {tenantRef: current.tenantId,caseRef: current.caseId,workerRef: current.workerAccountId,scheduledAt: updated.scheduledAt,
          ...(current.scheduledAt ? {previousScheduledAt: current.scheduledAt,rescheduleReason: updated.rescheduleReason} : {})}
      });
      await transaction.query("UPDATE interview_requests SET schedule_event_id=$2 WHERE interview_request_id=$1",
        [current.interviewRequestId,event.auditEventId]);
      await transaction.query("SELECT platform_enqueue_interview_notifications($1)",[event.auditEventId]);
      await transaction.query("SELECT platform_enqueue_interview_emails($1)",[event.auditEventId]);
      const commitClock = await transaction.query<{now:string|Date}>("SELECT clock_timestamp() AS now");
      const committedAt = commitClock.rows[0]?.now;
      if (!committedAt || new Date(session.expires_at).getTime() <= new Date(committedAt).getTime()) {
        throw new InterviewAssignmentAccessError();
      }
      return updated;
    });
  }


  async requestReplacementInterview(input:{principal:AuthorizationPrincipal;interviewRequestId:string;reason:string}):Promise<InterviewRequest> {
    const actor=bindTrustedAuditActor(input.principal);
    const requestId=input.interviewRequestId.trim(),reason=input.reason.trim();
    if(actor.activeRole!=="assessor" || !requestId || requestId.length>200)throw new InterviewAssignmentAccessError();
    if(reason.length<10 || reason.length>1000)throw new InterviewSchedulingInputError("Provide a replacement reason between 10 and 1000 characters.");
    return this.database.transaction(async(transaction)=>{
      const account=await transaction.query<{account_id:string}>(
        `SELECT accounts.account_id FROM auth_accounts accounts JOIN auth_account_roles roles
         ON roles.account_id=accounts.account_id AND roles.role='assessor'
         WHERE accounts.account_id=$1 AND accounts.account_status='active' FOR NO KEY UPDATE OF accounts FOR UPDATE OF roles`,[actor.accountId]);
      if(!account.rows[0])throw new InterviewAssignmentAccessError();
      const live=await transaction.query<{active_role:string;expires_at:string|Date;revoked_at:string|Date|null}>(
        "SELECT active_role,expires_at,revoked_at FROM auth_sessions WHERE session_id=$1 AND account_id=$2 FOR UPDATE",[actor.sessionId,actor.accountId]);
      const repository=new InterviewSchedulingRepository(transaction);
      const preliminary=await repository.findByRequestIdForAssessor(requestId,actor.accountId);
      if(!preliminary)throw new InterviewAssignmentAccessError();
      // Case-first order matches progression; recheck the owned request after taking the case lock.
      const cases=await transaction.query<{case_id:string;order_id:string;tenant_id:string;worker_account_id:string;case_status:string;interview_reference:string|null}>(
        "SELECT case_id,order_id,tenant_id,worker_account_id,case_status,interview_reference FROM assurance_cases WHERE case_id=$1 AND tenant_id=$2 FOR UPDATE",
        [preliminary.caseId,preliminary.tenantId]);
      const current=await repository.findByRequestIdForAssessor(requestId,actor.accountId,true),caseRow=cases.rows[0];
      if(!current || !caseRow || current.caseId!==caseRow.case_id || current.tenantId!==caseRow.tenant_id || current.workerAccountId!==caseRow.worker_account_id)throw new InterviewAssignmentAccessError();
      const runtime=await transaction.query<{interview_session_id:string;status:string}>(
        "SELECT interview_session_id,status FROM interview_runtime_sessions WHERE interview_request_id=$1 FOR UPDATE",[requestId]);
      const session=live.rows[0];
      const requireLiveSession=async()=>{
        const clock=await transaction.query<{now:string|Date}>("SELECT clock_timestamp() AS now"),now=new Date(clock.rows[0]?.now ?? "");
        if(!session || session.active_role!=="assessor" || session.revoked_at!==null || !Number.isFinite(now.getTime()) || new Date(session.expires_at).getTime()<=now.getTime())throw new InterviewAssignmentAccessError();
        return now;
      };
      const now=await requireLiveSession(),history=runtime.rows[0];
      if(caseRow.case_status!=="Interview pending" || !history || !["NO_SHOW","TECHNICAL_HOLD"].includes(history.status))throw new InterviewSchedulingInputError("Only the current interrupted interview can request a replacement.");
      const existing=await transaction.query<{interview_request_id:string}>(
        "SELECT interview_request_id FROM interview_requests WHERE replaces_interview_request_id=$1",[requestId]);
      if(existing.rows[0]){
        if(current.status!=="CANCELLED" || caseRow.interview_reference!==existing.rows[0].interview_request_id)throw new InterviewSchedulingInputError("The case has already moved to another interview.");
        const replacement=await repository.findByRequestId(current.tenantId,existing.rows[0].interview_request_id);
        if(!replacement)throw new InterviewAssignmentAccessError();
        await requireLiveSession();return replacement;
      }
      if(!["ASSIGNED","WAITING_ROOM"].includes(current.status) || caseRow.interview_reference!==requestId)throw new InterviewSchedulingInputError("Only the current interrupted interview can request a replacement.");
      await repository.update(current.tenantId,{...current,status:"CANCELLED"});
      const interviews=new InterviewSchedulingService(transaction);
      let replacement=await interviews.requestAdditionalInterview({tenantId:current.tenantId,caseId:current.caseId,workerAccountId:current.workerAccountId,requestedAt:now.toISOString(),timezone:current.timezone});
      await transaction.query(
        `UPDATE interview_requests replacement SET replaces_interview_request_id=original.interview_request_id,
         trade_scope=original.trade_scope,qualification_scope=original.qualification_scope,
         risk_level=original.risk_level,language=original.language,jurisdiction=original.jurisdiction,
         recording_policy=original.recording_policy,recording_retention_days=original.recording_retention_days,
         recording_consent_required=original.recording_consent_required,
         candidate_available_from=CASE WHEN original.candidate_available_until>$3 THEN original.candidate_available_from ELSE NULL END,
         candidate_available_until=CASE WHEN original.candidate_available_until>$3 THEN original.candidate_available_until ELSE NULL END
         FROM interview_requests original WHERE replacement.interview_request_id=$1 AND original.interview_request_id=$2`,
        [replacement.interviewRequestId,requestId,now.toISOString()]);
      const assignment=await new InterviewAssignmentService(transaction).evaluateAndPersist(replacement.interviewRequestId,now);
      if(assignment.selectedAssessorAccountId)replacement=await interviews.assignInterview({tenantId:current.tenantId,request:replacement,assessorAccountId:assignment.selectedAssessorAccountId});
      const owner=replacement.assessorAccountId ? "assessor" as const : "admin" as const;
      const nextAction=replacement.assessorAccountId ? "Assigned Assessor must schedule the replacement interview." : "Assign an eligible Assessor to the replacement interview.";
      await transaction.query("UPDATE assurance_cases SET interview_reference=$3,owner_kind=$4,next_action=$5,updated_at=$6 WHERE case_id=$1 AND tenant_id=$2",
        [current.caseId,current.tenantId,replacement.interviewRequestId,owner,nextAction,now.toISOString()]);
      const orders=new AssuranceOrderRepository(transaction);
      await orders.insertTimeline({eventId:createAssuranceTimelineEventId(),tenantId:current.tenantId,orderId:caseRow.order_id,caseId:current.caseId,eventType:"interview_replacement_requested",fromStatus:"Interview pending",toStatus:"Interview pending",owner,nextAction,actorAccountId:actor.accountId,actorRole:"assessor",now:now.toISOString()});
      await transaction.query("UPDATE assurance_action_items SET action_status='resolved',updated_at=$2 WHERE case_id=$1 AND action_status<>'resolved'",[current.caseId,now.toISOString()]);
      const action=await orders.insertAction({actionId:createAssuranceActionId(),tenantId:current.tenantId,orderId:caseRow.order_id,caseId:current.caseId,workerAccountId:current.workerAccountId,severity:"warning",reason:nextAction,dueAt:null,owner,allowedAction:"open_case",deepLink:replacement.assessorAccountId ? "/assessor/interviews/"+replacement.interviewRequestId : "/admin/assessor-matching",statutory:false,now:now.toISOString()});
      if(!action)throw new Error("Replacement interview action could not be persisted.");
      await new DatabaseAuditRepository(Promise.resolve(transaction)).append(actor,{action:"interview.replacement.requested",outcome:"succeeded",target:{type:"resource",reference:requestId},
        metadata:{tenantRef:current.tenantId,caseRef:current.caseId,workerRef:current.workerAccountId,replacementInterviewRequestId:replacement.interviewRequestId,previousRuntimeSessionId:history.interview_session_id,previousRuntimeStatus:history.status,previousScheduledAt:current.scheduledAt,reason}});
      await requireLiveSession();return replacement;
    });
  }

  async completeInterview(input: {
    tenantId: string;
    request: InterviewRequest;
    assessorAccountId: string;
  }): Promise<InterviewRequest> {
    assertInterviewAssessorAccess(input.request, input.assessorAccountId);
    return new InterviewSchedulingRepository(this.database).update(
      input.tenantId,
      completeInterviewRequest(input.request)
    );
  }

  assertWorkerAccess(request: InterviewRequest, workerAccountId: string): void {
    assertInterviewCaseOwnership(request, workerAccountId);
  }

  async saveConsoleDraft(input:{tenantId:string; interviewSessionId:string; interviewRequestId:string; notes:readonly unknown[]; recommendation:string|null; submitted:boolean; updatedAt:string}):Promise<void> {
    return new InterviewSchedulingRepository(this.database).saveConsoleDraft(input);
  }

  async loadConsoleDraft(input:{tenantId:string; interviewSessionId:string}) {
    return new InterviewSchedulingRepository(this.database).loadConsoleDraft(input.tenantId, input.interviewSessionId);
  }

  async loadLatestConsoleDraft(input:{tenantId:string; interviewRequestId:string}) {
    return new InterviewSchedulingRepository(this.database).loadLatestConsoleDraft(
      input.tenantId,
      input.interviewRequestId
    );
  }

  async saveConsoleState(input:{tenantId:string; interviewSessionId:string; interviewRequestId:string; notes:readonly unknown[]; scorecard:unknown; recommendation:string|null; submitted:boolean; updatedAt:string}):Promise<void> {
    return new InterviewSchedulingRepository(this.database).saveConsoleState(input);
  }
}