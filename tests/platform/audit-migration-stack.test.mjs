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

const AUDIT_MIGRATION = "0007_platform_audit_foundation";
const OUTBOX_MIGRATION = "0008_transactional_outbox_jobs";
const NOTIFICATION_MIGRATION = "0009_persisted_notifications";
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
    sessionSecret: "audit-stack-session-secret-with-32-characters",
    authPepper: "audit-stack-auth-pepper-with-32-characters",
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

async function seedAcceptedData(database, suffix) {
  const now = "2026-08-06T09:00:00.000Z";
  const accountId = `account_audit_stack_${suffix}`;
  const eventId = `event_audit_stack_${suffix}`;

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
    [
      accountId,
      `audit-stack-${suffix}@example.com`,
      `Audit Stack ${suffix}`,
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
  assert.equal(account.rows[0]?.account_status, "active");
  assert.equal(authEvent.rows[0]?.event_type, "login_succeeded");
}

async function assertStatus(database, appliedMigrations) {
  const status = await migrationStatus(database);
  assert.deepEqual(
    status.map((entry) => entry.id),
    COMPLETE_MIGRATIONS
  );
  for (const entry of status) {
    assert.equal(entry.checksumMatches, true, `${entry.id} checksum mismatch`);
    assert.equal(
      entry.applied,
      appliedMigrations.includes(entry.id),
      `${entry.id} applied state`
    );
  }
}

async function assertMirroredAudit(database, eventId) {
  const mirrored = await database.query(
    `SELECT action_key FROM platform_audit_events
     WHERE source_kind = 'auth_security_event' AND source_event_id = $1`,
    [eventId]
  );
  assert.equal(mirrored.rows[0]?.action_key, "authentication.login.succeeded");
}

async function exercise(database, env, suffix) {
  assert.deepEqual(
    await applyPendingMigrations(database, env.releaseSha),
    COMPLETE_MIGRATIONS
  );
  assert.deepEqual(await applyPendingMigrations(database, env.releaseSha), []);
  await assertStatus(database, COMPLETE_MIGRATIONS);

  const seeded = await seedAcceptedData(database, suffix);
  await assertMirroredAudit(database, seeded.eventId);
  assert.equal(await tableExists(database, "platform_outbox_jobs"), true);
  assert.equal(await tableExists(database, "platform_notifications"), true);

  const original = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  try {
    const notificationIndex = COMPLETE_MIGRATIONS.indexOf(
      NOTIFICATION_MIGRATION
    );
    assert.ok(notificationIndex >= 0);
    for (const newerMigration of COMPLETE_MIGRATIONS
      .slice(notificationIndex + 1)
      .reverse()) {
      assert.equal(
        await rollbackLatestMigration(database, env),
        newerMigration
      );
    }

    assert.equal(
      await rollbackLatestMigration(database, env),
      NOTIFICATION_MIGRATION
    );
    assert.equal(await tableExists(database, "platform_notifications"), false);
    assert.equal(await tableExists(database, "platform_outbox_jobs"), true);
    assert.equal(await tableExists(database, "platform_audit_events"), true);
    await assertAcceptedData(database, seeded);
    await assertMirroredAudit(database, seeded.eventId);
    await assertStatus(
      database,
      COMPLETE_MIGRATIONS.slice(
        0,
        COMPLETE_MIGRATIONS.indexOf(NOTIFICATION_MIGRATION)
      )
    );

    assert.equal(
      await rollbackLatestMigration(database, env),
      OUTBOX_MIGRATION
    );
    assert.equal(await tableExists(database, "platform_outbox_jobs"), false);
    assert.equal(await tableExists(database, "platform_audit_events"), true);
    await assertAcceptedData(database, seeded);
    await assertMirroredAudit(database, seeded.eventId);
    await assertStatus(
      database,
      COMPLETE_MIGRATIONS.slice(
        0,
        COMPLETE_MIGRATIONS.indexOf(OUTBOX_MIGRATION)
      )
    );

    assert.equal(
      await rollbackLatestMigration(database, env),
      AUDIT_MIGRATION
    );
    assert.equal(await tableExists(database, "platform_audit_events"), false);
    await assertAcceptedData(database, seeded);
    await assertStatus(
      database,
      COMPLETE_MIGRATIONS.slice(
        0,
        COMPLETE_MIGRATIONS.indexOf(AUDIT_MIGRATION)
      )
    );

    const auditIndex = COMPLETE_MIGRATIONS.indexOf(AUDIT_MIGRATION);
    assert.ok(auditIndex >= 0);
    assert.deepEqual(
      await applyPendingMigrations(database, `${env.releaseSha}-reapply`),
      COMPLETE_MIGRATIONS.slice(auditIndex)
    );
    assert.deepEqual(
      await applyPendingMigrations(database, `${env.releaseSha}-reapply`),
      []
    );
    assert.equal(await tableExists(database, "platform_audit_events"), true);
    assert.equal(await tableExists(database, "platform_outbox_jobs"), true);
    assert.equal(await tableExists(database, "platform_notifications"), true);
    await assertAcceptedData(database, seeded);
    await assertMirroredAudit(database, seeded.eventId);
    await assertStatus(database, COMPLETE_MIGRATIONS);
  } finally {
    if (original === undefined) {
      delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    } else {
      process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = original;
    }
  }
  return seeded;
}

test("audit migration rolls back and reapplies while preserving accepted M1.01-M1.04 data", async () => {
  const env = environment("memory://", "audit-stack-memory");
  const database = await openScriptDatabase(env);
  try {
    await exercise(database, env, "memory");
  } finally {
    await database.close();
  }
});

test("audit migration remains deterministic after persistent PGlite close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-audit-stack-"));
  const env = environment(directory, "audit-stack-persistent");
  let database = await openScriptDatabase(env);
  try {
    const seeded = await exercise(database, env, "persistent");
    await database.close();
    database = null;

    const reopened = await openScriptDatabase(env);
    try {
      await assertAcceptedData(reopened, seeded);
      await assertMirroredAudit(reopened, seeded.eventId);
      assert.equal(await tableExists(reopened, "platform_outbox_jobs"), true);
      assert.equal(await tableExists(reopened, "platform_notifications"), true);
      assert.deepEqual(
        await applyPendingMigrations(reopened, `${env.releaseSha}-reopened`),
        []
      );
      await assertStatus(reopened, COMPLETE_MIGRATIONS);
    } finally {
      await reopened.close();
    }
  } finally {
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});
