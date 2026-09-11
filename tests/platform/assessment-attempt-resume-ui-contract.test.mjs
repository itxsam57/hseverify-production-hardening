import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const availablePagePath = "src/app/worker/(portal)/available-assessments/page.tsx";

function source(path, label) {
  assert.ok(existsSync(path), `M2.08 ${label} is missing: ${path}`);
  return readFileSync(path, "utf8");
}

function absent(sourceText, values, label) {
  for (const value of values) {
    assert.equal(
      sourceText.toLowerCase().includes(value.toLowerCase()),
      false,
      `${label} must not contain ${value}`
    );
  }
}

test("M2.08 Available Assessments renders a separate owned In progress section with direct Resume links", () => {
  const page = source(availablePagePath, "Available Assessments page");

  assert.match(page, /requirePlatformPermission\s*\(/);
  assert.match(page, /expectedRole:\s*["']worker["']/);
  assert.match(page, /permission:\s*["']worker\.assessments\.read["']/);
  assert.match(page, /getAssessmentAttemptService\s*\(/);
  assert.match(page, /listOwnedInProgress\s*\(\s*principal\s*\)/);
  assert.match(page, /In progress/);
  assert.match(page, /inProgress\.map\s*\(/);
  assert.match(page, /Resume assessment/);
  assert.match(page, /\/worker\/assessments\/\$\{attempt\.attemptId\}/);
  assert.match(page, /attempt\.catalogueTitle/);
  assert.match(page, /attempt\.currentPosition/);
  assert.match(page, /attempt\.questionCount/);

  assert.match(page, /listAvailableForWorker\s*\(/);
  assert.doesNotMatch(page, /\.begin\s*\(/);
  absent(
    page,
    [
      "currentDraft",
      "draftPayload",
      "textValue",
      "booleanValue",
      "numericValue",
      "questionVersionId",
      "workerAccountId",
      "formId"
    ],
    "Available Assessments resume projection"
  );
});

test("M2.08 Resume remains a read-only GET surface and does not create or mutate an attempt", () => {
  const page = source(availablePagePath, "Available Assessments page");

  assert.match(page, /listOwnedInProgress\s*\(/);
  assert.match(page, /href=\{`\/worker\/assessments\/\$\{attempt\.attemptId\}`\}/);
  assert.doesNotMatch(page, /submitAssessmentAnswerAction/);
  assert.doesNotMatch(page, /saveAssessmentDraftAction/);
  assert.doesNotMatch(page, /\.saveCurrentDraft\s*\(/);
  assert.doesNotMatch(page, /\.submitCurrentAnswer\s*\(/);
});
