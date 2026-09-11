import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
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
const evidenceServiceModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-evidence-service.js")).href
);
const secureFileRepositoryModule = await import(
  pathToFileURL(join(runtime, "secure-files", "secure-file-repository.js")).href
);
const secureFileServiceModule = await import(
  pathToFileURL(join(runtime, "secure-files", "secure-file-service.js")).href
);

const { DatabaseWorkerIdentityRepository } = identityRepositoryModule;
const { DatabaseWorkerIdentityDraftRepository } = draftRepositoryModule;
const { DatabaseWorkerIdentityEvidenceRepository } = evidenceRepositoryModule;
const { WorkerIdentityEvidenceService } = evidenceServiceModule;
const { DatabaseSecureFileRepository } = secureFileRepositoryModule;
const { SecureFileService } = secureFileServiceModule;

const OWNED_MIGRATION = "0018_worker_identity_evidence_freeze_guard";
const NOW = "2026-08-10T10:00:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
let fileCounter = 0;
let principalCounter = 0;

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "worker-identity-evidence-session-secret-32-characters",
    authPepper: "worker-identity-evidence-auth-pepper-32-characters",
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

async function seedPrincipal(database, suffix, role = "worker") {
  principalCounter += 1;
  const accountId = `account_identity_evidence_${suffix}`;
  const sessionId = `session_identity_evidence_${suffix}`;
  const email = `identity-evidence-${suffix}@example.com`;
  const phone = `+9665${String(principalCounter).padStart(8, "0")}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, phone_e164, display_name, account_status,
       email_verified_at, phone_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'active', $5, $5, $5, $5)`,
    [accountId, email, phone, `Identity Evidence ${suffix}`, NOW]
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
      `identity_evidence_token_${suffix}`,
      `identity_evidence_csrf_${suffix}`,
      NOW,
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
    displayName: `Identity Evidence ${suffix}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE
  };
}

async function seedSecureFile(
  database,
  principal,
  { mime = "image/jpeg", available = true, label = "file" } = {}
) {
  fileCounter += 1;
  const fileId = `secure_file_${token24(`${label}${fileCounter}`)}`;
  const reservationKey = hex64(fileCounter * 10 + 1);
  const objectHash = hex64(fileCounter * 10 + 2);
  const contentHash = hex64(fileCounter * 10 + 3);
  const isPdf = mime === "application/pdf";
  const extension = isPdf ? "pdf" : mime === "image/png" ? "png" : "jpg";

  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, $3, 'worker', NULL, NULL, 'local_test', $4, $5)`,
    [
      fileId,
      reservationKey,
      principal.accountId,
      `secure-files/${objectHash}`,
      `${label}.${extension}`
    ]
  );

  if (available) {
    await database.query(
      `UPDATE platform_secure_files
       SET lifecycle_status = 'quarantined',
           file_extension = $2,
           declared_mime = $3,
           detected_mime = $3,
           byte_size = 128,
           content_sha256 = $4
       WHERE file_id = $1`,
      [fileId, extension, mime, contentHash]
    );

    const scanJobId = `job_${token24(`identity-scan-${fileCounter}`)}`;
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
  }
  return fileId;
}

function completeDraft() {
  return {
    legalFirstName: "Sam",
    legalLastName: "Khan",
    previousLegalName: null,
    dateOfBirth: "1995-02-03",
    nationality: "Pakistani",
    countryOfResidence: "Saudi Arabia"
  };
}

function documentInput(fileId, number = "PK123456") {
  return {
    purpose: "identity_document",
    secureFileId: fileId,
    documentType: "passport",
    documentNumber: number,
    issueDate: "2025-01-01",
    expiryDate: "2035-01-01"
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

function repositories(database) {
  const identity = new DatabaseWorkerIdentityRepository(Promise.resolve(database));
  const draft = new DatabaseWorkerIdentityDraftRepository(Promise.resolve(database));
  const evidence = new DatabaseWorkerIdentityEvidenceRepository(Promise.resolve(database));
  const secureFiles = new SecureFileService(
    new DatabaseSecureFileRepository(Promise.resolve(database))
  );
  const service = new WorkerIdentityEvidenceService(identity, evidence, secureFiles);
  return { identity, draft, evidence, service };
}

async function prepareWorker(database, suffix) {
  const worker = await seedPrincipal(database, suffix);
  const repos = repositories(database);
  const snapshot = await repos.identity.ensureOwnDraft(worker);
  await repos.draft.saveOwn(worker, completeDraft(), null);
  return { worker, snapshot, ...repos };
}

test("S3 binds only available M1.06 evidence, preserves replacement history and freezes submitted evidence", async () => {
  const database = await openScriptDatabase(environment("identity-evidence-binding"));
  try {
    await applyMigrationsThrough(database, "identity-evidence-binding", OWNED_MIGRATION);
    const { worker, snapshot, identity, evidence, service } = await prepareWorker(database, "binding");
    const documentFile = await seedSecureFile(database, worker, {
      mime: "application/pdf",
      label: "passport"
    });
    const photoFile = await seedSecureFile(database, worker, { label: "photo" });
    const selfieFile = await seedSecureFile(database, worker, { label: "selfie" });

    const document = await service.bind(worker, documentInput(documentFile), null);
    const repeated = await service.bind(worker, documentInput(documentFile), null);
    assert.equal(repeated.bindingId, document.bindingId, "exact retry must be idempotent");
    const photo = await service.bind(worker, imageInput("profile_photo", photoFile), null);
    const selfie = await service.bind(worker, imageInput("selfie", selfieFile), null);
    assert.equal(photo.status, "active");
    assert.equal(selfie.status, "active");

    const replacementFile = await seedSecureFile(database, worker, {
      mime: "application/pdf",
      label: "passport-replacement"
    });
    const replacement = await service.bind(
      worker,
      documentInput(replacementFile, "PK999999"),
      document.bindingId
    );
    assert.equal(replacement.supersedesBindingId, document.bindingId);

    const history = await evidence.listOwn(worker);
    assert.equal(history.length, 4);
    assert.equal(
      history.filter((item) => item.purpose === "identity_document" && item.status === "active").length,
      1
    );
    assert.equal(
      history.filter((item) => item.purpose === "identity_document" && item.status === "superseded").length,
      1
    );

    await assert.rejects(
      () => database.query(
        `UPDATE worker_identity_evidence_bindings
         SET document_number = 'MUTATED'
         WHERE binding_id = $1`,
        [replacement.bindingId]
      ),
      /provenance and metadata are immutable/
    );
    await assert.rejects(
      () => database.query(
        `DELETE FROM worker_identity_evidence_bindings WHERE binding_id = $1`,
        [document.bindingId]
      ),
      /history.*cannot be deleted/i
    );

    const submitted = await identity.submitOwn(worker, snapshot.identity.lockVersion);
    assert.equal(submitted.identity.lifecycleStatus, "submitted");

    const lateFile = await seedSecureFile(database, worker, { label: "late-selfie" });
    await assert.rejects(
      () => service.bind(worker, imageInput("selfie", lateFile), selfie.bindingId),
      (error) => error?.name === "WorkerIdentityConflictError"
    );
    await assert.rejects(
      () => database.query(
        `UPDATE worker_identity_evidence_bindings
         SET binding_status = 'superseded'
         WHERE binding_id = $1`,
        [selfie.bindingId]
      ),
      /current editable Worker version/
    );
  } finally {
    await database.close();
  }
});

test("S3 rejects cross-account, unavailable, non-image photo and stale replacement authority", async () => {
  const database = await openScriptDatabase(environment("identity-evidence-isolation"));
  try {
    await applyMigrationsThrough(database, "identity-evidence-isolation", OWNED_MIGRATION);
    const a = await prepareWorker(database, "worker-a");
    const b = await prepareWorker(database, "worker-b");
    const otherFile = await seedSecureFile(database, b.worker, { label: "other" });
    const reservedFile = await seedSecureFile(database, a.worker, {
      available: false,
      label: "reserved"
    });
    const pdfFile = await seedSecureFile(database, a.worker, {
      mime: "application/pdf",
      label: "photo-pdf"
    });

    await assert.rejects(
      () => a.service.bind(a.worker, imageInput("profile_photo", otherFile), null),
      (error) => error?.name === "WorkerIdentityEvidenceUnavailableError"
    );
    await assert.rejects(
      () => a.service.bind(a.worker, imageInput("profile_photo", reservedFile), null),
      (error) => error?.name === "WorkerIdentityEvidenceUnavailableError"
    );
    await assert.rejects(
      () => a.service.bind(a.worker, imageInput("profile_photo", pdfFile), null),
      (error) => error?.name === "WorkerIdentityEvidenceUnavailableError"
    );

    const validFile = await seedSecureFile(database, a.worker, { label: "valid-photo" });
    const current = await a.service.bind(
      a.worker,
      imageInput("profile_photo", validFile),
      null
    );
    const newerFile = await seedSecureFile(database, a.worker, { label: "newer-photo" });
    await assert.rejects(
      () => a.service.bind(a.worker, imageInput("profile_photo", newerFile), null),
      (error) => error?.name === "WorkerIdentityEvidenceConflictError"
    );

    await assert.rejects(
      () => database.query(
        `INSERT INTO worker_identity_evidence_bindings (
           binding_id, identity_version_id, worker_account_id, purpose,
           secure_file_id, document_type, document_number,
           binding_status, supersedes_binding_id, created_by_account_id
         ) VALUES (
           'identity_evidence_abcdefghijklmnopqrstuvwx', $1, $2, 'selfie',
           $3, NULL, NULL, 'active', NULL, $2
         )`,
        [a.snapshot.currentVersion.identityVersionId, a.worker.accountId, otherFile]
      ),
      /available secure file owned by the Worker/
    );

    const company = await seedPrincipal(database, "company", "company");
    await assert.rejects(
      () => a.service.list(company),
      (error) => error?.name === "WorkerIdentityAccessDeniedError"
    );

    await database.query(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP,
           revocation_reason = 'identity_evidence_test'
       WHERE session_id = $1`,
      [a.worker.sessionId]
    );
    await assert.rejects(
      () => a.evidence.listOwn(a.worker),
      (error) => error?.name === "WorkerIdentityAccessDeniedError"
    );
    assert.ok(current.bindingId);
  } finally {
    await database.close();
  }
});

test("S3 submission stays blocked until document, profile photo and selfie are all active and available", async () => {
  const database = await openScriptDatabase(environment("identity-evidence-readiness"));
  try {
    await applyMigrationsThrough(database, "identity-evidence-readiness", OWNED_MIGRATION);
    const prepared = await prepareWorker(database, "readiness");
    const documentFile = await seedSecureFile(database, prepared.worker, {
      mime: "application/pdf",
      label: "ready-doc"
    });
    const photoFile = await seedSecureFile(database, prepared.worker, { label: "ready-photo" });
    const selfieFile = await seedSecureFile(database, prepared.worker, { label: "ready-selfie" });

    await prepared.service.bind(prepared.worker, documentInput(documentFile), null);
    await assert.rejects(
      () => prepared.identity.submitOwn(
        prepared.worker,
        prepared.snapshot.identity.lockVersion
      ),
      /document, profile photo and selfie evidence are incomplete or unavailable/
    );

    await prepared.service.bind(
      prepared.worker,
      imageInput("profile_photo", photoFile),
      null
    );
    await assert.rejects(
      () => prepared.identity.submitOwn(
        prepared.worker,
        prepared.snapshot.identity.lockVersion
      ),
      /document, profile photo and selfie evidence are incomplete or unavailable/
    );

    await prepared.service.bind(prepared.worker, imageInput("selfie", selfieFile), null);
    const submitted = await prepared.identity.submitOwn(
      prepared.worker,
      prepared.snapshot.identity.lockVersion
    );
    assert.equal(submitted.identity.lifecycleStatus, "submitted");

    const audit = await database.query(
      `SELECT action_key FROM platform_audit_events
       WHERE target_reference = $1 ORDER BY audit_sequence`,
      [prepared.snapshot.identity.identityId]
    );
    assert.deepEqual(
      audit.rows.map((row) => row.action_key),
      ["worker_identity.created", "worker_identity.status.changed"],
      "draft evidence history is durable itself; only material identity submission changes the security audit"
    );
  } finally {
    await database.close();
  }
});
