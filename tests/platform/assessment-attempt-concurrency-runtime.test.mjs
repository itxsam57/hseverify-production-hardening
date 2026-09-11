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
const { AssessmentAttemptService, AssessmentAttemptConflictError } = serviceModule;

const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-07-attempt-concurrency-runtime",
  sessionSecret: "m2-07-attempt-concurrency-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-07-attempt-concurrency-auth-pepper-more-than-thirty-two-characters",
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

async function attemptState(db, attemptId) {
  const result = await db.query(
    `SELECT status,current_position,submitted_at
     FROM assessment_attempts WHERE attempt_id=$1`,
    [attemptId]
  );
  return result.rows[0];
}

function request(fixture, item, answer) {
  return {
    attemptId: fixture.attemptId,
    position: item.position,
    questionVersionId: item.questionVersionId,
    answer
  };
}

test("M2.07 identical stale replay returns the current authoritative view without a second progression", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "stale-replay");
    const fixture = await seedInProgressAttempt(db, principal, "stale-replay", [
      { questionType: "MULTIPLE_CHOICE", options: ["Alpha", "Bravo"] },
      { questionType: "TRUE_FALSE" }
    ]);
    const [first, second] = fixture.items;
    const service = new AssessmentAttemptService(db);
    const input = request(fixture, first, "Alpha");

    const firstResult = await service.submitCurrentAnswer(principal, input, ATTEMPT_NOW_DATE);
    assert.equal(firstResult.currentQuestion.questionVersionId, second.questionVersionId);

    const replay = await service.submitCurrentAnswer(principal, input, ATTEMPT_NOW_DATE);
    assert.equal(replay.submitted, false);
    assert.equal(replay.currentQuestion.position, 2);
    assert.equal(replay.currentQuestion.questionVersionId, second.questionVersionId);
    assert.equal(
      await countRows(db, "assessment_attempt_answers", "attempt_id=$1", [fixture.attemptId]),
      1
    );
    const state = await attemptState(db, fixture.attemptId);
    assert.equal(Number(state.current_position), 2);
    assert.equal(state.status, "IN_PROGRESS");
  } finally {
    await db.close();
  }
});

test("M2.07 parallel identical submissions converge to one committed answer and one progression", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "parallel-next");
    const fixture = await seedInProgressAttempt(db, principal, "parallel-next", [
      { questionType: "MULTIPLE_CHOICE", options: ["Alpha", "Bravo"] },
      { questionType: "TRUE_FALSE" }
    ]);
    const [first] = fixture.items;
    const service = new AssessmentAttemptService(db);
    const input = request(fixture, first, "Bravo");

    const results = await Promise.all([
      service.submitCurrentAnswer(principal, input, ATTEMPT_NOW_DATE),
      service.submitCurrentAnswer(principal, input, ATTEMPT_NOW_DATE)
    ]);
    assert.deepEqual(results.map((result) => result.currentQuestion.position), [2, 2]);
    assert.equal(
      await countRows(db, "assessment_attempt_answers", "attempt_id=$1", [fixture.attemptId]),
      1
    );
    assert.equal(Number((await attemptState(db, fixture.attemptId)).current_position), 2);
  } finally {
    await db.close();
  }
});

test("M2.07 different replay for an already committed position is a conflict", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "conflicting-replay");
    const fixture = await seedInProgressAttempt(db, principal, "conflicting-replay", [
      { questionType: "MULTIPLE_CHOICE", options: ["Alpha", "Bravo"] },
      { questionType: "TRUE_FALSE" }
    ]);
    const [first] = fixture.items;
    const service = new AssessmentAttemptService(db);

    await service.submitCurrentAnswer(
      principal,
      request(fixture, first, "Alpha"),
      ATTEMPT_NOW_DATE
    );
    await assert.rejects(
      service.submitCurrentAnswer(
        principal,
        request(fixture, first, "Bravo"),
        ATTEMPT_NOW_DATE
      ),
      AssessmentAttemptConflictError
    );
    assert.equal(
      await countRows(db, "assessment_attempt_answers", "attempt_id=$1", [fixture.attemptId]),
      1
    );
    assert.equal(Number((await attemptState(db, fixture.attemptId)).current_position), 2);
  } finally {
    await db.close();
  }
});

test("M2.07 parallel identical final submissions create one submitted transition, audit and timeline event", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "parallel-final");
    const fixture = await seedInProgressAttempt(db, principal, "parallel-final", [
      { questionType: "TRUE_FALSE" }
    ]);
    const [item] = fixture.items;
    const service = new AssessmentAttemptService(db);
    const input = request(fixture, item, true);

    const results = await Promise.all([
      service.submitCurrentAnswer(principal, input, ATTEMPT_NOW_DATE),
      service.submitCurrentAnswer(principal, input, ATTEMPT_NOW_DATE)
    ]);
    assert.deepEqual(results.map((result) => result.submitted), [true, true]);
    assert.equal(
      await countRows(db, "assessment_attempt_answers", "attempt_id=$1", [fixture.attemptId]),
      1
    );
    assert.equal(
      await countRows(
        db,
        "platform_audit_events",
        "action_key='assessment.attempt.submitted' AND target_reference=$1",
        [fixture.attemptId]
      ),
      1
    );
    assert.equal(
      await countRows(
        db,
        "assurance_case_timeline_events",
        "case_id=$1 AND event_type='assessment_attempt_submitted'",
        [fixture.caseId]
      ),
      1
    );
    const state = await attemptState(db, fixture.attemptId);
    assert.equal(state.status, "SUBMITTED");
    assert.ok(state.submitted_at);
  } finally {
    await db.close();
  }
});

test("M2.07 answer persistence failure rolls back progression and leaves no partial committed answer", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "persistence-failure");
    const fixture = await seedInProgressAttempt(db, principal, "persistence-failure", [
      { questionType: "MULTIPLE_CHOICE", options: ["Alpha", "Bravo"] },
      { questionType: "TRUE_FALSE" }
    ]);
    const [first] = fixture.items;
    const service = new AssessmentAttemptService(db);

    await db.execute(`
      CREATE OR REPLACE FUNCTION hse_m207_force_answer_failure()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced M2.07 answer persistence failure';
      END; $$;
      CREATE TRIGGER m207_force_answer_failure
      BEFORE INSERT ON assessment_attempt_answers
      FOR EACH ROW EXECUTE FUNCTION hse_m207_force_answer_failure();
    `);

    await assert.rejects(
      service.submitCurrentAnswer(
        principal,
        request(fixture, first, "Alpha"),
        ATTEMPT_NOW_DATE
      ),
      /forced M2\.07 answer persistence failure/
    );

    assert.equal(
      await countRows(db, "assessment_attempt_answers", "attempt_id=$1", [fixture.attemptId]),
      0
    );
    const state = await attemptState(db, fixture.attemptId);
    assert.equal(state.status, "IN_PROGRESS");
    assert.equal(Number(state.current_position), 1);
    assert.equal(state.submitted_at, null);
  } finally {
    await db.close();
  }
});
