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

const runtime = process.env.HSE_WORKER_IDENTITY_DRAFT_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_IDENTITY_DRAFT_RUNTIME_DIST is required");
const identityRepositoryModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-repository.js")).href
);
const draftRepositoryModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-draft-repository.js")).href
);
const { DatabaseWorkerIdentityRepository } = identityRepositoryModule;
const { DatabaseWorkerIdentityDraftRepository } = draftRepositoryModule;

const OWNED_MIGRATION = "0016_worker_identity_draft_details";
const PREVIOUS_MIGRATION = "0015_worker_identity_foundation";
const NOW = "2026-08-10T12:00:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

function environment(pgliteDataDir, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir,
    releaseSha,
    sessionSecret: "worker-identity-draft-migration-session-secret-32-characters",
    authPepper: "worker-identity-draft-migration-auth-pepper-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function seedWorker(database, suffix) {
  const accountId = `account_identity_draft_migration_${suffix}`;
  const sessionId = `session_identity_draft_migration_${suffix}`;
  const email = `identity-draft-migration-${suffix}@example.com`;
  const phone = `+96651111${suffix === "persistent" ? "002" : "001"}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, phone_e164, display_name, account_status,
       email_verified_at, phone_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'active', $5, $5, $5, $5)`,
    [accountId, email, phone, `Identity Draft Migration ${suffix}`, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'worker', $3, $4, $5, $5, $6)`,
    [
      sessionId,
      accountId,
      `identity_draft_migration_token_${suffix}`,
      `identity_draft_migration_csrf_${suffix}`,
      NOW,
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
    displayName: `Identity Draft Migration ${suffix}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE
  };
}

function completeInput() {
  return {
    legalFirstName: "Migration",
    legalLastName: "Worker",
    previousLegalName: null,
    dateOfBirth: "1990-01-02",
    nationality: "Pakistani",
    countryOfResidence: "Saudi Arabia"
  };
}

function assertS2Status(status, ownedIndex) {
  assert.equal(
    status.slice(0, ownedIndex + 1).every((entry) => entry.applied && entry.checksumMatches),
    true
  );
  assert.equal(
    status.slice(ownedIndex + 1).every((entry) => !entry.applied),
    true,
    "S2 layer test must not silently apply later identity migrations"
  );
}

async function exercise(database, env, suffix) {
  const allIds = (await listMigrations()).map((migration) => migration.id);
  const ownedIndex = allIds.indexOf(OWNED_MIGRATION);
  assert.ok(ownedIndex > 0, "Worker identity draft migration must be registered");
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
  const identityRepository = new DatabaseWorkerIdentityRepository(Promise.resolve(database));
  const draftRepository = new DatabaseWorkerIdentityDraftRepository(Promise.resolve(database));
  const identity = await identityRepository.ensureOwnDraft(principal);
  const details = await draftRepository.saveOwn(principal, completeInput(), null);
  const submitted = await identityRepository.submitOwn(principal, identity.identity.lockVersion);
  assert.equal(submitted.identity.lifecycleStatus, "submitted");
  assert.equal(details.draftRevision, 1);

  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  try {
    assert.equal(await rollbackLatestMigration(database, env), OWNED_MIGRATION);

    const retained = await database.query(
      `SELECT draft_revision, legal_first_name, verified_email_normalized,
              verified_phone_e164
       FROM worker_identity_version_drafts
       WHERE identity_version_id = $1`,
      [details.identityVersionId]
    );
    assert.equal(retained.rows.length, 1);
    assert.equal(Number(retained.rows[0].draft_revision), 1);
    assert.equal(retained.rows[0].legal_first_name, "Migration");
    assert.equal(retained.rows[0].verified_email_normalized, principal.email);
    assert.ok(retained.rows[0].verified_phone_e164);

    const statusAfterRollback = await migrationStatus(database);
    const owned = statusAfterRollback.find((entry) => entry.id === OWNED_MIGRATION);
    assert.equal(owned?.applied, false);
    assert.equal(statusAfterRollback.every((entry) => entry.checksumMatches), true);

    assert.deepEqual(
      await applyMigrationsThrough(database, `${env.releaseSha}-reapply`, OWNED_MIGRATION),
      [OWNED_MIGRATION]
    );
    const finalStatus = await migrationStatus(database);
    assertS2Status(finalStatus, ownedIndex);
    assert.deepEqual(
      await applyMigrationsThrough(database, `${env.releaseSha}-reapply-noop`, OWNED_MIGRATION),
      []
    );
    return { principal, submitted, details, ownedIndex };
  } finally {
    if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
  }
}

test("Worker identity draft rollback is monotonic and deterministic", async () => {
  const env = environment("memory://", "worker-identity-draft-migration-memory");
  const database = await openScriptDatabase(env);
  try {
    await exercise(database, env, "memory");
  } finally {
    await database.close();
  }
});

test("identity details and verified contact snapshot survive PGlite close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-worker-identity-draft-"));
  const env = environment(directory, "worker-identity-draft-migration-persistent");
  let database = await openScriptDatabase(env);
  try {
    const accepted = await exercise(database, env, "persistent");
    await database.close();
    database = null;

    const reopened = await openScriptDatabase(env);
    try {
      const identityRepository = new DatabaseWorkerIdentityRepository(Promise.resolve(reopened));
      const draftRepository = new DatabaseWorkerIdentityDraftRepository(Promise.resolve(reopened));
      const identity = await identityRepository.loadOwn(accepted.principal);
      const details = await draftRepository.loadOwn(accepted.principal);
      assert.equal(identity?.identity.identityId, accepted.submitted.identity.identityId);
      assert.equal(identity?.identity.lifecycleStatus, "submitted");
      assert.equal(details?.identityVersionId, accepted.details.identityVersionId);
      assert.equal(details?.draftRevision, 1);
      assert.equal(details?.legalFirstName, "Migration");
      assert.equal(details?.verifiedContacts.emailNormalized, accepted.principal.email);
      const status = await migrationStatus(reopened);
      assertS2Status(status, accepted.ownedIndex);
    } finally {
      await reopened.close();
    }
  } finally {
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});
