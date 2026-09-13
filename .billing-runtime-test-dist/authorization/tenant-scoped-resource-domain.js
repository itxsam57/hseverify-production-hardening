"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantScopeConflictError = exports.TenantScopeDeniedError = exports.TenantScopeContractError = exports.TENANT_SCOPE_FIXTURE_WRITE_PERMISSION = exports.TENANT_SCOPE_FIXTURE_READ_PERMISSION = void 0;
exports.bindTenantPermissionPrincipal = bindTenantPermissionPrincipal;
exports.deriveTrustedTenantScope = deriveTrustedTenantScope;
exports.createTenantScopeFixtureId = createTenantScopeFixtureId;
exports.normalizeTenantScopeFixtureKey = normalizeTenantScopeFixtureKey;
exports.normalizeTenantScopeFixturePayload = normalizeTenantScopeFixturePayload;
const auth_domain_1 = require("../auth/auth-domain");
exports.TENANT_SCOPE_FIXTURE_READ_PERMISSION = "company.tenant.read";
exports.TENANT_SCOPE_FIXTURE_WRITE_PERMISSION = "company.settings.manage";
class TenantScopeContractError extends Error {
    constructor(message = "Trusted tenant authorization context is invalid.") {
        super(message);
        this.name = "TenantScopeContractError";
    }
}
exports.TenantScopeContractError = TenantScopeContractError;
class TenantScopeDeniedError extends Error {
    constructor() {
        super("The tenant-scoped operation could not be completed.");
        this.name = "TenantScopeDeniedError";
    }
}
exports.TenantScopeDeniedError = TenantScopeDeniedError;
class TenantScopeConflictError extends Error {
    constructor() {
        super("The tenant-scoped operation could not be completed.");
        this.name = "TenantScopeConflictError";
    }
}
exports.TenantScopeConflictError = TenantScopeConflictError;
function bindTenantPermissionPrincipal(principal, permission) {
    return Object.freeze({
        ...principal,
        authorizedTenantPermission: permission
    });
}
function deriveTrustedTenantScope(principal) {
    const membership = principal.tenantMembership;
    if (principal.activeRole !== "company" ||
        principal.accountStatus !== "active" ||
        membership.tenantStatus !== "active" ||
        membership.status !== "active" ||
        membership.tenantId.length === 0 ||
        membership.membershipId.length === 0 ||
        principal.accountId.length === 0 ||
        principal.sessionId.length === 0) {
        throw new TenantScopeContractError();
    }
    return Object.freeze({
        tenantId: membership.tenantId,
        membershipId: membership.membershipId,
        accountId: principal.accountId,
        sessionId: principal.sessionId
    });
}
function createTenantScopeFixtureId() {
    return (0, auth_domain_1.createIdentifier)("tenantfixture");
}
function normalizeTenantScopeFixtureKey(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized.length < 3 ||
        normalized.length > 64 ||
        !/^[a-z0-9][a-z0-9_-]*[a-z0-9]$/.test(normalized)) {
        throw new Error("Fixture key must contain 3 to 64 lowercase letters, numbers, underscores or hyphens.");
    }
    return normalized;
}
function normalizeTenantScopeFixturePayload(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Fixture payload must be a JSON object.");
    }
    const serialized = JSON.stringify(value);
    if (serialized.length > 16_384) {
        throw new Error("Fixture payload exceeds the 16 KB test-resource limit.");
    }
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Fixture payload must be a JSON object.");
    }
    return Object.freeze(parsed);
}
