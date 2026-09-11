import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_WORKER_IDENTITY_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_IDENTITY_RUNTIME_DIST is required");
const repositoryModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-repository.js")).href
);

const { DatabaseWorkerIdentityRepository } = repositoryModule;
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const S1_MIGRATION = "0015_worker_identity_foundation";

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "worker-identity-foundation-session-secret-32-characters",
    authPepper: "worker-identity-foundation-auth-pepper-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function seedPrincipal(database, suffix, role = "worker") {
  const accountId = `account_identity_${suffix}`;
  const sessionId = `session_identity_${suffix}`;
  const email = `identity-${suffix}@example.com`;
  const now = "2026-08-10T05:00:00.000Z";
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, email, `Identity ${suffix}`, now]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, $2, $3)`,
    [accountId, role, now]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
    [
      sessionId,
      accountId,
      role,
      `token_hash_${suffix}`,
      `csrf_hash_${suffix}`,
      now,
      FAR_FUTURE
    ]
  );
  return {
    accountId,
    sessionId,
    activeRole: role,
    tenantMembership: null,
    accountStatus: "active",
    email,
    displayName: `Identity ${suffix}`,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: FAR_FUTURE
  };
}

function isNamed(name) {
  return (error) => error?.name === name;
}

async function applyS1(database, releaseSha) {
  await applyMigrationsThrough(database, releaseSha, S1_MIGRATION);
}

test("Worker identity reserve/submit/withdraw is idempotent, immutable and atomically audited", async () => {
  const database = await openScriptDatabase(environment("identity-foundation-lifecycle"));
  try {
    await applyS1(database, "identity-foundation-lifecycle");
    const principal = await seedPrincipal(database, "lifecycle");
    const repository = new DatabaseWorkerIdentityRepository(Promise.resolve(database));

    const first = await repository.ensureOwnDraft(principal);
    const replay = await repository.ensureOwnDraft(principal);
    assert.equal(replay.identity.identityId, first.identity.identityId);
    assert.equal(replay.currentVersion.identityVersionId, first.currentVersion.identityVersionId);
    assert.equal(first.identity.lifecycleStatus, "draft");
    assert.equal(first.identity.lockVersion, 1);
    assert.equal(first.currentVersion.versionStatus, "draft");
    assert.equal(first.currentVersion.versionKind, "initial");
    assert.equal(first.currentVersion.versionNumber, 1);
    assert.equal(first.currentVersion.parentVersionId, null);

    assert.equal(
      Number((await database.query(
        "SELECT COUNT(*) AS count FROM worker_identities WHERE worker_account_id = $1",
        [principal.accountId]
      )).rows[0].count),
      1
    );
    assert.equal(
      Number((await database.query(
        "SELECT COUNT(*) AS count FROM worker_identity_versions WHERE identity_id = $1",
        [first.identity.identityId]
      )).rows[0].count),
      1
    );
    assert.equal(
      Number((await database.query(
        `SELECT COUNT(*) AS count FROM platform_audit_events
         WHERE action_key = 'worker_identity.created'
           AND target_type = 'worker_identity'
           AND target_reference = $1`,
        [first.identity.identityId]
      )).rows[0].count),
      1,
      "draft replay must not duplicate creation audit facts"
    );

    const submitted = await repository.submitOwn(principal, 1);
    assert.equal(submitted.identity.lifecycleStatus, "submitted");
    assert.equal(submitted.identity.lockVersion, 2);
    assert.equal(submitted.currentVersion.versionStatus, "submitted");
    assert.ok(submitted.currentVersion.submittedAt);

    await assert.rejects(
      () => repository.submitOwn(principal, 1),
      isNamed("WorkerIdentityConflictError")
    );

    const withdrawn = await repository.withdrawOwn(principal, 2);
    assert.equal(withdrawn.identity.lifecycleStatus, "withdrawn");
    assert.equal(withdrawn.identity.lockVersion, 3);
    assert.equal(withdrawn.currentVersion.versionStatus, "submitted");

    const audit = await database.query(
      `SELECT action_key, actor_account_id, actor_role, actor_tenant_id,
              actor_membership_id, target_type, target_reference, metadata
       FROM platform_audit_events
       WHERE target_reference = $1
       ORDER BY audit_sequence`,
      [first.identity.identityId]
    );
    assert.deepEqual(
      audit.rows.map((row) => row.action_key),
      [
        "worker_identity.created",
        "worker_identity.status.changed",
        "worker_identity.status.changed"
      ]
    );
    for (const row of audit.rows) {
      assert.equal(row.actor_account_id, principal.accountId);
      assert.equal(row.actor_role, "worker");
      assert.equal(row.actor_tenant_id, null);
      assert.equal(row.actor_membership_id, null);
      assert.equal(row.target_type, "worker_identity");
      const serialized = JSON.stringify(row.metadata).toLowerCase();
      for (const forbidden of [
        "password",
        "token",
        "secret",
        "object_key",
        "document_number",
        "base64"
      ]) {
        assert.equal(serialized.includes(forbidden), false, forbidden);
      }
    }

    await assert.rejects(
      () => database.query(
        `UPDATE worker_identity_versions
         SET submitted_at = submitted_at
         WHERE identity_version_id = $1`,
        [submitted.currentVersion.identityVersionId]
      ),
      /Submitted Worker identity versions are immutable/
    );
    await assert.rejects(
      () => database.query(
        "DELETE FROM worker_identities WHERE identity_id = $1",
        [first.identity.identityId]
      ),
      /Worker identity history is immutable and cannot be deleted/
    );
  } finally {
    await database.close();
  }
});

test("Worker identity repository revalidates live Worker authority and never crosses accounts or roles", async () => {
  const database = await openScriptDatabase(environment("identity-foundation-isolation"));
  try {
    await applyS1(database, "identity-foundation-isolation");
    const workerA = await seedPrincipal(database, "worker_a");
    const workerB = await seedPrincipal(database, "worker_b");
    const company = await seedPrincipal(database, "company", "company");
    const repository = new DatabaseWorkerIdentityRepository(Promise.resolve(database));

    const identityA = await repository.ensureOwnDraft(workerA);
    assert.equal(await repository.loadOwn(workerB), null);
    const identityB = await repository.ensureOwnDraft(workerB);
    assert.notEqual(identityB.identity.identityId, identityA.identity.identityId);

    await assert.rejects(
      () => repository.loadOwn(company),
      isNamed("WorkerIdentityAccessDeniedError")
    );

    await database.query(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP,
           revocation_reason = 'identity_test'
       WHERE session_id = $1`,
      [workerA.sessionId]
    );
    await assert.rejects(
      () => repository.loadOwn(workerA),
      isNamed("WorkerIdentityAccessDeniedError")
    );

    await database.query(
      `UPDATE auth_accounts
       SET account_status = 'locked',
           locked_until = '2099-01-01T00:00:00.000Z'
       WHERE account_id = $1`,
      [workerB.accountId]
    );
    await assert.rejects(
      () => repository.loadOwn(workerB),
      isNamed("WorkerIdentityAccessDeniedError")
    );
  } finally {
    await database.close();
  }
});

test("optimistic concurrency admits one submit and database guards reject bypass transitions and premature correction lineage", async () => {
  const database = await openScriptDatabase(environment("identity-foundation-concurrency"));
  try {
    await applyS1(database, "identity-foundation-concurrency");
    const worker = await seedPrincipal(database, "concurrent");
    const repositoryA = new DatabaseWorkerIdentityRepository(Promise.resolve(database));
    const repositoryB = new DatabaseWorkerIdentityRepository(Promise.resolve(database));
    const draft = await repositoryA.ensureOwnDraft(worker);

    const attempts = await Promise.allSettled([
      repositoryA.submitOwn(worker, 1),
      repositoryB.submitOwn(worker, 1)
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
    const rejected = attempts.find((result) => result.status === "rejected");
    assert.equal(rejected?.reason?.name, "WorkerIdentityConflictError");

    const final = await repositoryA.loadOwn(worker);
    assert.equal(final?.identity.lifecycleStatus, "submitted");
    assert.equal(final?.identity.lockVersion, 2);
    assert.equal(
      Number((await database.query(
        `SELECT COUNT(*) AS count FROM platform_audit_events
         WHERE target_reference = $1
           AND action_key = 'worker_identity.status.changed'`,
        [draft.identity.identityId]
      )).rows[0].count),
      1
    );

    const bypassWorker = await seedPrincipal(database, "bypass");
    const bypassDraft = await repositoryA.ensureOwnDraft(bypassWorker);
    await assert.rejects(
      () => database.query(
        `UPDATE worker_identities
         SET lifecycle_status = 'verified', lock_version = lock_version + 1
         WHERE identity_id = $1`,
        [bypassDraft.identity.identityId]
      ),
      /Worker identity lifecycle transition is invalid/
    );

    await assert.rejects(
      () => database.query(
        `INSERT INTO worker_identity_versions (
           identity_version_id, identity_id, version_number,
           parent_version_id, version_kind, version_status,
           created_by_account_id
         ) VALUES ($1, $2, 2, $3, 'correction', 'draft', $4)`,
        [
          "identity_version_AAAAAAAAAAAAAAAAAAAAAAAA",
          draft.identity.identityId,
          final.currentVersion.identityVersionId,
          worker.accountId
        ]
      ),
      /Worker identity correction lineage is invalid/
    );
  } finally {
    await database.close();
  }
});
