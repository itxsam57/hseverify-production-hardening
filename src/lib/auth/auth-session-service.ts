import "server-only";

import { redirect } from "next/navigation";

import {
  ROLE_HOME_PATHS,
  ROLE_LOGIN_PATHS,
  createIdentifier,
  createOpaqueToken,
  hashOpaqueValue,
  type AuthRole
} from "@/lib/auth/auth-domain";
import {
  clearAuthSessionToken,
  readAuthSessionToken,
  writeAuthSessionToken,
  AUTH_SESSION_TTL_SECONDS
} from "@/lib/auth/auth-session-cookie";
import {
  getAuthAccessRepository,
  type ActiveSessionSummary,
  type AuthAccessRepository
} from "@/lib/auth/auth-access-repository";
import {
  readServerAuthorizationContext,
  requirePortalAuthorization
} from "@/lib/authorization/authorization-service";
import type { AuthorizationPrincipal } from "@/lib/authorization/authorization-context-domain";
import { getServerEnvironment } from "@/lib/config/server-environment";

// M1.03 compatibility boundary: requirePortalAuthorization records
// access_denied and performs redirect("/access-denied") through the central
// M1.04 authorization service. This module must not duplicate that decision.

export type AuthenticatedSession = {
  sessionId: string;
  accountId: string;
  role: AuthRole;
  email: string;
  displayName: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

function tokenHash(token: string): string {
  const environment = getServerEnvironment();
  return hashOpaqueValue(token, environment.authPepper, "auth-session");
}

function metadataHash(
  value: string | null,
  pepper: string,
  context: string
): string | null {
  if (!value) return null;
  return hashOpaqueValue(value, pepper, context);
}

function addSeconds(value: Date, seconds: number): string {
  return new Date(value.getTime() + seconds * 1000).toISOString();
}

function authenticatedSessionFromPrincipal(
  principal: AuthorizationPrincipal
): AuthenticatedSession {
  return {
    sessionId: principal.sessionId,
    accountId: principal.accountId,
    role: principal.activeRole,
    email: principal.email,
    displayName: principal.displayName,
    createdAt: principal.createdAt,
    lastSeenAt: principal.lastSeenAt,
    expiresAt: principal.expiresAt
  };
}

async function recordSessionCreation(input: {
  repository: AuthAccessRepository;
  accountId: string;
  role: AuthRole;
  sessionId: string;
  token: string;
  csrfToken: string;
  userAgent: string | null;
  ipAddress: string | null;
  requestFingerprint: string | null;
  pepper: string;
  now: Date;
}): Promise<void> {
  const nowIso = input.now.toISOString();
  await input.repository.authentication.insertSession({
    sessionId: input.sessionId,
    accountId: input.accountId,
    activeRole: input.role,
    tokenHash: hashOpaqueValue(
      input.token,
      input.pepper,
      "auth-session"
    ),
    csrfTokenHash: hashOpaqueValue(
      input.csrfToken,
      input.pepper,
      "auth-session-csrf"
    ),
    userAgentHash: metadataHash(
      input.userAgent,
      input.pepper,
      "auth-session-user-agent"
    ),
    ipAddressHash: metadataHash(
      input.ipAddress,
      input.pepper,
      "auth-session-ip"
    ),
    createdAt: nowIso,
    lastSeenAt: nowIso,
    expiresAt: addSeconds(input.now, AUTH_SESSION_TTL_SECONDS)
  });
  await input.repository.authentication.insertSecurityEvent({
    eventId: createIdentifier("event"),
    accountId: input.accountId,
    eventType: "login_succeeded",
    activeRole: input.role,
    requestFingerprintHash: metadataHash(
      input.requestFingerprint,
      input.pepper,
      "auth-sign-in-request"
    ),
    metadata: { sessionId: input.sessionId },
    occurredAt: nowIso
  });
}

export async function createAuthenticationSession(input: {
  accountId: string;
  role: AuthRole;
  userAgent: string | null;
  ipAddress: string | null;
  requestFingerprint?: string | null;
  now?: Date;
}): Promise<{ sessionId: string; token: string }> {
  const repository = await getAuthAccessRepository();
  const environment = getServerEnvironment();
  const now = input.now ?? new Date();
  const token = createOpaqueToken();
  const csrfToken = createOpaqueToken();
  const sessionId = createIdentifier("session");

  await repository.transaction((transaction) =>
    recordSessionCreation({
      repository: transaction,
      accountId: input.accountId,
      role: input.role,
      sessionId,
      token,
      csrfToken,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      requestFingerprint: input.requestFingerprint ?? null,
      pepper: environment.authPepper,
      now
    })
  );

  return { sessionId, token };
}

export async function establishAuthenticationSession(input: {
  accountId: string;
  role: AuthRole;
  userAgent: string | null;
  ipAddress: string | null;
  requestFingerprint?: string | null;
}): Promise<string> {
  const created = await createAuthenticationSession(input);
  await writeAuthSessionToken(created.token);
  return created.sessionId;
}

export async function readAuthenticatedSession(): Promise<AuthenticatedSession | null> {
  const resolution = await readServerAuthorizationContext();
  return resolution.allowed
    ? authenticatedSessionFromPrincipal(resolution.principal)
    : null;
}

export async function requireAuthenticatedSession(): Promise<AuthenticatedSession> {
  const session = await readAuthenticatedSession();
  if (!session) {
    redirect("/worker/login?reason=session-required");
  }
  return session;
}

export async function requireRoleSession(
  expectedRole: AuthRole
): Promise<AuthenticatedSession> {
  const principal = await requirePortalAuthorization(expectedRole);
  return authenticatedSessionFromPrincipal(principal);
}

export async function revokeCurrentAuthenticationSession(
  reason = "user_logout"
): Promise<AuthRole | null> {
  const rawToken = await readAuthSessionToken();
  const repository = await getAuthAccessRepository();
  let role: AuthRole | null = null;

  if (rawToken) {
    const nowIso = new Date().toISOString();
    const record = await repository.authentication.findActiveSessionByTokenHash(
      tokenHash(rawToken),
      nowIso
    );
    if (record) {
      role = record.activeRole;
      await repository.transaction(async (transaction) => {
        const revoked = await transaction.authentication.revokeSession({
          sessionId: record.sessionId,
          revokedAt: nowIso,
          reason
        });
        if (!revoked) return;
        await transaction.authentication.insertSecurityEvent({
          eventId: createIdentifier("event"),
          accountId: record.accountId,
          eventType: "logout",
          activeRole: record.activeRole,
          metadata: { reason },
          occurredAt: nowIso
        });
      });
    }
  }

  await clearAuthSessionToken();
  return role;
}

export async function listOwnActiveSessions(
  session: AuthenticatedSession
): Promise<ActiveSessionSummary[]> {
  const repository = await getAuthAccessRepository();
  return repository.listActiveSessions(
    session.accountId,
    new Date().toISOString()
  );
}

export async function revokeOwnSession(input: {
  session: AuthenticatedSession;
  targetSessionId: string;
}): Promise<boolean> {
  const repository = await getAuthAccessRepository();
  const revokedAt = new Date().toISOString();
  return repository.transaction(async (transaction) => {
    const revoked = await transaction.revokeOwnedSession({
      accountId: input.session.accountId,
      sessionId: input.targetSessionId,
      revokedAt,
      reason: "user_revoked"
    });
    if (!revoked) return false;
    await transaction.authentication.insertSecurityEvent({
      eventId: createIdentifier("event"),
      accountId: input.session.accountId,
      eventType: "session_revoked",
      activeRole: input.session.role,
      metadata: {
        targetSessionId: input.targetSessionId,
        self: input.targetSessionId === input.session.sessionId
      },
      occurredAt: revokedAt
    });
    return true;
  });
}

export function authenticatedHomePath(role: AuthRole): string {
  return ROLE_HOME_PATHS[role];
}

export function authenticatedLoginPath(role: AuthRole): string {
  return ROLE_LOGIN_PATHS[role];
}
