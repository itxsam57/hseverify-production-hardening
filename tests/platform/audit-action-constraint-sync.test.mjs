import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

function environment(pgliteDataDir) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir,
    releaseSha: "audit-action-constraint-sync",
    sessionSecret: "audit-action-sync-session-secret-with-32-characters",
    authPepper: "audit-action-sync-auth-pepper-with-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function declaredAuditActions() {
  const source = await readFile("src/lib/audit/audit-domain.ts", "utf8");
  const block = source.match(/export const AUDIT_ACTIONS = \[([\s\S]*?)\] as const;/);
  assert.ok(block, "AUDIT_ACTIONS declaration must remain statically inspectable");
  const actions = [...block[1].matchAll(/"([a-z0-9._-]+)"/g)].map((match) => match[1]);
  assert.ok(actions.length > 0, "AUDIT_ACTIONS must contain declared actions");
  assert.equal(new Set(actions).size, actions.length, "AUDIT_ACTIONS must not contain duplicates");
  return actions;
}

test("database audit action constraint accepts every declared action and rejects undeclared actions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hse-audit-action-sync-"));
  const env = environment(directory);
  const database = await openScriptDatabase(env);

  try {
    await applyPendingMigrations(database, env.releaseSha);
    const actions = await declaredAuditActions();

    for (const [index, action] of actions.entries()) {
      await database.query(
        `INSERT INTO platform_audit_events (
           audit_event_id, source_kind, action_key, outcome,
           target_type, target_reference, metadata
         ) VALUES ($1, 'native', $2, 'succeeded', 'resource', $3, '{}'::jsonb)`,
        [
          `audit_action_sync_${String(index).padStart(3, "0")}`,
          action,
          `audit-action-sync-${index}`
        ]
      );
    }

    const inserted = await database.query(
      `SELECT COUNT(*)::int AS count
       FROM platform_audit_events
       WHERE audit_event_id LIKE 'audit_action_sync_%'`
    );
    assert.equal(inserted.rows[0]?.count, actions.length);

    await assert.rejects(
      database.query(
        `INSERT INTO platform_audit_events (
           audit_event_id, source_kind, action_key, outcome,
           target_type, target_reference, metadata
         ) VALUES (
           'audit_action_sync_invalid', 'native',
           'assessment.question.undeclared', 'succeeded',
           'resource', 'audit-action-sync-invalid', '{}'::jsonb
         )`
      ),
      (error) => error?.code === "23514"
    );
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
