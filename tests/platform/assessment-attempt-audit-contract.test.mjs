import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function source(path) {
  return readFile(resolve(path), "utf8").catch(() => "");
}

test("M2.07 registers only start and submit attempt audit actions in code and schema", async () => {
  const audit = await source("src/lib/audit/audit-domain.ts");
  const migration = await source("database/migrations/0042_assessment_attempt_lifecycle.up.sql");

  for (const action of ["assessment.attempt.started", "assessment.attempt.submitted"]) {
    const escaped = action.replaceAll(".", "\\.");
    assert.match(audit, new RegExp(`"${escaped}"`));
    assert.match(migration, new RegExp(`'${escaped}'`));
  }

  assert.doesNotMatch(audit, /assessment\.attempt\.(scored|passed|failed|reviewed)/);
  assert.doesNotMatch(migration, /assessment\.attempt\.(scored|passed|failed|reviewed)/);
});

test("M2.07 attempt service source never writes answer content into audit metadata", async () => {
  const service = await source("src/lib/assessment-attempt/assessment-attempt-service.ts");
  assert.doesNotMatch(service, /metadata\s*:\s*\{[^}]*answer/i);
  assert.doesNotMatch(service, /metadata\s*:\s*\{[^}]*textValue/i);
  assert.doesNotMatch(service, /metadata\s*:\s*\{[^}]*booleanValue/i);
  assert.doesNotMatch(service, /metadata\s*:\s*\{[^}]*numericValue/i);
});
