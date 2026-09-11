import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const requiredFiles = [
  "database/migrations/0006_authorization_tenant_scope_fixture.up.sql",
  "database/migrations/0006_authorization_tenant_scope_fixture.down.sql",
  "src/lib/authorization/tenant-scoped-resource-domain.ts",
  "src/lib/authorization/tenant-scoped-command-guard.ts",
  "src/lib/authorization/tenant-scope-fixture-repository.ts",
  "src/lib/authorization/tenant-scope-fixture-service.ts",
  "tests/authorization/tenant-scoped-resource-domain.test.mjs",
  "tests/platform/authorization-tenant-scope-repository.test.mjs",
  "tests/platform/authorization-tenant-scope-concurrency.test.mjs"
];

const missing = requiredFiles.filter((path) => !existsSync(resolve(path)));
if (missing.length > 0) {
  console.error(`Missing tenant-scope guard files:\n${missing.join("\n")}`);
  process.exit(1);
}

function source(path) {
  return readFileSync(resolve(path), "utf8");
}

function requireMarkers(path, markers) {
  const content = source(path);
  for (const marker of markers) {
    if (!content.includes(marker)) {
      console.error(`${path} is missing: ${marker}`);
      process.exit(1);
    }
  }
  return content;
}

const migration = requireMarkers(
  "database/migrations/0006_authorization_tenant_scope_fixture.up.sql",
  [
    "authorization_tenant_scope_fixtures",
    "PRIMARY KEY (tenant_id, fixture_id)",
    "UNIQUE (tenant_id, record_key)",
    "FOREIGN KEY (created_by_membership_id, tenant_id)",
    "auth_tenant_membership_tenant_identity",
    "^tenantfixture_[A-Za-z0-9_-]{24}$",
    "Temporary neutral authorization-enforcement fixture"
  ]
);
if (/company_(sites|departments|workers|orders|billing|evidence)/i.test(migration)) {
  console.error("The neutral authorization fixture must not pre-build a later business domain.");
  process.exit(1);
}
requireMarkers(
  "database/migrations/0006_authorization_tenant_scope_fixture.down.sql",
  [
    "DROP TABLE IF EXISTS authorization_tenant_scope_fixtures",
    "DROP CONSTRAINT IF EXISTS auth_tenant_membership_tenant_identity"
  ]
);

const domain = requireMarkers(
  "src/lib/authorization/tenant-scoped-resource-domain.ts",
  [
    "TenantPermissionPrincipal",
    "authorizedTenantPermission",
    "bindTenantPermissionPrincipal",
    "deriveTrustedTenantScope",
    "TENANT_SCOPE_FIXTURE_READ_PERMISSION",
    "TENANT_SCOPE_FIXTURE_WRITE_PERMISSION"
  ]
);
if (/request|headers|cookies|FormData|searchParams/.test(domain)) {
  console.error("The tenant scope domain must not read request-controlled context.");
  process.exit(1);
}

const commandGuard = requireMarkers(
  "src/lib/authorization/tenant-scoped-command-guard.ts",
  [
    "TENANT_COMMAND_SCOPE_SQL",
    "memberships.membership_id = $1",
    "memberships.tenant_id = $2",
    "memberships.account_id = $3",
    "sessions.session_id = $4",
    "sessions.expires_at > $5::timestamptz",
    "ceiling.permission_key = $6",
    "denied_override.effect = 'deny'",
    "FOR UPDATE OF memberships, tenants, accounts, sessions",
    "authorizedTenantPermission !== input.permission",
    "database.transaction"
  ]
);
if (/request|headers|cookies|FormData|searchParams|tenantId\s*\?/.test(commandGuard)) {
  console.error("Transactional tenant scope must come only from the accepted principal.");
  process.exit(1);
}

const repository = requireMarkers(
  "src/lib/authorization/tenant-scope-fixture-repository.ts",
  [
    "TenantPermissionPrincipal",
    "TENANT_SCOPE_FIXTURE_LIST_SQL",
    "TENANT_SCOPE_FIXTURE_FIND_SQL",
    "TENANT_SCOPE_FIXTURE_INSERT_SQL",
    "TENANT_SCOPE_FIXTURE_UPDATE_SQL",
    "TENANT_SCOPE_FIXTURE_DELETE_SQL",
    "WHERE tenant_id = $1",
    "WHERE tenant_id = $1 AND fixture_id = $2",
    "ON CONFLICT (tenant_id, record_key) DO NOTHING",
    "runTenantScopedCommand"
  ]
);
if (/SELECT[\s\S]*FROM authorization_tenant_scope_fixtures(?![\s\S]*tenant_id = \$1)/.test(repository)) {
  console.error("Tenant fixture reads must scope tenant identity in SQL.");
  process.exit(1);
}
if (/filter\([^)]*tenant|fetch-global|global.*filter/i.test(repository)) {
  console.error("Fetch-global-then-filter is prohibited for tenant-owned data.");
  process.exit(1);
}

const service = requireMarkers(
  "src/lib/authorization/tenant-scope-fixture-service.ts",
  [
    "BUILD-PIN AUTHZ-TENANT-SCOPED-SERVICE",
    "requireCurrentTenantPermission",
    "TENANT_SCOPE_FIXTURE_READ_PERMISSION",
    "TENANT_SCOPE_FIXTURE_WRITE_PERMISSION"
  ]
);
if (/tenantId\s*:|membershipId\s*:|authorizedTenantPermission\s*:/.test(service)) {
  console.error("Tenant fixture service must not accept tenant or permission selectors.");
  process.exit(1);
}

const authorizationService = requireMarkers(
  "src/lib/authorization/authorization-service.ts",
  [
    "bindTenantPermissionPrincipal",
    "TenantPermissionPrincipal<P>",
    "requireCurrentTenantPermission<P extends TenantPermission>"
  ]
);
if (!authorizationService.includes("asTenantAuthorizationPrincipal(decision.principal)")) {
  console.error("Permission binding must follow accepted current-tenant authorization.");
  process.exit(1);
}

const packageDocument = JSON.parse(source("package.json"));
for (const script of ["check:tenant-scope", "test:tenant-scope"]) {
  if (!packageDocument.scripts?.[script]) {
    console.error(`package.json is missing ${script}.`);
    process.exit(1);
  }
}
if (!packageDocument.scripts.check.includes("check:tenant-scope")) {
  console.error("The complete gate must include the tenant-scope source contract.");
  process.exit(1);
}
if (!packageDocument.scripts.check.includes("test:tenant-scope")) {
  console.error("The complete gate must include migrated tenant-scope tests.");
  process.exit(1);
}

console.log(
  "Trusted tenant permission binding, SQL-scoped reads/writes, transactional lifecycle revalidation, tenant uniqueness and no-client-selector contracts passed."
);
