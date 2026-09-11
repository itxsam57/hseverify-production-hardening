import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import {
  ATTEMPT_NOW,
  ATTEMPT_NOW_DATE,
  seedInProgressAttempt,
  seedWorkerPrincipal
} from "../helpers/assessment-attempt-fixture.mjs";

const runtime = process.env.HSE_ASSESSMENT_ATTEMPT_RUNTIME_DIST;
assert.ok(runtime, "HSE_ASSESSMENT_ATTEMPT_RUNTIME_DIST is required");
const serviceModule = await import(
  pathToFileURL(join(runtime, "assessment-attempt", "assessment-attempt-service.js")).href
);
const { AssessmentAttemptService, AssessmentAttemptAccessError } = serviceModule;

const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-08-resume-runtime",
  sessionSecret: "m2-08-resume-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-08-resume-auth-pepper-more-than-thirty-two-characters",
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
  return service.saveCurrentDraft(
    principal,
    {
      attemptId: fixture.attemptId,
      position: fixture.items[0].position,
      questionVersionId: fixture.items[0].questionVersionId,
      value,
      expectedRevision: null,
      mutationKey: `m208-resume-${fixture.attemptId.slice(-20)}`
    },
    ATTEMPT_NOW_DATE
  );
}

test("M2.08 resume listing returns only the owning Worker's consistent IN_PROGRESS attempts without draft content", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "resume-owner");
    const foreignPrincipal = await seedWorkerPrincipal(db, "resume-foreign-worker");
    const active = await seedInProgressAttempt(db, principal, "resume-active", [
      { questionType: "SHORT_TEXT" },
      { questionType: "TRUE_FALSE" }
    ]);
    const submitted = await seedInProgressAttempt(db, principal, "resume-submitted", [
      { questionType: "TRUE_FALSE" }
    ]);
    const inconsistent = await seedInProgressAttempt(db, principal, "resume-inconsistent", [
      { questionType: "SHORT_TEXT" }
    ]);
    const foreign = await seedInProgressAttempt(db, foreignPrincipal, "resume-foreign", [
      { questionType: "SHORT_TEXT" }
    ]);
    const service = new AssessmentAttemptService(db);
    const secretDraft = "draft body must never appear on the resume listing";

    await saveDraft(service, principal, active, secretDraft);
    await db.query(
      `UPDATE assessment_attempts
       SET status='SUBMITTED',submitted_at=$2,updated_at=$2
       WHERE attempt_id=$1`,
      [submitted.attemptId, ATTEMPT_NOW]
    );
    await db.query(
      `UPDATE assurance_cases
       SET case_status='Assessment pending',updated_at=$2
       WHERE case_id=$1`,
      [inconsistent.caseId, ATTEMPT_NOW]
    );

    const listed = await service.listOwnedInProgress(principal, ATTEMPT_NOW_DATE);

    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0], {
      attemptId: active.attemptId,
      caseId: active.caseId,
      catalogueVersionId: active.catalogueVersionId,
      catalogueTitle: "M2.07 Catalogue resume-active",
      currentPosition: 1,
      questionCount: 2,
      startedAt: ATTEMPT_NOW,
      updatedAt: ATTEMPT_NOW
    });
    const serialized = JSON.stringify(listed);
    assert.equal(serialized.includes(secretDraft), false);
    assert.equal(serialized.includes(submitted.attemptId), false);
    assert.equal(serialized.includes(inconsistent.attemptId), false);
    assert.equal(serialized.includes(foreign.attemptId), false);
    for (const forbidden of [
      "currentDraft",
      "draft",
      "answer",
      "textValue",
      "booleanValue",
      "numericValue",
      "questionVersionId",
      "formId",
      "workerAccountId"
    ]) {
      assert.equal(Object.prototype.hasOwnProperty.call(listed[0], forbidden), false, `${forbidden} leaked`);
    }
  } finally {
    await db.close();
  }
});

test("M2.08 resume listing rejects non-Worker and revoked principals", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "resume-access");
    await seedInProgressAttempt(db, principal, "resume-access-attempt", [
      { questionType: "TRUE_FALSE" }
    ]);
    const service = new AssessmentAttemptService(db);
    const nonWorker = Object.freeze({ ...principal, activeRole: "verifier" });

    await assert.rejects(
      service.listOwnedInProgress(nonWorker, ATTEMPT_NOW_DATE),
      AssessmentAttemptAccessError
    );

    await db.query(
      `UPDATE auth_sessions
       SET revoked_at=$2,revocation_reason='m2.08 resume access test'
       WHERE session_id=$1`,
      [principal.sessionId, ATTEMPT_NOW]
    );
    await assert.rejects(
      service.listOwnedInProgress(principal, ATTEMPT_NOW_DATE),
      AssessmentAttemptAccessError
    );
  } finally {
    await db.close();
  }
});
