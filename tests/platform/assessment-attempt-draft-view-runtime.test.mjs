import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import {
  ATTEMPT_NOW_DATE,
  seedInProgressAttempt,
  seedWorkerPrincipal
} from "../helpers/assessment-attempt-fixture.mjs";

const runtime = process.env.HSE_ASSESSMENT_ATTEMPT_RUNTIME_DIST;
assert.ok(runtime, "HSE_ASSESSMENT_ATTEMPT_RUNTIME_DIST is required");
const { AssessmentAttemptService } = await import(
  pathToFileURL(join(runtime, "assessment-attempt", "assessment-attempt-service.js")).href
);
const { toAssessmentAttemptClientView } = await import(
  pathToFileURL(join(runtime, "assessment-attempt", "assessment-attempt-client-view.js")).href
);
const { AssessmentAttemptAccessError } = await import(
  pathToFileURL(join(runtime, "assessment-attempt", "assessment-attempt-domain.js")).href
);

const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-08-draft-view-runtime",
  sessionSecret: "m2-08-draft-view-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-08-draft-view-auth-pepper-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, "0043_assessment_attempt_drafts");
  return db;
}

async function saveDraft(service, principal, fixture, value) {
  const item = fixture.items[0];
  return service.saveCurrentDraft(
    principal,
    {
      attemptId: fixture.attemptId,
      position: item.position,
      questionVersionId: item.questionVersionId,
      value,
      expectedRevision: null,
      mutationKey: "m208-draft-view-save-0001"
    },
    ATTEMPT_NOW_DATE
  );
}

function assertSafeClientDraft(clientView, expectedValue) {
  assert.deepEqual(clientView.currentDraft, {
    value: expectedValue,
    revision: 1,
    updatedAt: ATTEMPT_NOW_DATE.toISOString()
  });
  assert.deepEqual(Object.keys(clientView).sort(), ["currentDraft", "currentQuestion", "submitted"]);
  assert.deepEqual(Object.keys(clientView.currentDraft).sort(), ["revision", "updatedAt", "value"]);
  const serialized = JSON.stringify(clientView.currentDraft).toLowerCase();
  for (const forbidden of [
    "formid",
    "formitemid",
    "questionid",
    "questionversionid",
    "attemptid",
    "mutation",
    "digest",
    "answerkey",
    "rubric",
    "score",
    "correct"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `client draft leaked ${forbidden}`);
  }
}

test("M2.08 owned reload projects the exact server-acknowledged current draft through the browser-safe boundary", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-view-reload");
    const fixture = await seedInProgressAttempt(db, principal, "draft-view-reload", [
      { questionType: "SHORT_TEXT" }
    ]);
    const service = new AssessmentAttemptService(db);
    const exact = "  exact whitespace 😀  ";
    await saveDraft(service, principal, fixture, exact);

    const serverView = await service.getOwnedView(principal, fixture.attemptId, ATTEMPT_NOW_DATE);
    const clientView = toAssessmentAttemptClientView(serverView);
    assert.equal(clientView.submitted, false);
    assert.equal(clientView.currentQuestion?.position, 1);
    assertSafeClientDraft(clientView, exact);
  } finally {
    await db.close();
  }
});

test("M2.08 owned view exposes null draft when no server draft exists", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-view-empty");
    const fixture = await seedInProgressAttempt(db, principal, "draft-view-empty", [
      { questionType: "TRUE_FALSE" }
    ]);
    const service = new AssessmentAttemptService(db);
    const clientView = toAssessmentAttemptClientView(
      await service.getOwnedView(principal, fixture.attemptId, ATTEMPT_NOW_DATE)
    );
    assert.equal(clientView.currentDraft, null);
  } finally {
    await db.close();
  }
});

test("M2.08 submitted receipt never projects a stale draft", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-view-submitted");
    const fixture = await seedInProgressAttempt(db, principal, "draft-view-submitted", [
      { questionType: "SHORT_TEXT" }
    ]);
    const service = new AssessmentAttemptService(db);
    await saveDraft(service, principal, fixture, "draft before final commit");
    const submitted = await service.submitCurrentAnswer(
      principal,
      {
        attemptId: fixture.attemptId,
        position: 1,
        questionVersionId: fixture.items[0].questionVersionId,
        answer: "final committed answer"
      },
      ATTEMPT_NOW_DATE
    );
    const clientView = toAssessmentAttemptClientView(submitted);
    assert.equal(clientView.submitted, true);
    assert.equal(clientView.currentQuestion, null);
    assert.equal(clientView.currentDraft, null);
  } finally {
    await db.close();
  }
});

test("M2.08 another Worker cannot obtain the owned draft view", async () => {
  const db = await database();
  try {
    const owner = await seedWorkerPrincipal(db, "draft-view-owner");
    const other = await seedWorkerPrincipal(db, "draft-view-other");
    const fixture = await seedInProgressAttempt(db, owner, "draft-view-owner", [
      { questionType: "DECIMAL" }
    ]);
    const service = new AssessmentAttemptService(db);
    await saveDraft(service, owner, fixture, "1.");
    await assert.rejects(
      service.getOwnedView(other, fixture.attemptId, ATTEMPT_NOW_DATE),
      AssessmentAttemptAccessError
    );
  } finally {
    await db.close();
  }
});
