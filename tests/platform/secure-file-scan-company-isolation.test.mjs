import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const require = createRequire(import.meta.url);
const runtimeDist = process.env.HSE_SECURE_SCAN_RUNTIME_DIST;
assert.ok(runtimeDist, "HSE_SECURE_SCAN_RUNTIME_DIST must be configured");

const { DatabaseSecureFileScanRepository } = require(
  resolve(runtimeDist, "secure-files", "secure-file-scan-repository.js")
);

const NOW = "2026-08-09T20:00:00.000Z";
const EXPIRES = "2099-01-01T00:00:00.000Z";
const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "secure-file-scan-company-isolation",
  sessionSecret: "secure-file-scan-company-session-secret-32-chars",
  authPepper: "secure-file-scan-company-auth-pepper-32-chars",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function hash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

async function seedCompany(database, suffix, marker) {
  const accountId = `account_scan_company_${suffix}`;
  const sessionId = `session_scan_company_${suffix}`;
  const tenantId = `tenant_${marker.repeat(24)}`;
  const membershipId = `membership_${marker.repeat(24)}`;
  const email = `scan-company-${suffix}@example.com`;

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, email, `Scan Company ${suffix}`, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'company', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO platform_tenants (
       tenant_id, tenant_type, display_name, tenant_status,
       created_by_account_id, created_at, updated_at, activated_at
     ) VALUES ($1, 'company', $2, 'active', $3, $4, $4, $4)`,
    [tenantId, `Scan Tenant ${suffix}`, accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $3, $4, $4, $4)`,
    [membershipId, tenantId, accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'company', $3, $4, $5, $5, $6)`,
    [
      sessionId,
      accountId,
      hash(`company-token:${suffix}`),
      hash(`company-csrf:${suffix}`),
      NOW,
      EXPIRES
    ]
  );

  return {
    accountId,
    sessionId,
    tenantId,
    membershipId,
    principal: {
      sessionId,
      accountId,
      activeRole: "company",
      accountStatus: "active",
      email,
      displayName: `Scan Company ${suffix}`,
      createdAt: NOW,
      lastSeenAt: NOW,
      expiresAt: EXPIRES,
      tenantMembership: {
        tenantId,
        tenantStatus: "active",
        membershipId,
        role: "owner",
        status: "active",
        overrides: []
      }
    }
  };
}

async function seedCompanyQuarantinedFile(database, company, marker) {
  const fileRef = `secure_file_${marker.repeat(24)}`;
  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, $3, 'company', $4, $5,
       'local_test', $6, 'company-scan.pdf')`,
    [
      fileRef,
      hash(`reservation:${marker}`),
      company.accountId,
      company.tenantId,
      company.membershipId,
      `secure-files/${hash(`object:${marker}`)}`
    ]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'quarantined',
         file_extension = 'pdf',
         declared_mime = 'application/pdf',
         detected_mime = 'application/pdf',
         byte_size = 512,
         content_sha256 = $2
     WHERE file_id = $1`,
    [fileRef, hash(`content:${marker}`)]
  );
  return fileRef;
}

async function state(database, fileRef) {
  const result = await database.query(
    `SELECT lifecycle_status, scan_generation, scan_job_id
     FROM platform_secure_files WHERE file_id = $1`,
    [fileRef]
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function scanJobCount(database) {
  const result = await database.query(
    `SELECT COUNT(*) AS count
     FROM platform_outbox_jobs
     WHERE job_type = 'secure_file.scan'`
  );
  return Number(result.rows[0].count);
}

test("Company scan scheduling is bound to the exact active tenant membership", async () => {
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    const companyA = await seedCompany(database, "a", "A");
    const companyB = await seedCompany(database, "b", "B");
    const fileA = await seedCompanyQuarantinedFile(database, companyA, "C");
    const scans = new DatabaseSecureFileScanRepository(Promise.resolve(database));

    await assert.rejects(
      scans.scheduleForPrincipal({
        principal: companyB.principal,
        fileRef: fileA
      }),
      /scan could not be accessed/i
    );
    assert.equal(await scanJobCount(database), 0);
    assert.equal((await state(database, fileA)).lifecycle_status, "quarantined");

    const copiedContext = {
      ...companyA.principal,
      tenantMembership: {
        ...companyB.principal.tenantMembership
      }
    };
    await assert.rejects(
      scans.scheduleForPrincipal({
        principal: copiedContext,
        fileRef: fileA
      })
    );
    assert.equal(await scanJobCount(database), 0);
    assert.equal((await state(database, fileA)).lifecycle_status, "quarantined");

    const scheduled = await scans.scheduleForPrincipal({
      principal: companyA.principal,
      fileRef: fileA
    });
    assert.equal(scheduled.created, true);
    assert.equal(scheduled.generation, 1);

    const job = await database.query(
      `SELECT enqueued_by_account_id, enqueued_by_role, tenant_id,
              membership_id, payload
       FROM platform_outbox_jobs
       WHERE job_id = $1`,
      [scheduled.jobId]
    );
    assert.equal(job.rows.length, 1);
    assert.equal(job.rows[0].enqueued_by_account_id, companyA.accountId);
    assert.equal(job.rows[0].enqueued_by_role, "company");
    assert.equal(job.rows[0].tenant_id, companyA.tenantId);
    assert.equal(job.rows[0].membership_id, companyA.membershipId);
    assert.deepEqual(job.rows[0].payload, { fileRef: fileA, generation: 1 });

    const continuityAccountId = "account_scan_company_a_continuity";
    const continuityMembershipId = `membership_${"D".repeat(24)}`;
    await database.query(
      `INSERT INTO auth_accounts (
         account_id, email_normalized, display_name, account_status,
         email_verified_at, created_at, updated_at
       ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
      [continuityAccountId, "scan-company-a-continuity@example.com", "Scan Company a continuity owner", NOW]
    );
    await database.query(
      `INSERT INTO auth_account_roles (account_id, role, created_at)
       VALUES ($1, 'company', $2)`,
      [continuityAccountId, NOW]
    );
    await database.query(
      `INSERT INTO auth_tenant_memberships (
         membership_id, tenant_id, account_id, portal_role,
         membership_role, membership_status, created_by_account_id,
         created_at, updated_at, activated_at
       ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $4, $5, $5, $5)`,
      [continuityMembershipId, companyA.tenantId, continuityAccountId, companyA.accountId, NOW]
    );

    await database.query(
      `UPDATE auth_tenant_memberships
       SET membership_status = 'suspended', suspended_at = CURRENT_TIMESTAMP
       WHERE membership_id = $1`,
      [companyA.membershipId]
    );
    await assert.rejects(
      scans.scheduleForPrincipal({
        principal: companyA.principal,
        fileRef: fileA
      })
    );

    const pending = await state(database, fileA);
    assert.equal(pending.lifecycle_status, "scan_pending");
    assert.equal(Number(pending.scan_generation), 1);
    assert.equal(pending.scan_job_id, scheduled.jobId);
    assert.equal(await scanJobCount(database), 1);
  } finally {
    await database.close();
  }
});
