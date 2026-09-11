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
const identityServiceModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-service.js")).href
);
const draftModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-draft-repository.js")).href
);
const evidenceDomain = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-evidence-domain.js")).href
);
const coordinatorModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-submission-coordinator.js")).href
);
const readinessModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-submission-readiness-service.js")).href
);

const { DatabaseWorkerIdentityRepository } = identityModule;
const { WorkerIdentityService } = identityServiceModule;
const { DatabaseWorkerIdentityDraftRepository } = draftModule;
const { createWorkerIdentityEvidenceBindingId } = evidenceDomain;
const { WorkerIdentitySubmissionCoordinator } = coordinatorModule;
const { WorkerIdentitySubmissionNotReadyError } = readinessModule;

const OWNED_MIGRATION = "0021_worker_identity_corrections";
const NOW = "2026-08-11T00:00:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
let fileCounter = 0;

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "worker-identity-readiness-session-secret-32-characters",
    authPepper: "worker-identity-readiness-auth-pepper-32-characters",
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

async function seedWorker(database) {
  const accountId = "account_identity_readiness_owner";
  const sessionId = "session_identity_readiness_owner";
  const email = "fulltestworker01@example.com";
  const phone = "+923001110001";
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, phone_e164, display_name, account_status,
       email_verified_at, phone_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'Owner readiness test', 'active', $4, $4, $4, $4)`,
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
      "identity_readiness_token_hash",
      "identity_readiness_csrf_hash",
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
    displayName: "Owner readiness test",
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE,
    phone
  };
}

async function seedAvailableFile(database, principal, mime, label) {
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
     SET lifecycle_status = 'quarantined', file_extension = $2,
         declared_mime = $3, detected_mime = $3,
         byte_size = 128, content_sha256 = $4
     WHERE file_id = $1`,
    [fileId, extension, mime, hex64(fileCounter * 10 + 3)]
  );
  const jobId = `job_${token24(`readiness-scan-${fileCounter}`)}`;
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, 'secure_file.scan', 1, $2, $3::jsonb, $4, 'worker', NULL, NULL)`,
    [
      jobId,
      hex64(fileCounter * 10 + 4),
      JSON.stringify({ fileRef: fileId, generation: 1 }),
      principal.accountId
    ]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'scan_pending', scan_generation = 1, scan_job_id = $2
     WHERE file_id = $1`,
    [fileId, jobId]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'available', scan_result_code = 'clean'
     WHERE file_id = $1`,
    [fileId]
  );
  return fileId;
}

async function bindEvidence(database, principal, versionId) {
  const documentFile = await seedAvailableFile(database, principal, "application/pdf", "passport");
  const photoFile = await seedAvailableFile(database, principal, "image/jpeg", "photo");
  const selfieFile = await seedAvailableFile(database, principal, "image/jpeg", "selfie");
  for (const [purpose, fileId] of [
    ["identity_document", documentFile],
    ["profile_photo", photoFile],
    ["selfie", selfieFile]
  ]) {
    await database.query(
      `INSERT INTO worker_identity_evidence_bindings (
         binding_id, identity_version_id, worker_account_id, purpose,
         secure_file_id, document_type, document_number, issue_date, expiry_date,
         binding_status, supersedes_binding_id, created_by_account_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', NULL, $3)`,
      [
        createWorkerIdentityEvidenceBindingId(),
        versionId,
        principal.accountId,
        purpose,
        fileId,
        purpose === "identity_document" ? "passport" : null,
        purpose === "identity_document" ? "3333333" : null,
        purpose === "identity_document" ? "2026-08-04" : null,
        purpose === "identity_document" ? "2099-08-26" : null
      ]
    );
  }
}

test("S6 owner regression blocks incomplete production submission atomically and then submits cleanly", async () => {
  const env = environment("worker-identity-owner-readiness");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const principal = await seedWorker(database);
    const client = Promise.resolve(database);
    const identities = new DatabaseWorkerIdentityRepository(client);
    const drafts = new DatabaseWorkerIdentityDraftRepository(client);
    const coordinator = new WorkerIdentitySubmissionCoordinator(client);
    const service = new WorkerIdentityService(identities, coordinator);

    const identity = await identities.ensureOwnDraft(principal);
    const partial = await drafts.saveOwn(
      principal,
      {
        legalFirstName: "Test Worker test",
        legalLastName: "101",
        previousLegalName: null,
        dateOfBirth: "2026-08-04",
        nationality: "dfvbnm",
        countryOfResidence: null
      },
      null
    );
    await bindEvidence(database, principal, identity.currentVersion.identityVersionId);

    await assert.rejects(
      () => service.submit(principal, identity.identity.lockVersion),
      (error) => {
        assert.ok(error instanceof WorkerIdentitySubmissionNotReadyError);
        assert.deepEqual(error.requirements, ["country_of_residence"]);
        assert.match(error.message, /Complete Country of residence before submitting\./);
        return true;
      }
    );

    const afterBlocked = await identities.loadOwn(principal);
    assert.equal(afterBlocked?.identity.lifecycleStatus, "draft");
    assert.equal(afterBlocked?.currentVersion.versionStatus, "draft");

    await drafts.saveOwn(
      principal,
      {
        legalFirstName: "Test Worker test",
        legalLastName: "101",
        previousLegalName: null,
        dateOfBirth: "2026-08-04",
        nationality: "dfvbnm",
        countryOfResidence: "Pakistan"
      },
      partial.draftRevision
    );

    const submitted = await service.submit(principal, identity.identity.lockVersion);
    assert.equal(submitted.identity.lifecycleStatus, "submitted");
    assert.equal(submitted.currentVersion.versionStatus, "submitted");
    assert.ok(submitted.currentVersion.submittedAt);
  } finally {
    await database.close();
  }
});
