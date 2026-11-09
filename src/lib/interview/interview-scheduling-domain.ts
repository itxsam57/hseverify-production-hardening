import type { InterviewPolicyScorecard } from "./interview-policy-domain";
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

export const INTERVIEW_CONSOLE_RECOMMENDATIONS = Object.freeze([
  "PASS",
  "CONDITIONAL_PASS",
  "ADDITIONAL_EVIDENCE_REQUIRED",
  "REASSESSMENT_REQUIRED",
  "SECOND_INTERVIEW_REQUIRED",
  "FAIL"
] as const);

export type InterviewSessionStatus = (typeof INTERVIEW_SESSION_STATUSES)[number];
export type InterviewConsoleRecommendation = (typeof INTERVIEW_CONSOLE_RECOMMENDATIONS)[number];

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

export type InterviewConsole = Readonly<{
  interviewSessionId: string;
  questionSetId: string;
  connectionState: "DISCONNECTED" | "CONNECTED";
  notes: readonly InterviewNote[];
  recordingPolicy: "VIDEO_AUDIO" | "AUDIO_ONLY" | "NOTES_ONLY" | "PROHIBITED";
  scorecard: Readonly<Partial<InterviewPolicyScorecard> & {
    technicalKnowledge: number | null;
    practicalReasoning: number | null;
    safetyAwareness: number | null;
    communication: number | null;
    consistencyWithWrittenAnswers: number | null;
    confidenceClarity: number | null;
    tradeJudgment: number | null;
    comments: string | null;
  }>;
  recommendation: InterviewConsoleRecommendation | null;
  submitted: boolean;
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

export function normalizeInterviewScheduleTimestamp(value: string): string {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/i);
  if (!match) throw new InterviewSchedulingInputError("Enter a valid interview time in UTC.");
  const calendar = `${match[1]}:${match[2] ?? "00"}${match[3] ?? ""}`;
  const calendarDate = new Date(`${calendar}Z`);
  if (!Number.isFinite(calendarDate.getTime()) ||
      calendarDate.toISOString().slice(0, 19) !== calendar.slice(0, 19)) {
    throw new InterviewSchedulingInputError("Enter a valid interview time in UTC.");
  }
  const instant = new Date(`${calendar}${match[4]?.toUpperCase() ?? "Z"}`);
  if (!Number.isFinite(instant.getTime())) {
    throw new InterviewSchedulingInputError("Enter a valid interview time in UTC.");
  }
  return instant.toISOString();
}

export function scheduleInterviewRequest(
  request: InterviewRequest,
  scheduledAt: string,
  reminderAt?: string,
  rescheduleReason?: string
): InterviewRequest {
  if (!scheduledAt.trim()) throw new InterviewSchedulingInputError();
  if (request.status !== "ASSIGNED" || !request.assessorAccountId) {
    throw new InterviewSchedulingInputError("Assigned assessor is required before scheduling.");
  }

  const instant = normalizeInterviewScheduleTimestamp(scheduledAt);
  const reminder = reminderAt === undefined ? request.reminderAt :
    reminderAt.trim() ? normalizeInterviewScheduleTimestamp(reminderAt) : null;
  if (reminder && reminder >= instant) throw new InterviewSchedulingInputError("Choose a reminder time before the interview.");
  if (request.scheduledAt === instant && request.reminderAt === reminder) return request;
  const next = request.scheduledAt ? rescheduleInterviewRequest(request, rescheduleReason ?? "") : request;
  return Object.freeze({
    ...next,
    scheduledAt: instant,
    reminderAt: reminder
  });
}

export function rescheduleInterviewRequest(
  request: InterviewRequest,
  reason: string
): InterviewRequest {
  const normalized = reason.trim();
  if (request.status !== "ASSIGNED" || normalized.length < 10 || normalized.length > 1000) {
    throw new InterviewSchedulingInputError("Reschedule reason must contain between 10 and 1000 characters.");
  }

  return Object.freeze({
    ...request,
    scheduledAt: null,
    reminderAt: null,
    rescheduleReason: normalized
  });
}

export function moveInterviewToWaitingRoom(request: InterviewRequest): InterviewRequest {
  if (request.status !== "ASSIGNED" || !request.scheduledAt) {
    throw new InterviewSchedulingInputError("Scheduled assigned interviews enter the waiting room only.");
  }

  return Object.freeze({ ...request, status: "WAITING_ROOM" as const });
}

export function completeInterviewRequest(request: InterviewRequest): InterviewRequest {
  if (
    !request.scheduledAt ||
    !request.assessorAccountId ||
    !["ASSIGNED", "WAITING_ROOM"].includes(request.status)
  ) {
    throw new InterviewSchedulingInputError(
      "Only scheduled assigned interviews can be completed."
    );
  }
  return Object.freeze({ ...request, status: "COMPLETED" as const });
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

export function createInterviewConsole(input: { interviewSessionId: string; questionSetId: string }): InterviewConsole {
  if (!input.interviewSessionId.trim() || !input.questionSetId.trim()) throw new InterviewSchedulingInputError();
  return Object.freeze({
    interviewSessionId: input.interviewSessionId.trim(),
    questionSetId: input.questionSetId.trim(),
    connectionState: "DISCONNECTED" as const,
    notes: Object.freeze([]),
    recordingPolicy: "NOTES_ONLY" as const,
    scorecard: Object.freeze({
      technicalKnowledge: null,
      practicalReasoning: null,
      safetyAwareness: null,
      communication: null,
      consistencyWithWrittenAnswers: null,
      confidenceClarity: null,
      tradeJudgment: null,
      comments: null
    }),
    recommendation: null,
    submitted: false
  });
}

export function updateInterviewScorecard(
  consoleState: InterviewConsole,
  scorecard: InterviewConsole["scorecard"]
): InterviewConsole {
  if (consoleState.submitted) throw new InterviewSchedulingInputError("Submitted interviews cannot be edited.");
  const dimensions: Array<[string, number | null]> = [
    ["Technical knowledge", scorecard.technicalKnowledge],
    ["Practical reasoning", scorecard.practicalReasoning],
    ["Safety awareness", scorecard.safetyAwareness],
    ["Communication", scorecard.communication],
    ["Consistency with written answers", scorecard.consistencyWithWrittenAnswers],
    ["Confidence / clarity", scorecard.confidenceClarity],
    ["Trade judgment", scorecard.tradeJudgment]
  ];
  for (const [label, value] of dimensions) {
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 5)) {
      throw new InterviewSchedulingInputError(`${label} score must be a whole number between zero and five.`);
    }
  }
  return Object.freeze({ ...consoleState, scorecard: Object.freeze({ ...scorecard }) });
}

export function saveInterviewConsoleNote(consoleState: InterviewConsole, note: InterviewNote): InterviewConsole {
  if (consoleState.submitted) throw new InterviewSchedulingInputError("Submitted interviews cannot be edited.");
  if (note.interviewSessionId !== consoleState.interviewSessionId) {
    throw new InterviewSchedulingInputError("Interview note session mismatch.");
  }
  return Object.freeze({ ...consoleState, notes: Object.freeze([...consoleState.notes, note]) });
}

export function submitInterviewRecommendation(consoleState: InterviewConsole, recommendation: InterviewConsoleRecommendation): InterviewConsole {
  if (consoleState.submitted) {
    throw new InterviewSchedulingInputError("Interview recommendation has already been submitted.");
  }
  if (!INTERVIEW_CONSOLE_RECOMMENDATIONS.includes(recommendation)) {
    throw new InterviewSchedulingInputError("Interview recommendation is invalid.");
  }
  return Object.freeze({ ...consoleState, recommendation, submitted: true });
}

export function updateInterviewRecordingPolicy(
  consoleState: InterviewConsole,
  recordingPolicy: InterviewConsole["recordingPolicy"]
): InterviewConsole {
  if (consoleState.submitted) throw new InterviewSchedulingInputError("Submitted interviews cannot be edited.");
  if (!["VIDEO_AUDIO", "AUDIO_ONLY", "NOTES_ONLY", "PROHIBITED"].includes(recordingPolicy)) {
    throw new InterviewSchedulingInputError("Interview recording policy is invalid.");
  }
  return Object.freeze({ ...consoleState, recordingPolicy });
}

export function connectInterviewConsole(consoleState: InterviewConsole): InterviewConsole {
  if (consoleState.submitted) throw new InterviewSchedulingInputError("Submitted interviews cannot reconnect.");
  return Object.freeze({ ...consoleState, connectionState: "CONNECTED" as const });
}
