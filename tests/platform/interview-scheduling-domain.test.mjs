import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const {
  InterviewSchedulingInputError,
  assignInterviewRequest,
  assertInterviewAssessorAccess,
  assertInterviewCaseOwnership,
  createInterviewRequest,
  createInterviewConsole,
  createInterviewNote,
  createInterviewSession,
  scheduleInterviewRequest,
  saveInterviewConsoleNote,
  updateInterviewScorecard,
  submitInterviewRecommendation
} = loadTs("src/lib/interview/interview-scheduling-domain.ts");

test("interview scheduling foundation defines candidate request and assignment lifecycle", () => {
  const request = createInterviewRequest({ caseId: "case-1", workerAccountId: "worker-1", requestedAt: "2026-09-14T10:00:00Z" });
  const assigned = assignInterviewRequest(request, "assessor-1");
  assert.equal(request.status, "REQUESTED");
  assert.equal(assigned.status, "ASSIGNED");
  assert.equal(assigned.assessorAccountId, "assessor-1");
});

test("interview request rejects missing ownership fields", () => {
  assert.throws(() => createInterviewRequest({ caseId: " ", workerAccountId: "worker", requestedAt: "now" }), InterviewSchedulingInputError);
});

test("interview assignment requires requested state and protects ownership", () => {
  const assigned = assignInterviewRequest(createInterviewRequest({ caseId: "case-1", workerAccountId: "worker-1", requestedAt: "now" }), "assessor-1");
  assert.throws(() => assignInterviewRequest(assigned, "assessor-2"), InterviewSchedulingInputError);
  assert.throws(() => assertInterviewCaseOwnership(assigned, "worker-2"), InterviewSchedulingInputError);
  assert.equal(scheduleInterviewRequest(assigned, "2026-09-14T11:00:00Z").scheduledAt, "2026-09-14T11:00:00Z");
});

test("interview console foundation defines session and media boundary", () => {
  const session = createInterviewSession({ interviewRequestId: "request-1", caseId: "case-1" });
  assert.equal(session.mediaProvider, "LOCAL_ADAPTER");
  assert.equal(session.recordingAllowed, false);
  assert.doesNotThrow(() => assertInterviewAssessorAccess({ assessorAccountId: "assessor-1" }, "assessor-1"));
});


test("interview console preserves notes and closes recommendation lifecycle", () => {
  const consoleState = createInterviewConsole({ interviewSessionId: "session-1", questionSetId: "questions-1" });
  const note = createInterviewNote({ interviewSessionId: "session-1", authorAccountId: "assessor-1", content: "Candidate evidence captured." });
  const withNote = saveInterviewConsoleNote(consoleState, note);
  const submitted = submitInterviewRecommendation(withNote, "PASS");

  assert.equal(withNote.notes.length, 1);
  assert.equal(submitted.recommendation, "PASS");
  assert.equal(submitted.submitted, true);
  assert.throws(() => saveInterviewConsoleNote(submitted, note), InterviewSchedulingInputError);
  assert.throws(() => submitInterviewRecommendation(submitted, "FAIL"), InterviewSchedulingInputError);
});

test("interview console scorecard keeps bounded assessor scoring before recommendation", () => {
  const consoleState = createInterviewConsole({ interviewSessionId: "session-1", questionSetId: "questions-1" });
  const updated = updateInterviewScorecard(consoleState, {
    technicalKnowledge: 4,
    safetyAwareness: 5,
    comments: "Safety reasoning captured."
  });
  assert.equal(updated.scorecard.technicalKnowledge, 4);
  assert.throws(() => updateInterviewScorecard(consoleState, { technicalKnowledge: 9, safetyAwareness: 1, comments: null }), InterviewSchedulingInputError);
});
