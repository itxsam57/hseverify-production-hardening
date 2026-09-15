"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TENANT_MEMBERSHIP_STATUSES = exports.TENANT_MEMBERSHIP_ROLES = exports.TENANT_STATUSES = exports.TENANT_PERMISSIONS = exports.PLATFORM_PERMISSIONS = void 0;
exports.createTenantId = createTenantId;
exports.createTenantMembershipId = createTenantMembershipId;
exports.isPlatformPermission = isPlatformPermission;
exports.isTenantPermission = isTenantPermission;
exports.isTenantStatus = isTenantStatus;
exports.isTenantMembershipRole = isTenantMembershipRole;
exports.isTenantMembershipStatus = isTenantMembershipStatus;
exports.platformPermissionsForRole = platformPermissionsForRole;
exports.tenantPermissionsForRole = tenantPermissionsForRole;
exports.roleHasPlatformPermission = roleHasPlatformPermission;
exports.tenantRoleHasPermission = tenantRoleHasPermission;
exports.resolveTenantPermissions = resolveTenantPermissions;
exports.evaluatePlatformPermission = evaluatePlatformPermission;
exports.evaluateTenantPermission = evaluateTenantPermission;
exports.canGrantTenantRole = canGrantTenantRole;
exports.canAssignTenantRole = canAssignTenantRole;
exports.canSetTenantPermissionOverride = canSetTenantPermissionOverride;
const auth_domain_1 = require("../auth/auth-domain");
exports.PLATFORM_PERMISSIONS = [
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
];
exports.TENANT_PERMISSIONS = [
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
];
exports.TENANT_STATUSES = [
    "pending",
    "active",
    "suspended",
    "archived"
];
exports.TENANT_MEMBERSHIP_ROLES = [
    "owner",
    "admin",
    "manager",
    "viewer"
];
exports.TENANT_MEMBERSHIP_STATUSES = [
    "invited",
    "active",
    "suspended",
    "revoked"
];
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
};
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
    owner: exports.TENANT_PERMISSIONS
};
function createTenantId() {
    return (0, auth_domain_1.createIdentifier)("tenant");
}
function createTenantMembershipId() {
    return (0, auth_domain_1.createIdentifier)("membership");
}
function isPlatformPermission(value) {
    return (typeof value === "string" &&
        exports.PLATFORM_PERMISSIONS.includes(value));
}
function isTenantPermission(value) {
    return (typeof value === "string" &&
        exports.TENANT_PERMISSIONS.includes(value));
}
function isTenantStatus(value) {
    return (typeof value === "string" &&
        exports.TENANT_STATUSES.includes(value));
}
function isTenantMembershipRole(value) {
    return (typeof value === "string" &&
        exports.TENANT_MEMBERSHIP_ROLES.includes(value));
}
function isTenantMembershipStatus(value) {
    return (typeof value === "string" &&
        exports.TENANT_MEMBERSHIP_STATUSES.includes(value));
}
function platformPermissionsForRole(role) {
    return ROLE_PLATFORM_PERMISSION_GRANTS[role];
}
function tenantPermissionsForRole(role) {
    return TENANT_ROLE_PERMISSION_GRANTS[role];
}
function roleHasPlatformPermission(role, permission) {
    return platformPermissionsForRole(role).includes(permission);
}
function tenantRoleHasPermission(role, permission) {
    return tenantPermissionsForRole(role).includes(permission);
}
function resolveTenantPermissions(role, overrides = []) {
    const resolved = new Set(tenantPermissionsForRole(role));
    const seen = new Set();
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
        }
        else if (override.effect === "deny") {
            resolved.delete(override.permission);
        }
        else {
            throw new Error("Unknown tenant permission override effect.");
        }
    }
    return resolved;
}
function evaluatePlatformPermission(input) {
    return roleHasPlatformPermission(input.role, input.permission)
        ? { allowed: true }
        : { allowed: false, reason: "role_permission_denied" };
}
function evaluateTenantPermission(input) {
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
    const permissions = resolveTenantPermissions(membership.role, membership.overrides);
    return permissions.has(input.permission)
        ? { allowed: true }
        : { allowed: false, reason: "tenant_permission_denied" };
}
function canGrantTenantRole(actorRole, targetRole) {
    if (actorRole === "owner")
        return true;
    if (actorRole === "admin") {
        return targetRole === "manager" || targetRole === "viewer";
    }
    return false;
}
function canAssignTenantRole(input) {
    if (input.actorMembershipId === input.targetMembershipId)
        return false;
    return canGrantTenantRole(input.actorRole, input.targetRole);
}
function canSetTenantPermissionOverride(input) {
    if (!canAssignTenantRole({
        actorMembershipId: input.actorMembershipId,
        actorRole: input.actorRole,
        targetMembershipId: input.targetMembershipId,
        targetRole: input.targetRole
    })) {
        return false;
    }
    if (!tenantRoleHasPermission(input.targetRole, input.permission))
        return false;
    if (input.permission === "company.members.grant_owner" &&
        input.actorRole !== "owner") {
        return false;
    }
    return input.effect === "grant" || input.effect === "deny";
}
