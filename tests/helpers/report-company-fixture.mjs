import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { loadWorkerRegistrationTs, setWorkerRegistrationRuntimeEnvironment } from "./worker-registration-runtime-loader.mjs";

const {AuthAccessRepository} = loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {CompanyWorkforceService} = loadWorkerRegistrationTs("src/lib/company/company-workforce-service.ts");
const {FilesystemPrivateObjectStorage} = loadWorkerRegistrationTs("src/lib/secure-files/private-object-storage-core.ts");

export async function reportNativePrincipal(database, identity, permission = "company.reports.export") {
  const sessionId = "report-native-" + randomUUID(), now = new Date().toISOString();
  await new AuthAccessRepository(database).authentication.insertSession({
    sessionId, accountId: identity.accountId, activeRole: identity.tenantId ? "company" : "worker",
    tokenHash: createHash("sha256").update(sessionId).digest("hex"),
    csrfTokenHash: createHash("sha256").update("csrf:" + sessionId).digest("hex"),
    userAgentHash: null, ipAddressHash: null, createdAt: now, lastSeenAt: now,
    expiresAt: new Date(Date.now() + 3600000).toISOString()
  });
  return {
    accountId: identity.accountId, sessionId, activeRole: identity.tenantId ? "company" : "worker",
    accountStatus: "active", email: identity.email, displayName: "Report fixture",
    createdAt: now, lastSeenAt: now, expiresAt: new Date(Date.now() + 3600000).toISOString(),
    tenantMembership: identity.tenantId ? {
      tenantId: identity.tenantId, membershipId: identity.membershipId,
      tenantStatus: "active", status: "active", role: identity.role ?? "owner", overrides: []
    } : null,
    authorizedTenantPermission: permission
  };
}

// Owned disposable database and actual current migrations. Fixture secrets never leave this directory.
export async function reportCompanyFixture() {
  const directory = await mkdtemp(join(tmpdir(), "hse-report-company-"));
  const environment = {
    ...process.env, HSE_APP_ENV: "development", HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: join(directory, "db"), HSE_RELEASE_SHA: "report-native-fixture",
    HSE_SESSION_SECRET: "report-fixture-session-secret-more-than-thirty-two",
    HSE_AUTH_PEPPER: "report-fixture-pepper-more-than-thirty-two",
    HSE_RUNTIME_PROJECT_ROOT: directory,
    HSE_ENABLE_WORKER_DEMO_AUTH: "false", HSE_USE_WORKER_DEMO_DATA: "false",
    HSE_AUDIT_CREDENTIALS_PATH: join(directory, "credentials.json")
  };
  try {
    const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], {env: environment, encoding: "utf8"});
    assert.equal(migration.status, 0, migration.stderr || migration.stdout);
    // Keep the existing valid account producer's diagnostic artifacts private to this fixture.
    const seedSource = (await readFile("scripts/independent-audit-seed.mjs", "utf8"))
      .replaceAll("artifacts/independent-audit", directory.replaceAll("\\", "/") + "/seed");
    const seed = spawnSync(process.execPath, ["--input-type=module", "-e", seedSource], {env: environment, encoding: "utf8"});
    assert.equal(seed.status, 0, seed.stderr || seed.stdout);
    const credentials = JSON.parse(await readFile(environment.HSE_AUDIT_CREDENTIALS_PATH, "utf8"));
    const database = await PGlite.create(environment.HSE_PGLITE_DATA_DIR);
    try {
      const principal = await reportNativePrincipal(database, credentials.company);
      const worker = await reportNativePrincipal(database, credentials.worker);
      const workforce = new CompanyWorkforceService(database, environment.HSE_AUTH_PEPPER);
      const code = await workforce.createRegistrationCode({...principal, authorizedTenantPermission: "company.workforce.manage"}, {
        usageLimit: 1, expiresAt: new Date(Date.now() + 86400000).toISOString(), paymentResponsibility: "worker"
      });
      const link = await workforce.redeemRegistrationCode(worker, code.registrationCode);
      setWorkerRegistrationRuntimeEnvironment({appEnvironment: "development"});
      const previousRoot = process.env.HSE_RUNTIME_PROJECT_ROOT;
      process.env.HSE_RUNTIME_PROJECT_ROOT = directory;
      const storage = new FilesystemPrivateObjectStorage({trustedBasePath: directory, rootPath: join(directory, ".data", "private-objects")});
      return {directory, environment, credentials, principal, worker, link, database, storage,
        cleanup: async () => {if (process.env.HSE_RUNTIME_PROJECT_ROOT === directory) {if (previousRoot === undefined) delete process.env.HSE_RUNTIME_PROJECT_ROOT; else process.env.HSE_RUNTIME_PROJECT_ROOT = previousRoot;} if (!database.closed) await database.close(); await rm(directory, {recursive: true, force: true});}};
    } catch (error) {await database.close(); throw error;}
  } catch (error) {await rm(directory, {recursive: true, force: true}); throw error;}
}

export async function reportAddSite(fixture, name) {
  const siteId = "site_" + randomUUID().replaceAll("-", "").slice(0,24);
  await fixture.database.query(
    "INSERT INTO company_sites(site_id,tenant_id,name,formatted_address,phone,website,email_normalized,created_by_membership_id) VALUES($1,$2,$3,'Fixture site','0000000000','https://example.test','report-scope@example.test',$4)",
    [siteId,fixture.credentials.company.tenantId,name,fixture.credentials.company.membershipId]);
  return siteId;
}
export async function reportSetScope(fixture, siteId) {
  await fixture.database.transaction(async database => {
    await database.query("UPDATE company_team_unit_assignments SET ended_at=CURRENT_TIMESTAMP,ended_reason='Report fixture scope change' WHERE tenant_id=$1 AND membership_id=$2 AND ended_at IS NULL",
      [fixture.credentials.company.tenantId,fixture.credentials.company.membershipId]);
    if (siteId) await database.query(
      "INSERT INTO company_team_unit_assignments(assignment_id,tenant_id,membership_id,site_id,assigned_by_membership_id) VALUES($1,$2,$3,$4,$3)",
      ["teamassignment_"+randomUUID().replaceAll("-","").slice(0,24),fixture.credentials.company.tenantId,fixture.credentials.company.membershipId,siteId]);
  });
}
export async function reportAddCompanyPrincipal(fixture, role = "owner", foreignTenant = false) {
  const accountId = "account_"+randomUUID().replaceAll("-","").slice(0,24), email = "report-fixture-"+randomUUID()+"@example.test";
  await fixture.database.query(
    "INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,email_verified_at,password_hash,password_set_at) SELECT $1,$2,'Report fixture','active',CURRENT_TIMESTAMP,password_hash,password_set_at FROM auth_accounts WHERE account_id=$3",
    [accountId,email,fixture.credentials.company.accountId]);
  await fixture.database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'company')",[accountId]);
  const tenantId = foreignTenant ? "tenant_"+randomUUID().replaceAll("-","").slice(0,24) : fixture.credentials.company.tenantId;
  if (foreignTenant) await fixture.database.query(
    "INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,activated_at) VALUES($1,'company','Report fixture tenant','active',$2,CURRENT_TIMESTAMP)",
    [tenantId,accountId]);
  const membershipId = "membership_"+randomUUID().replaceAll("-","").slice(0,24);
  await fixture.database.query(
    "INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,activated_at) VALUES($1,$2,$3,'company',$4,'active',$3,CURRENT_TIMESTAMP)",
    [membershipId,tenantId,accountId,role]);
  return reportNativePrincipal(fixture.database,{accountId,email,tenantId,membershipId,role});
}
export async function reportDenyExport(fixture) {
  await fixture.database.query(
    "INSERT INTO auth_tenant_permission_overrides(membership_id,membership_role,permission_key,effect,created_by_account_id,reason) VALUES($1,'owner','company.reports.export','deny',$2,'Report fixture permission denial') ON CONFLICT DO NOTHING",
    [fixture.credentials.company.membershipId,fixture.credentials.company.accountId]);
}

export async function reportAddDepartment(fixture, name) {
  const departmentId = "department_" + randomUUID().replaceAll("-", "").slice(0,24);
  await fixture.database.query(
    "INSERT INTO company_departments(department_id,tenant_id,name,formatted_address,phone,website,email_normalized,created_by_membership_id) VALUES($1,$2,$3,'Fixture department','0000000000','https://example.test','report-scope@example.test',$4)",
    [departmentId,fixture.credentials.company.tenantId,name,fixture.credentials.company.membershipId]);
  return departmentId;
}

export async function reportAddWorkerPrincipal(fixture) {
 const accountId="account_"+randomUUID().replaceAll("-","").slice(0,24),email="report-worker-"+randomUUID()+"@example.test";
 await fixture.database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,email_verified_at,password_hash,password_set_at) SELECT $1,$2,'Report Worker fixture','active',CURRENT_TIMESTAMP,password_hash,password_set_at FROM auth_accounts WHERE account_id=$3",
  [accountId,email,fixture.credentials.worker.accountId]);
 await fixture.database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'worker')",[accountId]);
 return reportNativePrincipal(fixture.database,{accountId,email});
}
