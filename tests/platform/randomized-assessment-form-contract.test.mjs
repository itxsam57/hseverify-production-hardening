import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function source(path) {
  return readFile(resolve(path), "utf8").catch(() => "");
}

test("M2.05 migration defines immutable blueprint and generated form history", async () => {
  const migration = await source("database/migrations/0039_randomized_assessment_forms.up.sql");
  const down = await source("database/migrations/0039_randomized_assessment_forms.down.sql");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS assessment_blueprints/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS assessment_blueprint_versions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS generated_assessment_forms/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS generated_assessment_form_items/);
  assert.match(migration, /UNIQUE\s*\(case_id,\s*blueprint_version_id\)/i);
  assert.match(migration, /question_id TEXT NOT NULL/);
  assert.match(migration, /question_version_id TEXT NOT NULL/);
  assert.match(migration, /UNIQUE\s*\(form_id,\s*position\)/i);
  assert.match(migration, /UNIQUE\s*\(form_id,\s*question_id\)/i);
  assert.match(migration, /generation_nonce_hex/);
  assert.match(migration, /assessment\.blueprint\.created/);
  assert.match(migration, /assessment\.blueprint\.revised/);
  assert.match(migration, /assessment\.blueprint\.status\.changed/);
  assert.match(migration, /assessment\.form\.generated/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON assessment_blueprint_versions/i);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON generated_assessment_forms/i);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON generated_assessment_form_items/i);
  assert.match(down, /SELECT 1/);
  assert.doesNotMatch(down, /DROP TABLE/i);
});

test("M2.05 blueprint domain validates selectors and total capacity", async () => {
  const domain = await source("src/lib/assessment-generation/assessment-blueprint-domain.ts");

  assert.match(domain, /export type BlueprintSelector/);
  assert.match(domain, /questionType\?: QuestionType/);
  assert.match(domain, /domainReference\?: string/);
  assert.match(domain, /difficulty\?: QuestionDifficulty/);
  assert.match(domain, /tagsAll: readonly string\[\]/);
  assert.match(domain, /export function normalizeBlueprintReference/);
  assert.match(domain, /export function normalizeBlueprintVersion/);
  assert.match(domain, /count < 1 \|\| count > 100/);
  assert.match(domain, /totalCount > 500/);
  assert.match(domain, /Unknown blueprint selector field/);
  assert.match(domain, /new Set\(normalizedTags\)/);
  assert.doesNotMatch(domain, /Math\.random/);
});
