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
import {
  bootstrapCompanyScopeTenant,
  insertCompanyScopeDemonstrationRecord
} from "../support/company-scope-bootstrap.mjs";

const BASE_MIGRATIONS = [
  "0001_platform_foundation",
  "0002_authentication_foundation",
  "0003_worker_registration_otp",
  "0004_authentication_completion"
];
const M1_04_MIGRATIONS = [
  "0005_authorization_tenant_isolation",
  "0006_authorization_tenant_scope_fixture"
];
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
    sessionSecret: "m1-04-stack-session-secret-with-32-characters",
    authPepper: "m1-04-stack-auth-pepper-with-32-characters",
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

async function seedAcceptedBaseData(database, suffix) {
  const now = "2026-08-06T04:00:00.000Z";
  const accountId = `account_m1_04_stack_${suffix}`;
  const workerSub = `worker:m1-04-stack-${suffix}@example.com`;
  const workerId = `HSE-WRK-M104-${suffix.toUpperCase()}`;
  const sessionId = `session_m1_04_stack_${suffix}`;

  await database.query(
    `INSERT INTO worker_profiles (
       worker_sub, worker_id, schema_version, version, status,
       profile_document, created_at, updated_at, submitted_at
     ) VALUES ($1, $2, 1, 1, 'draft', $3::jsonb, $4, $4, NULL)`,
    [
      workerSub,
      workerId,
      JSON.stringify({
        schemaVersion: 1,
        workerSub,
        workerId,
        version: 1,
        status: "draft",
        audit: []
      }),
      now
    ]
  );
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
    [
      accountId,
      `m1-04-stack-${suffix}@example.com`,
      `M1.04 Stack ${suffix}`,
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
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'worker', $3, $4, $5, $5, $6)`,
    [
      sessionId,
      accountId,
      `m1-04-stack-token-${suffix}`,
      `m1-04-stack-csrf-${suffix}`,
      now,
      "2099-01-01T00:00:00.000Z"
    ]
  );

  return { accountId, workerSub, workerId, sessionId };
}

async function assertBaseData(database, base) {
  const profile = await database.query(
    `SELECT worker_id, version FROM worker_profiles WHERE worker_sub = $1`,
    [base.workerSub]
  );
  assert.equal(profile.rows.length, 1);
  assert.equal(profile.rows[0].worker_id, base.workerId);
  assert.equal(Number(profile.rows[0].version), 1);

  const account = await database.query(
    `SELECT account_status FROM auth_accounts WHERE account_id = $1`,
    [base.accountId]
  );
  assert.equal(account.rows[0]?.account_status, "active");

  const session = await database.query(
    `SELECT active_role, revoked_at FROM auth_sessions WHERE session_id = $1`,
    [base.sessionId]
  );
  assert.equal(session.rows[0]?.active_role, "worker");
  assert.equal(session.rows[0]?.revoked_at, null);
}

async function assertMigrationStatus(database, appliedIds) {
  const status = await migrationStatus(database);
  assert.deepEqual(
    status.map((entry) => entry.id),
    COMPLETE_MIGRATIONS
  );
  for (const entry of status) {
    assert.equal(entry.checksumMatches, true, `${entry.id} checksum mismatch`);
    assert.equal(
      entry.applied,
      appliedIds.includes(entry.id),
      `${entry.id} applied state`
    );
  }
}

async function exerciseM1_04Stack(database, env, suffix) {
  assert.deepEqual(
    await applyPendingMigrations(database, env.releaseSha),
    COMPLETE_MIGRATIONS
  );
  assert.deepEqual(await applyPendingMigrations(database, env.releaseSha), []);
  await assertMigrationStatus(database, COMPLETE_MIGRATIONS);

  const base = await seedAcceptedBaseData(database, suffix);
  const tenant = await bootstrapCompanyScopeTenant(database, {
    character: suffix.toUpperCase().slice(0, 1)
  });
  await insertCompanyScopeDemonstrationRecord(database, {
    character: suffix.toUpperCase().slice(0, 1),
    context: tenant,
    recordKey: `m1-04-stack-${suffix}`,
    title: `M1.04 stack ${suffix}`
  });

  assert.equal(
    await tableExists(database, "authorization_tenant_scope_fixtures"),
    true
  );
  assert.equal(await tableExists(database, "platform_tenants"), true);
  assert.equal(await tableExists(database, "platform_audit_events"), true);
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
    await assertBaseData(database, base);
    await assertMigrationStatus(database, [
      ...BASE_MIGRATIONS,
      ...M1_04_MIGRATIONS,
      AUDIT_MIGRATION,
      OUTBOX_MIGRATION
    ]);

    assert.equal(
      await rollbackLatestMigration(database, env),
      OUTBOX_MIGRATION
    );
    assert.equal(await tableExists(database, "platform_outbox_jobs"), false);
    assert.equal(await tableExists(database, "platform_audit_events"), true);
    assert.equal(
      await tableExists(database, "authorization_tenant_scope_fixtures"),
      true
    );
    await assertBaseData(database, base);
    await assertMigrationStatus(database, [
      ...BASE_MIGRATIONS,
      ...M1_04_MIGRATIONS,
      AUDIT_MIGRATION
    ]);

    assert.equal(
      await rollbackLatestMigration(database, env),
      AUDIT_MIGRATION
    );
    assert.equal(await tableExists(database, "platform_audit_events"), false);
    assert.equal(
      await tableExists(database, "authorization_tenant_scope_fixtures"),
      true
    );
    await assertBaseData(database, base);
    await assertMigrationStatus(database, [
      ...BASE_MIGRATIONS,
      ...M1_04_MIGRATIONS
    ]);

    assert.equal(
      await rollbackLatestMigration(database, env),
      "0006_authorization_tenant_scope_fixture"
    );
    assert.equal(
      await tableExists(database, "authorization_tenant_scope_fixtures"),
      false
    );
    assert.equal(await tableExists(database, "platform_tenants"), true);
    await assertBaseData(database, base);
    await assertMigrationStatus(database, [...BASE_MIGRATIONS, M1_04_MIGRATIONS[0]]);

    assert.equal(
      await rollbackLatestMigration(database, env),
      "0005_authorization_tenant_isolation"
    );
    assert.equal(await tableExists(database, "platform_tenants"), false);
    assert.equal(await tableExists(database, "auth_tenant_memberships"), false);
    await assertBaseData(database, base);
    await assertMigrationStatus(database, BASE_MIGRATIONS);

    const m104Index = COMPLETE_MIGRATIONS.indexOf(
      M1_04_MIGRATIONS[0]
    );
    assert.ok(m104Index >= 0);
    assert.deepEqual(
      await applyPendingMigrations(database, `${env.releaseSha}-reapply`),
      COMPLETE_MIGRATIONS.slice(m104Index)
    );
    assert.deepEqual(
      await applyPendingMigrations(database, `${env.releaseSha}-reapply`),
      []
    );
    await assertMigrationStatus(database, COMPLETE_MIGRATIONS);
    await assertBaseData(database, base);
    assert.equal(await tableExists(database, "platform_tenants"), true);
    assert.equal(
      await tableExists(database, "authorization_tenant_scope_fixtures"),
      true
    );
    assert.equal(await tableExists(database, "platform_audit_events"), true);
    assert.equal(await tableExists(database, "platform_outbox_jobs"), true);
    assert.equal(await tableExists(database, "platform_notifications"), true);
  } finally {
    if (original === undefined) {
      delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    } else {
      process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = original;
    }
  }

  return base;
}

test("complete M1.04 migration stack rolls back and reapplies on disposable PGlite without touching M1.01-M1.03 data", async () => {
  const env = environment("memory://", "m1-04-disposable-stack");
  const database = await openScriptDatabase(env);
  try {
    await exerciseM1_04Stack(database, env, "j");
  } finally {
    await database.close();
  }
});

test("complete M1.04 migration stack remains deterministic after persistent PGlite close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-m1-04-stack-"));
  const env = environment(directory, "m1-04-persistent-stack");
  let database = await openScriptDatabase(env);
  try {
    const base = await exerciseM1_04Stack(database, env, "k");
    await database.close();
    database = null;

    const reopened = await openScriptDatabase(env);
    try {
      await assertMigrationStatus(reopened, COMPLETE_MIGRATIONS);
      await assertBaseData(reopened, base);
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
