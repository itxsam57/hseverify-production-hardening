import { createIdentifier } from "../auth/auth-domain";

export const INTERVIEW_REQUEST_STATUSES = Object.freeze([
  "REQUESTED",
  "ASSIGNED",
  "WAITING_ROOM",
  "COMPLETED",
  "CANCELLED"
] as const);

export const INTERVIEW_SESSION_STATUSES = Object.freeze([
  "READY",
  "LIVE",
  "ENDED",
  "CANCELLED"
] as const);

export type InterviewSessionStatus = (typeof INTERVIEW_SESSION_STATUSES)[number];

export type InterviewRequestStatus = (typeof INTERVIEW_REQUEST_STATUSES)[number];

export function assertInterviewAssessorAccess(
  request: InterviewRequest,
  assessorAccountId: string
): void {
  if (!assessorAccountId.trim() || request.assessorAccountId !== assessorAccountId.trim()) {
    throw new InterviewSchedulingInputError("Interview assessor assignment mismatch.");
  }
}

export type InterviewRequest = Readonly<{
  interviewRequestId: string;
  caseId: string;
  workerAccountId: string;
  status: InterviewRequestStatus;
  requestedAt: string;
  scheduledAt: string | null;
  assessorAccountId: string | null;
  timezone: string;
  reminderAt: string | null;
  rescheduleReason: string | null;
}>;

export type InterviewSession = Readonly<{
  interviewSessionId: string;
  interviewRequestId: string;
  caseId: string;
  status: InterviewSessionStatus;
  mediaProvider: "LOCAL_ADAPTER" | "EXTERNAL_PROVIDER";
  recordingAllowed: boolean;
}>;

export type InterviewNote = Readonly<{
  noteId: string;
  interviewSessionId: string;
  authorAccountId: string;
  content: string;
}>;

export class InterviewSchedulingInputError extends Error {
  constructor(message = "Interview request input is invalid.") {
    super(message);
    this.name = "InterviewSchedulingInputError";
  }
}

export const createInterviewRequestId = (): string => createIdentifier("interview_request");
export const createInterviewSessionId = (): string => createIdentifier("interview_session");
export const createInterviewNoteId = (): string => createIdentifier("interview_note");

export function createInterviewRequest(input: {
  caseId: string;
  workerAccountId: string;
  requestedAt: string;
  timezone?: string;
}): InterviewRequest {
  if (!input.caseId.trim() || !input.workerAccountId.trim() || !input.requestedAt.trim()) {
    throw new InterviewSchedulingInputError();
  }

  return Object.freeze({
    interviewRequestId: createInterviewRequestId(),
    caseId: input.caseId,
    workerAccountId: input.workerAccountId,
    status: "REQUESTED" as const,
    requestedAt: input.requestedAt,
    scheduledAt: null,
    assessorAccountId: null,
    timezone: input.timezone?.trim() || "UTC",
    reminderAt: null,
    rescheduleReason: null
  });
}

export function assignInterviewRequest(
  request: InterviewRequest,
  assessorAccountId: string
): InterviewRequest {
  if (!assessorAccountId.trim()) throw new InterviewSchedulingInputError();
  if (request.status !== "REQUESTED") throw new InterviewSchedulingInputError("Only requested interviews can be assigned.");

  return Object.freeze({
    ...request,
    status: "ASSIGNED" as const,
    assessorAccountId
  });
}

export function scheduleInterviewRequest(
  request: InterviewRequest,
  scheduledAt: string,
  reminderAt?: string
): InterviewRequest {
  if (!scheduledAt.trim()) throw new InterviewSchedulingInputError();
  if (request.status !== "ASSIGNED" || !request.assessorAccountId) {
    throw new InterviewSchedulingInputError("Assigned assessor is required before scheduling.");
  }

  return Object.freeze({
    ...request,
    scheduledAt,
    reminderAt: reminderAt?.trim() || null,
    rescheduleReason: null
  });
}

export function rescheduleInterviewRequest(
  request: InterviewRequest,
  reason: string
): InterviewRequest {
  if (request.status !== "ASSIGNED" || !reason.trim()) {
    throw new InterviewSchedulingInputError("Assigned interviews require a reschedule reason.");
  }

  return Object.freeze({
    ...request,
    scheduledAt: null,
    reminderAt: null,
    rescheduleReason: reason.trim()
  });
}

export function moveInterviewToWaitingRoom(request: InterviewRequest): InterviewRequest {
  if (request.status !== "ASSIGNED" || !request.scheduledAt) {
    throw new InterviewSchedulingInputError("Scheduled assigned interviews enter the waiting room only.");
  }

  return Object.freeze({ ...request, status: "WAITING_ROOM" as const });
}

export function assertInterviewCaseOwnership(
  request: InterviewRequest,
  workerAccountId: string
): void {
  if (request.workerAccountId !== workerAccountId.trim()) {
    throw new InterviewSchedulingInputError("Interview request ownership mismatch.");
  }
}

export function createInterviewSession(input: {
  interviewRequestId: string;
  caseId: string;
  mediaProvider?: InterviewSession["mediaProvider"];
  recordingAllowed?: boolean;
}): InterviewSession {
  if (!input.interviewRequestId.trim() || !input.caseId.trim()) {
    throw new InterviewSchedulingInputError();
  }

  return Object.freeze({
    interviewSessionId: createInterviewSessionId(),
    interviewRequestId: input.interviewRequestId,
    caseId: input.caseId,
    status: "READY" as const,
    mediaProvider: input.mediaProvider ?? "LOCAL_ADAPTER",
    recordingAllowed: input.recordingAllowed ?? false
  });
}

export function startInterviewSession(session: InterviewSession): InterviewSession {
  if (session.status !== "READY") {
    throw new InterviewSchedulingInputError("Only ready interview sessions can start.");
  }
  return Object.freeze({ ...session, status: "LIVE" as const });
}

export function assertInterviewSessionOwnership(
  session: InterviewSession,
  request: InterviewRequest
): void {
  if (session.interviewRequestId !== request.interviewRequestId || session.caseId !== request.caseId) {
    throw new InterviewSchedulingInputError("Interview session request mismatch.");
  }
}

export function createInterviewNote(input: {
  interviewSessionId: string;
  authorAccountId: string;
  content: string;
}): InterviewNote {
  if (!input.interviewSessionId.trim() || !input.authorAccountId.trim() || !input.content.trim()) {
    throw new InterviewSchedulingInputError();
  }

  return Object.freeze({
    noteId: createInterviewNoteId(),
    ...input
  });
}
