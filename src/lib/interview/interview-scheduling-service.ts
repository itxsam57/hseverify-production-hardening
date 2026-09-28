import "server-only";

import type { DatabaseClient } from "../database/database";
import {
  assignInterviewRequest,
  createInterviewRequest,
  scheduleInterviewRequest,
  moveInterviewToWaitingRoom,
  completeInterviewRequest,
  assertInterviewAssessorAccess,
  assertInterviewCaseOwnership,
  type InterviewRequest
} from "./interview-scheduling-domain";
import { InterviewSchedulingRepository } from "./interview-scheduling-repository";

export class InterviewSchedulingService {
  constructor(private readonly database: DatabaseClient) {}

  async getAssessorAssignments(input: { assessorAccountId:string }) {
    return new InterviewSchedulingRepository(this.database).findAssignedToAssessorAccount(input.assessorAccountId);
  }

  async getAssignedInterview(input: { assessorAccountId:string; interviewRequestId:string }) {
    const request = await new InterviewSchedulingRepository(this.database).findByRequestIdForAssessor(
      input.interviewRequestId,
      input.assessorAccountId
    );
    if (!request) throw new Error("Interview assignment was not found.");
    assertInterviewAssessorAccess(request, input.assessorAccountId);
    return request;
  }

  async getWorkerInterview(input: { workerAccountId:string; interviewRequestId:string }) {
    const request = await new InterviewSchedulingRepository(this.database).findByRequestIdForWorker(
      input.interviewRequestId,
      input.workerAccountId
    );
    if (!request) throw new Error("Interview request was not found.");
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

  async scheduleInterview(input: { tenantId: string; request: InterviewRequest; scheduledAt: string; reminderAt?: string }): Promise<InterviewRequest> {
    return new InterviewSchedulingRepository(this.database).update(input.tenantId, scheduleInterviewRequest(input.request, input.scheduledAt, input.reminderAt));
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