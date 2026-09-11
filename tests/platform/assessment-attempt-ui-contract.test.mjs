import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const availablePagePath = "src/app/worker/(portal)/available-assessments/page.tsx";
const assessmentPagePath = "src/app/worker/(portal)/assessments/[attemptId]/page.tsx";
const workspacePath = "src/components/worker/assessment-workspace.tsx";

function source(path, label) {
  assert.ok(existsSync(path), `M2.07 ${label} is missing: ${path}`);
  return readFileSync(path, "utf8");
}

function absent(haystack, needles, label) {
  for (const needle of needles) {
    assert.equal(
      haystack.toLowerCase().includes(needle.toLowerCase()),
      false,
      `${label} must not contain ${needle}`
    );
  }
}

test("M2.07 Available Assessments stays read-only on GET and exposes a POST start control only for eligible cards", () => {
  const page = source(availablePagePath, "Available Assessments page");
  assert.match(page, /listAvailableForWorker\s*\(/);
  assert.doesNotMatch(page, /\.begin\s*\(/);
  assert.match(page, /beginAssessmentAction/);
  assert.match(page, /<form[^>]+action=\{beginAssessmentAction\}/s);
  assert.match(page, /name=["']caseId["']/);
  assert.match(page, /name=["']catalogueVersionId["']/);
  assert.match(page, />\s*Start assessment\s*</);
  assert.doesNotMatch(page, /launch is intentionally unavailable/i);
  absent(page, ["workerAccountId", "blueprintVersionId", "formId"], "Available Assessments browser form");
});

test("M2.07 assessment GET page reads only the authenticated Worker's owned attempt view", () => {
  const page = source(assessmentPagePath, "assessment page");
  assert.match(page, /requirePlatformPermission\s*\(/);
  assert.match(page, /expectedRole:\s*["']worker["']/);
  assert.match(page, /permission:\s*["']worker\.assessments\.read["']/);
  assert.match(page, /getOwnedView\s*\(/);
  assert.doesNotMatch(page, /\.begin\s*\(/);
  assert.doesNotMatch(page, /generateForCase/);
  assert.match(page, /AssessmentWorkspace/);
  absent(page, ["answerKey", "rubric", "score", "correct", "generatedAssessmentForm"], "assessment page");
});

test("M2.07 assessment client boundary projects only submitted state and the safe current question", () => {
  const page = source(assessmentPagePath, "assessment page");
  const workspace = source(workspacePath, "assessment workspace");

  assert.match(page, /toAssessmentAttemptClientView/);
  assert.doesNotMatch(page, /<AssessmentWorkspace\s+view=\{view\}/);
  assert.match(workspace, /AssessmentAttemptClientView/);
  assert.doesNotMatch(workspace, /AssessmentAttemptView/);
  absent(
    workspace,
    [
      "workerAccountId",
      "caseId",
      "catalogueVersionId",
      "blueprintVersionId",
      "formId",
      "startedAt",
      "submittedAt",
      "createdAt",
      "updatedAt"
    ],
    "assessment client projection"
  );
});

test("M2.07 client workspace renders exactly one current question across all six canonical input types", () => {
  const workspace = source(workspacePath, "assessment workspace");
  assert.match(workspace, /^[\s\S]*["']use client["']/);
  assert.match(workspace, /AssessmentAttemptClientView/);
  assert.match(workspace, /currentQuestion/);
  assert.match(workspace, /Question\s*\{?[^\n]*position/i);
  assert.match(workspace, /questionCount/);
  for (const type of [
    "MULTIPLE_CHOICE",
    "TRUE_FALSE",
    "SHORT_TEXT",
    "LONG_TEXT",
    "INTEGER",
    "DECIMAL"
  ]) {
    assert.match(workspace, new RegExp(type));
  }
  assert.match(workspace, /type=["']radio["']/);
  assert.match(workspace, /textarea|Textarea/);
  assert.match(workspace, /inputMode=["']numeric["']/);
  assert.match(workspace, /inputMode=["']decimal["']/);
  assert.match(workspace, /Next/);
  assert.match(workspace, /Submit assessment/);
  assert.match(workspace, /disabled=\{[^}]*\bpending\b[^}]*\}/);
  assert.match(workspace, /role=["']status["']|aria-live=/);
  assert.doesNotMatch(workspace, />\s*Previous\s*</i);
  absent(
    workspace,
    ["answerKey", "rubric", "score", "correct", "generatedAssessmentForm", "questions:", "items:"],
    "assessment workspace"
  );
});
