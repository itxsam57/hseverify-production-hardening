"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkerEvidenceAttachmentUnavailableError = exports.WorkerEvidenceContractError = exports.WorkerEvidenceConflictError = exports.WorkerEvidenceNotFoundError = exports.WORKER_SKILL_ASSURANCE_STATUSES = exports.WORKER_EVIDENCE_RECORD_KINDS = void 0;
exports.assertWorkerEvidencePrincipal = assertWorkerEvidencePrincipal;
exports.createWorkerEvidenceId = createWorkerEvidenceId;
exports.normalizeOptionalText = normalizeOptionalText;
exports.normalizeOptionalMultiline = normalizeOptionalMultiline;
exports.normalizeOptionalDate = normalizeOptionalDate;
exports.assertDateRange = assertDateRange;
exports.normalizeVerificationUrl = normalizeVerificationUrl;
const node_crypto_1 = require("node:crypto");
exports.WORKER_EVIDENCE_RECORD_KINDS = [
    "qualification",
    "experience",
    "employment",
    "skill"
];
exports.WORKER_SKILL_ASSURANCE_STATUSES = [
    "self_declared",
    "evidence_verified",
    "competency_assessed"
];
class WorkerEvidenceNotFoundError extends Error {
    constructor() {
        super("Worker evidence record is unavailable.");
        this.name = "WorkerEvidenceNotFoundError";
    }
}
exports.WorkerEvidenceNotFoundError = WorkerEvidenceNotFoundError;
class WorkerEvidenceConflictError extends Error {
    constructor(message = "Worker evidence changed in another session. Refresh and try again.") {
        super(message);
        this.name = "WorkerEvidenceConflictError";
    }
}
exports.WorkerEvidenceConflictError = WorkerEvidenceConflictError;
class WorkerEvidenceContractError extends Error {
    constructor(message) {
        super(message);
        this.name = "WorkerEvidenceContractError";
    }
}
exports.WorkerEvidenceContractError = WorkerEvidenceContractError;
class WorkerEvidenceAttachmentUnavailableError extends Error {
    constructor(message = "Worker evidence file is not available for attachment.") {
        super(message);
        this.name = "WorkerEvidenceAttachmentUnavailableError";
    }
}
exports.WorkerEvidenceAttachmentUnavailableError = WorkerEvidenceAttachmentUnavailableError;
function assertWorkerEvidencePrincipal(principal) {
    if (principal.activeRole !== "worker" || principal.accountStatus !== "active") {
        throw new WorkerEvidenceNotFoundError();
    }
    return principal;
}
function createWorkerEvidenceId(prefix) {
    return `${prefix}_${(0, node_crypto_1.randomUUID)().replaceAll("-", "")}`;
}
function normalizeOptionalText(value, maxLength = 500) {
    const normalized = value?.trim().replace(/\s+/g, " ") || null;
    if (normalized && normalized.length > maxLength) {
        throw new WorkerEvidenceContractError("Worker evidence text is too long.");
    }
    return normalized;
}
function normalizeOptionalMultiline(value, maxLength = 4000) {
    const normalized = value?.trim() || null;
    if (normalized && normalized.length > maxLength) {
        throw new WorkerEvidenceContractError("Worker evidence details are too long.");
    }
    return normalized;
}
function normalizeOptionalDate(value) {
    const normalized = value?.trim() || null;
    if (!normalized)
        return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        throw new WorkerEvidenceContractError("Use a valid calendar date.");
    }
    const parsed = new Date(`${normalized}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
        throw new WorkerEvidenceContractError("Use a valid calendar date.");
    }
    return normalized;
}
function assertDateRange(startDate, endDate) {
    if (startDate && endDate && endDate < startDate) {
        throw new WorkerEvidenceContractError("End date cannot be before start date.");
    }
}
function normalizeVerificationUrl(value) {
    const normalized = value?.trim() || null;
    if (!normalized)
        return null;
    try {
        const parsed = new URL(normalized);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
            throw new Error();
        return parsed.toString();
    }
    catch {
        throw new WorkerEvidenceContractError("Verification URL must use HTTP or HTTPS.");
    }
}
