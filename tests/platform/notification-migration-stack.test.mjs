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

const OWNED_MIGRATION = "0009_persisted_notifications";
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
    sessionSecret: "notification-stack-session-secret-with-32-characters",
    authPepper: "notification-stack-auth-pepper-with-32-characters",
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

async function seedWorker(database, suffix) {
  const now = "2026-08-07T08:00:00.000Z";
  const accountId = `account_notification_stack_${suffix}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, `notification-stack-${suffix}@example.com`, `Stack ${suffix}`, now]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    [accountId, now]
  );
  return accountId;
}

async function seedNotificationJob(database, accountId, character) {
  const jobId = `job_${character.repeat(24)}`;
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, 'notification.portal.foundation', 1, $2, $3::jsonb,
       $4, 'worker', NULL, NULL)`,
    [
      jobId,
      character.toLowerCase().repeat(64),
      JSON.stringify({ fixtureRef: `fixture_${character}` }),
      accountId
    ]
  );
  return jobId;
}

async function seedNotification(database, accountId, jobId, character) {
  const notificationId = `notification_${character.repeat(24)}`;
  await database.query(
    `INSERT INTO platform_notifications (
       notification_id, notification_type, schema_version,
       source_job_id, projection_key,
       recipient_account_id, recipient_role, tenant_id, membership_id,
       title, body, metadata, target_key, target_reference
     ) VALUES (
       $1, 'platform.foundation.ready', 1,
       $2, $3,
       $4, 'worker', NULL, NULL,
       'Notification foundation ready',
       'This persisted notification verifies the current portal notification channel.',
       $5::jsonb, 'portal.dashboard', NULL
     )`,
    [
      notificationId,
      jobId,
      character.toLowerCase().repeat(64),
      accountId,
      JSON.stringify({ fixtureRef: `fixture_${character}` })
    ]
  );
  return notificationId;
}

async function exercise(database, env, suffix) {
  assert.deepEqual(
    await applyPendingMigrations(database, env.releaseSha),
    COMPLETE_MIGRATIONS
  );
  assert.deepEqual(await applyPendingMigrations(database, env.releaseSha), []);

  const accountId = await seedWorker(database, suffix);
  const firstJobId = await seedNotificationJob(database, accountId, "A");
  const firstNotificationId = await seedNotification(
    database,
    accountId,
    firstJobId,
    "A"
  );
  const auditId = `audit_notification_stack_${suffix}`;
  await database.query(
    `INSERT INTO platform_audit_events (
       audit_event_id, source_kind, action_key, outcome,
       target_type, target_reference, metadata
     ) VALUES ($1, 'native', 'notification.projected', 'succeeded',
       'notification', $2, '{}'::jsonb)`,
    [auditId, firstNotificationId]
  );

  assert.equal(await tableExists(database, "platform_notifications"), true);
  assert.equal(await tableExists(database, "platform_outbox_jobs"), true);

  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  try {
    const rolledBack = await rollbackThrough(database, env, OWNED_MIGRATION);
    assert.equal(rolledBack.at(-1), OWNED_MIGRATION);
    assert.equal(await tableExists(database, "platform_notifications"), false);
    assert.equal(await tableExists(database, "platform_outbox_jobs"), true);

    const retainedJob = await database.query(
      `SELECT job_type FROM platform_outbox_jobs WHERE job_id = $1`,
      [firstJobId]
    );
    assert.equal(retainedJob.rows[0].job_type, "notification.portal.foundation");
    const retainedAudit = await database.query(
      `SELECT action_key, target_type FROM platform_audit_events
       WHERE audit_event_id = $1`,
      [auditId]
    );
    assert.deepEqual(retainedAudit.rows[0], {
      action_key: "notification.projected",
      target_type: "notification"
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
    assert.equal(await tableExists(database, "platform_notifications"), true);

    const secondJobId = await seedNotificationJob(database, accountId, "B");
    const persistedNotificationId = await seedNotification(
      database,
      accountId,
      secondJobId,
      "B"
    );

    const finalStatus = await migrationStatus(database);
    assert.equal(finalStatus.every((entry) => entry.applied), true);
    assert.equal(finalStatus.every((entry) => entry.checksumMatches), true);
    return { accountId, firstJobId, auditId, persistedNotificationId };
  } finally {
    if (previous === undefined) {
      delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    } else {
      process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    }
  }
}

test("notification migration rolls back and reapplies without invalidating accepted outbox or immutable audit history", async () => {
  const env = environment("memory://", "notification-stack-memory");
  const database = await openScriptDatabase(env);
  try {
    await exercise(database, env, "memory");
  } finally {
    await database.close();
  }
});

test("persisted notification state survives PGlite close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-notification-stack-"));
  const env = environment(directory, "notification-stack-persistent");
  let database = await openScriptDatabase(env);
  try {
    const seeded = await exercise(database, env, "persistent");
    await database.close();
    database = null;

    const reopened = await openScriptDatabase(env);
    try {
      const notification = await reopened.query(
        `SELECT notification_id, read_at FROM platform_notifications
         WHERE notification_id = $1`,
        [seeded.persistedNotificationId]
      );
      assert.equal(notification.rows.length, 1);
      assert.equal(notification.rows[0].read_at, null);
      const audit = await reopened.query(
        `SELECT action_key, target_type FROM platform_audit_events
         WHERE audit_event_id = $1`,
        [seeded.auditId]
      );
      assert.deepEqual(audit.rows[0], {
        action_key: "notification.projected",
        target_type: "notification"
      });
      assert.deepEqual(
        await applyPendingMigrations(reopened, `${env.releaseSha}-reopened`),
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