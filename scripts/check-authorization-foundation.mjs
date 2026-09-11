import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const requiredFiles = [
  "src/lib/authorization/authorization-domain.ts",
  "src/lib/authorization/authorization-context-domain.ts",
  "src/lib/authorization/authorization-context-repository.ts",
  "src/lib/authorization/authorization-service.ts",
  "database/migrations/0005_authorization_tenant_isolation.up.sql",
  "database/migrations/0005_authorization_tenant_isolation.down.sql",
  "scripts/run-authorization-tests.mjs",
  "tests/authorization/authorization-domain.test.mjs",
  "tests/authorization/authorization-context-domain.test.mjs",
  "tests/platform/authorization-tenant-foundation.test.mjs",
  "tests/platform/authorization-policy-ceiling.test.mjs",
  "tests/platform/authorization-membership-context.test.mjs",
  "tests/platform/authorization-session-context.test.mjs",
  "tsconfig.authorization-tests.json"
];

const missing = requiredFiles.filter((path) => !existsSync(resolve(path)));
if (missing.length > 0) {
  console.error(`Missing M1.04 authorization files:\n${missing.join("\n")}`);
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

const domain = requireMarkers(
  "src/lib/authorization/authorization-domain.ts",
  [
    "PLATFORM_PERMISSIONS",
    "TENANT_PERMISSIONS",
    "TENANT_STATUSES",
    "AuthorizationContext",
    "tenantStatus: TenantStatus",
    '"tenant_role_mismatch"',
    '"tenant_inactive"',
    "ROLE_PLATFORM_PERMISSION_GRANTS",
    "TENANT_ROLE_PERMISSION_GRANTS",
    "createTenantId",
    "createTenantMembershipId",
    "evaluatePlatformPermission",
    "evaluateTenantPermission",
    "canGrantTenantRole",
    "canAssignTenantRole",
    "canSetTenantPermissionOverride",
    'from "../auth/auth-domain"'
  ]
);

if (/['"`]\*\.|\.\*['"`]/.test(domain)) {
  console.error("Authorization permissions must be explicit and wildcard-free.");
  process.exit(1);
}
if (!domain.includes('root: [') || !domain.includes('"platform.emergency.recover"')) {
  console.error("Root emergency permissions must remain explicit.");
  process.exit(1);
}
if (/root:[\s\S]*?platform\.tenants\.manage/.test(domain)) {
  console.error("Root must not receive routine tenant management by accidental grant.");
  process.exit(1);
}
if (!/activeRole !== "company"[\s\S]*tenant_role_mismatch/.test(domain)) {
  console.error("Only a Company active portal may evaluate tenant permissions.");
  process.exit(1);
}
if (!/tenantStatus !== "active"[\s\S]*tenant_inactive/.test(domain)) {
  console.error("Inactive Company tenants must be denied before tenant permissions resolve.");
  process.exit(1);
}
if (!/actorMembershipId === input\.targetMembershipId[\s\S]*return false/.test(domain)) {
  console.error("Membership self-grant and self-modification must remain denied.");
  process.exit(1);
}

const contextDomain = requireMarkers(
  "src/lib/authorization/authorization-context-domain.ts",
  [
    "PORTAL_ENTRY_PERMISSIONS",
    "TrustedSessionAuthorizationSnapshot",
    "resolveSessionAuthorizationContext",
    "MAX_SESSION_CLOCK_SKEW_MS",
    '"session_revoked"',
    '"session_expired"',
    '"session_stale"',
    '"account_inactive"',
    '"role_mismatch"',
    '"permission_denied"',
    "authorizePlatformPermission",
    "authorizePortalEntry",
    "authorizeCurrentTenantPermission",
    "resolveTenantPermissions"
  ]
);
if (/request|headers|cookies|searchParams|FormData/.test(contextDomain)) {
  console.error("The pure authorization context domain must not read request state.");
  process.exit(1);
}
if (/\.js["']/.test(contextDomain) || /\.js["']/.test(domain)) {
  console.error("Runtime authorization TypeScript must not depend on emitted .js paths.");
  process.exit(1);
}

const contextRepository = requireMarkers(
  "src/lib/authorization/authorization-context-repository.ts",
  [
    "BUILD-PIN AUTHZ-SESSION-CONTEXT-QUERY",
    "AUTHORIZATION_CONTEXT_SQL",
    "sessions.token_hash = $1",
    "sessions.active_role = 'company'",
    "memberships.account_id = sessions.account_id",
    "memberships.membership_status IN ('invited', 'active', 'suspended')",
    "AuthorizationContextRepository",
    "findBySessionTokenHash",
    "touchSession"
  ]
);
const contextSql = contextRepository.match(
  /export const AUTHORIZATION_CONTEXT_SQL = `([\s\S]*?)`;/
)?.[1];
if (!contextSql) {
  console.error("The authoritative authorization context SQL is not extractable.");
  process.exit(1);
}
if (/\$2|tenant_id\s*=\s*\$|membership_id\s*=\s*\$/i.test(contextSql)) {
  console.error("Authorization context SQL may accept only the server session token hash.");
  process.exit(1);
}
if (/\b(request|header|cookie|form_data|search_params)\b/i.test(contextSql)) {
  console.error("Authorization context SQL must not derive tenant state from request input.");
  process.exit(1);
}

const authorizationService = requireMarkers(
  "src/lib/authorization/authorization-service.ts",
  [
    "BUILD-PIN AUTHZ-SESSION-CENTRAL-GUARD",
    "readAuthSessionToken",
    "getAuthorizationContextRepository",
    "resolveSessionAuthorizationContext",
    "PORTAL_ENTRY_PERMISSIONS[expectedRole]",
    "requirePortalAuthorization",
    "requirePlatformPermission",
    "requireCurrentTenantPermission",
    'eventType: "access_denied"',
    'redirect("/access-denied")'
  ]
);
if (/request\.headers|searchParams|FormData|tenantId\s*:/.test(authorizationService)) {
  console.error("Central authorization guards must not accept a client-selected tenant.");
  process.exit(1);
}
if (/expectedRole\s*===\s*"worker"[\s\S]*worker\.self\.read/.test(authorizationService)) {
  console.error("Portal permission mapping must come only from PORTAL_ENTRY_PERMISSIONS.");
  process.exit(1);
}

const sessionService = requireMarkers(
  "src/lib/auth/auth-session-service.ts",
  [
    "readServerAuthorizationContext",
    "requirePortalAuthorization(expectedRole)",
    "authenticatedSessionFromPrincipal"
  ]
);
if (/session\.role !== expectedRole|portal_role_mismatch/.test(sessionService)) {
  console.error("Legacy route-local role denial must not bypass the central authorization guard.");
  process.exit(1);
}

const migration = requireMarkers(
  "database/migrations/0005_authorization_tenant_isolation.up.sql",
  [
    "platform_tenants",
    "auth_tenant_role_permission_ceiling",
    "auth_tenant_memberships",
    "auth_tenant_permission_overrides",
    "auth_tenant_membership_company_role_fk",
    "auth_current_tenant_membership_idx",
    "auth_current_company_membership_account_idx",
    "auth_tenant_permission_membership_role_fk",
    "auth_tenant_permission_role_ceiling_fk",
    "permission_key NOT LIKE '%*%'",
    "^tenant_[A-Za-z0-9_-]{24}$",
    "^membership_[A-Za-z0-9_-]{24}$"
  ]
);

if (!/FOREIGN KEY \(account_id, portal_role\)[\s\S]*auth_account_roles/.test(migration)) {
  console.error("Tenant membership must be bound to an assigned Company portal role.");
  process.exit(1);
}
if (!/UNIQUE INDEX[\s\S]*tenant_id, account_id/.test(migration)) {
  console.error("Current tenant membership uniqueness boundary is missing.");
  process.exit(1);
}
if (!/UNIQUE INDEX[\s\S]*auth_current_company_membership_account_idx[\s\S]*account_id/.test(migration)) {
  console.error("A Company account must have one unambiguous current tenant membership.");
  process.exit(1);
}
if (!/FOREIGN KEY \(membership_role, permission_key\)[\s\S]*auth_tenant_role_permission_ceiling/.test(migration)) {
  console.error("Permission overrides must remain inside the membership-role ceiling at the SQL boundary.");
  process.exit(1);
}

requireMarkers(
  "database/migrations/0005_authorization_tenant_isolation.down.sql",
  [
    "DROP TABLE IF EXISTS auth_tenant_permission_overrides",
    "DROP TABLE IF EXISTS auth_tenant_memberships",
    "DROP TABLE IF EXISTS auth_tenant_role_permission_ceiling",
    "DROP TABLE IF EXISTS platform_tenants"
  ]
);

const authorizationRunner = requireMarkers(
  "scripts/run-authorization-tests.mjs",
  [
    "authorization-domain.test.mjs",
    "authorization-context-domain.test.mjs"
  ]
);
if (!authorizationRunner.includes("tsconfig.authorization-tests.json")) {
  console.error("Authorization tests must compile through the strict isolated config.");
  process.exit(1);
}
if (/writeFileSync|type\\":\\"module/.test(authorizationRunner)) {
  console.error("Authorization test output must not alter runtime module semantics.");
  process.exit(1);
}
requireMarkers("tsconfig.authorization-tests.json", [
  "authorization-domain.ts",
  "authorization-context-domain.ts",
  '"module": "Node16"',
  '"moduleResolution": "Node16"'
]);

const packageDocument = JSON.parse(source("package.json"));
for (const script of [
  "check:authorization",
  "test:authorization",
  "test:authorization-platform"
]) {
  if (!packageDocument.scripts?.[script]) {
    console.error(`package.json is missing ${script}.`);
    process.exit(1);
  }
}
if (!packageDocument.scripts.check.includes("check:authorization")) {
  console.error("The complete check gate must include check:authorization.");
  process.exit(1);
}
if (!packageDocument.scripts.check.includes("test:authorization")) {
  console.error("The complete check gate must include authorization domain tests.");
  process.exit(1);
}
if (!packageDocument.scripts.check.includes("test:authorization-platform")) {
  console.error("The complete check gate must include authorization platform tests.");
  process.exit(1);
}
for (const testFile of [
  "authorization-policy-ceiling.test.mjs",
  "authorization-membership-context.test.mjs",
  "authorization-session-context.test.mjs"
]) {
  if (!packageDocument.scripts["test:authorization-platform"].includes(testFile)) {
    console.error(`${testFile} must remain in the authorization platform gate.`);
    process.exit(1);
  }
}

console.log(
  "Explicit permissions, trusted session context, central platform and tenant guards, Company lifecycle denial, self-grant rejection, one server-derived tenant context, opaque identifiers, SQL role ceilings, source-contract enforcement and wildcard denial passed."
);
