import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_COMPANY_ORGANIZATION_TEAM_RUNTIME_DIST;
assert.ok(runtime, "HSE_COMPANY_ORGANIZATION_TEAM_RUNTIME_DIST is required");

const organizationModule = await import(
  pathToFileURL(join(runtime, "company", "company-organization-repository.js")).href
);
const teamModule = await import(
  pathToFileURL(join(runtime, "company", "company-team-service.js")).href
);

const { DatabaseCompanyOrganizationRepository } = organizationModule;
const {
  CompanyTeamService,
  CompanyTeamAccessError,
  CompanyTeamConflictError
} = teamModule;

const OWNED_MIGRATION = "0027_company_organization_team_hardening";
const NOW_DATE = new Date("2026-08-11T12:30:00.000Z");
const NOW = NOW_DATE.toISOString();
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const PEPPER = "m1-09-company-team-test-pepper-with-more-than-thirty-two-characters";

const TEST_ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m1-09-company-organization-team-test",
  sessionSecret: "m1-09-company-team-session-secret-with-32-characters",
  authPepper: PEPPER,
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function opaqueId(prefix, character) {
  return `${prefix}_${character.repeat(24)}`;
}

function basePrincipal(context) {
  return {
    accountId: context.accountId,
    sessionId: context.sessionId,
    activeRole: "company",
    accountStatus: "active",
    email: context.email,
    displayName: context.displayName,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE,
    tenantMembership: {
      tenantId: context.tenantId,
      tenantStatus: "active",
      membershipId: context.membershipId,
      role: context.membershipRole,
      status: "active",
      overrides: []
    }
  };
}

function principal(context, permission) {
  return Object.freeze({
    ...basePrincipal(context),
    authorizedTenantPermission: permission
  });
}

async function insertCompanyContext(database, character, membershipRole = "owner") {
  const accountId = `account_m109_${character}`;
  const tenantId = opaqueId("tenant", character);
  const membershipId = opaqueId("membership", character);
  const sessionId = `session_m109_${character}`;
  const email = `m109-${character.toLowerCase()}@example.com`;
  const displayName = `M109 Company ${character}`;

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [accountId, email, displayName, "scrypt$16384$8$1$salt$hash", NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1,'company',$2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO platform_tenants (
       tenant_id, tenant_type, display_name, tenant_status,
       created_by_account_id, created_at, updated_at, activated_at
     ) VALUES ($1,'company',$2,'active',$3,$4,$4,$4)`,
    [tenantId, displayName, accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1,$2,$3,'company',$4,'active',$3,$5,$5,$5)`,
    [membershipId, tenantId, accountId, membershipRole, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1,$2,'company',$3,$4,$5,$5,$6)`,
    [sessionId, accountId, `token-${character}`, `csrf-${character}`, NOW, FAR_FUTURE]
  );

  return { accountId, tenantId, membershipId, sessionId, email, displayName, membershipRole };
}

async function createAcceptedInviteAccount(database, email, character) {
  const accountId = `account_m109_invited_${character}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [accountId, email, `Invited Team ${character}`, "scrypt$16384$8$1$salt$hash", NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1,'company',$2)`,
    [accountId, NOW]
  );
  return accountId;
}

async function activateTotp(database, accountId, character) {
  await database.query(
    `INSERT INTO auth_mfa_factors (
       factor_id, account_id, factor_type, encrypted_secret, factor_status,
       last_accepted_counter, created_at, activated_at
     ) VALUES ($1,$2,'totp',$3,'active',1,$4,$4)`,
    [`factor_m109_${character}`, accountId, `encrypted-${character}`, NOW]
  );
}

async function auditActions(database, tenantId) {
  const result = await database.query(
    `SELECT action_key
     FROM platform_audit_events
     WHERE actor_tenant_id=$1
     ORDER BY audit_sequence`,
    [tenantId]
  );
  return result.rows.map((row) => row.action_key);
}

test("M1.09 organization and Company Team compose tenant scope, MFA activation, live grants, history and atomic audit", async () => {
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyMigrationsThrough(database, TEST_ENVIRONMENT.releaseSha, OWNED_MIGRATION);
    const ownerA = await insertCompanyContext(database, "A");
    const ownerB = await insertCompanyContext(database, "B");

    const organization = new DatabaseCompanyOrganizationRepository(Promise.resolve(database));
    const team = new CompanyTeamService(Promise.resolve(database), PEPPER, () => new Date(NOW_DATE));
    const settingsA = principal(ownerA, "company.settings.manage");
    const settingsB = principal(ownerB, "company.settings.manage");
    const manageA = principal(ownerA, "company.members.manage");
    const readA = principal(ownerA, "company.members.read");

    const site = await organization.create(settingsA, "site", {
      name: "Islamabad Site",
      formattedAddress: "Sector I-9, Islamabad, Pakistan",
      phone: "+92510000001",
      website: "https://islamabad.example.com",
      email: "islamabad@example.com",
      registrationNumber: "SITE-001"
    });
    const department = await organization.create(settingsA, "department", {
      name: "Safety Department",
      formattedAddress: "Head Office, Islamabad, Pakistan",
      phone: "+92510000002",
      website: "https://safety.example.com",
      email: "safety@example.com",
      registrationNumber: null
    });
    assert.equal(site.tenantId, ownerA.tenantId);
    assert.equal(department.tenantId, ownerA.tenantId);

    await assert.rejects(
      organization.update(settingsB, "site", site.unitId, site.revision, {
        name: "Copied Site",
        formattedAddress: "Other Tenant",
        phone: "+92510000003",
        website: "https://copied.example.com",
        email: "copied@example.com",
        registrationNumber: null
      }),
      (error) => error?.name === "CompanyOrganizationNotFoundError"
    );
    await assert.rejects(
      organization.update(settingsB, "site", opaqueId("site", "Z"), 1, {
        name: "Missing Site",
        formattedAddress: "Other Tenant",
        phone: "+92510000004",
        website: "https://missing.example.com",
        email: "missing@example.com",
        registrationNumber: null
      }),
      (error) => error?.name === "CompanyOrganizationNotFoundError"
    );

    const invited = await team.invite(manageA, {
      email: "manager-m109@example.com",
      membershipRole: "manager",
      permissions: ["company.tenant.read", "company.workforce.read"],
      siteId: site.unitId,
      departmentId: null,
      requestFingerprint: "m1-09-manager-invite"
    });
    const invitationsBeforeAcceptance = await team.listInvitations(readA);
    assert.equal(invitationsBeforeAcceptance.length, 1);
    assert.equal(invitationsBeforeAcceptance[0].invitationId, invited.invitationId);
    assert.equal(invitationsBeforeAcceptance[0].status, "pending");
    assert.deepEqual(
      [...invitationsBeforeAcceptance[0].permissions].sort(),
      ["company.tenant.read", "company.workforce.read"].sort()
    );

    const invitedAccountId = await createAcceptedInviteAccount(
      database,
      invited.email,
      "manager"
    );
    await assert.rejects(
      database.query(
        `UPDATE auth_staff_invitations
         SET invitation_status='accepted', accepted_by_account_id=$2, accepted_at=$3
         WHERE invitation_id=$1`,
        [invited.invitationId, invitedAccountId, NOW]
      ),
      /active Company account and MFA/
    );
    const noMembership = await database.query(
      `SELECT 1 FROM auth_tenant_memberships WHERE account_id=$1`,
      [invitedAccountId]
    );
    assert.equal(noMembership.rows.length, 0);

    await activateTotp(database, invitedAccountId, "manager");
    await database.query(
      `UPDATE auth_staff_invitations
       SET invitation_status='accepted', accepted_by_account_id=$2, accepted_at=$3
       WHERE invitation_id=$1`,
      [invited.invitationId, invitedAccountId, NOW]
    );

    let members = await team.listMembers(readA);
    const manager = members.find((member) => member.accountId === invitedAccountId);
    assert.ok(manager);
    assert.equal(manager.membershipRole, "manager");
    assert.equal(manager.status, "active");
    assert.equal(manager.siteId, site.unitId);
    assert.deepEqual(
      [...manager.permissions].sort(),
      ["company.tenant.read", "company.workforce.read"].sort()
    );

    const assignmentBeforeArchive = await database.query(
      `SELECT assignment_id, ended_at
       FROM company_team_unit_assignments
       WHERE tenant_id=$1 AND membership_id=$2
       ORDER BY assigned_at`,
      [ownerA.tenantId, manager.membershipId]
    );
    assert.equal(assignmentBeforeArchive.rows.length, 1);
    assert.equal(assignmentBeforeArchive.rows[0].ended_at, null);

    const archived = await organization.archive(settingsA, "site", site.unitId, site.revision);
    assert.equal(archived.status, "archived");
    const endedByArchive = await database.query(
      `SELECT ended_at, ended_reason
       FROM company_team_unit_assignments
       WHERE tenant_id=$1 AND membership_id=$2`,
      [ownerA.tenantId, manager.membershipId]
    );
    assert.ok(endedByArchive.rows[0].ended_at);
    assert.equal(endedByArchive.rows[0].ended_reason, "Site archived");

    const restored = await organization.restore(
      settingsA,
      "site",
      site.unitId,
      archived.revision
    );
    assert.equal(restored.status, "active");
    const activeAfterRestore = await database.query(
      `SELECT 1 FROM company_team_unit_assignments
       WHERE tenant_id=$1 AND membership_id=$2 AND ended_at IS NULL`,
      [ownerA.tenantId, manager.membershipId]
    );
    assert.equal(activeAfterRestore.rows.length, 0);

    const updatedManager = await team.updateMember(manageA, {
      membershipId: manager.membershipId,
      expectedRole: "manager",
      expectedStatus: "active",
      membershipRole: "viewer",
      permissions: ["company.tenant.read"],
      siteId: null,
      departmentId: department.unitId
    });
    assert.equal(updatedManager.membershipRole, "viewer");
    assert.equal(updatedManager.departmentId, department.unitId);
    assert.deepEqual(updatedManager.permissions, ["company.tenant.read"]);

    const stalePrincipal = principal(ownerA, "company.members.manage");
    await database.query(
      `INSERT INTO auth_tenant_permission_overrides (
         membership_id, membership_role, permission_key, effect,
         created_by_account_id, reason, created_at
       ) VALUES ($1,'owner','company.reports.export','deny',$2,$3,$4)`,
      [ownerA.membershipId, ownerA.accountId, "Live permission removed", NOW]
    );
    await assert.rejects(
      team.invite(stalePrincipal, {
        email: "blocked-grant@example.com",
        membershipRole: "manager",
        permissions: ["company.reports.export"],
        requestFingerprint: "m1-09-live-permission-denial"
      }),
      CompanyTeamAccessError
    );

    await assert.rejects(
      team.updateMember(manageA, {
        membershipId: ownerB.membershipId,
        expectedRole: "owner",
        expectedStatus: "active",
        membershipRole: "viewer",
        permissions: ["company.tenant.read"]
      }),
      CompanyTeamAccessError
    );
    await assert.rejects(
      team.updateMember(manageA, {
        membershipId: opaqueId("membership", "Z"),
        expectedRole: "owner",
        expectedStatus: "active",
        membershipRole: "viewer",
        permissions: ["company.tenant.read"]
      }),
      CompanyTeamAccessError
    );
    await assert.rejects(
      team.updateMember(manageA, {
        membershipId: ownerA.membershipId,
        expectedRole: "owner",
        expectedStatus: "active",
        membershipRole: "viewer",
        permissions: ["company.tenant.read"]
      }),
      CompanyTeamAccessError
    );

    await assert.rejects(
      database.query(
        `UPDATE auth_tenant_memberships
         SET membership_status='suspended', suspended_at=$2, updated_at=$2
         WHERE membership_id=$1`,
        [ownerA.membershipId, NOW]
      ),
      /retain at least one active owner/
    );

    const suspended = await team.changeMemberStatus(manageA, {
      membershipId: manager.membershipId,
      expectedStatus: "active",
      targetStatus: "suspended"
    });
    assert.equal(suspended.status, "suspended");
    assert.equal(suspended.departmentId, null);
    const historyAfterSuspend = await database.query(
      `SELECT ended_at, ended_reason
       FROM company_team_unit_assignments
       WHERE tenant_id=$1 AND membership_id=$2
       ORDER BY assigned_at`,
      [ownerA.tenantId, manager.membershipId]
    );
    assert.equal(historyAfterSuspend.rows.length, 2);
    assert.equal(historyAfterSuspend.rows.every((row) => Boolean(row.ended_at)), true);
    assert.deepEqual(
      historyAfterSuspend.rows.map((row) => row.ended_reason).sort(),
      ["Membership suspended", "Site archived"].sort()
    );

    const reactivated = await team.changeMemberStatus(manageA, {
      membershipId: manager.membershipId,
      expectedStatus: "suspended",
      targetStatus: "active"
    });
    assert.equal(reactivated.status, "active");
    assert.equal(reactivated.siteId, null);
    assert.equal(reactivated.departmentId, null);
    const activeAfterReactivation = await database.query(
      `SELECT 1 FROM company_team_unit_assignments
       WHERE tenant_id=$1 AND membership_id=$2 AND ended_at IS NULL`,
      [ownerA.tenantId, manager.membershipId]
    );
    assert.equal(activeAfterReactivation.rows.length, 0);

    const cancelled = await team.invite(manageA, {
      email: "cancel-me@example.com",
      membershipRole: "viewer",
      permissions: ["company.tenant.read"],
      requestFingerprint: "m1-09-cancel-invite"
    });
    await team.cancelInvitation(manageA, cancelled.invitationId);
    const invitationsAfterCancel = await team.listInvitations(readA);
    assert.equal(
      invitationsAfterCancel.find((item) => item.invitationId === cancelled.invitationId)?.status,
      "revoked"
    );

    const actions = await auditActions(database, ownerA.tenantId);
    for (const expected of [
      "company_organization.created",
      "company_organization.archived",
      "company_organization.restored",
      "company_team.invitation.created",
      "company_team.invitation.revoked",
      "company_team.membership.updated",
      "company_team.membership.suspended",
      "company_team.membership.reactivated"
    ]) {
      assert.ok(actions.includes(expected), `Missing atomic audit action ${expected}`);
    }

    members = await team.listMembers(readA);
    assert.ok(members.every((member) => member.membershipId !== ownerB.membershipId));
  } finally {
    await database.close();
  }
});

test("M1.09 Company admin cannot grant admin/owner authority", async () => {
  const database = await openScriptDatabase({
    ...TEST_ENVIRONMENT,
    releaseSha: "m1-09-admin-ceiling-test"
  });
  try {
    await applyMigrationsThrough(database, "m1-09-admin-ceiling-test", OWNED_MIGRATION);
    const admin = await insertCompanyContext(database, "C", "admin");
    const service = new CompanyTeamService(Promise.resolve(database), PEPPER, () => new Date(NOW_DATE));
    const manage = principal(admin, "company.members.manage");
    await assert.rejects(
      service.invite(manage, {
        email: "forbidden-admin@example.com",
        membershipRole: "admin",
        permissions: ["company.tenant.read"],
        requestFingerprint: "m1-09-admin-cannot-grant-admin"
      }),
      CompanyTeamAccessError
    );
    await assert.rejects(
      service.invite(manage, {
        email: "forbidden-owner@example.com",
        membershipRole: "owner",
        permissions: ["company.tenant.read"],
        requestFingerprint: "m1-09-admin-cannot-grant-owner"
      }),
      CompanyTeamAccessError
    );
  } finally {
    await database.close();
  }
});
