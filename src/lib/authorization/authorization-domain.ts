import {
  createIdentifier,
  type AuthRole
} from "../auth/auth-domain";

export const PLATFORM_PERMISSIONS = [
  "worker.self.read",
  "worker.self.manage",
  "worker.assessments.read",
  "company.portal.access",
  "verification.assigned.read",
  "verification.assigned.decide",
  "interview.assigned.read",
  "interview.assigned.manage",
  "platform.staff.read",
  "platform.staff.manage",
  "platform.tenants.read",
  "platform.tenants.manage",
  "platform.operations.read",
  "platform.operations.manage",
  "platform.security.read",
  "platform.security.manage",
  "platform.emergency.recover"
] as const;

export const TENANT_PERMISSIONS = [
  "company.tenant.read",
  "company.settings.manage",
  "company.members.read",
  "company.members.manage",
  "company.members.grant_owner",
  "company.workforce.read",
  "company.workforce.manage",
  "company.orders.read",
  "company.orders.manage",
  "company.billing.read",
  "company.billing.manage",
  "company.reports.read",
  "company.reports.export",
  "company.audit.read"
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];
export type Permission = PlatformPermission | TenantPermission;

export const TENANT_STATUSES = [
  "pending",
  "active",
  "suspended",
  "archived"
] as const;

export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_MEMBERSHIP_ROLES = [
  "owner",
  "admin",
  "manager",
  "viewer"
] as const;

export type TenantMembershipRole = (typeof TENANT_MEMBERSHIP_ROLES)[number];

export const TENANT_MEMBERSHIP_STATUSES = [
  "invited",
  "active",
  "suspended",
  "revoked"
] as const;

export type TenantMembershipStatus =
  (typeof TENANT_MEMBERSHIP_STATUSES)[number];

export type PermissionOverrideEffect = "grant" | "deny";

export interface TenantPermissionOverride {
  permission: TenantPermission;
  effect: PermissionOverrideEffect;
}

export interface AuthorizationContext {
  accountId: string;
  sessionId: string;
  activeRole: AuthRole;
  tenantMembership: null | {
    tenantId: string;
    tenantStatus: TenantStatus;
    membershipId: string;
    role: TenantMembershipRole;
    status: TenantMembershipStatus;
    overrides: readonly TenantPermissionOverride[];
  };
}

export type AuthorizationDenialReason =
  | "role_permission_denied"
  | "tenant_role_mismatch"
  | "tenant_context_missing"
  | "tenant_mismatch"
  | "tenant_inactive"
  | "membership_inactive"
  | "tenant_permission_denied";

export type AuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reason: AuthorizationDenialReason };

const ROLE_PLATFORM_PERMISSION_GRANTS = {
  worker: ["worker.self.read", "worker.self.manage", "worker.assessments.read"],
  company: ["company.portal.access"],
  assessor: ["interview.assigned.read", "interview.assigned.manage"],
  verifier: ["verification.assigned.read", "verification.assigned.decide"],
  admin: [
    "platform.staff.read",
    "platform.staff.manage",
    "platform.tenants.read",
    "platform.tenants.manage",
    "platform.operations.read",
    "platform.operations.manage",
    "platform.security.read"
  ],
  root: [
    "platform.staff.read",
    "platform.staff.manage",
    "platform.security.read",
    "platform.security.manage",
    "platform.emergency.recover"
  ]
} as const satisfies Record<AuthRole, readonly PlatformPermission[]>;

const TENANT_ROLE_PERMISSION_GRANTS = {
  viewer: [
    "company.tenant.read",
    "company.workforce.read",
    "company.orders.read",
    "company.reports.read"
  ],
  manager: [
    "company.tenant.read",
    "company.workforce.read",
    "company.workforce.manage",
    "company.orders.read",
    "company.orders.manage",
    "company.reports.read",
    "company.reports.export"
  ],
  admin: [
    "company.tenant.read",
    "company.settings.manage",
    "company.members.read",
    "company.members.manage",
    "company.workforce.read",
    "company.workforce.manage",
    "company.orders.read",
    "company.orders.manage",
    "company.billing.read",
    "company.billing.manage",
    "company.reports.read",
    "company.reports.export",
    "company.audit.read"
  ],
  owner: TENANT_PERMISSIONS
} as const satisfies Record<
  TenantMembershipRole,
  readonly TenantPermission[]
>;

export function createTenantId(): string {
  return createIdentifier("tenant");
}

export function createTenantMembershipId(): string {
  return createIdentifier("membership");
}

export function isPlatformPermission(
  value: unknown
): value is PlatformPermission {
  return (
    typeof value === "string" &&
    PLATFORM_PERMISSIONS.includes(value as PlatformPermission)
  );
}

export function isTenantPermission(value: unknown): value is TenantPermission {
  return (
    typeof value === "string" &&
    TENANT_PERMISSIONS.includes(value as TenantPermission)
  );
}

export function isTenantStatus(value: unknown): value is TenantStatus {
  return (
    typeof value === "string" &&
    TENANT_STATUSES.includes(value as TenantStatus)
  );
}

export function isTenantMembershipRole(
  value: unknown
): value is TenantMembershipRole {
  return (
    typeof value === "string" &&
    TENANT_MEMBERSHIP_ROLES.includes(value as TenantMembershipRole)
  );
}

export function isTenantMembershipStatus(
  value: unknown
): value is TenantMembershipStatus {
  return (
    typeof value === "string" &&
    TENANT_MEMBERSHIP_STATUSES.includes(value as TenantMembershipStatus)
  );
}

export function platformPermissionsForRole(
  role: AuthRole
): readonly PlatformPermission[] {
  return ROLE_PLATFORM_PERMISSION_GRANTS[role];
}

export function tenantPermissionsForRole(
  role: TenantMembershipRole
): readonly TenantPermission[] {
  return TENANT_ROLE_PERMISSION_GRANTS[role];
}

export function roleHasPlatformPermission(
  role: AuthRole,
  permission: PlatformPermission
): boolean {
  return (platformPermissionsForRole(role) as readonly PlatformPermission[]).includes(
    permission
  );
}

export function tenantRoleHasPermission(
  role: TenantMembershipRole,
  permission: TenantPermission
): boolean {
  return (tenantPermissionsForRole(role) as readonly TenantPermission[]).includes(
    permission
  );
}

export function resolveTenantPermissions(
  role: TenantMembershipRole,
  overrides: readonly TenantPermissionOverride[] = []
): ReadonlySet<TenantPermission> {
  const resolved = new Set<TenantPermission>(tenantPermissionsForRole(role));
  const seen = new Set<TenantPermission>();

  for (const override of overrides) {
    if (!isTenantPermission(override.permission)) {
      throw new Error("Unknown tenant permission override.");
    }
    if (seen.has(override.permission)) {
      throw new Error("Duplicate tenant permission override.");
    }
    if (!tenantRoleHasPermission(role, override.permission)) {
      throw new Error("Tenant permission override exceeds the membership role.");
    }
    seen.add(override.permission);
    if (override.effect === "grant") {
      resolved.add(override.permission);
    } else if (override.effect === "deny") {
      resolved.delete(override.permission);
    } else {
      throw new Error("Unknown tenant permission override effect.");
    }
  }

  return resolved;
}

export function evaluatePlatformPermission(input: {
  role: AuthRole;
  permission: PlatformPermission;
}): AuthorizationDecision {
  return roleHasPlatformPermission(input.role, input.permission)
    ? { allowed: true }
    : { allowed: false, reason: "role_permission_denied" };
}

export function evaluateTenantPermission(input: {
  context: AuthorizationContext;
  resourceTenantId: string;
  permission: TenantPermission;
}): AuthorizationDecision {
  if (input.context.activeRole !== "company") {
    return { allowed: false, reason: "tenant_role_mismatch" };
  }
  const membership = input.context.tenantMembership;
  if (!membership) {
    return { allowed: false, reason: "tenant_context_missing" };
  }
  if (membership.tenantId !== input.resourceTenantId) {
    return { allowed: false, reason: "tenant_mismatch" };
  }
  if (membership.tenantStatus !== "active") {
    return { allowed: false, reason: "tenant_inactive" };
  }
  if (membership.status !== "active") {
    return { allowed: false, reason: "membership_inactive" };
  }
  const permissions = resolveTenantPermissions(
    membership.role,
    membership.overrides
  );
  return permissions.has(input.permission)
    ? { allowed: true }
    : { allowed: false, reason: "tenant_permission_denied" };
}

export function canGrantTenantRole(
  actorRole: TenantMembershipRole,
  targetRole: TenantMembershipRole
): boolean {
  if (actorRole === "owner") return true;
  if (actorRole === "admin") {
    return targetRole === "manager" || targetRole === "viewer";
  }
  return false;
}

export function canAssignTenantRole(input: {
  actorMembershipId: string;
  actorRole: TenantMembershipRole;
  targetMembershipId: string;
  targetRole: TenantMembershipRole;
}): boolean {
  if (input.actorMembershipId === input.targetMembershipId) return false;
  return canGrantTenantRole(input.actorRole, input.targetRole);
}

export function canSetTenantPermissionOverride(input: {
  actorMembershipId: string;
  actorRole: TenantMembershipRole;
  targetMembershipId: string;
  targetRole: TenantMembershipRole;
  permission: TenantPermission;
  effect: PermissionOverrideEffect;
}): boolean {
  if (
    !canAssignTenantRole({
      actorMembershipId: input.actorMembershipId,
      actorRole: input.actorRole,
      targetMembershipId: input.targetMembershipId,
      targetRole: input.targetRole
    })
  ) {
    return false;
  }
  if (!tenantRoleHasPermission(input.targetRole, input.permission)) return false;
  if (
    input.permission === "company.members.grant_owner" &&
    input.actorRole !== "owner"
  ) {
    return false;
  }
  return input.effect === "grant" || input.effect === "deny";
}
