import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_WORKER_IDENTITY_ELIGIBILITY_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_IDENTITY_ELIGIBILITY_RUNTIME_DIST is required");

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
const eligibilityRepositoryModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-eligibility-repository.js")).href
);
const eligibilityServiceModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-eligibility-service.js")).href
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
const { DatabaseWorkerIdentityEligibilityRepository } = eligibilityRepositoryModule;
const { WorkerIdentityEligibilityService } = eligibilityServiceModule;
const { createTrustedOutboxWorker } = outboxDomainModule;
const { DatabaseOutboxRepository } = outboxRepositoryModule;

const OWNED_MIGRATION = "0020_worker_identity_duplicate_worker_id";
const NOW = "2026-08-10T17:20:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
let principalCounter = 0;
let fileCounter = 5000;

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "worker-identity-eligibility-session-secret-32-characters",
    authPepper: "worker-identity-eligibility-auth-pepper-32-characters",
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
  const accountId = `account_identity_elig_${suffix}`;
  const sessionId = `session_identity_elig_${suffix}`;
  const email = `identity-elig-${suffix}-${principalCounter}@example.com`;
  const phone = `+9667${String(principalCounter).padStart(8, "0")}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, phone_e164, display_name, account_status,
       email_verified_at, phone_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'active', $5, $5, $5, $5)`,
    [accountId, email, phone, `Identity Eligibility ${suffix}`, NOW]
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
      `identity_elig_token_${suffix}_${principalCounter}`,
      `identity_elig_csrf_${suffix}_${principalCounter}`,
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
    displayName: `Identity Eligibility ${suffix}`,
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
  const scanJobId = `job_${token24(`elig-scan-${fileCounter}`)}`;

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
  await drainFixtureScanJob(outbox);
  return fileId;
}

function completeDraft(overrides = {}) {
  return {
    legalFirstName: "Sam",
    legalLastName: "Khan",
    previousLegalName: null,
    dateOfBirth: "1995-02-03",
    nationality: "Pakistani",
    countryOfResidence: "Saudi Arabia",
    ...overrides
  };
}

function documentInput(fileId, documentNumber) {
  return {
    purpose: "identity_document",
    secureFileId: fileId,
    documentType: "passport",
    documentNumber,
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
  const checks = new DatabaseWorkerIdentityCheckRepository(Promise.resolve(database), outbox);
  const checkService = new WorkerIdentityCheckService(checks);
  const checkHandler = new WorkerIdentityAutomatedCheckHandler(checks, () => "test");
  const eligibility = new DatabaseWorkerIdentityEligibilityRepository(Promise.resolve(database));
  const eligibilityService = new WorkerIdentityEligibilityService(eligibility);
  return {
    outbox,
    identity,
    draft,
    evidence,
    checks,
    checkService,
    checkHandler,
    eligibility,
    eligibilityService
  };
}

async function prepareSubmittedWorker(database, suffix, options = {}) {
  const worker = await seedPrincipal(database, suffix);
  const repos = repositories(database);
  const initial = await repos.identity.ensureOwnDraft(worker);
  await repos.draft.saveOwn(worker, completeDraft(options.draft), null);
  const documentFile = await seedAvailableFile(database, repos.outbox, worker, `${suffix}-doc`, "application/pdf");
  const photoFile = await seedAvailableFile(database, repos.outbox, worker, `${suffix}-photo`, "image/jpeg");
  const selfieFile = await seedAvailableFile(database, repos.outbox, worker, `${suffix}-selfie`, "image/png");
  await repos.evidence.bindOwn(worker, documentInput(documentFile, options.documentNumber ?? `S5-${suffix}-DOC`), null);
  await repos.evidence.bindOwn(worker, imageInput("profile_photo", photoFile), null);
  await repos.evidence.bindOwn(worker, imageInput("selfie", selfieFile), null);
  const submitted = await repos.identity.submitOwn(worker, initial.identity.lockVersion);
  return { worker, submitted, ...repos };
}

async function advanceThroughAutomatedChecks(prepared) {
  await prepared.checkService.scheduleOwn(prepared.worker);
  const claimed = await prepared.outbox.claimNext(createTrustedOutboxWorker());
  assert.ok(claimed, "identity automated-check job must be claimable");
  assert.equal(claimed.job.jobType, "worker_identity.automated_checks");
  const result = await prepared.checkHandler.handle(claimed.job, claimed.lease);
  assert.deepEqual(result, { kind: "succeeded" });
  const succeeded = await prepared.outbox.succeed(claimed.lease);
  assert.equal(succeeded.status, "succeeded");
}

async function markVerified(database, identityId) {
  const result = await database.query(
    `UPDATE worker_identities
     SET lifecycle_status = 'verified', lock_version = lock_version + 1
     WHERE identity_id = $1 AND lifecycle_status = 'manual_review'
     RETURNING identity_id`,
    [identityId]
  );
  assert.equal(result.rows.length, 1, "fixture identity must move manual_review -> verified");
}

async function setupTest(releaseSha) {
  const env = environment(releaseSha);
  const database = await openScriptDatabase(env);
  await applyMigrationsThrough(database, releaseSha, OWNED_MIGRATION);
  return database;
}

test("S5 clear duplicate evaluation permits one opaque idempotent permanent Worker ID", async () => {
  const database = await setupTest("eligibility-clear");
  try {
    const prepared = await prepareSubmittedWorker(database, "clear", {
      draft: { legalFirstName: "Unique", legalLastName: "Worker", dateOfBirth: "1993-03-04" },
      documentNumber: "UNIQUE-778899"
    });
    await advanceThroughAutomatedChecks(prepared);
    await markVerified(database, prepared.submitted.identity.identityId);

    const check = await prepared.eligibilityService.evaluate(prepared.submitted.identity.identityId);
    assert.equal(check.checkStatus, "clear");
    const first = await prepared.eligibilityService.issuePermanentWorkerId(prepared.submitted.identity.identityId);
    const repeated = await prepared.eligibilityService.issuePermanentWorkerId(prepared.submitted.identity.identityId);
    assert.deepEqual(repeated, first);
    assert.match(first.permanentWorkerId, /^worker_id_[A-Za-z0-9_-]{24}$/);
    assert.equal(first.permanentWorkerId.includes(prepared.worker.accountId), false);

    const own = await prepared.eligibility.loadOwnStatus(prepared.worker);
    assert.deepEqual(own, {
      duplicateStatus: "clear",
      latestDisposition: null,
      permanentWorkerId: first.permanentWorkerId
    });

    const rows = await database.query(
      `SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE identity_id = $1`,
      [prepared.submitted.identity.identityId]
    );
    assert.equal(rows.rows.length, 1);
    const audits = await database.query(
      `SELECT action_key, metadata FROM platform_audit_events
       WHERE target_reference = $1
         AND action_key IN ('worker_identity.duplicate.evaluated', 'worker_identity.worker_id.issued')
       ORDER BY audit_sequence`,
      [prepared.submitted.identity.identityId]
    );
    assert.deepEqual(audits.rows.map((row) => row.action_key), [
      "worker_identity.duplicate.evaluated",
      "worker_identity.worker_id.issued"
    ]);
  } finally {
    await database.close();
  }
});

test("S5 duplicate signals never merge accounts and unresolved recovery dispositions block Worker ID", async () => {
  const database = await setupTest("eligibility-review");
  try {
    const sharedDraft = {
      legalFirstName: "Hassan",
      legalLastName: "Rasheed",
      dateOfBirth: "1995-04-12"
    };
    const target = await prepareSubmittedWorker(database, "review-target", {
      draft: sharedDraft,
      documentNumber: "PK-AB 123456"
    });
    const candidate = await prepareSubmittedWorker(database, "review-candidate", {
      draft: sharedDraft,
      documentNumber: "PKAB123456"
    });
    await advanceThroughAutomatedChecks(target);
    await advanceThroughAutomatedChecks(candidate);
    await markVerified(database, target.submitted.identity.identityId);

    const check = await target.eligibilityService.evaluate(target.submitted.identity.identityId);
    assert.equal(check.checkStatus, "review_required");
    const signalRows = await database.query(
      `SELECT signal_type, signal_strength, candidate_identity_id
       FROM worker_identity_duplicate_signals
       WHERE check_id = $1
       ORDER BY signal_type`,
      [check.checkId]
    );
    assert.deepEqual(signalRows.rows.map((row) => row.signal_type), [
      "identity_document_exact",
      "legal_name_dob_exact"
    ]);
    assert.equal(signalRows.rows.every((row) => row.candidate_identity_id === candidate.submitted.identity.identityId), true);

    const signalColumns = await database.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'worker_identity_duplicate_signals'
       ORDER BY column_name`
    );
    const columnNames = signalColumns.rows.map((row) => row.column_name);
    for (const forbidden of ["email", "phone", "name", "date_of_birth", "document_number", "object_key", "hash", "token"]) {
      assert.equal(columnNames.some((column) => column.includes(forbidden)), false);
    }

    await assert.rejects(
      () => target.eligibilityService.issuePermanentWorkerId(target.submitted.identity.identityId),
      (error) => error?.name === "WorkerIdentityWorkerIdBlockedError"
    );

    for (const [disposition, reasonCode] of [
      ["recover_existing_account", "possible_existing_account"],
      ["duplicate_review", "manual_duplicate_review"],
      ["block_worker_id", "duplicate_unresolved"]
    ]) {
      await target.eligibilityService.recordDisposition({
        checkId: check.checkId,
        disposition,
        reasonCode
      });
      await assert.rejects(
        () => target.eligibilityService.issuePermanentWorkerId(target.submitted.identity.identityId),
        (error) => error?.name === "WorkerIdentityWorkerIdBlockedError"
      );
    }

    await target.eligibilityService.recordDisposition({
      checkId: check.checkId,
      disposition: "continue",
      reasonCode: "duplicate_cleared_by_authority"
    });
    const issued = await target.eligibilityService.issuePermanentWorkerId(target.submitted.identity.identityId);
    assert.match(issued.permanentWorkerId, /^worker_id_[A-Za-z0-9_-]{24}$/);

    const identityRows = await database.query(
      `SELECT identity_id, worker_account_id FROM worker_identities
       WHERE identity_id IN ($1, $2)
       ORDER BY identity_id`,
      [target.submitted.identity.identityId, candidate.submitted.identity.identityId]
    );
    assert.equal(identityRows.rows.length, 2, "duplicate evaluation must never merge identities");
    assert.equal(new Set(identityRows.rows.map((row) => row.worker_account_id)).size, 2);

    const dispositions = await database.query(
      `SELECT disposition, disposition_sequence FROM worker_identity_duplicate_dispositions
       WHERE check_id = $1 ORDER BY disposition_sequence`,
      [check.checkId]
    );
    assert.deepEqual(dispositions.rows.map((row) => row.disposition), [
      "recover_existing_account",
      "duplicate_review",
      "block_worker_id",
      "continue"
    ]);
  } finally {
    await database.close();
  }
});

test("S5 re-evaluation supersedes an older clear result when a later duplicate appears", async () => {
  const database = await setupTest("eligibility-reevaluate");
  try {
    const target = await prepareSubmittedWorker(database, "reeval-target", {
      draft: { legalFirstName: "Later", legalLastName: "Match", dateOfBirth: "1991-01-02" },
      documentNumber: "LATER-555"
    });
    await advanceThroughAutomatedChecks(target);
    await markVerified(database, target.submitted.identity.identityId);
    const first = await target.eligibilityService.evaluate(target.submitted.identity.identityId);
    assert.equal(first.checkStatus, "clear");

    const candidate = await prepareSubmittedWorker(database, "reeval-candidate", {
      draft: { legalFirstName: "Later", legalLastName: "Match", dateOfBirth: "1991-01-02" },
      documentNumber: "LATER555"
    });
    await advanceThroughAutomatedChecks(candidate);

    const second = await target.eligibilityService.evaluate(target.submitted.identity.identityId);
    assert.equal(second.checkStatus, "review_required");
    assert.equal(second.checkSequence, first.checkSequence + 1);
    await assert.rejects(
      () => target.eligibilityService.issuePermanentWorkerId(target.submitted.identity.identityId),
      (error) => error?.name === "WorkerIdentityWorkerIdBlockedError"
    );
  } finally {
    await database.close();
  }
});

test("S5 Worker eligibility read is own-session scoped and never exposes duplicate candidate facts", async () => {
  const database = await setupTest("eligibility-read-scope");
  try {
    const first = await prepareSubmittedWorker(database, "scope-first", {
      draft: { legalFirstName: "Scope", legalLastName: "First", dateOfBirth: "1990-02-02" },
      documentNumber: "SCOPE-FIRST"
    });
    const second = await prepareSubmittedWorker(database, "scope-second", {
      draft: { legalFirstName: "Scope", legalLastName: "Second", dateOfBirth: "1992-02-02" },
      documentNumber: "SCOPE-SECOND"
    });
    await advanceThroughAutomatedChecks(first);
    await advanceThroughAutomatedChecks(second);
    await first.eligibilityService.evaluate(first.submitted.identity.identityId);

    const firstStatus = await first.eligibility.loadOwnStatus(first.worker);
    const secondStatus = await second.eligibility.loadOwnStatus(second.worker);
    assert.deepEqual(firstStatus, {
      duplicateStatus: "clear",
      latestDisposition: null,
      permanentWorkerId: null
    });
    assert.deepEqual(secondStatus, {
      duplicateStatus: "not_evaluated",
      latestDisposition: null,
      permanentWorkerId: null
    });
    const serialized = JSON.stringify(firstStatus);
    assert.equal(serialized.includes(second.submitted.identity.identityId), false);
    assert.equal(serialized.includes(second.worker.email), false);

    await database.query(
      `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, revocation_reason = 'owner_test'
       WHERE session_id = $1`,
      [first.worker.sessionId]
    );
    await assert.rejects(
      () => first.eligibility.loadOwnStatus(first.worker),
      (error) => error?.name === "WorkerIdentityAccessDeniedError"
    );
  } finally {
    await database.close();
  }
});

test("S5 permanent Worker ID refuses issuance before verified identity status", async () => {
  const database = await setupTest("eligibility-unverified");
  try {
    const prepared = await prepareSubmittedWorker(database, "unverified", {
      draft: { legalFirstName: "Not", legalLastName: "Verified", dateOfBirth: "1994-06-07" },
      documentNumber: "UNVERIFIED-1"
    });
    await advanceThroughAutomatedChecks(prepared);
    const check = await prepared.eligibilityService.evaluate(prepared.submitted.identity.identityId);
    assert.equal(check.checkStatus, "clear");
    await assert.rejects(
      () => prepared.eligibilityService.issuePermanentWorkerId(prepared.submitted.identity.identityId),
      (error) => error?.name === "WorkerIdentityWorkerIdBlockedError"
    );
  } finally {
    await database.close();
  }
});
