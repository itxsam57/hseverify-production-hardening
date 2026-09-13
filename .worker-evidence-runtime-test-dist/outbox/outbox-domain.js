"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaleOutboxLeaseError = exports.RequiredOutboxMissingError = exports.OutboxContractError = exports.OUTBOX_RETRY_DELAYS_SECONDS = exports.OUTBOX_LEASE_SECONDS = exports.OUTBOX_MAX_ATTEMPTS = exports.OUTBOX_SCHEMA_VERSION = exports.OUTBOX_ATTEMPT_OUTCOMES = exports.OUTBOX_JOB_STATUSES = exports.OUTBOX_JOB_TYPES = void 0;
exports.isOutboxJobType = isOutboxJobType;
exports.isOutboxJobStatus = isOutboxJobStatus;
exports.isOutboxAttemptOutcome = isOutboxAttemptOutcome;
exports.createOutboxJobId = createOutboxJobId;
exports.createOutboxAttemptId = createOutboxAttemptId;
exports.createOutboxLeaseId = createOutboxLeaseId;
exports.createTrustedOutboxWorker = createTrustedOutboxWorker;
exports.assertTrustedOutboxWorker = assertTrustedOutboxWorker;
exports.createTrustedOutboxLease = createTrustedOutboxLease;
exports.assertTrustedOutboxLease = assertTrustedOutboxLease;
exports.normalizeOutboxBusinessKey = normalizeOutboxBusinessKey;
exports.deriveOutboxIdempotencyKey = deriveOutboxIdempotencyKey;
exports.normalizeOutboxPayload = normalizeOutboxPayload;
exports.normalizeOutboxFailure = normalizeOutboxFailure;
exports.retryDelaySeconds = retryDelaySeconds;
exports.assertOutboxEnqueueActor = assertOutboxEnqueueActor;
exports.normalizeOutboxJobReference = normalizeOutboxJobReference;
exports.normalizeOutboxLimit = normalizeOutboxLimit;
exports.normalizeOutboxCursor = normalizeOutboxCursor;
const node_crypto_1 = require("node:crypto");
const auth_domain_1 = require("../auth/auth-domain");
const audit_domain_1 = require("../audit/audit-domain");
exports.OUTBOX_JOB_TYPES = [
    "platform.foundation.noop",
    "notification.portal.foundation",
    "email.delivery.foundation",
    "secure_file.scan",
    "worker_identity.automated_checks"
];
exports.OUTBOX_JOB_STATUSES = [
    "pending",
    "leased",
    "retry_wait",
    "succeeded",
    "terminal_failed"
];
exports.OUTBOX_ATTEMPT_OUTCOMES = [
    "running",
    "succeeded",
    "retry_scheduled",
    "terminal_failed",
    "lease_expired"
];
exports.OUTBOX_SCHEMA_VERSION = 1;
exports.OUTBOX_MAX_ATTEMPTS = 5;
exports.OUTBOX_LEASE_SECONDS = 60;
exports.OUTBOX_RETRY_DELAYS_SECONDS = [5, 30, 120, 600];
const TRUSTED_OUTBOX_WORKER = Symbol("trusted-outbox-worker");
const TRUSTED_OUTBOX_LEASE = Symbol("trusted-outbox-lease");
const TRUSTED_OUTBOX_WORKERS = new WeakSet();
const TRUSTED_OUTBOX_LEASES = new WeakSet();
const SAFE_REFERENCE = /^[A-Za-z0-9_./:@-]+$/;
const SAFE_KEY = /^[a-z0-9][a-z0-9._-]*$/;
const FORBIDDEN_PAYLOAD_KEY = /(password|passcode|otp|totp|token|secret|cookie|authorization|csrf|credential|document|attachment|body|content|passport|cnic|national.?id|email|phone|address|birth|name)/i;
class OutboxContractError extends Error {
    constructor(message = "The outbox contract is invalid.") {
        super(message);
        this.name = "OutboxContractError";
    }
}
exports.OutboxContractError = OutboxContractError;
class RequiredOutboxMissingError extends Error {
    constructor() {
        super("The accepted state change did not enqueue its required outbox work.");
        this.name = "RequiredOutboxMissingError";
    }
}
exports.RequiredOutboxMissingError = RequiredOutboxMissingError;
class StaleOutboxLeaseError extends Error {
    constructor() {
        super("The outbox lease is stale or no longer owned by this worker.");
        this.name = "StaleOutboxLeaseError";
    }
}
exports.StaleOutboxLeaseError = StaleOutboxLeaseError;
function isOutboxJobType(value) {
    return (typeof value === "string" &&
        exports.OUTBOX_JOB_TYPES.includes(value));
}
function isOutboxJobStatus(value) {
    return (typeof value === "string" &&
        exports.OUTBOX_JOB_STATUSES.includes(value));
}
function isOutboxAttemptOutcome(value) {
    return (typeof value === "string" &&
        exports.OUTBOX_ATTEMPT_OUTCOMES.includes(value));
}
function createOutboxJobId() {
    return (0, auth_domain_1.createIdentifier)("job");
}
function createOutboxAttemptId() {
    return (0, auth_domain_1.createIdentifier)("attempt");
}
function createOutboxLeaseId() {
    return (0, auth_domain_1.createIdentifier)("lease");
}
function createTrustedOutboxWorker() {
    const worker = Object.freeze({
        workerId: (0, auth_domain_1.createIdentifier)("outbox_worker"),
        component: "outbox-worker",
        [TRUSTED_OUTBOX_WORKER]: true
    });
    TRUSTED_OUTBOX_WORKERS.add(worker);
    return worker;
}
function assertTrustedOutboxWorker(worker) {
    if (!worker ||
        worker[TRUSTED_OUTBOX_WORKER] !== true ||
        !TRUSTED_OUTBOX_WORKERS.has(worker) ||
        worker.component !== "outbox-worker" ||
        !/^outbox_worker_[A-Za-z0-9_-]{24}$/.test(worker.workerId)) {
        throw new OutboxContractError("Trusted outbox worker is invalid.");
    }
    return worker;
}
function createTrustedOutboxLease(input) {
    if (!/^job_[A-Za-z0-9_-]{24}$/.test(input.jobId) ||
        !/^attempt_[A-Za-z0-9_-]{24}$/.test(input.attemptId) ||
        !/^lease_[A-Za-z0-9_-]{24}$/.test(input.leaseId) ||
        !/^outbox_worker_[A-Za-z0-9_-]{24}$/.test(input.workerId) ||
        !Number.isInteger(input.attemptNumber) ||
        input.attemptNumber < 1 ||
        input.attemptNumber > exports.OUTBOX_MAX_ATTEMPTS ||
        Number.isNaN(Date.parse(input.leaseExpiresAt))) {
        throw new OutboxContractError("Trusted outbox lease is invalid.");
    }
    const lease = Object.freeze({
        ...input,
        [TRUSTED_OUTBOX_LEASE]: true
    });
    TRUSTED_OUTBOX_LEASES.add(lease);
    return lease;
}
function assertTrustedOutboxLease(lease) {
    if (!lease ||
        lease[TRUSTED_OUTBOX_LEASE] !== true ||
        !TRUSTED_OUTBOX_LEASES.has(lease)) {
        throw new StaleOutboxLeaseError();
    }
    return lease;
}
function normalizeOutboxBusinessKey(value) {
    const normalized = value.trim();
    if (normalized.length < 1 ||
        normalized.length > 240 ||
        !SAFE_REFERENCE.test(normalized)) {
        throw new OutboxContractError("Outbox business key is invalid.");
    }
    return normalized;
}
function deriveOutboxIdempotencyKey(jobType, businessKey, trustedScopeReference) {
    if (!isOutboxJobType(jobType)) {
        throw new OutboxContractError("Unknown outbox job type.");
    }
    const normalized = normalizeOutboxBusinessKey(businessKey);
    const scope = normalizeOutboxBusinessKey(trustedScopeReference);
    return (0, node_crypto_1.createHash)("sha256")
        .update(`${jobType}:${exports.OUTBOX_SCHEMA_VERSION}:${scope}:${normalized}`, "utf8")
        .digest("hex");
}
function normalizeSingleReferencePayload(value, property, label) {
    if (!value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) {
        throw new OutboxContractError("Outbox payload must be a plain object.");
    }
    const keys = Object.keys(value).sort();
    if (keys.length !== 1 ||
        keys[0] !== property ||
        keys.some((key) => FORBIDDEN_PAYLOAD_KEY.test(key))) {
        throw new OutboxContractError("Outbox payload schema is invalid.");
    }
    const reference = value[property];
    if (typeof reference !== "string" ||
        reference.length < 1 ||
        reference.length > 200 ||
        !SAFE_REFERENCE.test(reference)) {
        throw new OutboxContractError(`Outbox ${label} reference is invalid.`);
    }
    return Object.freeze({ [property]: reference });
}
function normalizeFoundationNoopPayload(value) {
    const normalized = normalizeSingleReferencePayload(value, "probeRef", "probe");
    return Object.freeze({ probeRef: normalized.probeRef });
}
function normalizePortalNotificationPayload(value) {
    const normalized = normalizeSingleReferencePayload(value, "fixtureRef", "fixture");
    return Object.freeze({ fixtureRef: normalized.fixtureRef });
}
function normalizeFoundationEmailPayload(value) {
    const normalized = normalizeSingleReferencePayload(value, "fixtureRef", "fixture");
    return Object.freeze({ fixtureRef: normalized.fixtureRef });
}
function normalizeSecureFileScanPayload(value) {
    if (!value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) {
        throw new OutboxContractError("Secure file scan payload must be a plain object.");
    }
    const keys = Object.keys(value).sort();
    if (keys.length !== 2 ||
        keys[0] !== "fileRef" ||
        keys[1] !== "generation" ||
        keys.some((key) => FORBIDDEN_PAYLOAD_KEY.test(key))) {
        throw new OutboxContractError("Secure file scan payload schema is invalid.");
    }
    const fileRef = value.fileRef;
    const generation = value.generation;
    if (typeof fileRef !== "string" ||
        !/^secure_file_[A-Za-z0-9_-]{24}$/.test(fileRef) ||
        typeof generation !== "number" ||
        !Number.isSafeInteger(generation) ||
        generation < 1 ||
        generation > 1_000_000) {
        throw new OutboxContractError("Secure file scan payload is invalid.");
    }
    return Object.freeze({ fileRef, generation });
}
function normalizeWorkerIdentityAutomatedChecksPayload(value) {
    if (!value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) {
        throw new OutboxContractError("Worker identity automated-check payload must be a plain object.");
    }
    const keys = Object.keys(value).sort();
    if (keys.length !== 2 ||
        keys[0] !== "identityRef" ||
        keys[1] !== "versionRef" ||
        keys.some((key) => FORBIDDEN_PAYLOAD_KEY.test(key))) {
        throw new OutboxContractError("Worker identity automated-check payload schema is invalid.");
    }
    const identityRef = value.identityRef;
    const versionRef = value.versionRef;
    if (typeof identityRef !== "string" ||
        !/^worker_identity_[A-Za-z0-9_-]{24}$/.test(identityRef) ||
        typeof versionRef !== "string" ||
        !/^identity_version_[A-Za-z0-9_-]{24}$/.test(versionRef)) {
        throw new OutboxContractError("Worker identity automated-check payload is invalid.");
    }
    return Object.freeze({ identityRef, versionRef });
}
function normalizeOutboxPayload(jobType, value) {
    if (!isOutboxJobType(jobType)) {
        throw new OutboxContractError("Unknown outbox job type.");
    }
    let normalized;
    switch (jobType) {
        case "platform.foundation.noop":
            normalized = normalizeFoundationNoopPayload(value);
            break;
        case "notification.portal.foundation":
            normalized = normalizePortalNotificationPayload(value);
            break;
        case "email.delivery.foundation":
            normalized = normalizeFoundationEmailPayload(value);
            break;
        case "secure_file.scan":
            normalized = normalizeSecureFileScanPayload(value);
            break;
        case "worker_identity.automated_checks":
            normalized = normalizeWorkerIdentityAutomatedChecksPayload(value);
            break;
        default:
            throw new OutboxContractError("No fixed payload schema is registered.");
    }
    const serialized = JSON.stringify(normalized);
    if (Buffer.byteLength(serialized, "utf8") > 8_192) {
        throw new OutboxContractError("Outbox payload exceeds the 8 KB limit.");
    }
    return normalized;
}
function normalizeOutboxFailure(value) {
    const code = value.code.trim().toLowerCase();
    const summary = value.summary.trim();
    if (code.length < 2 ||
        code.length > 120 ||
        !SAFE_KEY.test(code) ||
        summary.length < 1 ||
        summary.length > 240 ||
        /(password|passcode|otp|totp|token|secret|cookie|authorization|credential)/i
            .test(summary)) {
        throw new OutboxContractError("Outbox failure is not safe to persist.");
    }
    return Object.freeze({ code, summary });
}
function retryDelaySeconds(attemptNumber) {
    if (!Number.isInteger(attemptNumber) ||
        attemptNumber < 1 ||
        attemptNumber >= exports.OUTBOX_MAX_ATTEMPTS) {
        throw new OutboxContractError("Outbox retry attempt is invalid.");
    }
    return exports.OUTBOX_RETRY_DELAYS_SECONDS[attemptNumber - 1];
}
function assertOutboxEnqueueActor(actor) {
    const trusted = (0, audit_domain_1.assertTrustedAuditActor)(actor);
    if (trusted.kind !== "user") {
        throw new OutboxContractError("Outbox enqueue requires a trusted user actor.");
    }
    return trusted;
}
function normalizeOutboxJobReference(value) {
    const normalized = value.trim();
    return /^job_[A-Za-z0-9_-]{24}$/.test(normalized)
        ? normalized
        : null;
}
function normalizeOutboxLimit(value) {
    if (value === undefined)
        return 50;
    if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new OutboxContractError("Outbox query limit must be between 1 and 100.");
    }
    return value;
}
function normalizeOutboxCursor(value) {
    if (value === undefined || value === null)
        return null;
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new OutboxContractError("Outbox cursor is invalid.");
    }
    return value;
}
