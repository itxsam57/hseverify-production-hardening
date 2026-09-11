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
const evidenceModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-evidence-repository.js")).href
);
const correctionRepositoryModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-correction-repository.js")).href
);
const correctionServiceModule = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-correction-service.js")).href
);
const outboxDomainModule = await import(
  pathToFileURL(join(runtime, "outbox", "outbox-domain.js")).href
);
const outboxRepositoryModule = await import(
  pathToFileURL(join(runtime, "outbox", "outbox-repository.js")).href
);

const { DatabaseWorkerIdentityRepository } = identityModule;
const { DatabaseWorkerIdentityDraftRepository } = draftModule;
const { DatabaseWorkerIdentityEvidenceRepository } = evidenceModule;
const { DatabaseWorkerIdentityCorrectionRepository } = correctionRepositoryModule;
const { WorkerIdentityCorrectionService } = correctionServiceModule;
const { createTrustedOutboxWorker } = outboxDomainModule;
const { DatabaseOutboxRepository } = outboxRepositoryModule;

const OWNED_MIGRATION = "0021_worker_identity_corrections";
const NOW = "2026-08-10T21:40:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
let principalCounter = 0;
let fileCounter = 8000;

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "worker-identity-correction-session-secret-32-characters",
    authPepper: "worker-identity-correction-auth-pepper-32-characters",
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
  const accountId = `account_identity_correction_${suffix}`;
  const sessionId = `session_identity_correction_${suffix}`;
  const email = `identity-correction-${suffix}-${principalCounter}@example.com`;
  const phone = `+9668${String(principalCounter).padStart(8, "0")}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, phone_e164, display_name, account_status,
       email_verified_at, phone_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'active', $5, $5, $5, $5)`,
    [accountId, email, phone, `Correction ${suffix}`, NOW]
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
      `identity_correction_token_${suffix}_${principalCounter}`,
      `identity_correction_csrf_${suffix}_${principalCounter}`,
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
    displayName: `Correction ${suffix}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE
  };
}

async function seedAvailableFile(database, outbox, principal, label, mime) {
  fileCounter += 1;
  const fileId = `secure_file_${token24(`${label}${fileCounter}`)}`;
  const extension = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const scanJobId = `job_${token24(`correction-scan-${fileCounter}`)}`;
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
  const claimed = await outbox.claimNext(createTrustedOutboxWorker());
  assert.ok(claimed);
  assert.equal(claimed.job.jobType, "secure_file.scan");
  await outbox.succeed(claimed.lease);
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

async function advanceToVerified(database, identityId) {
  for (const [fromStatus, toStatus] of [
    ["submitted", "automated_checks"],
    ["automated_checks", "manual_review"],
    ["manual_review", "verified"]
  ]) {
    const result = await database.query(
      `UPDATE worker_identities
       SET lifecycle_status = $1,
           lock_version = lock_version + 1
       WHERE identity_id = $2
         AND lifecycle_status = $3
       RETURNING identity_id`,
      [toStatus, identityId, fromStatus]
    );
    assert.equal(result.rows.length, 1, `${fromStatus} -> ${toStatus} fixture transition must succeed`);
  }
}

async function createVerifiedIdentity(database, principal) {
  const promise = Promise.resolve(database);
  const identities = new DatabaseWorkerIdentityRepository(promise);
  const drafts = new DatabaseWorkerIdentityDraftRepository(promise);
  const evidence = new DatabaseWorkerIdentityEvidenceRepository(promise);
  const outbox = new DatabaseOutboxRepository(promise);

  let snapshot = await identities.ensureOwnDraft(principal);
  await drafts.saveOwn(principal, completeDraft(), null);
  const document = await seedAvailableFile(database, outbox, principal, "passport", "application/pdf");
  const profile = await seedAvailableFile(database, outbox, principal, "profile", "image/png");
  const selfie = await seedAvailableFile(database, outbox, principal, "selfie", "image/jpeg");
  await evidence.bindOwn(
    principal,
    {
      purpose: "identity_document",
      secureFileId: document,
      documentType: "passport",
      documentNumber: `PK-${principal.accountId.slice(-8)}`,
      issueDate: "2025-01-01",
      expiryDate: "2035-01-01"
    },
    null
  );
  await evidence.bindOwn(
    principal,
    {
      purpose: "profile_photo",
      secureFileId: profile,
      documentType: null,
      documentNumber: null,
      issueDate: null,
      expiryDate: null
    },
    null
  );
  await evidence.bindOwn(
    principal,
    {
      purpose: "selfie",
      secureFileId: selfie,
      documentType: null,
      documentNumber: null,
      issueDate: null,
      expiryDate: null
    },
    null
  );
  snapshot = await identities.submitOwn(principal, snapshot.identity.lockVersion);
  await advanceToVerified(database, snapshot.identity.identityId);
  snapshot = await identities.loadOwn(principal);
  assert.equal(snapshot.identity.lifecycleStatus, "verified");
  return { identities, drafts, evidence, outbox, snapshot };
}

test("S6 correction creates a new version, carries safe evidence and never rewrites the verified parent", async () => {
  const env = environment("worker-identity-correction-lineage");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const principal = await seedPrincipal(database, "lineage");
    const fixture = await createVerifiedIdentity(database, principal);
    const parentVersionId = fixture.snapshot.currentVersion.identityVersionId;
    const parentDraft = await fixture.drafts.loadOwn(principal);
    const parentEvidence = await fixture.evidence.listOwn(principal);

    const corrections = new WorkerIdentityCorrectionService(
      new DatabaseWorkerIdentityCorrectionRepository(Promise.resolve(database))
    );
    const request = await corrections.requestOwn(principal, {
      reason: "My verified identity document number contains a clerical error.",
      expectedLockVersion: fixture.snapshot.identity.lockVersion
    });
    const afterRequest = await fixture.identities.loadOwn(principal);
    assert.equal(afterRequest.identity.lifecycleStatus, "correction_pending");
    assert.equal(afterRequest.currentVersion.versionKind, "correction");
    assert.equal(afterRequest.currentVersion.parentVersionId, parentVersionId);
    assert.equal(afterRequest.currentVersion.versionNumber, 2);
    assert.equal(request.correctionVersionId, afterRequest.currentVersion.identityVersionId);

    const correctionDraft = await fixture.drafts.loadOwn(principal);
    assert.equal(correctionDraft.legalFirstName, parentDraft.legalFirstName);
    assert.equal(correctionDraft.verifiedContacts.emailNormalized, principal.email);
    const carried = await fixture.evidence.listOwn(principal);
    assert.equal(carried.filter((item) => item.status === "active").length, 3);
    assert.notDeepEqual(
      carried.filter((item) => item.status === "active").map((item) => item.bindingId).sort(),
      parentEvidence.filter((item) => item.status === "active").map((item) => item.bindingId).sort(),
      "correction evidence must have new binding identity while preserving source history"
    );

    const parentRows = await database.query(
      `SELECT versions.version_status, drafts.legal_first_name
       FROM worker_identity_versions AS versions
       JOIN worker_identity_version_drafts AS drafts
         ON drafts.identity_version_id = versions.identity_version_id
       WHERE versions.identity_version_id = $1`,
      [parentVersionId]
    );
    assert.deepEqual(parentRows.rows, [{ version_status: "submitted", legal_first_name: "Sam" }]);
  } finally {
    await database.close();
  }
});

test("S6 accepted and rejected corrections preserve immutable history and never reuse a rejected version number", async () => {
  const env = environment("worker-identity-correction-decisions");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const principal = await seedPrincipal(database, "decisions");
    const fixture = await createVerifiedIdentity(database, principal);
    const corrections = new WorkerIdentityCorrectionService(
      new DatabaseWorkerIdentityCorrectionRepository(Promise.resolve(database))
    );

    let snapshot = fixture.snapshot;
    const first = await corrections.requestOwn(principal, {
      reason: "My verified family name needs to match the current legal spelling.",
      expectedLockVersion: snapshot.identity.lockVersion
    });
    let correctionDraft = await fixture.drafts.loadOwn(principal);
    await fixture.drafts.saveOwn(
      principal,
      completeDraft({ legalLastName: "Khan-Saeed" }),
      correctionDraft.draftRevision
    );
    snapshot = await fixture.identities.loadOwn(principal);
    await corrections.submitOwn(principal, snapshot.identity.lockVersion);
    const accepted = await corrections.decide({
      correctionRequestId: first.correctionRequestId,
      decision: "accepted",
      reasonCode: "legal_name_confirmed"
    });
    assert.equal(accepted.decision, "accepted");
    snapshot = await fixture.identities.loadOwn(principal);
    assert.equal(snapshot.identity.lifecycleStatus, "verified");
    assert.equal(snapshot.currentVersion.versionNumber, 2);
    assert.equal((await fixture.drafts.loadOwn(principal)).legalLastName, "Khan-Saeed");

    const second = await corrections.requestOwn(principal, {
      reason: "I need another correction reviewed without overwriting accepted history.",
      expectedLockVersion: snapshot.identity.lockVersion
    });
    snapshot = await fixture.identities.loadOwn(principal);
    assert.equal(snapshot.currentVersion.versionNumber, 3);
    await corrections.submitOwn(principal, snapshot.identity.lockVersion);
    const rejected = await corrections.decide({
      correctionRequestId: second.correctionRequestId,
      decision: "rejected",
      reasonCode: "evidence_not_sufficient"
    });
    assert.equal(rejected.decision, "rejected");
    snapshot = await fixture.identities.loadOwn(principal);
    assert.equal(snapshot.identity.lifecycleStatus, "verified");
    assert.equal(snapshot.currentVersion.versionNumber, 2, "rejected correction restores the prior verified version");

    const third = await corrections.requestOwn(principal, {
      reason: "A later valid correction must use a fresh immutable version number.",
      expectedLockVersion: snapshot.identity.lockVersion
    });
    snapshot = await fixture.identities.loadOwn(principal);
    assert.equal(snapshot.currentVersion.versionNumber, 4, "rejected version 3 must never be reused");
    assert.equal(third.parentVersionId, first.correctionVersionId);

    const history = await database.query(
      `SELECT version_number, version_kind, version_status
       FROM worker_identity_versions
       WHERE identity_id = $1
       ORDER BY version_number`,
      [snapshot.identity.identityId]
    );
    assert.deepEqual(history.rows.map((row) => Number(row.version_number)), [1, 2, 3, 4]);

    await assert.rejects(
      database.query(
        `DELETE FROM worker_identity_correction_requests
         WHERE correction_request_id = $1`,
        [first.correctionRequestId]
      ),
      /immutable/i
    );
  } finally {
    await database.close();
  }
});

test("S6 correction Worker authority fails closed after session revocation and for another role", async () => {
  const env = environment("worker-identity-correction-isolation");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const worker = await seedPrincipal(database, "isolation-worker");
    const fixture = await createVerifiedIdentity(database, worker);
    const corrections = new WorkerIdentityCorrectionService(
      new DatabaseWorkerIdentityCorrectionRepository(Promise.resolve(database))
    );
    const company = await seedPrincipal(database, "isolation-company", "company");

    await assert.rejects(
      async () =>
        corrections.requestOwn(company, {
          reason: "A Company session must never create a Worker identity correction.",
          expectedLockVersion: fixture.snapshot.identity.lockVersion
        }),
      /identity|access|permission/i
    );

    await database.query(
      `UPDATE auth_sessions
       SET revoked_at = $1,
           revocation_reason = 'test_revoked'
       WHERE session_id = $2`,
      [NOW, worker.sessionId]
    );
    await assert.rejects(
      corrections.requestOwn(worker, {
        reason: "A revoked Worker session must fail before any correction mutation.",
        expectedLockVersion: fixture.snapshot.identity.lockVersion
      }),
      /identity|access/i
    );
    const requests = await database.query(
      `SELECT COUNT(*)::int AS count FROM worker_identity_correction_requests`
    );
    assert.equal(Number(requests.rows[0].count), 0);
  } finally {
    await database.close();
  }
});
