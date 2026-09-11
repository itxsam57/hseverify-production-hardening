import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const beginActionPath = "src/app/worker/(portal)/available-assessments/actions.ts";
const submitActionPath = "src/app/worker/(portal)/assessments/[attemptId]/actions.ts";

function source(path, label) {
  assert.ok(existsSync(path), `M2.07 ${label} is missing: ${path}`);
  return readFileSync(path, "utf8");
}

function requireWorkerPermission(sourceText, label) {
  assert.match(sourceText, /requirePlatformPermission\s*\(/, `${label} must use centralized permission authorization`);
  assert.match(sourceText, /expectedRole:\s*["']worker["']/);
  assert.match(sourceText, /permission:\s*["']worker\.assessments\.read["']/);
}

function forbiddenBrowserAuthority(sourceText, label) {
  for (const forbidden of ["workerAccountId", "blueprintVersionId", "formId", "answerKey", "rubric", "score", "correct"]) {
    assert.equal(
      sourceText.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `${label} must not trust or return ${forbidden}`
    );
  }
}

test("M2.07 begin server action accepts only case/catalogue authority and redirects to the created owned attempt", () => {
  const action = source(beginActionPath, "begin action");
  assert.match(action, /^[\s\S]*["']use server["']/);
  assert.match(action, /export\s+async\s+function\s+beginAssessmentAction/);
  requireWorkerPermission(action, "begin action");
  assert.match(action, /formData\.get\(["']caseId["']\)/);
  assert.match(action, /formData\.get\(["']catalogueVersionId["']\)/);
  assert.match(action, /\.begin\s*\(/);
  assert.match(action, /redirect\s*\(\s*`\/worker\/assessments\/\$\{/);
  forbiddenBrowserAuthority(action, "begin action");
});

test("M2.07 submit server action parses only stale guards/current answer and maps expected errors to coarse UI state", () => {
  const action = source(submitActionPath, "submit action");
  assert.match(action, /^[\s\S]*["']use server["']/);
  assert.match(action, /export\s+async\s+function\s+submitAssessmentAnswerAction/);
  requireWorkerPermission(action, "submit action");
  for (const field of ["attemptId", "position", "questionVersionId", "answer"]) {
    assert.match(action, new RegExp(`formData\\.get\\(["']${field}["']\\)`));
  }
  assert.match(action, /submitCurrentAnswer\s*\(/);
  assert.match(action, /AssessmentAttemptAnswerInputError|AssessmentAttemptInputError/);
  assert.match(action, /AssessmentAttemptConflictError/);
  assert.match(action, /redirect\s*\(\s*`\/worker\/assessments\/\$\{/);
  forbiddenBrowserAuthority(action, "submit action");
});
