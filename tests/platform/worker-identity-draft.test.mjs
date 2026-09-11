import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
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

const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const NOW = "2026-08-10T10:00:00.000Z";
const S2_MIGRATION = "0016_worker_identity_draft_details";

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "worker-identity-draft-session-secret-32-characters",
    authPepper: "worker-identity-draft-auth-pepper-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function applyS2(database, releaseSha) {
  await applyMigrationsThrough(database, releaseSha, S2_MIGRATION);
}

async function seedPrincipal(
  database,
  suffix,
  { role = "worker", phone = `+9665000${suffix.padStart(4, "0").slice(-4)}`, accountStatus = "active" } = {}
) {
  const accountId = `account_identity_draft_${suffix}`;
  const sessionId = `session_identity_draft_${suffix}`;
  const email = `identity-draft-${suffix}@example.com`;
  const phoneVerifiedAt = phone ? NOW : null;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, phone_e164, display_name, account_status,
       email_verified_at, phone_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $6)`,
    [accountId, email, phone, `Identity Draft ${suffix}`, accountStatus, NOW, phoneVerifiedAt]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, $2, $3)`,
    [accountId, role, NOW]
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
      `identity_draft_token_${suffix}`,
      `identity_draft_csrf_${suffix}`,
      NOW,
      FAR_FUTURE
    ]
  );
  return {
    accountId,
    sessionId,
    activeRole: role,
    tenantMembership: null,
    accountStatus,
    email,
    displayName: `Identity Draft ${suffix}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE,
    phone
  };
}

function completeInput(firstName = "Sam") {
  return {
    legalFirstName: firstName,
    legalLastName: "Khan",
    previousLegalName: null,
    dateOfBirth: "1995-02-03",
    nationality: "Pakistani",
    countryOfResidence: "Saudi Arabia"
  };
}

function emptyInput() {
  return {
    legalFirstName: null,
    legalLastName: null,
    previousLegalName: null,
    dateOfBirth: null,
    nationality: null,
    countryOfResidence: null
  };
}

function isNamed(name) {
  return (error) => error?.name === name;
}

test("draft saves bind verified contacts only from authentication authority and refresh them on later saves", async () => {
  const database = await openScriptDatabase(environment("identity-draft-contact-binding"));
  try {
    await applyS2(database, "identity-draft-contact-binding");
    const worker = await seedPrincipal(database, "contact1");
    const identityRepository = new DatabaseWorkerIdentityRepository(Promise.resolve(database));
    const draftRepository = new DatabaseWorkerIdentityDraftRepository(Promise.resolve(database));
    const identity = await identityRepository.ensureOwnDraft(worker);

    const first = await draftRepository.saveOwn(worker, emptyInput(), null);
    assert.equal(first.identityVersionId, identity.currentVersion.identityVersionId);
    assert.equal(first.draftRevision, 1);
    assert.equal(first.legalFirstName, null);
    assert.equal(first.verifiedContacts.emailNormalized, worker.email);
    assert.equal(first.verifiedContacts.phoneE164, worker.phone);
    assert.equal(first.verifiedContacts.emailVerifiedAt, NOW);
    assert.equal(first.verifiedContacts.phoneVerifiedAt, NOW);

    const updatedEmail = "identity-draft-contact1-updated@example.com";
    const updatedPhone = "+966599990001";
    const updatedVerifiedAt = "2026-08-10T11:00:00.000Z";
    await database.query(
      `UPDATE auth_accounts
       SET email_normalized = $1,
           phone_e164 = $2,
           email_verified_at = $3,
           phone_verified_at = $3,
           updated_at = $3
       WHERE account_id = $4`,
      [updatedEmail, updatedPhone, updatedVerifiedAt, worker.accountId]
    );

    const second = await draftRepository.saveOwn(worker, completeInput(), 1);
    assert.equal(second.draftRevision, 2);
    assert.equal(second.legalFirstName, "Sam");
    assert.equal(second.verifiedContacts.emailNormalized, updatedEmail);
    assert.equal(second.verifiedContacts.phoneE164, updatedPhone);
    assert.equal(second.verifiedContacts.emailVerifiedAt, updatedVerifiedAt);
    assert.equal(second.verifiedContacts.phoneVerifiedAt, updatedVerifiedAt);

    await database.query(
      `UPDATE worker_identity_version_drafts
       SET draft_revision = 3,
           verified_email_normalized = 'forged@example.com',
           verified_phone_e164 = '+10000000000'
       WHERE identity_version_id = $1`,
      [second.identityVersionId]
    );
    const forged = await database.query(
      `SELECT draft_revision, verified_email_normalized, verified_phone_e164
       FROM worker_identity_version_drafts WHERE identity_version_id = $1`,
      [second.identityVersionId]
    );
    assert.equal(Number(forged.rows[0].draft_revision), 3);
    assert.equal(forged.rows[0].verified_email_normalized, updatedEmail);
    assert.equal(forged.rows[0].verified_phone_e164, updatedPhone);

    const submitted = await identityRepository.submitOwn(worker, identity.identity.lockVersion);
    assert.equal(submitted.identity.lifecycleStatus, "submitted");
    assert.equal(submitted.currentVersion.versionStatus, "submitted");

    await assert.rejects(
      () => database.query(
        `UPDATE worker_identity_version_drafts
         SET draft_revision = 4
         WHERE identity_version_id = $1`,
        [second.identityVersionId]
      ),
      /current editable Worker version/
    );

    const audit = await database.query(
      `SELECT action_key FROM platform_audit_events
       WHERE target_reference = $1 ORDER BY audit_sequence`,
      [identity.identity.identityId]
    );
    assert.deepEqual(
      audit.rows.map((row) => row.action_key),
      ["worker_identity.created", "worker_identity.status.changed"],
      "ordinary partial draft saves must not create immutable audit spam"
    );
  } finally {
    await database.close();
  }
});

test("draft persistence denies missing mandatory contact verification, other roles, revoked sessions and cross-account reads", async () => {
  const database = await openScriptDatabase(environment("identity-draft-isolation"));
  try {
    await applyS2(database, "identity-draft-isolation");
    const workerA = await seedPrincipal(database, "isola");
    const workerB = await seedPrincipal(database, "isolb");
    const noPhone = await seedPrincipal(database, "nophone", { phone: null });
    const company = await seedPrincipal(database, "company", { role: "company" });
    const identityRepository = new DatabaseWorkerIdentityRepository(Promise.resolve(database));
    const draftRepository = new DatabaseWorkerIdentityDraftRepository(Promise.resolve(database));

    await identityRepository.ensureOwnDraft(workerA);
    await draftRepository.saveOwn(workerA, completeInput("Worker A"), null);
    await identityRepository.ensureOwnDraft(workerB);
    assert.equal(await draftRepository.loadOwn(workerB), null);

    await assert.rejects(
      () => draftRepository.loadOwn(company),
      isNamed("WorkerIdentityAccessDeniedError")
    );

    await identityRepository.ensureOwnDraft(noPhone);
    await assert.rejects(
      () => draftRepository.saveOwn(noPhone, completeInput(), null),
      isNamed("WorkerIdentityContactVerificationRequiredError")
    );
    const noPhoneIdentity = await identityRepository.loadOwn(noPhone);
    await assert.rejects(
      () => database.query(
        `INSERT INTO worker_identity_version_drafts (
           identity_version_id, draft_revision, legal_first_name,
           verified_email_normalized, email_verified_at,
           verified_phone_e164, phone_verified_at
         ) VALUES ($1, 1, 'Forged', 'forged@example.com', CURRENT_TIMESTAMP,
                   '+10000000000', CURRENT_TIMESTAMP)`,
        [noPhoneIdentity.currentVersion.identityVersionId]
      ),
      /requires verified email and phone contacts/
    );

    await database.query(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP,
           revocation_reason = 'identity_draft_test'
       WHERE session_id = $1`,
      [workerA.sessionId]
    );
    await assert.rejects(
      () => draftRepository.loadOwn(workerA),
      isNamed("WorkerIdentityAccessDeniedError")
    );
  } finally {
    await database.close();
  }
});

test("draft optimistic concurrency admits one update and submission is blocked until required facts are complete", async () => {
  const database = await openScriptDatabase(environment("identity-draft-concurrency"));
  try {
    await applyS2(database, "identity-draft-concurrency");
    const worker = await seedPrincipal(database, "concurr");
    const identityRepository = new DatabaseWorkerIdentityRepository(Promise.resolve(database));
    const repositoryA = new DatabaseWorkerIdentityDraftRepository(Promise.resolve(database));
    const repositoryB = new DatabaseWorkerIdentityDraftRepository(Promise.resolve(database));
    const identity = await identityRepository.ensureOwnDraft(worker);
    const first = await repositoryA.saveOwn(worker, emptyInput(), null);

    await assert.rejects(
      () => identityRepository.submitOwn(worker, identity.identity.lockVersion),
      /personal details and verified contacts are incomplete or stale/
    );
    const stillDraft = await identityRepository.loadOwn(worker);
    assert.equal(stillDraft.identity.lifecycleStatus, "draft");
    assert.equal(stillDraft.currentVersion.versionStatus, "draft");

    const attempts = await Promise.allSettled([
      repositoryA.saveOwn(worker, completeInput("First Winner"), first.draftRevision),
      repositoryB.saveOwn(worker, completeInput("Second Winner"), first.draftRevision)
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
    const rejected = attempts.find((result) => result.status === "rejected");
    assert.equal(rejected?.reason?.name, "WorkerIdentityConflictError");

    const finalDraft = await repositoryA.loadOwn(worker);
    assert.equal(finalDraft?.draftRevision, 2);
    assert.ok(
      finalDraft?.legalFirstName === "First Winner" ||
      finalDraft?.legalFirstName === "Second Winner"
    );

    const submitted = await identityRepository.submitOwn(worker, stillDraft.identity.lockVersion);
    assert.equal(submitted.identity.lifecycleStatus, "submitted");
    assert.equal(submitted.currentVersion.versionStatus, "submitted");

    await assert.rejects(
      () => repositoryA.saveOwn(worker, completeInput("Late Edit"), 2),
      isNamed("WorkerIdentityConflictError")
    );
  } finally {
    await database.close();
  }
});
