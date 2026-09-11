import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const require = createRequire(import.meta.url);
const runtimeDist = process.env.HSE_SECURE_ACCESS_RUNTIME_DIST;
assert.ok(runtimeDist, "HSE_SECURE_ACCESS_RUNTIME_DIST must be configured");

const secureDomain = require(resolve(runtimeDist, "secure-files", "secure-file-domain.js"));
const accessDomain = require(resolve(runtimeDist, "secure-files", "secure-file-access-domain.js"));
const accessCore = require(resolve(runtimeDist, "secure-files", "secure-file-access-core.js"));
const { DatabaseSecureFileRepository } = require(
  resolve(runtimeDist, "secure-files", "secure-file-repository.js")
);

const NOW = "2026-08-10T00:00:00.000Z";
const EXPIRES = "2099-01-01T00:00:00.000Z";
const SECRET = "secure-file-access-runtime-secret-32-characters-minimum";
const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "secure-file-access-runtime",
  sessionSecret: SECRET,
  authPepper: "secure-file-access-runtime-auth-pepper-32-chars",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function hash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function pdfBytes(marker) {
  return new TextEncoder().encode(`%PDF-1.7\nsecure-access-${marker}\n%%EOF\n`);
}

async function seedWorker(database, suffix) {
  const accountId = `account_access_runtime_${suffix}`;
  const sessionId = `session_access_runtime_${suffix}`;
  const email = `access-runtime-${suffix}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, email, `Access Runtime ${suffix}`, NOW]
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
    [sessionId, accountId, hash(`token:${suffix}`), hash(`csrf:${suffix}`), NOW, EXPIRES]
  );
  return {
    accountId,
    sessionId,
    principal: {
      sessionId,
      accountId,
      activeRole: "worker",
      accountStatus: "active",
      email,
      displayName: `Access Runtime ${suffix}`,
      createdAt: NOW,
      lastSeenAt: NOW,
      expiresAt: EXPIRES,
      tenantMembership: null
    }
  };
}

async function seedCompany(database, suffix, marker) {
  const accountId = `account_access_company_${suffix}`;
  const sessionId = `session_access_company_${suffix}`;
  const tenantId = `tenant_${marker.repeat(24)}`;
  const membershipId = `membership_${marker.repeat(24)}`;
  const email = `access-company-${suffix}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, email, `Access Company ${suffix}`, NOW]
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
    [tenantId, `Access Tenant ${suffix}`, accountId, NOW]
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
    [sessionId, accountId, hash(`company-token:${suffix}`), hash(`company-csrf:${suffix}`), NOW, EXPIRES]
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
      displayName: `Access Company ${suffix}`,
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

async function seedAvailableFile(database, owner, marker) {
  const fileRef = `secure_file_${marker.repeat(24)}`;
  const jobId = `job_${marker.repeat(24)}`;
  const bytes = pdfBytes(marker);
  const objectKey = secureDomain.deriveSecureFileObjectKey(fileRef);
  const tenantId = owner.principal.activeRole === "company" ? owner.tenantId : null;
  const membershipId = owner.principal.activeRole === "company" ? owner.membershipId : null;

  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, $3, $4, $5, $6,
       'local_test', $7, $8)`,
    [
      fileRef,
      hash(`reservation:${marker}`),
      owner.accountId,
      owner.principal.activeRole,
      tenantId,
      membershipId,
      objectKey,
      `Evidence ${marker}.pdf`
    ]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'quarantined',
         file_extension = 'pdf',
         declared_mime = 'application/pdf',
         detected_mime = 'application/pdf',
         byte_size = $2,
         content_sha256 = $3
     WHERE file_id = $1`,
    [fileRef, bytes.byteLength, hash(Buffer.from(bytes))]
  );
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, 'secure_file.scan', 1, $2, $3::jsonb,
       $4, $5, $6, $7)`,
    [
      jobId,
      hash(`idempotency:${marker}`),
      JSON.stringify({ fileRef, generation: 1 }),
      owner.accountId,
      owner.principal.activeRole,
      tenantId,
      membershipId
    ]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'scan_pending',
         scan_generation = 1,
         scan_job_id = $2
     WHERE file_id = $1`,
    [fileRef, jobId]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'available',
         scan_result_code = 'clean'
     WHERE file_id = $1`,
    [fileRef]
  );
  return { fileRef, bytes, objectKey };
}

function storageFor(file) {
  return {
    calls: [],
    async read(objectKey) {
      this.calls.push(objectKey);
      if (objectKey !== file.objectKey) return null;
      return Uint8Array.from(file.bytes);
    }
  };
}

test("Worker signed access reuses safely while live and fails after session revocation", async () => {
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    const owner = await seedWorker(database, "owner");
    const other = await seedWorker(database, "other");
    const file = await seedAvailableFile(database, owner, "W");
    const repository = new DatabaseSecureFileRepository(Promise.resolve(database));

    const issued = await accessCore.authorizeSecureFileAccessCore({
      principal: owner.principal,
      fileRef: file.fileRef,
      purpose: "preview",
      signingSecret: SECRET,
      repository,
      now: new Date(NOW)
    });

    await assert.rejects(
      accessCore.authorizeSecureFileAccessCore({
        principal: other.principal,
        fileRef: file.fileRef,
        purpose: "preview",
        signingSecret: SECRET,
        repository,
        now: new Date(NOW)
      }),
      accessDomain.SecureFileAccessDeniedError
    );

    const storage = storageFor(file);
    for (const now of [
      new Date("2026-08-10T00:00:30.000Z"),
      new Date("2026-08-10T00:01:30.000Z")
    ]) {
      const content = await accessCore.readSecureFileAccessCore({
        principal: owner.principal,
        token: issued.token,
        expectedPurpose: "preview",
        signingSecret: SECRET,
        repository,
        storage,
        now
      });
      assert.deepEqual(Array.from(content.bytes), Array.from(file.bytes));
      assert.equal(content.headers["Content-Type"], "application/pdf");
    }
    assert.deepEqual(storage.calls, [file.objectKey, file.objectKey]);

    await database.query(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP,
           revocation_reason = 'secure_access_runtime'
       WHERE session_id = $1`,
      [owner.sessionId]
    );
    await assert.rejects(
      accessCore.readSecureFileAccessCore({
        principal: owner.principal,
        token: issued.token,
        expectedPurpose: "preview",
        signingSecret: SECRET,
        repository,
        storage,
        now: new Date("2026-08-10T00:01:45.000Z")
      }),
      accessDomain.SecureFileAccessDeniedError
    );
    assert.equal(storage.calls.length, 2, "revoked session must fail before private bytes are read");
  } finally {
    await database.close();
  }
});

test("Company signed access is bound to exact active tenant membership at issue and use time", async () => {
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    const companyA = await seedCompany(database, "a", "A");
    const companyB = await seedCompany(database, "b", "B");
    const file = await seedAvailableFile(database, companyA, "C");
    const repository = new DatabaseSecureFileRepository(Promise.resolve(database));

    await assert.rejects(
      accessCore.authorizeSecureFileAccessCore({
        principal: companyB.principal,
        fileRef: file.fileRef,
        purpose: "download",
        signingSecret: SECRET,
        repository,
        now: new Date(NOW)
      }),
      accessDomain.SecureFileAccessDeniedError
    );

    const copiedMembership = {
      ...companyA.principal,
      tenantMembership: {
        ...companyB.principal.tenantMembership
      }
    };
    await assert.rejects(
      accessCore.authorizeSecureFileAccessCore({
        principal: copiedMembership,
        fileRef: file.fileRef,
        purpose: "download",
        signingSecret: SECRET,
        repository,
        now: new Date(NOW)
      })
    );

    const issued = await accessCore.authorizeSecureFileAccessCore({
      principal: companyA.principal,
      fileRef: file.fileRef,
      purpose: "download",
      signingSecret: SECRET,
      repository,
      now: new Date(NOW)
    });
    const storage = storageFor(file);
    const content = await accessCore.readSecureFileAccessCore({
      principal: companyA.principal,
      token: issued.token,
      expectedPurpose: "download",
      signingSecret: SECRET,
      repository,
      storage,
      now: new Date("2026-08-10T00:01:00.000Z")
    });
    assert.match(content.headers["Content-Disposition"], /^attachment;/);
    assert.equal(storage.calls.length, 1);

    const continuityAccountId = "account_access_company_a_continuity";
    const continuityMembershipId = `membership_${"D".repeat(24)}`;
    await database.query(
      `INSERT INTO auth_accounts (
         account_id, email_normalized, display_name, account_status,
         email_verified_at, created_at, updated_at
       ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
      [continuityAccountId, "access-company-a-continuity@example.com", "Access Company a continuity owner", NOW]
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
       SET membership_status = 'suspended',
           suspended_at = CURRENT_TIMESTAMP
       WHERE membership_id = $1`,
      [companyA.membershipId]
    );
    await assert.rejects(
      accessCore.readSecureFileAccessCore({
        principal: companyA.principal,
        token: issued.token,
        expectedPurpose: "download",
        signingSecret: SECRET,
        repository,
        storage,
        now: new Date("2026-08-10T00:01:30.000Z")
      }),
      accessDomain.SecureFileAccessDeniedError
    );
    assert.equal(storage.calls.length, 1, "suspended membership must fail before private bytes are read");
  } finally {
    await database.close();
  }
});
