import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
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
const checkServiceModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-check-service.js")).href
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
const { WorkerIdentityCheckService } = checkServiceModule;
const { WorkerIdentityAutomatedCheckHandler } = checkHandlerModule;
const {
  createTrustedOutboxLease,
  createTrustedOutboxWorker
} = outboxDomainModule;
const { DatabaseOutboxRepository } = outboxRepositoryModule;

const OWNED_MIGRATION = "0019_worker_identity_automated_checks";
const NOW = "2026-08-10T13:00:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
let principalCounter = 0;
let fileCounter = 2000;

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "worker-identity-check-session-secret-32-characters",
    authPepper: "worker-identity-check-auth-pepper-32-characters",
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
  const accountId = `account_identity_check_${suffix}`;
  const sessionId = `session_identity_check_${suffix}`;
  const email = `identity-check-${suffix}@example.com`;
  const phone = `+9666${String(principalCounter).padStart(8, "0")}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, phone_e164, display_name, account_status,
       email_verified_at, phone_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'active', $5, $5, $5, $5)`,
    [accountId, email, phone, `Identity Check ${suffix}`, NOW]
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
      `identity_check_token_${suffix}`,
      `identity_check_csrf_${suffix}`,
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
    displayName: `Identity Check ${suffix}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE
  };
}

async function drainFixtureScanJob(outbox) {
  const claimed = await outbox.claimNext(createTrustedOutboxWorker());
  assert.ok(claimed, "fixture scan job must be claimable");
  assert.equal(claimed.job.jobType, "secure_file.scan");
  const succeeded = await outbox.succeed(claimed.lease);
  assert.equal(succeeded.status, "succeeded");
}

async function seedAvailableFile(database, outbox, principal, label, mime) {
  fileCounter += 1;
  const fileId = `secure_file_${token24(`${label}${fileCounter}`)}`;
  const extension = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const scanJobId = `job_${token24(`check-scan-${fileCounter}`)}`;

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
  await drainFixtureScanJob(outbox);
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

function documentInput(fileId) {
  return {
    purpose: "identity_document",
    secureFileId: fileId,
    documentType: "passport",
    documentNumber: "S4-PK-123456",
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
  const outbox = new DatabaseOutboxRepository(Promise.resolve(database));
  const identity = new DatabaseWorkerIdentityRepository(Promise.resolve(database));
  const draft = new DatabaseWorkerIdentityDraftRepository(Promise.resolve(database));
  const evidence = new DatabaseWorkerIdentityEvidenceRepository(Promise.resolve(database));
  const checks = new DatabaseWorkerIdentityCheckRepository(
    Promise.resolve(database),
    outbox
  );
  const service = new WorkerIdentityCheckService(checks);
  return { outbox, identity, draft, evidence, checks, service };
}

async function prepareSubmittedWorker(database, suffix) {
  const worker = await seedPrincipal(database, suffix);
  const repos = repositories(database);
  const draftIdentity = await repos.identity.ensureOwnDraft(worker);
  await repos.draft.saveOwn(worker, completeDraft(), null);
  const documentFile = await seedAvailableFile(
    database,
    repos.outbox,
    worker,
    `${suffix}-doc`,
    "application/pdf"
  );
  const photoFile = await seedAvailableFile(
    database,
    repos.outbox,
    worker,
    `${suffix}-photo`,
    "image/jpeg"
  );
  const selfieFile = await seedAvailableFile(
    database,
    repos.outbox,
    worker,
    `${suffix}-selfie`,
    "image/png"
  );
  await repos.evidence.bindOwn(worker, documentInput(documentFile), null);
  await repos.evidence.bindOwn(worker, imageInput("profile_photo", photoFile), null);
  await repos.evidence.bindOwn(worker, imageInput("selfie", selfieFile), null);
  const submitted = await repos.identity.submitOwn(
    worker,
    draftIdentity.identity.lockVersion
  );
  return { worker, submitted, ...repos };
}

async function identityStatus(database, identityId) {
  const result = await database.query(
    `SELECT lifecycle_status, lock_version
     FROM worker_identities WHERE identity_id = $1`,
    [identityId]
  );
  return result.rows[0];
}

test("S4 Worker scheduling is idempotent while only a leased system worker can advance automated checks", async () => {
  const database = await openScriptDatabase(environment("identity-check-happy"));
  try {
    await applyMigrationsThrough(database, "identity-check-happy", OWNED_MIGRATION);
    const prepared = await prepareSubmittedWorker(database, "happy");

    const firstJob = await prepared.service.scheduleOwn(prepared.worker);
    const repeatedJob = await prepared.service.scheduleOwn(prepared.worker);
    assert.equal(firstJob.jobId, repeatedJob.jobId);
    assert.equal(firstJob.jobType, "worker_identity.automated_checks");
    assert.deepEqual(firstJob.payload, {
      identityRef: prepared.submitted.identity.identityId,
      versionRef: prepared.submitted.currentVersion.identityVersionId
    });
    assert.equal(
      (await identityStatus(database, prepared.submitted.identity.identityId)).lifecycle_status,
      "submitted",
      "Worker scheduling must not itself gain lifecycle transition authority"
    );

    const claimed = await prepared.outbox.claimNext(createTrustedOutboxWorker());
    assert.ok(claimed);
    assert.equal(claimed.job.jobId, firstJob.jobId);

    const forgedLease = createTrustedOutboxLease({
      jobId: firstJob.jobId,
      attemptId: `attempt_${token24("forged-attempt")}`,
      attemptNumber: 1,
      workerId: `outbox_worker_${token24("forged-worker")}`,
      leaseId: `lease_${token24("forged-lease")}`,
      leaseExpiresAt: FAR_FUTURE
    });
    await assert.rejects(
      () => prepared.checks.beginLeasedRun(claimed.job, forgedLease),
      /lease is no longer live/
    );

    const handler = new WorkerIdentityAutomatedCheckHandler(
      prepared.checks,
      () => "test"
    );
    const handled = await handler.handle(claimed.job, claimed.lease);
    assert.deepEqual(handled, { kind: "succeeded" });

    const projection = await prepared.service.loadOwn(prepared.worker);
    assert.equal(projection?.run.runStatus, "completed");
    assert.equal(projection?.run.adapterKey, "deterministic_local_test");
    assert.equal(projection?.results.length, 3);
    assert.deepEqual(
      projection?.results.map((result) => result.checkType).sort(),
      ["document_consistency", "face_comparison", "liveness"]
    );
    assert.equal(
      (await identityStatus(database, prepared.submitted.identity.identityId)).lifecycle_status,
      "manual_review"
    );

    const repeatedHandle = await handler.handle(claimed.job, claimed.lease);
    assert.deepEqual(repeatedHandle, { kind: "succeeded" });
    const succeededJob = await prepared.outbox.succeed(claimed.lease);
    assert.equal(succeededJob.status, "succeeded");

    await assert.rejects(
      () => database.query(
        `UPDATE worker_identity_check_results
         SET result_code = 'mutated'
         WHERE run_id = $1`,
        [projection.run.runId]
      ),
      /immutable|cannot be deleted/i
    );
    await assert.rejects(
      () => database.query(
        `DELETE FROM worker_identity_check_results WHERE run_id = $1`,
        [projection.run.runId]
      ),
      /immutable|cannot be deleted/i
    );

    const audits = await database.query(
      `SELECT actor_account_id, action_key, metadata
       FROM platform_audit_events
       WHERE target_type = 'worker_identity'
         AND target_reference = $1
       ORDER BY audit_sequence`,
      [prepared.submitted.identity.identityId]
    );
    assert.deepEqual(
      audits.rows.map((row) => row.action_key),
      [
        "worker_identity.created",
        "worker_identity.status.changed",
        "worker_identity.status.changed",
        "worker_identity.status.changed"
      ]
    );
    assert.equal(audits.rows[2].actor_account_id, null);
    assert.equal(audits.rows[3].actor_account_id, null);
    const auditText = JSON.stringify(audits.rows);
    assert.equal(auditText.includes("S4-PK-123456"), false);
    assert.equal(auditText.includes("identity-check-happy@example.com"), false);
    assert.equal(auditText.includes("secure-files/"), false);
  } finally {
    await database.close();
  }
});

test("S4 preview provider boundary fails closed and never advances to manual review", async () => {
  const database = await openScriptDatabase(environment("identity-check-preview"));
  try {
    await applyMigrationsThrough(database, "identity-check-preview", OWNED_MIGRATION);
    const prepared = await prepareSubmittedWorker(database, "preview");
    const job = await prepared.service.scheduleOwn(prepared.worker);
    const claimed = await prepared.outbox.claimNext(createTrustedOutboxWorker());
    assert.ok(claimed);
    assert.equal(claimed.job.jobId, job.jobId);

    const handler = new WorkerIdentityAutomatedCheckHandler(
      prepared.checks,
      () => "preview"
    );
    const result = await handler.handle(claimed.job, claimed.lease);
    assert.equal(result.kind, "terminal");
    assert.equal(result.failure.code, "identity_provider_not_configured");
    const terminal = await prepared.outbox.terminalFail(
      claimed.lease,
      result.failure
    );
    assert.equal(terminal.status, "terminal_failed");

    const projection = await prepared.service.loadOwn(prepared.worker);
    assert.equal(projection?.run.runStatus, "provider_unavailable");
    assert.equal(projection?.run.adapterKey, "unconfigured");
    assert.equal(projection?.run.failureCode, "provider_not_configured");
    assert.equal(projection?.results.length, 0);
    assert.equal(
      (await identityStatus(database, prepared.submitted.identity.identityId)).lifecycle_status,
      "automated_checks"
    );
  } finally {
    await database.close();
  }
});

test("S4 stale withdrawn job drains without creating a run or changing the withdrawn identity", async () => {
  const database = await openScriptDatabase(environment("identity-check-stale"));
  try {
    await applyMigrationsThrough(database, "identity-check-stale", OWNED_MIGRATION);
    const prepared = await prepareSubmittedWorker(database, "stale");
    const job = await prepared.service.scheduleOwn(prepared.worker);
    const withdrawn = await prepared.identity.withdrawOwn(
      prepared.worker,
      prepared.submitted.identity.lockVersion
    );
    assert.equal(withdrawn.identity.lifecycleStatus, "withdrawn");

    const claimed = await prepared.outbox.claimNext(createTrustedOutboxWorker());
    assert.ok(claimed);
    assert.equal(claimed.job.jobId, job.jobId);
    const handler = new WorkerIdentityAutomatedCheckHandler(
      prepared.checks,
      () => "test"
    );
    assert.deepEqual(await handler.handle(claimed.job, claimed.lease), {
      kind: "succeeded"
    });
    await prepared.outbox.succeed(claimed.lease);

    const runCount = await database.query(
      `SELECT COUNT(*)::integer AS count
       FROM worker_identity_check_runs
       WHERE identity_version_id = $1`,
      [prepared.submitted.currentVersion.identityVersionId]
    );
    assert.equal(Number(runCount.rows[0].count), 0);
    assert.equal(
      (await identityStatus(database, prepared.submitted.identity.identityId)).lifecycle_status,
      "withdrawn"
    );
  } finally {
    await database.close();
  }
});

test("S4 Worker-only scheduling rejects other roles and revoked Worker authority", async () => {
  const database = await openScriptDatabase(environment("identity-check-authority"));
  try {
    await applyMigrationsThrough(database, "identity-check-authority", OWNED_MIGRATION);
    const prepared = await prepareSubmittedWorker(database, "authority");
    const company = await seedPrincipal(database, "company", "company");

    await assert.rejects(
      () => prepared.service.scheduleOwn(company),
      (error) => error?.name === "WorkerIdentityAccessDeniedError"
    );

    await database.query(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP,
           revocation_reason = 'identity_check_test'
       WHERE session_id = $1`,
      [prepared.worker.sessionId]
    );
    await assert.rejects(
      () => prepared.service.scheduleOwn(prepared.worker),
      (error) => error?.name === "WorkerIdentityAccessDeniedError"
    );
  } finally {
    await database.close();
  }
});
