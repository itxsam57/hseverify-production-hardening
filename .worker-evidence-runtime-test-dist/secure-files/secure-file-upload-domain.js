"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecureFileUploadValidationError = exports.SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES = exports.SECURE_FILE_UPLOAD_PLATFORM_MAX_BYTES = exports.SECURE_FILE_UPLOAD_MIMES = exports.SECURE_FILE_UPLOAD_CONTENT_KINDS = void 0;
exports.createTrustedSecureFileUploadPolicy = createTrustedSecureFileUploadPolicy;
exports.createDefaultSecureFileUploadPolicy = createDefaultSecureFileUploadPolicy;
exports.assertTrustedSecureFileUploadPolicy = assertTrustedSecureFileUploadPolicy;
exports.validateSecureFileUpload = validateSecureFileUpload;
exports.assertTrustedValidatedSecureFileUpload = assertTrustedValidatedSecureFileUpload;
exports.materializeValidatedSecureFileUploadBytes = materializeValidatedSecureFileUploadBytes;
exports.confirmStoredSecureFileUpload = confirmStoredSecureFileUpload;
exports.assertTrustedStoredSecureFileUpload = assertTrustedStoredSecureFileUpload;
exports.secureFileMatchesStoredUpload = secureFileMatchesStoredUpload;
const node_crypto_1 = require("node:crypto");
const secure_file_domain_1 = require("./secure-file-domain");
exports.SECURE_FILE_UPLOAD_CONTENT_KINDS = ["pdf", "png", "jpeg"];
exports.SECURE_FILE_UPLOAD_MIMES = [
    "application/pdf",
    "image/png",
    "image/jpeg"
];
exports.SECURE_FILE_UPLOAD_PLATFORM_MAX_BYTES = 25 * 1024 * 1024;
exports.SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
class SecureFileUploadValidationError extends Error {
    reason;
    constructor(reason) {
        super("The uploaded file could not be accepted.");
        this.reason = reason;
        this.name = "SecureFileUploadValidationError";
    }
}
exports.SecureFileUploadValidationError = SecureFileUploadValidationError;
const TRUSTED_UPLOAD_POLICY = Symbol("trusted-secure-file-upload-policy");
const TRUSTED_UPLOAD_POLICIES = new WeakSet();
const TRUSTED_VALIDATED_UPLOAD = Symbol("trusted-validated-secure-file-upload");
const TRUSTED_VALIDATED_UPLOADS = new WeakSet();
const VALIDATED_UPLOAD_BYTES = new WeakMap();
const TRUSTED_STORED_UPLOAD = Symbol("trusted-stored-secure-file-upload");
const TRUSTED_STORED_UPLOADS = new WeakSet();
function isContentKind(value) {
    return (typeof value === "string" &&
        exports.SECURE_FILE_UPLOAD_CONTENT_KINDS.includes(value));
}
function normalizePolicyKey(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized.length < 3 ||
        normalized.length > 120 ||
        !/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
        throw new SecureFileUploadValidationError("invalid_policy");
    }
    return normalized;
}
function createTrustedSecureFileUploadPolicy(input) {
    const policyKey = normalizePolicyKey(input.policyKey);
    if (!Array.isArray(input.allowedKinds) ||
        input.allowedKinds.length < 1 ||
        !input.allowedKinds.every(isContentKind) ||
        new Set(input.allowedKinds).size !== input.allowedKinds.length ||
        !Number.isSafeInteger(input.maxBytes) ||
        input.maxBytes < 1 ||
        input.maxBytes > exports.SECURE_FILE_UPLOAD_PLATFORM_MAX_BYTES) {
        throw new SecureFileUploadValidationError("invalid_policy");
    }
    const uniqueKinds = exports.SECURE_FILE_UPLOAD_CONTENT_KINDS.filter((kind) => input.allowedKinds.includes(kind));
    const policy = Object.freeze({
        policyKey,
        allowedKinds: Object.freeze([...uniqueKinds]),
        maxBytes: input.maxBytes,
        [TRUSTED_UPLOAD_POLICY]: true
    });
    TRUSTED_UPLOAD_POLICIES.add(policy);
    return policy;
}
function createDefaultSecureFileUploadPolicy() {
    return createTrustedSecureFileUploadPolicy({
        policyKey: "platform.evidence.default",
        allowedKinds: exports.SECURE_FILE_UPLOAD_CONTENT_KINDS,
        maxBytes: exports.SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES
    });
}
function assertTrustedSecureFileUploadPolicy(policy) {
    if (!policy ||
        policy[TRUSTED_UPLOAD_POLICY] !== true ||
        !TRUSTED_UPLOAD_POLICIES.has(policy) ||
        normalizePolicyKey(policy.policyKey) !== policy.policyKey ||
        !Array.isArray(policy.allowedKinds) ||
        policy.allowedKinds.length < 1 ||
        !policy.allowedKinds.every(isContentKind) ||
        new Set(policy.allowedKinds).size !== policy.allowedKinds.length ||
        !Number.isSafeInteger(policy.maxBytes) ||
        policy.maxBytes < 1 ||
        policy.maxBytes > exports.SECURE_FILE_UPLOAD_PLATFORM_MAX_BYTES) {
        throw new SecureFileUploadValidationError("invalid_policy");
    }
    return policy;
}
function normalizeDeclaredMime(value) {
    if (typeof value !== "string") {
        throw new SecureFileUploadValidationError("invalid_declared_mime");
    }
    const normalized = value.trim().toLowerCase();
    if (!exports.SECURE_FILE_UPLOAD_MIMES.includes(normalized)) {
        throw new SecureFileUploadValidationError("invalid_declared_mime");
    }
    return normalized;
}
function extensionForFilename(value) {
    let filename;
    try {
        filename = (0, secure_file_domain_1.normalizeSecureFileDisplayFilename)(value);
    }
    catch {
        throw new SecureFileUploadValidationError("invalid_filename");
    }
    const dot = filename.lastIndexOf(".");
    if (dot < 1 || dot === filename.length - 1) {
        throw new SecureFileUploadValidationError("invalid_filename");
    }
    const extension = filename.slice(dot + 1).toLowerCase();
    if (extension !== "pdf" &&
        extension !== "png" &&
        extension !== "jpg" &&
        extension !== "jpeg") {
        throw new SecureFileUploadValidationError("unsupported_type");
    }
    return extension;
}
function kindForExtension(extension) {
    if (extension === "pdf")
        return "pdf";
    if (extension === "png")
        return "png";
    return "jpeg";
}
function mimeForKind(kind) {
    if (kind === "pdf")
        return "application/pdf";
    if (kind === "png")
        return "image/png";
    return "image/jpeg";
}
function bytesEqualAt(bytes, offset, expected) {
    if (offset < 0 || offset + expected.length > bytes.length)
        return false;
    for (let index = 0; index < expected.length; index += 1) {
        if (bytes[offset + index] !== expected[index])
            return false;
    }
    return true;
}
function isAsciiWhitespace(value) {
    return value === 0x09 || value === 0x0a || value === 0x0c || value === 0x0d || value === 0x20;
}
function detectPdf(bytes) {
    const header = [0x25, 0x50, 0x44, 0x46, 0x2d];
    const eof = [0x25, 0x25, 0x45, 0x4f, 0x46];
    if (bytes.length < 12 || !bytesEqualAt(bytes, 0, header))
        return false;
    let finalEofOffset = -1;
    for (let index = header.length; index <= bytes.length - eof.length; index += 1) {
        if (bytesEqualAt(bytes, index, eof))
            finalEofOffset = index;
    }
    if (finalEofOffset === -1)
        return false;
    for (let index = finalEofOffset + eof.length; index < bytes.length; index += 1) {
        if (!isAsciiWhitespace(bytes[index]))
            return false;
    }
    return true;
}
function readUint16BigEndian(bytes, offset) {
    return bytes[offset] * 0x100 + bytes[offset + 1];
}
function readUint32BigEndian(bytes, offset) {
    return (bytes[offset] * 0x1000000 +
        bytes[offset + 1] * 0x10000 +
        bytes[offset + 2] * 0x100 +
        bytes[offset + 3]);
}
function crc32(bytes, start, end) {
    let crc = 0xffffffff;
    for (let index = start; index < end; index += 1) {
        crc ^= bytes[index];
        for (let bit = 0; bit < 8; bit += 1) {
            const mask = -(crc & 1);
            crc = (crc >>> 1) ^ (0xedb88320 & mask);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunkType(bytes, offset) {
    if (offset + 4 > bytes.length)
        return null;
    let result = "";
    for (let index = 0; index < 4; index += 1) {
        const value = bytes[offset + index];
        const isLetter = (value >= 65 && value <= 90) || (value >= 97 && value <= 122);
        if (!isLetter)
            return null;
        result += String.fromCharCode(value);
    }
    return result;
}
function validPngBitDepth(bitDepth, colorType) {
    if (colorType === 0)
        return [1, 2, 4, 8, 16].includes(bitDepth);
    if (colorType === 2)
        return bitDepth === 8 || bitDepth === 16;
    if (colorType === 3)
        return [1, 2, 4, 8].includes(bitDepth);
    if (colorType === 4 || colorType === 6)
        return bitDepth === 8 || bitDepth === 16;
    return false;
}
function validPngIhdr(bytes, dataOffset, length) {
    if (length !== 13)
        return false;
    const width = readUint32BigEndian(bytes, dataOffset);
    const height = readUint32BigEndian(bytes, dataOffset + 4);
    const bitDepth = bytes[dataOffset + 8];
    const colorType = bytes[dataOffset + 9];
    const compression = bytes[dataOffset + 10];
    const filter = bytes[dataOffset + 11];
    const interlace = bytes[dataOffset + 12];
    return (width > 0 &&
        height > 0 &&
        validPngBitDepth(bitDepth, colorType) &&
        compression === 0 &&
        filter === 0 &&
        (interlace === 0 || interlace === 1));
}
function detectPng(bytes) {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 45 || !bytesEqualAt(bytes, 0, signature))
        return false;
    let offset = signature.length;
    let chunkIndex = 0;
    let sawIdat = false;
    let idatEnded = false;
    while (offset < bytes.length) {
        if (offset + 12 > bytes.length)
            return false;
        const length = readUint32BigEndian(bytes, offset);
        const type = chunkType(bytes, offset + 4);
        if (!type || length > bytes.length - offset - 12)
            return false;
        const dataOffset = offset + 8;
        const dataEnd = dataOffset + length;
        const storedCrc = readUint32BigEndian(bytes, dataEnd);
        if (crc32(bytes, offset + 4, dataEnd) !== storedCrc)
            return false;
        const nextOffset = dataEnd + 4;
        if (chunkIndex === 0 &&
            (type !== "IHDR" || !validPngIhdr(bytes, dataOffset, length))) {
            return false;
        }
        if (chunkIndex > 0 && type === "IHDR")
            return false;
        if (type === "IDAT") {
            if (idatEnded)
                return false;
            sawIdat = true;
        }
        else if (sawIdat && type !== "IEND") {
            idatEnded = true;
        }
        if (type === "IEND") {
            return length === 0 && sawIdat && nextOffset === bytes.length;
        }
        offset = nextOffset;
        chunkIndex += 1;
    }
    return false;
}
function isJpegFrameMarker(marker) {
    return [
        0xc0, 0xc1, 0xc2, 0xc3,
        0xc5, 0xc6, 0xc7,
        0xc9, 0xca, 0xcb,
        0xcd, 0xce, 0xcf
    ].includes(marker);
}
function validJpegFrame(bytes, dataOffset, length) {
    if (length < 6)
        return false;
    const precision = bytes[dataOffset];
    const height = readUint16BigEndian(bytes, dataOffset + 1);
    const width = readUint16BigEndian(bytes, dataOffset + 3);
    const components = bytes[dataOffset + 5];
    return (precision > 0 &&
        height > 0 &&
        width > 0 &&
        components >= 1 &&
        components <= 4 &&
        length === 6 + 3 * components);
}
function validJpegScanHeader(bytes, dataOffset, length) {
    if (length < 6)
        return false;
    const components = bytes[dataOffset];
    return components >= 1 && components <= 4 && length === 4 + 2 * components;
}
function detectJpeg(bytes) {
    if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
        return false;
    let offset = 2;
    let sawFrame = false;
    let sawScan = false;
    let inScan = false;
    while (offset < bytes.length) {
        if (inScan) {
            if (bytes[offset] !== 0xff) {
                offset += 1;
                continue;
            }
            const markerStart = offset;
            while (offset < bytes.length && bytes[offset] === 0xff)
                offset += 1;
            if (offset >= bytes.length)
                return false;
            const marker = bytes[offset];
            if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
                offset += 1;
                continue;
            }
            if (marker === 0xd9) {
                return sawFrame && sawScan && offset + 1 === bytes.length;
            }
            offset = markerStart;
            inScan = false;
            continue;
        }
        if (bytes[offset] !== 0xff)
            return false;
        while (offset < bytes.length && bytes[offset] === 0xff)
            offset += 1;
        if (offset >= bytes.length)
            return false;
        const marker = bytes[offset];
        offset += 1;
        if (marker === 0x00 ||
            marker === 0xd8 ||
            marker === 0xd9 ||
            marker === 0x01 ||
            (marker >= 0xd0 && marker <= 0xd7)) {
            return false;
        }
        if (offset + 2 > bytes.length)
            return false;
        const segmentLength = readUint16BigEndian(bytes, offset);
        if (segmentLength < 2 || offset + segmentLength > bytes.length)
            return false;
        const dataOffset = offset + 2;
        const dataLength = segmentLength - 2;
        if (isJpegFrameMarker(marker)) {
            if (!validJpegFrame(bytes, dataOffset, dataLength))
                return false;
            sawFrame = true;
        }
        if (marker === 0xda) {
            if (!sawFrame || !validJpegScanHeader(bytes, dataOffset, dataLength))
                return false;
            sawScan = true;
            inScan = true;
        }
        offset += segmentLength;
    }
    return false;
}
function detectContentKind(bytes) {
    const matches = [];
    if (detectPdf(bytes))
        matches.push("pdf");
    if (detectPng(bytes))
        matches.push("png");
    if (detectJpeg(bytes))
        matches.push("jpeg");
    if (matches.length !== 1) {
        throw new SecureFileUploadValidationError("invalid_structure");
    }
    return matches[0];
}
function sha256(bytes) {
    return (0, node_crypto_1.createHash)("sha256").update(bytes).digest("hex");
}
function validateSecureFileUpload(input) {
    const policy = assertTrustedSecureFileUploadPolicy(input.policy);
    const fileId = (0, secure_file_domain_1.normalizeSecureFileReference)(input.fileId);
    if (!fileId ||
        input.objectKey !== (0, secure_file_domain_1.deriveSecureFileObjectKey)(fileId) ||
        !/^secure-files\/[a-f0-9]{64}$/.test(input.objectKey)) {
        throw new SecureFileUploadValidationError("invalid_reservation");
    }
    let reservedDisplayFilename;
    let originalFilename;
    try {
        reservedDisplayFilename = (0, secure_file_domain_1.normalizeSecureFileDisplayFilename)(input.reservedDisplayFilename);
        originalFilename = (0, secure_file_domain_1.normalizeSecureFileDisplayFilename)(input.originalFilename);
    }
    catch {
        throw new SecureFileUploadValidationError("invalid_filename");
    }
    if (reservedDisplayFilename !== input.reservedDisplayFilename ||
        originalFilename !== reservedDisplayFilename) {
        throw new SecureFileUploadValidationError("invalid_filename");
    }
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1) {
        throw new SecureFileUploadValidationError("invalid_structure");
    }
    if (input.bytes.byteLength > policy.maxBytes) {
        throw new SecureFileUploadValidationError("oversize");
    }
    const extension = extensionForFilename(originalFilename);
    const extensionKind = kindForExtension(extension);
    if (!policy.allowedKinds.includes(extensionKind)) {
        throw new SecureFileUploadValidationError("unsupported_type");
    }
    const declaredMime = normalizeDeclaredMime(input.declaredMime);
    const expectedMime = mimeForKind(extensionKind);
    if (declaredMime !== expectedMime) {
        throw new SecureFileUploadValidationError("type_mismatch");
    }
    const immutableBytes = Uint8Array.from(input.bytes);
    const detectedKind = detectContentKind(immutableBytes);
    const detectedMime = mimeForKind(detectedKind);
    if (detectedKind !== extensionKind || detectedMime !== declaredMime) {
        throw new SecureFileUploadValidationError("type_mismatch");
    }
    const validated = Object.freeze({
        fileId,
        objectKey: input.objectKey,
        displayFilename: reservedDisplayFilename,
        fileExtension: extension,
        declaredMime,
        detectedMime,
        byteSize: immutableBytes.byteLength,
        contentSha256: sha256(immutableBytes),
        policyKey: policy.policyKey,
        [TRUSTED_VALIDATED_UPLOAD]: true
    });
    TRUSTED_VALIDATED_UPLOADS.add(validated);
    VALIDATED_UPLOAD_BYTES.set(validated, immutableBytes);
    return validated;
}
function assertTrustedValidatedSecureFileUpload(upload) {
    if (!upload ||
        upload[TRUSTED_VALIDATED_UPLOAD] !== true ||
        !TRUSTED_VALIDATED_UPLOADS.has(upload) ||
        !VALIDATED_UPLOAD_BYTES.has(upload) ||
        !(0, secure_file_domain_1.normalizeSecureFileReference)(upload.fileId) ||
        upload.objectKey !== (0, secure_file_domain_1.deriveSecureFileObjectKey)(upload.fileId) ||
        !Number.isSafeInteger(upload.byteSize) ||
        upload.byteSize < 1 ||
        !/^[a-f0-9]{64}$/.test(upload.contentSha256)) {
        throw new SecureFileUploadValidationError("invalid_reservation");
    }
    return upload;
}
function materializeValidatedSecureFileUploadBytes(uploadInput) {
    const upload = assertTrustedValidatedSecureFileUpload(uploadInput);
    const bytes = VALIDATED_UPLOAD_BYTES.get(upload);
    if (!bytes)
        throw new SecureFileUploadValidationError("invalid_reservation");
    return Uint8Array.from(bytes);
}
function confirmStoredSecureFileUpload(uploadInput, stored) {
    const upload = assertTrustedValidatedSecureFileUpload(uploadInput);
    if (!stored ||
        !Number.isSafeInteger(stored.byteSize) ||
        stored.byteSize !== upload.byteSize ||
        stored.sha256 !== upload.contentSha256) {
        throw new SecureFileUploadValidationError("stored_object_inconsistent");
    }
    const trusted = Object.freeze({
        fileId: upload.fileId,
        objectKey: upload.objectKey,
        displayFilename: upload.displayFilename,
        fileExtension: upload.fileExtension,
        declaredMime: upload.declaredMime,
        detectedMime: upload.detectedMime,
        byteSize: upload.byteSize,
        contentSha256: upload.contentSha256,
        policyKey: upload.policyKey,
        [TRUSTED_STORED_UPLOAD]: true
    });
    TRUSTED_STORED_UPLOADS.add(trusted);
    return trusted;
}
function assertTrustedStoredSecureFileUpload(upload) {
    if (!upload ||
        upload[TRUSTED_STORED_UPLOAD] !== true ||
        !TRUSTED_STORED_UPLOADS.has(upload) ||
        !(0, secure_file_domain_1.normalizeSecureFileReference)(upload.fileId) ||
        upload.objectKey !== (0, secure_file_domain_1.deriveSecureFileObjectKey)(upload.fileId) ||
        !Number.isSafeInteger(upload.byteSize) ||
        upload.byteSize < 1 ||
        !/^[a-f0-9]{64}$/.test(upload.contentSha256)) {
        throw new SecureFileUploadValidationError("stored_object_inconsistent");
    }
    return upload;
}
function secureFileMatchesStoredUpload(file, uploadInput) {
    const upload = assertTrustedStoredSecureFileUpload(uploadInput);
    return (file.fileId === upload.fileId &&
        file.objectKey === upload.objectKey &&
        file.displayFilename === upload.displayFilename &&
        file.fileExtension === upload.fileExtension &&
        file.declaredMime === upload.declaredMime &&
        file.detectedMime === upload.detectedMime &&
        file.byteSize === upload.byteSize &&
        file.contentSha256 === upload.contentSha256);
}
