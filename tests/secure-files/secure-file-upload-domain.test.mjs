import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const uploads = await import(
  "../../.secure-upload-test-dist/secure-files/secure-file-upload-domain.js"
);
const files = await import(
  "../../.secure-upload-test-dist/secure-files/secure-file-domain.js"
);

const FILE_ID = `secure_file_${"A".repeat(24)}`;
const OBJECT_KEY = files.deriveSecureFileObjectKey(FILE_ID);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pdfBytes(extra = "") {
  return new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n${extra}`
  );
}

function incrementalPdfBytes() {
  return new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n2 0 obj\n<< /Updated true >>\nendobj\n%%EOF\n"
  );
}

function uint16(value) {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function uint32(value) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ];
}

function crc32(values) {
  let crc = 0xffffffff;
  for (const value of values) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = []) {
  const typeBytes = [...new TextEncoder().encode(type)];
  const checked = [...typeBytes, ...data];
  return [
    ...uint32(data.length),
    ...checked,
    ...uint32(crc32(checked))
  ];
}

function pngBytes(extra = [], ihdrInput = null) {
  const ihdr = ihdrInput ?? [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0];
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", [0]),
    ...chunk("IEND"),
    ...extra
  ]);
}

function jpegBytes(extra = []) {
  const app0 = [0xff, 0xe0, ...uint16(2)];
  const frame = [
    0xff, 0xc0, ...uint16(11),
    8,
    ...uint16(1),
    ...uint16(1),
    1,
    1, 0x11, 0
  ];
  const scan = [
    0xff, 0xda, ...uint16(8),
    1,
    1, 0,
    0, 63, 0
  ];
  return Uint8Array.from([
    0xff, 0xd8,
    ...app0,
    ...frame,
    ...scan,
    0x00,
    0xff, 0xd9,
    ...extra
  ]);
}

function validate({
  policy = uploads.createDefaultSecureFileUploadPolicy(),
  filename = "evidence.pdf",
  mime = "application/pdf",
  bytes = pdfBytes()
} = {}) {
  return uploads.validateSecureFileUpload({
    policy,
    fileId: FILE_ID,
    objectKey: OBJECT_KEY,
    reservedDisplayFilename: filename,
    originalFilename: filename,
    declaredMime: mime,
    bytes
  });
}

function expectReason(callback, reason) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof uploads.SecureFileUploadValidationError);
    assert.equal(error.reason, reason);
    return true;
  });
}

test("upload policy is bounded, deterministic and non-forgeable", () => {
  const policy = uploads.createDefaultSecureFileUploadPolicy();
  assert.equal(policy.policyKey, "platform.evidence.default");
  assert.deepEqual(policy.allowedKinds, ["pdf", "png", "jpeg"]);
  assert.equal(policy.maxBytes, 10 * 1024 * 1024);
  assert.equal(uploads.assertTrustedSecureFileUploadPolicy(policy), policy);
  expectReason(
    () => uploads.assertTrustedSecureFileUploadPolicy({ ...policy }),
    "invalid_policy"
  );
  expectReason(
    () => uploads.createTrustedSecureFileUploadPolicy({
      policyKey: "bad policy",
      allowedKinds: ["pdf"],
      maxBytes: 1
    }),
    "invalid_policy"
  );
  expectReason(
    () => uploads.createTrustedSecureFileUploadPolicy({
      policyKey: "duplicate.kinds",
      allowedKinds: ["pdf", "pdf"],
      maxBytes: 1024
    }),
    "invalid_policy"
  );
  expectReason(
    () => uploads.createTrustedSecureFileUploadPolicy({
      policyKey: "too.large",
      allowedKinds: ["pdf"],
      maxBytes: uploads.SECURE_FILE_UPLOAD_PLATFORM_MAX_BYTES + 1
    }),
    "invalid_policy"
  );
});

test("valid PDF, incremental PDF, PNG and JPEG uploads are independently detected from bytes", () => {
  const pdf = validate();
  assert.equal(pdf.fileExtension, "pdf");
  assert.equal(pdf.declaredMime, "application/pdf");
  assert.equal(pdf.detectedMime, "application/pdf");

  const incrementalPdf = validate({ bytes: incrementalPdfBytes() });
  assert.equal(incrementalPdf.detectedMime, "application/pdf");

  const png = validate({
    filename: "photo.PNG",
    mime: "IMAGE/PNG",
    bytes: pngBytes()
  });
  assert.equal(png.fileExtension, "png");
  assert.equal(png.detectedMime, "image/png");

  const jpeg = validate({
    filename: "photo.JpEg",
    mime: "image/jpeg",
    bytes: jpegBytes()
  });
  assert.equal(jpeg.fileExtension, "jpeg");
  assert.equal(jpeg.detectedMime, "image/jpeg");

  const jpg = validate({
    filename: "photo.JPG",
    mime: "image/jpeg",
    bytes: jpegBytes()
  });
  assert.equal(jpg.fileExtension, "jpg");
});

test("extension, declared MIME and detected structure must all agree", () => {
  expectReason(
    () => validate({ filename: "evidence.pdf", mime: "image/png", bytes: pdfBytes() }),
    "type_mismatch"
  );
  expectReason(
    () => validate({ filename: "evidence.png", mime: "image/png", bytes: pdfBytes() }),
    "type_mismatch"
  );
  expectReason(
    () => validate({ filename: "evidence.jpg", mime: "image/jpeg", bytes: pngBytes() }),
    "type_mismatch"
  );
  expectReason(
    () => validate({ filename: "evidence.pdf", mime: "application/pdf; charset=binary", bytes: pdfBytes() }),
    "invalid_declared_mime"
  );
});

test("filename claims cannot select paths, unsupported extensions or another reservation name", () => {
  const policy = uploads.createDefaultSecureFileUploadPolicy();
  for (const filename of ["evidence", "evidence.exe", "../evidence.pdf", "folder/evidence.pdf"] ) {
    expectReason(
      () => uploads.validateSecureFileUpload({
        policy,
        fileId: FILE_ID,
        objectKey: OBJECT_KEY,
        reservedDisplayFilename: filename,
        originalFilename: filename,
        declaredMime: "application/pdf",
        bytes: pdfBytes()
      }),
      filename.endsWith(".exe") ? "unsupported_type" : "invalid_filename"
    );
  }
  expectReason(
    () => uploads.validateSecureFileUpload({
      policy,
      fileId: FILE_ID,
      objectKey: OBJECT_KEY,
      reservedDisplayFilename: "reserved.pdf",
      originalFilename: "other.pdf",
      declaredMime: "application/pdf",
      bytes: pdfBytes()
    }),
    "invalid_filename"
  );
});

test("trusted policy controls allowed families and byte ceiling", () => {
  const pdfOnly = uploads.createTrustedSecureFileUploadPolicy({
    policyKey: "platform.pdf.only",
    allowedKinds: ["pdf"],
    maxBytes: 64
  });
  expectReason(
    () => validate({ policy: pdfOnly, filename: "image.png", mime: "image/png", bytes: pngBytes() }),
    "unsupported_type"
  );
  const tiny = uploads.createTrustedSecureFileUploadPolicy({
    policyKey: "platform.tiny.pdf",
    allowedKinds: ["pdf"],
    maxBytes: 8
  });
  expectReason(() => validate({ policy: tiny }), "oversize");
});

test("truncated, corrupted and trailing-content structures fail closed", () => {
  const truncatedPdf = new TextEncoder().encode("%PDF-1.4\nno eof");
  expectReason(() => validate({ bytes: truncatedPdf }), "invalid_structure");
  expectReason(() => validate({ bytes: pdfBytes("MZ") }), "invalid_structure");

  const truncatedPng = pngBytes().slice(0, -4);
  expectReason(
    () => validate({ filename: "image.png", mime: "image/png", bytes: truncatedPng }),
    "invalid_structure"
  );
  expectReason(
    () => validate({ filename: "image.png", mime: "image/png", bytes: pngBytes([0x4d, 0x5a]) }),
    "invalid_structure"
  );
  const badCrcPng = pngBytes();
  badCrcPng[32] ^= 0x01;
  expectReason(
    () => validate({ filename: "image.png", mime: "image/png", bytes: badCrcPng }),
    "invalid_structure"
  );
  const zeroWidthPng = pngBytes([], [0, 0, 0, 0, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  expectReason(
    () => validate({ filename: "image.png", mime: "image/png", bytes: zeroWidthPng }),
    "invalid_structure"
  );

  const truncatedJpeg = jpegBytes().slice(0, -2);
  expectReason(
    () => validate({ filename: "image.jpg", mime: "image/jpeg", bytes: truncatedJpeg }),
    "invalid_structure"
  );
  expectReason(
    () => validate({ filename: "image.jpg", mime: "image/jpeg", bytes: jpegBytes([0x00]) }),
    "invalid_structure"
  );
  const wrapperOnlyJpeg = Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x02,
    0xff, 0xd9
  ]);
  expectReason(
    () => validate({ filename: "image.jpg", mime: "image/jpeg", bytes: wrapperOnlyJpeg }),
    "invalid_structure"
  );
});

test("validated bytes are copied before storage so caller mutation cannot change accepted content", () => {
  const original = pdfBytes();
  const validated = validate({ bytes: original });
  const acceptedHash = validated.contentSha256;
  original.fill(0);
  const materialized = uploads.materializeValidatedSecureFileUploadBytes(validated);
  assert.equal(sha256(materialized), acceptedHash);
  assert.notEqual(sha256(original), acceptedHash);
  const secondMaterialization = uploads.materializeValidatedSecureFileUploadBytes(validated);
  materialized.fill(1);
  assert.equal(sha256(secondMaterialization), acceptedHash);
});

test("stored-content capability requires exact server hash and size and cannot be forged", () => {
  const validated = validate();
  const stored = uploads.confirmStoredSecureFileUpload(validated, {
    byteSize: validated.byteSize,
    sha256: validated.contentSha256
  });
  assert.equal(uploads.assertTrustedStoredSecureFileUpload(stored), stored);
  expectReason(
    () => uploads.confirmStoredSecureFileUpload(validated, {
      byteSize: validated.byteSize + 1,
      sha256: validated.contentSha256
    }),
    "stored_object_inconsistent"
  );
  expectReason(
    () => uploads.confirmStoredSecureFileUpload(validated, {
      byteSize: validated.byteSize,
      sha256: "0".repeat(64)
    }),
    "stored_object_inconsistent"
  );
  expectReason(
    () => uploads.assertTrustedStoredSecureFileUpload({ ...stored }),
    "stored_object_inconsistent"
  );
});
