import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import { bootstrapCompanyVerificationRuntimeTest } from "../helpers/company-verification-runtime-bootstrap.mjs";

bootstrapCompanyVerificationRuntimeTest(import.meta.url);

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
const verificationReviewServiceModule = await import(
  pathToFileURL(join(runtime, "company", "company-verification-review-service.js")).href
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
const { CompanyVerificationReviewService } = verificationReviewServiceModule;
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

async function seedSameTenantCompanyAdmin(database, company, suffix = "team-admin") {
  sequence += 1;
  const fixtureId = token24(`team-${sequence}-${suffix}`);
  const accountId = `account_${fixtureId}`;
  const membershipId = `membership_${fixtureId}`;
  const sessionId = `session_${fixtureId}`;
  const email = `company-${suffix}-${sequence}@example.com`;

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
    [accountId, email, `Company ${suffix}`, "scrypt$16384$8$1$salt$hash", NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'company', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'admin', 'active', $4, $5, $5, $5)`,
    [membershipId, company.tenantId, accountId, company.accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'company', $3, $4, $5, $5, $6)`,
    [
      sessionId,
      accountId,
      `company_team_token_${suffix}_${sequence}`,
      `company_team_csrf_${suffix}_${sequence}`,
      NOW,
      FAR_FUTURE
    ]
  );

  return Object.freeze({
    accountId,
    sessionId,
    activeRole: "company",
    tenantMembership: Object.freeze({
      tenantId: company.tenantId,
      membershipId,
      role: "admin",
      status: "active",
      tenantStatus: "pending"
    }),
    accountStatus: "active",
    email,
    displayName: `Company ${suffix}`,
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

// Pin every Admin review to the submitted version and case revision shown.
async function currentReviewExpected(service, companyPrincipal) {
  const snapshot = await service.loadOwn(companyPrincipal);
  return {
    expectedVersionId: snapshot.currentVersion.versionId,
    expectedLockVersion: snapshot.case.lockVersion
  };
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

test("M1.08 same-tenant Company admins cannot rewrite the registration-verified business email", async () => {
  const env = environment("m1-08-business-email-authority");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const company = await registerCompany(database, "business-email-authority");
    const teamAdmin = await seedSameTenantCompanyAdmin(database, company, "business-email-authority");
    const platformAdmin = await seedAdmin(database, "business-email-authority");
    const service = new CompanyVerificationService(
      new CompanyVerificationRepository(Promise.resolve(database))
    );

    let snapshot = await service.loadOwn(teamAdmin);
    assert.equal(snapshot.currentVersion.businessEmail, company.email);

    snapshot = await service.saveDraft({
      principal: teamAdmin,
      expectedDraftRevision: snapshot.currentVersion.draftRevision,
      draft: {
        legalName: snapshot.currentVersion.legalName,
        tradingName: "Team Admin Edited Trading Name",
        registrationNumber: snapshot.currentVersion.registrationNumber,
        country: snapshot.currentVersion.country,
        industry: snapshot.currentVersion.industry,
        companySize: snapshot.currentVersion.companySize,
        website: snapshot.currentVersion.website,
        authorizedRepresentative: snapshot.currentVersion.authorizedRepresentative,
        businessPhone: snapshot.currentVersion.businessPhone
      }
    });
    assert.equal(snapshot.currentVersion.businessEmail, company.email);
    assert.notEqual(snapshot.currentVersion.businessEmail, teamAdmin.email);

    const evidenceFile = await reserveAvailableEvidence(database, company.principal, "business-email-v1");
    await service.bindEvidence({
      principal: company.principal,
      secureFileId: evidenceFile,
      evidenceLabel: "Company registration evidence",
      expectedActiveBindingId: null
    });
    snapshot = await service.submit({
      principal: company.principal,
      expectedLockVersion: snapshot.case.lockVersion
    });
    await service.beginReview({ principal: platformAdmin, caseId: company.caseId, ...(await currentReviewExpected(service,company.principal)) });
    await service.decide({
      principal: platformAdmin,
      caseId: company.caseId,
      ...(await currentReviewExpected(service,company.principal)),
      outcome: "changes_requested"
    });

    snapshot = await service.loadOwn(teamAdmin);
    snapshot = await service.startCorrection({
      principal: teamAdmin,
      expectedLockVersion: snapshot.case.lockVersion
    });
    assert.equal(snapshot.currentVersion.businessEmail, company.email);
    assert.notEqual(snapshot.currentVersion.businessEmail, teamAdmin.email);
  } finally {
    await database.close();
  }
});

test("M1.08 same-tenant Company admins can submit tenant evidence bound by another authorized manager", async () => {
  const env = environment("m1-08-shared-tenant-evidence");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const company = await registerCompany(database, "shared-tenant-evidence");
    const teamAdmin = await seedSameTenantCompanyAdmin(database, company, "shared-tenant-evidence");
    const service = new CompanyVerificationService(
      new CompanyVerificationRepository(Promise.resolve(database))
    );

    const snapshot = await service.loadOwn(teamAdmin);
    const ownerEvidence = await reserveAvailableEvidence(
      database,
      company.principal,
      "shared-tenant-evidence"
    );
    await service.bindEvidence({
      principal: company.principal,
      secureFileId: ownerEvidence,
      evidenceLabel: "Company registration evidence",
      expectedActiveBindingId: null
    });

    const submitted = await service.submit({
      principal: teamAdmin,
      expectedLockVersion: snapshot.case.lockVersion
    });
    assert.equal(submitted.case.caseStatus, "submitted");
    assert.equal(submitted.currentVersion.versionStatus, "submitted");
    assert.equal(submitted.evidence.length, 1);
    assert.equal(submitted.evidence[0]?.secureFileId, ownerEvidence);
  } finally {
    await database.close();
  }
});

test("M1.08 live manager guards reject forged cross-tenant authority, foreign evidence and stale membership state", async () => {
  const env = environment("m1-08-live-manager-guards");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const first = await registerCompany(database, "live-manager-first");
    const second = await registerCompany(database, "live-manager-second");
    const service = new CompanyVerificationService(
      new CompanyVerificationRepository(Promise.resolve(database))
    );

    const forgedCrossTenantPrincipal = Object.freeze({
      ...first.principal,
      tenantMembership: Object.freeze({
        ...second.principal.tenantMembership
      })
    });
    await assert.rejects(
      () => service.loadOwn(forgedCrossTenantPrincipal),
      CompanyVerificationAccessDeniedError
    );

    const foreignEvidence = await reserveAvailableEvidence(
      database,
      second.principal,
      "foreign-evidence"
    );
    await assert.rejects(
      () => service.bindEvidence({
        principal: first.principal,
        secureFileId: foreignEvidence,
        evidenceLabel: "Company registration evidence",
        expectedActiveBindingId: null
      }),
      CompanyVerificationAccessDeniedError
    );

    const staleSnapshot = await service.loadOwn(first.principal);
    await database.query(
      `UPDATE auth_tenant_memberships
       SET membership_status = 'suspended', suspended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE membership_id = $1`,
      [first.membershipId]
    );
    await assert.rejects(
      () => service.saveDraft({
        principal: first.principal,
        expectedDraftRevision: staleSnapshot.currentVersion.draftRevision,
        draft: {
          legalName: staleSnapshot.currentVersion.legalName,
          tradingName: "Forbidden stale membership rewrite",
          registrationNumber: staleSnapshot.currentVersion.registrationNumber,
          country: staleSnapshot.currentVersion.country,
          industry: staleSnapshot.currentVersion.industry,
          companySize: staleSnapshot.currentVersion.companySize,
          website: staleSnapshot.currentVersion.website,
          authorizedRepresentative: staleSnapshot.currentVersion.authorizedRepresentative,
          businessPhone: staleSnapshot.currentVersion.businessPhone
        }
      }),
      CompanyVerificationAccessDeniedError
    );
  } finally {
    await database.close();
  }
});

test("M1.08 live manager guards reject expired and revoked Company sessions", async () => {
  const env = environment("m1-08-live-session-guards");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const expired = await registerCompany(database, "expired-session");
    const revoked = await registerCompany(database, "revoked-session");
    const service = new CompanyVerificationService(
      new CompanyVerificationRepository(Promise.resolve(database))
    );

    await database.query(
      `UPDATE auth_sessions
       SET expires_at = '2026-08-12T00:00:00.000Z'
       WHERE session_id = $1`,
      [expired.principal.sessionId]
    );
    await assert.rejects(
      () => service.loadOwn(expired.principal),
      CompanyVerificationAccessDeniedError
    );

    await database.query(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP,
           revocation_reason = 'm1_08_live_session_guard_test'
       WHERE session_id = $1`,
      [revoked.principal.sessionId]
    );
    await assert.rejects(
      () => service.loadOwn(revoked.principal),
      CompanyVerificationAccessDeniedError
    );
  } finally {
    await database.close();
  }
});

test("M1.08 admin evidence preview cannot cross verification-case boundaries", async () => {
  const env = environment("m1-08-preview-case-boundary");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const first = await registerCompany(database, "preview-first");
    const second = await registerCompany(database, "preview-second");
    const admin = await seedAdmin(database, "preview-case-boundary");
    const service = new CompanyVerificationService(
      new CompanyVerificationRepository(Promise.resolve(database))
    );

    for (const [company, suffix] of [[first, "preview-first"], [second, "preview-second"]]) {
      let snapshot = await service.loadOwn(company.principal);
      const fileId = await reserveAvailableEvidence(database, company.principal, suffix);
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
      company.boundEvidenceFileId = fileId;
    }

    process.env.HSE_APP_ENV = "test";
    process.env.HSE_DATABASE_DRIVER = "pglite";
    process.env.HSE_PGLITE_DATA_DIR = "memory://";
    process.env.HSE_RELEASE_SHA = "m1-08-preview-case-boundary";
    process.env.HSE_SESSION_SECRET = "m1-08-preview-session-secret-with-more-than-32-chars";
    process.env.HSE_AUTH_PEPPER = "m1-08-preview-auth-pepper-with-more-than-32-chars";

    const review = new CompanyVerificationReviewService(database);
    await assert.rejects(
      () => review.previewEvidence(
        admin,
        first.caseId,
        second.boundEvidenceFileId,
        NOW_DATE
      ),
      CompanyVerificationAccessDeniedError
    );
  } finally {
    await database.close();
  }
});

test("M1.08 review transitions reject duplicate begin-review and decision replay", async () => {
  const env = environment("m1-08-review-replay");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const company = await registerCompany(database, "review-replay");
    const admin = await seedAdmin(database, "review-replay");
    const service = new CompanyVerificationService(
      new CompanyVerificationRepository(Promise.resolve(database))
    );

    let snapshot = await service.loadOwn(company.principal);
    const evidenceFile = await reserveAvailableEvidence(database, company.principal, "review-replay");
    await service.bindEvidence({
      principal: company.principal,
      secureFileId: evidenceFile,
      evidenceLabel: "Company registration evidence",
      expectedActiveBindingId: null
    });
    await service.submit({
      principal: company.principal,
      expectedLockVersion: snapshot.case.lockVersion
    });

    await service.beginReview({ principal: admin, caseId: company.caseId, ...(await currentReviewExpected(service,company.principal)) });
    await assert.rejects(
      async () => service.beginReview({ principal: admin, caseId: company.caseId, ...(await currentReviewExpected(service,company.principal)) }),
      CompanyVerificationConflictError
    );
    await service.decide({
      principal: admin,
      caseId: company.caseId,
      ...(await currentReviewExpected(service,company.principal)),
      outcome: "changes_requested"
    });
    await assert.rejects(
      async () => service.decide({
        principal: admin,
        caseId: company.caseId,
        ...(await currentReviewExpected(service,company.principal)),
        outcome: "verified"
      }),
      CompanyVerificationConflictError
    );

    const afterReplay = await service.loadOwn(company.principal);
    assert.equal(afterReplay.case.caseStatus, "changes_requested");
    const tenant = await database.query(
      `SELECT tenant_status FROM platform_tenants WHERE tenant_id = $1`,
      [company.tenantId]
    );
    assert.equal(tenant.rows[0]?.tenant_status, "pending");
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
      () => service.beginReview({ principal: company.principal, caseId: company.caseId, expectedVersionId:snapshot.currentVersion.versionId, expectedLockVersion:snapshot.case.lockVersion }),
      CompanyVerificationAccessDeniedError
    );
    await service.beginReview({ principal: admin, caseId: company.caseId, ...(await currentReviewExpected(service,company.principal)) });
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
      ...(await currentReviewExpected(service,company.principal)),
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
    await service.beginReview({ principal: admin, caseId: company.caseId, ...(await currentReviewExpected(service,company.principal)) });
    await service.decide({
      principal: admin,
      caseId: company.caseId,
      ...(await currentReviewExpected(service,company.principal)),
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


// This NEW security regression runs against the original isolated PGlite
// fixture by default and a unique disposable PostgreSQL16 database when
// explicitly configured. Never migrate or drop another test's database.
async function m10803IsolatedDatabase() {
  const connection = process.env.HSE_M10803_POSTGRES_TEST_DATABASE_URL;
  if (!connection) {
    const env = environment("m10803-stale-admin-version-cross-review");
    const database = await openScriptDatabase(env);
    try { await applyMigrationsThrough(database,env.releaseSha,OWNED_MIGRATION); }
    catch(error) { await database.close(); throw error; }
    return { database,dispose:async()=>database.close() };
  }
  const url = new URL(connection);
  if (!["127.0.0.1","localhost"].includes(url.hostname) || url.pathname !== "/postgres") {
    throw new Error("M1.08.03 destructive synthetic migration requires localhost PG and postgres maintenance database.");
  }
  const admin = await openScriptDatabase({...environment("m10803-pg-maintenance"),
    databaseDriver:"postgres",databaseUrl:connection});
  const name = "m10803_stale_admin_"+process.pid+"_"+Date.now();
  let database,created = false;
  try {
    await admin.execute('CREATE DATABASE "'+name+'"');
    created = true;
    url.pathname="/"+name;
    const env={...environment("m10803-real-pg-"+process.pid),
      databaseDriver:"postgres",databaseUrl:url.href};
    database=await openScriptDatabase(env);
    await applyMigrationsThrough(database,env.releaseSha,
      "0130_verified_identity_correction_notices");
    return {database,dispose:async()=>{
      try { await database.close(); }
      finally { try { await admin.execute('DROP DATABASE "'+name+'"'); }
        finally { await admin.close(); } }
    }};
  } catch(error) {
    if(database) await database.close();
    try { if(created) await admin.execute('DROP DATABASE "'+name+'"'); }
    finally { await admin.close(); }
    throw error;
  }
}

test("M1.08.03 stale Admin version one review cannot decide a corrected version two without re-review", async () => {
  const {database,dispose}=await m10803IsolatedDatabase();
  try{
    const company=await registerCompany(database,"stale-admin-v1-v2");
    const admin=await seedAdmin(database,"stale-admin-v1-v2");
    const service=new CompanyVerificationService(
      new CompanyVerificationRepository(Promise.resolve(database))
    );
    let state=await service.loadOwn(company.principal);
    const oldVersionId=state.currentVersion.versionId;
    const file1=await reserveAvailableEvidence(database,company.principal,"m10803-v1");
    await service.bindEvidence({principal:company.principal,
      secureFileId:file1,evidenceLabel:"Company registration evidence",
      expectedActiveBindingId:null});
    state=await service.submit({
      principal:company.principal,expectedLockVersion:state.case.lockVersion
    });
    await service.beginReview({
      principal:admin,caseId:company.caseId,
      expectedVersionId:oldVersionId,expectedLockVersion:state.case.lockVersion
    });
    state=await service.loadOwn(company.principal);
    assert.equal(state.case.caseStatus,"under_review");
    const staleAdminForm=Object.freeze({
      caseId:company.caseId,expectedVersionId:oldVersionId,
      expectedLockVersion:state.case.lockVersion,outcome:"verified"
    });
    await service.decide({
      principal:admin,caseId:company.caseId,outcome:"changes_requested",
      expectedVersionId:oldVersionId,expectedLockVersion:state.case.lockVersion
    });
    state=await service.loadOwn(company.principal);
    assert.equal(state.case.caseStatus,"changes_requested");
    state=await service.startCorrection({
      principal:company.principal,expectedLockVersion:state.case.lockVersion
    });
    assert.equal(state.currentVersion.versionNumber,2);
    assert.equal(state.currentVersion.parentVersionId,oldVersionId);
    const correctedVersionId=state.currentVersion.versionId;
    assert.notEqual(correctedVersionId,oldVersionId);
    const file2=await reserveAvailableEvidence(database,company.principal,"m10803-v2");
    await service.bindEvidence({
      principal:company.principal,secureFileId:file2,
      evidenceLabel:"Company registration evidence",expectedActiveBindingId:null
    });
    state=await service.submit({
      principal:company.principal,expectedLockVersion:state.case.lockVersion
    });
    const beforeFreshBegin = state.case.lockVersion;
    await assert.rejects(
      service.beginReview({principal:admin,caseId:company.caseId,
        expectedVersionId:oldVersionId,expectedLockVersion:beforeFreshBegin}),
      CompanyVerificationConflictError,
      "Old Admin v1 begin-review form must not begin reviewing a corrected v2 submission"
    );
    let unchanged=await service.loadOwn(company.principal);
    assert.equal(unchanged.case.caseStatus,"submitted");
    assert.equal(unchanged.case.lockVersion,beforeFreshBegin);
    assert.equal(unchanged.currentVersion.versionId,correctedVersionId);
    await service.beginReview({
      principal:admin,caseId:company.caseId,
      expectedVersionId:correctedVersionId,expectedLockVersion:state.case.lockVersion
    });
    state=await service.loadOwn(company.principal);
    assert.equal(state.case.caseStatus,"under_review");
    const currentAdminForm=Object.freeze({
      caseId:company.caseId,expectedVersionId:correctedVersionId,
      expectedLockVersion:state.case.lockVersion,outcome:"verified"
    });
    assert.notEqual(staleAdminForm.expectedLockVersion,currentAdminForm.expectedLockVersion);
    await assert.rejects(
      service.decide({principal:admin,caseId:company.caseId,outcome:"verified",
        expectedVersionId:correctedVersionId,
        expectedLockVersion:staleAdminForm.expectedLockVersion}),
      CompanyVerificationConflictError,
      "Current version with stale case revision must not approve the corrected Company"
    );
    await assert.rejects(
      service.decide({principal:admin,caseId:company.caseId,outcome:"verified",
        expectedVersionId:"company_verification_version_"+"X".repeat(24),
        expectedLockVersion:currentAdminForm.expectedLockVersion}),
      CompanyVerificationConflictError,
      "Forged well-shaped version ID cannot approve a Company"
    );
    const stale=await service.decide({
      principal:admin,...staleAdminForm
    }).then(()=>({accepted:true}),error=>({accepted:false,name:error.name,message:error.message}));
    const observed=(await database.query(
      "SELECT cases.case_status,cases.current_version_id,tenants.tenant_status "+
      "FROM company_verification_cases cases JOIN platform_tenants tenants ON tenants.tenant_id=cases.tenant_id "+
      "WHERE cases.case_id=$1",[company.caseId]
    )).rows[0];
    console.log("M10803_STALE_ADMIN_V1_FORM_ACTUAL_RESULT",
      JSON.stringify({accepted:stale.accepted,error:stale.name??null,caseStatus:observed.case_status,
        currentVersionIsV2:observed.current_version_id===correctedVersionId,tenantStatus:observed.tenant_status}));
    assert.equal(stale.accepted,false,
      "SECURITY RED: old Admin v1 decision form must NEVER authorize v2 after correction and independently begun review.");
    assert.equal(stale.name,"CompanyVerificationConflictError");
    assert.equal(observed.case_status,"under_review");
    assert.equal(observed.current_version_id,correctedVersionId);
    assert.equal(observed.tenant_status,"pending");
    const premature=(await database.query(
      "SELECT COUNT(*)::int n FROM platform_audit_events "+
      "WHERE action_key='company_verification.status.changed' "+
      "AND target_reference=$1 AND metadata->>'to'='verified'",[company.caseId]
    )).rows[0].n;
    assert.equal(premature,0,"Stale v1 Admin form cannot create v2 verification audit.");
    console.log("M10803_STALE_V1_ADMIN_REVIEW_DENIED_NO_TENANT_ACTIVATION",
      "v2 stays under review pending, old form rejected, no verified audit");

    await service.decide({principal:admin,...currentAdminForm});
    const final=await service.loadOwn(company.principal);
    assert.equal(final.case.caseStatus,"verified");
    assert.equal(final.currentVersion.versionId,correctedVersionId);
    assert.equal(final.currentVersion.versionNumber,2);
    assert.equal((await database.query(
      "SELECT tenant_status FROM platform_tenants WHERE tenant_id=$1",[company.tenantId]
    )).rows[0].tenant_status,"active");
    assert.equal((await database.query(
      "SELECT COUNT(*)::int n FROM platform_audit_events "+
      "WHERE action_key='company_verification.status.changed' "+
      "AND target_reference=$1 AND metadata->>'to'='verified' AND metadata->>'versionNumber'='2'",
      [company.caseId]
    )).rows[0].n,1);
    assert.equal((await database.query(
      "SELECT COUNT(*)::int n FROM company_verification_evidence "+
      "WHERE case_id=$1 AND version_id=$2 AND secure_file_id=$3",
      [company.caseId,oldVersionId,file1]
    )).rows[0].n,1,"Original v1 scanned evidence cannot be silently overwritten.");
    assert.equal((await database.query(
      "SELECT COUNT(*)::int n FROM company_verification_evidence "+
      "WHERE case_id=$1 AND version_id=$2 AND secure_file_id=$3",
      [company.caseId,correctedVersionId,file2]
    )).rows[0].n,1,"Corrected v2 independently scanned evidence remains bound.");
    console.log("M10803_FRESH_V2_ADMIN_VERSION_BOUND_APPROVAL",
      "new Admin review revision authorizes exactly v2, one audit and tenant activation, old version and both PDFs immutable");
  }finally{await dispose();}
});

async function m10804IsolatedRejectedCompanyDatabase() {
  const connection=process.env.HSE_M10804_POSTGRES_TEST_DATABASE_URL;
  if(!connection){
    const env=environment("m10804-company-terminal-rejection");
    const database=await openScriptDatabase(env);
    try { await applyMigrationsThrough(database,env.releaseSha,OWNED_MIGRATION); }
    catch(error){await database.close();throw error;}
    return {database,dispose:async()=>database.close()};
  }
  const url=new URL(connection);
  if(!["127.0.0.1","localhost"].includes(url.hostname)||url.pathname!=="/postgres"){
    throw new Error("M10804 synthetic test may only create and drop a unique database on a localhost postgres maintenance endpoint.");
  }
  const admin=await openScriptDatabase({...environment("m10804-pg-maintenance"),
    databaseDriver:"postgres",databaseUrl:connection});
  const name="m10804_terminal_rejected_"+process.pid+"_"+Date.now();
  let database,created=false;
  try{
    await admin.execute('CREATE DATABASE "'+name+'"');
    created=true;
    url.pathname="/"+name;
    const env={...environment("m10804-realpg-"+process.pid),
      databaseDriver:"postgres",databaseUrl:url.href};
    database=await openScriptDatabase(env);
    await applyMigrationsThrough(database,env.releaseSha,
      "0130_verified_identity_correction_notices");
    return {database,dispose:async()=>{
      try{await database.close();}
      finally{try{await admin.execute('DROP DATABASE "'+name+'"');}
        finally{await admin.close();}}
    }};
  }catch(error){
    if(database)await database.close();
    try{if(created)await admin.execute('DROP DATABASE "'+name+'"');}
    finally{await admin.close();}
    throw error;
  }
}

test("M1.08.04 terminal Company rejection preserves pending tenant, original evidence and denies stale resurrection", async()=>{
  const {database,dispose}=await m10804IsolatedRejectedCompanyDatabase();
  try{
    const company=await registerCompany(database,"terminal-rejected-v1");
    const admin=await seedAdmin(database,"terminal-rejected-v1");
    const service=new CompanyVerificationService(
      new CompanyVerificationRepository(Promise.resolve(database))
    );
    const review=new CompanyVerificationReviewService(database);
    let state=await service.loadOwn(company.principal);
    const versionId=state.currentVersion.versionId;
    const fileId=await reserveAvailableEvidence(database,company.principal,"m10804-original-v1");
    await service.bindEvidence({principal:company.principal,secureFileId:fileId,
      evidenceLabel:"Original Company registration evidence",expectedActiveBindingId:null});
    state=await service.submit({
      principal:company.principal,expectedLockVersion:state.case.lockVersion
    });
    await service.beginReview({
      principal:admin,caseId:company.caseId,
      expectedVersionId:versionId,expectedLockVersion:state.case.lockVersion
    });
    const beforeDecision=await service.loadOwn(company.principal);
    assert.equal(beforeDecision.case.caseStatus,"under_review");
    const originalAdminForm={
      caseId:company.caseId,expectedVersionId:versionId,
      expectedLockVersion:beforeDecision.case.lockVersion
    };
    assert.equal((await review.listForReview(admin)).some(x=>x.caseId===company.caseId),true);
    await service.decide({...originalAdminForm,principal:admin,outcome:"rejected"});
    const rejected=await service.loadOwn(company.principal);
    assert.equal(rejected.case.caseStatus,"rejected");
    assert.equal(rejected.currentVersion.versionId,versionId);
    assert.equal(rejected.currentVersion.versionStatus,"rejected");
    assert.equal(rejected.currentVersion.versionNumber,1);
    assert.ok(rejected.case.rejectedAt&&rejected.currentVersion.terminalAt);
    assert.equal(rejected.case.verifiedAt,null);
    const frozenLock=rejected.case.lockVersion;
    const frozenDraft=rejected.currentVersion.draftRevision;
    assert.equal((await review.listForReview(admin)).some(x=>x.caseId===company.caseId),false,
      "Rejected terminal cases must leave the actionable Admin decision queue.");
    const tenant=(await database.query(
      "SELECT tenant_status,activated_at FROM platform_tenants WHERE tenant_id=$1",
      [company.tenantId])).rows;
    assert.deepEqual(tenant,[{tenant_status:"pending",activated_at:null}]);

    await assert.rejects(
      service.decide({...originalAdminForm,principal:admin,outcome:"verified"}),
      CompanyVerificationConflictError,
      "An old signed Admin Verify form must not resurrect an already rejected Company.");
    await assert.rejects(
      service.decide({...originalAdminForm,principal:admin,outcome:"rejected"}),
      CompanyVerificationConflictError,
      "A replayed Reject form must not create a second immutable decision.");
    await assert.rejects(
      service.decide({principal:admin,caseId:company.caseId,
        expectedVersionId:versionId,expectedLockVersion:frozenLock,outcome:"verified"}),
      CompanyVerificationConflictError,
      "Even a forged current revision must not convert terminal rejection to verified.");
    await assert.rejects(
      service.beginReview({principal:admin,caseId:company.caseId,
        expectedVersionId:versionId,expectedLockVersion:frozenLock}),
      CompanyVerificationConflictError,
      "A rejected application cannot be placed back under review by replaying an old Admin form.");
    await assert.rejects(
      service.startCorrection({principal:company.principal,expectedLockVersion:frozenLock}),
      CompanyVerificationConflictError,
      "Only changes_requested, never terminal rejected, may start a correction.");
    await assert.rejects(
      service.submit({principal:company.principal,expectedLockVersion:frozenLock}),
      CompanyVerificationConflictError,
      "Company cannot resubmit a rejected version.");
    await assert.rejects(
      service.withdraw({principal:company.principal,expectedLockVersion:frozenLock}),
      CompanyVerificationConflictError,
      "Company cannot alter a final rejection by withdrawing.");
    await assert.rejects(
      service.saveDraft({principal:company.principal,expectedDraftRevision:frozenDraft,
        draft:{
          legalName:rejected.currentVersion.legalName,
          tradingName:"Unapproved rejected rewrite",
          registrationNumber:rejected.currentVersion.registrationNumber,
          country:rejected.currentVersion.country,
          industry:rejected.currentVersion.industry,
          companySize:rejected.currentVersion.companySize,
          website:rejected.currentVersion.website,
          authorizedRepresentative:rejected.currentVersion.authorizedRepresentative,
          businessPhone:rejected.currentVersion.businessPhone
        }}),
      CompanyVerificationConflictError,
      "Company may not edit a rejected submission from a stale tab.");
    const after=await service.loadOwn(company.principal);
    assert.equal(after.case.caseStatus,"rejected");
    assert.equal(after.case.lockVersion,frozenLock);
    assert.equal(after.currentVersion.versionId,versionId);
    assert.equal(after.currentVersion.versionStatus,"rejected");
    assert.equal(after.currentVersion.tradingName,rejected.currentVersion.tradingName);
    assert.equal((await database.query(
      "SELECT count(*)::int n FROM company_verification_versions WHERE case_id=$1",
      [company.caseId])).rows[0].n,1,"Terminal rejection must retain one immutable original version.");
    const evidence=(await database.query(
      "SELECT e.version_id,e.binding_status,f.lifecycle_status,f.detected_mime "+
      "FROM company_verification_evidence e JOIN platform_secure_files f "+
      "ON f.file_id=e.secure_file_id WHERE e.case_id=$1 AND e.secure_file_id=$2",
      [company.caseId,fileId])).rows;
    assert.deepEqual(evidence,[{version_id:versionId,binding_status:"active",
      lifecycle_status:"available",detected_mime:"application/pdf"}]);
    const audit=(await database.query(
      "SELECT metadata->>'from' as prior,metadata->>'to' as outcome "+
      "FROM platform_audit_events WHERE target_reference=$1 "+
      "AND action_key='company_verification.status.changed'",
      [company.caseId])).rows;
    assert.equal(audit.filter(x=>x.prior==="under_review"&&x.outcome==="rejected").length,1);
    assert.equal(audit.filter(x=>x.outcome==="verified").length,0);
    assert.equal(audit.filter(x=>x.outcome==="rejected").length,1);
    assert.equal((await database.query(
      "SELECT tenant_status FROM platform_tenants WHERE tenant_id=$1",
      [company.tenantId])).rows[0].tenant_status,"pending");
    console.log("M10804_TERMINAL_REJECTION_DENIES_RESURRECTION_DB",
      "old and forged Admin Verify/Reject replays, new review and Company edit/correct/submit/withdraw all conflict; zero verified audits and tenant remains pending");
    console.log("M10804_REJECTED_COMPANY_ADMIN_QUEUE_AND_EVIDENCE_PERSISTED",
      "one original scanned PDF/one rejected version/one final Admin audit, rejected Company still readable but absent from active Admin review queue");
  }finally{await dispose();}
});

async function m10805IsolatedPostgres() {
  const base = process.env.HSE_M10805_POSTGRES_TEST_DATABASE_URL;
  const url = new URL(base);
  if (!["127.0.0.1","localhost"].includes(url.hostname) || url.pathname !== "/postgres")
    throw new Error("M10805 permits only an isolated temporary database on localhost PostgreSQL.");
  const maintenance = await openScriptDatabase({...environment("m10805-maintenance"),databaseDriver:"postgres",databaseUrl:base});
  const dbname = "m10805_admin_race_"+process.pid+"_"+Date.now();
  let first,second,created=false;
  try {
    await maintenance.execute('CREATE DATABASE "'+dbname+'"');
    created=true;
    url.pathname="/"+dbname;
    const config={...environment("m10805-"+process.pid),databaseDriver:"postgres",databaseUrl:url.href};
    first=await openScriptDatabase(config);
    await applyMigrationsThrough(first,config.releaseSha,"0130_verified_identity_correction_notices");
    second=await openScriptDatabase(config);
    return {first,second,async dispose(){
      try{await second.close();await first.close();}
      finally{try{await maintenance.execute('DROP DATABASE "'+dbname+'"');}
        finally{await maintenance.close();}}
    }};
  } catch(error) {
    await Promise.allSettled([second?.close(),first?.close()]);
    try{if(created)await maintenance.execute('DROP DATABASE "'+dbname+'"');}
    finally{await maintenance.close();}
    throw error;
  }
}

if(process.env.HSE_M10805_POSTGRES_TEST_DATABASE_URL) {
  test("M1.08.05 two Admins race Company final approval or rejection on real PostgreSQL16", {timeout:180000}, async()=>{
    const {first,second,dispose}=await m10805IsolatedPostgres();
    try{
      for(const win of ["verified","rejected"]){
        const suffix="m10805-"+win;
        const company=await registerCompany(first,suffix);
        const adminA=await seedAdmin(first,suffix+"-a");
        const adminB=await seedAdmin(first,suffix+"-b");
        const service=new CompanyVerificationService(
          new CompanyVerificationRepository(Promise.resolve(first)));
        let snapshot=await service.loadOwn(company.principal);
        const versionId=snapshot.currentVersion.versionId;
        const fileId=await reserveAvailableEvidence(first,company.principal,suffix+"-pdf");
        await service.bindEvidence({principal:company.principal,secureFileId:fileId,
          evidenceLabel:"Company original scanned evidence",expectedActiveBindingId:null});
        snapshot=await service.submit({
          principal:company.principal,expectedLockVersion:snapshot.case.lockVersion});
        await service.beginReview({principal:adminA,caseId:company.caseId,
          expectedVersionId:versionId,expectedLockVersion:snapshot.case.lockVersion});
        snapshot=await service.loadOwn(company.principal);
        const revision=snapshot.case.lockVersion;
        const form=Object.freeze({caseId:company.caseId,expectedVersionId:versionId,
          expectedLockVersion:revision});
        let release,signalled;
        const commitGate=new Promise(r=>release=r);
        const firstWrote=new Promise(r=>signalled=r);
        const held={
          ...first,
          async transaction(callback){
            return first.transaction(async tx=>{
              const value=await callback(tx);
              signalled();
              await commitGate;
              return value;
            });
          }
        };
        const decidingA=new CompanyVerificationService(
          new CompanyVerificationRepository(Promise.resolve(held)));
        const decidingB=new CompanyVerificationService(
          new CompanyVerificationRepository(Promise.resolve(second)));
        let aPromise,bPromise;
        try{
          aPromise=decidingA.decide({principal:adminA,...form,outcome:win});
          const writeStatus=await Promise.race([
            firstWrote.then(()=>"uncommitted"),
            aPromise.then(()=>"unexpected_commit",err=>{throw err;}),
            new Promise(r=>setTimeout(()=>r("first_not_ready"),10000))
          ]);
          assert.equal(writeStatus,"uncommitted");
          bPromise=decidingB.decide({principal:adminB,...form,
            outcome:win==="verified"?"rejected":"verified"
          }).then(()=>({accepted:true}),error=>({accepted:false,name:error.name,message:error.message}));
          const early=await Promise.race([
            bPromise.then(()=>"premature_second_decision"),
            new Promise(r=>setTimeout(()=>r("second_waited"),1100))
          ]);
          assert.equal(early,"second_waited","Second independent Admin cannot decide before first DB commit.");
          release();
          await aPromise;
          const loser=await bPromise;
          assert.equal(loser.accepted,false,"Both Admin decisions cannot succeed for one case revision.");
          assert.equal(loser.name,"CompanyVerificationConflictError");
        }finally{
          release?.();
          await Promise.allSettled([aPromise,bPromise]);
        }
        await assert.rejects(
          service.decide({principal:adminA,...form,outcome:win}),
          CompanyVerificationConflictError,"Previously accepted Admin decision cannot be replayed.");
        const row=(await first.query(
          "SELECT c.case_status,c.lock_version,c.current_version_id,v.version_status,"+
          "t.tenant_status,t.activated_at FROM company_verification_cases c "+
          "JOIN company_verification_versions v ON v.version_id=c.current_version_id "+
          "JOIN platform_tenants t ON t.tenant_id=c.tenant_id WHERE c.case_id=$1",
          [company.caseId])).rows[0];
        assert.equal(row.case_status,win);
        assert.equal(row.version_status,win);
        assert.equal(row.current_version_id,versionId);
        assert.equal(Number(row.lock_version),revision+1);
        assert.equal(row.tenant_status,win==="verified"?"active":"pending");
        assert.equal(Boolean(row.activated_at),win==="verified");
        const decisionEvents=(await first.query(
          "SELECT metadata->>'to' decision FROM platform_audit_events "+
          "WHERE target_reference=$1 AND action_key='company_verification.status.changed' "+
          "AND metadata->>'from'='under_review'",
          [company.caseId])).rows;
        assert.deepEqual(decisionEvents,[{decision:win}],
          "Exactly one winning decision audit; no losing or replayed audit.");
        assert.equal((await first.query(
          "SELECT count(*)::int n FROM company_verification_versions WHERE case_id=$1",
          [company.caseId])).rows[0].n,1);
        assert.equal((await first.query(
          "SELECT count(*)::int n FROM company_verification_evidence "+
          "WHERE case_id=$1 AND version_id=$2 AND secure_file_id=$3",
          [company.caseId,versionId,fileId])).rows[0].n,1);
        assert.equal((await new CompanyVerificationReviewService(first)
          .listForReview(adminB)).some(x=>x.caseId===company.caseId),false);
        console.log("M10805_TWO_ADMIN_REAL_PG16_DECISION_SERIALIZED_DB",
          JSON.stringify({winner:win,loser:"denied",singleAudit:true,
            tenantStatus:row.tenant_status,caseRevision:Number(row.lock_version)}));
        console.log("M10805_PENDING_OR_ACTIVATED_TENANT_SINGLE_AUDIT_REPLAY_DENIED",
          win,"original Company PDF and v1 remain, old decision form rejects, one terminal audit");
      }
    }finally{await dispose();}
  });
}
