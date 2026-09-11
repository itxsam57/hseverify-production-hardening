import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function source(path) {
  return readFile(resolve(path), "utf8").catch(() => "");
}

async function loadDraftDomain() {
  const path = resolve("src/lib/assessment-attempt/assessment-attempt-draft-domain.ts");
  const raw = await source("src/lib/assessment-attempt/assessment-attempt-draft-domain.ts");
  assert.ok(raw.trim(), "M2.08 draft domain module is missing");
  const compiled = ts.transpileModule(raw, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      strict: true,
      removeComments: false
    }
  });
  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.equal(
    errors.length,
    0,
    errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n")
  );
  const dir = await mkdtemp(join(tmpdir(), "hse-m208-draft-domain-"));
  const output = join(dir, "assessment-attempt-draft-domain.mjs");
  await writeFile(output, compiled.outputText, "utf8");
  try {
    return await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("M2.08 draft migration is narrow and preserves M2.07 attempt lifecycle", async () => {
  const migration = await source("database/migrations/0043_assessment_attempt_drafts.up.sql");
  const down = await source("database/migrations/0043_assessment_attempt_drafts.down.sql");
  const attemptDomain = await source("src/lib/assessment-attempt/assessment-attempt-domain.ts");

  assert.ok(migration.trim(), "0043_assessment_attempt_drafts.up.sql is missing");
  assert.ok(down.trim(), "0043_assessment_attempt_drafts.down.sql is missing");
  assert.match(attemptDomain, /ASSESSMENT_ATTEMPT_STATUSES[\s\S]*"IN_PROGRESS"[\s\S]*"SUBMITTED"/);
  assert.doesNotMatch(attemptDomain, /INTERRUPTED|RECOVERABLE|REPLACED|SUPERSEDED/);
  assert.doesNotMatch(migration, /INTERRUPTED|RECOVERABLE|recovery_lineage|technical_issue|successor/i);
  assert.doesNotMatch(migration, /ALTER TABLE\s+assessment_attempts[\s\S]{0,200}status/i);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS assessment_attempt_drafts/i);
  assert.match(migration, /attempt_id TEXT PRIMARY KEY/i);
  assert.match(migration, /form_id TEXT NOT NULL/i);
  assert.match(migration, /form_item_id TEXT NOT NULL/i);
  assert.match(migration, /position INTEGER NOT NULL/i);
  assert.match(migration, /question_id TEXT NOT NULL/i);
  assert.match(migration, /question_version_id TEXT NOT NULL/i);
  assert.match(migration, /question_type TEXT NOT NULL/i);
  assert.match(migration, /text_value TEXT NULL/i);
  assert.match(migration, /boolean_value BOOLEAN NULL/i);
  assert.match(migration, /revision INTEGER NOT NULL/i);
  assert.match(migration, /revision\s*>=\s*1/i);
  assert.match(migration, /latest_mutation_key TEXT NOT NULL/i);
  assert.match(migration, /latest_mutation_digest TEXT NOT NULL/i);
  assert.match(migration, /char_length\(latest_mutation_digest\)\s*=\s*64/i);
  assert.match(migration, /created_at TIMESTAMPTZ NOT NULL/i);
  assert.match(migration, /updated_at TIMESTAMPTZ NOT NULL/i);

  assert.match(migration, /FOREIGN KEY \(attempt_id, form_id\)/i);
  assert.match(migration, /FOREIGN KEY \(form_id, form_item_id\)/i);
  assert.match(
    migration,
    /FOREIGN KEY \(form_id, form_item_id, position, question_id, question_version_id\)/i
  );
  assert.match(
    migration,
    /FOREIGN KEY \(question_id, question_version_id, question_type\)/i
  );
  assert.match(migration, /question_type = 'MULTIPLE_CHOICE'/i);
  assert.match(migration, /question_type = 'TRUE_FALSE'/i);
  assert.match(migration, /question_type IN \('SHORT_TEXT', 'LONG_TEXT', 'INTEGER', 'DECIMAL'\)/i);
  assert.match(migration, /question_type <> 'SHORT_TEXT'[\s\S]*char_length\(text_value\) <= 2000/i);
  assert.match(migration, /question_type <> 'LONG_TEXT'[\s\S]*char_length\(text_value\) <= 20000/i);
  assert.match(migration, /question_type NOT IN \('INTEGER', 'DECIMAL'\)[\s\S]*char_length\(text_value\) <= 128/i);

  assert.match(down, /DROP TABLE IF EXISTS assessment_attempt_drafts/i);
  assert.doesNotMatch(down, /DROP TABLE IF EXISTS assessment_attempt_answers/i);
  assert.doesNotMatch(down, /DROP TABLE IF EXISTS assessment_attempts/i);
  assert.doesNotMatch(down, /DROP TABLE IF EXISTS generated_assessment_forms/i);
});

test("M2.08 draft normalization preserves edit state separately from committed-answer normalization", async () => {
  const domain = await loadDraftDomain();
  assert.equal(typeof domain.normalizeAssessmentDraft, "function");
  assert.equal(typeof domain.AssessmentAttemptDraftInputError, "function");

  const normalize = domain.normalizeAssessmentDraft;
  assert.deepEqual(normalize("MULTIPLE_CHOICE", null, ["Alpha", "Bravo"]), {
    textValue: null,
    booleanValue: null
  });
  assert.deepEqual(normalize("MULTIPLE_CHOICE", "Bravo", ["Alpha", "Bravo"]), {
    textValue: "Bravo",
    booleanValue: null
  });
  assert.deepEqual(normalize("TRUE_FALSE", null, null), {
    textValue: null,
    booleanValue: null
  });
  assert.deepEqual(normalize("TRUE_FALSE", false, null), {
    textValue: null,
    booleanValue: false
  });

  for (const [type, value] of [
    ["SHORT_TEXT", ""],
    ["SHORT_TEXT", "  exact whitespace  "],
    ["LONG_TEXT", "\npartial long answer\n"],
    ["INTEGER", "-"],
    ["INTEGER", "+"],
    ["DECIMAL", "."],
    ["DECIMAL", "1."],
    ["DECIMAL", "-"]
  ]) {
    assert.deepEqual(normalize(type, value, null), {
      textValue: value,
      booleanValue: null
    });
  }

  for (const [type, value, options] of [
    ["MULTIPLE_CHOICE", "Outside", ["Alpha", "Bravo"]],
    ["TRUE_FALSE", "false", null],
    ["SHORT_TEXT", "😀".repeat(2001), null],
    ["LONG_TEXT", "😀".repeat(20001), null],
    ["INTEGER", 12, null],
    ["DECIMAL", 1.2, null],
    ["INTEGER", "1".repeat(129), null],
    ["DECIMAL", "1".repeat(129), null]
  ]) {
    assert.throws(
      () => normalize(type, value, options),
      domain.AssessmentAttemptDraftInputError
    );
  }
});
