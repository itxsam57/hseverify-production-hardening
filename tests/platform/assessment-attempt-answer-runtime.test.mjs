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
  seedWorkerPrincipal,
  stableId
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
const { AssessmentAttemptAnswerInputError } = domainModule;

const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-07-attempt-answer-runtime",
  sessionSecret: "m2-07-attempt-answer-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-07-attempt-answer-auth-pepper-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, "0073_assessment_option_order_snapshot");
  return db;
}

async function storedAttempt(db, attemptId) {
  const result = await db.query(
    `SELECT status,current_position,question_count,submitted_at
     FROM assessment_attempts WHERE attempt_id=$1`,
    [attemptId]
  );
  return result.rows[0];
}

async function storedAnswer(db, attemptId, position) {
  const result = await db.query(
    `SELECT question_type,text_value,boolean_value,numeric_value
     FROM assessment_attempt_answers
     WHERE attempt_id=$1 AND position=$2`,
    [attemptId, position]
  );
  return result.rows[0] ?? null;
}

async function expectInvalidWithoutMovement({ type, answer, options = undefined, seed }) {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, `invalid-${seed}`);
    const fixture = await seedInProgressAttempt(db, principal, `invalid-${seed}`, [
      { questionType: type, ...(options === undefined ? {} : { options }) }
    ]);
    const item = fixture.items[0];
    const service = new AssessmentAttemptService(db);

    await assert.rejects(
      service.submitCurrentAnswer(
        principal,
        {
          attemptId: fixture.attemptId,
          position: 1,
          questionVersionId: item.questionVersionId,
          answer
        },
        ATTEMPT_NOW_DATE
      ),
      AssessmentAttemptAnswerInputError
    );

    const attempt = await storedAttempt(db, fixture.attemptId);
    assert.equal(attempt.status, "IN_PROGRESS");
    assert.equal(Number(attempt.current_position), 1);
    assert.equal(attempt.submitted_at, null);
    assert.equal(await countRows(db, "assessment_attempt_answers", "attempt_id=$1", [fixture.attemptId]), 0);
  } finally {
    await db.close();
  }
}

async function expectValidFinal({ type, answer, seed, options = undefined, expected }) {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, `valid-${seed}`);
    const fixture = await seedInProgressAttempt(db, principal, `valid-${seed}`, [
      { questionType: type, ...(options === undefined ? {} : { options }) }
    ]);
    const item = fixture.items[0];
    const service = new AssessmentAttemptService(db);

    const view = await service.submitCurrentAnswer(
      principal,
      {
        attemptId: fixture.attemptId,
        position: 1,
        questionVersionId: item.questionVersionId,
        answer
      },
      ATTEMPT_NOW_DATE
    );

    assert.equal(view.submitted, true);
    assert.equal(view.currentQuestion, null);
    assert.equal(view.attempt.status, "SUBMITTED");
    assert.equal(view.attempt.currentPosition, 1);
    assert.ok(view.attempt.submittedAt);

    const row = await storedAnswer(db, fixture.attemptId, 1);
    assert.ok(row);
    assert.equal(row.question_type, type);
    assert.deepEqual(
      {
        text: row.text_value,
        boolean: row.boolean_value,
        numeric: row.numeric_value === null ? null : Number(row.numeric_value)
      },
      expected
    );

    const audits = await db.query(
      `SELECT action_key,metadata
       FROM platform_audit_events
       WHERE action_key='assessment.attempt.submitted'
         AND target_reference=$1`,
      [fixture.attemptId]
    );
    assert.equal(audits.rows.length, 1);
    const metadata = audits.rows[0].metadata;
    const serialized = JSON.stringify(metadata).toLowerCase();
    for (const forbidden of ["answer", "correct", "score", "rubric", "textvalue", "numericvalue", "booleanvalue"]) {
      assert.equal(serialized.includes(forbidden), false, `audit metadata leaked ${forbidden}`);
    }
  } finally {
    await db.close();
  }
}

test("M2.07 commits MULTIPLE_CHOICE only when the trimmed answer is a pinned option", async () => {
  await expectValidFinal({
    type: "MULTIPLE_CHOICE",
    answer: "  Bravo  ",
    options: ["Alpha", "Bravo", "Charlie"],
    seed: "mc",
    expected: { text: "Bravo", boolean: null, numeric: null }
  });
  await expectInvalidWithoutMovement({
    type: "MULTIPLE_CHOICE",
    answer: "Delta",
    options: ["Alpha", "Bravo", "Charlie"],
    seed: "mc"
  });
});

test("M2.07 commits TRUE_FALSE as a boolean and rejects string lookalikes", async () => {
  await expectValidFinal({
    type: "TRUE_FALSE",
    answer: false,
    seed: "tf",
    expected: { text: null, boolean: false, numeric: null }
  });
  await expectInvalidWithoutMovement({ type: "TRUE_FALSE", answer: "false", seed: "tf" });
});

test("M2.07 commits trimmed SHORT_TEXT and enforces the 2,000 Unicode code-point limit", async () => {
  await expectValidFinal({
    type: "SHORT_TEXT",
    answer: "  Safe response 😀  ",
    seed: "short",
    expected: { text: "Safe response 😀", boolean: null, numeric: null }
  });
  await expectInvalidWithoutMovement({
    type: "SHORT_TEXT",
    answer: "😀".repeat(2_001),
    seed: "short"
  });
});

test("M2.07 commits trimmed LONG_TEXT and enforces the 20,000 Unicode code-point limit", async () => {
  await expectValidFinal({
    type: "LONG_TEXT",
    answer: "  A detailed safe working explanation.  ",
    seed: "long",
    expected: { text: "A detailed safe working explanation.", boolean: null, numeric: null }
  });
  await expectInvalidWithoutMovement({
    type: "LONG_TEXT",
    answer: "😀".repeat(20_001),
    seed: "long"
  });
});

test("M2.07 commits INTEGER only inside the JavaScript safe-integer range", async () => {
  await expectValidFinal({
    type: "INTEGER",
    answer: Number.MAX_SAFE_INTEGER,
    seed: "integer",
    expected: { text: null, boolean: null, numeric: Number.MAX_SAFE_INTEGER }
  });
  await expectInvalidWithoutMovement({
    type: "INTEGER",
    answer: Number.MAX_SAFE_INTEGER + 1,
    seed: "integer"
  });
});

test("M2.07 commits finite DECIMAL values and rejects non-finite values", async () => {
  await expectValidFinal({
    type: "DECIMAL",
    answer: 12.75,
    seed: "decimal",
    expected: { text: null, boolean: null, numeric: 12.75 }
  });
  await expectInvalidWithoutMovement({ type: "DECIMAL", answer: Infinity, seed: "decimal" });
});

test("M2.07 commits the current answer before revealing exactly one next pinned question", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "progression");
    const fixture = await seedInProgressAttempt(db, principal, "progression", [
      { questionType: "MULTIPLE_CHOICE", options: ["Stop", "Continue"] },
      { questionType: "TRUE_FALSE" }
    ]);
    const [first, second] = fixture.items;
    const service = new AssessmentAttemptService(db);

    const before = await service.getOwnedView(principal, fixture.attemptId, ATTEMPT_NOW_DATE);
    assert.equal(before.currentQuestion.position, 1);
    assert.equal(before.currentQuestion.questionVersionId, first.questionVersionId);

    const after = await service.submitCurrentAnswer(
      principal,
      {
        attemptId: fixture.attemptId,
        position: 1,
        questionVersionId: first.questionVersionId,
        answer: "Stop"
      },
      ATTEMPT_NOW_DATE
    );

    assert.equal(await countRows(db, "assessment_attempt_answers", "attempt_id=$1 AND position=1", [fixture.attemptId]), 1);
    const persisted = await storedAttempt(db, fixture.attemptId);
    assert.equal(Number(persisted.current_position), 2);
    assert.equal(persisted.status, "IN_PROGRESS");
    assert.equal(after.submitted, false);
    assert.equal(after.currentQuestion.position, 2);
    assert.equal(after.currentQuestion.questionVersionId, second.questionVersionId);
    assert.equal(JSON.stringify(after).includes(first.questionVersionId), false);
    for (const forbidden of ["answerKey", "rubric", "score", "correct", "questions", "items"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(after.currentQuestion, forbidden), false);
    }
  } finally {
    await db.close();
  }
});

test("M2.07 committed answers are append-only at the database boundary", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "answer-immutability");
    const fixture = await seedInProgressAttempt(db, principal, "answer-immutability", [
      { questionType: "SHORT_TEXT" }
    ]);
    const item = fixture.items[0];
    const service = new AssessmentAttemptService(db);

    await service.submitCurrentAnswer(
      principal,
      {
        attemptId: fixture.attemptId,
        position: 1,
        questionVersionId: item.questionVersionId,
        answer: "Original committed response"
      },
      ATTEMPT_NOW_DATE
    );

    const appendOnlyError = (error) => /append-only/i.test(String(error?.message ?? error));
    await assert.rejects(
      db.query(
        `UPDATE assessment_attempt_answers
         SET text_value='Mutated response'
         WHERE attempt_id=$1 AND position=1`,
        [fixture.attemptId]
      ),
      appendOnlyError
    );
    await assert.rejects(
      db.query(
        `DELETE FROM assessment_attempt_answers
         WHERE attempt_id=$1 AND position=1`,
        [fixture.attemptId]
      ),
      appendOnlyError
    );

    const row = await storedAnswer(db, fixture.attemptId, 1);
    assert.ok(row);
    assert.equal(row.text_value, "Original committed response");
  } finally {
    await db.close();
  }
});

// Expiry finalization must score the immutable form, including unanswered items.
const { completeSubmittedAssessment } = await import(
  pathToFileURL(join(runtime, "assessment-attempt", "assessment-submission-progression-service.js")).href
);

for (const scenario of [
  { seed: "partial-score", answered: true, written: false, score: 50 },
  { seed: "empty-score", answered: false, written: false, score: 0 },
  { seed: "unanswered-written", answered: true, written: true, score: null }
]) {
  test(`Timeout progression preserves unanswered pinned items: ${scenario.seed}`, async () => {
    const db = await database();
    try {
      const principal = await seedWorkerPrincipal(db, scenario.seed);
      const fixture = await seedInProgressAttempt(db, principal, scenario.seed, [
        { questionType: "TRUE_FALSE" },
        { questionType: scenario.written ? "SHORT_TEXT" : "TRUE_FALSE" }
      ]);
      await db.query(
        `INSERT INTO assurance_case_policy_snapshots(
          snapshot_id,case_id,tenant_id,framework_id,policy_id,global_policy_version_id,
          tenant_override_id,policy_source,effective_value_json,reference_time,resolved_at,
          created_by_account_id
        ) SELECT $1,$2,$3,framework_id,$4,$5,NULL,'GLOBAL',
          '{"pass_mark":80}'::jsonb,$6,$6,NULL
          FROM assessment_blueprint_versions WHERE blueprint_version_id=$7`,
        [stableId("policy_snapshot", scenario.seed), fixture.caseId, fixture.tenantId,
          stableId("policy", scenario.seed), stableId("policy_version", scenario.seed),
          ATTEMPT_NOW_DATE.toISOString(), fixture.blueprintVersionId]
      );
      if (scenario.answered) {
        await new AssessmentAttemptService(db).submitCurrentAnswer(principal, {
          attemptId: fixture.attemptId, position: 1,
          questionVersionId: fixture.items[0].questionVersionId, answer: true
        }, ATTEMPT_NOW_DATE);
      }
      await db.transaction(transaction => completeSubmittedAssessment(transaction, {
        caseId: fixture.caseId, attemptId: fixture.attemptId,
        blueprintVersionId: fixture.blueprintVersionId,
        actor: { accountId: principal.accountId, role: "worker" }, now: ATTEMPT_NOW_DATE
      }));
      const result = (await db.query(
        "SELECT case_status FROM assurance_cases WHERE case_id=$1", [fixture.caseId]
      )).rows[0];
      assert.equal(result.case_status, scenario.written ? "Review pending" : "Reassessment required");
      const reviews = (await db.query(
        "SELECT score,decision,status FROM written_score_reviews WHERE attempt_id=$1",
        [fixture.attemptId]
      )).rows;
      if (scenario.written) {
        assert.equal(reviews.some(review => review.status === "FINAL"), false);
      } else {
        assert.equal(reviews.length, 1);
        assert.equal(Number(reviews[0].score), scenario.score);
        assert.equal(reviews[0].decision, "FAIL");
      }
      assert.equal(await countRows(db, "assessment_attempt_answers", "attempt_id=$1",
        [fixture.attemptId]), scenario.answered ? 1 : 0);
    } finally {
      await db.close();
    }
  });
}
