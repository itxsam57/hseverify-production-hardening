import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import {
  listMigrations,
  migrationStatus,
  rollbackLatestMigration
} from "../../scripts/lib/migrations.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_WORKER_IDENTITY_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_IDENTITY_RUNTIME_DIST is required");
const repositoryModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-repository.js")).href
);
const { DatabaseWorkerIdentityRepository } = repositoryModule;

const OWNED_MIGRATION = "0015_worker_identity_foundation";
const PREVIOUS_MIGRATION = "0014_secure_file_signed_access_audit";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

function environment(pgliteDataDir, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir,
    releaseSha,
    sessionSecret: "worker-identity-migration-session-secret-32-characters",
    authPepper: "worker-identity-migration-auth-pepper-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function seedWorker(database, suffix) {
  const now = "2026-08-10T05:30:00.000Z";
  const accountId = `account_identity_migration_${suffix}`;
  const sessionId = `session_identity_migration_${suffix}`;
  const email = `identity-migration-${suffix}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, email, `Identity Migration ${suffix}`, now]
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
      `identity_migration_token_${suffix}`,
      `identity_migration_csrf_${suffix}`,
      now,
      FAR_FUTURE
    ]
  );
  return {
    accountId,
    sessionId,
    activeRole: "worker",
    tenantMembership: null,
    accountStatus: "active",
    email,
    displayName: `Identity Migration ${suffix}`,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: FAR_FUTURE
  };
}

function assertS1Status(status, ownedIndex) {
  assert.equal(
    status.slice(0, ownedIndex + 1).every((entry) => entry.applied && entry.checksumMatches),
    true
  );
  assert.equal(
    status.slice(ownedIndex + 1).every((entry) => !entry.applied),
    true,
    "S1 layer test must not silently apply later identity migrations"
  );
}

async function exercise(database, env, suffix) {
  const allMigrations = await listMigrations();
  const allIds = allMigrations.map((migration) => migration.id);
  const ownedIndex = allIds.indexOf(OWNED_MIGRATION);
  assert.ok(ownedIndex > 0, "Worker identity migration must be registered");
  assert.equal(allIds[ownedIndex - 1], PREVIOUS_MIGRATION);
  const manifest = allIds.slice(0, ownedIndex + 1);
  assert.deepEqual(
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION),
    manifest
  );
  assert.deepEqual(
    await applyMigrationsThrough(database, `${env.releaseSha}-noop`, OWNED_MIGRATION),
    []
  );

  const principal = await seedWorker(database, suffix);
  const repository = new DatabaseWorkerIdentityRepository(Promise.resolve(database));
  const draft = await repository.ensureOwnDraft(principal);
  const submitted = await repository.submitOwn(principal, draft.identity.lockVersion);
  assert.equal(submitted.identity.lifecycleStatus, "submitted");
  assert.equal(submitted.currentVersion.versionStatus, "submitted");

  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  try {
    assert.equal(await rollbackLatestMigration(database, env), OWNED_MIGRATION);

    const retainedIdentity = await database.query(
      `SELECT lifecycle_status, current_version_number, lock_version
       FROM worker_identities WHERE identity_id = $1`,
      [submitted.identity.identityId]
    );
    const retainedVersion = await database.query(
      `SELECT version_status, submitted_at
       FROM worker_identity_versions WHERE identity_version_id = $1`,
      [submitted.currentVersion.identityVersionId]
    );
    const retainedAudit = await database.query(
      `SELECT action_key, target_type
       FROM platform_audit_events
       WHERE target_reference = $1
       ORDER BY audit_sequence`,
      [submitted.identity.identityId]
    );
    assert.equal(retainedIdentity.rows.length, 1);
    assert.equal(retainedIdentity.rows[0].lifecycle_status, "submitted");
    assert.equal(Number(retainedIdentity.rows[0].current_version_number), 1);
    assert.equal(Number(retainedIdentity.rows[0].lock_version), 2);
    assert.equal(retainedVersion.rows.length, 1);
    assert.equal(retainedVersion.rows[0].version_status, "submitted");
    assert.ok(retainedVersion.rows[0].submitted_at);
    assert.deepEqual(
      retainedAudit.rows.map((row) => row.action_key),
      ["worker_identity.created", "worker_identity.status.changed"]
    );
    assert.equal(retainedAudit.rows.every((row) => row.target_type === "worker_identity"), true);

    const statusAfterRollback = await migrationStatus(database);
    const owned = statusAfterRollback.find((entry) => entry.id === OWNED_MIGRATION);
    assert.equal(owned?.applied, false);
    assert.equal(statusAfterRollback.every((entry) => entry.checksumMatches), true);

    assert.deepEqual(
      await applyMigrationsThrough(database, `${env.releaseSha}-reapply`, OWNED_MIGRATION),
      [OWNED_MIGRATION]
    );
    const finalStatus = await migrationStatus(database);
    assertS1Status(finalStatus, ownedIndex);
    assert.deepEqual(
      await applyMigrationsThrough(database, `${env.releaseSha}-reapply-noop`, OWNED_MIGRATION),
      []
    );
    return { principal, submitted, ownedIndex };
  } finally {
    if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
  }
}

test("Worker identity migration rollback is monotonic and deterministic in memory", async () => {
  const env = environment("memory://", "worker-identity-migration-memory");
  const database = await openScriptDatabase(env);
  try {
    await exercise(database, env, "memory");
  } finally {
    await database.close();
  }
});

test("submitted Worker identity and audit history survive PGlite close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-worker-identity-"));
  const env = environment(directory, "worker-identity-migration-persistent");
  let database = await openScriptDatabase(env);
  try {
    const accepted = await exercise(database, env, "persistent");
    await database.close();
    database = null;

    const reopened = await openScriptDatabase(env);
    try {
      const repository = new DatabaseWorkerIdentityRepository(Promise.resolve(reopened));
      const snapshot = await repository.loadOwn(accepted.principal);
      assert.equal(snapshot?.identity.identityId, accepted.submitted.identity.identityId);
      assert.equal(snapshot?.identity.lifecycleStatus, "submitted");
      assert.equal(snapshot?.identity.lockVersion, 2);
      assert.equal(snapshot?.currentVersion.versionStatus, "submitted");
      assert.equal(snapshot?.currentVersion.versionNumber, 1);
      assert.ok(snapshot?.currentVersion.submittedAt);
      const status = await migrationStatus(reopened);
      assertS1Status(status, accepted.ownedIndex);
    } finally {
      await reopened.close();
    }
  } finally {
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});
