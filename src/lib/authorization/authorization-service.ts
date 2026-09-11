import "server-only";

import { redirect } from "next/navigation";

import {
  ROLE_LOGIN_PATHS,
  createIdentifier,
  hashOpaqueValue,
  type AuthRole
} from "@/lib/auth/auth-domain";
import { getAuthAccessRepository } from "@/lib/auth/auth-access-repository";
import { readAuthSessionToken } from "@/lib/auth/auth-session-cookie";
import {
  PORTAL_ENTRY_PERMISSIONS,
  asTenantAuthorizationPrincipal,
  authorizeCurrentTenantPermission,
  authorizePlatformPermission,
  authorizePortalEntry,
  resolveSessionAuthorizationContext,
  type AuthorizationPrincipal,
  type ServerAuthorizationDecision,
  type ServerAuthorizationDenialReason,
  type SessionAuthorizationResolution
} from "@/lib/authorization/authorization-context-domain";
import {
  getAuthorizationContextRepository,
  type AuthorizationContextRepository
} from "@/lib/authorization/authorization-context-repository";
import type {
  PlatformPermission,
  TenantPermission
} from "@/lib/authorization/authorization-domain";
import {
  bindTenantPermissionPrincipal,
  type TenantPermissionPrincipal
} from "@/lib/authorization/tenant-scoped-resource-domain";
import { getServerEnvironment } from "@/lib/config/server-environment";

const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function sessionTokenHash(token: string): string {
  return hashOpaqueValue(
    token,
    getServerEnvironment().authPepper,
    "auth-session"
  );
}

function shouldTouchSession(
  principal: AuthorizationPrincipal,
  now: Date
): boolean {
  const lastSeenAt = Date.parse(principal.lastSeenAt);
  return (
    Number.isFinite(lastSeenAt) &&
    now.getTime() - lastSeenAt >= SESSION_TOUCH_INTERVAL_MS
  );
}

export async function readServerAuthorizationContext(input?: {
  now?: Date;
  repository?: AuthorizationContextRepository;
}): Promise<SessionAuthorizationResolution> {
  const rawToken = await readAuthSessionToken();
  const now = input?.now ?? new Date();
  if (!rawToken) {
    return resolveSessionAuthorizationContext({
      snapshot: null,
      now: now.toISOString()
    });
  }

  const repository =
    input?.repository ?? (await getAuthorizationContextRepository());
  const snapshot = await repository.findBySessionTokenHash(
    sessionTokenHash(rawToken)
  );
  const resolution = resolveSessionAuthorizationContext({
    snapshot,
    now: now.toISOString()
  });

  if (
    resolution.allowed &&
    shouldTouchSession(resolution.principal, now)
  ) {
    await repository.touchSession({
      sessionId: resolution.principal.sessionId,
      touchedAt: now.toISOString()
    });
  }

  return resolution;
}

function isCredentialDenial(
  reason: ServerAuthorizationDenialReason
): boolean {
  return (
    reason === "unauthenticated" ||
    reason === "session_revoked" ||
    reason === "session_expired" ||
    reason === "session_stale" ||
    reason === "account_inactive"
  );
}

async function recordAuthorizationDenial(input: {
  decision: Extract<ServerAuthorizationDecision, { allowed: false }>;
  expectedRole: AuthRole;
  permission: PlatformPermission | TenantPermission;
}): Promise<void> {
  const audit = input.decision.auditContext;
  if (!audit) return;

  const repository = await getAuthAccessRepository();
  await repository.authentication.insertSecurityEvent({
    eventId: createIdentifier("event"),
    accountId: audit.accountId,
    eventType: "access_denied",
    activeRole: audit.activeRole,
    metadata: {
      reason: input.decision.reason,
      expectedRole: input.expectedRole,
      permission: input.permission,
      sessionId: audit.sessionId
    },
    occurredAt: new Date().toISOString()
  });
}

async function rejectAuthorization(input: {
  decision: Extract<ServerAuthorizationDecision, { allowed: false }>;
  expectedRole: AuthRole;
  permission: PlatformPermission | TenantPermission;
}): Promise<never> {
  await recordAuthorizationDenial(input);

  if (isCredentialDenial(input.decision.reason)) {
    const reason =
      input.decision.reason === "session_expired"
        ? "session-expired"
        : "session-required";
    redirect(`${ROLE_LOGIN_PATHS[input.expectedRole]}?reason=${reason}`);
  }

  redirect("/access-denied");
}

// BUILD-PIN AUTHZ-SESSION-CENTRAL-GUARD:
// Every portal and server action must reach permission decisions through this
// service. Route code may choose an accepted permission, but it must not rebuild
// role grants or select a tenant from request data.
export async function requirePortalAuthorization(
  expectedRole: AuthRole
): Promise<AuthorizationPrincipal> {
  const resolution = await readServerAuthorizationContext();
  const decision = authorizePortalEntry({ resolution, expectedRole });
  if (decision.allowed) return decision.principal;

  return rejectAuthorization({
    decision,
    expectedRole,
    permission: PORTAL_ENTRY_PERMISSIONS[expectedRole]
  });
}

export async function requirePlatformPermission(input: {
  expectedRole: AuthRole;
  permission: PlatformPermission;
}): Promise<AuthorizationPrincipal> {
  const resolution = await readServerAuthorizationContext();
  const decision = authorizePlatformPermission({
    resolution,
    expectedRole: input.expectedRole,
    permission: input.permission
  });
  if (decision.allowed) return decision.principal;

  return rejectAuthorization({
    decision,
    expectedRole: input.expectedRole,
    permission: input.permission
  });
}

export async function requireCurrentTenantPermission<P extends TenantPermission>(
  permission: P
): Promise<TenantPermissionPrincipal<P>> {
  const resolution = await readServerAuthorizationContext();
  const decision = authorizeCurrentTenantPermission({
    resolution,
    permission
  });
  if (decision.allowed) {
    return bindTenantPermissionPrincipal(
      asTenantAuthorizationPrincipal(decision.principal),
      permission
    );
  }

  return rejectAuthorization({
    decision,
    expectedRole: "company",
    permission
  });
}
