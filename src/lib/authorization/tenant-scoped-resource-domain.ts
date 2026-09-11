import { createIdentifier } from "../auth/auth-domain";
import type { TenantAuthorizationPrincipal } from "./authorization-context-domain";
import type { TenantPermission } from "./authorization-domain";

export const TENANT_SCOPE_FIXTURE_READ_PERMISSION =
  "company.tenant.read" as const satisfies TenantPermission;
export const TENANT_SCOPE_FIXTURE_WRITE_PERMISSION =
  "company.settings.manage" as const satisfies TenantPermission;

export type TenantPermissionPrincipal<P extends TenantPermission> =
  TenantAuthorizationPrincipal & {
    readonly authorizedTenantPermission: P;
  };

export type TrustedTenantScope = Readonly<{
  tenantId: string;
  membershipId: string;
  accountId: string;
  sessionId: string;
}>;

export type TenantScopeFixtureRecord = Readonly<{
  fixtureId: string;
  tenantId: string;
  recordKey: string;
  payload: Readonly<Record<string, unknown>>;
  version: number;
  createdByMembershipId: string;
  createdAt: string;
  updatedAt: string;
}>;

export class TenantScopeContractError extends Error {
  constructor(message = "Trusted tenant authorization context is invalid.") {
    super(message);
    this.name = "TenantScopeContractError";
  }
}

export class TenantScopeDeniedError extends Error {
  constructor() {
    super("The tenant-scoped operation could not be completed.");
    this.name = "TenantScopeDeniedError";
  }
}

export class TenantScopeConflictError extends Error {
  constructor() {
    super("The tenant-scoped operation could not be completed.");
    this.name = "TenantScopeConflictError";
  }
}

export function bindTenantPermissionPrincipal<P extends TenantPermission>(
  principal: TenantAuthorizationPrincipal,
  permission: P
): TenantPermissionPrincipal<P> {
  return Object.freeze({
    ...principal,
    authorizedTenantPermission: permission
  }) as TenantPermissionPrincipal<P>;
}

export function deriveTrustedTenantScope<P extends TenantPermission>(
  principal: TenantPermissionPrincipal<P>
): TrustedTenantScope {
  const membership = principal.tenantMembership;
  if (
    principal.activeRole !== "company" ||
    principal.accountStatus !== "active" ||
    membership.tenantStatus !== "active" ||
    membership.status !== "active" ||
    membership.tenantId.length === 0 ||
    membership.membershipId.length === 0 ||
    principal.accountId.length === 0 ||
    principal.sessionId.length === 0
  ) {
    throw new TenantScopeContractError();
  }

  return Object.freeze({
    tenantId: membership.tenantId,
    membershipId: membership.membershipId,
    accountId: principal.accountId,
    sessionId: principal.sessionId
  });
}

export function createTenantScopeFixtureId(): string {
  return createIdentifier("tenantfixture");
}

export function normalizeTenantScopeFixtureKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 64 ||
    !/^[a-z0-9][a-z0-9_-]*[a-z0-9]$/.test(normalized)
  ) {
    throw new Error(
      "Fixture key must contain 3 to 64 lowercase letters, numbers, underscores or hyphens."
    );
  }
  return normalized;
}

export function normalizeTenantScopeFixturePayload(
  value: unknown
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Fixture payload must be a JSON object.");
  }

  const serialized = JSON.stringify(value);
  if (serialized.length > 16_384) {
    throw new Error("Fixture payload exceeds the 16 KB test-resource limit.");
  }
  const parsed = JSON.parse(serialized) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Fixture payload must be a JSON object.");
  }
  return Object.freeze(parsed as Record<string, unknown>);
}
