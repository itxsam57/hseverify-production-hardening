import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

let ownedOutputDirectory = null;
const configuredOutputDirectory = process.env.HSE_AUTHORIZATION_TEST_DIST?.trim();
const outputDirectory = configuredOutputDirectory
  ? resolve(configuredOutputDirectory)
  : (ownedOutputDirectory = mkdtempSync(join(tmpdir(), "hse-authorization-test-loader-")));

if (!configuredOutputDirectory) {
  const compiler = spawnSync(
    process.execPath,
    [
      resolve("node_modules", "typescript", "bin", "tsc"),
      "-p",
      "tsconfig.authorization-tests.json",
      "--outDir",
      outputDirectory
    ],
    { stdio: "inherit" }
  );

  if (compiler.status !== 0) {
    rmSync(outputDirectory, { recursive: true, force: true });
    throw new Error("Authorization test TypeScript compilation failed.");
  }

  process.once("exit", () => {
    if (ownedOutputDirectory) {
      rmSync(ownedOutputDirectory, { recursive: true, force: true });
    }
  });
}

async function loadCompiledModule(relativePath) {
  return import(pathToFileURL(resolve(outputDirectory, relativePath)).href);
}

const authorizationDomainModule = await loadCompiledModule("authorization/authorization-domain.js");
const authorizationContextModule = await loadCompiledModule("authorization/authorization-context-domain.js");
const tenantScopedModule = await loadCompiledModule("authorization/tenant-scoped-resource-domain.js");

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
