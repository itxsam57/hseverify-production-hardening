import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_COMPANY_ORGANIZATION_TEAM_RUNTIME_DIST ??
  ".company-organization-team-runtime-test-dist";

if (!process.env.HSE_COMPANY_ORGANIZATION_TEAM_RUNTIME_DIST) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    ["scripts/run-company-organization-team-tests.mjs"],
    { stdio: "inherit", env: { ...process.env, HSE_COMPANY_ORGANIZATION_TEAM_SKIP_TEST: "1" } }
  );
  assert.equal(result.status, 0, "M1.09 runtime preparation failed");
}

const organizationModule = await import(
  pathToFileURL(join(runtime, "company", "company-organization-repository.js")).href
);
const teamModule = await import(
  pathToFileURL(join(runtime, "company", "company-team-service.js")).href
);

const { DatabaseCompanyOrganizationRepository } = organizationModule;
const { AuthorizationContextRepository } = await import(
  pathToFileURL(join(runtime,"authorization","authorization-context-repository.js")).href
);
const { AuthenticationRepository } = await import(
  pathToFileURL(join(runtime,"auth","auth-repository.js")).href
);
const {resolveSessionAuthorizationContext,authorizeCurrentTenantPermission,authorizePortalEntry} = await import(
  pathToFileURL(join(runtime,"authorization","authorization-context-domain.js")).href
);
const { CompanyWorkforceWorkerReadRepository } = await import(
  pathToFileURL(join(runtime, "company", "company-workforce-worker-read-repository.js")).href
);
const {
  CompanyTeamService,
  CompanyTeamAccessError
} = teamModule;

const OWNED_MIGRATION = "0133_company_team_access_revision_cas";
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
      expectedAccessRevision: manager.accessRevision,
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
        expectedAccessRevision: 1,
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
        expectedAccessRevision: 1,
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
        expectedAccessRevision: 1,
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
      expectedAccessRevision: updatedManager.accessRevision,
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
      expectedAccessRevision: suspended.accessRevision,
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
test("M1.09 Worker unit archive clears live scope, retains immutable per-link history and rolls back with audit", async () => {
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyMigrationsThrough(database, TEST_ENVIRONMENT.releaseSha, "0028_company_worker_invitations_codes");
    const owner = await insertCompanyContext(database, "D");
    const organization = new DatabaseCompanyOrganizationRepository(Promise.resolve(database));
    const settings = principal(owner, "company.settings.manage");
    const draft = { name:"Worker Archive Site", formattedAddress:"Islamabad", phone:"+92510000002", website:"https://archive.example.test", email:"archive@example.test", registrationNumber:null };
    const site = await organization.create(settings,"site",draft);
    const department = await organization.create(settings,"department",{...draft,name:"Worker Archive Department"});
    const workerId="worker_archive_account";
    await database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'worker-archive@example.test','Archive Worker','active','scrypt$16384$8$1$salt$hash',$2,$2,$2,$2)",[workerId,NOW]);
    await database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)",[workerId,NOW]);
    const codeId=opaqueId("company_code","D"), linkId=opaqueId("company_worker_link","D");
    await database.query("INSERT INTO company_registration_codes(code_id,tenant_id,code_hash,usage_limit,created_by_membership_id,expires_at) VALUES($1,$2,'worker-archive-code-hash',2,$3,$4)",[codeId,owner.tenantId,owner.membershipId,FAR_FUTURE]);
    await database.query("INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,link_source,code_id,link_status,site_id,department_id,worker_accepted_at,activated_at) VALUES($1,$2,$3,'code',$4,'active',$5,$6,$7,$7)",[linkId,owner.tenantId,workerId,codeId,site.unitId,department.unitId,NOW]);
    await database.query("CREATE FUNCTION fail_worker_archive_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='company_organization.archived' THEN RAISE EXCEPTION 'required archive audit fault'; END IF; RETURN NEW; END $$");
    await database.query("CREATE TRIGGER worker_archive_audit_fault BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION fail_worker_archive_audit()");
    await assert.rejects(organization.archive(settings,"site",site.unitId,site.revision),/required archive audit fault/);
    const retained=await database.query("SELECT site_id,department_id FROM company_worker_links WHERE link_id=$1",[linkId]);
    assert.equal(retained.rows[0].site_id,site.unitId);
    assert.equal(retained.rows[0].department_id,department.unitId);
    assert.equal((await database.query("SELECT site_status FROM company_sites WHERE site_id=$1",[site.unitId])).rows[0].site_status,"active");
    await database.query("DROP TRIGGER worker_archive_audit_fault ON platform_audit_events");
    const archivedSite=await organization.archive(settings,"site",site.unitId,site.revision);
    const afterSite=await database.query("SELECT site_id,department_id,link_status,code_id FROM company_worker_links WHERE link_id=$1",[linkId]);
    assert.equal(afterSite.rows[0].site_id,null);
    assert.equal(afterSite.rows[0].department_id,department.unitId);
    await assert.rejects(database.query("UPDATE company_worker_links SET site_id=$2 WHERE link_id=$1",[linkId,site.unitId]),/site is unavailable/);
    await organization.archive(settings,"department",department.unitId,department.revision);
    await assert.rejects(database.query("UPDATE company_worker_links SET department_id=$2 WHERE link_id=$1",[linkId,department.unitId]),/department is unavailable/);
    await organization.restore(settings,"site",site.unitId,archivedSite.revision);
    const final=await database.query("SELECT site_id,department_id,link_status,code_id FROM company_worker_links WHERE link_id=$1",[linkId]);
    assert.equal(final.rows[0].site_id,null);assert.equal(final.rows[0].department_id,null);
    assert.equal(final.rows[0].link_status,"active");assert.equal(final.rows[0].code_id,codeId);
    const history=await database.query("SELECT audit_event_id,metadata FROM platform_audit_events WHERE actor_tenant_id=$1 AND metadata->>'workerLinkId'=$2 ORDER BY audit_sequence",[owner.tenantId,linkId]);
    assert.equal(history.rows.length,2);
    assert.equal(history.rows[0].metadata.previousSiteId,site.unitId);
    assert.equal(history.rows[0].metadata.previousDepartmentId,department.unitId);
    assert.equal(history.rows[1].metadata.previousSiteId,null);
    assert.equal(history.rows[1].metadata.previousDepartmentId,department.unitId);
    await assert.rejects(database.query("DELETE FROM platform_audit_events WHERE audit_event_id=$1",[history.rows[0].audit_event_id]),/append-only|immutable/i);
    console.log("ACTUAL_WORKER_ARCHIVE native site/department unassignment, prior scope/source retained, no restore reassignment, archived new assignment denied and required audit rollback");
  } finally { await database.close(); }
});

async function m10901RealPostgresDatabase(scenario="M10901") {
  const raw = process.env[`HSE_${scenario}_POSTGRES_TEST_DATABASE_URL`];
  if (!raw) throw new Error("M10901 test requires explicit approved isolated PostgreSQL16.");
  const url = new URL(raw);
  if (!["localhost","127.0.0.1"].includes(url.hostname) || url.pathname !== "/postgres") {
    throw new Error("M10901 never opens an external/shared application or production database.");
  }
  const root = await openScriptDatabase({
    ...TEST_ENVIRONMENT,databaseDriver:"postgres",databaseUrl:url.href,releaseSha:"m10901-supervisor"
  });
  const dbName = scenario.toLowerCase()+"_two_staff_units_"+process.pid+"_"+Date.now();
  let created=false, first, second;
  try {
    await root.execute('CREATE DATABASE "'+dbName+'"');
    created=true;
    url.pathname = "/"+dbName;
    const env = {...TEST_ENVIRONMENT,databaseDriver:"postgres",
      databaseUrl:url.href,releaseSha:scenario.toLowerCase()+"-unit-race-"+process.pid};
    first = await openScriptDatabase(env);
    const ceiling = scenario === "M10901"
      ? "0130_verified_identity_correction_notices"
      : scenario === "M10902"
        ? "0131_company_workforce_archive_scope_serialization"
        : "0133_company_team_access_revision_cas";
    await applyMigrationsThrough(first,env.releaseSha,ceiling);
    second = await openScriptDatabase(env);
    return {first,second,cleanup:async()=>{
      try{await second.close();}
      finally{try{await first.close();}
        finally{try{await root.execute('DROP DATABASE "'+dbName+'"');}
          finally{await root.close();}}}
    }};
  } catch(error) {
    if(second) await second.close();
    if(first) await first.close();
    try{if(created) await root.execute('DROP DATABASE "'+dbName+'"');}
    finally{await root.close();}
    throw error;
  }
}
function holdM10901SuccessfulTransactionUntilReleased(client) {
  let signal;
  let release;
  const reached = new Promise(resolve=>{signal=resolve;});
  const held = new Promise(resolve=>{release=resolve;});
  const repository = new DatabaseCompanyOrganizationRepository(Promise.resolve({
    transaction: callback => client.transaction(async tx=>{
      const result=await callback(tx);
      signal();
      await held;
      return result;
    })
  }));
  return {repository,reached,release};
}

test("M1.09.01 actual PostgreSQL16 two Company staff race site archive and department edit with strict unit revision",{
  skip:!process.env.HSE_M10901_POSTGRES_TEST_DATABASE_URL,timeout:140000
},async()=>{
  const {first,second,cleanup}=await m10901RealPostgresDatabase();
  let releaseRaceA,releaseRaceB,pendingA,pendingB;
  try{
    const ownerA=await insertCompanyContext(first,"A");
    const otherTenantOwner=await insertCompanyContext(first,"B");
    const staff=await insertCompanyContext(first,"C","admin");
    await first.query("UPDATE auth_tenant_memberships SET tenant_id=$1 WHERE membership_id=$2",
      [ownerA.tenantId,staff.membershipId]);
    const pOwner=principal(ownerA,"company.settings.manage");
    const pStaff=principal({...staff,tenantId:ownerA.tenantId},"company.settings.manage");
    const pForeign=principal(otherTenantOwner,"company.settings.manage");
    const firstRepo=new DatabaseCompanyOrganizationRepository(Promise.resolve(first));
    const secondRepo=new DatabaseCompanyOrganizationRepository(Promise.resolve(second));
    const initialSite={
      name:"M10901 original Islamabad site",formattedAddress:"Islamabad, Pakistan",
      phone:"+92510000101",website:"https://unit-site.example.test",
      email:"unit-site@example.test",registrationNumber:null
    };
    const initialDept={
      name:"M10901 original safety department",formattedAddress:"Islamabad, Pakistan",
      phone:"+92510000102",website:"https://unit-department.example.test",
      email:"unit-dept@example.test",registrationNumber:null
    };
    const site=await firstRepo.create(pOwner,"site",initialSite);
    const department=await firstRepo.create(pOwner,"department",initialDept);
    assert.equal(site.revision,1);
    assert.equal(department.revision,1);

    // Hold an actual committed-write transaction open while a second
    // separately authenticated Company Admin attempts the stale edit.
    const raceSite=holdM10901SuccessfulTransactionUntilReleased(first);
    releaseRaceA=raceSite.release;
    pendingA=raceSite.repository.archive(pOwner,"site",site.unitId,site.revision);
    await raceSite.reached;
    pendingB=secondRepo.update(pStaff,"site",site.unitId,site.revision,{
      ...initialSite,name:"ATTACK stale site overwrite"
    }).then(value=>({accepted:true,value}),error=>({accepted:false,name:error.name,message:error.message}));
    const earlySite=await Promise.race([
      pendingB.then(()=>"second-finished-before-first-commit"),
      new Promise(resolve=>setTimeout(()=>resolve("waiting-for-first-commit"),1000))
    ]);
    assert.equal(earlySite,"waiting-for-first-commit");
    raceSite.release();
    releaseRaceA=null;
    const archived=await pendingA;
    assert.equal(archived.status,"archived");
    assert.equal(archived.revision,site.revision+1);
    const staleSite=await pendingB;
    assert.equal(staleSite.accepted,false);
    assert.equal(staleSite.name,"CompanyOrganizationConflictError");
    const rowSite=(await first.query(
      "SELECT name,site_status,revision,tenant_id FROM company_sites WHERE site_id=$1",
      [site.unitId])).rows[0];
    assert.equal(rowSite.name,initialSite.name);
    assert.equal(rowSite.site_status,"archived");
    assert.equal(Number(rowSite.revision),2);
    assert.equal(rowSite.tenant_id,ownerA.tenantId);
    await assert.rejects(
      secondRepo.update(pStaff,"site",site.unitId,archived.revision,{
        ...initialSite,name:"Forbidden edit of archived site"
      }),error=>error?.name==="CompanyOrganizationConflictError");
    await assert.rejects(
      secondRepo.restore(pStaff,"site",site.unitId,site.revision),
      error=>error?.name==="CompanyOrganizationConflictError");
    await assert.rejects(
      secondRepo.restore(pForeign,"site",site.unitId,archived.revision),
      error=>error?.name==="CompanyOrganizationNotFoundError");
    const restored=await secondRepo.restore(pStaff,"site",site.unitId,archived.revision);
    assert.equal(restored.status,"active");
    assert.equal(restored.revision,3);
    const siteAudit=(await first.query(
      "SELECT action_key,actor_account_id FROM platform_audit_events WHERE target_reference=$1 ORDER BY audit_sequence",
      [site.unitId])).rows;
    assert.deepEqual(siteAudit.map(x=>x.action_key),[
      "company_organization.created","company_organization.archived","company_organization.restored"
    ]);
    assert.deepEqual(siteAudit.map(x=>x.actor_account_id),[
      ownerA.accountId,ownerA.accountId,staff.accountId
    ]);
    console.log("M10901_ACTUAL_PG16_STAFF_UNIT_RACE_STALE_DENIED",
      "two independent authenticated Owner/Admin sessions; site archive blocks concurrent stale edit until commit; stale edit/replay and foreign restore denied; one archived + one authorized restored audit; no overwrite");

    // Reverse the conflict for the department: Admin editing competes with
    // the Owner's archive on the *same* initial revision.
    const raceDept=holdM10901SuccessfulTransactionUntilReleased(first);
    releaseRaceB=raceDept.release;
    pendingA=raceDept.repository.update(pStaff,"department",department.unitId,
      department.revision,{...initialDept,name:"M10901 independently reviewed safety department"});
    await raceDept.reached;
    pendingB=secondRepo.archive(pOwner,"department",department.unitId,department.revision)
      .then(value=>({accepted:true,value}),error=>({accepted:false,name:error.name,message:error.message}));
    const earlyDept=await Promise.race([
      pendingB.then(()=>"second-finished-before-first-commit"),
      new Promise(resolve=>setTimeout(()=>resolve("waiting-for-first-commit"),1000))
    ]);
    assert.equal(earlyDept,"waiting-for-first-commit");
    raceDept.release();
    releaseRaceB=null;
    const updated=await pendingA;
    assert.equal(updated.status,"active");
    assert.equal(updated.revision,2);
    const staleArchive=await pendingB;
    assert.equal(staleArchive.accepted,false);
    assert.equal(staleArchive.name,"CompanyOrganizationConflictError");
    const recorded=(await first.query(
      "SELECT name,department_status,revision FROM company_departments WHERE department_id=$1",
      [department.unitId])).rows[0];
    assert.equal(recorded.name,updated.name);
    assert.equal(recorded.department_status,"active");
    assert.equal(Number(recorded.revision),2);
    const deptArchived=await secondRepo.archive(pOwner,"department",department.unitId,updated.revision);
    assert.equal(deptArchived.revision,3);
    assert.equal(deptArchived.status,"archived");
    const deptRestored=await firstRepo.restore(pStaff,"department",department.unitId,deptArchived.revision);
    assert.equal(deptRestored.revision,4);
    assert.equal(deptRestored.status,"active");
    const deptAudit=(await first.query(
      "SELECT action_key,actor_account_id FROM platform_audit_events WHERE target_reference=$1 ORDER BY audit_sequence",
      [department.unitId])).rows;
    assert.deepEqual(deptAudit.map(x=>x.action_key),[
      "company_organization.created","company_organization.updated",
      "company_organization.archived","company_organization.restored"
    ]);
    assert.deepEqual(deptAudit.map(x=>x.actor_account_id),[
      ownerA.accountId,staff.accountId,ownerA.accountId,staff.accountId
    ]);
    const otherTenant=(await first.query(
      "SELECT count(*)::int n FROM company_sites WHERE tenant_id=$1 AND site_id=$2",
      [otherTenantOwner.tenantId,site.unitId])).rows[0].n;
    assert.equal(otherTenant,0);
    console.log("M10901_ACTUAL_PG16_SITE_DEPT_HISTORY_IMMUTABLE_DB",
      "department admin edit wins Owner stale archive, fresh Owner archive and Admin restore each once; original foreign tenant untouched; version revision4 and 4 immutable audit records");
  }finally{
    releaseRaceA?.();
    releaseRaceB?.();
    await Promise.allSettled([pendingA,pendingB]);
    await cleanup();
  }
});

test("M1.09.02 actual PostgreSQL16 concurrent archive versus new Worker placement retains Worker receiving state and immutable audit", {
  skip: !process.env.HSE_M10902_POSTGRES_TEST_DATABASE_URL,
  timeout: 180000
}, async () => {
  const { first, second, cleanup } = await m10901RealPostgresDatabase("M10902");
  let currentRelease = null;
  try {
    const owner = await insertCompanyContext(first, "Q");
    const foreign = await insertCompanyContext(first, "R");
    const actor = principal(owner, "company.settings.manage");
    const foreignActor = principal(foreign, "company.settings.manage");
    const repository = new DatabaseCompanyOrganizationRepository(Promise.resolve(first));
    const workerReader = new CompanyWorkforceWorkerReadRepository(Promise.resolve(second), () => new Date(NOW_DATE));
    const draft = { name: "Real archive race site", formattedAddress: "Islamabad", phone: "+92510000111", website: "https://archive-race.example.test", email: "site-race@example.test", registrationNumber: null };
    const otherSite = await repository.create(foreignActor, "site", {...draft, name: "Foreign retained site"});

    for (const kind of ["site", "department"]) {
      const suffix = kind === "site" ? "S" : "D";
      const site = await repository.create(actor, "site", {...draft, name: `Scoped ${kind} site`});
      const dept = await repository.create(actor, "department", {...draft, name: `Scoped ${kind} department`});
      const target = kind === "site" ? site : dept;
      const codeId = opaqueId("company_code",suffix);
      await first.query("INSERT INTO company_registration_codes(code_id,tenant_id,code_hash,usage_limit,created_by_membership_id,expires_at) VALUES($1,$2,$3,3,$4,$5)",
        [codeId,owner.tenantId,`m10902-race-code-${suffix}`,owner.membershipId,FAR_FUTURE]);
      const workerSessions = [];
      for (const order of ["A", "B"]) {
        const accountId = `m10902_worker_${suffix}${order}`;
        const sessionId = `m10902_worker_session_${suffix}${order}`;
        const email = `m10902-worker-${suffix}${order}@example.test`.toLowerCase();
        await first.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$3,'active','scrypt$16384$8$1$salt$hash',$4,$4,$4,$4)",
          [accountId,email,`M10902 Worker ${suffix}${order}`,NOW]);
        await first.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)",[accountId,NOW]);
        await first.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,'worker',$3,$4,$5,$5,$6)",
          [sessionId,accountId,`m10902-token-${suffix}${order}`,`m10902-csrf-${suffix}${order}`,NOW,FAR_FUTURE]);
        workerSessions.push({accountId,sessionId,email,activeRole:"worker",accountStatus:"active",tenantMembership:null});
      }
      const linkA = opaqueId("company_worker_link", suffix);
      const linkB = opaqueId("company_worker_link", suffix.toLowerCase());
      const linkSql = `INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,link_source,code_id,link_status,site_id,department_id,worker_accepted_at,activated_at)
           VALUES($1,$2,$3,'code',$4,'active',$5,$6,$7,$7)`;
      const argsFor = (linkId,index) => [linkId,owner.tenantId,workerSessions[index].accountId,codeId,site.unitId,dept.unitId,NOW];
      await first.query(linkSql,argsFor(linkA,0));
      const before = await workerReader.listLinks(workerSessions[0]);
      assert.equal(before.length,1);
      assert.equal(before[0].siteName,site.name);
      assert.equal(before[0].departmentName,dept.name);
      await assert.rejects(workerReader.listLinks({...workerSessions[0],activeRole:"company"}), /access|denied|unavailable/i);

      const held = holdM10901SuccessfulTransactionUntilReleased(first);
      const archiving = held.repository.archive(actor,kind,target.unitId,target.revision);
      currentRelease = held.release;
      await held.reached;
      // The competing connection legitimately has an active authenticated Worker,
      // but must not create a new placement into the archived unit in any interleaving.
      const competing = second.query(linkSql,argsFor(linkB,1)).then(()=>({ok:true}),error=>({ok:false,error}));
      const early = await Promise.race([competing, new Promise(resolve=>setTimeout(()=>resolve({pending:true}),350))]);
      console.log(`M10902_REAL_PG16_ARCHIVE_PLACEMENT_INTERLEAVING kind=${kind} early=${early.pending ? "pending" : early.ok ? "INSERT_BEFORE_ARCHIVE_COMMIT" : "rejected"}`);
      currentRelease();currentRelease=null;
      const archived = await archiving;
      assert.equal(archived.status,"archived");
      const outcome = await competing;
      if (!outcome.ok) assert.match(outcome.error.message,/site is unavailable|department is unavailable|lock|deadlock|serialization/i);
      const actual = await second.query("SELECT link_id,site_id,department_id,link_status,code_id FROM company_worker_links WHERE tenant_id=$1 AND worker_account_id IN ($2,$3) ORDER BY worker_account_id",
        [owner.tenantId,workerSessions[0].accountId,workerSessions[1].accountId]);
      assert.equal(actual.rows.length,outcome.ok?2:1);
      for (const link of actual.rows) {
        assert.equal(link[kind === "site"?"site_id":"department_id"],null,`M1.09.02 leaked a concurrent Worker placement into archived ${kind}`);
        assert.equal(link[kind === "site"?"department_id":"site_id"],kind === "site" ? dept.unitId : site.unitId);
        assert.equal(link.link_status,"active");
        assert.equal(link.code_id,codeId);
      }
      const receiving = await workerReader.listLinks(workerSessions[0]);
      assert.equal(receiving.length,1);
      assert.equal(receiving[0][kind === "site"?"siteName":"departmentName"],null);
      assert.equal(receiving[0][kind === "site"?"departmentName":"siteName"],kind === "site"?dept.name:site.name);
      const perLinkAudits = await second.query("SELECT metadata->>'workerLinkId' AS link_id,metadata->>'previousSiteId' AS site_id,metadata->>'previousDepartmentId' AS department_id FROM platform_audit_events WHERE actor_tenant_id=$1 AND action_key='company_organization.archived' AND metadata->>'workerLinkId' IS NOT NULL AND target_reference=$2 ORDER BY audit_sequence",
        [owner.tenantId,target.unitId]);
      assert.equal(perLinkAudits.rows.length,1);
      assert.equal(perLinkAudits.rows[0].link_id,linkA);
      assert.equal(perLinkAudits.rows[0][kind === "site"?"site_id":"department_id"],target.unitId);
      const retainedForeign = await second.query("SELECT site_status FROM company_sites WHERE tenant_id=$1 AND site_id=$2",[foreign.tenantId,otherSite.unitId]);
      assert.equal(retainedForeign.rows[0].site_status,"active");
      const restored = await repository.restore(actor,kind,target.unitId,archived.revision);
      assert.equal((await workerReader.listLinks(workerSessions[0]))[0][kind === "site"?"siteName":"departmentName"],null,"Unit restore must not silently reassign the Worker");
      // Reverse interleaving: a new Worker placement must hold a live unit
      // SHARE lock until commit so an archive cannot miss this fresh link.
      let permitPlacementCommit, signalPlacementInserted;
      const placementAllowedToCommit = new Promise(resolve=>{permitPlacementCommit=resolve;});
      const placementInserted = new Promise(resolve=>{signalPlacementInserted=resolve;});
      currentRelease=permitPlacementCommit;
      const pendingPlacement = second.transaction(async tx=>{
        await tx.query(linkSql,argsFor(linkB,1));
        signalPlacementInserted();
        await placementAllowedToCommit;
      });
      await placementInserted;
      const pendingArchive = repository.archive(actor,kind,target.unitId,restored.revision);
      const archiveEarly = await Promise.race([
        pendingArchive.then(()=>({committed:true}),error=>({error})),
        new Promise(resolve=>setTimeout(()=>resolve({pending:true}),250))
      ]);
      assert.equal(archiveEarly.pending,true,"Archive committed before previous Worker placement transaction despite unit SHARE lock");
      currentRelease();currentRelease=null;
      await pendingPlacement;
      const secondArchive=await pendingArchive;
      assert.equal(secondArchive.status,"archived");
      const secondLink=await first.query("SELECT site_id,department_id FROM company_worker_links WHERE link_id=$1",[linkB]);
      assert.equal(secondLink.rows.length,1);
      assert.equal(secondLink.rows[0][kind === "site"?"site_id":"department_id"],null);
      assert.equal((await workerReader.listLinks(workerSessions[1]))[0][kind === "site"?"siteName":"departmentName"],null);
      const laterAudit=await first.query("SELECT metadata->>'workerLinkId' AS link_id FROM platform_audit_events WHERE actor_tenant_id=$1 AND action_key='company_organization.archived' AND target_reference=$2 AND metadata->>'workerLinkId' IS NOT NULL ORDER BY audit_sequence",[owner.tenantId,target.unitId]);
      assert.deepEqual(laterAudit.rows.map(r=>r.link_id),[linkA,linkB],"Each Worker placement is unassigned/audited once, not duplicated after restore");
      console.log(`M10902_REAL_PG16_${kind.toUpperCase()}_PLACEMENT_RACE_PRESERVES_WORKER_AND_AUDIT`);
    }
    const beforeFunction=await first.query("SELECT pg_get_functiondef('hse_validate_company_workforce_scope()'::regprocedure) AS body");
    assert.match(beforeFunction.rows[0].body,/FOR SHARE/i);
    const {readFileSync}=await import("node:fs");
    await first.execute(readFileSync("database/migrations/0131_company_workforce_archive_scope_serialization.down.sql","utf8"));
    await first.execute(readFileSync("database/migrations/0131_company_workforce_archive_scope_serialization.up.sql","utf8"));
    const afterFunction=await first.query("SELECT pg_get_functiondef('hse_validate_company_workforce_scope()'::regprocedure) AS body");
    assert.equal(afterFunction.rows[0].body,beforeFunction.rows[0].body,"Monotonic 0131 down/reapply must not restore the vulnerable trigger");
    console.log("M10902_0131_ROLLBACK_REAPPLY_PRESERVES_ROW_LOCK");
    console.log("M10902_REAL_PG16_WORKER_RECEIVING_STATE_NO_ARCHIVED_SCOPE_LEAK");
  } finally {
    if(currentRelease) currentRelease();
    await cleanup();
  }
});

test("M1.09.03 actual PostgreSQL16 Company Team placement and invite acceptance race against archived units", {
  skip: !process.env.HSE_M10903_POSTGRES_TEST_DATABASE_URL,
  timeout: 180000
}, async () => {
  const {first,second,cleanup} = await m10901RealPostgresDatabase("M10903");
  let releaseArchive;
  try {
    const owner=await insertCompanyContext(first,"T");
    const foreign=await insertCompanyContext(first,"U");
    const organization=new DatabaseCompanyOrganizationRepository(Promise.resolve(first));
    const teamReader=new CompanyTeamService(Promise.resolve(second),PEPPER,()=>new Date(NOW_DATE));
    const settings=principal(owner,"company.settings.manage");
    const read=principal(owner,"company.members.read");
    const draft={name:"Company Team archived scope",formattedAddress:"Islamabad",phone:"+92510000333",website:"https://team-archive.example.test",email:"team-archive@example.test",registrationNumber:null};
    const foreignSite=await organization.create(principal(foreign,"company.settings.manage"),"site",{...draft,name:"Foreign site kept active"});
    for(const kind of ["site","department"]){
      const target=await organization.create(settings,kind,{...draft,name:`Team scoped ${kind}`});
      const memberSeeds=kind==="site"?["V","W"]:["X","Y"];
      const members=[];
      for(const char of memberSeeds){
        const email=`m10903-team-${char.toLowerCase()}@example.test`;
        const accountId=await createAcceptedInviteAccount(first,email,`m10903-${char}`);
        const membershipId=opaqueId("membership",char);
        await first.query("INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at) VALUES($1,$2,$3,'company','manager','active',$4,$5,$5,$5)",
          [membershipId,owner.tenantId,accountId,owner.accountId,NOW]);
        members.push({accountId,membershipId,email});
      }
      const existingId=opaqueId("teamassignment",memberSeeds[0]);
      const competingId=opaqueId("teamassignment",memberSeeds[1]);
      const teamAssignmentSql="INSERT INTO company_team_unit_assignments(assignment_id,tenant_id,membership_id,site_id,department_id,assigned_by_membership_id,assigned_at) VALUES($1,$2,$3,$4,$5,$6,$7)";
      const insertArgs=(assignmentId,index)=>[assignmentId,owner.tenantId,members[index].membershipId,kind==="site"?target.unitId:null,kind==="department"?target.unitId:null,owner.membershipId,NOW];
      await first.query(teamAssignmentSql,insertArgs(existingId,0));
      assert.equal((await teamReader.listMembers(read)).find(m=>m.membershipId===members[0].membershipId)?.[kind==="site"?"siteId":"departmentId"],target.unitId);
      const held=holdM10901SuccessfulTransactionUntilReleased(first);
      const archive=held.repository.archive(settings,kind,target.unitId,target.revision);
      releaseArchive=held.release;
      await held.reached;
      const concurrent=second.query(teamAssignmentSql,insertArgs(competingId,1)).then(()=>({ok:true}),error=>({ok:false,error}));
      const early=await Promise.race([concurrent,new Promise(resolve=>setTimeout(()=>resolve({pending:true}),250))]);
      console.log(`M10903_ACTUAL_PG16_${kind.toUpperCase()}_TEAM_PLACEMENT_INTERLEAVING ${early.pending?"pending":early.ok?"INSERT_BEFORE_ARCHIVE_COMMIT":"rejected"}`);
      releaseArchive();releaseArchive=null;
      const archived=await archive;
      assert.equal(archived.status,"archived");
      const result=await concurrent;
      if(!result.ok) assert.match(result.error.message,/Archived Company|deadlock|serialization|unavailable/i);
      const assignments=await second.query("SELECT assignment_id,ended_at,ended_reason FROM company_team_unit_assignments WHERE tenant_id=$1 AND (site_id=$2 OR department_id=$2) ORDER BY assignment_id",[owner.tenantId,target.unitId]);
      assert.equal(assignments.rows.some(row=>row.ended_at===null),false,`M1.09.03 leaked new active Company Team placement into archived ${kind}`);
      assert.equal(assignments.rows.find(row=>row.assignment_id===existingId)?.ended_reason,`${kind==="site"?"Site":"Department"} archived`);
      const receiving=await teamReader.listMembers(read);
      assert.equal(receiving.find(m=>m.membershipId===members[0].membershipId)?.[kind==="site"?"siteId":"departmentId"],null);
      assert.equal(receiving.find(m=>m.membershipId===members[1].membershipId)?.[kind==="site"?"siteId":"departmentId"],null);
      assert.equal((await second.query("SELECT site_status FROM company_sites WHERE tenant_id=$1 AND site_id=$2",[foreign.tenantId,foreignSite.unitId])).rows[0].site_status,"active");
      // Team invitation acceptance is a genuine application path into the
      // Company Team assignment trigger; unlike updateMember it does not call
      // CompanyTeamService.assertActiveUnits again after invitation creation.
      const restored=await organization.restore(settings,kind,target.unitId,archived.revision);
      const manage=principal(owner,"company.members.manage");
      const pendingInvite=await teamReader.invite(manage,{
        email:`m10903-pending-${kind}@example.test`,membershipRole:"viewer",
        permissions:["company.tenant.read"],
        siteId:kind==="site"?target.unitId:null,
        departmentId:kind==="department"?target.unitId:null,
        requestFingerprint:`m10903-pending-${kind}-archive-race`
      });
      const pendingAccount=await createAcceptedInviteAccount(first,pendingInvite.email,`pending-${kind}`);
      await activateTotp(first,pendingAccount,`pending-${kind}`);
      const heldAcceptance=holdM10901SuccessfulTransactionUntilReleased(first);
      const archivingForAcceptance=heldAcceptance.repository.archive(settings,kind,target.unitId,restored.revision);
      releaseArchive=heldAcceptance.release;
      await heldAcceptance.reached;
      const acceptance=second.query(
        "UPDATE auth_staff_invitations SET invitation_status='accepted',accepted_by_account_id=$2,accepted_at=$3 WHERE invitation_id=$1",
        [pendingInvite.invitationId,pendingAccount,NOW]
      ).then(()=>({ok:true}),error=>({ok:false,error}));
      const acceptanceEarly=await Promise.race([
        acceptance,new Promise(resolve=>setTimeout(()=>resolve({pending:true}),250))
      ]);
      console.log(`M10903_ACTUAL_PG16_${kind.toUpperCase()}_TEAM_ACCEPTANCE_INTERLEAVING ${acceptanceEarly.pending?"pending":acceptanceEarly.ok?"ACCEPTED_BEFORE_ARCHIVE_COMMIT":"rejected"}`);
      releaseArchive();releaseArchive=null;
      const archivedAfterAcceptance=await archivingForAcceptance;
      assert.equal(archivedAfterAcceptance.status,"archived");
      const acceptanceResult=await acceptance;
      assert.equal(acceptanceResult.ok,false,"M1.09.03 invitation accepted into archived Company Team unit");
      assert.match(acceptanceResult.error.message,/Archived Company (?:site|department) cannot receive active assignment|unavailable/i);
      const pendingRow=await first.query("SELECT invitation_status FROM auth_staff_invitations WHERE invitation_id=$1",[pendingInvite.invitationId]);
      assert.equal(pendingRow.rows[0].invitation_status,"pending","A failed Team acceptance must roll back the entire invitation status/membership/assignment");
      assert.equal((await teamReader.listMembers(read)).some(m=>m.accountId===pendingAccount),false);
      console.log(`M10903_ACTUAL_PG16_${kind.toUpperCase()}_TEAM_ACCEPTANCE_DENIED_AFTER_ARCHIVE`);

      // New invitation bindings must also serialize, not just the later
      // activation/assignment trigger. The signed 0026 trigger is used here.
      const restoredForBinding=await organization.restore(settings,kind,target.unitId,archivedAfterAcceptance.revision);
      const bindingPrefix=kind==="site"?"K":"L";
      const directInvitationId=opaqueId("invitation",bindingPrefix);
      await first.query("INSERT INTO auth_staff_invitations(invitation_id,email_normalized,role,token_hash,invitation_status,invited_by_account_id,expires_at,created_at) VALUES($1,$2,'company',$3,'pending',$4,$5,$6)",
        [directInvitationId,`m10903-direct-${kind}@example.test`,`m10903-direct-token-${kind}`,owner.accountId,FAR_FUTURE,NOW]);
      const heldBinding=holdM10901SuccessfulTransactionUntilReleased(first);
      const archivingForBinding=heldBinding.repository.archive(settings,kind,target.unitId,restoredForBinding.revision);
      releaseArchive=heldBinding.release;
      await heldBinding.reached;
      const binding=second.query(
        "INSERT INTO company_team_invitation_bindings(invitation_id,membership_id,initial_assignment_id,tenant_id,invited_by_membership_id,membership_role,site_id,department_id,created_at) VALUES($1,$2,$3,$4,$5,'viewer',$6,$7,$8)",
        [directInvitationId,opaqueId("membership",bindingPrefix),opaqueId("teamassignment",bindingPrefix),owner.tenantId,owner.membershipId,
         kind==="site"?target.unitId:null,kind==="department"?target.unitId:null,NOW]
      ).then(()=>({ok:true}),error=>({ok:false,error}));
      const bindingEarly=await Promise.race([
        binding,new Promise(resolve=>setTimeout(()=>resolve({pending:true}),250))
      ]);
      console.log(`M10903_ACTUAL_PG16_${kind.toUpperCase()}_TEAM_BINDING_INTERLEAVING ${bindingEarly.pending?"pending":bindingEarly.ok?"BOUND_BEFORE_ARCHIVE_COMMIT":"rejected"}`);
      releaseArchive();releaseArchive=null;
      const archivedAfterBinding=await archivingForBinding;
      assert.equal(archivedAfterBinding.status,"archived");
      const bindingResult=await binding;
      assert.equal(bindingResult.ok,false,"M1.09.03 new pending Company Team invitation bound to archived unit");
      assert.match(bindingResult.error.message,/Archived or unavailable Company (?:site|department) cannot receive assignment|unavailable/i);
      assert.equal((await second.query("SELECT 1 FROM company_team_invitation_bindings WHERE invitation_id=$1",[directInvitationId])).rows.length,0);
      assert.equal((await second.query("SELECT invitation_status FROM auth_staff_invitations WHERE invitation_id=$1",[directInvitationId])).rows[0].invitation_status,"pending");
      console.log(`M10903_ACTUAL_PG16_${kind.toUpperCase()}_TEAM_INVITE_BINDING_DENIED_AFTER_ARCHIVE`);
      // Reverse interleaving: successful Company Team invite acceptance
      // must commit first and the later archive must end (not delete) the
      // newly created assignment. This covers the receiving Company member.
      const restoredForReverse=await organization.restore(settings,kind,target.unitId,archivedAfterBinding.revision);
      const acceptedFirstInvite=await teamReader.invite(manage,{
        email:`m10903-first-${kind}@example.test`,membershipRole:"viewer",
        permissions:["company.tenant.read"],
        siteId:kind==="site"?target.unitId:null,
        departmentId:kind==="department"?target.unitId:null,
        requestFingerprint:`m10903-accepted-first-${kind}`
      });
      const acceptedFirstAccount=await createAcceptedInviteAccount(first,acceptedFirstInvite.email,`first-${kind}`);
      await activateTotp(first,acceptedFirstAccount,`first-${kind}`);
      let signalAccepted,permitAcceptanceCommit;
      const acceptanceExecuted=new Promise(resolve=>{signalAccepted=resolve;});
      const finishAcceptance=new Promise(resolve=>{permitAcceptanceCommit=resolve;});
      releaseArchive=permitAcceptanceCommit;
      const acceptingFirst=second.transaction(async tx=>{
        await tx.query("UPDATE auth_staff_invitations SET invitation_status='accepted',accepted_by_account_id=$2,accepted_at=$3 WHERE invitation_id=$1",
          [acceptedFirstInvite.invitationId,acceptedFirstAccount,NOW]);
        signalAccepted();
        await finishAcceptance;
      });
      await acceptanceExecuted;
      const archiveAfterAccept=organization.archive(settings,kind,target.unitId,restoredForReverse.revision);
      const reverseEarly=await Promise.race([
        archiveAfterAccept.then(()=>({finished:true}),error=>({error})),
        new Promise(resolve=>setTimeout(()=>resolve({pending:true}),250))
      ]);
      assert.equal(reverseEarly.pending,true,"Archive completed while pending Company Team acceptance held the unit row lock");
      releaseArchive();releaseArchive=null;
      await acceptingFirst;
      const reverseArchived=await archiveAfterAccept;
      assert.equal(reverseArchived.status,"archived");
      const memberAfterReverse=(await teamReader.listMembers(read)).find(m=>m.accountId===acceptedFirstAccount);
      assert.ok(memberAfterReverse,"New invited Company member must be visible after accepted-first reverse race");
      assert.equal(memberAfterReverse.status,"active");
      assert.equal(memberAfterReverse[kind==="site"?"siteId":"departmentId"],null);
      const historyAfterReverse=await first.query("SELECT ended_at,ended_reason FROM company_team_unit_assignments WHERE tenant_id=$1 AND membership_id=$2",
        [owner.tenantId,memberAfterReverse.membershipId]);
      assert.equal(historyAfterReverse.rows.length,1);
      assert.ok(historyAfterReverse.rows[0].ended_at);
      assert.equal(historyAfterReverse.rows[0].ended_reason,`${kind==="site"?"Site":"Department"} archived`);
      assert.equal((await first.query("SELECT invitation_status FROM auth_staff_invitations WHERE invitation_id=$1",[acceptedFirstInvite.invitationId])).rows[0].invitation_status,"accepted");
      // Direct service entrypoint also denies archived references, rather
      // than relying exclusively on a database trigger for UI-origin calls.
      await assert.rejects(
        teamReader.updateMember(manage,{
          membershipId:members[0].membershipId,expectedRole:"manager",expectedStatus:"active",expectedAccessRevision:1,
          membershipRole:"manager",permissions:["company.tenant.read"],
          siteId:kind==="site"?target.unitId:null,
          departmentId:kind==="department"?target.unitId:null
        }),error=>error?.name==="CompanyTeamInputError"
      );
      await assert.rejects(
        second.query(teamAssignmentSql,[
          opaqueId("teamassignment","Z"),foreign.tenantId,members[0].membershipId,
          kind==="site"?target.unitId:null,kind==="department"?target.unitId:null,
          owner.membershipId,NOW
        ]),/outside the tenant/i
      );
      console.log(`M10903_ACTUAL_PG16_${kind.toUpperCase()}_SERVICE_AND_FOREIGN_TENANT_DENIED`);
      console.log(`M10903_ACTUAL_PG16_${kind.toUpperCase()}_ACCEPT_FIRST_ARCHIVE_ENDS_TEAM_HISTORY_ONCE`);
      console.log(`M10903_ACTUAL_PG16_${kind.toUpperCase()}_ARCHIVED_TEAM_ASSIGNMENT_DENIED`);
    }
    const originalFunctions=await first.query(`
      SELECT pg_get_functiondef('hse_validate_company_team_unit_assignment()'::regprocedure) AS team,
             pg_get_functiondef('hse_validate_company_team_invitation_binding()'::regprocedure) AS binding
    `);
    assert.equal((originalFunctions.rows[0].team.match(/FOR SHARE/g)||[]).length,2);
    assert.equal((originalFunctions.rows[0].binding.match(/FOR SHARE/g)||[]).length,2);
    const {readFileSync}=await import("node:fs");
    await first.execute(readFileSync("database/migrations/0132_company_team_archived_scope_serialization.down.sql","utf8"));
    await first.execute(readFileSync("database/migrations/0132_company_team_archived_scope_serialization.up.sql","utf8"));
    const reinstatedFunctions=await first.query(`
      SELECT pg_get_functiondef('hse_validate_company_team_unit_assignment()'::regprocedure) AS team,
             pg_get_functiondef('hse_validate_company_team_invitation_binding()'::regprocedure) AS binding
    `);
    assert.deepEqual(reinstatedFunctions.rows,originalFunctions.rows,"0132 down/reapply must never weaken Company Team archived-unit row locking");
    console.log("M10903_0132_ROLLBACK_REAPPLY_RETAINS_TEAM_INVITE_ROW_LOCKS");
  } finally {
    if(releaseArchive)releaseArchive();
    await cleanup();
  }
});

test("M1.09.04 actual PostgreSQL16 Company Team same-role stale permission form replay denied", {
  skip: !process.env.HSE_M10904_POSTGRES_TEST_DATABASE_URL,
  timeout: 160000
}, async () => {
  const {first,second,cleanup}=await m10901RealPostgresDatabase("M10904");
  try {
    const owner=await insertCompanyContext(first,"H");
    const foreign=await insertCompanyContext(first,"I");
    const adminAccount=await createAcceptedInviteAccount(first,"m10904-admin@example.test","m10904-admin");
    const managerAccount=await createAcceptedInviteAccount(first,"m10904-manager@example.test","m10904-manager");
    const adminMembership=opaqueId("membership","J");
    const managerMembership=opaqueId("membership","K");
    const adminSession="m10904_admin_session";
    for (const row of [
      [adminMembership,adminAccount,"admin"],
      [managerMembership,managerAccount,"manager"]
    ]) {
      await first.query(`INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at)
        VALUES($1,$2,$3,'company',$4,'active',$5,$6,$6,$6)`,[row[0],owner.tenantId,row[1],row[2],owner.accountId,NOW]);
    }
    await first.query(`INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at)
      VALUES($1,$2,'company','m10904-admin-token','m10904-admin-csrf',$3,$3,$4)`,[adminSession,adminAccount,NOW,FAR_FUTURE]);
    const ownerManage=principal(owner,"company.members.manage");
    const adminManage=principal({
      accountId:adminAccount,tenantId:owner.tenantId,membershipId:adminMembership,
      sessionId:adminSession,email:"m10904-admin@example.test",
      displayName:"M10904 Company Admin",membershipRole:"admin"
    },"company.members.manage");
    const ownerReader=principal(owner,"company.members.read");
    const foreignReader=principal(foreign,"company.members.read");
    const ownerService=new CompanyTeamService(Promise.resolve(first),PEPPER,()=>new Date(NOW_DATE));
    const adminService=new CompanyTeamService(Promise.resolve(second),PEPPER,()=>new Date(NOW_DATE));
    const initial=(await adminService.listMembers(ownerReader)).find(row=>row.membershipId===managerMembership);
    assert.ok(initial,"Third-party Company Team member must exist before both forms load");
    assert.equal(initial.membershipRole,"manager");
    assert.equal(initial.status,"active");
    assert.ok(initial.permissions.includes("company.workforce.manage"));
    const cachedForm={
      membershipId:managerMembership,expectedRole:initial.membershipRole,
      expectedStatus:initial.status,expectedAccessRevision:initial.accessRevision,
      membershipRole:initial.membershipRole,
      permissions:[...initial.permissions],siteId:initial.siteId,departmentId:initial.departmentId
    };
    const removed=await ownerService.updateMember(ownerManage,{
      ...cachedForm,permissions:initial.permissions.filter(p=>p!=="company.workforce.manage")
    });
    assert.equal(removed.permissions.includes("company.workforce.manage"),false);
    const otherSessionOutcome=await adminService.updateMember(adminManage,cachedForm)
      .then(()=>({ok:true}),error=>({ok:false,error}));
    const seen=(await ownerService.listMembers(ownerReader)).find(row=>row.membershipId===managerMembership);
    assert.ok(seen);
    console.log(`M10904_ACTUAL_PG16_TWO_STAFF_STALE_PERMISSION_REPLAY outcome=${otherSessionOutcome.ok?"ACCEPTED_STALE":"DENIED"} workforce_manage=${seen.permissions.includes("company.workforce.manage")}`);
    assert.equal(otherSessionOutcome.ok,false,
      "M1.09.04 stale same-role/status Company admin form reinstated permission the owner had just removed");
    assert.equal(seen.permissions.includes("company.workforce.manage"),false,
      "M1.09.04 stale permission must never be restored by another staff session");
    assert.equal(seen.accessRevision,initial.accessRevision+1);
    const previousAudit=await first.query(`SELECT audit_sequence,actor_account_id,metadata FROM platform_audit_events
      WHERE actor_tenant_id=$1 AND target_reference=$2 AND action_key='company_team.membership.updated'
      ORDER BY audit_sequence`,[owner.tenantId,managerMembership]);
    assert.equal(previousAudit.rows.length,1,"Rejected same-role stale form must produce zero extra successful audit events");
    assert.equal(previousAudit.rows[0].actor_account_id,owner.accountId);
    // Real overlapping transactions, not merely sequential stale browser forms:
    // Owner changes a second permission while the Admin's second connection
    // simultaneously submits the still-stale member access version.
    let markOwnerPrepared, releaseOwnerCommit;
    const ownerPrepared=new Promise(resolve=>{markOwnerPrepared=resolve;});
    const mayCommitOwner=new Promise(resolve=>{releaseOwnerCommit=resolve;});
    let pendingRelease=releaseOwnerCommit;
    try {
      const ownerHeld=new CompanyTeamService(Promise.resolve({
        transaction:callback=>first.transaction(async tx=>{
          const result=await callback(tx);
          markOwnerPrepared();
          await mayCommitOwner;
          return result;
        })
      }),PEPPER,()=>new Date(NOW_DATE));
      const preparedOwnerUpdate=ownerHeld.updateMember(ownerManage,{
        ...cachedForm,expectedAccessRevision:seen.accessRevision,
        permissions:seen.permissions.filter(p=>p!=="company.orders.manage")
      });
      await ownerPrepared;
      const racingAdminUpdate=adminService.updateMember(adminManage,{
        ...cachedForm,expectedAccessRevision:seen.accessRevision,
        permissions:[...seen.permissions,"company.workforce.manage"]
      }).then(()=>({ok:true}),error=>({ok:false,error}));
      const early=await Promise.race([
        racingAdminUpdate.then(()=>({finished:true})),
        new Promise(resolve=>setTimeout(()=>resolve({pending:true}),250))
      ]);
      assert.equal(early.pending,true,"Concurrent Admin should block on locked target member while Owner transaction is uncommitted");
      pendingRelease();pendingRelease=null;
      const winner=await preparedOwnerUpdate;
      assert.equal(winner.accessRevision,seen.accessRevision+1);
      const loser=await racingAdminUpdate;
      assert.equal(loser.ok,false,"Stale other staff session must not overwrite the earlier authorized permission change");
      assert.equal(loser.error?.name,"CompanyTeamConflictError");
    } finally {if(pendingRelease)pendingRelease();}
    const afterRace=(await ownerService.listMembers(ownerReader)).find(m=>m.membershipId===managerMembership);
    assert.ok(afterRace);
    assert.equal(afterRace.permissions.includes("company.workforce.manage"),false);
    assert.equal(afterRace.permissions.includes("company.orders.manage"),false);
    assert.equal(afterRace.accessRevision,seen.accessRevision+1);
    const afterRaceAudit=await first.query(`SELECT audit_sequence,actor_account_id,metadata FROM platform_audit_events
      WHERE actor_tenant_id=$1 AND target_reference=$2 AND action_key='company_team.membership.updated'
      ORDER BY audit_sequence`,[owner.tenantId,managerMembership]);
    assert.equal(afterRaceAudit.rows.length,2,"Only two successful Owners' membership updates may be audited");
    assert.deepEqual(afterRaceAudit.rows.map(row=>row.actor_account_id),[owner.accountId,owner.accountId]);
    const suspended=await ownerService.changeMemberStatus(ownerManage,{
      membershipId:managerMembership,expectedStatus:"active",
      expectedAccessRevision:afterRace.accessRevision,targetStatus:"suspended"
    });
    assert.equal(suspended.accessRevision,afterRace.accessRevision+1);
    await assert.rejects(
      adminService.changeMemberStatus(adminManage,{
        membershipId:managerMembership,expectedStatus:"suspended",
        expectedAccessRevision:afterRace.accessRevision,targetStatus:"active"
      }),error=>error?.name==="CompanyTeamConflictError"
    );
    const reactivated=await ownerService.changeMemberStatus(ownerManage,{
      membershipId:managerMembership,expectedStatus:"suspended",
      expectedAccessRevision:suspended.accessRevision,targetStatus:"active"
    });
    assert.equal(reactivated.accessRevision,suspended.accessRevision+1);
    const freshAuthorized=await adminService.updateMember(adminManage,{
      membershipId:managerMembership,expectedRole:"manager",expectedStatus:"active",
      expectedAccessRevision:reactivated.accessRevision,membershipRole:"manager",
      permissions:[...reactivated.permissions,"company.workforce.manage"],
      siteId:null,departmentId:null
    });
    assert.equal(freshAuthorized.accessRevision,reactivated.accessRevision+1);
    assert.ok(freshAuthorized.permissions.includes("company.workforce.manage"),
      "A genuinely refreshed Company Admin may grant only permissions within its current authority");
    await assert.rejects(ownerService.updateMember(ownerManage,{
      ...cachedForm,expectedAccessRevision:1
    }),error=>error?.name==="CompanyTeamConflictError");
    await assert.rejects(ownerService.updateMember(ownerManage,{
      ...cachedForm,expectedAccessRevision:0
    }),error=>error?.name==="CompanyTeamConflictError");
    await assert.rejects(ownerService.updateMember(principal(foreign,"company.members.manage"),{
      ...cachedForm,expectedAccessRevision:freshAuthorized.accessRevision
    }),error=>error?.name==="CompanyTeamAccessError");
    const foreignMembers=await adminService.listMembers(foreignReader);
    assert.equal(foreignMembers.some(row=>row.membershipId===managerMembership),false);
    console.log("M10904_ACTUAL_PG16_TWO_STAFF_CONCURRENT_CAS_WINNER_ONE_STALE_DENIED");
    console.log("M10904_ACTUAL_PG16_STATUS_REVISION_RESURRECTION_DENIED_AND_FRESH_GRANT_ALLOWED");
    console.log("M10904_ACTUAL_PG16_MEMBER_AUDIT_DENIES_DUPLICATE_AND_FOREIGN_TENANT");
  } finally { await cleanup(); }
});

test("M1.09.05 actual PostgreSQL16 cached Company staff session suspension and revocation token cannot revive", {
  skip: !process.env.HSE_M10905_POSTGRES_TEST_DATABASE_URL,
  timeout: 180000
}, async () => {
  const {first,second,cleanup} = await m10901RealPostgresDatabase("M10905");
  try {
    const owner=await insertCompanyContext(first,"R");
    const foreign=await insertCompanyContext(first,"S");
    const managerAccount=await createAcceptedInviteAccount(first,"m10905-manager@example.test","m10905-manager");
    const managerMembership=opaqueId("membership","Z");
    await first.query(`INSERT INTO auth_tenant_memberships(
      membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at)
      VALUES($1,$2,$3,'company','manager','active',$4,$5,$5,$5)`,
      [managerMembership,owner.tenantId,managerAccount,owner.accountId,NOW]);
    const staffSessions=["m10905_cached_company_session_a","m10905_cached_company_session_b"];
    for(const id of staffSessions){
      await first.query(`INSERT INTO auth_sessions(
        session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at)
        VALUES($1,$2,'company',$3,$4,$5,$5,$6)`,
        [id,managerAccount,`hash-${id}`,`csrf-${id}`,NOW,FAR_FUTURE]);
    }
    const memberService=new CompanyTeamService(Promise.resolve(first),PEPPER,()=>new Date(NOW_DATE));
    const manage=principal(owner,"company.members.manage");
    const reader=principal(owner,"company.members.read");
    const sessionReader=new AuthorizationContextRepository(second);
    const tokenResolution=async id=>resolveSessionAuthorizationContext({
      snapshot:await sessionReader.findBySessionTokenHash(`hash-${id}`),now:NOW
    });
    const before=await tokenResolution(staffSessions[0]);
    assert.equal(before.allowed,true);
    assert.equal(authorizePortalEntry({resolution:before,expectedRole:"company"}).allowed,true);
    assert.equal(authorizeCurrentTenantPermission({resolution:before,permission:"company.workforce.read"}).allowed,true);
    const manager=(await memberService.listMembers(reader)).find(row=>row.membershipId===managerMembership);
    assert.ok(manager);
    const suspended=await memberService.changeMemberStatus(manage,{
      membershipId:managerMembership,expectedStatus:"active",
      expectedAccessRevision:manager.accessRevision,targetStatus:"suspended"
    });
    assert.equal(suspended.status,"suspended");
    const oldSessionsAfterSuspend=await second.query(`SELECT session_id,revoked_at,revocation_reason
      FROM auth_sessions WHERE account_id=$1 AND active_role='company' ORDER BY session_id`,[managerAccount]);
    assert.equal(oldSessionsAfterSuspend.rows.length,2);
    assert.equal(oldSessionsAfterSuspend.rows.every(row=>row.revoked_at!==null),true,
      "M1.09.05 suspended Company Team member retained usable signed sessions, which could revive on activation");
    assert.deepEqual(oldSessionsAfterSuspend.rows.map(row=>row.revocation_reason),
      ["company_team_membership_suspended","company_team_membership_suspended"]);
    for(const id of staffSessions){
      const revoked=await tokenResolution(id);
      assert.equal(revoked.allowed,false);
      assert.equal(revoked.reason,"session_revoked");
    }
    console.log("M10905_REAL_PG16_SUSPEND_INVALIDATES_ALL_PREVIOUS_COMPANY_SESSION_TOKENS");
    const issueNewCompanyToken=(client,id,role="company")=>new AuthenticationRepository(client).insertSession({
      sessionId:id,accountId:managerAccount,activeRole:role,tokenHash:`hash-${id}`,
      csrfTokenHash:`csrf-${id}`,userAgentHash:null,ipAddressHash:null,
      createdAt:NOW,lastSeenAt:NOW,expiresAt:FAR_FUTURE
    });
    await assert.rejects(issueNewCompanyToken(second,"m10905_suspended_login"),
      /active account|active Company|membership/i,
      "M1.09.05 suspended member can mint a new Company cookie, which would revive at reactivation");
    console.log("M10905_REAL_PG16_LOGIN_ISSUANCE_DURING_SUSPENSION_DENIED");
    const reactivated=await memberService.changeMemberStatus(manage,{
      membershipId:managerMembership,expectedStatus:"suspended",
      expectedAccessRevision:suspended.accessRevision,targetStatus:"active"
    });
    assert.equal(reactivated.status,"active");
    for(const id of staffSessions){
      const oldToken=await tokenResolution(id);
      assert.equal(oldToken.allowed,false,"M1.09.05 resurrected an old Company session token after reactivation");
    }
    console.log("M10905_REAL_PG16_OLD_SIGNED_SESSIONS_CANNOT_REVIVE_AFTER_REACTIVATION");
    const freshId="m10905_fresh_after_reactivation";
    await issueNewCompanyToken(second,freshId);
    const fresh=await tokenResolution(freshId);
    assert.equal(authorizeCurrentTenantPermission({resolution:fresh,permission:"company.workforce.read"}).allowed,true);
    // Genuine overlapping transactions: the Owner's revocation is uncommitted
    // while the other connection attempts another MFA-complete session issue.
    // Its membership FOR SHARE lock must wait, then recheck the revoked row.
    let notifyRevocation, releaseRevocation;
    const reachedRevocation=new Promise(resolve=>{notifyRevocation=resolve;});
    const holdCommit=new Promise(resolve=>{releaseRevocation=resolve;});
    let release=releaseRevocation;
    const heldService=new CompanyTeamService(Promise.resolve({
      transaction:callback=>first.transaction(async tx=>{
        const result=await callback(tx);
        notifyRevocation();
        await holdCommit;
        return result;
      })
    }),PEPPER,()=>new Date(NOW_DATE));
    let final;
    try {
      const ownerRevocation=heldService.changeMemberStatus(manage,{
        membershipId:managerMembership,expectedStatus:"active",
        expectedAccessRevision:reactivated.accessRevision,targetStatus:"revoked"
      });
      await reachedRevocation;
      const racingLogin=issueNewCompanyToken(second,"m10905_racing_login_during_revoke")
        .then(()=>({ok:true}),error=>({ok:false,error}));
      const early=await Promise.race([
        racingLogin.then(()=>({pending:false})),
        new Promise(resolve=>setTimeout(()=>resolve({pending:true}),250))
      ]);
      assert.equal(early.pending,true,"Company login must wait while a membership revocation holds the row lock");
      release();release=null;
      final=await ownerRevocation;
      const late=await racingLogin;
      assert.equal(late.ok,false,"New Company login cannot commit after the competing membership was revoked");
      assert.match(late.error?.message??"",/active Company membership/i);
      const racedSession=await second.query("SELECT 1 FROM auth_sessions WHERE session_id=$1",["m10905_racing_login_during_revoke"]);
      assert.equal(racedSession.rows.length,0);
      console.log("M10905_REAL_PG16_CONCURRENT_LOGIN_REVOKE_ROWLOCK_SERIALIZES_AND_FAILS_CLOSED");
    } finally {if(release)release();}
    assert.equal(final.status,"revoked");
    const freshAfterRevocation=await tokenResolution(freshId);
    assert.equal(freshAfterRevocation.allowed,false);
    assert.equal(freshAfterRevocation.reason,"session_revoked");
    const freshDb=await first.query("SELECT revoked_at,revocation_reason FROM auth_sessions WHERE session_id=$1",[freshId]);
    assert.equal(freshDb.rows[0]?.revocation_reason,"company_team_membership_revoked");
    assert.ok(freshDb.rows[0]?.revoked_at);
    const foreignSession=await second.query("SELECT revoked_at FROM auth_sessions WHERE session_id=$1",[foreign.sessionId]);
    assert.equal(foreignSession.rows[0].revoked_at,null);
    const ownerSession=await second.query("SELECT revoked_at FROM auth_sessions WHERE session_id=$1",[owner.sessionId]);
    assert.equal(ownerSession.rows[0].revoked_at,null);
    const memberAudits=await second.query(`SELECT action_key FROM platform_audit_events
      WHERE actor_tenant_id=$1 AND target_reference=$2
       AND action_key IN ('company_team.membership.suspended','company_team.membership.reactivated','company_team.membership.revoked')
      ORDER BY audit_sequence`,[owner.tenantId,managerMembership]);
    assert.deepEqual(memberAudits.rows.map(row=>row.action_key),[
      "company_team.membership.suspended","company_team.membership.reactivated","company_team.membership.revoked"
    ]);
    console.log("M10905_REAL_PG16_REVOKE_INVALIDATES_FRESH_TOKEN_FOREIGN_AND_OWNER_UNTOUCHED_AUDITS_EXACT");
  } finally {await cleanup();}
});
