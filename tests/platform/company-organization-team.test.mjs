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
const {
  CompanyTeamService,
  CompanyTeamAccessError
} = teamModule;

const OWNED_MIGRATION = "0028_company_worker_invitations_codes";
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

async function m10901RealPostgresDatabase() {
  const raw = process.env.HSE_M10901_POSTGRES_TEST_DATABASE_URL;
  if (!raw) throw new Error("M10901 test requires explicit approved isolated PostgreSQL16.");
  const url = new URL(raw);
  if (!["localhost","127.0.0.1"].includes(url.hostname) || url.pathname !== "/postgres") {
    throw new Error("M10901 never opens an external/shared application or production database.");
  }
  const root = await openScriptDatabase({
    ...TEST_ENVIRONMENT,databaseDriver:"postgres",databaseUrl:url.href,releaseSha:"m10901-supervisor"
  });
  const dbName = "m10901_two_staff_units_"+process.pid+"_"+Date.now();
  let created=false, first, second;
  try {
    await root.execute('CREATE DATABASE "'+dbName+'"');
    created=true;
    url.pathname = "/"+dbName;
    const env = {...TEST_ENVIRONMENT,databaseDriver:"postgres",
      databaseUrl:url.href,releaseSha:"m10901-unit-race-"+process.pid};
    first = await openScriptDatabase(env);
    await applyMigrationsThrough(first,env.releaseSha,"0130_verified_identity_correction_notices");
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
