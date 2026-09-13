"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecureFileReservationConflictError = exports.SecureFileAccessDeniedError = exports.SecureFileContractError = exports.PUBLIC_CONCERN_SECURE_FILE_OWNER_ROLE = exports.PUBLIC_CONCERN_SECURE_FILE_OWNER_ACCOUNT_ID = exports.SECURE_FILE_AUTHORITY_MODES = exports.SECURE_FILE_LIFECYCLE_STATUSES = exports.SECURE_FILE_STORAGE_ADAPTER_KEYS = exports.SECURE_FILE_SCHEMA_VERSION = void 0;
exports.isSecureFileLifecycleStatus = isSecureFileLifecycleStatus;
exports.isSecureFileStorageAdapterKey = isSecureFileStorageAdapterKey;
exports.bindTrustedSecureFileOwner = bindTrustedSecureFileOwner;
exports.bindTrustedCompanyApplicationSecureFileOwner = bindTrustedCompanyApplicationSecureFileOwner;
exports.bindTrustedPublicConcernSecureFileOwner = bindTrustedPublicConcernSecureFileOwner;
exports.assertTrustedSecureFileOwner = assertTrustedSecureFileOwner;
exports.getTrustedSecureFileAuthorityMode = getTrustedSecureFileAuthorityMode;
exports.normalizeSecureFileDisplayFilename = normalizeSecureFileDisplayFilename;
exports.normalizeSecureFileBusinessReference = normalizeSecureFileBusinessReference;
exports.createSecureFileReservationIntent = createSecureFileReservationIntent;
exports.assertTrustedSecureFileReservationIntent = assertTrustedSecureFileReservationIntent;
exports.createSecureFileId = createSecureFileId;
exports.deriveSecureFileObjectKey = deriveSecureFileObjectKey;
exports.normalizeSecureFileReference = normalizeSecureFileReference;
exports.normalizeSecureFileCursor = normalizeSecureFileCursor;
exports.normalizeSecureFileLimit = normalizeSecureFileLimit;
const node_crypto_1 = require("node:crypto");
const auth_domain_1 = require("../auth/auth-domain");
exports.SECURE_FILE_SCHEMA_VERSION = 1;
exports.SECURE_FILE_STORAGE_ADAPTER_KEYS = ["local_test"];
exports.SECURE_FILE_LIFECYCLE_STATUSES = [
    "reserved",
    "quarantined",
    "scan_pending",
    "available",
    "unsafe",
    "scan_failed"
];
exports.SECURE_FILE_AUTHORITY_MODES = [
    "active_tenant",
    "company_application",
    "public_concern"
];
exports.PUBLIC_CONCERN_SECURE_FILE_OWNER_ACCOUNT_ID = "account_public_concern_intake_system";
exports.PUBLIC_CONCERN_SECURE_FILE_OWNER_ROLE = "root";
const TRUSTED_SECURE_FILE_OWNER = Symbol("trusted-secure-file-owner");
const TRUSTED_SECURE_FILE_OWNERS = new WeakSet();
const TRUSTED_SECURE_FILE_AUTHORITY_MODES = new WeakMap();
const TRUSTED_RESERVATION_INTENT = Symbol("trusted-secure-file-reservation-intent");
const TRUSTED_RESERVATION_INTENTS = new WeakSet();
class SecureFileContractError extends Error {
    constructor(message = "The secure file contract is invalid.") {
        super(message);
        this.name = "SecureFileContractError";
    }
}
exports.SecureFileContractError = SecureFileContractError;
class SecureFileAccessDeniedError extends Error {
    constructor() {
        super("The secure file could not be accessed.");
        this.name = "SecureFileAccessDeniedError";
    }
}
exports.SecureFileAccessDeniedError = SecureFileAccessDeniedError;
class SecureFileReservationConflictError extends Error {
    constructor() {
        super("The secure file reservation could not be completed.");
        this.name = "SecureFileReservationConflictError";
    }
}
exports.SecureFileReservationConflictError = SecureFileReservationConflictError;
function nonEmpty(value) {
    return value.trim().length > 0;
}
function isAuthRole(value) {
    return typeof value === "string" && auth_domain_1.AUTH_ROLES.includes(value);
}
function validConcernReference(value) {
    return /^public_concern_[A-Za-z0-9_-]{24}$/.test(value);
}
function registerTrustedSecureFileOwner(ownerInput) {
    const owner = {
        accountId: ownerInput.accountId,
        sessionId: ownerInput.sessionId,
        role: ownerInput.role,
        tenantId: ownerInput.tenantId,
        membershipId: ownerInput.membershipId,
        concernReference: ownerInput.concernReference,
        [TRUSTED_SECURE_FILE_OWNER]: true
    };
    Object.defineProperty(owner, "authorityMode", {
        value: ownerInput.authorityMode,
        enumerable: false,
        configurable: false,
        writable: false
    });
    Object.freeze(owner);
    TRUSTED_SECURE_FILE_OWNERS.add(owner);
    TRUSTED_SECURE_FILE_AUTHORITY_MODES.set(owner, ownerInput.authorityMode);
    return owner;
}
function createTrustedSecureFileOwner(input) {
    const membership = input.principal.tenantMembership;
    return registerTrustedSecureFileOwner({
        accountId: input.principal.accountId,
        sessionId: input.principal.sessionId,
        role: input.principal.activeRole,
        tenantId: membership?.tenantId ?? null,
        membershipId: membership?.membershipId ?? null,
        authorityMode: input.authorityMode,
        concernReference: null
    });
}
function isSecureFileLifecycleStatus(value) {
    return (typeof value === "string" &&
        exports.SECURE_FILE_LIFECYCLE_STATUSES.includes(value));
}
function isSecureFileStorageAdapterKey(value) {
    return (typeof value === "string" &&
        exports.SECURE_FILE_STORAGE_ADAPTER_KEYS.includes(value));
}
function bindTrustedSecureFileOwner(principal) {
    if (principal.accountStatus !== "active" ||
        !nonEmpty(principal.accountId) ||
        !nonEmpty(principal.sessionId) ||
        !isAuthRole(principal.activeRole)) {
        throw new SecureFileAccessDeniedError();
    }
    const membership = principal.tenantMembership;
    if (principal.activeRole === "company") {
        if (!membership ||
            membership.tenantStatus !== "active" ||
            membership.status !== "active" ||
            !nonEmpty(membership.tenantId) ||
            !nonEmpty(membership.membershipId)) {
            throw new SecureFileAccessDeniedError();
        }
    }
    else if (membership !== null) {
        throw new SecureFileAccessDeniedError();
    }
    return createTrustedSecureFileOwner({
        principal,
        authorityMode: "active_tenant"
    });
}
function bindTrustedCompanyApplicationSecureFileOwner(principal) {
    const membership = principal.tenantMembership;
    if (principal.accountStatus !== "active" ||
        principal.activeRole !== "company" ||
        !nonEmpty(principal.accountId) ||
        !nonEmpty(principal.sessionId) ||
        !membership ||
        membership.status !== "active" ||
        (membership.tenantStatus !== "pending" && membership.tenantStatus !== "active") ||
        (membership.role !== "owner" && membership.role !== "admin") ||
        !nonEmpty(membership.tenantId) ||
        !nonEmpty(membership.membershipId)) {
        throw new SecureFileAccessDeniedError();
    }
    return createTrustedSecureFileOwner({
        principal,
        authorityMode: "company_application"
    });
}
function bindTrustedPublicConcernSecureFileOwner(concernReference) {
    const normalized = typeof concernReference === "string"
        ? concernReference.trim()
        : "";
    if (!validConcernReference(normalized)) {
        throw new SecureFileAccessDeniedError();
    }
    return registerTrustedSecureFileOwner({
        accountId: exports.PUBLIC_CONCERN_SECURE_FILE_OWNER_ACCOUNT_ID,
        sessionId: normalized,
        role: exports.PUBLIC_CONCERN_SECURE_FILE_OWNER_ROLE,
        tenantId: null,
        membershipId: null,
        authorityMode: "public_concern",
        concernReference: normalized
    });
}
function assertTrustedSecureFileOwner(owner) {
    const authorityMode = owner && typeof owner === "object"
        ? TRUSTED_SECURE_FILE_AUTHORITY_MODES.get(owner)
        : undefined;
    if (!owner ||
        owner[TRUSTED_SECURE_FILE_OWNER] !== true ||
        !TRUSTED_SECURE_FILE_OWNERS.has(owner) ||
        !authorityMode ||
        owner.authorityMode !== authorityMode ||
        !exports.SECURE_FILE_AUTHORITY_MODES.includes(authorityMode) ||
        !nonEmpty(owner.accountId) ||
        !nonEmpty(owner.sessionId) ||
        !isAuthRole(owner.role) ||
        ((owner.tenantId === null) !== (owner.membershipId === null))) {
        throw new SecureFileAccessDeniedError();
    }
    if (authorityMode === "public_concern") {
        if (owner.accountId !== exports.PUBLIC_CONCERN_SECURE_FILE_OWNER_ACCOUNT_ID ||
            owner.role !== exports.PUBLIC_CONCERN_SECURE_FILE_OWNER_ROLE ||
            owner.tenantId !== null ||
            owner.membershipId !== null ||
            owner.concernReference === null ||
            owner.sessionId !== owner.concernReference ||
            !validConcernReference(owner.concernReference)) {
            throw new SecureFileAccessDeniedError();
        }
        return owner;
    }
    if (owner.concernReference !== null ||
        (owner.role === "company" && owner.tenantId === null) ||
        (owner.role !== "company" && owner.tenantId !== null) ||
        (owner.role !== "company" && authorityMode !== "active_tenant")) {
        throw new SecureFileAccessDeniedError();
    }
    return owner;
}
function getTrustedSecureFileAuthorityMode(ownerInput) {
    const owner = assertTrustedSecureFileOwner(ownerInput);
    const authorityMode = TRUSTED_SECURE_FILE_AUTHORITY_MODES.get(owner);
    if (!authorityMode)
        throw new SecureFileAccessDeniedError();
    return authorityMode;
}
function normalizeSecureFileDisplayFilename(value) {
    if (typeof value !== "string") {
        throw new SecureFileContractError("File display name is invalid.");
    }
    const normalized = value.normalize("NFKC").trim();
    if (normalized.length < 1 ||
        normalized.length > 180 ||
        normalized === "." ||
        normalized === ".." ||
        /[\\/]/.test(normalized) ||
        /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw new SecureFileContractError("File display name is invalid.");
    }
    return normalized;
}
function normalizeSecureFileBusinessReference(value) {
    if (typeof value !== "string") {
        throw new SecureFileContractError("File reservation reference is invalid.");
    }
    const normalized = value.trim();
    if (normalized.length < 1 ||
        normalized.length > 160 ||
        !/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(normalized)) {
        throw new SecureFileContractError("File reservation reference is invalid.");
    }
    return normalized;
}
function sha256(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value, "utf8").digest("hex");
}
function createSecureFileReservationIntent(input) {
    const owner = assertTrustedSecureFileOwner(input.owner);
    const businessReference = normalizeSecureFileBusinessReference(input.businessReference);
    const displayFilename = normalizeSecureFileDisplayFilename(input.displayFilename);
    const reservationKey = owner.authorityMode === "public_concern"
        ? sha256([
            "hse-secure-file-public-concern-reservation-v1",
            owner.accountId,
            owner.role,
            owner.concernReference ?? "-",
            businessReference
        ].join("\u0000"))
        : sha256([
            "hse-secure-file-reservation-v1",
            owner.accountId,
            owner.role,
            owner.tenantId ?? "-",
            owner.membershipId ?? "-",
            businessReference
        ].join("\u0000"));
    const intent = Object.freeze({
        businessReference,
        displayFilename,
        reservationKey,
        [TRUSTED_RESERVATION_INTENT]: true
    });
    TRUSTED_RESERVATION_INTENTS.add(intent);
    return intent;
}
function assertTrustedSecureFileReservationIntent(intent) {
    if (!intent ||
        intent[TRUSTED_RESERVATION_INTENT] !== true ||
        !TRUSTED_RESERVATION_INTENTS.has(intent) ||
        normalizeSecureFileBusinessReference(intent.businessReference) !==
            intent.businessReference ||
        normalizeSecureFileDisplayFilename(intent.displayFilename) !==
            intent.displayFilename ||
        !/^[a-f0-9]{64}$/.test(intent.reservationKey)) {
        throw new SecureFileContractError("File reservation intent is invalid.");
    }
    return intent;
}
function createSecureFileId() {
    return (0, auth_domain_1.createIdentifier)("secure_file");
}
function deriveSecureFileObjectKey(fileId) {
    const normalized = normalizeSecureFileReference(fileId);
    if (!normalized) {
        throw new SecureFileContractError("Secure file reference is invalid.");
    }
    return `secure-files/${sha256(`hse-secure-file-object-v1\u0000${normalized}`)}`;
}
function normalizeSecureFileReference(value) {
    if (typeof value !== "string")
        return null;
    const normalized = value.trim();
    return /^secure_file_[A-Za-z0-9_-]{24}$/.test(normalized)
        ? normalized
        : null;
}
function normalizeSecureFileCursor(value) {
    if (value === undefined || value === null)
        return null;
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new SecureFileContractError("Secure file cursor is invalid.");
    }
    return value;
}
function normalizeSecureFileLimit(value) {
    if (value === undefined)
        return 50;
    if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new SecureFileContractError("Secure file query limit must be between 1 and 100.");
    }
    return value;
}
