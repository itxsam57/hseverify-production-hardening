import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import {
  ATTEMPT_NOW_DATE,
  countRows,
  seedInProgressAttempt,
  seedWorkerPrincipal
} from "../helpers/assessment-attempt-fixture.mjs";

const runtime = process.env.HSE_ASSESSMENT_ATTEMPT_RUNTIME_DIST;
assert.ok(runtime, "HSE_ASSESSMENT_ATTEMPT_RUNTIME_DIST is required");
const serviceModule = await import(
  pathToFileURL(join(runtime, "assessment-attempt", "assessment-attempt-service.js")).href
);
const domainModule = await import(
  pathToFileURL(join(runtime, "assessment-attempt", "assessment-attempt-domain.js")).href
);
const { AssessmentAttemptService } = serviceModule;
const { AssessmentAttemptAnswerInputError, AssessmentAttemptConflictError } = domainModule;

const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-08-draft-commit-runtime",
  sessionSecret: "m2-08-draft-commit-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-08-draft-commit-auth-pepper-more-than-thirty-two-characters",
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

async function saveDraft(service, principal, fixture, item, value, mutationKey) {
  return service.saveCurrentDraft(
    principal,
    {
      attemptId: fixture.attemptId,
      position: item.position,
      questionVersionId: item.questionVersionId,
      value,
      expectedRevision: null,
      mutationKey
    },
    ATTEMPT_NOW_DATE
  );
}

async function attemptState(db, attemptId) {
  const result = await db.query(
    `SELECT status,current_position,submitted_at
     FROM assessment_attempts WHERE attempt_id=$1`,
    [attemptId]
  );
  return result.rows[0];
}

async function draftRow(db, attemptId) {
  const result = await db.query(
    `SELECT position,question_version_id,question_type,text_value,boolean_value,revision
     FROM assessment_attempt_drafts WHERE attempt_id=$1`,
    [attemptId]
  );
  return result.rows[0] ?? null;
}

function submit(service, principal, fixture, item, answer) {
  return service.submitCurrentAnswer(
    principal,
    {
      attemptId: fixture.attemptId,
      position: item.position,
      questionVersionId: item.questionVersionId,
      answer
    },
    ATTEMPT_NOW_DATE
  );
}

test("M2.08 invalid committed answer leaves the current draft and position unchanged", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-invalid-answer");
    const fixture = await seedInProgressAttempt(db, principal, "draft-invalid-answer", [
      { questionType: "SHORT_TEXT" }
    ]);
    const [item] = fixture.items;
    const service = new AssessmentAttemptService(db);

    await saveDraft(
      service,
      principal,
      fixture,
      item,
      "  still recoverable  ",
      "m208-draft-invalid-answer-0001"
    );

    await assert.rejects(
      submit(service, principal, fixture, item, "   "),
      AssessmentAttemptAnswerInputError
    );

    assert.equal(await countRows(db, "assessment_attempt_answers", "attempt_id=$1", [fixture.attemptId]), 0);
    assert.equal(await countRows(db, "assessment_attempt_drafts", "attempt_id=$1", [fixture.attemptId]), 1);
    assert.equal((await draftRow(db, fixture.attemptId)).text_value, "  still recoverable  ");
    assert.equal(Number((await attemptState(db, fixture.attemptId)).current_position), 1);
  } finally {
    await db.close();
  }
});

test("M2.08 successful Next atomically removes the matching current-question draft before progression", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-cleanup-next");
    const fixture = await seedInProgressAttempt(db, principal, "draft-cleanup-next", [
      { questionType: "SHORT_TEXT" },
      { questionType: "TRUE_FALSE" }
    ]);
    const [first, second] = fixture.items;
    const service = new AssessmentAttemptService(db);

    await saveDraft(
      service,
      principal,
      fixture,
      first,
      "  uncommitted draft text  ",
      "m208-draft-cleanup-next-0001"
    );
    assert.equal(await countRows(db, "assessment_attempt_drafts", "attempt_id=$1", [fixture.attemptId]), 1);

    const after = await submit(service, principal, fixture, first, "Committed answer");

    assert.equal(
      await countRows(db, "assessment_attempt_answers", "attempt_id=$1 AND position=1", [fixture.attemptId]),
      1
    );
    assert.equal(await countRows(db, "assessment_attempt_drafts", "attempt_id=$1", [fixture.attemptId]), 0);
    assert.equal(after.currentQuestion.position, 2);
    assert.equal(after.currentQuestion.questionVersionId, second.questionVersionId);
    assert.equal(after.currentDraft, null);
  } finally {
    await db.close();
  }
});

test("M2.08 final submit deletes the final draft and the explicit submitted answer remains authoritative", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-final-submit");
    const fixture = await seedInProgressAttempt(db, principal, "draft-final-submit", [
      { questionType: "TRUE_FALSE" }
    ]);
    const [item] = fixture.items;
    const service = new AssessmentAttemptService(db);

    await saveDraft(
      service,
      principal,
      fixture,
      item,
      false,
      "m208-draft-final-submit-0001"
    );

    const after = await submit(service, principal, fixture, item, true);

    assert.equal(after.submitted, true);
    assert.equal(after.currentQuestion, null);
    assert.equal(after.currentDraft, null);
    assert.equal(await countRows(db, "assessment_attempt_drafts", "attempt_id=$1", [fixture.attemptId]), 0);
    const answer = await db.query(
      `SELECT boolean_value FROM assessment_attempt_answers
       WHERE attempt_id=$1 AND position=1`,
      [fixture.attemptId]
    );
    assert.equal(answer.rows[0].boolean_value, true);
    assert.equal((await attemptState(db, fixture.attemptId)).status, "SUBMITTED");
  } finally {
    await db.close();
  }
});

test("M2.08 committed-answer insert failure preserves the draft and leaves progression unchanged", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-answer-failure");
    const fixture = await seedInProgressAttempt(db, principal, "draft-answer-failure", [
      { questionType: "SHORT_TEXT" },
      { questionType: "TRUE_FALSE" }
    ]);
    const [item] = fixture.items;
    const service = new AssessmentAttemptService(db);

    await saveDraft(
      service,
      principal,
      fixture,
      item,
      "recover after failed answer insert",
      "m208-draft-answer-failure-0001"
    );
    await db.execute(`
      CREATE OR REPLACE FUNCTION hse_m208_force_answer_insert_failure()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced M2.08 answer insert failure';
      END; $$;
      CREATE TRIGGER m208_force_answer_insert_failure
      BEFORE INSERT ON assessment_attempt_answers
      FOR EACH ROW EXECUTE FUNCTION hse_m208_force_answer_insert_failure();
    `);

    await assert.rejects(
      submit(service, principal, fixture, item, "valid committed answer"),
      /forced M2\.08 answer insert failure/
    );

    assert.equal(await countRows(db, "assessment_attempt_answers", "attempt_id=$1", [fixture.attemptId]), 0);
    assert.equal(await countRows(db, "assessment_attempt_drafts", "attempt_id=$1", [fixture.attemptId]), 1);
    assert.equal(Number((await attemptState(db, fixture.attemptId)).current_position), 1);
  } finally {
    await db.close();
  }
});

test("M2.08 forced matching-draft delete failure rolls the answer insert and progression back", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-delete-failure");
    const fixture = await seedInProgressAttempt(db, principal, "draft-delete-failure", [
      { questionType: "SHORT_TEXT" },
      { questionType: "TRUE_FALSE" }
    ]);
    const [item] = fixture.items;
    const service = new AssessmentAttemptService(db);

    await saveDraft(
      service,
      principal,
      fixture,
      item,
      "recover after failed draft delete",
      "m208-draft-delete-failure-0001"
    );
    await db.execute(`
      CREATE OR REPLACE FUNCTION hse_m208_force_draft_delete_failure()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced M2.08 draft delete failure';
      END; $$;
      CREATE TRIGGER m208_force_draft_delete_failure
      BEFORE DELETE ON assessment_attempt_drafts
      FOR EACH ROW EXECUTE FUNCTION hse_m208_force_draft_delete_failure();
    `);

    await assert.rejects(
      submit(service, principal, fixture, item, "valid committed answer"),
      /forced M2\.08 draft delete failure/
    );

    assert.equal(await countRows(db, "assessment_attempt_answers", "attempt_id=$1", [fixture.attemptId]), 0);
    assert.equal(await countRows(db, "assessment_attempt_drafts", "attempt_id=$1", [fixture.attemptId]), 1);
    assert.equal(Number((await attemptState(db, fixture.attemptId)).current_position), 1);
  } finally {
    await db.close();
  }
});

test("M2.08 progression failure rolls back both the committed answer and matching draft deletion", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-progression-failure");
    const fixture = await seedInProgressAttempt(db, principal, "draft-progression-failure", [
      { questionType: "SHORT_TEXT" },
      { questionType: "TRUE_FALSE" }
    ]);
    const [item] = fixture.items;
    const service = new AssessmentAttemptService(db);

    await saveDraft(
      service,
      principal,
      fixture,
      item,
      "recover after failed progression",
      "m208-draft-progression-failure-0001"
    );
    await db.execute(`
      CREATE OR REPLACE FUNCTION hse_m208_force_progression_failure()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.current_position <> OLD.current_position THEN
          RAISE EXCEPTION 'forced M2.08 progression failure';
        END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER m208_force_progression_failure
      BEFORE UPDATE ON assessment_attempts
      FOR EACH ROW EXECUTE FUNCTION hse_m208_force_progression_failure();
    `);

    await assert.rejects(
      submit(service, principal, fixture, item, "valid committed answer"),
      /forced M2\.08 progression failure/
    );

    assert.equal(await countRows(db, "assessment_attempt_answers", "attempt_id=$1", [fixture.attemptId]), 0);
    assert.equal(await countRows(db, "assessment_attempt_drafts", "attempt_id=$1", [fixture.attemptId]), 1);
    assert.equal(Number((await attemptState(db, fixture.attemptId)).current_position), 1);
  } finally {
    await db.close();
  }
});

test("M2.08 stale autosave for the committed prior position cannot recreate its draft", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-stale-after-commit");
    const fixture = await seedInProgressAttempt(db, principal, "draft-stale-after-commit", [
      { questionType: "SHORT_TEXT" },
      { questionType: "TRUE_FALSE" }
    ]);
    const [first] = fixture.items;
    const service = new AssessmentAttemptService(db);

    await saveDraft(
      service,
      principal,
      fixture,
      first,
      "old position draft",
      "m208-draft-stale-after-commit-0001"
    );
    await submit(service, principal, fixture, first, "committed first answer");

    await assert.rejects(
      service.saveCurrentDraft(
        principal,
        {
          attemptId: fixture.attemptId,
          position: first.position,
          questionVersionId: first.questionVersionId,
          value: "late stale autosave",
          expectedRevision: null,
          mutationKey: "m208-draft-stale-after-commit-0002"
        },
        ATTEMPT_NOW_DATE
      ),
      AssessmentAttemptConflictError
    );

    assert.equal(await countRows(db, "assessment_attempt_drafts", "attempt_id=$1", [fixture.attemptId]), 0);
    assert.equal(Number((await attemptState(db, fixture.attemptId)).current_position), 2);
  } finally {
    await db.close();
  }
});

test("M2.08 exact committed-answer replay cannot delete the next current question draft", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-replay-isolation");
    const fixture = await seedInProgressAttempt(db, principal, "draft-replay-isolation", [
      { questionType: "SHORT_TEXT" },
      { questionType: "TRUE_FALSE" }
    ]);
    const [first, second] = fixture.items;
    const service = new AssessmentAttemptService(db);

    await saveDraft(
      service,
      principal,
      fixture,
      first,
      "first position draft",
      "m208-draft-replay-isolation-0001"
    );
    await submit(service, principal, fixture, first, "committed first answer");
    await saveDraft(
      service,
      principal,
      fixture,
      second,
      false,
      "m208-draft-replay-isolation-0002"
    );

    const replay = await submit(service, principal, fixture, first, "committed first answer");

    assert.equal(await countRows(db, "assessment_attempt_answers", "attempt_id=$1", [fixture.attemptId]), 1);
    assert.equal(await countRows(db, "assessment_attempt_drafts", "attempt_id=$1", [fixture.attemptId]), 1);
    const remaining = await draftRow(db, fixture.attemptId);
    assert.equal(Number(remaining.position), 2);
    assert.equal(remaining.question_version_id, second.questionVersionId);
    assert.equal(remaining.boolean_value, false);
    assert.equal(replay.currentQuestion.position, 2);
    assert.deepEqual(replay.currentDraft, {
      value: false,
      revision: 1,
      updatedAt: ATTEMPT_NOW_DATE.toISOString()
    });
  } finally {
    await db.close();
  }
});
