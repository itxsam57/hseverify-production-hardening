import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_COMPANY_WORKFORCE_RUNTIME_DIST;
assert.ok(runtime, "HSE_COMPANY_WORKFORCE_RUNTIME_DIST is required");
const serviceModule = await import(
  pathToFileURL(join(runtime, "company", "company-workforce-service.js")).href
);
const { CompanyWorkforceService, expireCompanyWorkforceResources } = serviceModule;

const PEPPER = "m1-10-expiry-lifecycle-pepper-with-more-than-thirty-two-characters";
const START = new Date("2026-08-16T12:00:00.000Z");
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m1-10-expiry-lifecycle",
  sessionSecret: "m1-10-expiry-session-secret-with-more-than-thirty-two-characters",
  authPepper: PEPPER,
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};
const oid = (prefix, character) => `${prefix}_${character.repeat(24)}`;

async function migratedDatabase() {
  const database = await openScriptDatabase(ENV);
  await applyMigrationsThrough(
    database,
    ENV.releaseSha,
    "0029_company_worker_invitations_cross_brick_hardening"
  );
  return database;
}

async function seedCompany(database) {
  const company = {
    accountId: "account_m110_expiry_company",
    tenantId: oid("tenant", "E"),
    membershipId: oid("membership", "E"),
    sessionId: "session_m110_expiry_company",
    email: "expiry-company@example.com"
  };
  const now = START.toISOString();
  await database.query(
    `INSERT INTO auth_accounts (
       account_id,email_normalized,display_name,account_status,password_hash,
       email_verified_at,password_set_at,created_at,updated_at
     ) VALUES ($1,$2,'Expiry Company','active',$3,$4,$4,$4,$4)`,
    [company.accountId, company.email, "scrypt$16384$8$1$salt$hash", now]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id,role,created_at)
     VALUES ($1,'company',$2)`,
    [company.accountId, now]
  );
  await database.query(
    `INSERT INTO platform_tenants (
       tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,
       created_at,updated_at,activated_at
     ) VALUES ($1,'company','Expiry Company','active',$2,$3,$3,$3)`,
    [company.tenantId, company.accountId, now]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id,tenant_id,account_id,portal_role,membership_role,
       membership_status,created_by_account_id,created_at,updated_at,activated_at
     ) VALUES ($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`,
    [company.membershipId, company.tenantId, company.accountId, now]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id,account_id,active_role,token_hash,csrf_token_hash,
       created_at,last_seen_at,expires_at
     ) VALUES ($1,$2,'company',$3,$4,$5,$5,'2099-01-01T00:00:00.000Z')`,
    [company.sessionId, company.accountId, "expiry-token", "expiry-csrf", now]
  );
  await database.query(
    `INSERT INTO company_verification_cases (
       case_id,tenant_id,owner_account_id,case_status,lock_version,
       created_at,updated_at,verified_at
     ) VALUES ($1,$2,$3,'verified',0,$4,$4,$4)`,
    [oid("company_verification", "E"), company.tenantId, company.accountId, now]
  );
  return company;
}

function principal(company) {
  const now = START.toISOString();
  return Object.freeze({
    accountId: company.accountId,
    sessionId: company.sessionId,
    activeRole: "company",
    accountStatus: "active",
    email: company.email,
    displayName: "Expiry Company",
    createdAt: now,
    lastSeenAt: now,
    expiresAt: "2099-01-01T00:00:00.000Z",
    tenantMembership: {
      tenantId: company.tenantId,
      tenantStatus: "active",
      membershipId: company.membershipId,
      role: "owner",
      status: "active",
      overrides: []
    },
    authorizedTenantPermission: "company.workforce.manage"
  });
}

test("M1.10 expiry lifecycle helper exists and converts stale pending/active resources to durable expired states", async () => {
  assert.equal(typeof expireCompanyWorkforceResources, "function");
  const database = await migratedDatabase();
  try {
    const company = await seedCompany(database);
    const createdAt = "2026-08-01T12:00:00.000Z";
    const expiredAt = "2026-08-10T12:00:00.000Z";
    await database.query(
      `INSERT INTO company_worker_invitations (
         invitation_id,tenant_id,email_normalized,token_hash,invitation_status,
         payment_responsibility,invited_by_membership_id,resend_count,
         resend_available_at,expires_at,created_at,updated_at
       ) VALUES ($1,$2,$3,$4,'pending','worker',$5,0,$6,$7,$8,$8)`,
      [
        oid("worker_invitation", "E"), company.tenantId,
        "expired-worker@example.com", "expired-invitation-hash",
        company.membershipId, "2026-08-01T12:05:00.000Z", expiredAt, createdAt
      ]
    );
    await database.query(
      `INSERT INTO company_registration_codes (
         code_id,tenant_id,code_hash,code_status,usage_limit,usage_count,
         payment_responsibility,created_by_membership_id,expires_at,created_at,updated_at
       ) VALUES ($1,$2,$3,'active',5,0,'worker',$4,$5,$6,$6)`,
      [oid("company_code", "E"), company.tenantId, "expired-code-hash", company.membershipId, expiredAt, createdAt]
    );

    await expireCompanyWorkforceResources(database, company.tenantId, START);

    const invitation = await database.query(
      `SELECT invitation_status,expired_at
       FROM company_worker_invitations WHERE tenant_id=$1`,
      [company.tenantId]
    );
    assert.equal(invitation.rows[0]?.invitation_status, "expired");
    assert.equal(new Date(invitation.rows[0]?.expired_at).toISOString(), START.toISOString());
    const code = await database.query(
      `SELECT code_status,expired_at
       FROM company_registration_codes WHERE tenant_id=$1`,
      [company.tenantId]
    );
    assert.equal(code.rows[0]?.code_status, "expired");
    assert.equal(new Date(code.rows[0]?.expired_at).toISOString(), START.toISOString());
  } finally {
    await database.close();
  }
});

test("M1.10 inviteWorker expires a stale pending invitation before creating a fresh invitation for the same email", async () => {
  const database = await migratedDatabase();
  try {
    const company = await seedCompany(database);
    let clock = new Date(START);
    const service = new CompanyWorkforceService(database, PEPPER, () => new Date(clock));
    const first = await service.inviteWorker(principal(company), {
      email: "repeat-worker@example.com",
      siteId: null,
      departmentId: null,
      paymentResponsibility: "worker",
      assessmentReference: null
    });
    clock = new Date(START.getTime() + 8 * 24 * 60 * 60 * 1000);
    const second = await service.inviteWorker(principal(company), {
      email: "repeat-worker@example.com",
      siteId: null,
      departmentId: null,
      paymentResponsibility: "worker",
      assessmentReference: null
    });
    assert.notEqual(second.invitationId, first.invitationId);
    const rows = await database.query(
      `SELECT invitation_id,invitation_status
       FROM company_worker_invitations
       WHERE tenant_id=$1 AND email_normalized=$2
       ORDER BY created_at`,
      [company.tenantId, "repeat-worker@example.com"]
    );
    assert.deepEqual(
      rows.rows.map((row) => row.invitation_status),
      ["expired", "pending"]
    );
  } finally {
    await database.close();
  }
});
