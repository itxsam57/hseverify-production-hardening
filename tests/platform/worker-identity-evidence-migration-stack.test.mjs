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

const runtime = process.env.HSE_WORKER_IDENTITY_EVIDENCE_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_IDENTITY_EVIDENCE_RUNTIME_DIST is required");

const identityRepositoryModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-repository.js")).href
);
const draftRepositoryModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-draft-repository.js")).href
);
const evidenceRepositoryModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-evidence-repository.js")).href
);
const { DatabaseWorkerIdentityRepository } = identityRepositoryModule;
const { DatabaseWorkerIdentityDraftRepository } = draftRepositoryModule;
const { DatabaseWorkerIdentityEvidenceRepository } = evidenceRepositoryModule;

const BINDING_MIGRATION = "0017_worker_identity_evidence_binding";
const FREEZE_MIGRATION = "0018_worker_identity_evidence_freeze_guard";
const PREVIOUS_MIGRATION = "0016_worker_identity_draft_details";
const NOW = "2026-08-10T12:00:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
let fileCounter = 1000;

function environment(pgliteDataDir, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir,
    releaseSha,
    sessionSecret: "worker-identity-evidence-migration-session-secret-32-characters",
    authPepper: "worker-identity-evidence-migration-auth-pepper-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

function token24(value) {
  return value.replace(/[^A-Za-z0-9_-]/g, "x").padEnd(24, "x").slice(0, 24);
}

function hex64(value) {
  return value.toString(16).padStart(64, "0").slice(-64);
}

async function seedWorker(database, suffix) {
  const accountId = `account_identity_evidence_migration_${suffix}`;
  const sessionId = `session_identity_evidence_migration_${suffix}`;
  const email = `identity-evidence-migration-${suffix}@example.com`;
  const phone = suffix === "persistent" ? "+966511110002" : "+966511110001";
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, phone_e164, display_name, account_status,
       email_verified_at, phone_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'active', $5, $5, $5, $5)`,
    [accountId, email, phone, `Evidence Migration ${suffix}`, NOW]
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
      `identity_evidence_migration_token_${suffix}`,
      `identity_evidence_migration_csrf_${suffix}`,
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
    displayName: `Evidence Migration ${suffix}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE
  };
}

async function seedAvailableFile(database, principal, label, mime) {
  fileCounter += 1;
  const fileId = `secure_file_${token24(`${label}${fileCounter}`)}`;
  const extension = mime === "application/pdf" ? "pdf" : "jpg";
  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, $3, 'worker', NULL, NULL, 'local_test', $4, $5)`,
    [
      fileId,
      hex64(fileCounter * 10 + 1),
      principal.accountId,
      `secure-files/${hex64(fileCounter * 10 + 2)}`,
      `${label}.${extension}`
    ]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'quarantined',
         file_extension = $2,
         declared_mime = $3,
         detected_mime = $3,
         byte_size = 256,
         content_sha256 = $4
     WHERE file_id = $1`,
    [fileId, extension, mime, hex64(fileCounter * 10 + 3)]
  );

  const scanJobId = `job_${token24(`evidence-migration-${fileCounter}`)}`;
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, 'secure_file.scan', 1, $2, $3::jsonb,
               $4, 'worker', NULL, NULL)`,
    [
      scanJobId,
      hex64(fileCounter * 10 + 4),
      JSON.stringify({ fileRef: fileId, generation: 1 }),
      principal.accountId
    ]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'scan_pending',
         scan_generation = 1,
         scan_job_id = $2
     WHERE file_id = $1`,
    [fileId, scanJobId]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'available',
         scan_result_code = 'clean'
     WHERE file_id = $1`,
    [fileId]
  );
  return fileId;
}

function completeDraft() {
  return {
    legalFirstName: "Migration",
    legalLastName: "Worker",
    previousLegalName: null,
    dateOfBirth: "1990-01-02",
    nationality: "Pakistani",
    countryOfResidence: "Saudi Arabia"
  };
}

function documentInput(fileId) {
  return {
    purpose: "identity_document",
    secureFileId: fileId,
    documentType: "passport",
    documentNumber: "MIG-123456",
    issueDate: "2024-01-01",
    expiryDate: "2034-01-01"
  };
}

function imageInput(purpose, fileId) {
  return {
    purpose,
    secureFileId: fileId,
    documentType: null,
    documentNumber: null,
    issueDate: null,
    expiryDate: null
  };
}

async function statusThrough(database) {
  const status = await migrationStatus(database);
  const index = status.findIndex((entry) => entry.id === FREEZE_MIGRATION);
  assert.ok(index >= 0);
  return status.slice(0, index + 1);
}

async function exercise(database, env, suffix) {
  const manifest = (await listMigrations()).map((migration) => migration.id);
  const bindingIndex = manifest.indexOf(BINDING_MIGRATION);
  const freezeIndex = manifest.indexOf(FREEZE_MIGRATION);
  assert.ok(bindingIndex > 0 && freezeIndex === bindingIndex + 1);
  assert.equal(manifest[bindingIndex - 1], PREVIOUS_MIGRATION);

  await applyMigrationsThrough(database, env.releaseSha, FREEZE_MIGRATION);
  assert.deepEqual(
    await applyMigrationsThrough(database, `${env.releaseSha}-noop`, FREEZE_MIGRATION),
    []
  );

  const principal = await seedWorker(database, suffix);
  const identityRepository = new DatabaseWorkerIdentityRepository(Promise.resolve(database));
  const draftRepository = new DatabaseWorkerIdentityDraftRepository(Promise.resolve(database));
  const evidenceRepository = new DatabaseWorkerIdentityEvidenceRepository(Promise.resolve(database));
  const snapshot = await identityRepository.ensureOwnDraft(principal);
  await draftRepository.saveOwn(principal, completeDraft(), null);

  const documentFile = await seedAvailableFile(database, principal, `${suffix}-doc`, "application/pdf");
  const photoFile = await seedAvailableFile(database, principal, `${suffix}-photo`, "image/jpeg");
  const selfieFile = await seedAvailableFile(database, principal, `${suffix}-selfie`, "image/jpeg");
  await evidenceRepository.bindOwn(principal, documentInput(documentFile), null);
  await evidenceRepository.bindOwn(principal, imageInput("profile_photo", photoFile), null);
  await evidenceRepository.bindOwn(principal, imageInput("selfie", selfieFile), null);
  const submitted = await identityRepository.submitOwn(
    principal,
    snapshot.identity.lockVersion
  );
  assert.equal(submitted.identity.lifecycleStatus, "submitted");

  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  try {
    assert.equal(await rollbackLatestMigration(database, env), FREEZE_MIGRATION);
    assert.equal(await rollbackLatestMigration(database, env), BINDING_MIGRATION);

    const retained = await database.query(
      `SELECT purpose, binding_status, secure_file_id
       FROM worker_identity_evidence_bindings
       WHERE identity_version_id = $1
       ORDER BY purpose`,
      [snapshot.currentVersion.identityVersionId]
    );
    assert.equal(retained.rows.length, 3);
    assert.equal(retained.rows.every((row) => row.binding_status === "active"), true);

    const rolledBackStatus = await statusThrough(database);
    assert.equal(
      rolledBackStatus.find((entry) => entry.id === BINDING_MIGRATION)?.applied,
      false
    );
    assert.equal(
      rolledBackStatus.find((entry) => entry.id === FREEZE_MIGRATION)?.applied,
      false
    );
    assert.equal(rolledBackStatus.every((entry) => entry.checksumMatches), true);

    assert.deepEqual(
      await applyMigrationsThrough(
        database,
        `${env.releaseSha}-reapply`,
        FREEZE_MIGRATION
      ),
      [BINDING_MIGRATION, FREEZE_MIGRATION]
    );
    const finalStatus = await statusThrough(database);
    assert.equal(finalStatus.every((entry) => entry.applied && entry.checksumMatches), true);
    return { principal, submitted, snapshot };
  } finally {
    if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
  }
}

test("S3 evidence migrations roll back logically, preserve history and reapply deterministically", async () => {
  const env = environment("memory://", "worker-identity-evidence-migration-memory");
  const database = await openScriptDatabase(env);
  try {
    await exercise(database, env, "memory");
  } finally {
    await database.close();
  }
});

test("S3 evidence bindings and submitted identity survive PGlite close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-worker-identity-evidence-"));
  const env = environment(directory, "worker-identity-evidence-migration-persistent");
  let database = await openScriptDatabase(env);
  try {
    const accepted = await exercise(database, env, "persistent");
    await database.close();
    database = null;

    const reopened = await openScriptDatabase(env);
    try {
      const identityRepository = new DatabaseWorkerIdentityRepository(Promise.resolve(reopened));
      const evidenceRepository = new DatabaseWorkerIdentityEvidenceRepository(Promise.resolve(reopened));
      const identity = await identityRepository.loadOwn(accepted.principal);
      const evidence = await evidenceRepository.listOwn(accepted.principal);
      assert.equal(identity?.identity.identityId, accepted.submitted.identity.identityId);
      assert.equal(identity?.identity.lifecycleStatus, "submitted");
      assert.equal(evidence.length, 3);
      assert.deepEqual(
        evidence.map((item) => item.purpose).sort(),
        ["identity_document", "profile_photo", "selfie"]
      );
      const status = await statusThrough(reopened);
      assert.equal(status.every((entry) => entry.applied && entry.checksumMatches), true);
    } finally {
      await reopened.close();
    }
  } finally {
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});
