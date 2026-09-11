import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function source(path) {
  return readFile(resolve(path), "utf8").catch(() => "");
}

test("M2.07 migration defines attempt and committed-answer integrity", async () => {
  const migration = await source("database/migrations/0042_assessment_attempt_lifecycle.up.sql");
  const down = await source("database/migrations/0042_assessment_attempt_lifecycle.down.sql");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS assessment_attempts/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS assessment_attempt_answers/i);
  assert.match(migration, /attempt_id TEXT PRIMARY KEY/i);
  assert.match(migration, /status TEXT NOT NULL/i);
  assert.match(migration, /CHECK \(status IN \('IN_PROGRESS', 'SUBMITTED'\)\)/i);
  assert.match(migration, /question_count INTEGER NOT NULL/i);
  assert.match(migration, /current_position INTEGER NOT NULL/i);
  assert.match(migration, /current_position BETWEEN 1 AND question_count/i);
  assert.match(migration, /status = 'IN_PROGRESS'.*submitted_at IS NULL/is);
  assert.match(migration, /status = 'SUBMITTED'.*submitted_at IS NOT NULL/is);
  assert.match(migration, /status = 'SUBMITTED'.*current_position = question_count/is);
  assert.match(migration, /UNIQUE \(form_id\)/i);
  assert.match(migration, /UNIQUE \(attempt_id, form_id\)/i);
  assert.match(migration, /UNIQUE \(attempt_id, position\)/i);
  assert.match(migration, /UNIQUE \(form_id, form_item_id\)/i);
  assert.match(migration, /FOREIGN KEY \(attempt_id, form_id\)/i);
  assert.match(migration, /FOREIGN KEY \(form_id, form_item_id\)/i);
  assert.match(migration, /REFERENCES assurance_cases/i);
  assert.match(migration, /REFERENCES auth_accounts/i);
  assert.match(migration, /REFERENCES assessment_catalogue_versions/i);
  assert.match(migration, /REFERENCES assessment_blueprint_versions/i);
  assert.match(migration, /REFERENCES generated_assessment_forms/i);
  assert.match(migration, /REFERENCES generated_assessment_form_items/i);
  assert.match(migration, /REFERENCES assessment_questions/i);
  assert.match(migration, /REFERENCES assessment_question_versions/i);
  assert.match(migration, /text_value TEXT/i);
  assert.match(migration, /boolean_value BOOLEAN/i);
  assert.match(migration, /numeric_value NUMERIC/i);
  assert.match(migration, /question_type = 'MULTIPLE_CHOICE'.*text_value IS NOT NULL/is);
  assert.match(migration, /question_type = 'TRUE_FALSE'.*boolean_value IS NOT NULL/is);
  assert.match(migration, /question_type IN \('SHORT_TEXT', 'LONG_TEXT'\).*text_value IS NOT NULL/is);
  assert.match(migration, /question_type IN \('INTEGER', 'DECIMAL'\).*numeric_value IS NOT NULL/is);

  assert.match(down, /DROP TABLE IF EXISTS assessment_attempt_answers/i);
  assert.match(down, /DROP TABLE IF EXISTS assessment_attempts/i);
  assert.doesNotMatch(down, /DROP TABLE IF EXISTS generated_assessment_forms/i);
  assert.doesNotMatch(down, /DROP TABLE IF EXISTS generated_assessment_form_items/i);
});

test("M2.07 domain exposes only attempt states and type-safe answer normalization", async () => {
  const domain = await source("src/lib/assessment-attempt/assessment-attempt-domain.ts");

  assert.match(domain, /ASSESSMENT_ATTEMPT_STATUSES/);
  assert.match(domain, /"IN_PROGRESS"/);
  assert.match(domain, /"SUBMITTED"/);
  assert.doesNotMatch(domain, /"REVIEW_PENDING"/);
  assert.match(domain, /export type AssessmentAttemptRecord/);
  assert.match(domain, /export type NormalizedAssessmentAnswer/);
  assert.match(domain, /export function normalizeAssessmentAnswer/);
  assert.match(domain, /MULTIPLE_CHOICE/);
  assert.match(domain, /TRUE_FALSE/);
  assert.match(domain, /SHORT_TEXT/);
  assert.match(domain, /LONG_TEXT/);
  assert.match(domain, /INTEGER/);
  assert.match(domain, /DECIMAL/);
  assert.match(domain, /2_000|2000/);
  assert.match(domain, /20_000|20000/);
  assert.match(domain, /Number\.isSafeInteger/);
  assert.match(domain, /Number\.isFinite/);
  assert.match(domain, /AssessmentAttemptAnswerInputError/);
  assert.match(domain, /createAssessmentAttemptId/);
  assert.match(domain, /createAssessmentAnswerId/);
  assert.doesNotMatch(domain, /answerKey/);
  assert.doesNotMatch(domain, /rubric/);
  assert.doesNotMatch(domain, /correctness|isCorrect|score/i);
});
