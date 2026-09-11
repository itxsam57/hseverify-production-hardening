import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import {
  ATTEMPT_NOW,
  seedInProgressAttempt,
  seedWorkerPrincipal,
  stableId
} from "../helpers/assessment-attempt-fixture.mjs";

const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-08-draft-rollback-runtime",
  sessionSecret: "m2-08-draft-rollback-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-08-draft-rollback-auth-pepper-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function relationExists(db, relation) {
  const result = await db.query(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [`public.${relation}`]
  );
  return result.rows[0]?.exists === true;
}

async function requiredSource(path) {
  const content = await readFile(resolve(path), "utf8").catch(() => "");
  assert.ok(content.trim(), `${path} is missing`);
  return content;
}

test("M2.08 draft rollback removes only draft state, preserves M2.07 history, and reapplies cleanly", async () => {
  const up = await requiredSource("database/migrations/0043_assessment_attempt_drafts.up.sql");
  const down = await requiredSource("database/migrations/0043_assessment_attempt_drafts.down.sql");
  const db = await openScriptDatabase(ENV);

  try {
    await applyMigrationsThrough(db, ENV.releaseSha, "0042_assessment_attempt_lifecycle");
    const principal = await seedWorkerPrincipal(db, "m208-draft-rollback");
    const fixture = await seedInProgressAttempt(db, principal, "m208-draft-rollback", [
      { questionType: "TRUE_FALSE" },
      { questionType: "SHORT_TEXT" }
    ]);
    const committed = fixture.items[0];
    const current = fixture.items[1];

    await db.query(
      `INSERT INTO assessment_attempt_answers(
         answer_id,attempt_id,form_id,form_item_id,position,question_id,
         question_version_id,question_type,text_value,boolean_value,numeric_value,committed_at
       ) VALUES($1,$2,$3,$4,1,$5,$6,'TRUE_FALSE',NULL,TRUE,NULL,$7)`,
      [
        stableId("assessment_answer", "m208-draft-rollback"),
        fixture.attemptId,
        fixture.formId,
        committed.formItemId,
        committed.questionId,
        committed.questionVersionId,
        ATTEMPT_NOW
      ]
    );
    await db.query(
      `UPDATE assessment_attempts
       SET current_position=2,updated_at=$2
       WHERE attempt_id=$1`,
      [fixture.attemptId, ATTEMPT_NOW]
    );

    await db.execute(up);
    assert.equal(await relationExists(db, "assessment_attempt_drafts"), true);
    assert.equal(await relationExists(db, "assessment_attempts"), true);
    assert.equal(await relationExists(db, "assessment_attempt_answers"), true);

    await db.query(
      `INSERT INTO assessment_attempt_drafts(
         attempt_id,form_id,form_item_id,position,question_id,question_version_id,question_type,
         text_value,boolean_value,revision,latest_mutation_key,latest_mutation_digest,created_at,updated_at
       ) VALUES($1,$2,$3,2,$4,$5,'SHORT_TEXT',$6,NULL,1,$7,$8,$9,$9)`,
      [
        fixture.attemptId,
        fixture.formId,
        current.formItemId,
        current.questionId,
        current.questionVersionId,
        "  rollback must not touch committed history  ",
        "m208-rollback-draft-0001",
        "a".repeat(64),
        ATTEMPT_NOW
      ]
    );

    await db.execute(down);
    assert.equal(await relationExists(db, "assessment_attempt_drafts"), false);
    assert.equal(await relationExists(db, "assessment_attempts"), true);
    assert.equal(await relationExists(db, "assessment_attempt_answers"), true);
    assert.equal(await relationExists(db, "generated_assessment_forms"), true);
    assert.equal(await relationExists(db, "generated_assessment_form_items"), true);

    const attempt = await db.query(
      `SELECT status,current_position,submitted_at
       FROM assessment_attempts
       WHERE attempt_id=$1`,
      [fixture.attemptId]
    );
    assert.deepEqual(attempt.rows, [
      { status: "IN_PROGRESS", current_position: 2, submitted_at: null }
    ]);
    const answer = await db.query(
      `SELECT position,question_type,boolean_value
       FROM assessment_attempt_answers
       WHERE attempt_id=$1`,
      [fixture.attemptId]
    );
    assert.deepEqual(answer.rows, [
      { position: 1, question_type: "TRUE_FALSE", boolean_value: true }
    ]);

    const checks = await db.query(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid='assessment_attempts'::regclass AND contype='c'`
    );
    const definitions = checks.rows.map((row) => String(row.definition)).join("\n");
    assert.match(definitions, /IN_PROGRESS/);
    assert.match(definitions, /SUBMITTED/);
    assert.doesNotMatch(definitions, /INTERRUPTED|RECOVERABLE|SUPERSEDED/);

    await db.execute(up);
    assert.equal(await relationExists(db, "assessment_attempt_drafts"), true);
    const preserved = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM assessment_attempt_answers
       WHERE attempt_id=$1`,
      [fixture.attemptId]
    );
    assert.equal(preserved.rows[0].count, 1);
  } finally {
    await db.close();
  }
});
