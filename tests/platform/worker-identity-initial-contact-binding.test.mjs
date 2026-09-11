import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_WORKER_IDENTITY_CORRECTION_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_IDENTITY_CORRECTION_RUNTIME_DIST is required");

const identityModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-repository.js")).href
);
const draftModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-draft-repository.js")).href
);

const { DatabaseWorkerIdentityRepository } = identityModule;
const { DatabaseWorkerIdentityDraftRepository } = draftModule;

const OWNED_MIGRATION = "0021_worker_identity_corrections";
const NOW = "2026-08-11T00:00:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "worker-identity-contact-session-secret-32-characters",
    authPepper: "worker-identity-contact-auth-pepper-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function seedWorker(database) {
  const accountId = "account_identity_initial_contacts";
  const sessionId = "session_identity_initial_contacts";
  const email = "initial-contacts@example.com";
  const phone = "+966812345678";

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, phone_e164, display_name, account_status,
       email_verified_at, phone_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'Initial Contacts', 'active', $4, $4, $4, $4)`,
    [accountId, email, phone, NOW]
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
      "identity_initial_contacts_token_hash",
      "identity_initial_contacts_csrf_hash",
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
    displayName: "Initial Contacts",
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE,
    phone
  };
}

test("S6 initial verified contact binding exists before the first personal-detail save and is idempotent", async () => {
  const env = environment("worker-identity-initial-contact-binding");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const principal = await seedWorker(database);
    const promise = Promise.resolve(database);
    const identities = new DatabaseWorkerIdentityRepository(promise);
    const drafts = new DatabaseWorkerIdentityDraftRepository(promise);

    await identities.ensureOwnDraft(principal);

    const first = await drafts.ensureOwn(principal);
    assert.equal(first.draftRevision, 1);
    assert.equal(first.legalFirstName, null);
    assert.equal(first.legalLastName, null);
    assert.equal(first.dateOfBirth, null);
    assert.equal(first.verifiedContacts.emailNormalized, principal.email);
    assert.equal(first.verifiedContacts.phoneE164, principal.phone);

    const second = await drafts.ensureOwn(principal);
    assert.deepEqual(second, first, "reopening the initial Identity page must not create or revise the draft");

    const rows = await database.query(
      `SELECT COUNT(*)::int AS count, MIN(draft_revision)::int AS revision
       FROM worker_identity_version_drafts
       WHERE identity_version_id = $1`,
      [first.identityVersionId]
    );
    assert.equal(Number(rows.rows[0].count), 1);
    assert.equal(Number(rows.rows[0].revision), 1);
  } finally {
    await database.close();
  }
});
