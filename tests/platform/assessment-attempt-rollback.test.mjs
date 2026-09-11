import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-07-attempt-rollback-runtime",
  sessionSecret: "m2-07-attempt-rollback-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-07-attempt-rollback-auth-pepper-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function relationExists(db, relation) {
  const result = await db.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${relation}`]
  );
  return result.rows[0]?.exists === true;
}

async function auditActionConstraintDefinition(db) {
  const result = await db.query(
    `SELECT pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE conname = 'platform_audit_events_action_key_check'`
  );
  assert.equal(result.rows.length, 1, "platform audit action constraint must exist exactly once");
  return String(result.rows[0].definition);
}

async function insertAuditEvent(db, auditEventId, actionKey) {
  await db.query(
    `INSERT INTO platform_audit_events (
       audit_event_id,
       source_kind,
       action_key,
       outcome,
       target_type,
       target_reference,
       metadata
     ) VALUES ($1, 'native', $2, 'succeeded', 'resource', $3, '{}'::jsonb)`,
    [auditEventId, actionKey, auditEventId]
  );
}

test("M2.07 down removes only attempt-owned schema and reapply restores it", async () => {
  const db = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(db, ENV.releaseSha, "0042_assessment_attempt_lifecycle");

    assert.equal(await relationExists(db, "assessment_attempts"), true);
    assert.equal(await relationExists(db, "assessment_attempt_answers"), true);
    assert.equal(await relationExists(db, "generated_assessment_forms"), true);
    assert.equal(await relationExists(db, "generated_assessment_form_items"), true);

    const m207AuditConstraint = await auditActionConstraintDefinition(db);
    assert.match(m207AuditConstraint, /assessment\.attempt\.started/);
    assert.match(m207AuditConstraint, /assessment\.attempt\.submitted/);
    assert.match(m207AuditConstraint, /assessment\.catalogue\.status\.changed/);

    await insertAuditEvent(
      db,
      "audit_m207_rollback_history",
      "assessment.attempt.started"
    );

    const down = await readFile(
      resolve("database/migrations/0042_assessment_attempt_lifecycle.down.sql"),
      "utf8"
    );
    const up = await readFile(
      resolve("database/migrations/0042_assessment_attempt_lifecycle.up.sql"),
      "utf8"
    );

    await db.execute(down);
    assert.equal(await relationExists(db, "assessment_attempt_answers"), false);
    assert.equal(await relationExists(db, "assessment_attempts"), false);
    assert.equal(await relationExists(db, "generated_assessment_forms"), true);
    assert.equal(await relationExists(db, "generated_assessment_form_items"), true);

    const rolledBackAuditConstraint = await auditActionConstraintDefinition(db);
    assert.doesNotMatch(rolledBackAuditConstraint, /assessment\.attempt\.started/);
    assert.doesNotMatch(rolledBackAuditConstraint, /assessment\.attempt\.submitted/);
    assert.match(rolledBackAuditConstraint, /assessment\.catalogue\.status\.changed/);

    const preservedHistory = await db.query(
      `SELECT action_key
       FROM platform_audit_events
       WHERE audit_event_id = 'audit_m207_rollback_history'`
    );
    assert.deepEqual(preservedHistory.rows, [{ action_key: "assessment.attempt.started" }]);

    await assert.rejects(
      () =>
        insertAuditEvent(
          db,
          "audit_m207_rollback_new_attempt",
          "assessment.attempt.started"
        ),
      /check constraint|violates/i
    );
    await insertAuditEvent(
      db,
      "audit_m206_rollback_catalogue",
      "assessment.catalogue.status.changed"
    );

    await db.execute(up);
    assert.equal(await relationExists(db, "assessment_attempts"), true);
    assert.equal(await relationExists(db, "assessment_attempt_answers"), true);

    const reappliedAuditConstraint = await auditActionConstraintDefinition(db);
    assert.match(reappliedAuditConstraint, /assessment\.attempt\.started/);
    assert.match(reappliedAuditConstraint, /assessment\.attempt\.submitted/);
    assert.match(reappliedAuditConstraint, /assessment\.catalogue\.status\.changed/);
  } finally {
    await db.close();
  }
});
