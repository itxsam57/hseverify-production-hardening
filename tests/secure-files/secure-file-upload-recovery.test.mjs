import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const uploads = await import(
  "../../.secure-upload-test-dist/secure-files/secure-file-upload-domain.js"
);
const files = await import(
  "../../.secure-upload-test-dist/secure-files/secure-file-domain.js"
);
const storageModule = await import(
  "../../.secure-upload-test-dist/secure-files/private-object-storage-core.js"
);

function pdfBytes(label) {
  return new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj\n<< /Label (${label}) >>\nendobj\n%%EOF\n`
  );
}

function validated(fileId, filename, bytes) {
  return uploads.validateSecureFileUpload({
    policy: uploads.createDefaultSecureFileUploadPolicy(),
    fileId,
    objectKey: files.deriveSecureFileObjectKey(fileId),
    reservedDisplayFilename: filename,
    originalFilename: filename,
    declaredMime: "application/pdf",
    bytes
  });
}

test("staged private bytes are retry-safe for identical content and reject conflicting replay", async () => {
  const base = await mkdtemp(join(tmpdir(), "hse-secure-upload-recovery-"));
  try {
    const storage = new storageModule.LocalTestPrivateObjectStorage({
      appEnvironment: "test",
      trustedBasePath: base,
      rootPath: join(base, "objects")
    });
    const fileId = `secure_file_${"R".repeat(24)}`;
    const first = validated(fileId, "evidence.pdf", pdfBytes("first"));
    const bytes = uploads.materializeValidatedSecureFileUploadBytes(first);

    const initialWrite = await storage.put(first.objectKey, bytes);
    assert.deepEqual(initialWrite, await storage.put(first.objectKey, bytes));
    const stat = await storage.stat(first.objectKey);
    assert.ok(stat);
    const stored = uploads.confirmStoredSecureFileUpload(first, stat);
    assert.equal(stored.fileId, fileId);

    const conflicting = validated(fileId, "evidence.pdf", pdfBytes("different"));
    await assert.rejects(
      storage.put(
        conflicting.objectKey,
        uploads.materializeValidatedSecureFileUploadBytes(conflicting)
      ),
      storageModule.PrivateObjectConflictError
    );
    assert.deepEqual(await storage.stat(first.objectKey), stat);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("independent reservations with identical filenames cannot cross-link object keys", async () => {
  const base = await mkdtemp(join(tmpdir(), "hse-secure-upload-independent-"));
  try {
    const storage = new storageModule.LocalTestPrivateObjectStorage({
      appEnvironment: "test",
      trustedBasePath: base,
      rootPath: join(base, "objects")
    });
    const firstId = `secure_file_${"S".repeat(24)}`;
    const secondId = `secure_file_${"T".repeat(24)}`;
    const first = validated(firstId, "same.pdf", pdfBytes("one"));
    const second = validated(secondId, "same.pdf", pdfBytes("two"));
    assert.notEqual(first.objectKey, second.objectKey);

    await storage.put(
      first.objectKey,
      uploads.materializeValidatedSecureFileUploadBytes(first)
    );
    await storage.put(
      second.objectKey,
      uploads.materializeValidatedSecureFileUploadBytes(second)
    );
    const firstStat = await storage.stat(first.objectKey);
    const secondStat = await storage.stat(second.objectKey);
    assert.ok(firstStat);
    assert.ok(secondStat);
    assert.notEqual(firstStat.sha256, secondStat.sha256);
    assert.equal(
      uploads.confirmStoredSecureFileUpload(first, firstStat).fileId,
      firstId
    );
    assert.equal(
      uploads.confirmStoredSecureFileUpload(second, secondStat).fileId,
      secondId
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("stored confirmation fails when the private object is missing or inconsistent", () => {
  const fileId = `secure_file_${"U".repeat(24)}`;
  const accepted = validated(fileId, "missing.pdf", pdfBytes("missing"));
  assert.throws(
    () => uploads.confirmStoredSecureFileUpload(accepted, {
      byteSize: accepted.byteSize,
      sha256: "f".repeat(64)
    }),
    (error) => error instanceof uploads.SecureFileUploadValidationError &&
      error.reason === "stored_object_inconsistent"
  );
});
