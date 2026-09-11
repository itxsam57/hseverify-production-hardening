import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_COMPANY_VERIFICATION_RUNTIME_DIST;
assert.ok(runtime, "HSE_COMPANY_VERIFICATION_RUNTIME_DIST is required");

const verificationRepositoryModule = await import(
  pathToFileURL(join(runtime, "company", "company-verification-repository.js")).href
);
const verificationServiceModule = await import(
  pathToFileURL(join(runtime, "company", "company-verification-service.js")).href
);
const verificationAuthorityModule = await import(
  pathToFileURL(join(runtime, "company", "company-verification-secure-file-authority-repository.js")).href
);
const secureDomain = await import(
  pathToFileURL(join(runtime, "secure-files", "secure-file-domain.js")).href
);
const uploadDomain = await import(
  pathToFileURL(join(runtime, "secure-files", "secure-file-upload-domain.js")).href
);
const uploadRepositoryModule = await import(
  pathToFileURL(join(runtime, "secure-files", "secure-file-upload-repository.js")).href
);
const scanRepositoryModule = await import(
  pathToFileURL(join(runtime, "secure-files", "secure-file-scan-repository.js")).href
);
const outboxDomain = await import(
  pathToFileURL(join(runtime, "outbox", "outbox-domain.js")).href
);
const outboxRepositoryModule = await import(
  pathToFileURL(join(runtime, "outbox", "outbox-repository.js")).href
);
const auditDomain = await import(
  pathToFileURL(join(runtime, "audit", "audit-domain.js")).href
);

const { CompanyVerificationRepository } = verificationRepositoryModule;
const { CompanyVerificationService } = verificationServiceModule;
const { CompanyVerificationSecureFileAuthorityRepository } = verificationAuthorityModule;
const {
  bindTrustedCompanyApplicationSecureFileOwner,
  createSecureFileReservationIntent
} = secureDomain;
const {
  confirmStoredSecureFileUpload,
  createDefaultSecureFileUploadPolicy,
  validateSecureFileUpload
} = uploadDomain;
const { DatabaseSecureFileUploadRepository } = uploadRepositoryModule;
const { DatabaseSecureFileScanRepository } = scanRepositoryModule;
const { createTrustedOutboxWorker } = outboxDomain;
const { DatabaseOutboxRepository } = outboxRepositoryModule;
const { bindTrustedCompanyApplicationAuditActor } = auditDomain;

const LATEST_SCHEMA_MIGRATION = "0041_secure_file_authority_compatibility";
const NOW = "2026-08-30T16:15:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "company-latest-schema-test-session-secret-32-chars",
    authPepper: "company-latest-schema-test-pepper-with-more-than-thirty-two-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

function token24(value) {
  return value.replace(/[^A-Za-z0-9_-]/g, "x").padEnd(24, "x").slice(0, 24);
}

async function seedPendingCompany(database) {
  const token = token24("latest-schema-company");
  const accountId = `account_${token}`;
  const tenantId = `tenant_${token}`;
  const membershipId = `membership_${token}`;
  const sessionId = `session_${token}`;
  const caseId = `company_verification_${token}`;
  const versionId = `company_verification_version_${token}`;
  const email = "latest-schema-company@example.com";

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, 'Latest Schema Company Owner', 'active', $3, $3, $3)`,
    [accountId, email, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'company', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO platform_tenants (
       tenant_id, tenant_type, display_name, tenant_status, created_at, updated_at
     ) VALUES ($1, 'company', 'Latest Schema Company', 'pending', $2, $2)`,
    [tenantId, NOW]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role, membership_role,
       membership_status, activated_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $4, $4, $4)`,
    [membershipId, tenantId, accountId, NOW]
  );
  await database.query(
    `INSERT INTO company_verification_cases (
       case_id, tenant_id, owner_account_id, case_status, created_at, updated_at
     ) VALUES ($1, $2, $3, 'draft', $4, $4)`,
    [caseId, tenantId, accountId, NOW]
  );
  await database.query(
    `INSERT INTO company_verification_versions (
       version_id, case_id, version_number, version_status, draft_revision,
       legal_name, trading_name, registration_number, country, industry,
       company_size, website, authorized_representative,
       business_email_normalized, business_phone_e164,
       terms_accepted_at, privacy_accepted_at, created_at, updated_at
     ) VALUES (
       $1, $2, 1, 'draft', 0,
       'Latest Schema Company', 'Latest Schema Trading', 'PK-LATEST-001',
       'Pakistan', 'Construction', '51-200', 'https://latest-schema.example.com/',
       'Latest Schema Owner', $3, '+923001234567',
       $4, $4, $4, $4
     )`,
    [versionId, caseId, email, NOW]
  );
  await database.query(
    `UPDATE company_verification_cases SET current_version_id = $2 WHERE case_id = $1`,
    [caseId, versionId]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'company', $3, $4, $5, $5, $6)`,
    [sessionId, accountId, "latest_schema_token_hash", "latest_schema_csrf_hash", NOW, FAR_FUTURE]
  );

  const principal = Object.freeze({
    accountId,
    sessionId,
    activeRole: "company",
    tenantMembership: Object.freeze({
      tenantId,
      membershipId,
      role: "owner",
      status: "active",
      tenantStatus: "pending"
    }),
    accountStatus: "active",
    email,
    displayName: "Latest Schema Company Owner",
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE
  });

  return { principal, accountId, tenantId, membershipId };
}

async function uploadAndScanAvailableEvidence(database, principal) {
  const owner = bindTrustedCompanyApplicationSecureFileOwner(principal);
  const authority = new CompanyVerificationSecureFileAuthorityRepository(Promise.resolve(database));
  const reservation = await authority.reserve(
    owner,
    createSecureFileReservationIntent({
      owner,
      businessReference: "company-verification:latest-schema-registration-evidence",
      displayFilename: "registration-evidence.pdf"
    })
  );
  assert.equal(reservation.created, true);
  assert.equal(reservation.file.lifecycleStatus, "reserved");

  const bytes = Uint8Array.from(Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
    "utf8"
  ));
  const validated = validateSecureFileUpload({
    policy: createDefaultSecureFileUploadPolicy(),
    fileId: reservation.file.fileId,
    objectKey: reservation.file.objectKey,
    reservedDisplayFilename: reservation.file.displayFilename,
    originalFilename: reservation.file.displayFilename,
    declaredMime: "application/pdf",
    bytes
  });
  const stored = confirmStoredSecureFileUpload(validated, {
    byteSize: validated.byteSize,
    sha256: validated.contentSha256
  });

  const uploads = new DatabaseSecureFileUploadRepository(Promise.resolve(database));
  const quarantined = await uploads.finalizeQuarantine(
    owner,
    bindTrustedCompanyApplicationAuditActor(principal),
    stored
  );
  assert.equal(quarantined.file.lifecycleStatus, "quarantined");

  const scans = new DatabaseSecureFileScanRepository(Promise.resolve(database));
  const scheduled = await scans.scheduleForCompanyApplication({
    principal,
    fileRef: reservation.file.fileId
  });
  assert.equal(scheduled.created, true);
  assert.equal(scheduled.generation, 1);

  const outbox = new DatabaseOutboxRepository(Promise.resolve(database));
  const claimed = await outbox.claimNext(createTrustedOutboxWorker());
  assert.ok(claimed, "Scheduled Company evidence scan was not claimable");
  assert.equal(claimed.job.jobType, "secure_file.scan");
  assert.equal(claimed.job.jobId, scheduled.jobId);

  const handlerState = await scans.loadForHandler(claimed.job, claimed.lease);
  assert.equal(handlerState.lifecycleStatus, "scan_pending");
  const available = await scans.finalizeDecision({
    job: claimed.job,
    lease: claimed.lease,
    finalStatus: "available",
    resultCode: "clean"
  });
  assert.equal(available.lifecycleStatus, "available");
  assert.equal(available.scanResultCode, "clean");
  await outbox.succeed(claimed.lease);

  return reservation.file.fileId;
}

test("M1.08 Company verification evidence lifecycle remains functional on the latest Phase 1 schema", async () => {
  const env = environment("m1-08-latest-schema-regression");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, LATEST_SCHEMA_MIGRATION);
    const company = await seedPendingCompany(database);
    const service = new CompanyVerificationService(
      new CompanyVerificationRepository(Promise.resolve(database))
    );

    let snapshot = await service.loadOwn(company.principal);
    snapshot = await service.saveDraft({
      principal: company.principal,
      expectedDraftRevision: snapshot.currentVersion.draftRevision,
      draft: {
        legalName: "Latest Schema Company",
        tradingName: "Latest Schema Trading",
        registrationNumber: "PK-LATEST-001",
        country: "Pakistan",
        industry: "Construction",
        companySize: "51-200",
        website: "https://latest-schema.example.com/",
        authorizedRepresentative: "Latest Schema Owner",
        businessPhone: "+923001234567"
      }
    });

    const fileId = await uploadAndScanAvailableEvidence(database, company.principal);
    await service.bindEvidence({
      principal: company.principal,
      secureFileId: fileId,
      evidenceLabel: "Company registration evidence",
      expectedActiveBindingId: null
    });

    snapshot = await service.submit({
      principal: company.principal,
      expectedLockVersion: snapshot.case.lockVersion
    });

    assert.equal(snapshot.case.caseStatus, "submitted");
    assert.equal(snapshot.currentVersion.versionStatus, "submitted");
    assert.ok(snapshot.currentVersion.submittedAt);
  } finally {
    await database.close();
  }
});
