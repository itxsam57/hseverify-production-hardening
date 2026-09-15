"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PORTAL_ENTRY_PERMISSIONS = void 0;
exports.resolveSessionAuthorizationContext = resolveSessionAuthorizationContext;
exports.authorizePlatformPermission = authorizePlatformPermission;
exports.authorizePortalEntry = authorizePortalEntry;
exports.authorizeCurrentTenantPermission = authorizeCurrentTenantPermission;
exports.asTenantAuthorizationPrincipal = asTenantAuthorizationPrincipal;
const authorization_domain_1 = require("./authorization-domain");
const MAX_SESSION_CLOCK_SKEW_MS = 5 * 60 * 1000;
exports.PORTAL_ENTRY_PERMISSIONS = {
    worker: "worker.self.read",
    company: "company.portal.access",
    assessor: "interview.assigned.read",
    verifier: "verification.assigned.read",
    admin: "platform.operations.read",
    root: "platform.security.read"
};
function auditContext(snapshot) {
    return {
        sessionId: snapshot.sessionId,
        accountId: snapshot.accountId,
        activeRole: snapshot.activeRole
    };
}
function denied(reason, snapshot) {
    return {
        allowed: false,
        reason,
        auditContext: snapshot ? auditContext(snapshot) : null
    };
}
function parsedTimestamp(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function sessionTimestampsAreCoherent(snapshot, now) {
    const createdAt = parsedTimestamp(snapshot.createdAt);
    const lastSeenAt = parsedTimestamp(snapshot.lastSeenAt);
    const expiresAt = parsedTimestamp(snapshot.expiresAt);
    if (createdAt === null || lastSeenAt === null || expiresAt === null) {
        return false;
    }
    return (createdAt <= lastSeenAt &&
        lastSeenAt <= expiresAt &&
        expiresAt > createdAt &&
        createdAt <= now + MAX_SESSION_CLOCK_SKEW_MS &&
        lastSeenAt <= now + MAX_SESSION_CLOCK_SKEW_MS);
}
function tenantSnapshotIsCoherent(snapshot) {
    const membership = snapshot.tenantMembership;
    if (!membership)
        return true;
    if (snapshot.activeRole !== "company")
        return false;
    if (membership.tenantId.length === 0 ||
        membership.membershipId.length === 0) {
        return false;
    }
    try {
        (0, authorization_domain_1.resolveTenantPermissions)(membership.role, membership.overrides);
        return true;
    }
    catch {
        return false;
    }
}
function resolveSessionAuthorizationContext(input) {
    const snapshot = input.snapshot;
    if (!snapshot)
        return denied("unauthenticated", null);
    if (snapshot.revokedAt !== null)
        return denied("session_revoked", snapshot);
    const now = parsedTimestamp(input.now);
    if (now === null || !sessionTimestampsAreCoherent(snapshot, now)) {
        return denied("session_stale", snapshot);
    }
    const expiresAt = parsedTimestamp(snapshot.expiresAt);
    if (expiresAt === null) {
        return denied("session_stale", snapshot);
    }
    if (expiresAt <= now)
        return denied("session_expired", snapshot);
    if (!snapshot.roleAssigned)
        return denied("session_stale", snapshot);
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
function deniedFromPrincipal(principal, reason) {
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
function authorizePlatformPermission(input) {
    if (!input.resolution.allowed)
        return input.resolution;
    const principal = input.resolution.principal;
    if (input.expectedRole && principal.activeRole !== input.expectedRole) {
        return deniedFromPrincipal(principal, "role_mismatch");
    }
    const decision = (0, authorization_domain_1.evaluatePlatformPermission)({
        role: principal.activeRole,
        permission: input.permission
    });
    return decision.allowed
        ? { allowed: true, principal }
        : deniedFromPrincipal(principal, "permission_denied");
}
function authorizePortalEntry(input) {
    return authorizePlatformPermission({
        resolution: input.resolution,
        expectedRole: input.expectedRole,
        permission: exports.PORTAL_ENTRY_PERMISSIONS[input.expectedRole]
    });
}
function authorizeCurrentTenantPermission(input) {
    if (!input.resolution.allowed)
        return input.resolution;
    const principal = input.resolution.principal;
    const membership = principal.tenantMembership;
    if (!membership) {
        return deniedFromPrincipal(principal, "tenant_context_missing");
    }
    const decision = (0, authorization_domain_1.evaluateTenantPermission)({
        context: principal,
        resourceTenantId: membership.tenantId,
        permission: input.permission
    });
    if (decision.allowed)
        return { allowed: true, principal };
    const mappedReason = decision.reason === "tenant_role_mismatch"
        ? "role_mismatch"
        : decision.reason === "tenant_permission_denied" ||
            decision.reason === "role_permission_denied"
            ? "permission_denied"
            : decision.reason;
    return deniedFromPrincipal(principal, mappedReason);
}
function asTenantAuthorizationPrincipal(principal) {
    if (!principal.tenantMembership) {
        throw new Error("Tenant authorization succeeded without tenant context.");
    }
    return principal;
}
