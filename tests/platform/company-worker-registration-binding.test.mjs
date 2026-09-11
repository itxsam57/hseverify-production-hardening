import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_COMPANY_WORKFORCE_RUNTIME_DIST;
assert.ok(runtime, "HSE_COMPANY_WORKFORCE_RUNTIME_DIST is required");

const workforceModule = await import(
  pathToFileURL(join(runtime, "company", "company-workforce-service.js")).href
);
const registrationModule = await import(
  pathToFileURL(join(runtime, "company", "company-workforce-registration-service.js")).href
);
const authDomain = await import(
  pathToFileURL(join(runtime, "auth", "auth-domain.js")).href
);

const { CompanyWorkforceService, CompanyWorkforceAccessError, CompanyWorkforceSecretError } = workforceModule;
const { CompanyWorkforceRegistrationService } = registrationModule;

const NOW = "2026-08-16T12:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";
const PEPPER = "m1-10-registration-binding-pepper-with-more-than-thirty-two-characters";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m1-10-registration-binding",
  sessionSecret: "m1-10-registration-binding-session-secret-with-more-than-thirty-two-characters",
  authPepper: PEPPER,
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};
const oid = (prefix, character) => `${prefix}_${character.repeat(24)}`;

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, "0028_company_worker_invitations_codes");
  return db;
}

async function seedCompany(db, character) {
  const company = {
    accountId: `account_binding_company_${character}`,
    tenantId: oid("tenant", character),
    membershipId: oid("membership", character),
    sessionId: `session_binding_company_${character}`,
    email: `binding-company-${character.toLowerCase()}@example.com`
  };
  await db.query(
    `INSERT INTO auth_accounts
      (account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
     VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [company.accountId, company.email, `Binding Company ${character}`, "scrypt$16384$8$1$salt$hash", NOW]
  );
  await db.query(`INSERT INTO auth_account_roles (account_id,role,created_at) VALUES ($1,'company',$2)`, [company.accountId, NOW]);
  await db.query(
    `INSERT INTO platform_tenants
      (tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at,activated_at)
     VALUES ($1,'company',$2,'active',$3,$4,$4,$4)`,
    [company.tenantId, `Binding Company ${character}`, company.accountId, NOW]
  );
  await db.query(
    `INSERT INTO auth_tenant_memberships
      (membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at)
     VALUES ($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`,
    [company.membershipId, company.tenantId, company.accountId, NOW]
  );
  await db.query(
    `INSERT INTO auth_sessions
      (session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at)
     VALUES ($1,$2,'company',$3,$4,$5,$5,$6)`,
    [company.sessionId, company.accountId, `company-token-${character}`, `company-csrf-${character}`, NOW, FUTURE]
  );
  await db.query(
    `INSERT INTO company_verification_cases
      (case_id,tenant_id,owner_account_id,case_status,lock_version,created_at,updated_at,verified_at)
     VALUES ($1,$2,$3,'verified',0,$4,$4,$4)`,
    [oid("company_verification", character), company.tenantId, company.accountId, NOW]
  );
  return company;
}

function companyPrincipal(company) {
  return Object.freeze({
    accountId: company.accountId,
    sessionId: company.sessionId,
    activeRole: "company",
    accountStatus: "active",
    email: company.email,
    displayName: "Binding Company",
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FUTURE,
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

async function seedWorker(db, character, email) {
  const worker = {
    accountId: `account_binding_worker_${character}`,
    sessionId: `session_binding_worker_${character}`,
    email,
    displayName: `Binding Worker ${character}`
  };
  await db.query(
    `INSERT INTO auth_accounts
      (account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
     VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [worker.accountId, worker.email, worker.displayName, "scrypt$16384$8$1$salt$hash", NOW]
  );
  await db.query(`INSERT INTO auth_account_roles (account_id,role,created_at) VALUES ($1,'worker',$2)`, [worker.accountId, NOW]);
  await db.query(
    `INSERT INTO auth_sessions
      (session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at)
     VALUES ($1,$2,'worker',$3,$4,$5,$5,$6)`,
    [worker.sessionId, worker.accountId, `worker-token-${character}`, `worker-csrf-${character}`, NOW, FUTURE]
  );
  return worker;
}

function workerPrincipal(worker) {
  return Object.freeze({
    accountId: worker.accountId,
    sessionId: worker.sessionId,
    activeRole: "worker",
    accountStatus: "active",
    email: worker.email,
    displayName: worker.displayName,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FUTURE,
    tenantMembership: null
  });
}

async function completeRegistrationFlow(db, worker, character) {
  const rawToken = `registration-binding-${character}-${"x".repeat(40)}`;
  const registrationTokenHash = authDomain.hashOpaqueValue(rawToken, PEPPER, "worker-registration-flow");
  await db.query(
    `INSERT INTO auth_registration_flows
      (flow_id,account_id,token_hash,current_step,expires_at,completed_at,created_at,updated_at)
     VALUES ($1,$2,$3,'complete',$4,$5,$5,$5)`,
    [`registration_flow_binding_${character}`, worker.accountId, registrationTokenHash, FUTURE, NOW]
  );
  return { rawToken, registrationTokenHash };
}

test("M1.10 registration binding can prepare only live verified-Company invitation/code resources", async () => {
  const db = await database();
  try {
    const company = await seedCompany(db, "A");
    const workforce = new CompanyWorkforceService(db, PEPPER, () => new Date(NOW));
    const registration = new CompanyWorkforceRegistrationService(db, PEPPER, () => new Date(NOW));
    const invitation = await workforce.inviteWorker(companyPrincipal(company), {
      email: "new-worker@example.com",
      siteId: null,
      departmentId: null,
      paymentResponsibility: "worker",
      assessmentReference: null
    });
    const code = await workforce.createRegistrationCode(companyPrincipal(company), {
      usageLimit: 2,
      expiresAt: "2026-08-20T12:00:00.000Z",
      siteId: null,
      departmentId: null,
      paymentResponsibility: "company",
      assessmentReference: null
    });

    assert.deepEqual(await registration.prepareInvitation(invitation.invitationToken), {
      kind: "invitation",
      resourceId: invitation.invitationId
    });
    assert.deepEqual(await registration.prepareRegistrationCode(code.registrationCode), {
      kind: "code",
      resourceId: code.codeId
    });
    await assert.rejects(registration.prepareInvitation("wrong-invitation-secret"), CompanyWorkforceSecretError);
    await assert.rejects(registration.prepareRegistrationCode("wrong-company-code"), CompanyWorkforceSecretError);
  } finally {
    await db.close();
  }
});

test("M1.10 completed registration binding is account-bound, completion-bound and invitation-email-bound", async () => {
  const db = await database();
  try {
    const company = await seedCompany(db, "B");
    const workforce = new CompanyWorkforceService(db, PEPPER, () => new Date(NOW));
    const registration = new CompanyWorkforceRegistrationService(db, PEPPER, () => new Date(NOW));
    const invitation = await workforce.inviteWorker(companyPrincipal(company), {
      email: "bound-worker@example.com",
      siteId: null,
      departmentId: null,
      paymentResponsibility: "company",
      assessmentReference: "future-ref"
    });
    const prepared = await registration.prepareInvitation(invitation.invitationToken);
    await registration.assertRegistrationEmail(prepared, "BOUND-WORKER@EXAMPLE.COM ");
    await assert.rejects(
      registration.assertRegistrationEmail(prepared, "different-worker@example.com"),
      CompanyWorkforceAccessError
    );

    const worker = await seedWorker(db, "B", "bound-worker@example.com");
    const other = await seedWorker(db, "C", "other-worker@example.com");
    const flow = await completeRegistrationFlow(db, worker, "B");
    const binding = { ...prepared, registrationTokenHash: flow.registrationTokenHash };

    await assert.rejects(
      registration.completeBinding(workerPrincipal(other), binding),
      CompanyWorkforceAccessError,
      "a signed binding cannot be transplanted to another Worker account"
    );
    const link = await registration.completeBinding(workerPrincipal(worker), binding);
    assert.equal(link.status, "active");
    assert.equal(link.workerAccountId, worker.accountId);
    assert.equal(link.tenantId, company.tenantId);
    assert.equal((await registration.completeBinding(workerPrincipal(worker), binding)).linkId, link.linkId);
  } finally {
    await db.close();
  }
});

test("M1.10 completed registration-code binding consumes code capacity only after verified registration is complete", async () => {
  const db = await database();
  try {
    const company = await seedCompany(db, "D");
    const workforce = new CompanyWorkforceService(db, PEPPER, () => new Date(NOW));
    const registration = new CompanyWorkforceRegistrationService(db, PEPPER, () => new Date(NOW));
    const code = await workforce.createRegistrationCode(companyPrincipal(company), {
      usageLimit: 1,
      expiresAt: "2026-08-20T12:00:00.000Z",
      siteId: null,
      departmentId: null,
      paymentResponsibility: "worker",
      assessmentReference: null
    });
    const prepared = await registration.prepareRegistrationCode(code.registrationCode);
    const worker = await seedWorker(db, "D", "code-worker@example.com");
    const incompleteTokenHash = authDomain.hashOpaqueValue(
      "incomplete-registration-token",
      PEPPER,
      "worker-registration-flow"
    );
    await db.query(
      `INSERT INTO auth_registration_flows
        (flow_id,account_id,token_hash,current_step,expires_at,created_at,updated_at)
       VALUES ($1,$2,$3,'pending_phone',$4,$5,$5)`,
      ["registration_flow_binding_incomplete", worker.accountId, incompleteTokenHash, FUTURE, NOW]
    );
    await assert.rejects(
      registration.completeBinding(workerPrincipal(worker), {
        ...prepared,
        registrationTokenHash: incompleteTokenHash
      }),
      CompanyWorkforceAccessError
    );
    let stored = await db.query(`SELECT usage_count FROM company_registration_codes WHERE code_id=$1`, [code.codeId]);
    assert.equal(stored.rows[0].usage_count, 0);

    await db.query(
      `UPDATE auth_registration_flows
       SET current_step='complete',completed_at=$2,updated_at=$2
       WHERE token_hash=$1`,
      [incompleteTokenHash, NOW]
    );
    const link = await registration.completeBinding(workerPrincipal(worker), {
      ...prepared,
      registrationTokenHash: incompleteTokenHash
    });
    assert.equal(link.status, "active");
    stored = await db.query(`SELECT usage_count,code_status FROM company_registration_codes WHERE code_id=$1`, [code.codeId]);
    assert.equal(stored.rows[0].usage_count, 1);
    assert.equal(stored.rows[0].code_status, "exhausted");
  } finally {
    await db.close();
  }
});
