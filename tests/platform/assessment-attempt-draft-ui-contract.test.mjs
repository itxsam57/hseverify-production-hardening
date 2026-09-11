import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const workspacePath = "src/components/worker/assessment-workspace.tsx";
const autosavePath = "src/components/worker/use-assessment-draft-autosave.ts";

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

test("M2.08 workspace restores the server draft and routes all six edit forms through one autosave state machine", () => {
  const workspace = source(workspacePath, "assessment workspace");
  assert.ok(existsSync(autosavePath), `M2.08 autosave hook is missing: ${autosavePath}`);
  assert.match(workspace, /useAssessmentDraftAutosave/);
  assert.match(workspace, /view\.currentDraft/);
  assert.doesNotMatch(workspace, /const\s*\[answer,\s*setAnswer\]\s*=\s*useState\(\s*["']{2}\s*\)/);

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

  assert.match(workspace, /inputMode=["']numeric["']/);
  assert.match(workspace, /inputMode=["']decimal["']/);
  assert.doesNotMatch(workspace, /type=["']number["']/);
  assert.match(workspace, /Next/);
  assert.match(workspace, /Submit assessment/);
  assert.doesNotMatch(workspace, />\s*Previous\s*</i);
});

test("M2.08 autosave preserves draft-form strings, serializes requests, retries transport failures, and never persists answers in browser storage", () => {
  const autosave = source(autosavePath, "draft autosave hook");

  assert.match(autosave, /^[\s\S]*["']use client["']/);
  assert.match(autosave, /saveAssessmentDraftAction/);
  assert.match(autosave, /useRef/);
  assert.match(autosave, /useState/);
  assert.match(autosave, /setTimeout/);
  assert.match(autosave, /clearTimeout/);
  assert.match(autosave, /inFlightRef/);
  assert.match(autosave, /editVersionRef/);
  assert.match(autosave, /JSON\.stringify/);

  for (const field of [
    "attemptId",
    "position",
    "questionVersionId",
    "draftPayload",
    "expectedRevision",
    "clientGeneratedMutationKey"
  ]) {
    assert.match(autosave, new RegExp(`formData\\.set\\(\\s*["']${field}["']`));
  }

  assert.doesNotMatch(autosave, /Number\s*\(/);
  absent(
    autosave,
    ["localStorage", "sessionStorage", "indexedDB", "serviceWorker", "caches.", "crypto.", "CryptoKey"],
    "draft autosave"
  );

  assert.match(autosave, /Saving…/);
  assert.match(autosave, /Saved/);
  assert.match(autosave, /Not saved — reconnecting/);
  assert.match(autosave, /request\.editVersion/);
  assert.match(autosave, /editVersionRef\.current\s*===\s*request\.editVersion/);
  assert.match(autosave, /retry/i);
});

test("M2.08 stale revision conflict offers explicit saved/local choices and replacement performs a new CAS against the server revision", () => {
  const workspace = source(workspacePath, "assessment workspace");
  const autosave = source(autosavePath, "draft autosave hook");

  assert.match(workspace, /Use saved version/);
  assert.match(workspace, /Replace saved version with this tab/);
  assert.match(workspace, /useSavedVersion/);
  assert.match(workspace, /replaceSavedVersion/);
  assert.match(autosave, /serverDraft/);
  assert.match(autosave, /useSavedVersion/);
  assert.match(autosave, /replaceSavedVersion/);
  assert.match(autosave, /serverDraft\.revision/);
  assert.match(autosave, /expectedRevision/);
  assert.doesNotMatch(autosave, /force(?:Write|Save|Overwrite)/i);
});

test("M2.08 persistence status is accessible, truthful, and separate from the existing commit action", () => {
  const workspace = source(workspacePath, "assessment workspace");
  const autosave = source(autosavePath, "draft autosave hook");

  assert.match(workspace, /role=["']status["']/);
  assert.match(workspace, /aria-live=["']polite["']/);
  assert.match(workspace, /saveStatus/);
  assert.match(workspace, /submitAssessmentAnswerAction/);
  assert.match(workspace, /encodeAnswer/);
  assert.match(workspace, /Next/);
  assert.match(workspace, /Submit assessment/);

  assert.match(autosave, /status:\s*["']saved["']|setSaveStatus\(\s*["']Saved["']/);
  assert.match(autosave, /editVersionRef\.current\s*===\s*request\.editVersion/);
  assert.doesNotMatch(autosave, /\.focus\s*\(/);
});

test("M2.08 Save and exit flushes the exact current edit and navigates only after that edit is server-acknowledged", () => {
  const workspace = source(workspacePath, "assessment workspace");
  const autosave = source(autosavePath, "draft autosave hook");

  assert.match(workspace, /Save and exit/);
  assert.match(workspace, /flushExactCurrentEdit/);
  assert.match(workspace, /await\s+flushExactCurrentEdit\s*\(/);
  assert.match(workspace, /if\s*\(\s*saved\s*\)[\s\S]*router\.(?:push|replace)\s*\(\s*["']\/worker\/available-assessments["']/);
  assert.match(autosave, /flushExactCurrentEdit/);
  assert.match(autosave, /currentValueRef\.current/);
  assert.match(autosave, /editVersionRef\.current/);
  assert.match(autosave, /request\.editVersion/);
  assert.match(autosave, /return\s+true/);
  assert.match(autosave, /return\s+false/);
  assert.doesNotMatch(autosave, /submitAssessmentAnswerAction/);
});

test("M2.08 Emergency exit is bounded, never commits or advances, and warns that only server-confirmed state is guaranteed", () => {
  const workspace = source(workspacePath, "assessment workspace");
  const autosave = source(autosavePath, "draft autosave hook");

  assert.match(workspace, /Emergency exit/);
  assert.match(workspace, /bestEffortCurrentEdit/);
  assert.match(workspace, /last server-confirmed Saved version/i);
  assert.match(workspace, /router\.(?:push|replace)\s*\(\s*["']\/worker\/available-assessments["']/);
  assert.match(autosave, /bestEffortCurrentEdit/);
  assert.match(autosave, /Promise\.race/);
  assert.match(autosave, /EMERGENCY_EXIT_TIMEOUT_MS/);
  assert.match(autosave, /setTimeout/);
  assert.doesNotMatch(autosave, /submitAssessmentAnswerAction/);
});
