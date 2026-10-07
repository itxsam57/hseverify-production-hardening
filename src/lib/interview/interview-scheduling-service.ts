import "server-only";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";

import type { DatabaseClient } from "../database/database";
import {
  assignInterviewRequest,
  createInterviewRequest,
  scheduleInterviewRequest,
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