import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const actionPath = "src/app/worker/(portal)/assessments/[attemptId]/actions.ts";

function source() {
  assert.ok(existsSync(actionPath), `M2.08 assessment action module is missing: ${actionPath}`);
  return readFileSync(actionPath, "utf8");
}

function exportedFunction(sourceText, name) {
  const marker = `export async function ${name}`;
  const start = sourceText.indexOf(marker);
  assert.notEqual(start, -1, `M2.08 ${name} is missing`);
  const next = sourceText.indexOf("\nexport async function ", start + marker.length);
  return sourceText.slice(start, next === -1 ? sourceText.length : next);
}

test("M2.08 draft server action accepts only stale guards, draft payload, CAS revision, and mutation key", () => {
  const action = source();
  assert.match(action, /^[\s\S]*["']use server["']/);
  const save = exportedFunction(action, "saveAssessmentDraftAction");

  assert.match(save, /requirePlatformPermission\s*\(/);
  assert.match(save, /expectedRole:\s*["']worker["']/);
  assert.match(save, /permission:\s*["']worker\.assessments\.read["']/);

  for (const field of [
    "attemptId",
    "position",
    "questionVersionId",
    "draftPayload",
    "expectedRevision",
    "clientGeneratedMutationKey"
  ]) {
    assert.match(save, new RegExp(`formData\\.get\\(["']${field}["']\\)`));
  }

  for (const forbidden of [
    "workerAccountId",
    "formId",
    "formItemId",
    "questionId",
    "questionType",
    "answerKey",
    "rubric"
  ]) {
    assert.doesNotMatch(save, new RegExp(`formData\\.get\\(["']${forbidden}["']\\)`));
  }

  assert.match(save, /saveCurrentDraft\s*\(/);
  assert.doesNotMatch(save, /console\.(?:log|info|warn|error|debug)\s*\(/);
});

test("M2.08 draft server action maps errors coarsely and returns only safe acknowledgement metadata", () => {
  const action = source();
  const save = exportedFunction(action, "saveAssessmentDraftAction");

  assert.match(save, /AssessmentAttemptConflictError/);
  assert.match(save, /AssessmentAttemptInputError|AssessmentAttemptDraftInputError/);
  assert.match(save, /AssessmentAttemptAccessError/);
  assert.match(save, /status:\s*["']saved["']/);
  assert.match(save, /revision/);
  assert.match(save, /updatedAt/);

  for (const forbidden of [
    "workerAccountId",
    "formId",
    "formItemId",
    "questionId",
    "questionType",
    "textValue",
    "booleanValue",
    "numericValue",
    "latestMutationKey",
    "latestMutationDigest"
  ]) {
    assert.equal(save.includes(forbidden), false, `${forbidden} must not be returned or exposed by draft action`);
  }
});

test("M2.08 same-question conflict returns only the latest safe server draft needed for explicit CAS reconciliation", () => {
  const action = source();
  const save = exportedFunction(action, "saveAssessmentDraftAction");

  assert.match(save, /getOwnedView\s*\(/);
  assert.match(save, /currentQuestion/);
  assert.match(save, /currentDraft/);
  assert.match(save, /currentQuestion\.position\s*===\s*position/);
  assert.match(save, /currentQuestion\.questionVersionId\s*===\s*questionVersionId/);
  assert.match(save, /status:\s*["']conflict["']/);
  assert.match(save, /serverDraft/);
  assert.match(save, /value/);
  assert.match(save, /revision/);
  assert.match(save, /updatedAt/);

  for (const forbidden of [
    "formId",
    "formItemId",
    "questionId",
    "questionType",
    "textValue",
    "booleanValue",
    "numericValue",
    "latestMutationKey",
    "latestMutationDigest"
  ]) {
    assert.equal(save.includes(forbidden), false, `${forbidden} must not leak through conflict reconciliation`);
  }
});
