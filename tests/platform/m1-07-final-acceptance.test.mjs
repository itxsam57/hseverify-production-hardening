import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { migrationStatus } from "../../scripts/lib/migrations.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const OWNED_MIGRATION = "0021_worker_identity_corrections";

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "m1-07-final-session-secret-with-at-least-32-characters",
    authPepper: "m1-07-final-auth-pepper-with-at-least-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

test("all six identity subunits coexist on the complete M1.07 migration stack", async () => {
  const env = environment("m1-07-final-stack");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const tables = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'worker_identities',
           'worker_identity_versions',
           'worker_identity_version_drafts',
           'worker_identity_evidence_bindings',
           'worker_identity_check_runs',
           'worker_identity_check_results',
           'worker_identity_duplicate_checks',
           'worker_identity_duplicate_signals',
           'worker_identity_duplicate_dispositions',
           'worker_identity_worker_ids',
           'worker_identity_correction_requests',
           'worker_identity_correction_decisions',
           'worker_identity_correction_evidence_origins'
         )
       ORDER BY table_name`
    );
    assert.equal(tables.rows.length, 13);

    const status = await migrationStatus(database);
    const through = status.slice(0, status.findIndex((entry) => entry.id === OWNED_MIGRATION) + 1);
    assert.equal(through.length > 0, true);
    assert.equal(through.every((entry) => entry.applied && entry.checksumMatches), true);
  } finally {
    await database.close();
  }
});

test("M1.07 final Worker route exposes identity through service contracts without creating reviewer or later-brick routes", () => {
  const page = readFileSync("src/app/worker/(portal)/identity/page.tsx", "utf8");
  const actions = readFileSync("src/app/worker/(portal)/identity/actions.ts", "utf8");
  const workspace = readFileSync("src/components/worker/identity-workspace.tsx", "utf8");
  const navigation = readFileSync("src/components/worker/worker-navigation.tsx", "utf8");

  assert.match(page, /requirePortalAuthorization\("worker"\)/);
  assert.match(page, /identityService\.ensureDraft\(principal\)/);
  assert.match(page, /const draftService = getWorkerIdentityDraftService\(\)/);
  assert.match(page, /draftService\.loadOrInitialize\(principal\)/);
  assert.match(page, /const workspaceRevision = \[/);
  assert.match(page, /draft\.draftRevision/);
  assert.match(page, /item\.status === "active"/);
  assert.match(page, /key=\{workspaceRevision\}/);
  assert.match(navigation, /\/worker\/identity/);
  assert.match(actions, /getSecureFileScanService/);
  assert.match(actions, /getWorkerIdentityDraftService\(\)\.save\(/);
  assert.match(actions, /getWorkerIdentityService\(\)\.submit\(/);
  assert.match(actions, /getWorkerIdentityService\(\)\.withdraw\(/);
  assert.match(actions, /scheduleWorkerIdentityChecksAction/);
  assert.doesNotMatch(actions, /getWorkerIdentityService\(\)\.(?:ensureOwnDraft|submitOwn|withdrawOwn)\(/);
  assert.doesNotMatch(actions, /getWorkerIdentityDraftService\(\)\.(?:loadOwn|saveOwn)\(/);
  assert.match(workspace, /Verified account contacts/);
  assert.match(workspace, /Permanent Worker ID/);
  assert.match(workspace, /Awaiting authorized decision/);
  assert.doesNotMatch(actions, /\/reviewer|\/verifier|\/company/);
  assert.doesNotMatch(actions, /candidate_identity_id|candidateIdentityId/);
});
