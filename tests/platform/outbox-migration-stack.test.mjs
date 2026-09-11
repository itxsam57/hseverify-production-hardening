import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import {
  applyPendingMigrations,
  listMigrations,
  migrationStatus,
  rollbackLatestMigration
} from "../../scripts/lib/migrations.mjs";

const OWNED_MIGRATION = "0008_transactional_outbox_jobs";
const COMPLETE_MIGRATIONS = (await listMigrations()).map(
  (migration) => migration.id
);

function environment(pgliteDataDir, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir,
    releaseSha,
    sessionSecret: "outbox-stack-session-secret-with-32-characters",
    authPepper: "outbox-stack-auth-pepper-with-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function tableExists(database, tableName) {
  const result = await database.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return result.rows.length === 1;
}

async function rollbackThrough(database, env, targetId) {
  const rolledBack = [];
  while (true) {
    const id = await rollbackLatestMigration(database, env);
    assert.ok(id, `expected to reach ${targetId}`);
    rolledBack.push(id);
    if (id === targetId) return rolledBack;
  }
}

async function seedAcceptedData(database, suffix) {
  const now = "2026-08-06T12:00:00.000Z";
  const accountId = `account_outbox_stack_${suffix}`;
  const eventId = `event_outbox_stack_${suffix}`;

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
    [
      accountId,
      `outbox-stack-${suffix}@example.com`,
      `Outbox Stack ${suffix}`,
      "scrypt$16384$8$1$salt$hash",
      now
    ]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    [accountId, now]
  );
  await database.query(
    `INSERT INTO auth_security_events (
       event_id, account_id, event_type, active_role, metadata, occurred_at
     ) VALUES ($1, $2, 'login_succeeded', 'worker', $3::jsonb, $4)`,
    [eventId, accountId, JSON.stringify({ safe: suffix }), now]
  );
  return { accountId, eventId };
}

async function assertAcceptedData(database, seeded) {
  const account = await database.query(
    "SELECT account_status FROM auth_accounts WHERE account_id = $1",
    [seeded.accountId]
  );
  const authEvent = await database.query(
    "SELECT event_type FROM auth_security_events WHERE event_id = $1",
    [seeded.eventId]
  );
  const audit = await database.query(
    `SELECT action_key FROM platform_audit_events
     WHERE source_kind = 'auth_security_event' AND source_event_id = $1`,
    [seeded.eventId]
  );
  assert.equal(account.rows[0]?.account_status, "active");
  assert.equal(authEvent.rows[0]?.event_type, "login_succeeded");
  assert.equal(audit.rows[0]?.action_key, "authentication.login.succeeded");
}

async function exercise(database, env, suffix) {
  assert.deepEqual(
    await applyPendingMigrations(database, env.releaseSha),
    COMPLETE_MIGRATIONS
  );
  assert.deepEqual(await applyPendingMigrations(database, env.releaseSha), []);

  const seeded = await seedAcceptedData(database, suffix);
  await assertAcceptedData(database, seeded);
  assert.equal(await tableExists(database, "platform_outbox_jobs"), true);
  assert.equal(await tableExists(database, "platform_outbox_job_attempts"), true);
  assert.equal(await tableExists(database, "platform_notifications"), true);

  const lifecycleAuditId = `audit_outbox_stack_${suffix}`;
  const lifecycleJobId = `job_outbox_stack_${suffix}`;
  await database.query(
    `INSERT INTO platform_audit_events (
       audit_event_id, source_kind, action_key, outcome,
       target_type, target_reference, metadata
     ) VALUES ($1, 'native', 'outbox.job.enqueued', 'succeeded',
       'job', $2, '{}'::jsonb)`,
    [lifecycleAuditId, lifecycleJobId]
  );

  const original = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  try {
    const rolledBack = await rollbackThrough(database, env, OWNED_MIGRATION);
    assert.equal(rolledBack.at(-1), OWNED_MIGRATION);
    assert.equal(await tableExists(database, "platform_outbox_jobs"), false);
    assert.equal(await tableExists(database, "platform_outbox_job_attempts"), false);
    await assertAcceptedData(database, seeded);

    const retainedLifecycleAudit = await database.query(
      `SELECT action_key, target_type
       FROM platform_audit_events
       WHERE audit_event_id = $1`,
      [lifecycleAuditId]
    );
    assert.deepEqual(retainedLifecycleAudit.rows[0], {
      action_key: "outbox.job.enqueued",
      target_type: "job"
    });

    const statusAfterRollback = await migrationStatus(database);
    const ownedIndex = COMPLETE_MIGRATIONS.indexOf(OWNED_MIGRATION);
    assert.ok(ownedIndex >= 0);
    for (let index = 0; index < statusAfterRollback.length; index += 1) {
      const entry = statusAfterRollback[index];
      assert.equal(entry.checksumMatches, true, `${entry.id} checksum changed`);
      assert.equal(
        entry.applied,
        index < ownedIndex,
        `${entry.id} applied state after owned rollback is wrong`
      );
    }

    const expectedReapply = [...rolledBack].reverse();
    assert.deepEqual(
      await applyPendingMigrations(database, `${env.releaseSha}-reapply`),
      expectedReapply
    );
    assert.deepEqual(
      await applyPendingMigrations(database, `${env.releaseSha}-reapply`),
      []
    );
    assert.equal(await tableExists(database, "platform_outbox_jobs"), true);
    assert.equal(await tableExists(database, "platform_notifications"), true);
    await assertAcceptedData(database, seeded);

    const retainedAfterReapply = await database.query(
      `SELECT action_key, target_type
       FROM platform_audit_events
       WHERE audit_event_id = $1`,
      [lifecycleAuditId]
    );
    assert.deepEqual(retainedAfterReapply.rows[0], {
      action_key: "outbox.job.enqueued",
      target_type: "job"
    });

    const finalStatus = await migrationStatus(database);
    assert.equal(finalStatus.every((entry) => entry.applied), true);
    assert.equal(finalStatus.every((entry) => entry.checksumMatches), true);
  } finally {
    if (original === undefined) {
      delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    } else {
      process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = original;
    }
  }
  return { ...seeded, lifecycleAuditId };
}

test("outbox migration rolls back and reapplies while preserving accepted data", async () => {
  const env = environment("memory://", "outbox-stack-memory");
  const database = await openScriptDatabase(env);
  try {
    await exercise(database, env, "memory");
  } finally {
    await database.close();
  }
});

test("outbox migration and accepted history survive persistent close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-outbox-stack-"));
  const env = environment(directory, "outbox-stack-persistent");
  let database = await openScriptDatabase(env);
  try {
    const seeded = await exercise(database, env, "persistent");
    await database.close();
    database = null;

    const reopened = await openScriptDatabase(env);
    try {
      await assertAcceptedData(reopened, seeded);
      assert.equal(await tableExists(reopened, "platform_outbox_jobs"), true);
      assert.equal(await tableExists(reopened, "platform_notifications"), true);
      const lifecycleAudit = await reopened.query(
        `SELECT action_key, target_type
         FROM platform_audit_events
         WHERE audit_event_id = $1`,
        [seeded.lifecycleAuditId]
      );
      assert.deepEqual(lifecycleAudit.rows[0], {
        action_key: "outbox.job.enqueued",
        target_type: "job"
      });
      assert.deepEqual(
        await applyPendingMigrations(
          reopened,
          `${env.releaseSha}-reopened`
        ),
        []
      );
    } finally {
      await reopened.close();
    }
  } finally {
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});