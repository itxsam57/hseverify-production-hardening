import type {
  AccountStatus,
  AuthRole
} from "../auth/auth-domain";
import {
  evaluatePlatformPermission,
  evaluateTenantPermission,
  resolveTenantPermissions,
  type AuthorizationContext,
  type PlatformPermission,
  type TenantMembershipRole,
  type TenantMembershipStatus,
  type TenantPermission,
  type TenantPermissionOverride,
  type TenantStatus
} from "./authorization-domain";

const MAX_SESSION_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const PORTAL_ENTRY_PERMISSIONS = {
  worker: "worker.self.read",
  company: "company.portal.access",
  assessor: "interview.assigned.read",
  verifier: "verification.assigned.read",
  admin: "platform.operations.read",
  root: "platform.security.read"
} as const satisfies Record<AuthRole, PlatformPermission>;

export type TrustedTenantMembershipSnapshot = {
  tenantId: string;
  tenantStatus: TenantStatus;
  membershipId: string;
  role: TenantMembershipRole;
  status: TenantMembershipStatus;
  overrides: readonly TenantPermissionOverride[];
};

export type TrustedSessionAuthorizationSnapshot = {
  sessionId: string;
  accountId: string;
  activeRole: AuthRole;
  accountStatus: AccountStatus;
  email: string;
  displayName: string;
  roleAssigned: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  tenantMembership: TrustedTenantMembershipSnapshot | null;
};

export type AuthorizationAuditContext = {
  sessionId: string;
  accountId: string;
  activeRole: AuthRole;
};

export type ServerAuthorizationDenialReason =
  | "unauthenticated"
  | "session_revoked"
  | "session_expired"
  | "session_stale"
  | "account_inactive"
  | "role_mismatch"
  | "permission_denied"
  | "tenant_context_missing"
  | "tenant_mismatch"
  | "tenant_inactive"
  | "membership_inactive";

export type AuthorizationPrincipal = AuthorizationContext & {
  accountStatus: "active";
  email: string;
  displayName: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

export type SessionAuthorizationResolution =
  | {
      allowed: true;
      principal: AuthorizationPrincipal;
    }
  | {
      allowed: false;
      reason: ServerAuthorizationDenialReason;
      auditContext: AuthorizationAuditContext | null;
    };

export type ServerAuthorizationDecision =
  | {
      allowed: true;
      principal: AuthorizationPrincipal;
    }
  | {
      allowed: false;
      reason: ServerAuthorizationDenialReason;
      auditContext: AuthorizationAuditContext | null;
    };

export type TenantAuthorizationPrincipal = AuthorizationPrincipal & {
  tenantMembership: NonNullable<AuthorizationPrincipal["tenantMembership"]>;
};

function auditContext(
  snapshot: TrustedSessionAuthorizationSnapshot
): AuthorizationAuditContext {
  return {
    sessionId: snapshot.sessionId,
    accountId: snapshot.accountId,
    activeRole: snapshot.activeRole
  };
}

function denied(
  reason: ServerAuthorizationDenialReason,
  snapshot: TrustedSessionAuthorizationSnapshot | null
): SessionAuthorizationResolution {
  return {
    allowed: false,
    reason,
    auditContext: snapshot ? auditContext(snapshot) : null
  };
}

function parsedTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sessionTimestampsAreCoherent(
  snapshot: TrustedSessionAuthorizationSnapshot,
  now: number
): boolean {
  const createdAt = parsedTimestamp(snapshot.createdAt);
  const lastSeenAt = parsedTimestamp(snapshot.lastSeenAt);
  const expiresAt = parsedTimestamp(snapshot.expiresAt);
  if (createdAt === null || lastSeenAt === null || expiresAt === null) {
    return false;
  }
  return (
    createdAt <= lastSeenAt &&
    lastSeenAt <= expiresAt &&
    expiresAt > createdAt &&
    createdAt <= now + MAX_SESSION_CLOCK_SKEW_MS &&
    lastSeenAt <= now + MAX_SESSION_CLOCK_SKEW_MS
  );
}

function tenantSnapshotIsCoherent(
  snapshot: TrustedSessionAuthorizationSnapshot
): boolean {
  const membership = snapshot.tenantMembership;
  if (!membership) return true;
  if (snapshot.activeRole !== "company") return false;
  if (
    membership.tenantId.length === 0 ||
    membership.membershipId.length === 0
  ) {
    return false;
  }
  try {
    resolveTenantPermissions(membership.role, membership.overrides);
    return true;
  } catch {
    return false;
  }
}

export function resolveSessionAuthorizationContext(input: {
  snapshot: TrustedSessionAuthorizationSnapshot | null;
  now: string;
}): SessionAuthorizationResolution {
  const snapshot = input.snapshot;
  if (!snapshot) return denied("unauthenticated", null);
  if (snapshot.revokedAt !== null) return denied("session_revoked", snapshot);

  const now = parsedTimestamp(input.now);
  if (now === null || !sessionTimestampsAreCoherent(snapshot, now)) {
    return denied("session_stale", snapshot);
  }

  const expiresAt = parsedTimestamp(snapshot.expiresAt);
  if (expiresAt === null) {
    return denied("session_stale", snapshot);
  }
  if (expiresAt <= now) return denied("session_expired", snapshot);
  if (!snapshot.roleAssigned) return denied("session_stale", snapshot);
  if (snapshot.accountStatus !== "active") {
    return denied("account_inactive", snapshot);
  }
  if (!tenantSnapshotIsCoherent(snapshot)) {
    return denied("session_stale", snapshot);
  }

  return {
    allowed: true,
    principal: {
      sessionId: snapshot.sessionId,
      accountId: snapshot.accountId,
      activeRole: snapshot.activeRole,
      accountStatus: "active",
      email: snapshot.email,
      displayName: snapshot.displayName,
      createdAt: snapshot.createdAt,
      lastSeenAt: snapshot.lastSeenAt,
      expiresAt: snapshot.expiresAt,
      tenantMembership: snapshot.tenantMembership
    }
  };
}

function deniedFromPrincipal(
  principal: AuthorizationPrincipal,
  reason: ServerAuthorizationDenialReason
): ServerAuthorizationDecision {
  return {
    allowed: false,
    reason,
    auditContext: {
      sessionId: principal.sessionId,
      accountId: principal.accountId,
      activeRole: principal.activeRole
    }
  };
}

export function authorizePlatformPermission(input: {
  resolution: SessionAuthorizationResolution;
  expectedRole?: AuthRole;
  permission: PlatformPermission;
}): ServerAuthorizationDecision {
  if (!input.resolution.allowed) return input.resolution;
  const principal = input.resolution.principal;
  if (input.expectedRole && principal.activeRole !== input.expectedRole) {
    return deniedFromPrincipal(principal, "role_mismatch");
  }
  const decision = evaluatePlatformPermission({
    role: principal.activeRole,
    permission: input.permission
  });
  return decision.allowed
    ? { allowed: true, principal }
    : deniedFromPrincipal(principal, "permission_denied");
}

export function authorizePortalEntry(input: {
  resolution: SessionAuthorizationResolution;
  expectedRole: AuthRole;
}): ServerAuthorizationDecision {
  return authorizePlatformPermission({
    resolution: input.resolution,
    expectedRole: input.expectedRole,
    permission: PORTAL_ENTRY_PERMISSIONS[input.expectedRole]
  });
}

export function authorizeCurrentTenantPermission(input: {
  resolution: SessionAuthorizationResolution;
  permission: TenantPermission;
}): ServerAuthorizationDecision {
  if (!input.resolution.allowed) return input.resolution;
  const principal = input.resolution.principal;
  const membership = principal.tenantMembership;
  if (!membership) {
    return deniedFromPrincipal(principal, "tenant_context_missing");
  }

  const decision = evaluateTenantPermission({
    context: principal,
    resourceTenantId: membership.tenantId,
    permission: input.permission
  });
  if (decision.allowed) return { allowed: true, principal };

  const mappedReason: ServerAuthorizationDenialReason =
    decision.reason === "tenant_role_mismatch"
      ? "role_mismatch"
      : decision.reason === "tenant_permission_denied" ||
          decision.reason === "role_permission_denied"
        ? "permission_denied"
        : decision.reason;
  return deniedFromPrincipal(principal, mappedReason);
}

export function asTenantAuthorizationPrincipal(
  principal: AuthorizationPrincipal
): TenantAuthorizationPrincipal {
  if (!principal.tenantMembership) {
    throw new Error("Tenant authorization succeeded without tenant context.");
  }
  return principal as TenantAuthorizationPrincipal;
}
