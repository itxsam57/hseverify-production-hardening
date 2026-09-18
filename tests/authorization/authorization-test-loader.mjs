import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const outputDirectory = resolve(".authorization-test-dist");

const compiler = spawnSync(
  process.execPath,
  [resolve("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.authorization-tests.json"],
  { stdio: "inherit" }
);

if (compiler.status !== 0) {
  throw new Error("Authorization test TypeScript compilation failed.");
}

const authorizationDomainModule = await import(`${outputDirectory}/authorization/authorization-domain.js`);
const authorizationContextModule = await import(`${outputDirectory}/authorization/authorization-context-domain.js`);
const tenantScopedModule = await import(`${outputDirectory}/authorization/tenant-scoped-resource-domain.js`);

export const {
  PLATFORM_PERMISSIONS,
  TENANT_MEMBERSHIP_ROLES,
  TENANT_PERMISSIONS,
  TENANT_STATUSES,
  canAssignTenantRole,
  canGrantTenantRole,
  canSetTenantPermissionOverride,
  createTenantId,
  createTenantMembershipId,
  evaluatePlatformPermission,
  evaluateTenantPermission,
  isPlatformPermission,
  isTenantMembershipRole,
  isTenantPermission,
  isTenantStatus,
  platformPermissionsForRole,
  resolveTenantPermissions,
  roleHasPlatformPermission,
  tenantPermissionsForRole,
  tenantRoleHasPermission
} = authorizationDomainModule;

export const {
  resolveAuthorizationContext,
  AuthorizationContextError,
  resolveTenantMembershipContext
} = authorizationContextModule;

export const {
  TenantScopedResourceError,
  assertTenantScopedResourceAccess
} = tenantScopedModule;

export const {
  PORTAL_ENTRY_PERMISSIONS,
  resolveSessionAuthorizationContext,
  authorizePlatformPermission,
  authorizePortalEntry,
  authorizeCurrentTenantPermission
} = authorizationContextModule;

export const {
  TENANT_SCOPE_FIXTURE_READ_PERMISSION,
  TENANT_SCOPE_FIXTURE_WRITE_PERMISSION,
  bindTenantPermissionPrincipal,
  createTenantScopeFixtureId,
  deriveTrustedTenantScope,
  normalizeTenantScopeFixtureKey,
  normalizeTenantScopeFixturePayload
} = tenantScopedModule;
