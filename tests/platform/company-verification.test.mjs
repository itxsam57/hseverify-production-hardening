import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_COMPANY_VERIFICATION_RUNTIME_DIST;
assert.ok(runtime, "HSE_COMPANY_VERIFICATION_RUNTIME_DIST is required");

const registrationRepositoryModule = await import(
  pathToFileURL(join(runtime, "company", "company-registration-repository.js")).href
);
const registrationServiceModule = await import(
  pathToFileURL(join(runtime, "company", "company-registration-service.js")).href
);
const verificationRepositoryModule = await import(
  pathToFileURL(join(runtime, "company", "company-verification-repository.js")).href
);
const verificationServiceModule = await import(
  pathToFileURL(join(runtime, "company", "company-verification-service.js")).href
);
const verificationAuthorityModule = await import(
  pathToFileURL(join(runtime, "company", "company-verification-secure-file-authority-repository.js")).href
);
const verificationDomain = await import(
  pathToFileURL(join(runtime, "company", "company-verification-domain.js")).href
);
const authDomain = await import(
  pathToFileURL(join(runtime, "auth", "auth-domain.js")).href
);
const secureDomain = await import(
  pathToFileURL(join(runtime, "secure-files", "secure-file-domain.js")).href
);
const secureRepositoryModule = await import(
  pathToFileURL(join(runtime, "secure-files", "secure-file-repository.js")).href
);

const { CompanyRegistrationRepository } = registrationRepositoryModule;
const { CompanyRegistrationService, CompanyRegistrationServiceError } = registrationServiceModule;
const { CompanyVerificationRepository } = verificationRepositoryModule;
const { CompanyVerificationService } = verificationServiceModule;
const { CompanyVerificationSecureFileAuthorityRepository } = verificationAuthorityModule;
const {
  CompanyVerificationAccessDeniedError,
  CompanyVerificationConflictError
} = verificationDomain;
const {
  createTotpCode,
  decryptSecret,
  totpCounter
} = authDomain;
const {
  SecureFileAccessDeniedError,
  bindTrustedCompanyApplicationSecureFileOwner,
  bindTrustedSecureFileOwner,
  createSecureFileReservationIntent,
  getTrustedSecureFileAuthorityMode
} = secureDomain;
const { DatabaseSecureFileRepository } = secureRepositoryModule;

const OWNED_MIGRATION = "0025_company_verification_authority_integration";
const NOW_DATE = new Date("2026-08-11T04:00:00.000Z");
const NOW = NOW_DATE.toISOString();
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const PEPPER = "company-verification-test-pepper-with-more-than-thirty-two-characters";
let sequence = 0;

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "company-verification-test-session-secret-with-32-characters",
    authPepper: PEPPER,
    authSandboxEnabled: true,
    authSandboxAccessKey: "company-verification-sandbox-key",
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

async function latestSandboxCode(database, accountId) {
  const result = await database.query(
    `SELECT deliveries.encrypted_code
     FROM auth_sandbox_deliveries AS deliveries
     JOIN auth_otp_challenges AS challenges
       ON challenges.challenge_id = deliveries.challenge_id
     WHERE challenges.account_id = $1
       AND challenges.purpose = 'registration_email'
       AND deliveries.channel = 'email'
     ORDER BY deliveries.created_at DESC
     LIMIT 1`,
    [accountId]
  );
  const encrypted = result.rows[0]?.encrypted_code;
  assert.equal(typeof encrypted, "string");
  return decryptSecret(encrypted, PEPPER);
}

async function registerCompany(database, suffix, overrides = {}) {
  sequence += 1;
  const email = `company-${suffix}-${sequence}@example.com`;
  const registrationNumber = overrides.registrationNumber ?? `REG-${suffix}-${sequence}`;
  const legalName = overrides.legalName ?? `Example ${suffix} Company ${sequence}`;
  const repository = new CompanyRegistrationRepository(database);
  const service = new CompanyRegistrationService(
    repository,
    { pepper: PEPPER, sandboxEnabled: true },
    () => new Date(NOW_DATE)
  );

  const started = await service.start({
    legalName,
    tradingName: `${legalName} Trading`,
    registrationNumber,
    country: overrides.country ?? "Pakistan",
    industry: "Construction",
    companySize: "51-200",
    website: `https://${suffix.toLowerCase()}-${sequence}.example.com`,
    authorizedRepresentative: `Representative ${suffix} ${sequence}`,
    businessEmail: email,
    businessPhone: `+92300${String(1000000 + sequence).slice(-7)}`,
    password: "CompanyPassphrase!2026Safe",
    termsAccepted: true,
    privacyAccepted: true,
    requestFingerprint: `test-company-registration-${suffix}-${sequence}`
  });
  assert.equal(started.state.step, "pending_email");

  const accountResult = await database.query(
    `SELECT account_id, account_status
     FROM auth_accounts
     WHERE email_normalized = $1`,
    [email]
  );
  const accountId = accountResult.rows[0]?.account_id;
  assert.equal(typeof accountId, "string");
  assert.equal(accountResult.rows[0]?.account_status, "pending_email");

  const foundation = await database.query(
    `SELECT cases.case_id, cases.tenant_id, cases.current_version_id,
            memberships.membership_id, memberships.membership_status,
            memberships.activated_at, tenants.tenant_status
     FROM company_verification_cases AS cases
     JOIN auth_tenant_memberships AS memberships
       ON memberships.tenant_id = cases.tenant_id
      AND memberships.account_id = cases.owner_account_id
     JOIN platform_tenants AS tenants
       ON tenants.tenant_id = cases.tenant_id
     WHERE cases.owner_account_id = $1`,
    [accountId]
  );
  const row = foundation.rows[0];
  assert.ok(row);
  assert.equal(row.tenant_status, "pending");
  assert.equal(row.membership_status, "invited");
  assert.equal(row.activated_at, null);

  const emailCode = await latestSandboxCode(database, accountId);
  const emailState = await service.verifyEmail({
    token: started.token,
    code: emailCode,
    requestFingerprint: `verify-email-${suffix}-${sequence}`
  });
  assert.equal(emailState.step, "pending_mfa");
  assert.equal(typeof emailState.totpSetupKey, "string");

  const activeAccount = await database.query(
    `SELECT account_status, email_verified_at
     FROM auth_accounts
     WHERE account_id = $1`,
    [accountId]
  );
  assert.equal(activeAccount.rows[0]?.account_status, "active");
  assert.ok(activeAccount.rows[0]?.email_verified_at);

  const beforeMfaMembership = await database.query(
    `SELECT membership_status, activated_at
     FROM auth_tenant_memberships
     WHERE membership_id = $1`,
    [row.membership_id]
  );
  assert.equal(beforeMfaMembership.rows[0]?.membership_status, "invited");
  assert.equal(beforeMfaMembership.rows[0]?.activated_at, null);

  const counter = totpCounter(NOW_DATE);
  const totp = createTotpCode(emailState.totpSetupKey, counter);
  const completed = await service.verifyMfa({
    token: started.token,
    code: totp,
    requestFingerprint: `verify-mfa-${suffix}-${sequence}`
  });
  assert.equal(completed.step, "complete");

  const factor = await database.query(
    `SELECT factor_status, last_accepted_counter
     FROM auth_mfa_factors
     WHERE account_id = $1`,
    [accountId]
  );
  assert.equal(factor.rows[0]?.factor_status, "active");
  assert.equal(Number(factor.rows[0]?.last_accepted_counter), counter);

  const activeMembership = await database.query(
    `SELECT membership_status, activated_at
     FROM auth_tenant_memberships
     WHERE membership_id = $1`,
    [row.membership_id]
  );
  assert.equal(activeMembership.rows[0]?.membership_status, "active");
  assert.ok(activeMembership.rows[0]?.activated_at);

  const sessionId = `session_${token24(`company-${suffix}-${sequence}`)}`;
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'company', $3, $4, $5, $5, $6)`,
    [
      sessionId,
      accountId,
      `company_token_hash_${suffix}_${sequence}`,
      `company_csrf_hash_${suffix}_${sequence}`,
      NOW,
      FAR_FUTURE
    ]
  );

  const principal = Object.freeze({
    accountId,
    sessionId,
    activeRole: "company",
    tenantMembership: Object.freeze({
      tenantId: row.tenant_id,
      membershipId: row.membership_id,
      role: "owner",
      status: "active",
      tenantStatus: "pending"
    }),
    accountStatus: "active",
    email,
    displayName: `Representative ${suffix} ${sequence}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE
  });

  return {
    service,
    principal,
    accountId,
    caseId: row.case_id,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    versionId: row.current_version_id,
    registrationNumber,
    legalName,
    email
  };
}

async function seedAdmin(database, suffix = "review") {
  const accountId = `account_${token24(`admin-${suffix}`)}`;
  const sessionId = `session_${token24(`admin-${suffix}`)}`;
  const email = `admin-${suffix}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, 'M1.08 Admin', 'active', $3, $3, $3)`,
    [accountId, email, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'admin', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'admin', $3, $4, $5, $5, $6)`,
    [sessionId, accountId, `admin_token_${suffix}`, `admin_csrf_${suffix}`, NOW, FAR_FUTURE]
  );
  return Object.freeze({
    accountId,
    sessionId,
    activeRole: "admin",
    tenantMembership: null,
    accountStatus: "active",
    email,
    displayName: "M1.08 Admin",
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE
  });
}

async function markCompanyFileAvailable(database, principal, fileId) {
  sequence += 1;
  const jobId = `job_${token24(`company-scan-${sequence}`)}`;
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'quarantined',
         file_extension = 'pdf',
         declared_mime = 'application/pdf',
         detected_mime = 'application/pdf',
         byte_size = 256,
         content_sha256 = $2
     WHERE file_id = $1`,
    [fileId, hex64(sequence * 10 + 1)]
  );
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, 'secure_file.scan', 1, $2, $3::jsonb, $4, 'company', $5, $6)`,
    [
      jobId,
      hex64(sequence * 10 + 2),
      JSON.stringify({ fileRef: fileId, generation: 1 }),
      principal.accountId,
      principal.tenantMembership.tenantId,
      principal.tenantMembership.membershipId
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
}

async function reserveAvailableEvidence(database, principal, label) {
  const owner = bindTrustedCompanyApplicationSecureFileOwner(principal);
  const authorities = new CompanyVerificationSecureFileAuthorityRepository(
    Promise.resolve(database)
  );
  const intent = createSecureFileReservationIntent({
    owner,
    businessReference: `company-verification:${label}:${sequence + 1}`,
    displayFilename: `${label}.pdf`
  });
  const reservation = await authorities.reserve(owner, intent);
  assert.equal(reservation.created, true);
  await markCompanyFileAvailable(database, principal, reservation.file.fileId);
  return reservation.file.fileId;
}

test("M1.08 registration creates a pending Company, verifies email/TOTP and blocks exact duplicate registration claims", async () => {
  const env = environment("m1-08-registration-runtime");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const first = await registerCompany(database, "alpha", {
      registrationNumber: "PK-COMPANY-1001",
      legalName: "Alpha Industrial Services"
    });

    const tenant = await database.query(
      `SELECT tenant_status FROM platform_tenants WHERE tenant_id = $1`,
      [first.tenantId]
    );
    assert.equal(tenant.rows[0]?.tenant_status, "pending");

    await assert.rejects(
      () =>
        new CompanyRegistrationService(
          new CompanyRegistrationRepository(database),
          { pepper: PEPPER, sandboxEnabled: true },
          () => new Date(NOW_DATE)
        ).start({
          legalName: "Completely Different Display Name",
          tradingName: "Different Trading",
          registrationNumber: "PK-COMPANY-1001",
          country: "Pakistan",
          industry: "Construction",
          companySize: "11-50",
          website: "https://different.example.com",
          authorizedRepresentative: "Second Representative",
          businessEmail: "second-duplicate@example.com",
          businessPhone: "+923009999991",
          password: "CompanyPassphrase!2026Safe",
          termsAccepted: true,
          privacyAccepted: true,
          requestFingerprint: "duplicate-company-claim"
        }),
      (error) => {
        assert.ok(error instanceof CompanyRegistrationServiceError);
        assert.equal(error.code, "registration_unavailable");
        assert.match(error.userMessage, /matching account or Company application may already exist/i);
        return true;
      }
    );

    const duplicateAccount = await database.query(
      `SELECT COUNT(*) AS count FROM auth_accounts WHERE email_normalized = 'second-duplicate@example.com'`
    );
    assert.equal(Number(duplicateAccount.rows[0]?.count), 0);
  } finally {
    await database.close();
  }
});

test("M1.08 pending Company evidence requires an immutable application claim while generic tenant authority stays closed", async () => {
  const env = environment("m1-08-pending-file-authority");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const company = await registerCompany(database, "pending-authority");

    assert.throws(
      () => bindTrustedSecureFileOwner(company.principal),
      SecureFileAccessDeniedError
    );
    const owner = bindTrustedCompanyApplicationSecureFileOwner(company.principal);
    assert.equal(owner.authorityMode, "company_application");
    assert.equal(getTrustedSecureFileAuthorityMode(owner), "company_application");
    assert.equal(Object.keys(owner).includes("authorityMode"), false);

    const files = new DatabaseSecureFileRepository(Promise.resolve(database));
    const unclaimedIntent = createSecureFileReservationIntent({
      owner,
      businessReference: "company-verification:unclaimed-registration-certificate",
      displayFilename: "unclaimed-registration.pdf"
    });
    await assert.rejects(
      () => files.reserve(owner, unclaimedIntent),
      /active trusted tenant membership|verification authority claim/i
    );

    const authorities = new CompanyVerificationSecureFileAuthorityRepository(
      Promise.resolve(database)
    );
    const claimedIntent = createSecureFileReservationIntent({
      owner,
      businessReference: "company-verification:registration-certificate",
      displayFilename: "registration.pdf"
    });
    const reserved = await authorities.reserve(owner, claimedIntent);
    assert.equal(reserved.file.ownerAccountId, company.accountId);
    assert.equal(reserved.file.tenantId, company.tenantId);
    assert.equal(reserved.file.membershipId, company.membershipId);

    const claim = await database.query(
      `SELECT case_id, version_id, owner_account_id, tenant_id, membership_id
       FROM company_verification_secure_file_authorities
       WHERE reservation_key = $1`,
      [reserved.file.reservationKey]
    );
    assert.equal(claim.rows[0]?.case_id, company.caseId);
    assert.equal(claim.rows[0]?.version_id, company.versionId);
    assert.equal(claim.rows[0]?.owner_account_id, company.accountId);
    assert.equal(claim.rows[0]?.tenant_id, company.tenantId);
    assert.equal(claim.rows[0]?.membership_id, company.membershipId);

    await assert.rejects(
      () =>
        database.query(
          `UPDATE company_verification_secure_file_authorities
           SET owner_account_id = 'account_forbidden_mutation'
           WHERE reservation_key = $1`,
          [reserved.file.reservationKey]
        ),
      /immutable/i
    );

    const ordinaryRead = await assert.rejects(
      () => files.findForPrincipal(company.principal, reserved.file.fileId),
      SecureFileAccessDeniedError
    );
    assert.equal(ordinaryRead, undefined);
  } finally {
    await database.close();
  }
});

test("M1.08 Company verification preserves submitted history, creates correction lineage and activates tenant only after server review", async () => {
  const env = environment("m1-08-verification-lifecycle");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const company = await registerCompany(database, "lifecycle");
    const admin = await seedAdmin(database, "lifecycle");
    const repository = new CompanyVerificationRepository(Promise.resolve(database));
    const service = new CompanyVerificationService(repository);

    let snapshot = await service.loadOwn(company.principal);
    assert.equal(snapshot.case.caseStatus, "draft");
    assert.equal(snapshot.currentVersion.versionNumber, 1);
    assert.equal(snapshot.currentVersion.draftRevision, 0);

    snapshot = await service.saveDraft({
      principal: company.principal,
      expectedDraftRevision: 0,
      draft: {
        legalName: snapshot.currentVersion.legalName,
        tradingName: "Lifecycle Company Updated Trading",
        registrationNumber: snapshot.currentVersion.registrationNumber,
        country: snapshot.currentVersion.country,
        industry: snapshot.currentVersion.industry,
        companySize: snapshot.currentVersion.companySize,
        website: snapshot.currentVersion.website,
        authorizedRepresentative: snapshot.currentVersion.authorizedRepresentative,
        businessPhone: snapshot.currentVersion.businessPhone
      }
    });
    assert.equal(snapshot.currentVersion.draftRevision, 1);
    await assert.rejects(
      () =>
        service.saveDraft({
          principal: company.principal,
          expectedDraftRevision: 0,
          draft: {
            legalName: snapshot.currentVersion.legalName,
            tradingName: "Stale Write",
            registrationNumber: snapshot.currentVersion.registrationNumber,
            country: snapshot.currentVersion.country,
            industry: snapshot.currentVersion.industry,
            companySize: snapshot.currentVersion.companySize,
            website: snapshot.currentVersion.website,
            authorizedRepresentative: snapshot.currentVersion.authorizedRepresentative,
            businessPhone: snapshot.currentVersion.businessPhone
          }
        }),
      CompanyVerificationConflictError
    );

    const firstFile = await reserveAvailableEvidence(database, company.principal, "registration-v1");
    await service.bindEvidence({
      principal: company.principal,
      secureFileId: firstFile,
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

    await assert.rejects(
      () =>
        database.query(
          `UPDATE company_verification_versions
           SET trading_name = 'Forbidden submitted rewrite'
           WHERE version_id = $1`,
          [snapshot.currentVersion.versionId]
        ),
      /immutable/i
    );
    await assert.rejects(
      () =>
        database.query(
          `DELETE FROM company_verification_evidence
           WHERE version_id = $1`,
          [snapshot.currentVersion.versionId]
        ),
      /immutable/i
    );

    assert.throws(
      () => service.beginReview({ principal: company.principal, caseId: company.caseId }),
      CompanyVerificationAccessDeniedError
    );
    await service.beginReview({ principal: admin, caseId: company.caseId });
    await assert.rejects(
      () =>
        service.withdraw({
          principal: company.principal,
          expectedLockVersion: snapshot.case.lockVersion
        }),
      CompanyVerificationConflictError
    );
    await service.decide({
      principal: admin,
      caseId: company.caseId,
      outcome: "changes_requested"
    });

    snapshot = await service.loadOwn(company.principal);
    assert.equal(snapshot.case.caseStatus, "changes_requested");
    const firstVersionId = snapshot.currentVersion.versionId;
    snapshot = await service.startCorrection({
      principal: company.principal,
      expectedLockVersion: snapshot.case.lockVersion
    });
    assert.equal(snapshot.case.caseStatus, "draft");
    assert.equal(snapshot.currentVersion.versionNumber, 2);
    assert.equal(snapshot.currentVersion.parentVersionId, firstVersionId);
    assert.equal(snapshot.evidence.length, 0);

    const firstVersion = await database.query(
      `SELECT version_status FROM company_verification_versions WHERE version_id = $1`,
      [firstVersionId]
    );
    assert.equal(firstVersion.rows[0]?.version_status, "changes_requested");

    const secondFile = await reserveAvailableEvidence(database, company.principal, "registration-v2");
    await service.bindEvidence({
      principal: company.principal,
      secureFileId: secondFile,
      evidenceLabel: "Company registration evidence",
      expectedActiveBindingId: null
    });
    snapshot = await service.submit({
      principal: company.principal,
      expectedLockVersion: snapshot.case.lockVersion
    });
    await service.beginReview({ principal: admin, caseId: company.caseId });
    await service.decide({
      principal: admin,
      caseId: company.caseId,
      outcome: "verified"
    });

    const tenant = await database.query(
      `SELECT tenant_status FROM platform_tenants WHERE tenant_id = $1`,
      [company.tenantId]
    );
    assert.equal(tenant.rows[0]?.tenant_status, "active");

    const activePrincipal = Object.freeze({
      ...company.principal,
      tenantMembership: Object.freeze({
        ...company.principal.tenantMembership,
        tenantStatus: "active"
      })
    });
    const normalOwner = bindTrustedSecureFileOwner(activePrincipal);
    assert.equal(normalOwner.authorityMode, "active_tenant");
    assert.equal(getTrustedSecureFileAuthorityMode(normalOwner), "active_tenant");
  } finally {
    await database.close();
  }
});
