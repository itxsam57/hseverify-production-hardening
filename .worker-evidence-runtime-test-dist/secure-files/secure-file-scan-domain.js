"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecureFileScanConflictError = exports.SecureFileScanAccessDeniedError = exports.SecureFileScanContractError = exports.SECURE_FILE_SCAN_FINAL_STATUSES = exports.SECURE_FILE_SCAN_SCHEMA_VERSION = exports.SECURE_FILE_SCAN_JOB_TYPE = void 0;
exports.normalizeMalwareScanResult = normalizeMalwareScanResult;
exports.normalizeSecureFileScanGeneration = normalizeSecureFileScanGeneration;
exports.normalizeSecureFileScanContext = normalizeSecureFileScanContext;
exports.deriveSecureFileScanBusinessKey = deriveSecureFileScanBusinessKey;
exports.computeSecureFileContentSha256 = computeSecureFileContentSha256;
exports.secureFileHasScannableProvenance = secureFileHasScannableProvenance;
const node_crypto_1 = require("node:crypto");
const secure_file_domain_1 = require("./secure-file-domain");
exports.SECURE_FILE_SCAN_JOB_TYPE = "secure_file.scan";
exports.SECURE_FILE_SCAN_SCHEMA_VERSION = 1;
exports.SECURE_FILE_SCAN_FINAL_STATUSES = ["available", "unsafe", "scan_failed"];
class SecureFileScanContractError extends Error {
    constructor(message = "The secure file scan contract is invalid.") {
        super(message);
        this.name = "SecureFileScanContractError";
    }
}
exports.SecureFileScanContractError = SecureFileScanContractError;
class SecureFileScanAccessDeniedError extends Error {
    constructor() {
        super("The secure file scan could not be accessed.");
        this.name = "SecureFileScanAccessDeniedError";
    }
}
exports.SecureFileScanAccessDeniedError = SecureFileScanAccessDeniedError;
class SecureFileScanConflictError extends Error {
    constructor() {
        super("The secure file scan state is no longer compatible with this operation.");
        this.name = "SecureFileScanConflictError";
    }
}
exports.SecureFileScanConflictError = SecureFileScanConflictError;
function normalizeSafeCode(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized.length < 2 ||
        normalized.length > 120 ||
        !/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
        throw new SecureFileScanContractError("Scanner result code is invalid.");
    }
    return normalized;
}
function normalizeNonCleanCode(value) {
    const normalized = normalizeSafeCode(value);
    if (normalized === "clean") {
        throw new SecureFileScanContractError("Only a clean scanner outcome may use the clean result code.");
    }
    return normalized;
}
function normalizeSafeSummary(value) {
    const normalized = value.trim();
    if (normalized.length < 1 ||
        normalized.length > 240 ||
        /(password|passcode|otp|totp|token|secret|cookie|authorization|credential)/i.test(normalized)) {
        throw new SecureFileScanContractError("Scanner result summary is invalid.");
    }
    return normalized;
}
function normalizeMalwareScanResult(value) {
    if (!value || typeof value !== "object") {
        throw new SecureFileScanContractError("Scanner result is invalid.");
    }
    switch (value.kind) {
        case "clean":
            if (value.code !== "clean") {
                throw new SecureFileScanContractError("Clean scanner result is invalid.");
            }
            return Object.freeze({ kind: "clean", code: "clean" });
        case "malicious":
            return Object.freeze({
                kind: "malicious",
                code: normalizeNonCleanCode(value.code)
            });
        case "retryable":
            return Object.freeze({
                kind: "retryable",
                code: normalizeNonCleanCode(value.code),
                summary: normalizeSafeSummary(value.summary)
            });
        case "terminal":
            return Object.freeze({
                kind: "terminal",
                code: normalizeNonCleanCode(value.code),
                summary: normalizeSafeSummary(value.summary)
            });
    }
}
function normalizeSecureFileScanGeneration(value) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
        throw new SecureFileScanContractError("Secure file scan generation is invalid.");
    }
    return value;
}
function normalizeSecureFileScanContext(value) {
    const fileRef = (0, secure_file_domain_1.normalizeSecureFileReference)(value.fileRef);
    if (!fileRef ||
        !Number.isSafeInteger(value.attemptNumber) ||
        value.attemptNumber < 1 ||
        value.attemptNumber > 5) {
        throw new SecureFileScanContractError("Secure file scan context is invalid.");
    }
    return Object.freeze({
        fileRef,
        generation: normalizeSecureFileScanGeneration(value.generation),
        attemptNumber: value.attemptNumber
    });
}
function deriveSecureFileScanBusinessKey(input) {
    const fileRef = (0, secure_file_domain_1.normalizeSecureFileReference)(input.fileRef);
    if (!fileRef ||
        !/^[a-f0-9]{64}$/.test(input.contentSha256)) {
        throw new SecureFileScanContractError("Secure file scan identity is invalid.");
    }
    const generation = normalizeSecureFileScanGeneration(input.generation);
    return `scan:${fileRef}:${input.contentSha256}:${generation}`;
}
function computeSecureFileContentSha256(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
        throw new SecureFileScanContractError("Secure file scan content is empty.");
    }
    return (0, node_crypto_1.createHash)("sha256").update(bytes).digest("hex");
}
function secureFileHasScannableProvenance(file) {
    return (file.fileExtension !== null &&
        file.declaredMime !== null &&
        file.detectedMime !== null &&
        file.byteSize !== null &&
        Number.isSafeInteger(file.byteSize) &&
        file.byteSize > 0 &&
        file.contentSha256 !== null &&
        /^[a-f0-9]{64}$/.test(file.contentSha256) &&
        file.quarantinedAt !== null);
}
