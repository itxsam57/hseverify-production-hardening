import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile("src/lib/interview/interview-scheduling-domain.ts", "utf8");

test("interview scheduling foundation defines candidate request and assignment lifecycle", () => {
  assert.match(source, /REQUESTED/);
  assert.match(source, /ASSIGNED/);
  assert.match(source, /assessorAccountId/);
  assert.match(source, /workerAccountId/);
});

test("interview request rejects missing ownership fields", () => {
  assert.match(source, /InterviewSchedulingInputError/);
  assert.match(source, /input\.caseId\.trim\(\)/);
});

test("interview assignment requires requested state and protects ownership", () => {
  assert.match(source, /Only requested interviews can be assigned/);
  assert.match(source, /Interview request ownership mismatch/);
  assert.match(source, /scheduleInterviewRequest/);
});

test("interview console foundation defines session, media boundary and notes", () => {
  assert.match(source, /INTERVIEW_SESSION_STATUSES/);
  assert.match(source, /mediaProvider/);
  assert.match(source, /recordingAllowed/);
  assert.match(source, /createInterviewNote/);
});
