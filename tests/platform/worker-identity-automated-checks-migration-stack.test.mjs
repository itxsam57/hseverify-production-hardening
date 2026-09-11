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

const runtime = process.env.HSE_WORKER_IDENTITY_CHECK_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_IDENTITY_CHECK_RUNTIME_DIST is required");

const identityRepositoryModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-repository.js")).href
);
const draftRepositoryModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-draft-repository.js")).href
);
const evidenceRepositoryModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-evidence-repository.js")).href
);
const checkRepositoryModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-check-repository.js")).href
);
const checkHandlerModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-check-handler.js")).href
);
const outboxDomainModule = await import(
  pathToFileURL(join(runtime, "outbox", "outbox-domain.js")).href
);
const outboxRepositoryModule = await import(
  pathToFileURL(join(runtime, "outbox", "outbox-repository.js")).href
);

const { DatabaseWorkerIdentityRepository } = identityRepositoryModule;
const { DatabaseWorkerIdentityDraftRepository } = draftRepositoryModule;
const { DatabaseWorkerIdentityEvidenceRepository } = evidenceRepositoryModule;
const { DatabaseWorkerIdentityCheckRepository } = checkRepositoryModule;
const { WorkerIdentityAutomatedCheckHandler } = checkHandlerModule;
const { createTrustedOutboxWorker } = outboxDomainModule;
const { DatabaseOutboxRepository } = outboxRepositoryModule;

const OWNED_MIGRATION = "0019_worker_identity_automated_checks";
const HISTORICAL_SCAN_MIGRATION = "0013_secure_file_malware_scan";
const NOW = "2026-08-10T14:00:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
let fileCounter = 4000;

function environment(pgliteDataDir, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir,
    releaseSha,
    sessionSecret: "worker-identity-check-migration-session-secret-32-characters",
    authPepper: "worker-identity-check-migration-auth-pepper-32-characters",
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
  const accountId = `account_identity_check_migration_${suffix}`;
  const sessionId = `session_identity_check_migration_${suffix}`;
  const email = `identity-check-migration-${suffix}@example.com`;
  const phone = suffix === "persistent" ? "+966722220002" : "+966722220001";
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, phone_e164, display_name, account_status,
       email_verified_at, phone_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'active', $5, $5, $5, $5)`,
    [accountId, email, phone, `Identity Check Migration ${suffix}`, NOW]
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
      `identity_check_migration_token_${suffix}`,
      `identity_check_migration_csrf_${suffix}`,
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
    displayName: `Identity Check Migration ${suffix}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE
  };
}

async function seedAvailableFile(database, outbox, principal, label, mime) {
  fileCounter += 1;
  const fileId = `secure_file_${token24(`${label}${fileCounter}`)}`;
  const extension = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const scanJobId = `job_${token24(`migration-scan-${fileCounter}`)}`;
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
         byte_size = 512,
         content_sha256 = $4
     WHERE file_id = $1`,
    [fileId, extension, mime, hex64(fileCounter * 10 + 3)]
  );
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
     SET lifecycle_status = 'scan_pending', scan_generation = 1, scan_job_id = $2
     WHERE file_id = $1`,
    [fileId, scanJobId]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'available', scan_result_code = 'clean'
     WHERE file_id = $1`,
    [fileId]
  );
  const claimed = await outbox.claimNext(createTrustedOutboxWorker());
  assert.ok(claimed);
  assert.equal(claimed.job.jobId, scanJobId);
  await outbox.succeed(claimed.lease);
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
    documentNumber: "S4-MIG-123456",
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

async function completeAutomatedChecks(database, principal) {
  const outbox = new DatabaseOutboxRepository(Promise.resolve(database));
  const identity = new DatabaseWorkerIdentityRepository(Promise.resolve(database));
  const draft = new DatabaseWorkerIdentityDraftRepository(Promise.resolve(database));
  const evidence = new DatabaseWorkerIdentityEvidenceRepository(Promise.resolve(database));
  const checks = new DatabaseWorkerIdentityCheckRepository(Promise.resolve(database), outbox);

  const draftIdentity = await identity.ensureOwnDraft(principal);
  await draft.saveOwn(principal, completeDraft(), null);
  const documentFile = await seedAvailableFile(database, outbox, principal, "document", "application/pdf");
  const photoFile = await seedAvailableFile(database, outbox, principal, "photo", "image/jpeg");
  const selfieFile = await seedAvailableFile(database, outbox, principal, "selfie", "image/png");
  await evidence.bindOwn(principal, documentInput(documentFile), null);
  await evidence.bindOwn(principal, imageInput("profile_photo", photoFile), null);
  await evidence.bindOwn(principal, imageInput("selfie", selfieFile), null);
  const submitted = await identity.submitOwn(principal, draftIdentity.identity.lockVersion);
  const job = await checks.scheduleOwn(principal);
  const claimed = await outbox.claimNext(createTrustedOutboxWorker());
  assert.ok(claimed);
  assert.equal(claimed.job.jobId, job.jobId);
  const handler = new WorkerIdentityAutomatedCheckHandler(checks, () => "test");
  assert.deepEqual(await handler.handle(claimed.job, claimed.lease), { kind: "succeeded" });
  await outbox.succeed(claimed.lease);
  return { identity, checks, submitted, job };
}

async function statusThrough(database, migrationId) {
  const status = await migrationStatus(database);
  const index = status.findIndex((entry) => entry.id === migrationId);
  assert.ok(index >= 0, `${migrationId} must exist in migration status`);
  return status.slice(0, index + 1);
}

test("S4 completed automated-check run and results survive PGlite close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-worker-identity-check-"));
  const env = environment(directory, "worker-identity-check-persistent");
  let database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const principal = await seedWorker(database, "persistent");
    const accepted = await completeAutomatedChecks(database, principal);
    const before = await accepted.checks.loadOwn(principal);
    assert.equal(before?.run.runStatus, "completed");
    assert.equal(before?.results.length, 3);
    await database.close();
    database = null;

    const reopened = await openScriptDatabase(env);
    try {
      const identityRepository = new DatabaseWorkerIdentityRepository(Promise.resolve(reopened));
      const outbox = new DatabaseOutboxRepository(Promise.resolve(reopened));
      const checks = new DatabaseWorkerIdentityCheckRepository(Promise.resolve(reopened), outbox);
      const identity = await identityRepository.loadOwn(principal);
      const projection = await checks.loadOwn(principal);
      assert.equal(identity?.identity.identityId, accepted.submitted.identity.identityId);
      assert.equal(identity?.identity.lifecycleStatus, "manual_review");
      assert.equal(projection?.run.runStatus, "completed");
      assert.equal(projection?.run.jobId, accepted.job.jobId);
      assert.equal(projection?.results.length, 3);
      const status = await statusThrough(reopened, OWNED_MIGRATION);
      assert.equal(status.every((entry) => entry.applied && entry.checksumMatches), true);
    } finally {
      await reopened.close();
    }
  } finally {
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("S4 outbox job vocabulary survives logical rollback through historical 0013 and deterministic reapply", async () => {
  const env = environment("memory://", "worker-identity-check-rollback");
  const database = await openScriptDatabase(env);
  try {
    const manifest = (await listMigrations()).map((migration) => migration.id);
    const historicalIndex = manifest.indexOf(HISTORICAL_SCAN_MIGRATION);
    const ownedIndex = manifest.indexOf(OWNED_MIGRATION);
    assert.ok(historicalIndex >= 0 && ownedIndex > historicalIndex);
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const principal = await seedWorker(database, "rollback");

    const durableJobId = `job_${token24("durable-s4-check-job")}`;
    const identityRef = `worker_identity_${token24("rollback-identity")}`;
    const versionRef = `identity_version_${token24("rollback-version")}`;
    await database.query(
      `INSERT INTO platform_outbox_jobs (
         job_id, job_type, schema_version, idempotency_key, payload,
         enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
       ) VALUES ($1, 'worker_identity.automated_checks', 1, $2, $3::jsonb,
                 $4, 'worker', NULL, NULL)`,
      [
        durableJobId,
        hex64(900001),
        JSON.stringify({ identityRef, versionRef }),
        principal.accountId
      ]
    );

    const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
    const rolledBack = [];
    try {
      while (true) {
        const id = await rollbackLatestMigration(database, env);
        rolledBack.push(id);
        if (id === HISTORICAL_SCAN_MIGRATION) break;
      }
    } finally {
      if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
      else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    }
    assert.equal(rolledBack[0], OWNED_MIGRATION);
    assert.equal(rolledBack.at(-1), HISTORICAL_SCAN_MIGRATION);

    const retained = await database.query(
      `SELECT job_type, payload FROM platform_outbox_jobs WHERE job_id = $1`,
      [durableJobId]
    );
    assert.equal(retained.rows.length, 1);
    assert.equal(retained.rows[0].job_type, "worker_identity.automated_checks");

    const expectedReapply = manifest.slice(historicalIndex, ownedIndex + 1);
    assert.deepEqual(
      await applyMigrationsThrough(database, `${env.releaseSha}-reapply`, OWNED_MIGRATION),
      expectedReapply
    );
    const finalStatus = await statusThrough(database, OWNED_MIGRATION);
    assert.equal(finalStatus.every((entry) => entry.applied && entry.checksumMatches), true);
    const retainedAfter = await database.query(
      `SELECT job_type FROM platform_outbox_jobs WHERE job_id = $1`,
      [durableJobId]
    );
    assert.equal(retainedAfter.rows[0].job_type, "worker_identity.automated_checks");
  } finally {
    await database.close();
  }
});
