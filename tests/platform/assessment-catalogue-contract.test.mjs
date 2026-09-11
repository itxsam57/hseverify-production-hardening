import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function source(path) {
  return readFile(resolve(path), "utf8").catch(() => "");
}

function roleGrantBlock(auth, role) {
  const marker = `${role}:`;
  const start = auth.indexOf(marker, auth.indexOf("ROLE_PLATFORM_PERMISSION_GRANTS"));
  if (start < 0) return "";
  const after = auth.slice(start + marker.length);
  const open = after.indexOf("[");
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < after.length; index += 1) {
    if (after[index] === "[") depth += 1;
    if (after[index] === "]") {
      depth -= 1;
      if (depth === 0) return after.slice(open + 1, index);
    }
  }
  return "";
}

test("M2.06 migration defines versioned catalogue integrity and audit actions", async () => {
  const migration = await source("database/migrations/0040_assessment_catalogue_eligibility.up.sql");
  const down = await source("database/migrations/0040_assessment_catalogue_eligibility.down.sql");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS assessment_catalogue_entries/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS assessment_catalogue_versions/);
  assert.match(migration, /catalogue_entry_id TEXT PRIMARY KEY/);
  assert.match(migration, /catalogue_version_id TEXT PRIMARY KEY/);
  assert.match(migration, /minimum_verified_qualifications/);
  assert.match(migration, /CHECK \(minimum_verified_qualifications BETWEEN 0 AND 50\)/);
  assert.match(migration, /UNIQUE \(catalogue_entry_id, catalogue_version_id\)/);
  assert.match(migration, /assessment_catalogue_entries_current_version_fk/);
  assert.match(migration, /assessment_catalogue_versions_blueprint_framework_fk/);
  assert.match(migration, /FOREIGN KEY \(framework_id, blueprint_version_id\)/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON assessment_catalogue_versions/i);
  assert.match(migration, /assessment\.catalogue\.created/);
  assert.match(migration, /assessment\.catalogue\.revised/);
  assert.match(migration, /assessment\.catalogue\.status\.changed/);
  assert.match(down, /SELECT 1/);
  assert.doesNotMatch(down, /DROP TABLE/i);
});

test("M2.06 domain normalizes catalogue references, versions and qualification minimum", async () => {
  const domain = await source("src/lib/assessment-catalogue/assessment-catalogue-domain.ts");
  assert.match(domain, /export type CatalogueStatus/);
  assert.match(domain, /export function normalizeCatalogueReference/);
  assert.match(domain, /export function normalizeCatalogueVersion/);
  assert.match(domain, /minimumVerifiedQualifications/);
  assert.match(domain, /< 0 \|\| .* > 50/);
  assert.match(domain, /createCatalogueEntryId/);
  assert.match(domain, /createCatalogueVersionId/);
});

test("M2.06 authorization adds a Worker-only assessment availability read permission", async () => {
  const auth = await source("src/lib/authorization/authorization-domain.ts");
  assert.match(auth, /"worker\.assessments\.read"/);

  const workerBlock = roleGrantBlock(auth, "worker");
  assert.notEqual(workerBlock, "", "Worker platform permission grant block was not found.");
  assert.match(workerBlock, /"worker\.assessments\.read"/);

  for (const role of ["company", "assessor", "verifier", "admin", "root"]) {
    const block = roleGrantBlock(auth, role);
    assert.notEqual(block, "", `${role} platform permission grant block was not found.`);
    assert.doesNotMatch(
      block,
      /"worker\.assessments\.read"/,
      `${role} unexpectedly received Worker assessment read permission`
    );
  }
});

test("M2.06 audit domain natively registers catalogue mutation actions", async () => {
  const audit = await source("src/lib/audit/audit-domain.ts");
  assert.match(audit, /"assessment\.catalogue\.created"/);
  assert.match(audit, /"assessment\.catalogue\.revised"/);
  assert.match(audit, /"assessment\.catalogue\.status\.changed"/);
});

test("M2.06 targeted runtime gate requires executable history-preserving rollback and reapply proof", async () => {
  const runner = await source("scripts/run-assessment-catalogue-runtime-tests.mjs");
  assert.match(runner, /M2\.06 history preserving rollback and reapply/);
  assert.match(runner, /assessment-catalogue-rollback\.test\.mjs/);
});
