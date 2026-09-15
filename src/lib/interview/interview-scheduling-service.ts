import "server-only";

import type { DatabaseClient } from "../database/database";
import {
  assignInterviewRequest,
  createInterviewRequest,
  scheduleInterviewRequest,
  assertInterviewAssessorAccess,
  assertInterviewCaseOwnership,
  type InterviewRequest
} from "./interview-scheduling-domain";
import { InterviewSchedulingRepository } from "./interview-scheduling-repository";

export class InterviewSchedulingService {
  constructor(private readonly database: DatabaseClient) {}

  async getAssessorAssignments(input: { tenantId:string; assessorAccountId:string }):Promise<InterviewRequest[]> {
    return new InterviewSchedulingRepository(this.database).findAssignedToAssessor(input.tenantId, input.assessorAccountId);
  }

  async getAssignedInterview(input: { tenantId:string; assessorAccountId:string; interviewRequestId:string }):Promise<InterviewRequest> {
    const request = await new InterviewSchedulingRepository(this.database).findByRequestId(input.tenantId, input.interviewRequestId);
    if (!request) throw new Error("Interview assignment was not found.");
    assertInterviewAssessorAccess(request, input.assessorAccountId);
    return request;
  }

  async requestInterview(input: { tenantId: string; caseId: string; workerAccountId: string; requestedAt: string; timezone?: string }): Promise<InterviewRequest> {
    const repository = new InterviewSchedulingRepository(this.database);
    const existing = await repository.findByCase(input.tenantId, input.caseId);
    if (existing) return existing;
    return repository.insert(input.tenantId, createInterviewRequest(input));
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

  assertWorkerAccess(request: InterviewRequest, workerAccountId: string): void {
    assertInterviewCaseOwnership(request, workerAccountId);
  }

  async saveConsoleDraft(input:{tenantId:string; interviewSessionId:string; interviewRequestId:string; notes:readonly unknown[]; recommendation:string|null; submitted:boolean; updatedAt:string}):Promise<void> {
    return new InterviewSchedulingRepository(this.database).saveConsoleDraft(input);
  }

  async loadConsoleDraft(input:{tenantId:string; interviewSessionId:string}) {
    return new InterviewSchedulingRepository(this.database).loadConsoleDraft(input.tenantId, input.interviewSessionId);
  }

  async saveConsoleState(input:{tenantId:string; interviewSessionId:string; interviewRequestId:string; notes:readonly unknown[]; scorecard:unknown; recommendation:string|null; submitted:boolean; updatedAt:string}):Promise<void> {
    return new InterviewSchedulingRepository(this.database).saveConsoleState(input);
  }
}
